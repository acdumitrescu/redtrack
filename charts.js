// ============================================================================
// charts.js — RedTrack Chart Rendering Module (Chart.js 4.x)
// All functions are global. Chart.js is assumed available via CDN.
// ============================================================================

// Global color palette for datasets
const CHART_COLORS = [
  '#f97316', '#fb923c', '#fdba74', '#fed7aa', // oranges
  '#06b6d4', '#22d3ee', '#67e8f9', '#a5f3fc', // cyans
  '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', // purples
  '#10b981', '#34d399', '#6ee7b7', '#a7f3d0', // greens
  '#f43f5e', '#fb7185', '#fda4af', '#fecdd3', // pinks
];

// ---------------------------------------------------------------------------
// Shared theme defaults
// ---------------------------------------------------------------------------

var _chartTheme = {
  textColor: '#a1a1aa',
  gridColor: 'rgba(161, 161, 170, 0.1)',
  fontFamily: 'Inter, sans-serif',
  borderRadius: 6
};

/**
 * Destroys any existing chart on the given canvas and cleans up the registry.
 * @param {string} canvasId
 */
function _destroyExistingChart(canvasId) {
  window._charts = window._charts || {};
  if (window._charts[canvasId]) {
    window._charts[canvasId].destroy();
    delete window._charts[canvasId];
  }
}

/**
 * Stores a chart instance in the global registry.
 * @param {string} canvasId
 * @param {Chart} chartInstance
 */
function _storeChart(canvasId, chartInstance) {
  window._charts = window._charts || {};
  window._charts[canvasId] = chartInstance;
}

/**
 * Returns common Chart.js defaults merged with any overrides.
 */
function _baseOptions(overrides) {
  var base = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: _chartTheme.textColor,
          font: { family: _chartTheme.fontFamily, size: 12 }
        }
      },
      tooltip: {
        titleFont: { family: _chartTheme.fontFamily },
        bodyFont: { family: _chartTheme.fontFamily },
        backgroundColor: 'rgba(24, 24, 27, 0.95)',
        titleColor: '#ffffff',
        bodyColor: '#d4d4d8',
        borderColor: 'rgba(161, 161, 170, 0.2)',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10
      }
    }
  };
  // Deep-ish merge of overrides
  return _deepMerge(base, overrides || {});
}

/**
 * Simple recursive object merge (b overrides a).
 */
function _deepMerge(a, b) {
  var result = Object.assign({}, a);
  Object.keys(b).forEach(function (key) {
    if (
      b[key] && typeof b[key] === 'object' && !Array.isArray(b[key]) &&
      a[key] && typeof a[key] === 'object' && !Array.isArray(a[key])
    ) {
      result[key] = _deepMerge(a[key], b[key]);
    } else {
      result[key] = b[key];
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// Subreddit Doughnut Chart
// ---------------------------------------------------------------------------

/**
 * Renders a doughnut chart of subreddit distribution.
 * @param {string} canvasId - ID of the target <canvas>
 * @param {Array}  subredditData - Output of analyzeSubreddits()
 */
function renderSubredditChart(canvasId, subredditData) {
  _destroyExistingChart(canvasId);

  var top = (subredditData || []).slice(0, 10);
  var labels = top.map(function (s) { return 'r/' + s.name; });
  var data = top.map(function (s) { return s.totalCount; });
  var totalActivity = data.reduce(function (sum, v) { return sum + v; }, 0);

  var ctx = document.getElementById(canvasId).getContext('2d');
  var chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: CHART_COLORS.slice(0, top.length),
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: _baseOptions({
      cutout: '65%',
      plugins: {
        legend: {
          position: window.innerWidth >= 768 ? 'right' : 'bottom',
          labels: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 12 },
            padding: 14,
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              var value = context.parsed;
              var pct = totalActivity > 0
                ? ((value / totalActivity) * 100).toFixed(1)
                : '0.0';
              return context.label + ': ' + value + ' (' + pct + '%)';
            }
          }
        }
      },
      onHover: function (event, elements) {
        event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
      }
    })
  });

  _storeChart(canvasId, chart);
  return chart;
}

// ---------------------------------------------------------------------------
// Hourly Activity Bar Chart
// ---------------------------------------------------------------------------

/**
 * Renders a bar chart of activity per UTC hour.
 * @param {string}   canvasId   - ID of the target <canvas>
 * @param {number[]} hourlyData - Array of 24 numbers from analyzeHourlyActivity()
 */
function renderHourlyChart(canvasId, hourlyData) {
  _destroyExistingChart(canvasId);

  // Hour labels: 12AM, 1AM … 11PM
  var labels = [];
  for (var h = 0; h < 24; h++) {
    if (h === 0) labels.push('12AM');
    else if (h < 12) labels.push(h + 'AM');
    else if (h === 12) labels.push('12PM');
    else labels.push((h - 12) + 'PM');
  }

  var ctx = document.getElementById(canvasId).getContext('2d');

  // Create gradient fill
  var gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || 300);
  gradient.addColorStop(0, 'rgba(249, 115, 22, 0.6)');
  gradient.addColorStop(1, 'rgba(249, 115, 22, 0.02)');

  var chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Activity',
        data: hourlyData,
        backgroundColor: gradient,
        borderColor: '#f97316',
        borderWidth: 1,
        borderRadius: _chartTheme.borderRadius,
        borderSkipped: false
      }]
    },
    options: _baseOptions({
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 11 },
            maxRotation: 45,
            minRotation: 0
          },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 11 },
            precision: 0 // integer ticks only
          },
          grid: {
            color: _chartTheme.gridColor
          }
        }
      }
    })
  });

  _storeChart(canvasId, chart);
  return chart;
}

// ---------------------------------------------------------------------------
// Karma Timeline Line Chart
// ---------------------------------------------------------------------------

/**
 * Renders a cumulative karma line chart over time.
 * @param {string} canvasId    - ID of the target <canvas>
 * @param {Array}  timelineData - Output of analyzeKarmaTimeline()
 */
function renderKarmaChart(canvasId, timelineData) {
  _destroyExistingChart(canvasId);

  var labels = (timelineData || []).map(function (d) { return d.date; });
  var data = (timelineData || []).map(function (d) { return d.cumulativeKarma; });

  var ctx = document.getElementById(canvasId).getContext('2d');

  // Gradient fill below line
  var gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.clientHeight || 300);
  gradient.addColorStop(0, 'rgba(249, 115, 22, 0.35)');
  gradient.addColorStop(1, 'rgba(249, 115, 22, 0.0)');

  var chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Cumulative Karma',
        data: data,
        borderColor: '#f97316',
        backgroundColor: gradient,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#f97316',
        pointHoverBorderColor: '#ffffff',
        borderWidth: 2
      }]
    },
    options: _baseOptions({
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 11 },
            maxTicksLimit: 12,
            maxRotation: 45
          },
          grid: { display: false }
        },
        y: {
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 11 }
          },
          grid: {
            color: _chartTheme.gridColor
          }
        }
      }
    })
  });

  _storeChart(canvasId, chart);
  return chart;
}

// ---------------------------------------------------------------------------
// Activity Heatmap (GitHub-style, canvas-based)
// ---------------------------------------------------------------------------

/**
 * Renders a GitHub-style contribution heatmap inside a container div.
 * @param {string} containerId - ID of the target <div>
 * @param {Object} heatmapData - Output of analyzeActivityHeatmap()
 */
function renderActivityHeatmap(containerId, heatmapData) {
  var container = document.getElementById(containerId);
  if (!container) return;

  // Clear previous content
  container.innerHTML = '';

  var cells = heatmapData.cells || [];
  var maxCount = heatmapData.maxCount || 1;

  // Layout constants
  var cellSize = 12;
  var gap = 3;
  var step = cellSize + gap;
  var dayLabelWidth = 32;  // space for Mon/Wed/Fri labels
  var monthLabelHeight = 18; // space for month labels on top
  var cols = 53; // weeks
  var rows = 7;  // days (0 = Sun … 6 = Sat, displayed as Mon-Sun)

  var canvasWidth = dayLabelWidth + cols * step + gap;
  var canvasHeight = monthLabelHeight + rows * step + gap;

  // Create canvas
  var canvas = document.createElement('canvas');
  canvas.width = canvasWidth * 2;   // retina
  canvas.height = canvasHeight * 2;
  canvas.style.width = canvasWidth + 'px';
  canvas.style.height = canvasHeight + 'px';
  canvas.style.cursor = 'crosshair';

  var ctx = canvas.getContext('2d');
  ctx.scale(2, 2); // retina scaling

  // Color scale: 5 levels from empty to max
  var colorScale = [
    '#1a1a2e',                       // 0 activity
    'rgba(249, 115, 22, 0.2)',       // low
    'rgba(249, 115, 22, 0.4)',       // medium-low
    'rgba(249, 115, 22, 0.65)',      // medium-high
    '#f97316'                        // max
  ];

  function getColor(count) {
    if (count === 0) return colorScale[0];
    if (maxCount === 0) return colorScale[0];
    var ratio = count / maxCount;
    if (ratio <= 0.25) return colorScale[1];
    if (ratio <= 0.50) return colorScale[2];
    if (ratio <= 0.75) return colorScale[3];
    return colorScale[4];
  }

  // Build a lookup: 'YYYY-MM-DD' -> count
  var countMap = {};
  cells.forEach(function (c) { countMap[c.date] = c.count; });

  // Determine the start date (first cell) — align to the start of a week (Sunday)
  // cells are sorted ascending by date
  if (cells.length === 0) return;
  var firstDate = new Date(cells[0].date + 'T00:00:00Z');

  // Shift back to the previous Sunday if needed
  var startDay = firstDate.getUTCDay(); // 0=Sun
  var startDate = new Date(firstDate.getTime() - startDay * 86400000);

  // --- Draw month labels ---
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = _chartTheme.textColor;
  ctx.textBaseline = 'top';

  var lastMonth = -1;
  var MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                       'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (var col = 0; col < cols; col++) {
    var refDate = new Date(startDate.getTime() + col * 7 * 86400000);
    var m = refDate.getUTCMonth();
    if (m !== lastMonth) {
      lastMonth = m;
      ctx.fillText(MONTH_LABELS[m], dayLabelWidth + col * step, 2);
    }
  }

  // --- Draw day labels (Mon, Wed, Fri) ---
  ctx.textBaseline = 'middle';
  var dayLabels = { 1: 'Mon', 3: 'Wed', 5: 'Fri' };
  Object.keys(dayLabels).forEach(function (idx) {
    var row = parseInt(idx, 10);
    var y = monthLabelHeight + row * step + cellSize / 2;
    ctx.fillText(dayLabels[idx], 0, y);
  });

  // --- Draw cells ---
  // Store cell positions for tooltip hit-testing
  var cellPositions = []; // { x, y, w, h, date, count }

  for (var week = 0; week < cols; week++) {
    for (var day = 0; day < rows; day++) {
      var cellDate = new Date(startDate.getTime() + (week * 7 + day) * 86400000);
      var dateKey = cellDate.getUTCFullYear() + '-' +
        String(cellDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
        String(cellDate.getUTCDate()).padStart(2, '0');

      var count = countMap[dateKey] !== undefined ? countMap[dateKey] : -1;
      if (count === -1) continue; // date not in range

      var x = dayLabelWidth + week * step;
      var y = monthLabelHeight + day * step;

      ctx.fillStyle = getColor(count);
      ctx.beginPath();
      // Rounded rect (small radius)
      var r = 2;
      ctx.roundRect(x, y, cellSize, cellSize, r);
      ctx.fill();

      cellPositions.push({ x: x, y: y, w: cellSize, h: cellSize, date: dateKey, count: count });
    }
  }

  container.appendChild(canvas);

  // --- Tooltip on hover ---
  var tooltip = document.createElement('div');
  tooltip.style.cssText =
    'position:fixed;padding:6px 10px;background:rgba(24,24,27,0.95);color:#d4d4d8;' +
    'font-family:Inter,sans-serif;font-size:12px;border-radius:6px;pointer-events:none;' +
    'display:none;z-index:9999;border:1px solid rgba(161,161,170,0.2);white-space:nowrap;';
  document.body.appendChild(tooltip);

  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var mx = (e.clientX - rect.left) * (canvas.width / 2 / rect.width);
    var my = (e.clientY - rect.top) * (canvas.height / 2 / rect.height);

    var hit = null;
    for (var i = 0; i < cellPositions.length; i++) {
      var cp = cellPositions[i];
      if (mx >= cp.x && mx <= cp.x + cp.w && my >= cp.y && my <= cp.y + cp.h) {
        hit = cp;
        break;
      }
    }

    if (hit) {
      tooltip.textContent = hit.count + ' contribution' + (hit.count !== 1 ? 's' : '') +
        ' on ' + hit.date;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top = (e.clientY - 30) + 'px';
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', function () {
    tooltip.style.display = 'none';
  });
}

// ---------------------------------------------------------------------------
// Top Words Horizontal Bar Chart
// ---------------------------------------------------------------------------

/**
 * Renders a horizontal bar chart of top words.
 * @param {string} canvasId - ID of the target <canvas>
 * @param {Array}  topWords - Array of { word, count } from analyzeWritingStyle()
 */
function renderWordChart(canvasId, topWords) {
  _destroyExistingChart(canvasId);

  var top = (topWords || []).slice(0, 10);
  var labels = top.map(function (w) { return w.word; });
  var data = top.map(function (w) { return w.count; });

  var ctx = document.getElementById(canvasId).getContext('2d');

  var chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Frequency',
        data: data,
        backgroundColor: CHART_COLORS.slice(0, top.length),
        borderWidth: 0,
        borderRadius: _chartTheme.borderRadius,
        borderSkipped: false
      }]
    },
    options: _baseOptions({
      indexAxis: 'y',
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 11 },
            precision: 0
          },
          grid: {
            color: _chartTheme.gridColor
          }
        },
        y: {
          ticks: {
            color: _chartTheme.textColor,
            font: { family: _chartTheme.fontFamily, size: 12 }
          },
          grid: { display: false }
        }
      }
    })
  });

  _storeChart(canvasId, chart);
  return chart;
}

// Word usage timeline
function renderWordTimeline(canvasId, timelineData, word) {
  _destroyExistingChart(canvasId);
  if (!timelineData || timelineData.length === 0) return;
  var ctx = document.getElementById(canvasId).getContext('2d');
  var gradient = ctx.createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(6,182,212,0.35)');
  gradient.addColorStop(1, 'rgba(6,182,212,0)');
  var chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: timelineData.map(function(d){ return d.date; }),
      datasets: [{ label: '"' + word + '" usage', data: timelineData.map(function(d){ return d.count; }),
        borderColor: '#06b6d4', backgroundColor: gradient, fill: true, tension: 0.4,
        pointRadius: 3, pointHoverRadius: 5, borderWidth: 2 }]
    },
    options: _baseOptions({ plugins: { legend: { display: false } },
      scales: { x: { ticks: { color: _chartTheme.textColor, font: { family: _chartTheme.fontFamily, size: 11 }, maxTicksLimit: 12 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: _chartTheme.textColor, font: { family: _chartTheme.fontFamily, size: 11 }, precision: 0 }, grid: { color: _chartTheme.gridColor } } } })
  });
  _storeChart(canvasId, chart);
}
