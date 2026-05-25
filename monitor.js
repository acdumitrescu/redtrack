// ============================================================================
// monitor.js — Background User Monitoring Scheduler
// Uses node-cron to periodically re-scrape monitored users
// ============================================================================

const cron = require('node-cron');
const db = require('./db');
const ai = require('./ai-analyzer');

const REDDIT_USER_AGENT = 'RedTrack/2.0 (Open Source Reddit Analyzer)';
const BASE = 'https://old.reddit.com';
const PAGE_DELAY = 3000;

let fetchAllPages; // injected from server.js to avoid circular deps

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Incremental fetch — only pages newer than cutoffTimestamp
// ---------------------------------------------------------------------------
async function fetchNewItems(endpoint, cutoffTimestamp) {
  const items = [];
  let after = null;
  let page = 0;
  const MAX_PAGES = 10;

  while (page < MAX_PAGES) {
    const url = after
      ? `${BASE}${endpoint}?limit=100&sort=new&after=${after}`
      : `${BASE}${endpoint}?limit=100&sort=new`;

    if (page > 0) await sleep(PAGE_DELAY);

    try {
      db.logApiRequest(endpoint);
      const resp = await fetch(url, {
        headers: { 'User-Agent': REDDIT_USER_AGENT }
      });
      if (!resp.ok) break;

      const json = await resp.json();
      const children = json?.data?.children || [];
      if (children.length === 0) break;

      let hitCutoff = false;
      for (const child of children) {
        const item = child.data;
        if (item.created_utc <= cutoffTimestamp) {
          hitCutoff = true;
          break;
        }
        items.push(item);
      }

      if (hitCutoff) break;

      after = json?.data?.after;
      if (!after) break;
    } catch(e) {
      console.error('[Monitor] Fetch error:', e.message);
      break;
    }
    page++;
  }

  return items;
}

// ---------------------------------------------------------------------------
// Main Refresh Logic
// ---------------------------------------------------------------------------
async function refreshUser(username) {
  try {
    console.log(`[Monitor] Refreshing user: ${username}`);
    
    // Fetch profile
    db.logApiRequest(`/user/${username}/about.json`);
    const userRes = await fetch(`${BASE}/user/${username}/about.json`, {
      headers: { 'User-Agent': REDDIT_USER_AGENT }
    });
    let user = null;
    if (userRes.ok) {
      const ujson = await userRes.json();
      if (ujson?.data) {
        user = ujson.data;
        db.upsertUser(user);
        db.insertKarmaSnapshot(user.name, (user.link_karma||0)+(user.comment_karma||0), user.link_karma||0, user.comment_karma||0);
      }
    }

    // Determine cutoff
    const lastPostTime = db.getLatestPostTimestamp(username);
    const lastCommentTime = db.getLatestCommentTimestamp(username);

    // Fetch incrementally
    const newPosts = await fetchNewItems(`/user/${username}/submitted.json`, lastPostTime);
    const newComments = await fetchNewItems(`/user/${username}/comments.json`, lastCommentTime);

    db.upsertPosts(username, newPosts);
    db.upsertComments(username, newComments);

    const newItems = newPosts.length + newComments.length;
    db.updateMonitorCheck(username, newItems);

    // Trigger AI if new items found
    if (newItems > 0) {
      try {
        const posts = db.getUserPosts(username);
        const comments = db.getUserComments(username);
        
        const subMap = {};
        [...posts, ...comments].forEach(item => {
          const sub = item.subreddit || 'unknown';
          subMap[sub] = (subMap[sub] || 0) + 1;
        });
        const subreddits = Object.entries(subMap)
          .map(([name, totalCount]) => ({ name, totalCount }))
          .sort((a, b) => b.totalCount - a.totalCount);
        
        const stats = {
          avgCommentScore: comments.length > 0 ? Math.round(comments.reduce((sum, c) => sum + (c.score || 0), 0) / comments.length) : 0
        };

        const aiReport = ai.generateLocalHeuristicAnalysis(username, { user, posts, comments, subreddits, stats });
        db.saveAIAnalysis(username, 'intelligence', aiReport.content, aiReport.model);
        console.log(`[Monitor] ${username}: Generated heuristic AI report`);
      } catch(err) {
        console.error(`[Monitor] Error generating AI report for ${username}:`, err.message);
      }
    }

    console.log(`[Monitor] ${username}: +${newPosts.length} posts, +${newComments.length} comments (${newItems} new stored)`);
    return newItems;
  } catch(e) {
    console.error(`[Monitor] Error refreshing ${username}:`, e.message);
    db.updateMonitorCheck(username, 0);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Scheduler — check every 5 minutes for users due for refresh
// ---------------------------------------------------------------------------
function startMonitor() {
  console.log('[Monitor] Scheduler started (checking every 5 minutes)');
  
  if (process.env.MY_REDDIT_USERNAME) {
    db.addMonitoredUser(process.env.MY_REDDIT_USERNAME, 60); // Check every 60 minutes
    console.log(`[Monitor] Auto-monitoring personal profile: u/${process.env.MY_REDDIT_USERNAME}`);
  }

  cron.schedule('*/5 * * * *', async () => {
    const dueUsers = db.getUsersDueForCheck();
    if (dueUsers.length === 0) return;

    console.log(`[Monitor] ${dueUsers.length} user(s) due for refresh`);
    for (const user of dueUsers) {
      await refreshUser(user.username);
      await sleep(2000); // pause between users
    }
  });
}

module.exports = { startMonitor, refreshUser };
