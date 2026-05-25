// ============================================================================
// subreddit.js — Frontend logic for Subreddit OSINT Wiretap
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
  const btnAdd = document.getElementById('btn-add-tap');
  const inputNew = document.getElementById('new-tap-input');
  const tapList = document.getElementById('tap-list');
  
  const dashboard = document.getElementById('intel-dashboard');
  const title = document.getElementById('intel-title');
  const meta = document.getElementById('intel-meta');
  const feed = document.getElementById('feed-container');
  const btnRemove = document.getElementById('btn-remove-tap');
  
  let currentTap = null;
  let refreshInterval = null;

  // Init
  loadTaps();

  async function ensureLogin() {
    if (window.sessionStorage.getItem('adminToken') === 'true') return true;
    var pw = prompt('Enter admin password:');
    if (!pw) return false;
    var r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    var j = await r.json();
    if (j.success) {
      window.sessionStorage.setItem('adminToken', 'true');
      return true;
    } else {
      alert('Invalid password');
      return false;
    }
  }

  // Add Tap
  btnAdd.addEventListener('click', async () => {
    const sub = inputNew.value.trim().replace(/^r\//, '');
    if (!sub) return;
    
    if (!(await ensureLogin())) return;

    btnAdd.disabled = true;
    btnAdd.innerText = 'Deploying...';
    
    try {
      const res = await fetch('/api/subreddit/monitor', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subreddit: sub })
      });
      const data = await res.json();
      if (!data.success) {
        if (res.status === 401) window.sessionStorage.removeItem('adminToken');
        throw new Error(data.error);
      }
      
      inputNew.value = '';
      await loadTaps();
      selectTap(sub);
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      btnAdd.disabled = false;
      btnAdd.innerText = 'Deploy';
    }
  });
  
  // Remove Tap
  btnRemove.addEventListener('click', async () => {
    if (!currentTap || !confirm(`Sever wiretap on r/${currentTap}?`)) return;
    
    if (!(await ensureLogin())) return;

    try {
      const res = await fetch(`/api/subreddit/monitor/${currentTap}`, { 
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.success) {
        if (res.status === 401) window.sessionStorage.removeItem('adminToken');
        throw new Error(data.error);
      }
      
      dashboard.style.display = 'none';
      currentTap = null;
      if (refreshInterval) clearInterval(refreshInterval);
      await loadTaps();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });

  // Force Fetch
  const btnForce = document.getElementById('btn-force-fetch');
  if (btnForce) {
    btnForce.addEventListener('click', async () => {
      if (!currentTap) return;
      
      if (!(await ensureLogin())) return;

      const originalText = btnForce.innerText;
      btnForce.disabled = true;
      btnForce.innerText = 'Syncing...';
      
      try {
        const res = await fetch(`/api/subreddit/monitor/${currentTap}/force-fetch`, { 
          method: 'POST'
        });
        const data = await res.json();
        if (!data.success) {
          if (res.status === 401) window.sessionStorage.removeItem('adminToken');
          throw new Error(data.error);
        }
        
        // Reload feed to show new posts
        await loadFeed();
        
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btnForce.disabled = false;
        btnForce.innerText = originalText;
      }
    });
  }

  async function loadTaps() {
    try {
      const res = await fetch('/api/subreddit/taps');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      
      tapList.innerHTML = '';
      if (data.data.length === 0) {
        tapList.innerHTML = '<div style="padding:1rem;color:var(--text-muted);font-size:0.8rem">No active wiretaps.</div>';
        return;
      }
      
      data.data.forEach(tap => {
        const li = document.createElement('li');
        li.className = `tap-item ${currentTap === tap.subreddit ? 'active' : ''}`;
        
        const date = new Date(tap.tapped_at * 1000).toLocaleString();
        
        li.innerHTML = `
          <div>
            <div style="font-weight:600;color:var(--text-primary)">r/${tap.subreddit}</div>
            <div style="font-size:0.75rem;color:var(--text-muted)">Tapped: ${date}</div>
          </div>
          <div class="live-dot" style="margin:0;width:8px;height:8px"></div>
        `;
        li.onclick = () => selectTap(tap.subreddit, tap.tapped_at);
        tapList.appendChild(li);
      });
    } catch (err) {
      console.error(err);
    }
  }

  function selectTap(subreddit, tapped_at) {
    currentTap = subreddit;
    
    // Update UI active state
    loadTaps(); // Re-render to highlight correctly
    
    dashboard.style.display = 'block';
    title.innerText = `r/${subreddit}`;
    const date = tapped_at ? new Date(tapped_at * 1000).toLocaleString() : 'recently';
    meta.innerText = `Wiretap activated at ${date}`;
    
    if (refreshInterval) clearInterval(refreshInterval);
    loadFeed();
    refreshInterval = setInterval(loadFeed, 30000); // 30s live refresh
  }

  window.addEventListener('beforeunload', () => {
    if (refreshInterval) clearInterval(refreshInterval);
  });

  async function loadFeed() {
    if (!currentTap) return;
    try {
      const res = await fetch(`/api/subreddit/${currentTap}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      
      feed.innerHTML = '';
      
      if (data.data.length === 0) {
        feed.innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem">Scanning... No threads intercepted yet.</div>';
        return;
      }
      
      data.data.forEach(post => {
        const div = document.createElement('div');
        div.className = `feed-item ${post.status}`;
        
        const date = new Date(post.created_utc * 1000).toLocaleString();
        
        // Status Badge
        let badgeClass = 'badge-monitoring';
        let statusText = 'Monitoring';
        if (post.status === 'completed') { badgeClass = 'badge-completed'; statusText = 'Completed (23h)'; }
        if (post.status === 'dropped') { badgeClass = 'badge-dropped'; statusText = 'Dropped (Low Comm)'; }
        
        const headerDiv = document.createElement('div');
        headerDiv.style.display = 'flex';
        headerDiv.style.justifyContent = 'space-between';
        headerDiv.style.marginBottom = '0.5rem';
        
        const dateDiv = document.createElement('div');
        dateDiv.style.fontSize = '0.8rem';
        dateDiv.style.color = 'var(--text-muted)';
        dateDiv.textContent = date;
        
        const badgeDiv = document.createElement('div');
        badgeDiv.className = `status-badge ${badgeClass}`;
        badgeDiv.textContent = statusText;
        
        headerDiv.appendChild(dateDiv);
        headerDiv.appendChild(badgeDiv);
        
        const titleContainer = document.createElement('div');
        titleContainer.style.fontWeight = '600';
        titleContainer.style.marginBottom = '0.25rem';
        
        const titleLink = document.createElement('a');
        titleLink.href = `https://reddit.com/comments/${post.reddit_id}`;
        titleLink.target = '_blank';
        titleLink.style.color = 'inherit';
        titleLink.style.textDecoration = 'none';
        titleLink.textContent = post.title || '[No Title]';
        
        titleContainer.appendChild(titleLink);
        
        const statsDiv = document.createElement('div');
        statsDiv.style.fontSize = '0.8rem';
        statsDiv.style.color = 'var(--text-tertiary)';
        statsDiv.textContent = `Intercepted Comments: ${post.num_comments}`;
        
        div.appendChild(headerDiv);
        div.appendChild(titleContainer);
        div.appendChild(statsDiv);
        
        if (post.summary) {
          const summaryContainer = document.createElement('div');
          summaryContainer.style.marginTop = '0.75rem';
          summaryContainer.style.padding = '0.75rem';
          summaryContainer.style.background = 'rgba(0,0,0,0.2)';
          summaryContainer.style.borderLeft = '2px solid var(--accent)';
          summaryContainer.style.fontSize = '0.85rem';
          summaryContainer.style.color = 'var(--text-secondary)';
          
          const aiLabel = document.createElement('strong');
          aiLabel.style.color = 'var(--accent)';
          aiLabel.textContent = 'AI Assessment:';
          summaryContainer.appendChild(aiLabel);
          summaryContainer.appendChild(document.createElement('br'));
          
          const summaryText = document.createTextNode(post.summary);
          summaryContainer.appendChild(summaryText);
          
          div.appendChild(summaryContainer);
        }
        
        feed.appendChild(div);
      });
      
    } catch (err) {
      console.error(err);
    }
  }
});
