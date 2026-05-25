// ============================================================================
// graph.js — D3.js Force-Directed Connection Graph
// D3 v7 loaded via CDN, assumed globally available
// ============================================================================

(function() {
  'use strict';

  let simulation = null;
  let currentSvg = null;

  // ---------------------------------------------------------------------------
  // renderConnectionGraph(containerId, graphData)
  // graphData = { nodes: [{id, label, weight, isCenter, color}],
  //               edges: [{source, target, weight}] }
  // ---------------------------------------------------------------------------
  function renderConnectionGraph(containerId, graphData) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Clear previous
    container.innerHTML = '';
    if (simulation) { simulation.stop(); simulation = null; }

    const { nodes, edges } = graphData;
    if (!nodes || nodes.length === 0) {
      container.innerHTML = '<div class="graph-empty">No connection data found. This user only posts without replying to others.</div>';
      return;
    }

    const width = container.clientWidth || 700;
    const height = container.clientHeight || 500;

    // Create SVG
    const svg = d3.select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('overflow', 'hidden');

    currentSvg = svg;

    // Zoom behavior
    const g = svg.append('g');
    svg.call(d3.zoom()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => g.attr('transform', event.transform))
    );

    // Arrowhead marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .append('path')
      .attr('d', 'M 0,-5 L 10 ,0 L 0,5')
      .attr('fill', 'rgba(161, 161, 170, 0.4)');

    // Scale for node radius by weight
    const maxWeight = Math.max(...nodes.map(n => n.weight || 1));
    const rScale = d3.scaleSqrt().domain([1, maxWeight]).range([6, 28]);

    // Scale for edge width
    const maxEdgeWeight = edges.length > 0 ? Math.max(...edges.map(e => e.weight || 1)) : 1;
    const edgeScale = d3.scaleLinear().domain([1, maxEdgeWeight]).range([1, 5]);

    // Force simulation
    simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(edges)
        .id(d => d.id)
        .distance(d => 80 + (maxWeight - (d.weight || 1)) * 3)
        .strength(0.4)
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => rScale(d.weight || 1) + 8));

    // Draw edges
    const link = g.append('g').attr('class', 'graph-links')
      .selectAll('line')
      .data(edges)
      .join('line')
      .attr('stroke', 'rgba(161, 161, 170, 0.25)')
      .attr('stroke-width', d => edgeScale(d.weight || 1))
      .attr('marker-end', 'url(#arrowhead)');

    // Draw edge weight labels (only for weight > 1)
    const edgeLabel = g.append('g').attr('class', 'graph-edge-labels')
      .selectAll('text')
      .data(edges.filter(e => e.weight > 1))
      .join('text')
      .attr('fill', 'rgba(161, 161, 170, 0.5)')
      .attr('font-size', '9px')
      .attr('font-family', 'Inter, sans-serif')
      .attr('text-anchor', 'middle')
      .text(d => d.weight + 'x');

    // Draw nodes
    const node = g.append('g').attr('class', 'graph-nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('class', 'graph-node')
      .style('cursor', 'pointer')
      .call(d3.drag()
        .on('start', dragStart)
        .on('drag', dragged)
        .on('end', dragEnd)
      );

    // Node circles
    node.append('circle')
      .attr('r', d => rScale(d.weight || 1))
      .attr('fill', d => d.color || '#71717a')
      .attr('fill-opacity', d => d.isCenter ? 1 : 0.85)
      .attr('stroke', d => d.isCenter ? '#fff' : 'rgba(255,255,255,0.15)')
      .attr('stroke-width', d => d.isCenter ? 2.5 : 1)
      .style('filter', d => d.isCenter ? 'drop-shadow(0 0 12px rgba(249,115,22,0.6))' : 'none');

    // Pulse animation for center node
    node.filter(d => d.isCenter)
      .append('circle')
      .attr('r', d => rScale(d.weight || 1) + 5)
      .attr('fill', 'none')
      .attr('stroke', '#f97316')
      .attr('stroke-width', 1.5)
      .attr('opacity', 0.4)
      .attr('class', 'pulse-ring');

    // Node labels
    node.append('text')
      .attr('dy', d => rScale(d.weight || 1) + 13)
      .attr('text-anchor', 'middle')
      .attr('fill', '#a1a1aa')
      .attr('font-size', '10px')
      .attr('font-family', 'Inter, sans-serif')
      .text(d => {
        const name = (d.label || d.id).replace('u/', '');
        return name.length > 14 ? name.slice(0, 12) + '…' : name;
      });

    // Interaction count badge (non-center nodes)
    node.filter(d => !d.isCenter && d.weight > 1)
      .append('text')
      .attr('dy', '0.35em')
      .attr('text-anchor', 'middle')
      .attr('fill', '#fff')
      .attr('font-size', '9px')
      .attr('font-weight', '700')
      .attr('font-family', 'Inter, sans-serif')
      .text(d => d.weight);

    // Tooltip
    const tooltip = d3.select(container)
      .append('div')
      .attr('class', 'graph-tooltip')
      .style('position', 'absolute')
      .style('display', 'none')
      .style('background', 'rgba(24,24,27,0.97)')
      .style('border', '1px solid rgba(249,115,22,0.3)')
      .style('border-radius', '8px')
      .style('padding', '8px 12px')
      .style('font-size', '12px')
      .style('font-family', 'Inter, sans-serif')
      .style('color', '#d4d4d8')
      .style('pointer-events', 'none')
      .style('z-index', '100')
      .style('max-width', '200px');

    node
      .on('mouseenter', function(event, d) {
        const rect = container.getBoundingClientRect();
        tooltip
          .style('display', 'block')
          .style('left', (event.clientX - rect.left + 12) + 'px')
          .style('top', (event.clientY - rect.top - 40) + 'px')
          .html(d.isCenter
            ? `<strong style="color:#f97316">${d.label}</strong><br/>Central user being analyzed`
            : `<strong style="color:#fb923c">${d.label}</strong><br/>Replied to: <strong>${d.weight}</strong> time${d.weight !== 1 ? 's' : ''}`
          );
        // Highlight connected edges
        link.attr('stroke', l =>
          (l.source.id === d.id || l.target.id === d.id)
            ? '#f97316'
            : 'rgba(161, 161, 170, 0.15)'
        );
      })
      .on('mouseleave', function() {
        tooltip.style('display', 'none');
        link.attr('stroke', 'rgba(161, 161, 170, 0.25)');
      })
      .on('click', function(event, d) {
        if (!d.isCenter) {
          if (window.showConnectionDetails) {
            window.showConnectionDetails(d.id);
          }
        }
      });

    // Tick update
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      edgeLabel
        .attr('x', d => (d.source.x + d.target.x) / 2)
        .attr('y', d => (d.source.y + d.target.y) / 2);

      node.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragStart(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x; d.fy = event.y;
    }
    function dragEnd(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    }
  }

  // Expose globally
  window.renderConnectionGraph = renderConnectionGraph;

})();
