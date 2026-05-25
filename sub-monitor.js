// ============================================================================
// sub-monitor.js — Subreddit Live OSINT Wiretap
// ============================================================================

const cron = require('node-cron');
const db = require('./db');
const ai = require('./ai-analyzer');

const REDDIT_USER_AGENT = 'RedTrack/2.0 (Open Source Reddit OSINT)';
const BASE = 'https://old.reddit.com';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(endpoint) {
  try {
    db.logApiRequest(endpoint);
    const res = await fetch(`${BASE}${endpoint}`, {
      headers: { 'User-Agent': REDDIT_USER_AGENT }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const json = await res.json();
    return json?.data?.children?.map(c => c.data) || [];
  } catch (err) {
    console.error(`[Sub-Monitor] Error fetching ${endpoint}:`, err.message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// 1. The Sweep: Find new posts for tapped subreddits
// ---------------------------------------------------------------------------
async function sweepSubreddits() {
  const taps = db.getTapsDueForCheck();
  if (taps.length === 0) return;

  console.log(`[Sub-Monitor] Sweeping ${taps.length} subreddit(s) for new posts...`);
  
  for (const tap of taps) {
    const posts = await fetchJSON(`/r/${tap.subreddit}/new.json?limit=100`);
    
    // STRICTLY FORWARD-LOOKING: Only care about posts created AFTER we tapped the subreddit
    const validPosts = posts.filter(p => p.created_utc >= tap.tapped_at);
    
    if (validPosts.length > 0) {
      const inserted = db.insertTappedPosts(tap.subreddit, validPosts);
      console.log(`[Sub-Monitor] r/${tap.subreddit} -> Intercepted ${inserted} new post(s)`);
    }

    db.updateLiveTapCheck(tap.subreddit);
    await sleep(2000);
  }
}

// ---------------------------------------------------------------------------
// 2. The Deep Dive: Poll active posts for new comments
// ---------------------------------------------------------------------------
async function deepDivePosts() {
  const activePosts = db.getActiveTappedPosts();
  if (activePosts.length === 0) return;

  console.log(`[Sub-Monitor] Deep diving ${activePosts.length} active post(s)...`);
  const now = Math.floor(Date.now() / 1000);

  for (const post of activePosts) {
    const ageHours = (now - post.created_utc) / 3600;

    // RULE: If >23h old, Summarize and Drop
    if (ageHours > 23) {
      console.log(`[Sub-Monitor] Post ${post.reddit_id} reached 23h limit. Summarizing...`);
      const summary = `Thread "${post.title}" reached 23h monitoring limit with ${post.num_comments} tracked comments. Local intelligence assessment concluded.`;
      db.updateTappedPostStatus(post.reddit_id, 'completed', post.num_comments, summary);
      continue;
    }

    // RULE: If >2h old and <3 comments, Drop as Dead
    if (ageHours > 2 && post.num_comments < 3) {
      console.log(`[Sub-Monitor] Post ${post.reddit_id} failed traction check (<3 comments in 2h). Dropping.`);
      db.updateTappedPostStatus(post.reddit_id, 'dropped', post.num_comments);
      continue;
    }

    // Fetch comments
    try {
      const endpoint = `/r/${post.subreddit}/comments/${post.reddit_id}.json`;
      db.logApiRequest(endpoint);
      const res = await fetch(`${BASE}${endpoint}`, {
        headers: { 'User-Agent': REDDIT_USER_AGENT }
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      
      const postData = json[0]?.data?.children[0]?.data;
      const commentsData = json[1]?.data?.children || [];
      
      let commentCount = 0;
      
      // We only store the users/comments we find inside this specific thread.
      // We do NOT trigger a full profile scrape.
      const commentsToStore = [];
      
      function extractComments(children) {
        for (const child of children) {
          if (child.kind === 't1' && child.data) {
            commentCount++;
            commentsToStore.push(child.data);
            if (child.data.replies && child.data.replies.data) {
              extractComments(child.data.replies.data.children);
            }
          }
        }
      }
      
      extractComments(commentsData);

      // Save the intercepted users & comments to DB
      if (commentsToStore.length > 0) {
        // Group comments by author to use upsertComments properly
        const commentsByAuthor = {};
        commentsToStore.forEach(c => {
          if (!c.author || c.author === '[deleted]') return;
          if (!commentsByAuthor[c.author]) commentsByAuthor[c.author] = [];
          commentsByAuthor[c.author].push(c);
        });

        for (const [author, authorComments] of Object.entries(commentsByAuthor)) {
          db.upsertComments(author, authorComments);
        }
      }

      db.updateTappedPostStatus(post.reddit_id, 'monitoring', commentCount);
      console.log(`[Sub-Monitor] Post ${post.reddit_id} -> ${commentCount} total comments intercepted`);

    } catch (err) {
      console.error(`[Sub-Monitor] Error diving post ${post.reddit_id}:`, err.message);
    }

    await sleep(2000); // Be gentle to API
  }
}

// ---------------------------------------------------------------------------
// Main Scheduler
// ---------------------------------------------------------------------------
function startSubMonitor() {
  console.log('[Sub-Monitor] OSINT Wiretap scheduler started');

  // Every 5 minutes, we do sweeps and deep dives. 
  // (We use 5m instead of 1h to catch things fast, but we only sweep subreddits once an hour per db.js logic)
  cron.schedule('*/5 * * * *', async () => {
    try {
      await sweepSubreddits();
      await deepDivePosts();
    } catch (err) {
      console.error('[Sub-Monitor] Critical cycle error:', err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Force Fetch (Manual Sync for Last 24 Hours)
// ---------------------------------------------------------------------------
async function forceFetchSubreddit(subreddit) {
  console.log(`[Sub-Monitor] Force fetching r/${subreddit}...`);
  const posts = await fetchJSON(`/r/${subreddit}/new.json?limit=100`);
  
  const now = Math.floor(Date.now() / 1000);
  const oneDayAgo = now - 86400;
  
  // Force fetch pulls everything from the last 24 hours (satisfying "not older than today")
  const validPosts = posts.filter(p => p.created_utc >= oneDayAgo);
  
  if (validPosts.length > 0) {
    const inserted = db.insertTappedPosts(subreddit, validPosts);
    console.log(`[Sub-Monitor] r/${subreddit} -> Force Intercepted ${inserted} post(s) from past 24h`);
  }

  db.updateLiveTapCheck(subreddit);
  return validPosts.length;
}

module.exports = { startSubMonitor, forceFetchSubreddit };
