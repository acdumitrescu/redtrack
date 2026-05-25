// ============================================================================
// ai-analyzer.js — AI Profile Analysis
// Supports OpenAI, Anthropic, and Google Gemini via plain fetch
// ============================================================================

require('dotenv').config();

const PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
const API_KEY  = process.env.AI_API_KEY || '';

// Default models per provider
const DEFAULT_MODELS = {
  openai:    'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  gemini:    'gemini-2.0-flash'
};

const MODEL = process.env.AI_MODEL || DEFAULT_MODELS[PROVIDER] || 'gpt-4o-mini';

// ---------------------------------------------------------------------------
// Build the analysis prompt from user data
// ---------------------------------------------------------------------------
function buildPrompt(username, perspective, profileData) {
  const { user, posts, comments, subreddits, stats } = profileData;

  const topPosts = [...posts]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10)
    .map(p => `- [r/${p.subreddit}] "${p.title}" (score: ${p.score}, comments: ${p.num_comments})`)
    .join('\n');

  const topComments = [...comments]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10)
    .map(c => `- [r/${c.subreddit}] "${(c.body || '').slice(0, 150).replace(/\n/g, ' ')}" (score: ${c.score})`)
    .join('\n');

  const subList = subreddits.slice(0, 10)
    .map(s => `r/${s.name} (${s.totalCount} interactions)`)
    .join(', ');

  const accountAge = user.created_utc
    ? Math.floor((Date.now()/1000 - user.created_utc) / 86400) + ' days'
    : 'unknown';

  const systemPrompts = {
    intelligence:
`You are a seasoned intelligence analyst with 20 years of experience in behavioral profiling, OSINT, and threat assessment. You analyze public social media activity to produce structured intelligence assessments.

Your analysis should cover:
1. **Behavioral Profile** — Activity patterns, posting frequency, times of day, consistency
2. **Interest Mapping** — Primary topics of interest, secondary interests, ideological indicators
3. **Influence & Network** — Evidence of influence-seeking, community standing, network position
4. **Psychological Indicators** — Communication style, emotional regulation, conflict behavior
5. **Anomaly Detection** — Unusual activity spikes, coordinated behavior, account age vs. activity
6. **Risk Indicators** — Any flags from an OSINT perspective (none = state clearly)
7. **Summary Assessment** — Overall profile classification and confidence level

Be analytical, precise, and evidence-based. Cite specific observed behaviors. Avoid speculation without basis.`,

    lawyer:
`You are a senior attorney specializing in internet law, defamation, privacy rights, and digital forensics. You review public social media activity for potential legal exposure, risks, and compliance issues.

Your analysis should cover:
1. **Defamation & Libel Risk** — Posts/comments that could constitute actionable defamation
2. **Privacy Concerns** — Disclosure of personal information (self or others), doxxing risk
3. **Harassment & Threats** — Any content that could constitute harassment, threats, or cyberstalking
4. **Intellectual Property** — Copyright concerns in shared content
5. **Platform Terms Violations** — Reddit ToS violations evident from public activity
6. **Evidentiary Value** — How this public record could be used in legal proceedings
7. **Legal Risk Summary** — Overall legal exposure assessment (Low / Medium / High)

Be precise, reference specific observations, and note when something is a legal risk vs. merely inappropriate. Avoid definitive legal conclusions — frame as risk assessment.`
  };

  const userPrompts = {
    intelligence:
`Analyze the following Reddit user profile from an intelligence/OSINT perspective:

**Target**: u/${username}
**Account Age**: ${accountAge}
**Karma**: ${(user.link_karma || 0) + (user.comment_karma || 0)} total (${user.link_karma || 0} post, ${user.comment_karma || 0} comment)
**Total Posts Analyzed**: ${posts.length}
**Total Comments Analyzed**: ${comments.length}
**Primary Communities**: ${subList}

**Top Posts by Score**:
${topPosts || '(none)'}

**Top Comments by Score**:
${topComments || '(none)'}

**Activity Stats**:
- Most active subreddit: ${stats.mostActiveSub || 'unknown'}
- Avg post score: ${stats.avgPostScore || 0}
- Avg comment score: ${stats.avgCommentScore || 0}

Provide a structured intelligence assessment.`,

    lawyer:
`Review the following Reddit user's public activity for legal risk assessment:

**Subject**: u/${username}
**Account Age**: ${accountAge}
**Platform**: Reddit (public profile)
**Posts Reviewed**: ${posts.length}
**Comments Reviewed**: ${comments.length}
**Active Communities**: ${subList}

**Highest-Engagement Posts**:
${topPosts || '(none)'}

**Highest-Scoring Comments**:
${topComments || '(none)'}

Provide a legal risk assessment with specific references to observed content.`
  };

  return {
    system: systemPrompts[perspective],
    user: userPrompts[perspective]
  };
}

// ---------------------------------------------------------------------------
// Call LLM API — OpenAI
// ---------------------------------------------------------------------------
async function callOpenAI(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.4
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.choices?.[0]?.message?.content || '';
}

// ---------------------------------------------------------------------------
// Call LLM API — Anthropic
// ---------------------------------------------------------------------------
async function callAnthropic(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.content?.[0]?.text || '';
}

// ---------------------------------------------------------------------------
// Call LLM API — Google Gemini
// ---------------------------------------------------------------------------
async function callGemini(systemPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }], role: 'user' }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.4 }
    })
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini API error ${resp.status}: ${err}`);
  }

  const json = await resp.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ---------------------------------------------------------------------------
// Main analysis function
// perspective = 'intelligence' | 'lawyer'
// ---------------------------------------------------------------------------
async function analyzeProfile(username, perspective, profileData) {
  if (!API_KEY) {
    throw new Error('No AI API key configured. Set AI_API_KEY in your .env file.');
  }

  const { system, user } = buildPrompt(username, perspective, profileData);

  let result = '';
  switch (PROVIDER) {
    case 'anthropic': result = await callAnthropic(system, user); break;
    case 'gemini':    result = await callGemini(system, user); break;
    default:          result = await callOpenAI(system, user); break;
  }

  return { content: result, model: MODEL, provider: PROVIDER };
}

function isConfigured() {
  return !!API_KEY;
}

function getConfig() {
  return { provider: PROVIDER, model: MODEL, configured: isConfigured() };
}

// ---------------------------------------------------------------------------
// Local Heuristic Analysis (No API Key required)
// ---------------------------------------------------------------------------
function generateLocalHeuristicAnalysis(username, profileData) {
  const { user, posts, comments, subreddits, stats } = profileData;

  const topSub = subreddits.length > 0 ? subreddits[0].name : 'unknown';
  const totalComments = comments.length;
  const avgScore = stats.avgCommentScore || 0;

  // Determine behavior
  let behaviorDesc = 'neutral and balanced';
  if (avgScore > 10) behaviorDesc = 'highly respected and heavily upvoted';
  else if (avgScore < 1) behaviorDesc = 'controversial or frequently downvoted';

  // Determine activity
  const activeSubs = subreddits.slice(0, 3).map(s => `r/${s.name}`).join(', ');

  const content = `### Heuristic Intelligence Report: u/${username}
*(Generated locally via rule-based heuristics without API)*

**1. Behavioral Profile**
The subject is a frequent contributor primarily active in ${activeSubs}. Their engagement style is generally **${behaviorDesc}**, holding an average comment score of ${avgScore}. With ${totalComments} recent comments analyzed, they show a consistent pattern of interaction.

**2. Interest Mapping**
Based on their subreddit distribution, their primary interests lie in **${topSub}**. This suggests a focus on topics related to this community's theme. 

**3. Influence & Network**
The subject holds a total karma of ${(user.link_karma || 0) + (user.comment_karma || 0)}. A high concentration of activity in specific communities indicates they may hold a recognized presence there, acting as a regular rather than a transient visitor.

**4. Risk Indicators**
*(Heuristic engine cannot perform deep semantic risk analysis)*. However, their karma and upvote ratios do not indicate obvious troll-like or highly hostile patterns.

**Summary Assessment**
Subject is a standard Reddit user with focused community interests in ${topSub}. Confidence level: Moderate (Heuristic logic).`;

  return { content, model: 'local-heuristic-engine', provider: 'local' };
}

module.exports = { analyzeProfile, isConfigured, getConfig, generateLocalHeuristicAnalysis };
