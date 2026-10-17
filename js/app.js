/* Netgarden — application. Plain browser JS, no build step, no server. */
(function () {
  'use strict';
  const { stateAt, label: timeLabel, SHORT, MONTHS, rgba, yearRow } = window.Phenology;
  const LIB = window.PLANTS;
  const $ = (id) => document.getElementById(id);

  /* ---------------- state ---------------- */
  const state = {
    photo: null,              /* { img, w, h, dataUrl|null, name } */
    ground: null,             /* { horizon (0..1 of height), lens (f / long side), ref: {x1,y1,x2,y2}|null, refLen } */
    beds: [],                 /* [{ id, pts: [{X,Z}] }] */
    plants: [],               /* [{ id, pid, X, Z, seed, size }] */
    t: 6.5,
    mode: 'plant',
    libSel: null, sel: null, hover: null,
    typeFilter: 'all', search: '',
    drawingBed: null,         /* [{X,Z}] while drawing */
    refClicks: null,          /* 0/1 while marking the reference length */
    drag: null,
    playing: false,
  };
  let cam = null;             /* derived camera/ground model */
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------------- camera ground model ----------------
   * Pinhole camera at height hc above a flat lawn, pitched down by theta.
   * Horizon gives theta (with the lens's focal length); a known length gives hc. */
  function buildCamera() {
    const g = state.ground, W = state.photo.w, H = state.photo.h;
    const f = g.lens * Math.max(W, H), cx = W / 2, cy = H / 2;
    const vh = g.horizon * H;
    const theta = Math.atan((cy - vh) / f), s = Math.sin(theta), c = Math.cos(theta);
    /* plan coords scaled by hc for a pixel */
    const unit = (u, v) => {
      const k = (v - cy) / f, den = k * c + s;
      if (den <= 1e-6) return null;
      const Z = (c - k * s) / den, zp = s + Z * c;
      return { X: (u - cx) * zp / f, Z };
    };
    let hc = 1.5;
    if (g.ref) {
      const a = unit(g.ref.x1, g.ref.y1), b = unit(g.ref.x2, g.ref.y2);
      if (a && b) { const d = Math.hypot(a.X - b.X, a.Z - b.Z); if (d > 1e-6) hc = g.refLen / d; }
    }
    const Hm = [f, cx * c, cx * hc * s, 0, -f * s + cy * c, hc * (f * c + cy * s), 0, c, hc * s];
    const inv = window.Homography; /* reuse apply */
    const toImage = (X, Z) => inv.apply(Hm, X, Z);
    const toPlan = (x, y) => { const p = unit(x, y); return p ? { X: p.X * hc, Z: p.Z * hc } : null; };
    const ppm = (X, Z) => f / (hc * s + Z * c);
    cam = { f, hc, theta, horizonY: vh, toImage, toPlan, ppm };
  }

  /* ---------------- photo loading ---------------- */
  function loadPhoto(src, name, dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        /* work at a sane size so drawing stays quick */
        const maxSide = 1600, k = Math.min(1, maxSide / Math.max(img.width, img.height));
        let w = Math.round(img.width * k), h = Math.round(img.height * k), useImg = img, du = dataUrl;
        if (k < 1 || (dataUrl && !du)) {
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { du = c.toDataURL('image/jpeg', 0.85); useImg = new Image(); useImg.src = du; } catch (e) { useImg = img; du = null; }
        }
        const finish = () => { state.photo = { img: useImg, w, h, dataUrl: du, name }; resolve(); };
        if (useImg.complete) finish(); else useImg.onload = finish;
      };
      img.onerror = reject;
      img.src = src;
    });
  }

  function defaultGround() {
    const w = state.photo.w, h = state.photo.h;
    const sample = /sample/.test(state.photo.name || '');
    return sample
      ? { horizon: 800 / 1932, lens: 0.72, ref: { x1: 345 / 1449 * w, y1: 953 / 1932 * h, x2: 958 / 1449 * w, y2: 963 / 1932 * h }, refLen: 6.5 }
      : { horizon: 0.42, lens: 0.72, ref: null, refLen: 6 };
  }

  /* ---------------- persistence ---------------- */
  const KEY = 'netgarden.v1';
  function save() {
    try {
      const o = { t: state.t, ground: state.ground, beds: state.beds, plants: state.plants, photoName: state.photo.name, photoData: state.photo.dataUrl && !/sample/.test(state.photo.name) ? state.photo.dataUrl : null };
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) { /* storage full or blocked: carry on */ }
  }
  function loadSaved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  /* ---------------- view / canvas ---------------- */
  const canvas = $('view'), ctx = canvas.getContext('2d'), wrap = $('canvasWrap');
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1 };
  let needsDraw = false;
  function invalidate() { if (!needsDraw) { needsDraw = true; requestAnimationFrame(draw); } }

  function fit() {
    const r = wrap.getBoundingClientRect();
    view.dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * view.dpr); canvas.height = Math.round(r.height * view.dpr);
    if (state.photo) {
      view.scale = Math.min(r.width / state.photo.w, r.height / state.photo.h);
      view.ox = (r.width - state.photo.w * view.scale) / 2;
      view.oy = (r.height - state.photo.h * view.scale) / 2;
    }
    invalidate();
  }
  new ResizeObserver(fit).observe(wrap);

  function toImg(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - view.ox) / view.scale, y: (ev.clientY - r.top - view.oy) / view.scale };
  }

  function placedImage(pl) { return cam.toImage(pl.X, pl.Z); }
  function placedBounds(pl) {
    const p = LIB.byId[pl.pid], q = placedImage(pl);
    return window.Render.bounds(p, q.x, q.y, cam.ppm(pl.X, pl.Z), pl.size);
  }
  function sortedPlants() { return state.plants.slice().sort((a, b) => placedImage(a).y - placedImage(b).y); }

  function drawBed(c, bed, alpha) {
    const pts = bed.pts.map(p => cam.toImage(p.X, p.Z));
    if (pts.length < 2) return;
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y));
    if (pts.length > 2) { c.closePath(); c.fillStyle = `rgba(74,52,34,${0.78 * alpha})`; c.fill(); }
    c.strokeStyle = `rgba(40,28,18,${0.9 * alpha})`; c.lineWidth = 2 / view.scale; c.stroke();
  }

  function drawScene(c, forExport) {
    const ph = state.photo;
    c.drawImage(ph.img, 0, 0, ph.w, ph.h);
    state.beds.forEach(b => drawBed(c, b, 1));
    sortedPlants().forEach(pl => {
      const p = LIB.byId[pl.pid]; if (!p) return;
      const q = placedImage(pl);
      window.Render.drawPlant(c, p, stateAt(p, state.t), q.x, q.y, cam.ppm(pl.X, pl.Z), pl.seed, { size: pl.size });
    });
  }

  function draw() {
    needsDraw = false;
    if (!state.photo || !cam) return;
    const dpr = view.dpr, sc = view.scale;
    c0();
    function c0() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#1b2318'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * view.ox, dpr * view.oy);
    }
    drawScene(ctx, false);
    const lw = (n) => n / sc;

    /* in-progress bed */
    if (state.drawingBed && state.drawingBed.length) {
      drawBed(ctx, { pts: state.drawingBed }, 0.6);
      ctx.fillStyle = '#fff';
      state.drawingBed.forEach(p => { const q = cam.toImage(p.X, p.Z); ctx.beginPath(); ctx.arc(q.x, q.y, lw(4), 0, Math.PI * 2); ctx.fill(); });
    }

    /* grid */
    if ($('showGrid').checked || state.mode === 'setup') {
      ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = lw(1);
      const near = Math.max(0.5, cam.hc * 0.4);
      for (let X = -12; X <= 12; X++) { const a = cam.toImage(X, near), b = cam.toImage(X, 40); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (let Z = 1; Z <= 40; Z += (Z < 10 ? 1 : 5)) { if (Z < near) continue; const a = cam.toImage(-12, Z), b = cam.toImage(12, Z); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.restore();
    }

    /* setup overlays */
    if (state.mode === 'setup') {
      const g = state.ground;
      ctx.save();
      ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = lw(2); ctx.setLineDash([lw(10), lw(6)]);
      ctx.beginPath(); ctx.moveTo(0, cam.horizonY); ctx.lineTo(state.photo.w, cam.horizonY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd86b'; ctx.font = `${lw(13)}px system-ui`; ctx.fillText('horizon / eye level  (drag)', lw(10), cam.horizonY - lw(8));
      if (g.ref) {
        ctx.strokeStyle = '#6bd0ff'; ctx.lineWidth = lw(3);
        ctx.beginPath(); ctx.moveTo(g.ref.x1, g.ref.y1); ctx.lineTo(g.ref.x2, g.ref.y2); ctx.stroke();
        ctx.fillStyle = '#6bd0ff';
        [[g.ref.x1, g.ref.y1], [g.ref.x2, g.ref.y2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, lw(7), 0, Math.PI * 2); ctx.fill(); });
        ctx.fillText(`${g.refLen} m`, (g.ref.x1 + g.ref.x2) / 2 + lw(8), (g.ref.y1 + g.ref.y2) / 2 - lw(8));
      }
      ctx.restore();
    }

    /* ghost of the plant about to be placed */
    if (state.mode === 'plant' && state.libSel && state.hoverPt && !state.drag) {
      const pl = cam.toPlan(state.hoverPt.x, state.hoverPt.y);
      if (pl) window.Render.drawPlant(ctx, LIB.byId[state.libSel], stateAt(LIB.byId[state.libSel], state.t), state.hoverPt.x, state.hoverPt.y, cam.ppm(pl.X, pl.Z), 12345, { alpha: 0.55 });
    }

    /* selection, hover, labels */
    const showAll = $('showLabels').checked;
    state.plants.forEach(pl => {
      const isSel = pl.id === state.sel, isHov = pl.id === state.hover;
      if (!isSel && !isHov && !showAll) return;
      const b = placedBounds(pl), p = LIB.byId[pl.pid];
      ctx.save();
      if (isSel || isHov) {
        ctx.strokeStyle = isSel ? '#ffd86b' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = lw(isSel ? 2 : 1); ctx.setLineDash([lw(6), lw(4)]);
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
      ctx.setLineDash([]);
      const fs = lw(12); ctx.font = `${fs}px system-ui`;
      const tw = ctx.measureText(p.name).width + lw(10);
      const lx = (b.x0 + b.x1) / 2 - tw / 2, ly = b.y0 - lw(20);
      ctx.fillStyle = 'rgba(20,30,18,0.8)'; ctx.fillRect(lx, ly, tw, lw(17));
      ctx.fillStyle = '#fff'; ctx.fillText(p.name, lx + lw(5), ly + lw(12.5));
      ctx.restore();
    });
  }

  /* ---------------- hit testing ---------------- */
  function hitPlant(pt) {
    const list = sortedPlants().reverse();
    for (const pl of list) { const b = placedBounds(pl); if (pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1) return pl; }
    return null;
  }

  /* ---------------- pointer handling ---------------- */
  canvas.addEventListener('pointerdown', (ev) => {
    if (!cam) return;
    const pt = toImg(ev);
    canvas.setPointerCapture(ev.pointerId);
    if (state.mode === 'setup') {
      const g = state.ground, tol = 14 / view.scale;
      if (state.refClicks != null) {
        if (state.refClicks === 0) { g.ref = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }; state.refClicks = 1; state.drag = { kind: 'ref2' }; }
        else { g.ref.x2 = pt.x; g.ref.y2 = pt.y; state.refClicks = null; }
        rebuild(); return;
      }
      if (g.ref && Math.hypot(pt.x - g.ref.x1, pt.y - g.ref.y1) < tol) state.drag = { kind: 'ref1' };
      else if (g.ref && Math.hypot(pt.x - g.ref.x2, pt.y - g.ref.y2) < tol) state.drag = { kind: 'ref2' };
      else if (Math.abs(pt.y - cam.horizonY) < tol) state.drag = { kind: 'horizon' };
      return;
    }
    if (state.mode === 'bed') {
      const pl = cam.toPlan(pt.x, pt.y);
      if (!pl) { hint('Click on the ground, below the horizon.'); return; }
      if (!state.drawingBed) state.drawingBed = [];
      const last = state.drawingBed[state.drawingBed.length - 1];
      if (last && Math.hypot(last.X - pl.X, last.Z - pl.Z) < 0.05) return;
      state.drawingBed.push(pl); invalidate(); updateHint(); return;
    }
    /* plant mode: a chosen library plant always plants; otherwise click selects */
    const hit = state.libSel ? null : hitPlant(pt);
    if (hit) {
      state.sel = hit.id;
      const q = placedImage(hit);
      state.drag = { kind: 'plant', id: hit.id, dx: pt.x - q.x, dy: pt.y - q.y, moved: false };
      renderDesign(); invalidate(); return;
    }
    if (state.libSel) {
      const pl = cam.toPlan(pt.x, pt.y);
      if (!pl) { hint('Click on the ground, below the horizon.'); return; }
      const np = { id: uid(), pid: state.libSel, X: pl.X, Z: pl.Z, seed: Math.floor(Math.random() * 1e9), size: 1 };
      state.plants.push(np); state.sel = np.id;
      afterChange(); return;
    }
    state.sel = null; renderDesign(); invalidate();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!cam) return;
    const pt = toImg(ev);
    state.hoverPt = pt;
    if (state.drag) {
      const d = state.drag, g = state.ground;
      if (d.kind === 'horizon') { g.horizon = Math.max(0.02, Math.min(0.9, pt.y / state.photo.h)); rebuild(); }
      else if (d.kind === 'ref1') { g.ref.x1 = pt.x; g.ref.y1 = pt.y; rebuild(); }
      else if (d.kind === 'ref2') { g.ref.x2 = pt.x; g.ref.y2 = pt.y; rebuild(); }
      else if (d.kind === 'plant') {
        const pl = cam.toPlan(pt.x - d.dx, pt.y - d.dy);
        if (pl) { const p = state.plants.find(x => x.id === d.id); p.X = pl.X; p.Z = pl.Z; d.moved = true; invalidate(); }
      }
      return;
    }
    if (state.mode === 'plant') {
      const h = hitPlant(pt), id = h ? h.id : null;
      if (id !== state.hover) state.hover = id;
      canvas.style.cursor = state.libSel ? 'crosshair' : (h ? 'move' : 'default');
      invalidate();
    } else { canvas.style.cursor = 'crosshair'; invalidate(); }
  });

  canvas.addEventListener('pointerup', () => {
    if (state.drag) {
      const d = state.drag; state.drag = null;
      if (d.kind === 'plant' && d.moved) afterChange(); else if (d.kind !== 'plant') { save(); renderSetup(); }
    }
  });
  canvas.addEventListener('pointerleave', () => { state.hoverPt = null; state.hover = null; invalidate(); });
  canvas.addEventListener('dblclick', () => { if (state.mode === 'bed') finishBed(); });

  window.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, select, textarea')) return;
    if (ev.key === 'Escape') { state.libSel = null; state.sel = null; state.drawingBed = null; state.refClicks = null; renderLibrary(); renderDesign(); updateHint(); invalidate(); }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.sel) { removePlant(state.sel); }
    if (ev.key === 'Enter' && state.mode === 'bed') finishBed();
    if (ev.key === 'p') setMode('plant'); if (ev.key === 'b') setMode('bed'); if (ev.key === 's') setMode('setup');
    if (ev.key === 'ArrowRight') setTime(state.t + 0.25); if (ev.key === 'ArrowLeft') setTime(state.t - 0.25);
  });

  function finishBed() {
    if (state.drawingBed && state.drawingBed.length >= 3) state.beds.push({ id: uid(), pts: state.drawingBed });
    state.drawingBed = null; afterChange(); updateHint();
  }
  function removePlant(id) { state.plants = state.plants.filter(p => p.id !== id); if (state.sel === id) state.sel = null; afterChange(); }
  function rebuild() { buildCamera(); invalidate(); renderSetup(); }
  function afterChange() { save(); renderDesign(); renderCalendar(); invalidate(); }

  /* ---------------- modes & hints ---------------- */
  function setMode(m) {
    state.mode = m; state.drawingBed = null; state.refClicks = null; state.drag = null;
    document.querySelectorAll('.modes .mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    if (m === 'setup') showTab('setup'); else if (m === 'bed') showTab('design'); else if (m === 'plant' && !state.libSel) showTab('library');
    updateHint(); invalidate();
  }
  document.querySelectorAll('.modes .mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  function hint(s) { $('hint').textContent = s; }
  function updateHint() {
    if (state.mode === 'setup') hint(state.refClicks != null ? (state.refClicks === 0 ? 'Click the first end of the known length.' : 'Now click the other end.') : 'Drag the yellow horizon line to your eye level. Drag the blue ends onto something you can measure.');
    else if (state.mode === 'bed') hint(state.drawingBed && state.drawingBed.length ? `${state.drawingBed.length} corner${state.drawingBed.length > 1 ? 's' : ''}. Keep clicking, then double-click or press Enter to finish. Esc cancels.` : 'Click the corners of a border on the lawn. Double-click or Enter to finish.');
    else hint(state.libSel ? `Click on the lawn or a border to plant ${LIB.byId[state.libSel].name}. Esc to stop.` : 'Choose a plant on the right, then click where it should go. Drag plants to move them, Delete to remove.');
  }

  /* ---------------- tabs ---------------- */
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + name));
    if (name === 'calendar') renderCalendar(); if (name === 'design') renderDesign();
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

  /* ---------------- library ---------------- */
  function swatchHtml(p) {
    const fl = p.flower ? `<i style="background:${p.flower.c}"></i>` : '';
    return `<div class="sw" style="background:${p.leaf}">${fl}</div>`;
  }
  function monthsText(ms) {
    if (!ms || !ms.length) return '';
    const sorted = ms.slice().sort((a, b) => a - b);
    const wraps = sorted[0] === 1 && sorted[sorted.length - 1] === 12 && sorted.length < 12;
    if (wraps) { /* e.g. Nov–Feb */ let start = sorted.find((m, i) => i > 0 && sorted[i - 1] !== m - 1) || sorted[0]; return `${SHORT[start - 1]}–${SHORT[(start + sorted.length - 2) % 12]}`; }
    return sorted.length === 1 ? SHORT[sorted[0] - 1] : `${SHORT[sorted[0] - 1]}–${SHORT[sorted[sorted.length - 1] - 1]}`;
  }
  function renderLibrary() {
    const chips = $('typeChips');
    if (!chips.children.length) {
      const all = [['all', 'All'], ...Object.entries(LIB.TYPES), ['fruit', 'Fruiting'], ['winter', 'Winter interest'], ['shade', 'Shade']];
      chips.innerHTML = all.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('');
      chips.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.typeFilter = b.dataset.k; renderLibrary(); }));
    }
    chips.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.k === state.typeFilter));
    const q = state.search.trim().toLowerCase();
    const list = LIB.all.filter(p => {
      const f = state.typeFilter;
      if (f !== 'all') {
        if (f === 'fruit') { if (!p.fruit) return false; }
        else if (f === 'winter') { if (!(p.ev || p.bare || (p.flower && p.flower.m.some(m => m === 12 || m <= 2)) || (p.fruit && p.fruit.m.some(m => m === 12 || m <= 1)))) return false; }
        else if (f === 'shade') { if (p.sun !== 'shade') return false; }
        else if (p.type !== f) return false;
      }
      if (q) return (p.name + ' ' + p.latin + ' ' + p.type + ' ' + p.sun + ' ' + (p.notes || '')).toLowerCase().includes(q);
      return true;
    });
    $('plantList').innerHTML = list.map(p => `
      <div class="card ${state.libSel === p.id ? 'active' : ''}" data-id="${p.id}">
        ${swatchHtml(p)}
        <div><div class="nm">${p.name}</div><div class="lt">${p.latin}</div>
        <div class="meta">${LIB.TYPES[p.type].replace(/s$/, '')} · ${p.h} × ${p.s} m · ${p.sun} sun${p.ev ? ' · evergreen' : ''}${p.flower ? ' · flowers ' + monthsText(p.flower.m) : ''}${p.fruit ? ' · fruit ' + monthsText(p.fruit.m) : ''}</div></div>
      </div>`).join('') || '<p class="small">Nothing matches.</p>';
    $('plantList').querySelectorAll('.card').forEach(c => c.addEventListener('click', () => {
      state.libSel = state.libSel === c.dataset.id ? null : c.dataset.id;
      if (state.libSel && state.mode !== 'plant') setMode('plant');
      renderLibrary(); updateHint(); invalidate();
    }));
  }
  $('search').addEventListener('input', (e) => { state.search = e.target.value; renderLibrary(); });

  /* ---------------- design tab ---------------- */
  function renderDesign() {
    const sel = state.plants.find(p => p.id === state.sel);
    const box = $('selectedBox');
    if (sel) {
      const p = LIB.byId[sel.pid];
      box.className = 'box';
      box.innerHTML = `<div class="nm"><b>${p.name}</b> <span class="small"><i>${p.latin}</i></span></div>
        <p class="small">${p.notes || ''}</p>
        <label>Size <span class="count">${Math.round(sel.size * 100)}% of mature (${(p.h * sel.size).toFixed(1)} m tall)</span>
          <input type="range" id="selSize" min="0.25" max="1.4" step="0.05" value="${sel.size}"></label>
        <div class="row"><button id="selDup">Duplicate</button><button id="selDel" class="danger">Remove</button></div>`;
      $('selSize').addEventListener('input', (e) => { sel.size = +e.target.value; invalidate(); });
      $('selSize').addEventListener('change', () => afterChange());
      $('selDup').addEventListener('click', () => { const np = Object.assign({}, sel, { id: uid(), X: sel.X + p.s * 0.9, seed: Math.floor(Math.random() * 1e9) }); state.plants.push(np); state.sel = np.id; afterChange(); });
      $('selDel').addEventListener('click', () => removePlant(sel.id));
    } else { box.className = 'box muted'; box.textContent = 'Click a placed plant to select it.'; }

    $('plantCount').textContent = state.plants.length ? `(${state.plants.length})` : '';
    $('placedList').innerHTML = state.plants.length ? sortedPlants().reverse().map(pl => {
      const p = LIB.byId[pl.pid];
      return `<div class="card ${pl.id === state.sel ? 'active' : ''}" data-id="${pl.id}">${swatchHtml(p)}<div><div class="nm">${p.name}</div><div class="meta">${pl.Z.toFixed(1)} m away, ${pl.X < 0 ? 'left' : 'right'} ${Math.abs(pl.X).toFixed(1)} m</div></div><button data-del="${pl.id}">×</button></div>`;
    }).join('') : '<p class="small">Nothing planted yet.</p>';
    $('placedList').querySelectorAll('.card').forEach(c => c.addEventListener('click', () => { state.sel = c.dataset.id; renderDesign(); invalidate(); }));
    $('placedList').querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); removePlant(b.dataset.del); }));

    $('bedCount').textContent = state.beds.length ? `(${state.beds.length})` : '';
    $('bedList').innerHTML = state.beds.length ? state.beds.map((b, i) => `<div class="card"><div class="sw" style="background:#4a3422"></div><div><div class="nm">Border ${i + 1}</div><div class="meta">${b.pts.length} corners</div></div><button data-bed="${b.id}">×</button></div>`).join('') : '<p class="small">Use "Draw border" to mark beds on the lawn.</p>';
    $('bedList').querySelectorAll('[data-bed]').forEach(b => b.addEventListener('click', () => { state.beds = state.beds.filter(x => x.id !== b.dataset.bed); afterChange(); }));
    renderPlan();
  }
  $('clearAll').addEventListener('click', () => { if (confirm('Remove every plant and border from this design?')) { state.plants = []; state.beds = []; state.sel = null; afterChange(); } });

  /* plan minimap */
  const planC = $('plan'), planCtx = planC.getContext('2d');
  let planMap = null;
  function renderPlan() {
    if (!cam) return;
    const W = planC.width, H = planC.height;
    let maxZ = 10, halfX = 5;
    const consider = (X, Z) => { maxZ = Math.max(maxZ, Z + 1.5); halfX = Math.max(halfX, Math.abs(X) + 1.5); };
    state.plants.forEach(p => consider(p.X, p.Z)); state.beds.forEach(b => b.pts.forEach(p => consider(p.X, p.Z)));
    const k = Math.min((W - 10) / (2 * halfX), (H - 10) / maxZ);
    const map = (X, Z) => ({ x: W / 2 + X * k, y: H - 5 - Z * k });
    planMap = { k, inv: (x, y) => ({ X: (x - W / 2) / k, Z: (H - 5 - y) / k }) };
    planCtx.clearRect(0, 0, W, H);
    planCtx.fillStyle = '#dfe6cf'; planCtx.fillRect(0, 0, W, H);
    /* field of view */
    const halfFov = Math.atan((state.photo.w / 2) / cam.f);
    planCtx.fillStyle = '#e9eadb'; planCtx.beginPath(); const o = map(0, 0); planCtx.moveTo(o.x, o.y);
    const far = map(Math.tan(halfFov) * maxZ * 1.2, maxZ * 1.2), farL = map(-Math.tan(halfFov) * maxZ * 1.2, maxZ * 1.2);
    planCtx.lineTo(far.x, far.y); planCtx.lineTo(farL.x, farL.y); planCtx.closePath(); planCtx.fill();
    planCtx.strokeStyle = 'rgba(0,0,0,0.08)'; planCtx.lineWidth = 1;
    for (let Z = 0; Z <= maxZ; Z++) { const a = map(-halfX, Z), b = map(halfX, Z); planCtx.beginPath(); planCtx.moveTo(a.x, a.y); planCtx.lineTo(b.x, b.y); planCtx.stroke(); }
    for (let X = -Math.floor(halfX); X <= halfX; X++) { const a = map(X, 0), b = map(X, maxZ); planCtx.beginPath(); planCtx.moveTo(a.x, a.y); planCtx.lineTo(b.x, b.y); planCtx.stroke(); }
    state.beds.forEach(b => { planCtx.fillStyle = 'rgba(74,52,34,0.75)'; planCtx.beginPath(); b.pts.forEach((p, i) => { const q = map(p.X, p.Z); i ? planCtx.lineTo(q.x, q.y) : planCtx.moveTo(q.x, q.y); }); planCtx.closePath(); planCtx.fill(); });
    state.plants.forEach(pl => {
      const p = LIB.byId[pl.pid], st = stateAt(p, state.t), q = map(pl.X, pl.Z), r = Math.max(2.5, p.s * pl.size * k / 2);
      planCtx.fillStyle = st.leaf > 0.05 ? rgba(st.leafColor, 0.45 + 0.5 * st.leaf) : 'rgba(110,90,60,0.6)';
      planCtx.beginPath(); planCtx.arc(q.x, q.y, r, 0, Math.PI * 2); planCtx.fill();
      if (st.flower > 0.1 && st.flowerColor) { planCtx.strokeStyle = st.flowerColor; planCtx.lineWidth = 3; planCtx.stroke(); }
      if (pl.id === state.sel) { planCtx.strokeStyle = '#d4a017'; planCtx.lineWidth = 2; planCtx.setLineDash([3, 2]); planCtx.beginPath(); planCtx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); planCtx.stroke(); planCtx.setLineDash([]); }
    });
    planCtx.fillStyle = '#263a22'; planCtx.beginPath(); planCtx.arc(o.x, o.y, 4, 0, Math.PI * 2); planCtx.fill();
    planCtx.font = '10px system-ui'; planCtx.fillText('you', o.x + 7, o.y - 2);
    planCtx.fillStyle = '#6b7266'; planCtx.fillText(`${maxZ.toFixed(0)} m`, 4, 12);
  }
  planC.addEventListener('click', (ev) => {
    if (!planMap) return;
    const r = planC.getBoundingClientRect(), x = (ev.clientX - r.left) * planC.width / r.width, y = (ev.clientY - r.top) * planC.height / r.height;
    const pt = planMap.inv(x, y);
    let best = null, bd = 0.8;
    state.plants.forEach(pl => { const d = Math.hypot(pl.X - pt.X, pl.Z - pt.Z); if (d < bd) { bd = d; best = pl; } });
    state.sel = best ? best.id : null; renderDesign(); invalidate();
  });

  /* ---------------- calendar ---------------- */
  function renderCalendar() {
    const ids = [...new Set(state.plants.map(p => p.pid))].map(id => LIB.byId[id]);
    const now = Math.floor(state.t) + 1;
    const cal = $('calendar');
    if (!ids.length) { cal.innerHTML = '<p class="small">Place some plants and their year appears here.</p>'; $('inFlower').innerHTML = ''; $('foliageNow').innerHTML = ''; $('gaps').textContent = ''; return; }
    ids.sort((a, b) => ((a.flower ? Math.min(...a.flower.m) : 99) - (b.flower ? Math.min(...b.flower.m) : 99)));
    let html = '<table class="cal"><tr><th></th>' + SHORT.map((m, i) => `<th class="${i + 1 === now ? 'now' : ''}">${m[0]}</th>`).join('') + '</tr>';
    ids.forEach(p => {
      const row = yearRow(p);
      html += `<tr><td class="name" title="${p.name}">${p.name}</td>` + row.map((s, i) => {
        const bg = s.leaf > 0 ? rgba(s.leafColor, 0.25 + 0.7 * s.leaf) : 'transparent';
        return `<td class="m ${i + 1 === now ? 'now' : ''}" style="background:${bg}" title="${MONTHS[i]}: ${s.flower ? 'in flower' : s.leaf ? 'in leaf' : 'dormant'}${s.fruit ? ', fruiting' : ''}">${s.flower ? `<i style="background:${s.flowerColor}"></i>` : ''}${s.fruit ? `<u style="background:${s.fruitColor}"></u>` : ''}</td>`;
      }).join('') + '</tr>';
    });
    cal.innerHTML = html + '</table><p class="small">Cell colour = foliage. Dot = in flower. Small dot = fruit or berries.</p>';

    const flowering = ids.map(p => ({ p, s: stateAt(p, state.t) })).filter(x => x.s.flower > 0.3);
    $('inFlower').innerHTML = flowering.length ? flowering.map(x => `<span class="s"><b style="background:${x.s.flowerColor}"></b>${x.p.name}</span>`).join('') : '<span class="small">Nothing in flower at this point in the year.</span>';
    const leafy = ids.map(p => ({ p, s: stateAt(p, state.t) })).filter(x => x.s.leaf > 0.3);
    $('foliageNow').innerHTML = leafy.length ? leafy.map(x => `<span class="s"><b style="background:${x.s.leafColor}"></b>${x.p.name}</span>`).join('') : '<span class="small">Bare stems and soil only.</span>';
    const quiet = [];
    for (let m = 1; m <= 12; m++) if (!ids.some(p => p.flower && p.flower.m.includes(m))) quiet.push(MONTHS[m - 1]);
    $('gaps').textContent = quiet.length ? `No flowers at all in: ${quiet.join(', ')}. Try the "Winter interest" filter to fill the gaps.` : 'Something is in flower every month of the year.';
  }

  /* ---------------- setup tab ---------------- */
  function renderSetup() {
    if (!cam) return;
    const g = state.ground;
    $('horizon').value = g.horizon; $('horizonVal').textContent = `${Math.round(g.horizon * 100)}% down the photo`;
    $('refLen').value = g.refLen; $('lens').value = String(g.lens);
    const refZ = g.ref ? cam.toPlan((g.ref.x1 + g.ref.x2) / 2, (g.ref.y1 + g.ref.y2) / 2) : null;
    $('camReadout').innerHTML = `Camera height: <b>${cam.hc.toFixed(2)} m</b> (a phone at chest height is about 1.3–1.6 m)<br>Tilt: ${(cam.theta * 180 / Math.PI).toFixed(1)}° down` + (refZ ? `<br>Known length is about <b>${refZ.Z.toFixed(1)} m</b> away` : '<br>No known length marked yet: assuming the camera was 1.5 m up.') + (g.ref && (cam.hc < 0.6 || cam.hc > 3) ? '<br><span style="color:#a33a2a">That camera height looks wrong. Check the horizon line and the length in metres.</span>' : '');
  }
  $('horizon').addEventListener('input', (e) => { state.ground.horizon = +e.target.value; rebuild(); });
  $('horizon').addEventListener('change', save);
  $('refLen').addEventListener('change', (e) => { state.ground.refLen = Math.max(0.5, +e.target.value || 1); rebuild(); save(); });
  $('lens').addEventListener('change', (e) => { state.ground.lens = +e.target.value; rebuild(); save(); });
  $('markRef').addEventListener('click', () => { setMode('setup'); state.refClicks = 0; updateHint(); });
  $('showGrid').addEventListener('change', invalidate); $('showLabels').addEventListener('change', invalidate);

  $('photoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file);
    await loadPhoto(url, file.name, true);
    URL.revokeObjectURL(url);
    state.ground = defaultGround(); state.beds = []; state.plants = []; state.sel = null;
    buildCamera(); fit(); save(); renderSetup(); renderDesign(); setMode('setup');
    hint('New photo. Set the horizon and mark a known length, then go back to Plants.');
  });

  $('exportJson').addEventListener('click', () => {
    const o = { version: 1, ground: state.ground, beds: state.beds, plants: state.plants, photoName: state.photo.name, photoData: state.photo.dataUrl };
    const blob = new Blob([JSON.stringify(o)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'netgarden-design.json'; a.click();
  });
  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const o = JSON.parse(await file.text());
      if (o.photoData) await loadPhoto(o.photoData, o.photoName || 'photo.jpg', o.photoData);
      state.ground = o.ground || defaultGround(); state.beds = o.beds || []; state.plants = (o.plants || []).filter(p => LIB.byId[p.pid]);
      buildCamera(); fit(); afterChange(); renderSetup();
    } catch (err) { alert('That file could not be read as a Netgarden design.'); }
  });
  $('exportPng').addEventListener('click', () => {
    const c = document.createElement('canvas'); c.width = state.photo.w; c.height = state.photo.h;
    const cc = c.getContext('2d');
    const saved = view.scale; view.scale = 1; drawScene(cc, true); view.scale = saved;
    try {
      const a = document.createElement('a'); a.href = c.toDataURL('image/jpeg', 0.9); a.download = `netgarden-${timeLabel(state.t).replace(/\s+/g, '-').toLowerCase()}.jpg`; a.click();
    } catch (err) { alert('The browser will not export the bundled sample photo when the app is opened straight from a file. Upload your own photo, or run the app from a local web server.'); }
  });

  /* ---------------- time ---------------- */
  function setTime(t) {
    state.t = ((t % 12) + 12) % 12;
    $('time').value = state.t; $('timeLabel').textContent = timeLabel(state.t);
    invalidate(); renderPlan();
    if (!document.getElementById('tab-calendar').classList.contains('hidden')) renderCalendar();
  }
  $('time').addEventListener('input', (e) => setTime(+e.target.value));
  $('time').addEventListener('change', save);
  $('monthTicks').innerHTML = SHORT.map(m => `<span>${m}</span>`).join('');
  $('play').addEventListener('click', () => {
    state.playing = !state.playing; $('play').textContent = state.playing ? '❚❚' : '▶';
    if (state.playing) { let last = performance.now(); const step = (now) => { if (!state.playing) return; setTime(state.t + (now - last) / 1000 * 0.9); last = now; requestAnimationFrame(step); }; requestAnimationFrame(step); }
    else save();
  });

  /* ---------------- boot ---------------- */
  async function boot() {
    const saved = loadSaved();
    try {
      if (saved && saved.photoData) await loadPhoto(saved.photoData, saved.photoName || 'photo.jpg', saved.photoData);
      else await loadPhoto('assets/sample-garden.jpg', 'sample-garden.jpg', null);
    } catch (e) { hint('Could not load a photo. Use Setup to upload one.'); return; }
    state.ground = (saved && saved.ground) || defaultGround();
    if (saved) { state.beds = saved.beds || []; state.plants = (saved.plants || []).filter(p => LIB.byId[p.pid]); if (typeof saved.t === 'number') state.t = saved.t; }
    buildCamera(); fit();
    renderLibrary(); renderDesign(); renderCalendar(); renderSetup(); setTime(state.t); updateHint();
  }
  boot();
})();
