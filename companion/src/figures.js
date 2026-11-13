// Isometric line figures that respond to the pointer, used to explain rules visually.
// Plain script; exposes `CompanionFigures.mount(el, name, options)` -> { destroy }.
//
// The camera maths (rotate the ground plane by an azimuth, squash it by k = sin(elevation),
// lift by z * sqrt(1 - k^2)), the spring constants and the shared requestAnimationFrame loop
// follow the approach of "hairline" by Lucas Marques (https://github.com/lucasmarkes/hairline).
// The figures themselves (bands, months, layers, cap, terrain) are written for this companion.
//
// hairline's licence, which applies to the parts adapted from it:
//   MIT License
//   Copyright (c) 2026 Lucas Marques
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
//   and associated documentation files (the "Software"), to deal in the Software without
//   restriction, including without limitation the rights to use, copy, modify, merge, publish,
//   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or
//   substantial portions of the Software.
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
//   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
//   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
var CompanionFigures = (function () {
  'use strict';
  var W = 400, H = 320, NS = 'http://www.w3.org/2000/svg';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ----- camera -----
  function cam(azDeg, k) { return { az: azDeg * Math.PI / 180, k: k, S: 1, ox: 0, oy: 0 }; }
  function proj(C) {
    var c = Math.cos(C.az), s = Math.sin(C.az), zf = Math.sqrt(1 - C.k * C.k);
    return function (x, y, z) {
      var X = x * c - y * s, Y = x * s + y * c;
      return [C.ox + C.S * X, C.oy + C.S * (Y * C.k - z * zf)];
    };
  }
  function unproj(C, sx, sy, z) {
    var c = Math.cos(C.az), s = Math.sin(C.az), zf = Math.sqrt(1 - C.k * C.k);
    var X = (sx - C.ox) / C.S, Y = ((sy - C.oy) / C.S + z * zf) / C.k;
    return [X * c + Y * s, -X * s + Y * c];
  }
  // Scale and centre the camera so every point fits the drawing area (leaving room for labels).
  function fit(C, pts, box) {
    C.S = 1; C.ox = 0; C.oy = 0;
    var P = proj(C), x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    pts.forEach(function (p) { var q = P(p[0], p[1], p[2]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); });
    var S = Math.min((box.w) / (x1 - x0), (box.h) / (y1 - y0));
    C.S = S;
    C.ox = box.x + (box.w - S * (x1 - x0)) / 2 - S * x0;
    C.oy = box.y + (box.h - S * (y1 - y0)) / 2 - S * y0;
  }

  // ----- motion: critically-damped-ish spring, substepped for stability -----
  function spring(x) { return { x: x, v: 0, t: x }; }
  function stepS(sp, dt) {
    if (reduced) { sp.x = sp.t; sp.v = 0; return false; }
    var n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (var i = 0; i < n; i++) { var a = -100 * (sp.x - sp.t) - 18 * sp.v; sp.v += a * h; sp.x += sp.v * h; }
    if (Math.abs(sp.x - sp.t) < 0.002 && Math.abs(sp.v) < 0.02) { sp.x = sp.t; sp.v = 0; return false; }
    return true;
  }

  // ----- one shared animation loop for every figure on the page -----
  var boards = [], raf = 0, last = 0;
  function frame(now) {
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000)), any = false;
    last = now;
    boards.slice().forEach(function (b) {
      if (!b.awake) return;
      try { b.awake = !!b.tick(dt); } catch (e) { b.awake = false; setTimeout(function () { throw e; }); }
      any = any || b.awake;
    });
    raf = any ? requestAnimationFrame(frame) : 0;
  }
  function wake(b) { b.awake = true; if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  // ----- svg helpers -----
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function assume(id, html) { return '<span class="assume" data-assumption="' + id + '" tabindex="0">' + html + '</span>'; }
  function assume(id, html) { return '<span class="assume" data-assumption="' + id + '" tabindex="0">' + html + '</span>'; }
  function r2(v) { return Math.round(v * 100) / 100; }
  function path(pts) { return 'M' + pts.map(function (p) { return r2(p[0]) + ' ' + r2(p[1]); }).join('L') + 'Z'; }
  // Box from ground rectangle (x, y, w, d) between heights z0 and z1. With the camera at
  // azimuth 45°, the faces at x + w and y + d face the viewer.
  function box(P, x, y, w, d, z0, z1) {
    return {
      top: path([P(x, y, z1), P(x + w, y, z1), P(x + w, y + d, z1), P(x, y + d, z1)]),
      right: path([P(x + w, y, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x + w, y, z1)]),
      front: path([P(x, y + d, z0), P(x + w, y + d, z0), P(x + w, y + d, z1), P(x, y + d, z1)])
    };
  }
  function boxEls(g) {
    return { right: el('path', { class: 'f-side' }, g), front: el('path', { class: 'f-front' }, g), top: el('path', { class: 'f-top' }, g) };
  }
  function setBox(b, shape) { b.top.setAttribute('d', shape.top); b.right.setAttribute('d', shape.right); b.front.setAttribute('d', shape.front); }
  function text(parent, x, y, str, cls, anchor) {
    var t = el('text', { x: r2(x), y: r2(y), class: cls || 'f-label', 'text-anchor': anchor || 'middle' }, parent);
    t.textContent = str;
    return t;
  }

  // Common shell: svg + caption, pointer and keyboard wiring.
  function stage(host, label) {
    host.classList.add('figure');
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': label, tabindex: '0', focusable: 'true' });
    host.appendChild(svg);
    var cap = document.createElement('div');
    cap.className = 'figure-caption';
    cap.setAttribute('aria-live', 'polite');
    host.appendChild(cap);
    function pt(e) { var r = svg.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; }
    return { svg: svg, cap: cap, pt: pt };
  }

  function makeBoard(st, tick, handlers) {
    var b = { awake: false, tick: tick };
    boards.push(b);
    tick(0); // draw the resting shape now, even if animation frames are paused (background tab)
    function on(type, fn) { st.svg.addEventListener(type, fn); }
    if (handlers.move) on('pointermove', function (e) { handlers.move(st.pt(e), e); wake(b); });
    if (handlers.leave) on('pointerleave', function (e) {
      var go = function () { handlers.leave(); wake(b); };
      if (e.pointerType === 'touch') setTimeout(go, 1400); else go();
    });
    if (handlers.key) on('keydown', function (e) { if (handlers.key(e)) { e.preventDefault(); wake(b); } });
    wake(b);
    return {
      wake: function () { wake(b); },
      destroy: function () { boards.splice(boards.indexOf(b), 1); b.awake = false; st.svg.remove(); st.cap.remove(); }
    };
  }

  // ----- figure: bands (minimum percentage by age) -----
  // Seven pillars, height = minimum %. The pillar under the pointer lifts and is described.
  function bands(host, o) {
    var rows = o.rows, n = rows.length, gap = 1.45, maxPct = 0.14, scale = 16;
    var st = stage(host, 'Pillars showing the minimum pension payment for each age band');
    var C = cam(45, 0.5);
    var pts = [[-0.6, -0.6, 0], [n * gap, 1.6, 0], [n * gap, -0.6, maxPct * scale + 0.9], [-0.6, 1.6, maxPct * scale + 0.9], [0, 0, 0.04 * scale + 0.9]];
    fit(C, pts, { x: 24, y: 18, w: W - 48, h: H - 70 });
    var P = proj(C);
    var g = el('g', {}, st.svg);
    var plinth = boxEls(el('g', { class: 'f-plinth' }, g));
    setBox(plinth, box(P, -0.5, -0.4, n * gap + 0.1, 1.8, -0.25, 0));
    var cols = rows.map(function (r, i) {
      var gg = el('g', { class: 'f-col' }, g);
      return { g: gg, b: boxEls(gg), lift: spring(0), h: spring(r.pct * scale), label: null, value: null, i: i };
    });
    var labels = el('g', {}, st.svg);
    cols.forEach(function (c, i) {
      var q = P(i * gap + 0.5, 1.4, 0);
      c.label = text(labels, q[0] + 4, q[1] + 16, rows[i].short, 'f-label');
      c.value = text(labels, 0, 0, Math.round(rows[i].pct * 100) + '%', 'f-value');
      c.h.t = rows[i].pct * scale;
    });
    var sel = o.selected != null ? o.selected : -1, base = sel;
    function describe() {
      var r = rows[sel];
      st.cap.innerHTML = r ? '<b>' + r.label + '</b><span>' + Math.round(r.pct * 100) + '% of the balance each year' + (o.note && sel === base ? ' · ' + o.note : '') + '</span>'
        : '<b>Minimum by age</b><span>Point at a pillar</span>';
    }
    function pick(i) { sel = i; cols.forEach(function (c, j) { c.lift.t = j === i ? 0.45 : 0; c.g.classList.toggle('is-hi', j === i); }); describe(); }
    function tick(dt) {
      var moving = false;
      cols.forEach(function (c) {
        moving = stepS(c.h, dt) || moving;
        moving = stepS(c.lift, dt) || moving;
        var x = c.i * gap, z0 = c.lift.x, z1 = z0 + Math.max(0.05, c.h.x);
        setBox(c.b, box(P, x, 0, 1, 1, z0, z1));
        var q = P(x + 0.5, 0.5, z1);
        c.value.setAttribute('x', r2(q[0])); c.value.setAttribute('y', r2(q[1] - 12));
      });
      return moving;
    }
    pick(sel);
    return makeBoard(st, tick, {
      move: function (p) {
        var w = unproj(C, p[0], p[1], 0.3);
        var i = Math.max(0, Math.min(n - 1, Math.floor((w[0] + (gap - 1) / 2) / gap)));
        if (i !== sel) pick(i);
      },
      leave: function () { pick(base); },
      key: function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { pick(Math.min(n - 1, sel + 1)); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { pick(Math.max(0, sel - 1)); return true; }
        return false;
      }
    });
  }

  // ----- figure: months (first-year pro-rata) -----
  // Twelve tiles, July to June. Pointing at a month starts the pension there: the months that
  // count rise, and the caption gives the share of a full year's minimum.
  function months(host, o) {
    var names = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    var fyStartYear = o.fyStartYear, gap = 1.1;
    var st = stage(host, 'Twelve months of the financial year; months from the start date count towards the first-year minimum');
    var C = cam(45, 0.5);
    fit(C, [[-0.4, -0.4, 0], [12 * gap, 1.4, 0], [12 * gap, -0.4, 2.2], [-0.4, 1.4, 2.2]], { x: 18, y: 22, w: W - 36, h: H - 80 });
    var P = proj(C);
    var g = el('g', {}, st.svg), lab = el('g', {}, st.svg);
    var tiles = names.map(function (m, i) {
      var gg = el('g', { class: 'f-col' }, g);
      var q = P(i * gap + 0.45, 1.25, 0);
      text(lab, q[0] + 3, q[1] + 14, m.charAt(0), 'f-label');
      return { g: gg, b: boxEls(gg), h: spring(0.2), i: i };
    });
    var sel = o.selected != null ? o.selected : 3, base = sel;
    function daysFrom(i) {
      var y = i < 6 ? fyStartYear : fyStartYear + 1, start = new Date(y, (i + 6) % 12, 1), end = new Date(fyStartYear + 1, 5, 30);
      var total = Math.round((Date.UTC(fyStartYear + 1, 5, 30) - Date.UTC(fyStartYear, 6, 1)) / 864e5) + 1;
      return { left: Math.round((Date.UTC(end.getFullYear(), 5, 30) - Date.UTC(start.getFullYear(), start.getMonth(), 1)) / 864e5) + 1, total: total, y: y };
    }
    function pick(i) {
      sel = i;
      tiles.forEach(function (t, j) { t.h.t = j >= i ? 1.6 : 0.2; t.g.classList.toggle('is-hi', j === i); t.g.classList.toggle('is-on', j >= i); });
      var d = daysFrom(i), share = d.left / d.total;
      var amount = o.balance && o.pct ? Math.round(o.balance * o.pct * share / 10) * 10 : null;
      st.cap.innerHTML = '<b>' + assume('first-of-month', 'Starts 1 ' + names[i] + ' ' + d.y) + '</b><span>' + d.left + ' of ' + d.total + ' days count: ' + Math.round(share * 100) + '% of a full year’s minimum' +
        (amount ? ' · ' + (o.example ? assume('example-figures', '$' + amount.toLocaleString('en-AU') + ' on $' + o.balance.toLocaleString('en-AU') + ' at ' + Math.round(o.pct * 100) + '%') : '$' + amount.toLocaleString('en-AU') + ' on $' + o.balance.toLocaleString('en-AU') + ' at ' + Math.round(o.pct * 100) + '%') : '') + '</span>';
    }
    function tick(dt) {
      var moving = false;
      tiles.forEach(function (t) { moving = stepS(t.h, dt) || moving; setBox(t.b, box(P, t.i * gap, 0, 0.9, 1, 0, t.h.x)); });
      return moving;
    }
    pick(sel);
    return makeBoard(st, tick, {
      move: function (p) { var w = unproj(C, p[0], p[1], 0.4); var i = Math.max(0, Math.min(11, Math.floor(w[0] / gap))); if (i !== sel) pick(i); },
      leave: function () { pick(base); },
      key: function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { pick(Math.min(11, sel + 1)); return true; }
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { pick(Math.max(0, sel - 1)); return true; }
        return false;
      }
    });
  }

  // ----- figure: layers (default drawdown order) -----
  // Investment options stacked in the order payments are drawn from. Moving down the figure
  // opens the stack and picks a layer.
  function layers(host, o) {
    var names = o.names, n = names.length;
    var st = stage(host, 'Investment options stacked in the order pension payments are drawn from');
    var C = cam(45, 0.5);
    fit(C, [[0, 0, 0], [3, 3, 0], [0, 0, n * 0.95 + 0.5], [3, 3, n * 0.95]], { x: 40, y: 14, w: W - 190, h: H - 60 });
    var P = proj(C);
    var g = el('g', {}, st.svg), lab = el('g', {}, st.svg);
    var gapS = spring(0.25), sel = 0;
    var ls = names.map(function (nm, i) {
      var gg = el('g', { class: 'f-col' }, g);
      return { g: gg, b: boxEls(gg), t: text(lab, 0, 0, (i + 1) + '  ' + nm, 'f-label', 'start'), i: i };
    });
    ls.reverse().forEach(function (l) { g.appendChild(l.g); }); // draw bottom layer first
    ls.reverse();
    function pick(i) {
      sel = i;
      ls.forEach(function (l, j) { l.g.classList.toggle('is-hi', j === i); l.t.classList.toggle('is-hi', j === i); });
      st.cap.innerHTML = '<b>' + (i + 1) + (['st', 'nd', 'rd'][i] || 'th') + ': ' + names[i] + '</b><span>' +
        (i === 0 ? 'Payments come from here first, until it runs out' : 'Used once the options above it are empty') + '</span>';
    }
    function tick(dt) {
      var moving = stepS(gapS, dt);
      ls.forEach(function (l) {
        var z0 = (n - 1 - l.i) * (0.22 + gapS.x);
        setBox(l.b, box(P, 0, 0, 3, 3, z0, z0 + 0.22));
        var q = P(3, 0, z0 + 0.11);
        l.t.setAttribute('x', r2(q[0] + 14)); l.t.setAttribute('y', r2(q[1] + 4));
      });
      return moving;
    }
    pick(0);
    return makeBoard(st, tick, {
      move: function (p) {
        gapS.t = 0.25 + 0.45 * Math.max(0, Math.min(1, p[0] / W));
        var i = Math.max(0, Math.min(n - 1, Math.floor(p[1] / (H - 50) * n)));
        if (i !== sel) pick(i);
      },
      leave: function () { gapS.t = 0.25; pick(0); },
      key: function (e) {
        if (e.key === 'ArrowDown') { pick(Math.min(n - 1, sel + 1)); return true; }
        if (e.key === 'ArrowUp') { pick(Math.max(0, sel - 1)); return true; }
        return false;
      }
    });
  }

  // ----- figure: cap (transfer balance cap) -----
  // A glass box sized to the cap; pointing higher moves more money into retirement phase.
  // Anything above the cap shows as excess.
  function capFigure(host, o) {
    var cap = o.cap, top = cap * 1.25, hScale = 3.2 / top;
    var st = stage(host, 'A box sized to the transfer balance cap, filling as money moves into retirement phase');
    var C = cam(45, 0.5);
    fit(C, [[0, 0, 0], [2, 2, 0], [0, 0, top * hScale], [2, 2, top * hScale]], { x: 30, y: 16, w: W - 200, h: H - 60 });
    var P = proj(C);
    var g = el('g', {}, st.svg);
    var fill = boxEls(el('g', { class: 'f-col is-on' }, g));
    var over = boxEls(el('g', { class: 'f-col is-over' }, g));
    var glass = el('path', { class: 'f-ghost' }, g);
    var amt = spring(o.amount || cap * 0.7);
    var lab = el('g', {}, st.svg);
    var capQ = P(2, 0, cap * hScale);
    el('path', { class: 'f-dash', d: path([P(0, 0, cap * hScale), P(2, 0, cap * hScale), P(2, 2, cap * hScale), P(0, 2, cap * hScale)]) }, g);
    text(lab, capQ[0] + 12, capQ[1] + 4, 'Cap $' + (cap / 1e6).toFixed(1) + 'm', 'f-value', 'start');
    function m(v) { return v >= 1e6 ? '$' + (v / 1e6).toFixed(2).replace(/0$/, '') + 'm' : '$' + Math.round(v / 1000) + 'k'; }
    function describe() {
      var v = amt.t;
      st.cap.innerHTML = v <= cap ? '<b>' + m(v) + ' moved into retirement phase</b><span>' + m(cap - v) + ' of the general cap left for future pensions (a personal cap can be lower)</span>'
        : '<b>' + m(v) + ' moved: over the cap by ' + m(v - cap) + '</b><span>The excess and notional earnings must be removed; 15% tax on those earnings (30% for a further breach)</span>';
    }
    function tick(dt) {
      var moving = stepS(amt, dt);
      var hIn = Math.min(amt.x, cap) * hScale, hOver = Math.max(0, amt.x - cap) * hScale;
      setBox(fill, box(P, 0.08, 0.08, 1.84, 1.84, 0, Math.max(0.02, hIn)));
      setBox(over, box(P, 0.08, 0.08, 1.84, 1.84, cap * hScale, cap * hScale + hOver));
      over.top.parentNode.style.opacity = hOver > 0.001 ? 1 : 0;
      var t = box(P, 0, 0, 2, 2, 0, top * hScale);
      glass.setAttribute('d', t.top + t.right + t.front);
      return moving;
    }
    describe();
    return makeBoard(st, tick, {
      move: function (p) {
        var f = 1 - Math.max(0, Math.min(1, (p[1] - 30) / (H - 90)));
        amt.t = Math.round(f * top / 100000) * 100000; describe();
      },
      leave: function () { amt.t = o.amount || cap * 0.7; describe(); },
      key: function (e) {
        if (e.key === 'ArrowUp') { amt.t = Math.min(top, amt.t + 100000); describe(); return true; }
        if (e.key === 'ArrowDown') { amt.t = Math.max(0, amt.t - 100000); describe(); return true; }
        return false;
      }
    });
  }

  // ----- figure: terrain (home page) -----
  // A grid of pillars that rise around the pointer. Decorative; it hints that figures respond.
  function terrain(host) {
    var N = 9, st = stage(host, 'A grid of pillars that rise around the pointer');
    st.cap.remove();
    var C = cam(45, 0.5);
    fit(C, [[0, 0, 0], [N, N, 0], [0, 0, 2.6], [N, N, 0]], { x: 10, y: 10, w: W - 20, h: H - 20 });
    var P = proj(C), g = el('g', {}, st.svg), cells = [];
    for (var s = 0; s <= 2 * (N - 1); s++) for (var x = 0; x < N; x++) {
      var y = s - x;
      if (y < 0 || y >= N) continue;
      var gg = el('g', { class: 'f-col' }, g);
      cells.push({ x: x, y: y, b: boxEls(gg), g: gg, h: spring(0.15) });
    }
    var target = null;
    function aim() {
      cells.forEach(function (c) {
        if (!target) { c.h.t = 0.15; c.g.classList.remove('is-hi'); return; }
        var d = Math.hypot(c.x + 0.5 - target[0], c.y + 0.5 - target[1]);
        c.h.t = 0.15 + 2.2 * Math.max(0, 1 - d / 3);
        c.g.classList.toggle('is-hi', d < 0.8);
      });
    }
    function tick(dt) {
      var moving = false;
      cells.forEach(function (c) { moving = stepS(c.h, dt) || moving; setBox(c.b, box(P, c.x + 0.08, c.y + 0.08, 0.84, 0.84, 0, c.h.x)); });
      return moving;
    }
    var board = makeBoard(st, tick, {
      move: function (p) { target = unproj(C, p[0], p[1], 0.5); aim(); },
      leave: function () { target = null; aim(); }
    });
    return board;
  }

  var FIGURES = { bands: bands, months: months, layers: layers, cap: capFigure, terrain: terrain };
  function mount(host, name, options) {
    if (!FIGURES[name]) return null;
    host.innerHTML = '';
    return FIGURES[name](host, options || {});
  }
  return { mount: mount, names: Object.keys(FIGURES) };
})();
