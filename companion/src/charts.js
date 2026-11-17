// Small charts for the calculators: a line (with a crosshair and tooltip on hover) and a meter
// (a horizontal bar of amounts against a limit). Plain script; exposes `CompanionCharts`.
// Calling a chart again on the same element updates it in place and animates from the old values to
// the new ones, so moving a slider glides the line, the marker and the bars. Instant when the system
// asks for reduced motion. Colours come from the page's tokens (styles.css): light and dark both work.
var CompanionCharts = (function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg', TAU = 85; // ms: how quickly a chart catches up with its target
  var reduced = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function set(e, attrs) { for (var k in attrs) e.setAttribute(k, attrs[k]); }
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
  // Moves every number in `cur` towards the same number in `target`. Frame-rate independent
  // exponential smoothing: a new target mid-move just changes where it's heading, so dragging a
  // slider gives one continuous glide rather than a string of restarts.
  function approach(cur, target, k) {
    var moving = false;
    Object.keys(target).forEach(function (key) {
      var a = cur[key], b = target[key];
      if (Array.isArray(b)) {
        if (!Array.isArray(a) || a.length !== b.length) { cur[key] = b.slice(); return; }
        for (var i = 0; i < b.length; i++) { a[i] += (b[i] - a[i]) * k; if (Math.abs(b[i] - a[i]) > Math.abs(b[i]) * 1e-3 + 0.05) moving = true; else a[i] = b[i]; }
      } else if (b == null || a == null) { cur[key] = b; }
      else { cur[key] = a + (b - a) * k; if (Math.abs(b - cur[key]) > Math.abs(b) * 1e-3 + 0.05) moving = true; else cur[key] = b; }
    });
    return moving;
  }
  function follow(c, draw) {
    clearTimeout(c.done);
    if (reduced || typeof requestAnimationFrame === 'undefined') { approach(c.cur, c.target, 1); draw(); return; }
    if (!c.raf) {
      var last = null;
      var frame = function (now) {
        var dt = last == null ? 16 : Math.min(64, now - last); last = now; c.seen = Date.now();
        var moving = approach(c.cur, c.target, 1 - Math.exp(-dt / TAU));
        draw();
        c.raf = moving ? requestAnimationFrame(frame) : 0;
      };
      c.raf = requestAnimationFrame(frame);
    }
    // A background tab pauses animation frames: make sure the chart still lands on the new values.
    c.done = setTimeout(function () {
      if (c.raf && Date.now() - (c.seen || 0) > 150) { cancelAnimationFrame(c.raf); c.raf = 0; approach(c.cur, c.target, 1); draw(); }
    }, 400);
  }

  // ----- line -----
  // opts: { points: [[x, y]], fx, fy (formatters), xTicks: [x], marker: { x, y }, band: [x0, x1, label], label, yMax }
  var LW = 560, LH = 210, LL = 56, LR = 14, LT = 14, LB = 34, PW = LW - LL - LR, PH = LH - LT - LB;
  function line(host, opts) {
    var pts = opts.points, yMax = opts.yMax || niceMax(Math.max.apply(null, pts.map(function (p) { return p[1]; })) * 1.08);
    var target = { ys: pts.map(function (p) { return p[1]; }), yMax: yMax, mx: opts.marker ? opts.marker.x : null, my: opts.marker ? opts.marker.y : null };
    var c = host._chart;
    if (!c || c.kind !== 'line' || c.xs.length !== pts.length || c.xs[0] !== pts[0][0] || c.xs[c.xs.length - 1] !== pts[pts.length - 1][0]) c = buildLine(host, opts, target);
    c.opts = opts; c.target = target;
    c.svg.setAttribute('aria-label', opts.label || '');
    // Labels jump to the new values; the shapes glide.
    c.yLabels.forEach(function (t, i) { t.textContent = opts.fy(yMax * [0, 0.5, 1][i]); });
    if (c.cur.mx == null && target.mx != null) { c.cur.mx = target.mx; c.cur.my = target.my; }
    follow(c, function () { drawLine(c); });
  }
  function buildLine(host, opts, target) {
    host.innerHTML = '';
    host.classList.add('chart');
    var pts = opts.points, xs = pts.map(function (p) { return p[0]; }), x0 = xs[0], x1 = xs[xs.length - 1];
    var c = { kind: 'line', xs: xs, sx: function (x) { return LL + (x - x0) / (x1 - x0) * PW; }, raf: 0 };
    var svg = c.svg = el('svg', { viewBox: '0 0 ' + LW + ' ' + LH, role: 'img' }, host);
    if (opts.band) {
      el('rect', { x: c.sx(opts.band[0]), y: LT, width: c.sx(opts.band[1]) - c.sx(opts.band[0]), height: PH, class: 'ch-band' }, svg);
      if (opts.band[2]) text(svg, (c.sx(opts.band[0]) + c.sx(opts.band[1])) / 2, LT + 12, opts.band[2], 'ch-text ch-band-label', 'middle');
    }
    c.yLabels = [0, 0.5, 1].map(function (f) {
      var y = LT + PH - f * PH;
      el('line', { x1: LL, x2: LW - LR, y1: y, y2: y, class: f ? 'ch-grid' : 'ch-axis' }, svg);
      return text(svg, LL - 8, y + 4, '', 'ch-text', 'end');
    });
    (opts.xTicks || [x0, x1]).forEach(function (x) { text(svg, c.sx(x), LH - 12, opts.fx(x), 'ch-text', 'middle'); });
    c.area = el('path', { class: 'ch-area' }, svg);
    c.path = el('path', { class: 'ch-line' }, svg);
    c.mline = el('line', { y1: LT, y2: LT + PH, class: 'ch-marker-line' }, svg);
    c.mdot = el('circle', { r: 5, class: 'ch-dot' }, svg);
    var cross = el('line', { y1: LT, y2: LT + PH, class: 'ch-cross', visibility: 'hidden' }, svg);
    var dot = el('circle', { r: 4.5, class: 'ch-dot ch-hover', visibility: 'hidden' }, svg);
    var tip = document.createElement('div'); tip.className = 'ch-tip'; tip.hidden = true; host.appendChild(tip);
    var hit = el('rect', { x: LL, y: LT, width: PW, height: PH, class: 'ch-hit' }, svg);
    // Hover: crosshair and tooltip at the nearest point (always the latest values).
    hit.addEventListener('pointermove', function (evt) {
      var r = svg.getBoundingClientRect(), x = (evt.clientX - r.left) / r.width * LW, i = 0;
      c.xs.forEach(function (px, j) { if (Math.abs(c.sx(px) - x) < Math.abs(c.sx(c.xs[i]) - x)) i = j; });
      var px = c.sx(c.xs[i]), y = c.target.ys[i], py = LT + PH - y / c.target.yMax * PH;
      set(cross, { x1: px, x2: px, visibility: 'visible' }); set(dot, { cx: px, cy: py, visibility: 'visible' });
      tip.innerHTML = '<b>' + c.opts.fy(y) + '</b><span>' + c.opts.fx(c.xs[i]) + '</span>';
      tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, px / LW * r.width - tip.offsetWidth / 2)) + 'px';
      tip.style.top = Math.max(0, py / LH * r.height - tip.offsetHeight - 10) + 'px';
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; });
    c.cur = { ys: target.ys.slice(), yMax: target.yMax, mx: target.mx, my: target.my };
    host._chart = c;
    drawLine(c);
    return c;
  }
  function drawLine(c) {
    var sy = function (y) { return LT + PH - y / c.cur.yMax * PH; };
    var d = c.xs.map(function (x, i) { return (i ? 'L' : 'M') + c.sx(x).toFixed(1) + ' ' + sy(c.cur.ys[i]).toFixed(1); }).join(' ');
    c.path.setAttribute('d', d);
    c.area.setAttribute('d', d + ' L' + c.sx(c.xs[c.xs.length - 1]) + ' ' + sy(0) + ' L' + c.sx(c.xs[0]) + ' ' + sy(0) + ' Z');
    var show = c.cur.mx != null;
    c.mline.setAttribute('visibility', show ? 'visible' : 'hidden'); c.mdot.setAttribute('visibility', show ? 'visible' : 'hidden');
    if (show) {
      var mx = c.sx(Math.max(c.xs[0], Math.min(c.xs[c.xs.length - 1], c.cur.mx)));
      set(c.mline, { x1: mx, x2: mx }); set(c.mdot, { cx: mx, cy: sy(c.cur.my) });
    }
  }

  // ----- meter -----
  // opts: { parts: [{ value, label, cls }], max, marks: [{ value, label }], fmt, label }
  var MW = 560, MH = 74, ML = 4, MR = 4, BH = 22, TOP = 22, MPW = MW - ML - MR;
  function meter(host, opts) {
    var total = opts.parts.reduce(function (t, p) { return t + Math.max(0, p.value); }, 0);
    var target = { vals: opts.parts.map(function (p) { return Math.max(0, p.value); }), scale: Math.max(opts.max || 0, total, 1) * 1.04,
      marks: (opts.marks || []).map(function (m) { return m.value; }) };
    var c = host._chart;
    var sig = opts.parts.map(function (p) { return p.cls + p.label; }).join('|') + '#' + (opts.marks || []).map(function (m) { return m.label; }).join('|');
    if (!c || c.kind !== 'meter' || c.parts.length !== opts.parts.length) c = buildMeter(host, opts, target);
    if (c.sig !== sig) setMarks(c, opts.marks || [], target.marks);
    c.sig = sig; c.opts = opts;
    c.svg.setAttribute('aria-label', opts.label || '');
    c.legend.innerHTML = opts.parts.filter(function (p) { return p.value > 0; }).map(function (p) {
      return '<span><i class="ch-key ' + (p.cls || '') + '"></i>' + p.label + ' <b>' + opts.fmt(p.value) + '</b></span>';
    }).join('');
    if (c.cur.marks.length !== target.marks.length) c.cur.marks = target.marks.map(function (v, i) { return c.cur.marks[i] != null ? c.cur.marks[i] : v; });
    c.target = target;
    follow(c, function () { drawMeter(c); });
  }
  function buildMeter(host, opts, target) {
    host.innerHTML = '';
    host.classList.add('chart', 'meter');
    var c = { kind: 'meter', raf: 0, sig: null };
    var svg = c.svg = el('svg', { viewBox: '0 0 ' + MW + ' ' + MH, role: 'img' }, host);
    el('rect', { x: ML, y: TOP, width: MPW, height: BH, rx: 4, class: 'ch-track' }, svg);
    var tip = document.createElement('div'); tip.className = 'ch-tip'; tip.hidden = true;
    c.parts = opts.parts.map(function (p, i) {
      var r = el('rect', { y: TOP, height: BH, rx: 4, class: 'ch-part ' + (p.cls || '') }, svg);
      r.addEventListener('pointermove', function (evt) {
        var q = c.opts.parts[i], b = svg.getBoundingClientRect();
        tip.innerHTML = '<b>' + c.opts.fmt(q.value) + '</b><span>' + q.label + '</span>'; tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(b.width - tip.offsetWidth, evt.clientX - b.left - tip.offsetWidth / 2)) + 'px';
        tip.style.top = '-6px';
      });
      r.addEventListener('pointerleave', function () { tip.hidden = true; });
      return r;
    });
    c.markGroup = el('g', {}, svg);
    host.appendChild(tip);
    c.legend = document.createElement('div'); c.legend.className = 'ch-legend'; host.appendChild(c.legend);
    c.cur = { vals: target.vals.map(function () { return 0; }), scale: target.scale, marks: target.marks.slice() };
    host._chart = c;
    return c;
  }
  function setMarks(c, marks) {
    c.markGroup.innerHTML = '';
    c.marks = marks.map(function (m, i) {
      return { line: el('line', { y1: TOP - 6, y2: TOP + BH + 6, class: 'ch-limit' }, c.markGroup),
        label: text(c.markGroup, 0, i % 2 ? TOP + BH + 20 : TOP - 9, m.label, 'ch-text ch-limit-label') };
    });
  }
  function drawMeter(c) {
    var sx = function (v) { return ML + v / c.cur.scale * MPW; }, at = 0;
    c.parts.forEach(function (r, i) {
      var v = c.cur.vals[i];
      if (v <= 0.5) { r.setAttribute('width', 0); return; }
      var x = sx(at);
      set(r, { x: x, width: Math.max(1, sx(at + v) - x - 2) });
      at += v;
    });
    (c.marks || []).forEach(function (m, i) {
      var x = sx(c.cur.marks[i]);
      set(m.line, { x1: x, x2: x });
      set(m.label, { x: x, 'text-anchor': x > MW * 0.8 ? 'end' : x < MW * 0.2 ? 'start' : 'middle' });
    });
  }

  return { line: line, meter: meter };
})();
