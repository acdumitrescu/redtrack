// ============================================================================
// connections.js — User Connection Discovery
// Analyzes who a user replies to by batch-fetching parent comment authors
// ============================================================================

const REDDIT_USER_AGENT = 'RedTrack/2.0 (Open Source Reddit Analyzer)';
const BASE = 'https://old.reddit.com';
const BATCH_SIZE = 100;   // Reddit's /api/info limit
const BATCH_DELAY = 3000; // ms between batches

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Batch fetch Reddit items by fullname IDs
// Returns map of { fullname -> author }
// ---------------------------------------------------------------------------
async function fetchAuthorsForIds(ids) {
  if (!ids || ids.length === 0) return {};
  const authorMap = {};

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const url = `${BASE}/api/info.json?id=${batch.join(',')}`;

    try {
      console.log(`[Connections] Batch fetch ${i / BATCH_SIZE + 1}: ${batch.length} items`);
      const resp = await fetch(url, {
        headers: { 'User-Agent': REDDIT_USER_AGENT }
      });

      if (resp.ok) {
        const json = await resp.json();
        const children = json?.data?.children || [];
        for (const child of children) {
          const d = child.data;
          if (d?.name && d?.author) {
            authorMap[d.name] = d.author;
          }
        }
      }
    } catch(e) {
      console.error('[Connections] Batch fetch error:', e.message);
    }

    if (i + BATCH_SIZE < ids.length) {
      await sleep(BATCH_DELAY);
    }
  }

  return authorMap;
}

// ---------------------------------------------------------------------------
// Build connection graph from a user's comments
// A "connection" = this user replied to someone else's comment
// ---------------------------------------------------------------------------
async function buildConnectionGraph(username, comments) {
  if (!comments || comments.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Collect parent IDs that are comments (t1_ prefix = reply to comment)
  // t3_ prefix = reply to post (skip — post author not easily discoverable here)
  const commentReplies = comments.filter(c =>
    c.parent_id && c.parent_id.startsWith('t1_')
  );

  const parentIds = [...new Set(commentReplies.map(c => c.parent_id))];
  console.log(`[Connections] Analyzing ${commentReplies.length} replies to ${parentIds.length} unique parent comments`);

  // Cap at 500 to stay within reason
  const cappedIds = parentIds.slice(0, 500);
  const authorMap = await fetchAuthorsForIds(cappedIds);

  // Build interaction tally
  const interactionMap = {}; // author -> { count, lastInteraction }
  for (const comment of commentReplies) {
    const parentAuthor = authorMap[comment.parent_id];
    if (!parentAuthor) continue;
    if (parentAuthor === username) continue; // skip self-replies
    if (parentAuthor === '[deleted]') continue;

    if (!interactionMap[parentAuthor]) {
      interactionMap[parentAuthor] = { count: 0, lastInteraction: 0 };
    }
    interactionMap[parentAuthor].count++;
    if (comment.created_utc > interactionMap[parentAuthor].lastInteraction) {
      interactionMap[parentAuthor].lastInteraction = comment.created_utc;
    }
  }

  // Convert to sorted array
  const connections = Object.entries(interactionMap)
    .map(([connectedTo, data]) => ({ connectedTo, ...data }))
    .sort((a, b) => b.count - a.count);

  // Build D3-compatible graph
  const maxCount = connections.length > 0 ? connections[0].count : 1;

  const nodes = [
    {
      id: username,
      label: 'u/' + username,
      weight: maxCount,
      isCenter: true,
      color: '#00ffcc'
    },
    ...connections.slice(0, 50).map(c => ({
      id: c.connectedTo,
      label: 'u/' + c.connectedTo,
      weight: c.count,
      isCenter: false,
      color: getNodeColor(c.count, maxCount)
    }))
  ];

  const edges = connections.slice(0, 50).map(c => ({
    source: username,
    target: c.connectedTo,
    weight: c.count,
    lastInteraction: c.lastInteraction
  }));

  return {
    nodes,
    edges,
    connections, // raw data for DB storage
    totalConnections: connections.length,
    totalInteractions: connections.reduce((s, c) => s + c.count, 0)
  };
}

function getNodeColor(count, maxCount) {
  const ratio = count / maxCount;
  if (ratio >= 0.75) return '#00ffcc'; // neon cyan
  if (ratio >= 0.50) return '#ff00ff'; // magenta
  if (ratio >= 0.25) return '#ffaa00'; // amber
  return '#444444'; // dark grey
}

module.exports = { buildConnectionGraph };
