// ============================================================================
// server.js — RedTrack Server
// Express proxy + SQLite storage + monitoring + AI analysis
// ============================================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./db');
const { startMonitor, refreshUser } = require('./monitor');
const { startSubMonitor, forceFetchSubreddit } = require('./sub-monitor');
const { analyzeProfile, getConfig } = require('./ai-analyzer');
const { buildConnectionGraph } = require('./connections');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
const cookieParser = require('cookie-parser');
app.use(cookieParser());

const rateLimit = require('express-rate-limit');

// ---------------------------------------------------------------------------
// Security Headers (CSP)
// ---------------------------------------------------------------------------
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://d3js.org https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://www.redditstatic.com https://styles.redditmedia.com https://a.thumbs.redditmedia.com https://b.thumbs.redditmedia.com; connect-src 'self';"
  );
  next();
});

// General API rate limiter (100 req per 15 minutes)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict AI API rate limiter (10 req per 10 minutes)
const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'AI analysis rate limit exceeded (max 10 requests per 10 minutes).' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', globalLimiter);

// Admin/Login rate limiter (10 req per 15 mins to prevent brute-force)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Too many login attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api', globalLimiter);

app.post('/api/login', loginLimiter, (req, res) => {
  const pw = req.body.password || '';
  const expectedPw = process.env.ADMIN_PASSWORD;
  if (!expectedPw) {
    return res.status(401).json({ success: false, error: 'Auth not configured.' });
  }
  const crypto = require('crypto');
  const pwBuffer = Buffer.from(pw);
  const expectedBuffer = Buffer.from(expectedPw);
  if (pwBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(pwBuffer, expectedBuffer)) {
    // Generate a secure session cookie
    const token = crypto.randomBytes(32).toString('hex');
    // In a real app we'd store this token in a DB session table.
    // For this simple app, we can just sign a cookie or set a simple flag since there's only 1 admin.
    // To keep it simple, we'll hash the password to store in the cookie so it's not plain text.
    const hash = crypto.createHmac('sha256', process.env.ADMIN_PASSWORD).update('session').digest('hex');
    res.cookie('redtrack_session', hash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Invalid password' });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('redtrack_session');
  res.json({ success: true });
});

// Reddit API configuration
const REDDIT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RATE_LIMIT_DELAY_MS = 2000;
const RETRY_DELAY_MS = 10000;
const MAX_PAGES = 5;

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------------------------------------------------------------------------
// CORS for all /api routes
// ---------------------------------------------------------------------------
app.use('/api', (_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});
app.options('/api/*', (_req, res) => res.sendStatus(200));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function redditFetch(url) {
  console.log(`[RedTrack] Fetching: ${url}`);
  let response = await fetch(url, { headers: { 'User-Agent': REDDIT_USER_AGENT } });
  if (response.status === 429) {
    console.log(`[RedTrack] Rate limited. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
    await sleep(RETRY_DELAY_MS);
    response = await fetch(url, { headers: { 'User-Agent': REDDIT_USER_AGENT } });
  }
  return response;
}

function handleRedditError(response) {
  if (response.status === 404) return { success: false, error: 'User not found. Check the username.' };
  if (response.status === 403) return { success: false, error: 'User profile is private or account is suspended.' };
  if (!response.ok) return { success: false, error: `Reddit returned HTTP ${response.status}` };
  return null;
}

// Paginate through a Reddit listing, stopping at cutoffTimestamp if provided
async function fetchPages(baseUrl, cutoffTimestamp = 0) {
  const allItems = [];
  let after = null;
  let page = 0;

  while (page < MAX_PAGES) {
    const url = after ? `${baseUrl}&after=${after}` : baseUrl;
    if (page > 0) await sleep(RATE_LIMIT_DELAY_MS);

    const response = await redditFetch(url);
    const error = handleRedditError(response);
    if (error) return { error };

    const json = await response.json();
    const children = json.data?.children || [];
    if (children.length === 0) break;

    let hitCutoff = false;
    for (const child of children) {
      const item = child.data;
      if (cutoffTimestamp > 0 && item.created_utc <= cutoffTimestamp) {
        hitCutoff = true;
        break;
      }
      allItems.push(item);
    }

    if (hitCutoff) break;

    after = json.data?.after;
    if (!after) break;
    page++;
  }

  return { items: allItems };
}

// ---------------------------------------------------------------------------
// GET /api/user/:username/about
// ---------------------------------------------------------------------------
app.get('/api/user/:username/about', async (req, res) => {
  const { username } = req.params;

  try {
    // Check DB cache (fresh within 12 hours)
    const cached = db.getUser(username);
    const TWELVE_HOURS = 12 * 3600;
    const now = Math.floor(Date.now() / 1000);

    const forceRefresh = req.query.refresh === 'true';

    if (!forceRefresh && cached && (now - cached.fetched_at) < TWELVE_HOURS) {
      return res.json({ success: true, data: cached.parsed || cached, fromCache: true });
    }

    // Fetch fresh from Reddit
    const response = await redditFetch(
      `https://old.reddit.com/user/${encodeURIComponent(username)}/about.json`
    );
    const error = handleRedditError(response);
    if (error) return res.json(error);

    const json = await response.json();
    const userData = json.data;

    db.upsertUser(userData);
    return res.json({ success: true, data: userData, fromCache: false });
  } catch (err) {
    console.error(`[RedTrack] about error for ${username}:`, err.message);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/user/:username/posts
// DB-first: load all cached, then fetch only newer items from Reddit
// ---------------------------------------------------------------------------
app.get('/api/user/:username/posts', async (req, res) => {
  const { username } = req.params;
  const forceRefresh = req.query.refresh === 'true';

  try {
    const cachedPosts = db.getUserPosts(username);
    
    // Check if we fetched recently (e.g., within the last 12 hours)
    const dbUser = db.getUser(username);
    const TWELVE_HOURS = 12 * 3600;
    const now = Math.floor(Date.now() / 1000);
    const isRecent = dbUser && (now - dbUser.fetched_at) < TWELVE_HOURS;
    
    if (isRecent && !forceRefresh && cachedPosts.length > 0) {
      console.log(`[RedTrack] Posts for ${username} are recent. Using DB cache.`);
      return res.json({ success: true, data: cachedPosts, count: cachedPosts.length, newItems: 0, fromCache: true });
    }

    const cutoff = forceRefresh ? 0 : db.getLatestPostTimestamp(username);
    const baseUrl = `https://old.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=100&sort=new`;
    const result = await fetchPages(baseUrl, forceRefresh ? 0 : cutoff);

    if (result.error) {
      if (cachedPosts.length > 0) {
        return res.json({ success: true, data: cachedPosts, count: cachedPosts.length, fromCache: true });
      }
      return res.json(result.error);
    }

    const newCount = db.upsertPosts(username, result.items);
    console.log(`[RedTrack] Posts: ${result.items.length} fetched, ${newCount} new stored`);

    const allPosts = db.getUserPosts(username);
    return res.json({
      success: true,
      data: allPosts,
      count: allPosts.length,
      newItems: newCount,
      fromCache: cachedPosts.length > 0
    });
  } catch (err) {
    console.error(`[RedTrack] posts error for ${username}:`, err.message);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/user/:username/comments
// DB-first incremental fetch
// ---------------------------------------------------------------------------
app.get('/api/user/:username/comments', async (req, res) => {
  const { username } = req.params;
  const forceRefresh = req.query.refresh === 'true';

  try {
    const cachedComments = db.getUserComments(username);
    
    // Check if we fetched recently (e.g., within the last 12 hours)
    const dbUser = db.getUser(username);
    const TWELVE_HOURS = 12 * 3600;
    const now = Math.floor(Date.now() / 1000);
    const isRecent = dbUser && (now - dbUser.fetched_at) < TWELVE_HOURS;
    
    if (isRecent && !forceRefresh && cachedComments.length > 0) {
      console.log(`[RedTrack] Comments for ${username} are recent. Using DB cache.`);
      return res.json({ success: true, data: cachedComments, count: cachedComments.length, newItems: 0, fromCache: true });
    }

    const cutoff = forceRefresh ? 0 : db.getLatestCommentTimestamp(username);
    const baseUrl = `https://old.reddit.com/user/${encodeURIComponent(username)}/comments.json?limit=100&sort=new`;
    const result = await fetchPages(baseUrl, forceRefresh ? 0 : cutoff);

    if (result.error) {
      if (cachedComments.length > 0) {
        return res.json({ success: true, data: cachedComments, count: cachedComments.length, fromCache: true });
      }
      return res.json(result.error);
    }

    const newCount = db.upsertComments(username, result.items);
    console.log(`[RedTrack] Comments: ${result.items.length} fetched, ${newCount} new stored`);

    const allComments = db.getUserComments(username);
    return res.json({
      success: true,
      data: allComments,
      count: allComments.length,
      newItems: newCount,
      fromCache: cachedComments.length > 0
    });
  } catch (err) {
    console.error(`[RedTrack] comments error for ${username}:`, err.message);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/user/:username/connections
// Build connection graph from stored comments
// ---------------------------------------------------------------------------
app.get('/api/user/:username/connections', async (req, res) => {
  const { username } = req.params;
  try {
    // Check if we have cached connections
    const cachedConnections = db.getConnections(username);

    if (cachedConnections.length > 0 && req.query.refresh !== 'true') {
      const maxCount = cachedConnections.length > 0 ? cachedConnections[0].interaction_count : 1;
      const nodes = [
        { id: username, label: 'u/' + username, weight: maxCount, isCenter: true, color: '#f97316' },
        ...cachedConnections.slice(0, 50).map(c => ({
          id: c.connected_to,
          label: 'u/' + c.connected_to,
          weight: c.interaction_count,
          isCenter: false,
          color: getNodeColor(c.interaction_count, maxCount)
        }))
      ];
      const edges = cachedConnections.slice(0, 50).map(c => ({
        source: username,
        target: c.connected_to,
        weight: c.interaction_count
      }));
      return res.json({ success: true, data: { nodes, edges } });
    }

    // Otherwise build graph from Reddit
    const comments = db.getUserComments(username).slice(0, 500);
    const graph = await buildConnectionGraph(username, comments);
    if (graph.connections) {
      db.saveConnections(username, graph.connections);
    }
    return res.json({ success: true, data: graph });
  } catch (err) {
    console.error(`[RedTrack] connections error for ${username}:`, err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/user/:username/connections/:connected/comments
// Gets the specific comments user replied to connectedUser
// ---------------------------------------------------------------------------
app.get('/api/user/:username/connections/:connected/comments', async (req, res) => {
  const { username, connected } = req.params;
  try {
    const comments = db.getUserComments(username);
    const commentReplies = comments.filter(c => c.parent_id && c.parent_id.startsWith('t1_'));
    
    // We only need to resolve the parent authors to find the matching ones
    const parentIds = [...new Set(commentReplies.map(c => c.parent_id))];
    const BATCH_SIZE = 100;
    const authorMap = {};
    
    // Fetch parent info to check if author is 'connected'
    for (let i = 0; i < parentIds.length; i += BATCH_SIZE) {
      const batch = parentIds.slice(i, i + BATCH_SIZE);
      const url = `https://old.reddit.com/api/info.json?id=${batch.join(',')}`;
      try {
        const resp = await fetch(url, { headers: { 'User-Agent': REDDIT_USER_AGENT } });
        if (resp.ok) {
          const json = await resp.json();
          const children = json?.data?.children || [];
          for (const child of children) {
            if (child.data?.name && child.data?.author === connected) {
              authorMap[child.data.name] = true;
            }
          }
        }
      } catch (e) {}
    }
    
    const matchedComments = commentReplies.filter(c => authorMap[c.parent_id]);
    return res.json({ success: true, data: matchedComments });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

function getNodeColor(count, maxCount) {
  const ratio = count / maxCount;
  if (ratio >= 0.75) return '#fb923c';
  if (ratio >= 0.50) return '#06b6d4';
  if (ratio >= 0.25) return '#8b5cf6';
  return '#71717a';
}

// ---------------------------------------------------------------------------
// Authentication Middleware
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const meAuth = (req, res, next) => {
  const session = req.cookies.redtrack_session;
  const expectedPw = process.env.ADMIN_PASSWORD;
  
  if (!expectedPw) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Auth not configured.' });
  }

  if (!session) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Please log in.' });
  }

  const expectedHash = crypto.createHmac('sha256', expectedPw).update('session').digest('hex');
  if (session !== expectedHash) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  
  const myUser = process.env.MY_REDDIT_USERNAME;
  if (!myUser) {
    return res.status(400).json({ success: false, error: 'MY_REDDIT_USERNAME not set in .env' });
  }
  
  req.myUser = myUser;
  next();
};

app.use('/api/me', loginLimiter);

// ---------------------------------------------------------------------------
// Login endpoint
// ---------------------------------------------------------------------------
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  const expectedPw = process.env.ADMIN_PASSWORD;

  if (!expectedPw || password !== expectedPw) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }

  const sessionHash = crypto.createHmac('sha256', expectedPw).update('session').digest('hex');
  res.cookie('redtrack_session', sessionHash, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
  return res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Monitoring endpoints
// ---------------------------------------------------------------------------
app.post('/api/monitor/:username', meAuth, async (req, res) => {
  const { username } = req.params;
  const { interval = 60 } = req.body;
  try {
    db.addMonitoredUser(username, parseInt(interval));
    return res.json({ success: true, message: `Now monitoring u/${username} every ${interval} minutes` });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.delete('/api/monitor/:username', meAuth, async (req, res) => {
  const { username } = req.params;
  try {
    db.removeMonitoredUser(username);
    return res.json({ success: true, message: `Stopped monitoring u/${username}` });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/monitors', (_req, res) => {
  try {
    const monitors = db.getMonitoredUsers();
    const now = Math.floor(Date.now() / 1000);
    const enriched = monitors.map(m => ({
      ...m,
      is_monitored: true,
      next_check_in: m.next_check ? Math.max(0, m.next_check - now) : 0,
      postCount: db.getPostCount(m.username),
      commentCount: db.getCommentCount(m.username)
    }));
    return res.json({ success: true, data: enriched });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/monitor/status/:username', (req, res) => {
  const { username } = req.params;
  const monitored = db.isMonitored(username);
  return res.json({ success: true, isMonitored: monitored });
});

// ---------------------------------------------------------------------------
// AI Analysis endpoints
// ---------------------------------------------------------------------------
app.get('/api/ai-config', (_req, res) => {
  return res.json({ success: true, ...getConfig() });
});

app.post('/api/user/:username/ai-analysis', aiLimiter, async (req, res) => {
  const { username } = req.params;
  const { perspective = 'intelligence' } = req.body;

  if (!['intelligence', 'lawyer'].includes(perspective)) {
    return res.json({ success: false, error: 'Perspective must be "intelligence" or "lawyer"' });
  }

  try {
    // Build profile data from DB
    const user = db.getUser(username);
    if (!user) return res.json({ success: false, error: 'User not in database. Analyze first.' });

    const posts = db.getUserPosts(username);
    const comments = db.getUserComments(username);

    // Quick subreddit analysis
    const subMap = {};
    [...posts, ...comments].forEach(item => {
      const sub = item.subreddit || 'unknown';
      subMap[sub] = (subMap[sub] || 0) + 1;
    });
    const subreddits = Object.entries(subMap)
      .map(([name, totalCount]) => ({ name, totalCount }))
      .sort((a, b) => b.totalCount - a.totalCount);

    const avgPostScore = posts.length > 0
      ? Math.round(posts.reduce((s, p) => s + (p.score || 0), 0) / posts.length)
      : 0;
    const avgCommentScore = comments.length > 0
      ? Math.round(comments.reduce((s, c) => s + (c.score || 0), 0) / comments.length)
      : 0;

    const profileData = {
      user: user.parsed || user,
      posts,
      comments,
      subreddits,
      stats: {
        mostActiveSub: subreddits[0]?.name || 'unknown',
        avgPostScore,
        avgCommentScore
      }
    };

    const result = await analyzeProfile(username, perspective, profileData);
    db.saveAIAnalysis(username, perspective, result.content, result.model);

    return res.json({ success: true, data: result, perspective });
  } catch (err) {
    console.error(`[RedTrack] AI analysis error for ${username}:`, err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/user/:username/ai-analysis', (req, res) => {
  const { username } = req.params;
  try {
    const analyses = db.getAIAnalyses(username);
    return res.json({ success: true, data: analyses });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/stats/requests', (req, res) => {
  try {
    const count = db.getRecentApiRequestCount(6);
    return res.json({ success: true, data: { count } });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// Subreddit Live Monitor
// ---------------------------------------------------------------------------
app.post('/api/subreddit/monitor', meAuth, (req, res) => {
  const { subreddit } = req.body;
  if (!subreddit) return res.json({ success: false, error: 'Subreddit required' });
  try {
    db.addLiveTap(subreddit);
    return res.json({ success: true, message: `Started wiretap on r/${subreddit}` });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.delete('/api/subreddit/monitor/:subreddit', meAuth, (req, res) => {
  const { subreddit } = req.params;
  try {
    db.removeLiveTap(subreddit);
    return res.json({ success: true, message: `Removed wiretap on r/${subreddit}` });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.post('/api/subreddit/monitor/:subreddit/force-fetch', meAuth, async (req, res) => {
  const { subreddit } = req.params;
  try {
    const insertedCount = await forceFetchSubreddit(subreddit);
    return res.json({ success: true, message: `Force fetched ${insertedCount} recent post(s)` });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/subreddit/taps', (req, res) => {
  try {
    const taps = db.getLiveTaps();
    return res.json({ success: true, data: taps });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/subreddit/:subreddit', (req, res) => {
  const { subreddit } = req.params;
  try {
    const posts = db.getTappedPostsBySub(subreddit);
    return res.json({ success: true, data: posts });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// Personal Monitor (/me)
// ---------------------------------------------------------------------------

app.get('/me', loginLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'me.html'));
});

app.get('/api/me/summary', meAuth, (req, res) => {
  try {
    const user = db.getUser(req.myUser);
    if (!user) return res.json({ success: false, error: 'User not fetched yet.' });
    
    // Calculate karma deltas
    const snaps = db.getKarmaSnapshots(req.myUser);
    const now = Math.floor(Date.now() / 1000);
    
    let delta24 = 0;
    let delta7d = 0;
    
    // Find closest snapshot to 24h ago
    const snap24 = snaps.find(s => (now - s.snapped_at) >= 86400) || snaps[snaps.length - 1];
    if (snap24) delta24 = (user.total_karma || 0) - snap24.total_karma;
    
    // Find closest snapshot to 7d ago
    const snap7d = snaps.find(s => (now - s.snapped_at) >= 7 * 86400) || snaps[snaps.length - 1];
    if (snap7d) delta7d = (user.total_karma || 0) - snap7d.total_karma;
    
    return res.json({ success: true, data: { user: user.parsed || user, delta24, delta7d } });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/me/karma-log', meAuth, (req, res) => {
  try {
    const snaps = db.getKarmaSnapshots(req.myUser);
    return res.json({ success: true, data: snaps });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/me/posts', meAuth, (req, res) => {
  try {
    const posts = db.getUserPosts(req.myUser);
    return res.json({ success: true, data: posts });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/me/comments', meAuth, (req, res) => {
  try {
    const comments = db.getUserComments(req.myUser);
    return res.json({ success: true, data: comments });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.get('/api/me/interactions', meAuth, (req, res) => {
  try {
    const conns = db.getConnections(req.myUser);
    return res.json({ success: true, data: conns });
  } catch (err) {
    console.error('[Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// DB Stats & Admin
// ---------------------------------------------------------------------------
app.get('/api/db/stats', meAuth, (_req, res) => {
  return res.json({ success: true, data: db.getDBStats() });
});

// Serve admin dashboard HTML
app.get('/admin', loginLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Secure API endpoint for admin data
app.get('/api/admin/users', loginLimiter, meAuth, (req, res) => {
  try {
    res.json({ success: true, data: db.getAllUsers() });
  } catch (err) {
    console.error('[Error]', err);
    res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

app.delete('/api/admin/users/:username', loginLimiter, meAuth, (req, res) => {
  try {
    const { username } = req.params;
    db.deleteUser(username);
    res.json({ success: true });
  } catch (err) {
    console.error('[Error]', err);
    res.status(500).json({ success: false, error: 'Internal server error occurred.' });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function start() {
  // Init DB first
  await db.initDB();

  // Run data retention sweep if configured
  const retentionDays = parseInt(process.env.DATA_RETENTION_DAYS || '0', 10);
  if (retentionDays > 0) {
    db.sweepOldData(retentionDays);
    console.log(`[RedTrack] Swept old data (retention: ${retentionDays} days).`);
  }

  // Start monitoring scheduler
  startMonitor();
  startSubMonitor();

  app.listen(PORT, () => {
    console.log(`\n🔴 RedTrack running at http://localhost:${PORT}`);
    console.log(`   DB: ${db.getDBStats().dbPath}`);
    console.log(`   AI: ${getConfig().configured ? `${getConfig().provider} / ${getConfig().model}` : 'Not configured (set AI_API_KEY in .env)'}`);
    console.log('');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
