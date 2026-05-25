// ============================================================================
// app.js — RedTrack V2 Orchestrator
// Handles UI state, API fetching, and chart/table rendering
// ============================================================================

(function() {
  'use strict';

  // State
  var state = {
    username: '',
    profile: null,
    posts: [],
    comments: [],
    connections: null,
    aiAnalyses: [],
    wordIndex: null,
    monitoredUsers: [],
    isMonitored: false
  };

  // DOM Elements
  var els = {
    searchBtn: document.getElementById('search-btn'),
    searchInput: document.getElementById('search-input'),
    forceRefresh: document.getElementById('force-refresh-cb'),
    hintBtns: document.querySelectorAll('.hint-btn'),
    heroSection: document.getElementById('hero-section'),
    dashboard: document.getElementById('dashboard'),
    loadingOverlay: document.getElementById('loading-overlay'),
    loaderStatus: document.getElementById('loader-status'),
    loaderProgressBar: document.getElementById('loader-progress-bar'),
    errorBanner: document.getElementById('error-banner'),
    errorMessage: document.getElementById('error-message'),
    errorClose: document.getElementById('error-close'),
    cacheIndicator: document.getElementById('cache-indicator'),

    // Modals & Header
    showMonitorsBtn: document.getElementById('show-monitors-btn'),
    monitorsModal: document.getElementById('monitors-modal'),
    closeMonitorsBtn: document.getElementById('close-monitors-btn'),
    monitorsList: document.getElementById('monitors-list'),

    // Profile
    username: document.getElementById('profile-username'),
    avatar: document.getElementById('profile-avatar'),
    created: document.getElementById('profile-created'),
    karma: document.getElementById('profile-karma'),
    linkKarma: document.getElementById('profile-link-karma'),
    commentKarma: document.getElementById('profile-comment-karma'),
    age: document.getElementById('profile-age'),
    monitorToggleBtn: document.getElementById('monitor-toggle-btn'),
    monitorBtnText: document.getElementById('monitor-btn-text'),

    // Stats
    statPosts: document.getElementById('stat-total-posts'),
    statComments: document.getElementById('stat-total-comments'),
    statAvgPostScore: document.getElementById('stat-avg-post-score'),
    statAvgCommentScore: document.getElementById('stat-avg-comment-score'),
    statMostActiveSub: document.getElementById('stat-most-active-sub'),
    statPostFrequency: document.getElementById('stat-post-frequency'),

    // Graph
    btnRefreshGraph: document.getElementById('btn-refresh-graph'),
    btnMaximizeGraph: document.getElementById('btn-maximize-graph'),
    
    // AI
    aiModelInfo: document.getElementById('ai-model-info'),
    btnGenerateIntel: document.getElementById('btn-generate-intel'),
    btnGenerateLawyer: document.getElementById('btn-generate-lawyer'),
    aiIntelContent: document.getElementById('ai-intel-content'),
    aiLawyerContent: document.getElementById('ai-lawyer-content'),
    aiIntelPlaceholder: document.getElementById('ai-intel-placeholder'),
    aiLawyerPlaceholder: document.getElementById('ai-lawyer-placeholder'),

    // Text Explorer
    wordSearch: document.getElementById('word-search'),
    wordList: document.getElementById('word-list'),
    selectedWordTitle: document.getElementById('selected-word-title'),
    wordContexts: document.getElementById('word-contexts'),

    // Tables
    likedBody: document.getElementById('liked-body'),
    dislikedBody: document.getElementById('disliked-body')
  };

  // Bind Events
  els.searchBtn.addEventListener('click', handleSearch);
  els.searchInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleSearch(); });
  els.errorClose.addEventListener('click', hideError);
  els.hintBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      els.searchInput.value = e.target.dataset.username;
      handleSearch();
    });
  });

  // Modals
  els.showMonitorsBtn.addEventListener('click', loadMonitors);
  els.closeMonitorsBtn.addEventListener('click', function() { els.monitorsModal.classList.remove('active'); });
  els.monitorToggleBtn.addEventListener('click', toggleMonitor);

  // Tabs
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      var targetId = e.currentTarget.dataset.tab;
      if (!targetId) return;
      var siblingBtns = e.currentTarget.parentElement.querySelectorAll('.tab-btn');
      siblingBtns.forEach(function(b) { b.classList.remove('active'); });
      e.currentTarget.classList.add('active');

      var targetEl = document.getElementById(targetId);
      if (targetEl && targetEl.parentElement) {
        var contents = targetEl.parentElement.querySelectorAll('.tab-content');
        contents.forEach(function(c) { c.classList.remove('active'); });
        targetEl.classList.add('active');
      }
    });
  });

  // AI Generation
  els.btnGenerateIntel.addEventListener('click', function() { generateAIAnalysis('intelligence'); });
  els.btnGenerateLawyer.addEventListener('click', function() { generateAIAnalysis('lawyer'); });

  // Graph
  els.btnRefreshGraph.addEventListener('click', loadConnections);
  els.btnMaximizeGraph.addEventListener('click', function() {
    var section = document.getElementById('graph-section');
    section.classList.toggle('maximized');
    if (section.classList.contains('maximized')) {
      els.btnMaximizeGraph.textContent = 'Minimize';
    } else {
      els.btnMaximizeGraph.textContent = 'Maximize';
    }
    // Re-render graph so it expands to the new dimensions
    if (state.profile) {
      loadConnections();
    }
  });

  // Text Explorer
  els.wordSearch.addEventListener('input', function(e) {
    if (!state.wordIndex) return;
    renderWordList(e.target.value);
  });

  // Initial setup
  checkAIConfig();
  renderRecentTargets();

  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('u')) {
    els.searchInput.value = urlParams.get('u');
    handleSearch();
  }

  function renderRecentTargets() {
    var recents = JSON.parse(localStorage.getItem('recentTargets') || '[]');
    var container = document.getElementById('recent-targets');
    if (!container) return;
    if (recents.length > 0) {
      container.style.display = 'flex';
      container.innerHTML = recents.map(function(r) {
        return `<button class="btn-sm btn-outline" onclick="document.getElementById('search-input').value='${escapeHTML(r)}'; document.getElementById('search-btn').click()">u/${escapeHTML(r)}</button>`;
      }).join('');
    } else {
      container.style.display = 'none';
    }
  }

  function addRecentTarget(u) {
    var recents = JSON.parse(localStorage.getItem('recentTargets') || '[]');
    recents = recents.filter(function(r) { return r.toLowerCase() !== u.toLowerCase(); });
    recents.unshift(u);
    recents = recents.slice(0, 5); // Keep top 5
    localStorage.setItem('recentTargets', JSON.stringify(recents));
    renderRecentTargets();
  }

  document.getElementById('export-pdf-btn').addEventListener('click', function() {
    if (!state.posts && !state.comments) return;
    
    if (typeof window.jspdf === 'undefined') {
      showError('PDF library is not loaded yet.');
      return;
    }

    var doc = new window.jspdf.jsPDF();
    doc.setFont('Helvetica');
    
    // Title
    doc.setFontSize(18);
    doc.text('RedTrack Report: u/' + state.username, 14, 22);
    
    // Subtitle
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text('Generated on ' + new Date().toLocaleString(), 14, 30);
    
    var bodyData = [];
    
    state.posts.forEach(function(p) {
      bodyData.push(['POST', p.subreddit || '', p.score || 0, new Date(p.created_utc * 1000).toLocaleDateString(), (p.title || '').substring(0, 100)]);
    });
    
    state.comments.forEach(function(c) {
      bodyData.push(['COMMENT', c.subreddit || '', c.score || 0, new Date(c.created_utc * 1000).toLocaleDateString(), (c.body || '').substring(0, 100)]);
    });
    
    // We limit to 500 rows to avoid crashing the browser for huge histories
    if (bodyData.length > 500) {
      bodyData = bodyData.slice(0, 500);
      doc.text('* Showing last 500 activities only', 14, 38);
    }
    
    doc.autoTable({
      startY: 45,
      head: [['Type', 'Subreddit', 'Score', 'Date', 'Snippet']],
      body: bodyData,
      theme: 'grid',
      headStyles: { fillColor: [44, 44, 44] },
      styles: { fontSize: 9, cellPadding: 2, overflow: 'linebreak' },
      columnStyles: { 4: { cellWidth: 80 } }
    });
    
    doc.save('redtrack_' + state.username + '.pdf');
  });

  // -------------------------------------------------------------------------
  // Main Search Flow
  // -------------------------------------------------------------------------
  async function handleSearch() {
    var rawInput = els.searchInput.value.trim();
    if (!rawInput) return;
    var u = rawInput.replace(/^u\//i, '').replace(/https?:\/\/.*reddit\.com\/u(ser)?\//i, '').split('/')[0];
    if (!u) return;

    state.username = u;
    addRecentTarget(u);
    els.searchInput.blur();
    hideError();
    showLoading();
    els.heroSection.style.display = 'none';
    els.dashboard.classList.remove('active');

    try {
      // 1. Profile
      updateProgress(10, 'Fetching profile data...');
      var profileResp = await fetchApi('/api/user/' + encodeURIComponent(u) + '/about');
      if (!profileResp.success) throw new Error(profileResp.error);
      state.profile = profileResp.data;

      // 2. Posts
      updateProgress(30, 'Fetching posts...');
      var postsResp = await fetchApi('/api/user/' + encodeURIComponent(u) + '/posts');
      if (!postsResp.success) throw new Error(postsResp.error);
      state.posts = postsResp.data || [];

      // 3. Comments
      updateProgress(60, 'Fetching comments...');
      var commentsResp = await fetchApi('/api/user/' + encodeURIComponent(u) + '/comments');
      if (!commentsResp.success) throw new Error(commentsResp.error);
      state.comments = commentsResp.data || [];

      // Cache Status
      var isCached = profileResp.fromCache || postsResp.fromCache || commentsResp.fromCache;
      els.cacheIndicator.innerHTML = isCached 
        ? '<span class="cache-badge cached">Cached Data</span>'
        : '<span class="cache-badge live">Live Data</span>';

      updateProgress(90, 'Analyzing data...');
      
      // Process Data
      renderProfile();
      renderStats();
      renderCharts();
      renderTables();
      
      // Load lazy components
      loadWordIndex();
      loadConnections();
      loadAIAnalyses();
      checkMonitorStatus();

      updateProgress(100, 'Complete');
      setTimeout(function() {
        hideLoading();
        els.dashboard.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 500);

    } catch(err) {
      hideLoading();
      showError(err.message);
      els.heroSection.style.display = 'block';
    }
  }

  async function fetchApi(url) {
    var refresh = els.forceRefresh.checked ? '?refresh=true' : '';
    var fullUrl = url + (url.includes('?') ? '&' : '?') + (els.forceRefresh.checked ? 'refresh=true' : '');
    var resp = await fetch(fullUrl);
    return await resp.json();
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, match => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match];
    });
  }

  // -------------------------------------------------------------------------
  // Render functions
  // -------------------------------------------------------------------------
  function renderProfile() {
    var p = state.profile;
    els.username.textContent = p.name ? 'u/' + p.name : 'Unknown User';
    els.avatar.src = p.icon_img ? p.icon_img.split('?')[0] : 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png';
    els.created.textContent = p.created_utc ? 'Joined ' + formatDate(p.created_utc) : '';
    els.karma.textContent = formatNumber((p.link_karma || 0) + (p.comment_karma || 0));
    els.linkKarma.textContent = formatNumber(p.link_karma || 0);
    els.commentKarma.textContent = formatNumber(p.comment_karma || 0);
    els.age.textContent = p.created_utc ? Math.floor((Date.now()/1000 - p.created_utc) / 86400) + 'd' : '-';
  }

  function renderStats() {
    els.statPosts.textContent = state.posts.length;
    els.statComments.textContent = state.comments.length;

    var subs = analyzeSubreddits(state.posts, state.comments);
    els.statMostActiveSub.textContent = subs.length > 0 ? subs[0].name : '-';

    var avgPost = state.posts.length ? Math.round(state.posts.reduce(function(s, p){ return s + (p.score || 0); }, 0) / state.posts.length) : 0;
    var avgCom = state.comments.length ? Math.round(state.comments.reduce(function(s, c){ return s + (c.score || 0); }, 0) / state.comments.length) : 0;
    
    els.statAvgPostScore.textContent = avgPost;
    els.statAvgCommentScore.textContent = avgCom;

    // Freq
    if (state.posts.length > 1) {
      var minDate = Math.min.apply(null, state.posts.map(function(p){ return p.created_utc; }));
      var maxDate = Math.max.apply(null, state.posts.map(function(p){ return p.created_utc; }));
      var weeks = (maxDate - minDate) / (86400 * 7);
      els.statPostFrequency.textContent = weeks > 0 ? (state.posts.length / weeks).toFixed(1) : '-';
    } else {
      els.statPostFrequency.textContent = '-';
    }

    // Engagement Metrics
    if (typeof analyzeEngagement !== 'undefined') {
      var eng = analyzeEngagement(state.posts);
      
      var upvoteRatioVal = Math.round(eng.avgUpvoteRatio * 100) || 0;
      document.getElementById('val-upvote-ratio').textContent = upvoteRatioVal + '%';
      document.getElementById('ring-upvote-ratio').setAttribute('stroke-dasharray', upvoteRatioVal + ', 100');
      
      var commentRatioVal = eng.commentToPostRatio.toFixed(1);
      document.getElementById('val-comment-ratio').textContent = commentRatioVal;
      // Cap visual ring at 10 comments per post max
      var commentRingPct = Math.min(100, Math.round((eng.commentToPostRatio / 10) * 100));
      document.getElementById('ring-comment-ratio').setAttribute('stroke-dasharray', commentRingPct + ', 100');
      
      document.getElementById('val-controversial').textContent = eng.controversialPosts;
      document.getElementById('val-median-score').textContent = eng.medianScore;
    }

    // Writing Style
    if (typeof analyzeWritingStyle !== 'undefined') {
      var writing = analyzeWritingStyle(state.comments);
      document.getElementById('val-vocab-size').textContent = writing.vocabularySize.toLocaleString();
      document.getElementById('val-avg-words').textContent = Math.round(writing.avgWordCount);
      
      var badge = document.getElementById('badge-sentiment');
      badge.textContent = writing.avgSentiment.charAt(0).toUpperCase() + writing.avgSentiment.slice(1);
      badge.className = 'sentiment-badge sentiment-' + writing.avgSentiment;
    }
  }

  function renderCharts() {
    if (typeof renderSubredditChart === 'undefined') return; // from charts.js

    var subData = analyzeSubreddits(state.posts, state.comments);
    renderSubredditChart('chart-subreddits', subData.slice(0, 10));

    var hourly = analyzeHourlyActivity(state.posts, state.comments);
    renderHourlyChart('chart-hourly', hourly);

    var heat = analyzeActivityHeatmap(state.posts, state.comments);
    renderActivityHeatmap('heatmap-container', heat);

    if (typeof renderKarmaChart !== 'undefined') {
      var karmaTimeline = analyzeKarmaTimeline(state.posts, state.comments);
      renderKarmaChart('chart-karma', karmaTimeline);
    }

    if (typeof renderWordChart !== 'undefined') {
      var writing = analyzeWritingStyle(state.comments);
      renderWordChart('chart-words', writing.topWords.slice(0, 10));
    }
  }

  // -------------------------------------------------------------------------
  // Most Liked / Disliked Tables
  // -------------------------------------------------------------------------
  function renderTables() {
    var liked = getMostLiked(state.posts, state.comments, 50).combined;
    var disliked = getMostDisliked(state.posts, state.comments, 50).combined;

    function buildRow(item) {
      var isPost = item.type === 'post';
      var text = escapeHTML((isPost ? item.title : item.body) || '');
      var truncateClass = isPost ? '' : 'truncate';
      return `<tr>
        <td><span class="subreddit-badge" style="background:${isPost?'rgba(249,115,22,0.1)':'rgba(6,182,212,0.1)'};color:${isPost?'var(--accent)':'var(--info)'}">${isPost ? 'POST' : 'COMMENT'}</span></td>
        <td>r/${escapeHTML(item.subreddit || 'unknown')}</td>
        <td class="score-badge ${item.score > 0 ? 'score-positive' : item.score < 0 ? 'score-negative' : ''}">${item.score || 0}</td>
        <td><a href="https://reddit.com${escapeHTML(item.permalink)}" target="_blank" class="${truncateClass}">${text}</a></td>
        <td>${formatDate(item.created_utc)}</td>
      </tr>`;
    }

    var latest = [].concat(state.posts.map(p => ({...p, type: 'post'})))
                   .concat(state.comments.map(c => ({...c, type: 'comment'})))
                   .sort(function(a, b) { return b.created_utc - a.created_utc; })
                   .slice(0, 50);

    var elsLatest = document.getElementById('latest-body');
    if (elsLatest) elsLatest.innerHTML = latest.map(buildRow).join('');

    els.likedBody.innerHTML = liked.map(buildRow).join('');
    els.dislikedBody.innerHTML = disliked.map(buildRow).join('');
  }

  // -------------------------------------------------------------------------
  // Text Explorer
  // -------------------------------------------------------------------------
  function loadWordIndex() {
    if (!state.comments || state.comments.length === 0) return;
    state.wordIndex = buildWordIndex(state.comments);
    renderWordList('');
  }

  function renderWordList(query) {
    if (!state.wordIndex) return;
    var words = searchWords(state.wordIndex, query, 50);
    
    if (words.length === 0) {
      els.wordList.innerHTML = '<li style="padding:1rem;color:var(--text-muted);text-align:center;">No words found.</li>';
      return;
    }

    els.wordList.innerHTML = words.map(function(w) {
      return `<li class="word-item" data-word="${escapeHTML(w.word)}">
        <span class="word-text">${escapeHTML(w.word)}</span>
        <span class="word-count">${w.count}</span>
      </li>`;
    }).join('');

    // Click to select
    els.wordList.querySelectorAll('.word-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        els.wordList.querySelectorAll('.word-item').forEach(function(i){ i.classList.remove('selected'); });
        var target = e.currentTarget;
        target.classList.add('selected');
        selectWord(target.dataset.word);
      });
    });

    // Auto select first
    if (words.length > 0) {
      els.wordList.querySelector('.word-item').click();
    }
  }

  function selectWord(word) {
    if (!state.wordIndex || !state.wordIndex[word]) return;
    var entry = state.wordIndex[word];
    els.selectedWordTitle.innerHTML = `Usage of "<span style="color:#fff">${escapeHTML(word)}</span>"`;

    var timeline = getWordTimeline(state.wordIndex, word);
    if (typeof renderWordTimeline !== 'undefined') {
      renderWordTimeline('chart-word-timeline', timeline, word);
    }

    els.wordContexts.innerHTML = entry.comments.map(function(c) {
      var escapedBody = escapeHTML(c.body || '');
      var bodyHtml = escapedBody.replace(new RegExp('\\b(' + escapeHTML(word) + ')\\b', 'gi'), '<span class="highlight-word">$1</span>');
      return `<div class="context-item">
        <div class="context-meta">
          <span>r/${escapeHTML(c.subreddit)} • Score: ${c.score} • ${formatDate(c.date)}</span>
          <a href="https://reddit.com${escapeHTML(c.permalink)}" target="_blank">View ↗</a>
        </div>
        <div>${bodyHtml}</div>
      </div>`;
    }).join('');
  }

  // -------------------------------------------------------------------------
  // Connections Graph
  // -------------------------------------------------------------------------
  async function loadConnections() {
    var container = document.getElementById('graph-container');
    container.innerHTML = '<div class="graph-empty">Analyzing comment replies...</div>';
    
    var resp = await fetchApi('/api/user/' + encodeURIComponent(state.username) + '/connections');
    if (resp.success && resp.data) {
      if (typeof window.renderConnectionGraph === 'function') {
        window.renderConnectionGraph('graph-container', resp.data);
      }
    } else {
      container.innerHTML = '<div class="graph-empty" style="color:var(--negative)">Failed to load connections.</div>';
    }
  }

  // -------------------------------------------------------------------------
  // AI Analysis
  // -------------------------------------------------------------------------
  async function checkAIConfig() {
    try {
      var r = await fetch('/api/ai-config');
      var json = await r.json();
      if (json.success && json.configured) {
        els.aiModelInfo.textContent = `Powered by ${json.provider} (${json.model})`;
      } else {
        els.aiModelInfo.textContent = 'AI Not Configured (Set AI_API_KEY)';
      }
    } catch(e) {}
  }

  async function loadAIAnalyses() {
    var r = await fetch('/api/user/' + encodeURIComponent(state.username) + '/ai-analysis');
    var json = await r.json();
    if (json.success && json.data) {
      state.aiAnalyses = json.data;
      
      var intel = state.aiAnalyses.find(a => a.perspective === 'intelligence');
      var lawyer = state.aiAnalyses.find(a => a.perspective === 'lawyer');

      if (intel) displayAIAnalysis('intelligence', intel.content);
      else { els.aiIntelPlaceholder.style.display = 'flex'; els.aiIntelContent.style.display = 'none'; }
      
      if (lawyer) displayAIAnalysis('lawyer', lawyer.content);
      else { els.aiLawyerPlaceholder.style.display = 'flex'; els.aiLawyerContent.style.display = 'none'; }
    }
  }

  async function generateAIAnalysis(perspective) {
    var btn = perspective === 'intelligence' ? els.btnGenerateIntel : els.btnGenerateLawyer;
    var originalText = btn.textContent;
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
      var r = await fetch('/api/user/' + encodeURIComponent(state.username) + '/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perspective: perspective })
      });
      var json = await r.json();
      if (json.success) {
        displayAIAnalysis(perspective, json.data.content);
      } else {
        showError(json.error);
      }
    } catch(e) {
      showError(e.message);
    }
    btn.textContent = originalText;
    btn.disabled = false;
  }

  function displayAIAnalysis(perspective, markdown) {
    var placeholder = perspective === 'intelligence' ? els.aiIntelPlaceholder : els.aiLawyerPlaceholder;
    var contentDiv = perspective === 'intelligence' ? els.aiIntelContent : els.aiLawyerContent;
    
    placeholder.style.display = 'none';
    contentDiv.style.display = 'block';
    
    if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      contentDiv.innerHTML = DOMPurify.sanitize(marked.parse(markdown));
    } else if (typeof marked !== 'undefined') {
      // Fallback if DOMPurify fails to load, though risky
      contentDiv.innerHTML = marked.parse(markdown);
    } else {
      // Safe fallback using textContent
      contentDiv.textContent = markdown;
      contentDiv.style.whiteSpace = 'pre-wrap';
      contentDiv.style.fontFamily = 'var(--font-family)';
    }
  }

  // -------------------------------------------------------------------------
  // Monitoring
  // -------------------------------------------------------------------------
  async function checkMonitorStatus() {
    var r = await fetch('/api/monitor/status/' + encodeURIComponent(state.username));
    var json = await r.json();
    if (json.success) {
      state.isMonitored = json.isMonitored;
      els.monitorBtnText.textContent = state.isMonitored ? 'Stop Monitoring' : 'Monitor User';
      els.monitorToggleBtn.style.borderColor = state.isMonitored ? 'var(--negative)' : 'var(--border)';
      els.monitorToggleBtn.style.color = state.isMonitored ? 'var(--negative)' : 'var(--text-secondary)';
    }
  }

  async function toggleMonitor() {
    var pw = window.sessionStorage.getItem('adminToken');
    if (!pw) {
      pw = prompt('Enter admin password to modify monitors:');
      if (!pw) return;
    }

    var method = state.isMonitored ? 'DELETE' : 'POST';
    try {
      var r = await fetch('/api/monitor/' + encodeURIComponent(state.username), {
        method: method,
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-password': pw
        },
        body: JSON.stringify({ interval: 60 })
      });
      var json = await r.json();
      if (json.success) {
        window.sessionStorage.setItem('adminToken', pw);
        await checkMonitorStatus();
      } else {
        showError(json.error || 'Failed to toggle monitor');
        if (r.status === 401) {
          window.sessionStorage.removeItem('adminToken');
        }
      }
    } catch(e) {
      showError('Error: ' + e.message);
    }
  }

  async function loadMonitors() {
    els.monitorsModal.classList.add('active');
    els.monitorsList.innerHTML = '<div style="text-align:center;padding:2rem;">Loading...</div>';
    
    try {
      var r = await fetch('/api/monitors');
      var json = await r.json();
      if (!json.success || !json.data || json.data.length === 0) {
        els.monitorsList.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">No users are being monitored.</div>';
        return;
      }

      els.monitorsList.innerHTML = '';
      
      json.data.forEach(function(m) {
        var nextCheck = Math.round(m.next_check_in / 60);
        
        var li = document.createElement('li');
        li.className = 'monitor-item';
        
        var infoDiv = document.createElement('div');
        infoDiv.className = 'monitor-info';
        
        var nameStrong = document.createElement('strong');
        nameStrong.textContent = 'u/' + m.username;
        infoDiv.appendChild(nameStrong);
        
        var statsSpan = document.createElement('span');
        statsSpan.textContent = m.postCount + ' posts, ' + m.commentCount + ' comments • Checks every ' + m.interval_minutes + 'm • Next in ' + nextCheck + 'm';
        infoDiv.appendChild(statsSpan);
        
        li.appendChild(infoDiv);
        
        var actionsDiv = document.createElement('div');
        actionsDiv.className = 'monitor-actions';
        
        var viewBtn = document.createElement('button');
        viewBtn.textContent = 'View';
        viewBtn.addEventListener('click', function() {
          document.getElementById('search-input').value = m.username;
          document.getElementById('search-btn').click();
          document.getElementById('close-monitors-btn').click();
        });
        actionsDiv.appendChild(viewBtn);
        
        li.appendChild(actionsDiv);
        
        els.monitorsList.appendChild(li);
      });
    } catch(e) {
      els.monitorsList.innerHTML = '<div style="color:var(--negative)">Failed to load monitors.</div>';
    }
  }

  // -------------------------------------------------------------------------
  // UI Helpers
  // -------------------------------------------------------------------------
  function showLoading() {
    els.loadingOverlay.classList.add('active');
    els.loaderProgressBar.style.width = '0%';
  }

  function hideLoading() {
    els.loadingOverlay.classList.remove('active');
  }

  function updateProgress(percent, text) {
    els.loaderProgressBar.style.width = percent + '%';
    if (text) els.loaderStatus.textContent = text;
  }

  function showError(msg) {
    els.errorMessage.textContent = msg;
    els.errorBanner.classList.add('active');
    setTimeout(hideError, 8000);
  }

  function hideError() {
    els.errorBanner.classList.remove('active');
  }

  // -------------------------------------------------------------------------
  // Connection Details Modal
  // -------------------------------------------------------------------------
  window.showConnectionDetails = async function(connectedUser) {
    var existing = document.getElementById('connection-modal');
    if (existing) existing.remove();
    
    var modalHtml = `
      <div id="connection-modal" class="modal-overlay active" style="display:flex; z-index:1000;">
        <div class="modal-content">
          <div class="modal-header">
            <h3 id="connection-modal-title">Replies to u/...</h3>
            <button class="close-btn" onclick="document.getElementById('connection-modal').remove()">&times;</button>
          </div>
          <div class="modal-body" id="connection-body">
            <div style="text-align:center;padding:2rem;">Fetching exact comments...</div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    document.getElementById('connection-modal-title').textContent = 'Replies to u/' + connectedUser;

    try {
      var r = await fetch('/api/user/' + encodeURIComponent(state.username) + '/connections/' + encodeURIComponent(connectedUser) + '/comments');
      var json = await r.json();
      
      var body = document.getElementById('connection-body');
      if (json.success && json.data && json.data.length > 0) {
        body.innerHTML = json.data.map(function(c) {
          return `
          <div style="background:var(--bg-secondary);border:1px solid var(--border);padding:1rem;border-radius:var(--radius-md);margin-bottom:1rem;font-size:0.85rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;color:var(--text-muted);font-size:0.75rem;">
              <span>r/` + c.subreddit + ` • Score: ` + c.score + `</span>
              <a href="https://reddit.com` + c.permalink + `" target="_blank" style="color:var(--accent);text-decoration:none;">View ↗</a>
            </div>
            <div style="color:var(--text-primary);line-height:1.5;">` + (c.body || '').replace(/</g,'&lt;').replace(/>/g,'&gt;') + `</div>
          </div>
        `}).join('');
      } else {
        body.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">No specific comments found. They may have been deleted or skipped.</div>';
      }
    } catch(e) {
      document.getElementById('connection-body').innerHTML = '<div style="color:var(--negative);text-align:center;padding:2rem;">Failed to load comments.</div>';
    }
  };

})();
