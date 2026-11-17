// Small charts for the calculators: a line (with a crosshair and tooltip on hover) and a meter
// (a horizontal bar of amounts against a limit). Plain script; exposes `CompanionCharts`.
// Colours come from the page's tokens (styles.css), so light and dark modes both work.
// Single series throughout: the line is one measure, the meter's parts are labelled in a legend.
var CompanionCharts = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, s, cls, anchor) {
    var t = el('text', { x: x, y: y, class: cls || 'ch-text', 'text-anchor': anchor || 'start' }, parent);
    t.textContent = s;
    return t;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }

  // opts: { points: [[x, y]], fx, fy (formatters), xTicks: [x], marker: { x, y }, band: [x0, x1, label],
  //         label: accessible description, yMax }
  function line(host, opts) {
    host.innerHTML = '';
    host.classList.add('chart');
    var W = 560, H = 210, L = 56, Rt = 14, T = 14, B = 34, pw = W - L - Rt, ph = H - T - B;
    var pts = opts.points, x0 = pts[0][0], x1 = pts[pts.length - 1][0];
    var yMax = opts.yMax || niceMax(Math.max.apply(null, pts.map(function (p) { return p[1]; })) * 1.08);
    var sx = function (x) { return L + (x - x0) / (x1 - x0) * pw; }, sy = function (y) { return T + ph - y / yMax * ph; };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || '' }, host);
    if (opts.band) {
      el('rect', { x: sx(opts.band[0]), y: T, width: sx(opts.band[1]) - sx(opts.band[0]), height: ph, class: 'ch-band' }, svg);
      if (opts.band[2]) text(svg, (sx(opts.band[0]) + sx(opts.band[1])) / 2, T + 12, opts.band[2], 'ch-text ch-band-label', 'middle');
    }
    [0, 0.5, 1].forEach(function (f) {
      var y = sy(yMax * f);
      el('line', { x1: L, x2: W - Rt, y1: y, y2: y, class: f ? 'ch-grid' : 'ch-axis' }, svg);
      text(svg, L - 8, y + 4, opts.fy(yMax * f), 'ch-text', 'end');
    });
    (opts.xTicks || [x0, x1]).forEach(function (x) { text(svg, sx(x), H - 12, opts.fx(x), 'ch-text', 'middle'); });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join(' ');
    el('path', { d: d + ' L' + sx(x1) + ' ' + sy(0) + ' L' + sx(x0) + ' ' + sy(0) + ' Z', class: 'ch-area' }, svg);
    el('path', { d: d, class: 'ch-line' }, svg);
    if (opts.marker) {
      var mx = sx(Math.max(x0, Math.min(x1, opts.marker.x))), my = sy(opts.marker.y);
      el('line', { x1: mx, x2: mx, y1: T, y2: T + ph, class: 'ch-marker-line' }, svg);
      el('circle', { cx: mx, cy: my, r: 5, class: 'ch-dot' }, svg);
    }
    // Hover: crosshair and tooltip at the nearest point.
    var cross = el('line', { y1: T, y2: T + ph, class: 'ch-cross', visibility: 'hidden' }, svg);
    var dot = el('circle', { r: 4.5, class: 'ch-dot ch-hover', visibility: 'hidden' }, svg);
    var tip = document.createElement('div'); tip.className = 'ch-tip'; tip.hidden = true; host.appendChild(tip);
    var hit = el('rect', { x: L, y: T, width: pw, height: ph, class: 'ch-hit' }, svg);
    function show(evt) {
      var r = svg.getBoundingClientRect(), x = (evt.clientX - r.left) / r.width * W;
      var best = pts[0];
      pts.forEach(function (p) { if (Math.abs(sx(p[0]) - x) < Math.abs(sx(best[0]) - x)) best = p; });
      var px = sx(best[0]), py = sy(best[1]);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + opts.fy(best[1]) + '</b><span>' + opts.fx(best[0]) + '</span>';
      tip.hidden = false;
      var left = px / W * r.width;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, left - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, py / H * r.height - tip.offsetHeight - 10) + 'px';
    }
    function hide() { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerleave', hide);
  }

  // opts: { parts: [{ value, label, cls }], max, marks: [{ value, label }], fmt, label }
  function meter(host, opts) {
    host.innerHTML = '';
    host.classList.add('chart', 'meter');
    var total = opts.parts.reduce(function (t, p) { return t + Math.max(0, p.value); }, 0);
    var max = Math.max(opts.max || 0, total, 1) * 1.04;
    var W = 560, H = 74, L = 4, Rt = 4, bh = 22, top = 22, pw = W - L - Rt;
    var sx = function (v) { return L + v / max * pw; };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label || '' }, host);
    el('rect', { x: L, y: top, width: pw, height: bh, rx: 4, class: 'ch-track' }, svg);
    var at = 0, tip = document.createElement('div');
    tip.className = 'ch-tip'; tip.hidden = true; host.appendChild(tip);
    opts.parts.forEach(function (p) {
      if (p.value <= 0) return;
      var x = sx(at), w = Math.max(1, sx(at + p.value) - x - 2);
      var r = el('rect', { x: x, y: top, width: w, height: bh, rx: 4, class: 'ch-part ' + (p.cls || '') }, svg);
      r.addEventListener('pointermove', function (evt) {
        var b = svg.getBoundingClientRect();
        tip.innerHTML = '<b>' + opts.fmt(p.value) + '</b><span>' + p.label + '</span>'; tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(b.width - tip.offsetWidth, evt.clientX - b.left - tip.offsetWidth / 2)) + 'px';
        tip.style.top = '-6px';
      });
      r.addEventListener('pointerleave', function () { tip.hidden = true; });
      at += p.value;
    });
    (opts.marks || []).forEach(function (m, i) {
      var x = sx(m.value);
      el('line', { x1: x, x2: x, y1: top - 6, y2: top + bh + 6, class: 'ch-limit' }, svg);
      text(svg, x, i % 2 ? top + bh + 20 : top - 9, m.label, 'ch-text ch-limit-label', x > W * 0.8 ? 'end' : x < W * 0.2 ? 'start' : 'middle');
    });
    var legend = document.createElement('div');
    legend.className = 'ch-legend';
    legend.innerHTML = opts.parts.filter(function (p) { return p.value > 0; }).map(function (p) {
      return '<span><i class="ch-key ' + (p.cls || '') + '"></i>' + p.label + ' <b>' + opts.fmt(p.value) + '</b></span>';
    }).join('');
    host.appendChild(legend);
  }

  return { line: line, meter: meter };
})();
