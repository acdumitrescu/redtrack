// ============================================================================
// analysis.js — RedTrack Data Analysis Module
// All functions are global (no ES modules). Operates on Reddit post/comment
// objects returned by the Reddit JSON API.
// ============================================================================

// ---------------------------------------------------------------------------
// Subreddit Analysis
// ---------------------------------------------------------------------------

/**
 * Aggregates activity across subreddits from posts and comments.
 * @param {Array} posts  - Post objects with { subreddit, score, … }
 * @param {Array} comments - Comment objects with { subreddit, score, … }
 * @returns {Array} Sorted (desc) by totalCount:
 *   [{ name, postCount, commentCount, totalCount, avgScore }]
 */
function analyzeSubreddits(posts, comments) {
  const map = {}; // subreddit -> { postCount, commentCount, totalScore }

  (posts || []).forEach(function (p) {
    const sub = p.subreddit || 'unknown';
    if (!map[sub]) map[sub] = { postCount: 0, commentCount: 0, totalScore: 0 };
    map[sub].postCount += 1;
    map[sub].totalScore += (p.score || 0);
  });

  (comments || []).forEach(function (c) {
    const sub = c.subreddit || 'unknown';
    if (!map[sub]) map[sub] = { postCount: 0, commentCount: 0, totalScore: 0 };
    map[sub].commentCount += 1;
    map[sub].totalScore += (c.score || 0);
  });

  return Object.keys(map)
    .map(function (name) {
      var d = map[name];
      var totalCount = d.postCount + d.commentCount;
      return {
        name: name,
        postCount: d.postCount,
        commentCount: d.commentCount,
        totalCount: totalCount,
        avgScore: totalCount > 0 ? Math.round((d.totalScore / totalCount) * 10) / 10 : 0
      };
    })
    .sort(function (a, b) { return b.totalCount - a.totalCount; });
}

// ---------------------------------------------------------------------------
// Hourly Activity
// ---------------------------------------------------------------------------

/**
 * Counts combined post + comment activity per UTC hour (0-23).
 * @param {Array} posts
 * @param {Array} comments
 * @returns {number[]} Array of 24 numbers (index = UTC hour)
 */
function analyzeHourlyActivity(posts, comments) {
  var hours = new Array(24);
  for (var i = 0; i < 24; i++) hours[i] = 0;

  function count(items) {
    (items || []).forEach(function (item) {
      var d = new Date(item.created_utc * 1000);
      hours[d.getUTCHours()] += 1;
    });
  }

  count(posts);
  count(comments);
  return hours;
}

// ---------------------------------------------------------------------------
// Karma Timeline
// ---------------------------------------------------------------------------

/**
 * Builds a cumulative karma timeline grouped by day.
 * @param {Array} posts
 * @param {Array} comments
 * @returns {Array} [{ date: 'YYYY-MM-DD', cumulativeKarma: N }]
 */
function analyzeKarmaTimeline(posts, comments) {
  // Merge both sets into a single array with score + timestamp
  var items = [];

  (posts || []).forEach(function (p) {
    items.push({ score: p.score || 0, created_utc: p.created_utc });
  });
  (comments || []).forEach(function (c) {
    items.push({ score: c.score || 0, created_utc: c.created_utc });
  });

  // Sort ascending by timestamp
  items.sort(function (a, b) { return a.created_utc - b.created_utc; });

  // Group by day
  var dayMap = {};   // 'YYYY-MM-DD' -> total score that day
  var dayOrder = []; // ordered unique day keys

  items.forEach(function (item) {
    var d = new Date(item.created_utc * 1000);
    var key = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');

    if (!(key in dayMap)) {
      dayMap[key] = 0;
      dayOrder.push(key);
    }
    dayMap[key] += item.score;
  });

  // Build cumulative series
  var cumulative = 0;
  return dayOrder.map(function (key) {
    cumulative += dayMap[key];
    return { date: key, cumulativeKarma: cumulative };
  });
}

// ---------------------------------------------------------------------------
// Activity Heatmap (last 365 days)
// ---------------------------------------------------------------------------

/**
 * Generates daily activity counts for the last 365 days.
 * @param {Array} posts
 * @param {Array} comments
 * @returns {{ cells: Array<{ date: string, count: number }>, maxCount: number }}
 */
function analyzeActivityHeatmap(posts, comments) {
  var now = new Date();
  // Start of "today" in UTC
  var todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  var msPerDay = 86400000;
  var startUTC = todayUTC - 364 * msPerDay; // 365 days including today

  // Initialise day buckets
  var dayBuckets = {}; // 'YYYY-MM-DD' -> count
  for (var i = 0; i < 365; i++) {
    var d = new Date(startUTC + i * msPerDay);
    var key = d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
    dayBuckets[key] = 0;
  }

  // Count activity
  function tally(items) {
    (items || []).forEach(function (item) {
      var ts = item.created_utc * 1000;
      if (ts < startUTC || ts > todayUTC + msPerDay) return;
      var dd = new Date(ts);
      var k = dd.getUTCFullYear() + '-' +
        String(dd.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(dd.getUTCDate()).padStart(2, '0');
      if (k in dayBuckets) dayBuckets[k] += 1;
    });
  }
  tally(posts);
  tally(comments);

  // Build ordered cells array
  var cells = [];
  var maxCount = 0;
  var sortedKeys = Object.keys(dayBuckets).sort();
  sortedKeys.forEach(function (key) {
    var count = dayBuckets[key];
    cells.push({ date: key, count: count });
    if (count > maxCount) maxCount = count;
  });

  return { cells: cells, maxCount: maxCount };
}

// ---------------------------------------------------------------------------
// Writing Style Analysis
// ---------------------------------------------------------------------------

/**
 * Analyses the writing style of a user's comments.
 * @param {Array} comments - Comment objects with `body` (markdown text)
 * @returns {{ avgWordCount: number, vocabularySize: number,
 *             topWords: Array<{ word: string, count: number }>,
 *             avgSentiment: 'positive'|'neutral'|'negative' }}
 */
function analyzeWritingStyle(comments) {
  // Stop words to exclude from frequency counts
  var STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'it', 'to', 'for', 'of', 'in', 'on', 'at',
    'and', 'or', 'but', 'i', 'my', 'me', 'we', 'you', 'he', 'she', 'they',
    'this', 'that', 'with', 'from', 'was', 'were', 'are', 'been', 'be',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'not', 'no', 'so', 'if', 'as', 'just', 'like', 'about',
    'what', 'which', 'who', 'how', 'when', 'where', 'why', 'than', 'then',
    'also', 'very', 'more', 'much', 'most', 'only', 'other', 'into',
    'some', 'its', 'can', 'all', 'your', 'their', 'our'
  ]);

  var POSITIVE_WORDS = new Set([
    'great', 'awesome', 'love', 'amazing', 'excellent', 'fantastic',
    'wonderful', 'perfect', 'best', 'good', 'happy', 'helpful', 'thanks',
    'thank', 'recommend', 'enjoy', 'beautiful', 'incredible'
  ]);

  var NEGATIVE_WORDS = new Set([
    'terrible', 'awful', 'hate', 'worst', 'bad', 'horrible', 'disgusting',
    'disappointed', 'poor', 'waste', 'ugly', 'stupid', 'annoying', 'boring',
    'useless', 'sucks', 'trash', 'garbage'
  ]);

  var totalWordCount = 0;
  var wordFreq = {};       // word -> count
  var uniqueWords = new Set();
  var positiveCount = 0;
  var negativeCount = 0;

  (comments || []).forEach(function (c) {
    var body = (c.body || '').toLowerCase();
    // Strip markdown links, inline code, URLs
    body = body.replace(/https?:\/\/\S+/g, '');
    body = body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    body = body.replace(/`[^`]*`/g, '');

    // Tokenise: keep only letters and apostrophes inside words
    var words = body.match(/[a-z']+/g) || [];
    totalWordCount += words.length;

    words.forEach(function (w) {
      // Trim leading/trailing apostrophes
      w = w.replace(/^'+|'+$/g, '');
      if (w.length < 2) return;

      uniqueWords.add(w);

      // Sentiment
      if (POSITIVE_WORDS.has(w)) positiveCount++;
      if (NEGATIVE_WORDS.has(w)) negativeCount++;

      // Frequency (excluding stop words)
      if (!STOP_WORDS.has(w)) {
        wordFreq[w] = (wordFreq[w] || 0) + 1;
      }
    });
  });

  // Top 20 words
  var topWords = Object.keys(wordFreq)
    .map(function (w) { return { word: w, count: wordFreq[w] }; })
    .sort(function (a, b) { return b.count - a.count; })
    .slice(0, 20);

  // Sentiment determination
  var avgSentiment = 'neutral';
  if (positiveCount > negativeCount * 1.5) {
    avgSentiment = 'positive';
  } else if (negativeCount > positiveCount * 1.5) {
    avgSentiment = 'negative';
  }

  var commentCount = (comments || []).length;

  return {
    avgWordCount: commentCount > 0 ? Math.round(totalWordCount / commentCount) : 0,
    vocabularySize: uniqueWords.size,
    topWords: topWords,
    avgSentiment: avgSentiment
  };
}

// ---------------------------------------------------------------------------
// Engagement Analysis
// ---------------------------------------------------------------------------

/**
 * Analyses engagement metrics for a user's posts.
 * @param {Array} posts - Post objects
 * @returns {{ avgUpvoteRatio: number, commentToPostRatio: number,
 *             controversialPosts: number, avgScore: number,
 *             medianScore: number, totalUpvotes: number }}
 */
function analyzeEngagement(posts) {
  if (!posts || posts.length === 0) {
    return {
      avgUpvoteRatio: 0,
      commentToPostRatio: 0,
      controversialPosts: 0,
      avgScore: 0,
      medianScore: 0,
      totalUpvotes: 0
    };
  }

  var totalScore = 0;
  var totalComments = 0;
  var totalUpvoteRatio = 0;
  var controversial = 0;
  var scores = [];
  var totalUpvotes = 0;

  posts.forEach(function (p) {
    var score = p.score || 0;
    var numComments = p.num_comments || 0;

    totalScore += score;
    totalComments += numComments;
    scores.push(score);
    totalUpvotes += score; // score ≈ net upvotes

    // Upvote ratio: prefer the field, fall back to ups/downs calculation
    if (typeof p.upvote_ratio === 'number') {
      totalUpvoteRatio += p.upvote_ratio;
    } else if (typeof p.ups === 'number' && typeof p.downs === 'number') {
      var total = p.ups + p.downs;
      totalUpvoteRatio += total > 0 ? p.ups / total : 0;
    } else {
      totalUpvoteRatio += 0;
    }

    // Controversial: score < 1 OR (num_comments > score*2 AND num_comments > 5)
    if (score < 1 || (numComments > score * 2 && numComments > 5)) {
      controversial++;
    }
  });

  // Median score
  scores.sort(function (a, b) { return a - b; });
  var mid = Math.floor(scores.length / 2);
  var medianScore = scores.length % 2 !== 0
    ? scores[mid]
    : Math.round(((scores[mid - 1] + scores[mid]) / 2) * 10) / 10;

  var n = posts.length;
  return {
    avgUpvoteRatio: Math.round((totalUpvoteRatio / n) * 100) / 100,
    commentToPostRatio: Math.round((totalComments / n) * 10) / 10,
    controversialPosts: controversial,
    avgScore: Math.round((totalScore / n) * 10) / 10,
    medianScore: medianScore,
    totalUpvotes: totalUpvotes
  };
}

// ---------------------------------------------------------------------------
// Formatting Utilities
// ---------------------------------------------------------------------------

/**
 * Formats a number for display (1 200 -> '1.2K', 1 500 000 -> '1.5M').
 * @param {number} num
 * @returns {string}
 */
function formatNumber(num) {
  if (num === null || num === undefined) return '0';
  if (Math.abs(num) >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (Math.abs(num) >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return String(num);
}

/**
 * Converts a Unix timestamp to 'MMM DD, YYYY' (e.g., 'Jan 15, 2024').
 * @param {number} utcTimestamp - Unix epoch seconds
 * @returns {string}
 */
function formatDate(utcTimestamp) {
  var MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  var d = new Date(utcTimestamp * 1000);
  return MONTHS[d.getUTCMonth()] + ' ' +
    String(d.getUTCDate()).padStart(2, '0') + ', ' +
    d.getUTCFullYear();
}

/**
 * Returns a human-readable "time ago" string from a Unix timestamp.
 * @param {number} utcTimestamp - Unix epoch seconds
 * @returns {string} e.g. '2 days ago', '3 months ago'
 */
function timeAgo(utcTimestamp) {
  var now = Date.now() / 1000; // current time in seconds
  var diff = Math.max(0, now - utcTimestamp);

  var minute = 60;
  var hour = 3600;
  var day = 86400;
  var month = 2592000;  // ~30 days
  var year = 31536000;  // ~365 days

  if (diff < minute) return 'just now';
  if (diff < hour) {
    var m = Math.floor(diff / minute);
    return m + (m === 1 ? ' minute ago' : ' minutes ago');
  }
  if (diff < day) {
    var h = Math.floor(diff / hour);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  if (diff < month) {
    var d = Math.floor(diff / day);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }
  if (diff < year) {
    var mo = Math.floor(diff / month);
    return mo + (mo === 1 ? ' month ago' : ' months ago');
  }
  var y = Math.floor(diff / year);
  return y + (y === 1 ? ' year ago' : ' years ago');
}

// ---------------------------------------------------------------------------
// Word Index
// ---------------------------------------------------------------------------
var STOP_WORDS_SET = new Set([
  // English
  'the','a','an','is','it','to','for','of','in','on','at','and','or','but','i','my','me','we','you','he','she','they','this','that','with','from','was','were','are','been','be','have','has','had','do','does','did','will','would','could','should','not','no','so','if','as','just','like','about','what','which','who','how','when','where','why','than','then','also','very','more','much','most','only','other','into','some','its','can','all','your','their','our','up','out','get','got','one','two','there','here','know','think','good','new','time','re','ve','ll','don','gt','amp',
  // Romanian
  'si','și','in','în','la','de','cu','o','un','sa','să','pe','a','al','ai','ale','au','din','care','pentru','este','e','nu','mai','ca','că','sunt','cel','cea','cei','cele','dar','sau','se','el','ea','ei','ele','lui','lor','cum','ce','cand','când','unde','cine','tot','fost','fata','fața','daca','dacă','asa','așa','acolo','aici','nici','deja','doar','prea','foarte','bine','chiar','poate','fara','fără','prin','peste','sub','intr','dintr','printr','f','am','are','ati','ați','avem','fi','fiu','fie','fii','fim','fiti','fiți','ba','da','iar','niciodata','mereu',
  // Added from user request
  'asta', 'ii', 'ar', 'acum', 'le', 'ul', 'face', 'te', 'aia'
]);

function buildWordIndex(comments) {
  var idx = {};
  (comments || []).forEach(function(c) {
    var body = (c.body || '').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/`[^`]*`/g,'');
    var words = body.match(/[a-z']+/g) || [];
    var seen = new Set();
    words.forEach(function(w) {
      w = w.replace(/^'+|'+$/g,'');
      if (w.length < 2 || STOP_WORDS_SET.has(w)) return;
      if (!idx[w]) idx[w] = { count:0, comments:[], firstUsed:c.created_utc||0, lastUsed:0 };
      idx[w].count++;
      if (!seen.has(w)) {
        seen.add(w);
        idx[w].comments.push({ id:c.reddit_id||c.id, body:(c.body||'').slice(0,200), subreddit:c.subreddit, score:c.score, date:c.created_utc, permalink:c.permalink });
      }
      if (c.created_utc > idx[w].lastUsed) idx[w].lastUsed = c.created_utc;
      if (c.created_utc && c.created_utc < idx[w].firstUsed) idx[w].firstUsed = c.created_utc;
    });
  });
  return idx;
}

function searchWords(wordIndex, query, limit) {
  limit = limit || 100;
  var entries = Object.keys(wordIndex).map(function(w){ return Object.assign({word:w}, wordIndex[w]); });
  if (query && query.trim()) { var q = query.trim().toLowerCase(); entries = entries.filter(function(e){ return e.word.indexOf(q) !== -1; }); }
  return entries.sort(function(a,b){ return b.count-a.count; }).slice(0, limit);
}

function getWordTimeline(wordIndex, word) {
  var entry = wordIndex[word.toLowerCase()];
  if (!entry) return [];
  var buckets = {};
  entry.comments.forEach(function(c) {
    if (!c.date) return;
    var d = new Date(c.date*1000);
    var k = d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
    buckets[k] = (buckets[k]||0) + 1;
  });
  return Object.keys(buckets).sort().map(function(k){ return {date:k, count:buckets[k]}; });
}

function getMostLiked(posts, comments, limit) {
  limit = limit||25;
  var combined = [
    ...(posts || []).map(function(p){ return Object.assign({type:'post'}, p); }),
    ...(comments || []).map(function(c){ return Object.assign({type:'comment'}, c); })
  ].sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0, limit);
  return {
    posts: [...(posts||[])].sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0,limit),
    comments: [...(comments||[])].sort(function(a,b){ return (b.score||0)-(a.score||0); }).slice(0,limit),
    combined: combined
  };
}

function getMostDisliked(posts, comments, limit) {
  limit = limit||25;
  var combined = [
    ...(posts || []).map(function(p){ return Object.assign({type:'post'}, p); }),
    ...(comments || []).map(function(c){ return Object.assign({type:'comment'}, c); })
  ].sort(function(a,b){ return (a.score||0)-(b.score||0); }).slice(0, limit);
  return {
    posts: [...(posts||[])].sort(function(a,b){ return (a.score||0)-(b.score||0); }).slice(0,limit),
    comments: [...(comments||[])].sort(function(a,b){ return (a.score||0)-(b.score||0); }).slice(0,limit),
    combined: combined
  };
}
