(function() {
  'use strict';

  let adminToken = '';
  let state = {
    user: null,
    posts: [],
    comments: [],
    interactions: [],
    karmaLog: []
  };

  // ---------------------------------------------------------------------------
  // Auth & Init
  // ---------------------------------------------------------------------------
  window.login = async function() {
    const pw = document.getElementById('admin-pw').value;
    try {
      const loginRes = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw })
      });
      const loginJson = await loginRes.json();
      
      if (!loginJson.success) {
        showAuthError(loginJson.error || 'Login failed');
        return;
      }

      adminToken = 'true';
      const res = await fetch('/api/me/summary');
      const json = await res.json();
      
      if (!json.success) {
        showAuthError(json.error);
        return;
      }
      
      document.getElementById('auth-section').style.display = 'none';
      document.getElementById('dashboard').style.display = 'grid';
      
      // Load everything
      loadSummary(json.data);
      loadKarmaLog();
      loadApiReqs();
      await loadContent(); // Posts & Comments
      loadInteractions();
      renderStats();
      
    } catch (e) {
      showAuthError('Failed to connect to server.');
    }
  };

  async function loadApiReqs() {
    try {
      const res = await fetch('/api/stats/requests');
      const json = await res.json();
      if (json.success) {
        document.getElementById('my-api-reqs').textContent = json.data.count.toLocaleString();
      }
    } catch(e) {}
  }

  function showAuthError(msg) {
    const err = document.getElementById('auth-error');
    err.textContent = msg;
    err.style.display = 'block';
  }

  document.getElementById('admin-pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') login();
  });

  // ---------------------------------------------------------------------------
  // Fetch Wrappers
  // ---------------------------------------------------------------------------
  async function fetchMe(type) {
    try {
      let endpoint = `/api/me/${type}`;
      if (type === 'karma') endpoint = '/api/me/karma/log';
      const res = await fetch(endpoint);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Summary & Karma
  // ---------------------------------------------------------------------------
  function loadSummary(data) {
    state.user = data.user;
    document.getElementById('my-username').textContent = `u/${state.user.name}`;
    document.getElementById('my-avatar').src = (state.user.icon_img || '').split('?')[0] || 'https://www.redditstatic.com/avatars/avatar_default_02_FF4500.png';
    document.getElementById('my-karma').textContent = state.user.total_karma.toLocaleString();
    
    setDelta('my-delta-24', data.delta24);
    setDelta('my-delta-7d', data.delta7d);
  }

  function setDelta(id, value) {
    const el = document.getElementById(id);
    if (value > 0) {
      el.textContent = '+' + value;
      el.className = 'stat-value delta-positive';
    } else if (value < 0) {
      el.textContent = value;
      el.className = 'stat-value delta-negative';
    } else {
      el.textContent = '0';
      el.className = 'stat-value delta-neutral';
    }
  }

  async function loadKarmaLog() {
    try {
      const logs = await fetchMe('karma');
      const container = document.getElementById('karma-log-container');
      
      if (!logs || logs.length < 2) {
        container.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem;">Not enough snapshots yet. Check back later.</div>';
        return;
      }
      
      let html = '';
      for (let i = 0; i < logs.length - 1; i++) {
        const current = logs[i];
        const prev = logs[i + 1];
        const diff = current.total_karma - prev.total_karma;
        
        if (diff !== 0) {
          const color = diff > 0 ? 'var(--positive)' : 'var(--negative)';
          const sign = diff > 0 ? '+' : '';
          html += `
            <div class="karma-log-item">
              <span style="color:${color};font-weight:bold;width:40px;">${sign}${diff}</span>
              <span style="color:var(--text-secondary)">${current.total_karma.toLocaleString()} karma</span>
              <span style="color:var(--text-tertiary)">${formatDate(current.snapped_at)}</span>
            </div>
          `;
        }
      }
      container.innerHTML = html || '<div style="color:var(--text-muted);font-size:0.85rem;">No karma changes detected across snapshots.</div>';
    } catch(e) {}
  }

  // ---------------------------------------------------------------------------
  // Content (Posts & Comments)
  // ---------------------------------------------------------------------------
  async function loadContent() {
    try {
      const [posts, comments] = await Promise.all([
        fetchMe('posts'),
        fetchMe('comments')
      ]);
      state.posts = posts || [];
      state.comments = comments || [];
      
      renderFeed('all');
      renderActivityChart();
      renderThreads();
    } catch(e) {}
  }

  // Feed Tabs
  document.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      renderFeed(e.target.dataset.filter);
    });
  });

  function renderFeed(filter) {
    const container = document.getElementById('feed-container');
    let items = [];
    if (filter === 'all' || filter === 'posts') items = items.concat(state.posts.map(p => ({...p, _type: 'post'})));
    if (filter === 'all' || filter === 'comments') items = items.concat(state.comments.map(c => ({...c, _type: 'comment'})));
    
    items.sort((a, b) => b.created_utc - a.created_utc);
    items = items.slice(0, 50); // Limit to 50 for performance
    
    if (items.length === 0) {
      container.innerHTML = '<div style="padding:1rem;color:var(--text-muted)">No recent activity.</div>';
      return;
    }
    
    container.innerHTML = '';
    items.forEach(item => {
      const isPost = item._type === 'post';
      const text = isPost ? item.title : item.body;
      const typeColor = isPost ? 'var(--accent)' : 'var(--info)';
      
      const div = document.createElement('div');
      div.className = 'feed-item';
      
      const meta = document.createElement('div');
      meta.className = 'feed-meta';
      
      const typeSpan = document.createElement('span');
      typeSpan.style.color = typeColor;
      typeSpan.style.fontWeight = '700';
      typeSpan.textContent = isPost ? 'POST' : 'COMMENT';
      
      meta.appendChild(typeSpan);
      meta.appendChild(document.createTextNode(` • r/${item.subreddit} • Score: ${item.score} • ${formatDate(item.created_utc)}`));
      
      div.appendChild(meta);
      
      const body = document.createElement('div');
      body.className = 'feed-body';
      
      const link = document.createElement('a');
      link.href = `https://reddit.com${item.permalink}`;
      link.target = '_blank';
      link.style.color = 'inherit';
      link.style.textDecoration = 'none';
      link.textContent = text.length > 200 ? text.substring(0, 200) + '...' : text;
      
      body.appendChild(link);
      div.appendChild(body);
      
      container.appendChild(div);
    });
  }

  // ---------------------------------------------------------------------------
  // Interactions & Tabs
  // ---------------------------------------------------------------------------
  document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', e => {
      document.querySelectorAll('.tab-btn[data-tab]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(e.target.dataset.tab).classList.add('active');
    });
  });

  async function loadInteractions() {
    try {
      const data = await fetchMe('interactions');
      const tbody = document.getElementById('replied-body');
      
      if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No interactions found.</td></tr>';
        return;
      }
      
      tbody.innerHTML = '';
      data.slice(0, 25).forEach(c => {
        const tr = document.createElement('tr');
        
        const tdName = document.createElement('td');
        const strongName = document.createElement('strong');
        strongName.style.color = 'var(--text-primary)';
        strongName.textContent = 'u/' + c.connected_to;
        tdName.appendChild(strongName);
        
        const tdCount = document.createElement('td');
        tdCount.textContent = c.interaction_count;
        
        const tdDate = document.createElement('td');
        tdDate.textContent = formatDate(c.last_interaction);
        
        const tdAction = document.createElement('td');
        const btn = document.createElement('button');
        btn.className = 'btn-sm btn-outline';
        btn.textContent = 'View Comments';
        btn.addEventListener('click', () => showConnectionDetails(c.connected_to));
        tdAction.appendChild(btn);
        
        tr.appendChild(tdName);
        tr.appendChild(tdCount);
        tr.appendChild(tdDate);
        tr.appendChild(tdAction);
        
        tbody.appendChild(tr);
      });
    } catch(e) {}
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, match => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[match];
    });
  }

  window.showConnectionDetails = async function(connectedUser) {
    let existing = document.getElementById('connection-modal');
    if (existing) existing.remove();
    
    const modalHtml = `
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
      const r = await fetch(`/api/user/${encodeURIComponent(state.user.name)}/connections/${encodeURIComponent(connectedUser)}/comments`);
      const res = await r.json();
      
      const body = document.getElementById('connection-body');
      if (res.success && res.data && res.data.length > 0) {
        body.innerHTML = res.data.map(c => `
          <div style="background:var(--bg-secondary);border:1px solid var(--border);padding:1rem;border-radius:var(--radius-md);margin-bottom:1rem;font-size:0.85rem;">
            <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem;color:var(--text-muted);font-size:0.75rem;">
              <span>r/${escapeHTML(c.subreddit)} • Score: ${c.score}</span>
              <a href="https://reddit.com${escapeHTML(c.permalink)}" target="_blank" style="color:var(--accent);text-decoration:none;">View ↗</a>
            </div>
            <div style="color:var(--text-primary);line-height:1.5;">${escapeHTML(c.body)}</div>
          </div>
        `).join('');
      } else {
        body.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:2rem;">No specific comments found. They may have been deleted or skipped.</div>';
      }
    } catch(e) {
      document.getElementById('connection-body').innerHTML = '<div style="color:var(--negative);text-align:center;padding:2rem;">Failed to load comments.</div>';
    }
  };

  // ---------------------------------------------------------------------------
  // Threads Logic
  // ---------------------------------------------------------------------------
  function renderThreads() {
    const threadMap = {};
    state.comments.forEach(c => {
      if (!c.link_id) return;
      if (!threadMap[c.link_id]) {
        threadMap[c.link_id] = { id: c.link_id, title: c.link_title || 'Unknown Post', sub: c.subreddit, count: 0, last: 0 };
      }
      threadMap[c.link_id].count++;
      if (c.created_utc > threadMap[c.link_id].last) threadMap[c.link_id].last = c.created_utc;
    });
    
    const threads = Object.values(threadMap).sort((a, b) => b.count - a.count).slice(0, 20);
    const tbody = document.getElementById('threads-body');
    
    if (threads.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No comment threads found.</td></tr>';
      return;
    }
    
    tbody.innerHTML = threads.map(t => `
      <tr>
        <td style="max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHTML(t.title)}">${escapeHTML(t.title)}</td>
        <td>r/${escapeHTML(t.sub)}</td>
        <td>${t.count} comments</td>
        <td>${formatDate(t.last)}</td>
      </tr>
    `).join('');
  }

  // ---------------------------------------------------------------------------
  // Stats & Charts
  // ---------------------------------------------------------------------------
  function renderStats() {
    if (state.comments.length > 0) {
      const avgLength = Math.round(state.comments.reduce((sum, c) => sum + (c.body ? c.body.split(/\s+/).length : 0), 0) / state.comments.length);
      document.getElementById('stat-words').textContent = `${avgLength} words`;
      
      // Hourly
      const hours = new Array(24).fill(0);
      state.comments.forEach(c => {
        const date = new Date(c.created_utc * 1000);
        hours[date.getHours()]++;
      });
      state.posts.forEach(p => {
        const date = new Date(p.created_utc * 1000);
        hours[date.getHours()]++;
      });
      const maxHour = hours.indexOf(Math.max(...hours));
      const ampm = maxHour >= 12 ? 'PM' : 'AM';
      const hr = maxHour % 12 || 12;
      document.getElementById('stat-hour').textContent = `${hr} ${ampm} (Local Time)`;
      
      // Extract top words (naive approach for this page)
      const stopWords = new Set(['the','a','an','is','it','to','for','of','in','on','at','and','or','but','i','my','me','we','you','he','she','they','this','that','with','from','was','were','are','been','be','have','has','had','do','does','did','will','would','could','should','not','no','so','if','as','just','like','about','what','which','who','how','when','where','why','than','then','also','very','more','much','most','only','other','into','some','its','can','all','your','their','our','up','out','get','got','one','two','there','here','know','think','good','new','time','re','ve','ll','don','si','și','in','în','la','de','cu','o','un','sa','să','pe','a','al','ai','ale','au','din','care','pentru','este','e','nu','mai','ca','că','sunt','cel','cea','cei','cele','dar','sau','se','el','ea','ei','ele','lui','lor','cum','ce','cand','când','unde','cine','tot','fost','fata','fața','daca','dacă','asa','așa','acolo','aici','nici','deja','doar','prea','foarte','bine','chiar','poate','fara','fără','prin','peste','sub','intr','dintr','printr','f','am','are','ati','ați','avem','fi','fiu','fie','fii','fim','fiti','fiți','ba','da','iar','niciodata','mereu','asta','ii','ar','acum','le','ul','face','te','aia','gt','amp']);
      const wordCounts = {};
      state.comments.forEach(c => {
        if (!c.body) return;
        const cleanBody = c.body.toLowerCase().replace(/https?:\/\/\S+/g, '').replace(/`[^`]*`/g, '');
        const words = cleanBody.replace(/[^a-z0-9ășțîâ]/g, ' ').split(/\s+/);
        words.forEach(w => {
          if (w.length > 2 && !stopWords.has(w) && isNaN(w)) {
            wordCounts[w] = (wordCounts[w] || 0) + 1;
          }
        });
      });
      const topWords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);
      document.getElementById('stat-top-words').innerHTML = topWords.map(w => 
        `<span style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;border:1px solid var(--border)">${w[0]} (${w[1]})</span>`
      ).join('');
      
    }
  }

  function renderActivityChart() {
    const ctx = document.getElementById('activity-chart');
    if (!ctx) return;
    
    // Group by day for last 180 days
    const days = {};
    const now = new Date();
    for (let i=0; i<180; i++) {
      const d = new Date(now - i * 86400000);
      days[d.toISOString().split('T')[0]] = { posts: 0, comments: 0 };
    }
    
    state.posts.forEach(p => {
      const dateStr = new Date(p.created_utc * 1000).toISOString().split('T')[0];
      if (days[dateStr]) days[dateStr].posts++;
    });
    
    state.comments.forEach(c => {
      const dateStr = new Date(c.created_utc * 1000).toISOString().split('T')[0];
      if (days[dateStr]) days[dateStr].comments++;
    });
    
    const labels = Object.keys(days).sort();
    const postData = labels.map(l => days[l].posts);
    const commentData = labels.map(l => days[l].comments);
    
    window._myCharts = window._myCharts || {};
    if (window._myCharts['activity']) window._myCharts['activity'].destroy();
    
    window._myCharts['activity'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Posts', data: postData, backgroundColor: '#f97316' },
          { label: 'Comments', data: commentData, backgroundColor: '#06b6d4' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, grid: { color: 'rgba(161, 161, 170, 0.1)' } }
        },
        plugins: {
          legend: { position: 'top', labels: { color: '#a1a1aa' } }
        }
      }
    });

    // Subreddit chart
    const subCtx = document.getElementById('subs-chart');
    if (!subCtx) return;
    
    const subMap = {};
    state.posts.forEach(p => { subMap[p.subreddit] = (subMap[p.subreddit] || 0) + 1; });
    state.comments.forEach(c => { subMap[c.subreddit] = (subMap[c.subreddit] || 0) + 1; });
    const subs = Object.entries(subMap).sort((a,b) => b[1]-a[1]).slice(0,10);
    
    if (window._myCharts['subs']) window._myCharts['subs'].destroy();
    
    window._myCharts['subs'] = new Chart(subCtx, {
      type: 'bar',
      data: {
        labels: subs.map(s => s[0]),
        datasets: [{
          label: 'Activity',
          data: subs.map(s => s[1]),
          backgroundColor: '#8b5cf6'
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { color: 'rgba(161, 161, 170, 0.1)' } },
          y: { grid: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------
  function formatDate(ts) {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString();
  }

})();
