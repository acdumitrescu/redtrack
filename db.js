// ============================================================================
// db.js — RedTrack SQLite Database Layer (sql.js / WASM)
// Persists users, posts, comments, connections, monitors, AI analyses
// ============================================================================

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'redtrack.db');

let db = null;

// ---------------------------------------------------------------------------
// Init — load or create the database
// ---------------------------------------------------------------------------
async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
    console.log('[DB] Loaded existing database from', DB_PATH);
  } else {
    db = new SQL.Database();
    console.log('[DB] Created new database at', DB_PATH);
  }

  createTables();
  setupAutoSave();
  return db;
}

// Save DB to disk — sql.js keeps everything in memory so we must persist
function saveDB() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Auto-save every 5 seconds (reduced from 30s to prevent data loss)
let autoSaveInterval = null;
function setupAutoSave() {
  if (autoSaveInterval) return; // Prevent multiple intervals
  autoSaveInterval = setInterval(saveDB, 5000);
  
  // Also save on process exit (use .once to prevent listener leaks)
  process.once('exit', saveDB);
  process.once('SIGINT', () => { saveDB(); process.exit(0); });
  process.once('SIGTERM', () => { saveDB(); process.exit(0); });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      name TEXT,
      link_karma INTEGER DEFAULT 0,
      comment_karma INTEGER DEFAULT 0,
      total_karma INTEGER DEFAULT 0,
      created_utc INTEGER,
      icon_img TEXT,
      is_gold INTEGER DEFAULT 0,
      is_mod INTEGER DEFAULT 0,
      fetched_at INTEGER NOT NULL,
      raw_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      reddit_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      subreddit TEXT,
      title TEXT,
      selftext TEXT,
      score INTEGER DEFAULT 0,
      upvote_ratio REAL DEFAULT 0,
      num_comments INTEGER DEFAULT 0,
      url TEXT,
      permalink TEXT,
      created_utc INTEGER,
      is_self INTEGER DEFAULT 0,
      over_18 INTEGER DEFAULT 0,
      raw_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      reddit_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      subreddit TEXT,
      body TEXT,
      score INTEGER DEFAULT 0,
      parent_id TEXT,
      link_id TEXT,
      link_title TEXT,
      permalink TEXT,
      created_utc INTEGER,
      raw_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_connections (
      username TEXT NOT NULL,
      connected_to TEXT NOT NULL,
      interaction_count INTEGER DEFAULT 1,
      last_interaction INTEGER,
      PRIMARY KEY (username, connected_to)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS monitored_users (
      username TEXT PRIMARY KEY,
      interval_minutes INTEGER DEFAULT 60,
      added_at INTEGER NOT NULL,
      last_checked INTEGER,
      next_check INTEGER,
      new_items_last_check INTEGER DEFAULT 0,
      total_checks INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ai_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      perspective TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS karma_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      total_karma INTEGER,
      link_karma INTEGER,
      comment_karma INTEGER,
      snapped_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS live_taps (
      subreddit TEXT PRIMARY KEY,
      tapped_at INTEGER NOT NULL,
      last_checked INTEGER,
      next_check INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tapped_posts (
      reddit_id TEXT PRIMARY KEY,
      subreddit TEXT NOT NULL,
      title TEXT,
      created_utc INTEGER,
      status TEXT DEFAULT 'monitoring',
      num_comments INTEGER DEFAULT 0,
      summary TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      endpoint TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  // Indexes for performance
  db.run(`CREATE INDEX IF NOT EXISTS idx_posts_username ON posts(username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(username, created_utc DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_comments_username ON comments(username)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(username, created_utc DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_ai_username ON ai_analyses(username, perspective)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_karma_snaps ON karma_snapshots(username, snapped_at DESC)`);

  saveDB();
  console.log('[DB] Tables ready');
}

// ---------------------------------------------------------------------------
// Helper — run SELECT and return rows as array of objects
// ---------------------------------------------------------------------------
function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  db.run(sql, params);
}

// ---------------------------------------------------------------------------
// User Profile
// ---------------------------------------------------------------------------
function upsertUser(userData) {
  const now = Math.floor(Date.now() / 1000);
  run(`
    INSERT INTO users (username, name, link_karma, comment_karma, total_karma,
      created_utc, icon_img, is_gold, is_mod, fetched_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      link_karma = excluded.link_karma,
      comment_karma = excluded.comment_karma,
      total_karma = excluded.total_karma,
      icon_img = excluded.icon_img,
      is_gold = excluded.is_gold,
      is_mod = excluded.is_mod,
      fetched_at = excluded.fetched_at,
      raw_json = excluded.raw_json
  `, [
    userData.name,
    userData.name,
    userData.link_karma || 0,
    userData.comment_karma || 0,
    (userData.link_karma || 0) + (userData.comment_karma || 0),
    userData.created_utc || 0,
    userData.icon_img || '',
    userData.is_gold ? 1 : 0,
    userData.is_mod ? 1 : 0,
    now,
    JSON.stringify(userData)
  ]);
  saveDB();
}

function getUser(username) {
  const row = queryOne('SELECT * FROM users WHERE username = ? COLLATE NOCASE', [username]);
  if (row && row.raw_json) {
    try { row.parsed = JSON.parse(row.raw_json); } catch(e) {}
  }
  return row;
}

function getAllUsers() {
  return query('SELECT username, name, link_karma, comment_karma, total_karma, created_utc, fetched_at FROM users ORDER BY fetched_at DESC');
}

// ---------------------------------------------------------------------------
// Karma Snapshots
// ---------------------------------------------------------------------------
function insertKarmaSnapshot(username, total, link, comment) {
  const now = Math.floor(Date.now() / 1000);
  
  // Get last snapshot
  const lastSnap = queryOne('SELECT * FROM karma_snapshots WHERE username = ? ORDER BY snapped_at DESC LIMIT 1', [username]);
  
  // Deduplicate: Only insert if it's been more than an hour OR karma changed
  if (lastSnap) {
    const isSameKarma = lastSnap.total_karma === total;
    const isRecent = (now - lastSnap.snapped_at) < 3600; // 1 hour
    
    if (isSameKarma && isRecent) {
      return; // Skip insertion
    }
  }

  run(`
    INSERT INTO karma_snapshots (username, total_karma, link_karma, comment_karma, snapped_at)
    VALUES (?, ?, ?, ?, ?)
  `, [username, total, link, comment, now]);
}

function getKarmaSnapshots(username) {
  return query('SELECT * FROM karma_snapshots WHERE username = ? ORDER BY snapped_at DESC LIMIT 100', [username]);
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------
function upsertPosts(username, posts) {
  if (!posts || posts.length === 0) return 0;
  let inserted = 0;
  for (const p of posts) {
    try {
      run(`
        INSERT OR IGNORE INTO posts (
          reddit_id, username, subreddit, title, selftext, score, upvote_ratio,
          num_comments, url, permalink, created_utc, is_self, over_18, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        p.id,
        username,
        p.subreddit || '',
        p.title || '',
        p.selftext || '',
        p.score || 0,
        p.upvote_ratio || 0,
        p.num_comments || 0,
        p.url || '',
        p.permalink || '',
        p.created_utc || 0,
        p.is_self ? 1 : 0,
        p.over_18 ? 1 : 0,
        JSON.stringify(p)
      ]);
      inserted++;
    } catch(e) {
      // Duplicate — skip
    }
  }
  if (inserted > 0) saveDB();
  return inserted;
}

function getUserPosts(username) {
  return query('SELECT * FROM posts WHERE username = ? COLLATE NOCASE ORDER BY created_utc DESC', [username]);
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------
function upsertComments(username, comments) {
  if (!comments || comments.length === 0) return 0;
  let inserted = 0;
  for (const c of comments) {
    try {
      run(`
        INSERT OR IGNORE INTO comments (
          reddit_id, username, subreddit, body, score, parent_id,
          link_id, link_title, permalink, created_utc, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        c.id,
        username,
        c.subreddit || '',
        c.body || '',
        c.score || 0,
        c.parent_id || '',
        c.link_id || '',
        c.link_title || '',
        c.permalink || '',
        c.created_utc || 0,
        JSON.stringify(c)
      ]);
      inserted++;
    } catch(e) {}
  }
  if (inserted > 0) saveDB();
  return inserted;
}

function getUserComments(username) {
  return query('SELECT * FROM comments WHERE username = ? COLLATE NOCASE ORDER BY created_utc DESC', [username]);
}

// ---------------------------------------------------------------------------
// Incremental fetch — get the most recent created_utc stored
// ---------------------------------------------------------------------------
function getLatestPostTimestamp(username) {
  const postTs = queryOne(
    'SELECT created_utc as ts FROM posts WHERE username = ? COLLATE NOCASE ORDER BY created_utc DESC LIMIT 1',
    [username]
  );
  return postTs?.ts || 0;
}

function getLatestCommentTimestamp(username) {
  const commentTs = queryOne(
    'SELECT created_utc as ts FROM comments WHERE username = ? COLLATE NOCASE ORDER BY created_utc DESC LIMIT 1',
    [username]
  );
  return commentTs?.ts || 0;
}

function getPostCount(username) {
  const r = queryOne('SELECT COUNT(*) as cnt FROM posts WHERE username = ? COLLATE NOCASE', [username]);
  return r?.cnt || 0;
}

function getCommentCount(username) {
  const r = queryOne('SELECT COUNT(*) as cnt FROM comments WHERE username = ? COLLATE NOCASE', [username]);
  return r?.cnt || 0;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------
function saveConnections(username, connections) {
  // connections = [{ connectedTo, count, lastInteraction }]
  for (const c of connections) {
    run(`
      INSERT INTO user_connections (username, connected_to, interaction_count, last_interaction)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(username, connected_to) DO UPDATE SET
        interaction_count = excluded.interaction_count,
        last_interaction = excluded.last_interaction
    `, [username, c.connectedTo, c.count, c.lastInteraction]);
  }
  saveDB();
}

function getConnections(username) {
  return query(
    'SELECT connected_to, interaction_count, last_interaction FROM user_connections WHERE username = ? COLLATE NOCASE ORDER BY interaction_count DESC',
    [username]
  );
}

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------
function addMonitoredUser(username, intervalMinutes = 60) {
  const now = Math.floor(Date.now() / 1000);
  run(`
    INSERT INTO monitored_users (username, interval_minutes, added_at, next_check, is_active)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(username) DO UPDATE SET
      interval_minutes = excluded.interval_minutes,
      next_check = excluded.next_check,
      is_active = 1
  `, [username, intervalMinutes, now, now + intervalMinutes * 60]);
  saveDB();
}

function removeMonitoredUser(username) {
  run(`UPDATE monitored_users SET is_active = 0 WHERE username = ? COLLATE NOCASE`, [username]);
  saveDB();
}

function getMonitoredUsers() {
  return query('SELECT * FROM monitored_users WHERE is_active = 1 ORDER BY added_at DESC');
}

function getUsersDueForCheck() {
  const now = Math.floor(Date.now() / 1000);
  return query(
    'SELECT * FROM monitored_users WHERE is_active = 1 AND (next_check IS NULL OR next_check <= ?)',
    [now]
  );
}

function updateMonitorCheck(username, newItemsCount) {
  const row = queryOne('SELECT * FROM monitored_users WHERE username = ? COLLATE NOCASE', [username]);
  if (!row) return;
  const now = Math.floor(Date.now() / 1000);
  const next = now + (row.interval_minutes || 60) * 60;
  run(`
    UPDATE monitored_users
    SET last_checked = ?, next_check = ?, new_items_last_check = ?, total_checks = total_checks + 1
    WHERE username = ? COLLATE NOCASE
  `, [now, next, newItemsCount, username]);
  saveDB();
}

function isMonitored(username) {
  const r = queryOne(
    'SELECT is_active FROM monitored_users WHERE username = ? COLLATE NOCASE',
    [username]
  );
  return r && r.is_active === 1;
}

// ---------------------------------------------------------------------------
// AI Analyses
// ---------------------------------------------------------------------------
function saveAIAnalysis(username, perspective, content, model) {
  const now = Math.floor(Date.now() / 1000);
  run(`
    DELETE FROM ai_analyses WHERE username = ? COLLATE NOCASE AND perspective = ?
  `, [username, perspective]);
  run(`
    INSERT INTO ai_analyses (username, perspective, content, model, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [username, perspective, content, model || '', now]);
  saveDB();
}

function getAIAnalyses(username) {
  return query(
    'SELECT * FROM ai_analyses WHERE username = ? COLLATE NOCASE ORDER BY created_at DESC',
    [username]
  );
}

// ---------------------------------------------------------------------------
// DB stats
// ---------------------------------------------------------------------------
function getDBStats() {
  const users = queryOne('SELECT COUNT(*) as cnt FROM users');
  const posts = queryOne('SELECT COUNT(*) as cnt FROM posts');
  const comments = queryOne('SELECT COUNT(*) as cnt FROM comments');
  const monitored = queryOne('SELECT COUNT(*) as cnt FROM monitored_users WHERE is_active = 1');
  return {
    users: users?.cnt || 0,
    posts: posts?.cnt || 0,
    comments: comments?.cnt || 0,
    monitored: monitored?.cnt || 0,
    dbPath: DB_PATH
  };
}

// ---------------------------------------------------------------------------
// Subreddit Live Taps
// ---------------------------------------------------------------------------
function addLiveTap(subreddit) {
  const now = Math.floor(Date.now() / 1000);
  // Only insert if not exists to avoid resetting tapped_at
  const existing = queryOne('SELECT * FROM live_taps WHERE subreddit = ? COLLATE NOCASE', [subreddit]);
  if (!existing) {
    run(`INSERT INTO live_taps (subreddit, tapped_at, last_checked, next_check) VALUES (?, ?, ?, ?)`, 
      [subreddit, now, 0, now]);
    saveDB();
  }
}

function removeLiveTap(subreddit) {
  run(`DELETE FROM live_taps WHERE subreddit = ? COLLATE NOCASE`, [subreddit]);
  // Also clean up active posts for this sub to stop deep diving
  run(`UPDATE tapped_posts SET status = 'dropped' WHERE subreddit = ? COLLATE NOCASE AND status = 'monitoring'`, [subreddit]);
  saveDB();
}

function getLiveTaps() {
  return query('SELECT * FROM live_taps ORDER BY tapped_at DESC');
}

function getTapsDueForCheck() {
  const now = Math.floor(Date.now() / 1000);
  return query('SELECT * FROM live_taps WHERE next_check <= ?', [now]);
}

function updateLiveTapCheck(subreddit) {
  const now = Math.floor(Date.now() / 1000);
  const next = now + 3600; // Check subreddits every 1 hour
  run(`UPDATE live_taps SET last_checked = ?, next_check = ? WHERE subreddit = ? COLLATE NOCASE`, [now, next, subreddit]);
  saveDB();
}

function insertTappedPosts(subreddit, posts) {
  let inserted = 0;
  for (const p of posts) {
    try {
      const startChanges = db.getRowsModified();
      run(`
        INSERT OR IGNORE INTO tapped_posts (reddit_id, subreddit, title, created_utc)
        VALUES (?, ?, ?, ?)
      `, [p.id || p.name, subreddit, p.title, p.created_utc]);
      if (db.getRowsModified() > startChanges) {
        inserted++;
      }
    } catch(e) {
      console.error('[RedTrack DB] Error inserting tapped post:', e.message);
    }
  }
  if (inserted > 0) saveDB();
  return inserted;
}

function getActiveTappedPosts() {
  return query(`SELECT * FROM tapped_posts WHERE status = 'monitoring'`);
}

function getTappedPostsBySub(subreddit) {
  return query(`SELECT * FROM tapped_posts WHERE subreddit = ? COLLATE NOCASE ORDER BY created_utc DESC`, [subreddit]);
}

function updateTappedPostStatus(reddit_id, status, num_comments = 0, summary = null) {
  if (summary) {
    run(`UPDATE tapped_posts SET status = ?, num_comments = ?, summary = ? WHERE reddit_id = ?`, [status, num_comments, summary, reddit_id]);
  } else {
    run(`UPDATE tapped_posts SET status = ?, num_comments = ? WHERE reddit_id = ?`, [status, num_comments, reddit_id]);
  }
  saveDB();
}

// ---------------------------------------------------------------------------
// API Request Tracking
// ---------------------------------------------------------------------------
function logApiRequest(endpoint) {
  const now = Math.floor(Date.now() / 1000);
  run('INSERT INTO api_requests (endpoint, timestamp) VALUES (?, ?)', [endpoint, now]);
}

function getRecentApiRequestCount(hours = 6) {
  const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
  const row = queryOne('SELECT COUNT(*) as count FROM api_requests WHERE timestamp >= ?', [cutoff]);
  return row ? row.count : 0;
}

module.exports = {
  initDB, saveDB,
  upsertUser, getUser, getAllUsers,
  insertKarmaSnapshot, getKarmaSnapshots,
  upsertPosts, getUserPosts, getPostCount,
  upsertComments, getUserComments, getCommentCount,
  getLatestPostTimestamp, getLatestCommentTimestamp,
  saveConnections, getConnections,
  addMonitoredUser, removeMonitoredUser, getMonitoredUsers,
  getUsersDueForCheck, updateMonitorCheck, isMonitored,
  saveAIAnalysis, getAIAnalyses,
  getDBStats,
  addLiveTap, removeLiveTap, getLiveTaps, getTapsDueForCheck, updateLiveTapCheck,
  insertTappedPosts, getActiveTappedPosts, getTappedPostsBySub, updateTappedPostStatus,
  logApiRequest, getRecentApiRequestCount
};
