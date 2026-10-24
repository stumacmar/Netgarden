/* Netgarden — application. Plain browser JS, no build step, no server.
 * Flow: 1 Photo (calibrate, site profile) · 2 Beds (borders, foreground) · 3 Plants · 4 Review. */
(function () {
  'use strict';
  const { stateAt, label: timeLabel, SHORT, MONTHS, rgba, yearRow } = window.Phenology;
  const LIB = window.PLANTS;
  const $ = (id) => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2, 9);

  /* ---------------- state ---------------- */
  const state = {
    photo: null, ground: null, beds: [], plants: [], masks: [],
    t: 6.5, years: 3,
    sun: { az: -35, el: 25 }, light: null, stats: null,
    profile: Object.assign({}, window.Site.DEFAULT_PROFILE),
    step: 'plants', mode: 'plant',          /* mode: plant | bed | mask | setup(ref marking) */
    libSel: null, sel: null, hover: null, hoverPt: null,
    role: 'all', filters: new Set(), search: '', multi: new Set(), multiMode: false, replaceId: null,
    drawingBed: null, maskSel: null, brush: 40, erase: false, maskSetDepth: false, refClicks: null,
    drag: null, playing: false,
    undo: [], redo: [],
  };
  let cam = null;

  /* ---------------- camera / ground ---------------- */
  function buildCamera() {
    const g = state.ground, W = state.photo.w, H = state.photo.h;
    const f = g.lens * Math.max(W, H), cx = W / 2, cy = H / 2, vh = g.horizon * H;
    const theta = Math.atan((cy - vh) / f), s = Math.sin(theta), c = Math.cos(theta);
    const unit = (u, v) => { const k = (v - cy) / f, den = k * c + s; if (den <= 1e-6) return null; const Z = (c - k * s) / den; return { X: (u - cx) * (s + Z * c) / f, Z }; };
    let hc = 1.5;
    /* a vertical reference (one fence panel of known height): the camera height that makes its top land where it was marked */
    const hmFor = (h) => [f, cx * c, cx * h * s, 0, -f * s + cy * c, h * (f * c + cy * s), 0, c, h * s];
    const v = g.refV, vb = v && v.yt < v.yb - 2 ? unit(v.x, v.yb) : null;
    if (vb) {
      const topY = (hcTry) => window.Homography.apply(hmFor(hcTry - v.h), vb.X * hcTry, vb.Z * hcTry).y;
      let lo = 0.2, hi = 8; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (topY(mid) < v.yt) lo = mid; else hi = mid; }
      hc = (lo + hi) / 2;
    }
    else if (g.ref) { const a = unit(g.ref.x1, g.ref.y1), b = unit(g.ref.x2, g.ref.y2); if (a && b) { const d = Math.hypot(a.X - b.X, a.Z - b.Z); if (d > 1e-6) hc = g.refLen / d; } }
    const Hm = hmFor(hc);
    cam = {
      f, hc, theta, horizonY: vh,
      toImage: (X, Z) => window.Homography.apply(Hm, X, Z),
      toPlan: (x, y) => { const p = unit(x, y); return p ? { X: p.X * hc, Z: p.Z * hc } : null; },
      ppm: (X, Z) => f / (hc * s + Z * c),
    };
    if (!state.stats || state.stats.horizonY !== vh) {
      state.stats = Object.assign(window.Compose.photoStats(state.photo.img, W, H, vh), { horizonY: vh });
      if (!state.light || state.light.auto) state.light = Object.assign(window.Compose.autoLight(state.stats), { auto: true });
    }
  }
  function fenceZ() {
    const g = state.ground;
    if (g.refV && g.refV.yt < g.refV.yb - 2) { const p = cam.toPlan(g.refV.x, g.refV.yb); return p ? p.Z : null; }
    if (!g.ref) return null; const a = cam.toPlan(g.ref.x1, g.ref.y1), b = cam.toPlan(g.ref.x2, g.ref.y2); return a && b ? (a.Z + b.Z) / 2 : null;
  }
  /* the 35 mm-equivalent focal length from a JPEG's EXIF, when it has one */
  function exifFocal35(buf) {
    try {
      const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return null; let o = 2;
      while (o + 4 <= v.byteLength) {
        const marker = v.getUint16(o), len = v.getUint16(o + 2);
        if (marker === 0xFFE1 && o + 10 <= v.byteLength && v.getUint32(o + 4) === 0x45786966) {
          const t = o + 10, le = v.getUint16(t) === 0x4949, g16 = (p) => v.getUint16(p, le), g32 = (p) => v.getUint32(p, le);
          let exifIfd = null, focal35 = null, focal = null;
          const readIfd = (p, cb) => { const n = g16(p); for (let i = 0; i < n; i++) { const e = p + 2 + i * 12; if (e + 12 > v.byteLength) return; cb(g16(e), g16(e + 2), g32(e + 4), e + 8); } };
          readIfd(t + g32(t + 4), (tag, type, count, vp) => { if (tag === 0x8769) exifIfd = t + g32(vp); });
          if (exifIfd) readIfd(exifIfd, (tag, type, count, vp) => { if (tag === 0xA405) focal35 = type === 3 ? g16(vp) : g32(vp); if (tag === 0x920A && type === 5) { const p = t + g32(vp); if (p + 8 <= v.byteLength) focal = g32(p) / Math.max(1, g32(p + 4)); } });
          return { focal35, focal };
        }
        if (marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) break; o += 2 + len;
      }
    } catch (e) { }
    return null;
  }

  function loadPhoto(src, name, keepData) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const maxSide = 1600, k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.round(img.width * k), h = Math.round(img.height * k);
        let useImg = img, du = null;
        if (k < 1 || keepData) {
          const c = document.createElement('canvas'); c.width = w; c.height = h; const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
          try { du = c.toDataURL('image/jpeg', 0.85); useImg = new Image(); useImg.src = du; } catch (e) { useImg = img; du = null; }
        }
        const finish = () => { state.photo = { img: useImg, w, h, dataUrl: du, name }; resolve(); };
        if (useImg.complete) finish(); else useImg.onload = finish;
      };
      img.onerror = reject; img.src = src;
    });
  }
  function defaultGround() {
    const w = state.photo.w, h = state.photo.h, sample = /sample/.test(state.photo.name || '');
    return sample ? { horizon: 800 / 1932, lens: 0.72, ref: { x1: 345 / 1449 * w, y1: 953 / 1932 * h, x2: 958 / 1449 * w, y2: 963 / 1932 * h }, refLen: 6.5 }
      : { horizon: 0.42, lens: 0.72, ref: null, refLen: 6 };
  }

  /* ---------------- persistence ---------------- */
  const KEY = 'netgarden.v2';
  function save() {
    if (state.staleTab) return;
    try {
      localStorage.setItem(KEY, JSON.stringify({ t: state.t, years: state.years, ground: state.ground, beds: state.beds, plants: state.plants, sun: state.sun, light: state.light, profile: state.profile, masks: state.masks.map(window.Masks.serialize), photoName: state.photo.name, photoData: state.photo.dataUrl && !/sample/.test(state.photo.name) ? state.photo.dataUrl : null }));
    } catch (e) { /* storage full or blocked */ }
  }
  window.addEventListener('storage', (ev) => { if (ev.key !== KEY || !ev.newValue || state.staleTab) return; state.staleTab = true; toast('This design was changed in another tab. Reload this tab to see it; changes here are no longer being saved.', 8000); });
  function loadSaved() {
    try {
      const v2 = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v2) return v2;
      const v1 = JSON.parse(localStorage.getItem('netgarden.v1') || 'null');
      if (v1) { v1.profile = Object.assign({}, window.Site.DEFAULT_PROFILE, v1.site || {}); return v1; }
    } catch (e) { }
    return null;
  }

  /* ---------------- undo / redo ---------------- */
  let lastSnap = null;
  const snapshot = () => JSON.stringify({ plants: state.plants, beds: state.beds });
  function commit() {
    const now = snapshot();
    if (lastSnap !== null && lastSnap !== now) { state.undo.push(lastSnap); if (state.undo.length > 80) state.undo.shift(); state.redo = []; }
    lastSnap = now; updateUndoButtons();
  }
  function restore(json) { const o = JSON.parse(json); state.plants = o.plants; state.beds = o.beds; state.sel = null; lastSnap = json; afterChange(true); }
  function undo() { const p = state.undo.pop(); if (!p) return; state.redo.push(snapshot()); restore(p); toast('Undone'); }
  function redo() { const n = state.redo.pop(); if (!n) return; state.undo.push(snapshot()); restore(n); toast('Redone'); }
  function updateUndoButtons() { $('undoBtn').disabled = !state.undo.length; $('redoBtn').disabled = !state.redo.length; }
  $('undoBtn').addEventListener('click', undo); $('redoBtn').addEventListener('click', redo);

  /* afterChange(noCommit): save, refresh panels, redraw */
  function afterChange(noCommit) { if (!noCommit) commit(); updateUndoButtons(); save(); renderSelected(); renderPlaced(); renderReview(); renderBands(); invalidate(); }

  /* ---------------- helpers ---------------- */
  function tEff() { return state.t - (window.Site.REGIONS[state.profile.region] || 0) / 4.33; }
  function dims(pl) { /* mature h/s, honouring a rootstock */
    const p = LIB.byId[pl.pid]; if (pl.rootstock && p.rootstocks && p.rootstocks[pl.rootstock]) { const r = p.rootstocks[pl.rootstock]; return Object.assign({}, p, { h: r[0], s: r[1] }); } return p;
  }
  function sizeOf(pl) { return (pl.size || 1) * window.Site.growth(LIB.byId[pl.pid], state.years); }
  function placedImage(pl) { return cam.toImage(pl.X, pl.Z); }
  /* how far away a plant may be: the back fence when it is marked, otherwise 30 m */
  function maxPlantZ() { const fz = fenceZ(); return fz ? fz - 0.1 : 30; }
  function placedBounds(pl) { const q = placedImage(pl); return window.Render.bounds(dims(pl), q.x, q.y, cam.ppm(pl.X, pl.Z), sizeOf(pl)); }
  function sortedPlants() { return state.plants.slice().sort((a, b) => placedImage(a).y - placedImage(b).y); }
  function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), ms || 3500); }
  function hideToast() { clearTimeout(toast.h); $('toast').classList.remove('show'); }
  function hint(s) { $('hint').textContent = s; updateCtxbar(); }
  function updateCtxbar() { const bar = $('ctxbar'); const btns = !$('doneBtn').classList.contains('hidden') || !$('cancelBtn').classList.contains('hidden'); bar.classList.toggle('empty', !$('hint').textContent && !btns); bar.classList.toggle('task', btns); }
  const mqPhone = window.matchMedia('(max-width: 900px)'), mqSheet = window.matchMedia('(max-width: 900px) and (orientation: portrait)'), mqCoarse = window.matchMedia('(pointer: coarse)');
  const isPhone = () => mqPhone.matches;
  const HANDLE_R = () => mqCoarse.matches ? 13 : 8;
  /* in-app confirmation (the native confirm() looks foreign on a phone) */
  function confirmDialog(text, okLabel) {
    const d = $('confirmDlg'); if (!d || typeof d.showModal !== 'function') return Promise.resolve(window.confirm(text));
    $('confirmText').textContent = text; $('confirmOk').textContent = okLabel || 'OK';
    return new Promise(resolve => { const done = () => { d.removeEventListener('close', done); resolve(d.returnValue === 'ok'); }; d.addEventListener('close', done); d.returnValue = ''; d.showModal(); });
  }

  /* ---------------- canvas ---------------- */
  const canvas = $('view'), ctx = canvas.getContext('2d'), wrap = $('canvasWrap');
  const view = { scale: 1, ox: 0, oy: 0, dpr: 1, base: 1, zoom: 1, panX: 0, panY: 0, cw: 0, ch: 0 };
  let needsDraw = false;
  function invalidate() { if (!needsDraw) { needsDraw = true; requestAnimationFrame(draw); } }
  function layout() {
    if (!state.photo) return;
    view.scale = view.base * view.zoom;
    const iw = state.photo.w * view.scale, ih = state.photo.h * view.scale;
    /* keep the photo on screen: when it is smaller than the frame it is centred, when larger it cannot leave a gap */
    const clampPan = (pan, img, frame) => img <= frame ? 0 : Math.max(frame - img, Math.min(0, pan));
    view.panX = clampPan(view.panX, iw, view.cw); view.panY = clampPan(view.panY, ih, view.ch);
    view.ox = iw <= view.cw ? (view.cw - iw) / 2 : view.panX; view.oy = ih <= view.ch ? (view.ch - ih) / 2 : view.panY;
    $('zoomVal').textContent = view.zoom === 1 ? '' : `${view.zoom.toFixed(1)}×`;
  }
  function fit() {
    const r = wrap.getBoundingClientRect();
    /* when zoomed in, keep the same point of the photo in the middle as the stage changes size */
    const keep = state.photo && view.zoom > 1 && view.scale > 0 && view.cw > 1 ? { x: (view.cw / 2 - view.ox) / view.scale, y: (view.ch / 2 - view.oy) / view.scale } : null;
    view.dpr = window.devicePixelRatio || 1; view.cw = Math.max(1, r.width); view.ch = Math.max(1, r.height);
    canvas.width = Math.round(r.width * view.dpr); canvas.height = Math.round(r.height * view.dpr);
    if (state.photo) view.base = Math.max(1e-4, Math.min(view.cw / state.photo.w, view.ch / state.photo.h));
    if (keep) { const sc = view.base * view.zoom; view.panX = view.cw / 2 - keep.x * sc; view.panY = view.ch / 2 - keep.y * sc; }
    layout(); invalidate();
  }
  /* zoom keeping the photo point under (clientX, clientY) still */
  const ZOOM_MIN = 1, ZOOM_MAX = 5;
  function zoomAt(factor, clientX, clientY, soft) {
    const r = canvas.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
    const ix = (px - view.ox) / view.scale, iy = (py - view.oy) / view.scale;
    const lo = soft ? 0.7 : ZOOM_MIN, hi = soft ? 6.5 : ZOOM_MAX;
    view.zoom = Math.max(lo, Math.min(hi, view.zoom * factor));
    const sc = view.base * view.zoom;
    view.panX = px - ix * sc; view.panY = py - iy * sc;
    layout(); invalidate();
  }
  function inPhoto(pt) { return pt.x >= 0 && pt.y >= 0 && pt.x <= state.photo.w && pt.y <= state.photo.h; }
  /* after a pinch overshoots, ease the zoom back inside its limits */
  let zoomAnim = null;
  function settleZoom(cx, cy) {
    const target = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.zoom)); if (target === view.zoom) return;
    const from = view.zoom, t0 = performance.now(), dur = 220; cancelAnimationFrame(zoomAnim);
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); const z = from + (target - from) * e; zoomAt(z / view.zoom, cx, cy, true); if (k < 1) zoomAnim = requestAnimationFrame(step); else { view.zoom = target; layout(); invalidate(); } };
    zoomAnim = requestAnimationFrame(step);
  }
  let viewAnim = null;
  function glideTo(zoom, panX, panY) {
    cancelAnimationFrame(viewAnim); const z0 = view.zoom, x0 = view.panX, y0 = view.panY, t0 = performance.now(), dur = 280;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); view.zoom = z0 + (zoom - z0) * e; view.panX = x0 + (panX - x0) * e; view.panY = y0 + (panY - y0) * e; layout(); invalidate(); if (k < 1) viewAnim = requestAnimationFrame(step); };
    viewAnim = requestAnimationFrame(step);
  }
  function bedBounds(bed) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; bed.pts.forEach(p => { const q = cam.toImage(p.X, p.Z); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }); return { x0, y0, x1, y1 }; }
  function zoomToBed(bed) {
    if (!cam || !bed) return; const b = bedBounds(bed); const bw = Math.max(40, b.x1 - b.x0), bh = Math.max(40, b.y1 - b.y0);
    /* room above the bed for the plants standing in it, and a margin all round */
    const fx0 = b.x0 - bw * 0.15, fx1 = b.x1 + bw * 0.15, fy0 = b.y0 - bh * 1.4, fy1 = b.y1 + bh * 0.25;
    /* keep the bed clear of the strips that float over the top and bottom of the photo */
    const topPad = isPhone() ? 70 : 60, botPad = isPhone() ? 80 : 64, availH = Math.max(80, view.ch - topPad - botPad);
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(view.cw / ((fx1 - fx0) * view.base), availH / ((fy1 - fy0) * view.base))));
    const sc = view.base * zoom, cxI = (fx0 + fx1) / 2, cyI = (fy0 + fy1) / 2;
    glideTo(zoom, view.cw / 2 - cxI * sc, topPad + availH / 2 - cyI * sc); wakeZoom();
  }
  function nearestBed() { if (!state.beds.length || !cam) return null; const r = canvas.getBoundingClientRect(); const c = toImg({ clientX: r.left + view.cw / 2, clientY: r.top + view.ch / 2 }); let best = null, bd = Infinity; state.beds.forEach(b => { const bb = bedBounds(b); const d = Math.hypot((bb.x0 + bb.x1) / 2 - c.x, (bb.y0 + bb.y1) / 2 - c.y); if (d < bd) { bd = d; best = b; } }); return best; }
  const zoomCentre = () => { const r = canvas.getBoundingClientRect(); return [r.left + view.cw / 2, r.top + view.ch / 2]; };
  let zoomIdleT = null;
  function wakeZoom() { $('zoomCtl').classList.remove('idle'); clearTimeout(zoomIdleT); zoomIdleT = setTimeout(() => $('zoomCtl').classList.add('idle'), 2500); }
  $('zoomIn').addEventListener('click', () => { wakeZoom(); zoomAt(1.4, ...zoomCentre()); });
  $('zoomOut').addEventListener('click', () => { wakeZoom(); zoomAt(1 / 1.4, ...zoomCentre()); });
  $('zoomFit').addEventListener('click', () => { wakeZoom(); view.zoom = 1; view.panX = view.panY = 0; layout(); invalidate(); });
  $('gridBtn').addEventListener('click', () => { const c = $('showGrid'); c.checked = !c.checked; $('gridBtn').setAttribute('aria-pressed', String(c.checked)); wakeZoom(); invalidate(); });
  canvas.addEventListener('wheel', (ev) => { ev.preventDefault(); zoomAt(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY); }, { passive: false });
  new ResizeObserver(fit).observe(wrap);
  function toImg(ev) { const r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left - view.ox) / view.scale, y: (ev.clientY - r.top - view.oy) / view.scale }; }

  function drawBed(c, bed, alpha) {
    const pts = bed.pts.map(p => cam.toImage(p.X, p.Z)); if (pts.length < 2) return;
    if (pts.length > 2) { window.Beds.drawBed(c, bed, cam, { alpha, lineWidth: 2 / view.scale }); return; }
    c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.strokeStyle = `rgba(40,28,18,${0.9 * alpha})`; c.lineWidth = 2 / view.scale; c.stroke();
  }
  let bedLayer = null, bedKey = '';
  function bedsCanvas() {
    const key = JSON.stringify([state.beds, state.ground, state.photo.w]);
    if (bedLayer && bedKey === key) return bedLayer;
    const c = document.createElement('canvas'); c.width = state.photo.w; c.height = state.photo.h;
    const saved = view.scale; view.scale = 1; state.beds.forEach(b => drawBed(c.getContext('2d'), b, 1)); view.scale = saved;
    bedLayer = c; bedKey = key; return c;
  }
  function drawScene(c, forExport, plantsOnly) {
    const ph = state.photo;
    if (!plantsOnly) { c.drawImage(ph.img, 0, 0, ph.w, ph.h); if (state.beds.length) c.drawImage(bedsCanvas(), 0, 0); }
    /* while the time slider moves, draw quickly at quarter-month steps; the frame after it stops is drawn in full */
    const fast = !forExport && scrubbing, tq = fast ? Math.round(tEff() * 4) / 4 : tEff();
    const env = { cam, sun: state.sun, light: state.light || window.Compose.autoLight(state.stats || {}), stats: state.stats, quality: forExport ? 'best' : fast ? 'fast' : 'normal' };
    const items = sortedPlants().map(pl => ({ kind: 'plant', Z: pl.Z, pl })).concat(state.masks.filter(m => m.Z != null).map(m => ({ kind: 'mask', Z: m.Z, m })));
    items.sort((a, b) => b.Z - a.Z);
    items.forEach(it => {
      if (it.kind === 'mask') { if (!plantsOnly) c.drawImage(window.Masks.maskedPhoto(it.m, ph), 0, 0); return; }
      const pl = it.pl, p = dims(pl); if (!p) return;
      const vary = 0.94 + 0.12 * ((pl.seed % 997) / 997);
      window.Compose.drawPlant(c, { p, st: stateAt(p, tq), t: tq, seed: pl.seed, size: sizeOf(pl) * vary, flip: !!pl.flip !== (window.Render.hasSprites(p) && state.sun.az > 0), X: pl.X, Z: pl.Z }, env);
    });
  }
  function compositeCanvas(plantsOnly) {
    const c = document.createElement('canvas'); c.width = state.photo.w; c.height = state.photo.h;
    const saved = view.scale; view.scale = 1; drawScene(c.getContext('2d'), true, plantsOnly); view.scale = saved; return c;
  }

  function draw() {
    needsDraw = false; if (!state.photo || !cam) return;
    const dpr = view.dpr, sc = view.scale, lw = (n) => n / sc;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#1b2318'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * view.ox, dpr * view.oy);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, state.photo.w, state.photo.h); ctx.clip(); drawScene(ctx, false); ctx.restore();
    if (state.drawingBed && state.drawingBed.length) {
      drawBed(ctx, { pts: state.drawingBed }, 0.6); ctx.fillStyle = '#fff';
      state.drawingBed.forEach(p => { const q = cam.toImage(p.X, p.Z); ctx.beginPath(); ctx.arc(q.x, q.y, lw(5), 0, Math.PI * 2); ctx.fill(); });
    }
    if ($('showGrid').checked || state.step === 'photo') {
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, state.photo.w, state.photo.h); ctx.clip(); ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = lw(1);
      const near = Math.max(0.5, cam.hc * 0.4), farZ = Math.min(40, (fenceZ() || 40) + 0.01);
      for (let X = -12; X <= 12; X++) { const a = cam.toImage(X, near), b = cam.toImage(X, farZ); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      for (let Z = 1; Z <= farZ; Z += (Z < 10 ? 1 : 5)) { if (Z < near) continue; const a = cam.toImage(-12, Z), b = cam.toImage(12, Z); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.restore();
    }
    if (state.mode === 'mask') {
      const m = state.masks.find(x => x.id === state.maskSel);
      if (m) {
        ctx.save(); ctx.globalAlpha = 0.45; ctx.drawImage(maskTint(m), 0, 0, state.photo.w, state.photo.h); ctx.restore();
        if (m.Z != null) { const g = cam.toImage(0, m.Z); ctx.save(); ctx.strokeStyle = '#ff3b6b'; ctx.lineWidth = lw(1.5); ctx.setLineDash([lw(8), lw(6)]); ctx.beginPath(); ctx.moveTo(0, g.y); ctx.lineTo(state.photo.w, g.y); ctx.stroke(); ctx.restore(); }
      }
      if (state.hoverPt) { ctx.save(); ctx.strokeStyle = state.erase ? '#fff' : '#ff3b6b'; ctx.lineWidth = lw(1.5); ctx.beginPath(); ctx.arc(state.hoverPt.x, state.hoverPt.y, state.brush, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
    }
    if (state.step === 'photo') {
      const g = state.ground; ctx.save();
      ctx.strokeStyle = '#ffd86b'; ctx.lineWidth = lw(2); ctx.setLineDash([lw(10), lw(6)]);
      ctx.beginPath(); ctx.moveTo(0, cam.horizonY); ctx.lineTo(state.photo.w, cam.horizonY); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#ffd86b'; ctx.font = `${lw(13)}px system-ui`; ctx.fillText('eye level (drag)', lw(10), cam.horizonY - lw(8));
      if (g.ref && !(g.refV && g.refV.yt < g.refV.yb - 2)) {
        ctx.strokeStyle = '#6bd0ff'; ctx.lineWidth = lw(3); ctx.beginPath(); ctx.moveTo(g.ref.x1, g.ref.y1); ctx.lineTo(g.ref.x2, g.ref.y2); ctx.stroke(); ctx.fillStyle = '#6bd0ff';
        const hr = lw(HANDLE_R());
        [[g.ref.x1, g.ref.y1], [g.ref.x2, g.ref.y2]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill(); if (mqCoarse.matches) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = lw(2); ctx.stroke(); ctx.restore(); } });
        ctx.fillText(`${g.refLen} m`, (g.ref.x1 + g.ref.x2) / 2 + lw(8), (g.ref.y1 + g.ref.y2) / 2 + lw(22));
      }
      if (g.refV) {
        const v = g.refV, hr = lw(HANDLE_R());
        ctx.strokeStyle = '#6bd0ff'; ctx.lineWidth = lw(3); ctx.beginPath(); ctx.moveTo(v.x, v.yb); ctx.lineTo(v.x, v.yt); ctx.stroke();
        ctx.lineWidth = lw(2); ctx.beginPath(); ctx.moveTo(v.x - lw(12), v.yb); ctx.lineTo(v.x + lw(12), v.yb); ctx.moveTo(v.x - lw(12), v.yt); ctx.lineTo(v.x + lw(12), v.yt); ctx.stroke();
        ctx.fillStyle = '#6bd0ff'; [[v.x, v.yb], [v.x, v.yt]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, hr, 0, Math.PI * 2); ctx.fill(); if (mqCoarse.matches) { ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = lw(2); ctx.stroke(); ctx.restore(); } });
        ctx.fillText(`${v.h} m`, v.x + lw(14), (v.yb + v.yt) / 2 + lw(4));
      }
      drawFigure();
      ctx.restore();
    }
    if (state.mode === 'plant' && state.libSel && state.hoverPt && !(press && press.moved)) {
      const pl = cam.toPlan(state.hoverPt.x, state.hoverPt.y), p = LIB.byId[state.libSel];
      if (pl && pl.Z <= maxPlantZ() + 0.3) window.Render.drawPlant(ctx, p, stateAt(p, tEff()), state.hoverPt.x, state.hoverPt.y, cam.ppm(pl.X, pl.Z), 12345, { alpha: 0.55, t: tEff(), size: window.Site.growth(p, state.years) });
    }
    state.plants.forEach(pl => {
      const isSel = pl.id === state.sel || state.multi.has(pl.id), isHov = pl.id === state.hover; if (!isSel && !isHov) return;
      const b = placedBounds(pl), p = LIB.byId[pl.pid]; ctx.save();
      ctx.strokeStyle = isSel ? '#ffd86b' : 'rgba(255,255,255,0.7)'; ctx.lineWidth = lw(isSel ? 2 : 1); ctx.setLineDash([lw(6), lw(4)]);
      ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); ctx.setLineDash([]);
      const fs = lw(12); ctx.font = `${fs}px system-ui`; const tw = ctx.measureText(p.name).width + lw(10), lx = (b.x0 + b.x1) / 2 - tw / 2, ly = b.y0 - lw(20);
      ctx.fillStyle = 'rgba(20,30,18,0.8)'; ctx.fillRect(lx, ly, tw, lw(17)); ctx.fillStyle = '#fff'; ctx.fillText(p.name, lx + lw(5), ly + lw(12.5)); ctx.restore();
    });
    drawLoupe();
  }
  /* the mask painted in pink, rebuilt only when the mask changes */
  const tintCache = {};
  function maskTint(m) {
    const e = tintCache[m.id]; if (e && e.v === m.version && e.c.width === m.canvas.width) return e.c;
    const c = (e && e.c) || document.createElement('canvas'); c.width = m.canvas.width; c.height = m.canvas.height;
    const tc = c.getContext('2d'); tc.clearRect(0, 0, c.width, c.height); tc.drawImage(m.canvas, 0, 0); tc.globalCompositeOperation = 'source-in'; tc.fillStyle = '#ff3b6b'; tc.fillRect(0, 0, c.width, c.height);
    tintCache[m.id] = { v: m.version, c }; return c;
  }
  /* a magnified view above the finger while a calibration handle is dragged, so the finger does not hide it */
  function drawLoupe() {
    const p = press; if (!p || !p.touch || !p.drag || !/^(horizon|ref1|ref2|refVt|refVb)$/.test(p.drag.kind) || !p.client) return;
    const dpr = view.dpr, R = 54, mag = 2.2, r = canvas.getBoundingClientRect();
    const fx = p.client.x - r.left, fy = p.client.y - r.top;
    let cx = fx, cy = fy - R - 46; if (cy - R < 8) cy = fy + R + 46; cx = Math.max(R + 8, Math.min(view.cw - R - 8, cx));
    const sw = (R * 2) / mag, sh = sw;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 14; ctx.fillStyle = '#1b2318'; ctx.fill(); ctx.shadowBlur = 0;
    ctx.clip();
    ctx.drawImage(canvas, (fx - sw / 2) * dpr, (fy - sh / 2) * dpr, sw * dpr, sh * dpr, cx - R, cy - R, R * 2, R * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.restore();
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }

  /* a 1.75 m person standing on the lawn: the quickest way to see whether the scale is right */
  const FIG_H = 1.75;
  function figureImage() { const g = state.ground; if (!g.figure) return null; const q = cam.toImage(g.figure.X, g.figure.Z); return { x: q.x, y: q.y, h: FIG_H * cam.ppm(g.figure.X, g.figure.Z) }; }
  function drawFigure() {
    const f = figureImage(); if (!f) return; const h = f.h, w = h * 0.3, lw = (n) => n / view.scale; ctx.save();
    ctx.translate(f.x, f.y); ctx.fillStyle = 'rgba(40,46,52,0.78)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = lw(1.5);
    const path = () => { ctx.beginPath(); ctx.arc(0, -h * 0.93, h * 0.07, 0, Math.PI * 2); ctx.moveTo(-w * 0.5, -h * 0.84); ctx.quadraticCurveTo(-w * 0.62, -h * 0.84, -w * 0.62, -h * 0.74); ctx.lineTo(-w * 0.5, -h * 0.46); ctx.lineTo(-w * 0.36, -h * 0.46); ctx.lineTo(-w * 0.36, -h * 0.02); ctx.lineTo(-w * 0.08, 0); ctx.lineTo(-w * 0.04, -h * 0.42); ctx.lineTo(w * 0.04, -h * 0.42); ctx.lineTo(w * 0.08, 0); ctx.lineTo(w * 0.36, -h * 0.02); ctx.lineTo(w * 0.36, -h * 0.46); ctx.lineTo(w * 0.5, -h * 0.46); ctx.lineTo(w * 0.62, -h * 0.74); ctx.quadraticCurveTo(w * 0.62, -h * 0.84, w * 0.5, -h * 0.84); ctx.closePath(); };
    path(); ctx.fill(); path(); ctx.stroke();
    ctx.fillStyle = 'rgba(20,30,18,0.8)'; const fs = lw(12); ctx.font = `${fs}px system-ui`; const t = `${FIG_H} m person, drag me`, tw = ctx.measureText(t).width + lw(10);
    ctx.fillRect(-tw / 2, -h - lw(22), tw, lw(17)); ctx.fillStyle = '#fff'; ctx.fillText(t, -tw / 2 + lw(5), -h - lw(9)); ctx.restore();
  }
  function hitFigure(pt) { const f = figureImage(); if (!f) return false; const w = Math.max(f.h * 0.35, 24 / view.scale); return pt.x > f.x - w && pt.x < f.x + w && pt.y > f.y - f.h - 10 / view.scale && pt.y < f.y + 8 / view.scale; }
  function ensureFigure() { const g = state.ground; if (!g.figure && cam) g.figure = { X: 0.9, Z: Math.max(2, Math.min(8, (fenceZ() || 6) - 1.5)) }; }
  function hitPlant(pt) {
    const m = (mqCoarse.matches ? 22 : 10) / view.scale;
    for (const pl of sortedPlants().reverse()) { const b = placedBounds(pl); const gx = Math.max(0, m - (b.x1 - b.x0) / 2), gy = Math.max(0, m - (b.y1 - b.y0) / 2); if (pt.x >= b.x0 - gx && pt.x <= b.x1 + gx && pt.y >= b.y0 - gy && pt.y <= b.y1 + gy) return pl; }
    return null;
  }

  /* ---------------- gestures ----------------
   * One pointer: a press that is a tap until it moves more than a few pixels, then a drag.
   * Two pointers: pinch to zoom and pan; whatever the first finger had started is undone. */
  const pointers = new Map(); let pinch = null, press = null;
  const TAP_SLOP = 6, TOUCH_SLOP = 14; let lastPointerType = 'mouse', lastCanvasUp = 0, lastPlanted = null;
  function blurInputs() { const a = document.activeElement; if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) a.blur(); }
  function cancelPress() {
    const p = press; press = null; if (!p || !p.drag) return;
    const d = p.drag, g = state.ground;
    if (d.kind === 'plant') { const pl = state.plants.find(x => x.id === d.id); if (pl && d.orig) { pl.X = d.orig.X; pl.Z = d.orig.Z; } }
    else if (d.kind === 'group') { d.origs.forEach(o => { const pl = state.plants.find(x => x.id === o.id); if (pl) { pl.X = o.X; pl.Z = o.Z; } }); }
    else if (d.kind === 'paint') { const m = state.masks.find(x => x.id === d.id); if (m && d.snap) { const mc = m.canvas.getContext('2d'); mc.clearRect(0, 0, m.canvas.width, m.canvas.height); mc.drawImage(d.snap, 0, 0); m.version++; } }
    else if (d.kind === 'horizon' && d.orig != null) { g.horizon = d.orig; rebuild(); }
    else if ((d.kind === 'ref1' || d.kind === 'ref2') && d.orig) { g.ref = d.orig; rebuild(); }
    else if ((d.kind === 'refVt' || d.kind === 'refVb') && d.orig) { g.refV = d.orig; rebuild(); }
    else if (d.kind === 'figure' && d.orig) { g.figure = d.orig; }
    invalidate();
  }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), zoom0: view.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox0: view.ox, oy0: view.oy, scale0: view.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  function movePinch() {
    const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2; const r = canvas.getBoundingClientRect();
    const ix = (pinch.mx - r.left - pinch.ox0) / pinch.scale0, iy = (pinch.my - r.top - pinch.oy0) / pinch.scale0;
    let z = pinch.zoom0 * d / Math.max(1, pinch.d0);
    /* rubber band beyond the limits */
    if (z < ZOOM_MIN) z = ZOOM_MIN - (ZOOM_MIN - z) * 0.35; if (z > ZOOM_MAX) z = ZOOM_MAX + (z - ZOOM_MAX) * 0.35;
    view.zoom = Math.max(0.7, Math.min(6.5, z));
    const sc = view.base * view.zoom; view.panX = (mx - r.left) - ix * sc; view.panY = (my - r.top) - iy * sc; pinch.cx = mx; pinch.cy = my;
    layout(); invalidate();
  }
  function pressIntent(ev, pt) {
    /* what this press will do if it moves (drag) and if it does not (tap) */
    const touch = ev.pointerType === 'touch', tol = (touch ? 28 : 16) / view.scale;
    if (!inPhoto(pt)) return { drag: { kind: 'pan' }, tap: 'outside' };
    if (state.step === 'photo') {
      const g = state.ground;
      if (state.refVClicks != null) {
        if (state.refVClicks === 0) { g.refV = { x: pt.x, yb: pt.y, yt: pt.y, h: g.refH || 1.8 }; state.refVClicks = 1; updateHint(); return { drag: { kind: 'refVt', orig: null }, tap: null, started: true }; }
        g.refV.yt = Math.min(pt.y, g.refV.yb - 2); state.refVClicks = null; setContext(null); rebuild(); updateHint(); if (mqSheet.matches) setTimeout(() => { setSheet('half'); renderPhoto(); }, 250); return { drag: { kind: 'refVt', orig: null }, tap: null, started: true };
      }
      if (g.refV && Math.hypot(pt.x - g.refV.x, pt.y - g.refV.yt) < tol) return { drag: { kind: 'refVt', orig: Object.assign({}, g.refV) }, tap: null };
      if (g.refV && Math.hypot(pt.x - g.refV.x, pt.y - g.refV.yb) < tol) return { drag: { kind: 'refVb', orig: Object.assign({}, g.refV) }, tap: null };
      if (hitFigure(pt)) return { drag: { kind: 'figure', orig: Object.assign({}, g.figure) }, tap: null };
      if (state.refClicks != null) {
        if (state.refClicks === 0) { g.ref = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }; state.refClicks = 1; rebuild(); updateHint(); return { drag: { kind: 'ref2', orig: null }, tap: null, started: true }; }
        g.ref.x2 = pt.x; g.ref.y2 = pt.y; state.refClicks = null; setContext(null); rebuild(); updateHint(); if (mqSheet.matches) setTimeout(() => { setSheet('half'); renderPhoto(); }, 250); return { drag: { kind: 'ref2', orig: null }, tap: null, started: true };
      }
      if (g.ref && Math.hypot(pt.x - g.ref.x1, pt.y - g.ref.y1) < tol) return { drag: { kind: 'ref1', orig: Object.assign({}, g.ref) }, tap: null };
      if (g.ref && Math.hypot(pt.x - g.ref.x2, pt.y - g.ref.y2) < tol) return { drag: { kind: 'ref2', orig: Object.assign({}, g.ref) }, tap: null };
      if (Math.abs(pt.y - cam.horizonY) < tol * 1.5) return { drag: { kind: 'horizon', orig: g.horizon }, tap: null };
      return { drag: { kind: 'pan' }, tap: null };
    }
    if (state.mode === 'mask') {
      if (state.maskSetDepth) return { drag: { kind: 'pan' }, tap: 'depth' };
      let m = state.masks.find(x => x.id === state.maskSel); if (!m) m = newMask();
      const snap = document.createElement('canvas'); snap.width = m.canvas.width; snap.height = m.canvas.height; snap.getContext('2d').drawImage(m.canvas, 0, 0);
      window.Masks.paint(m, pt.x, pt.y, state.brush, state.erase || ev.altKey); invalidate();
      return { drag: { kind: 'paint', id: m.id, last: pt, snap }, tap: null, started: true };
    }
    if (state.mode === 'bed') return { drag: { kind: 'pan' }, tap: 'corner' };
    const hit = hitPlant(pt);
    /* a plant already here: select or move it rather than stacking another on top */
    if (state.libSel && !hit) return { drag: { kind: 'pan' }, tap: 'plant' };
    const adding = state.multiMode || ev.shiftKey || ev.metaKey || ev.ctrlKey;
    if (hit && (adding || (state.multi.size > 1 && state.multi.has(hit.id)))) {
      let tap = null;
      if (adding) { if (state.multi.size === 0 && state.sel && state.sel !== hit.id) state.multi.add(state.sel); if (state.multi.has(hit.id)) tap = 'unselect'; else state.multi.add(hit.id); state.sel = hit.id; renderSelected(); invalidate(); }
      const start = cam.toPlan(pt.x, Math.max(cam.horizonY + 2, pt.y));
      return { drag: { kind: 'group', start, origs: [...state.multi].map(id => state.plants.find(x => x.id === id)).filter(Boolean).map(q => ({ id: q.id, X: q.X, Z: q.Z })) }, tap, hit: hit.id };
    }
    if (hit) { state.multi.clear(); state.sel = hit.id; const q = placedImage(hit); renderSelected(); invalidate(); return { drag: { kind: 'plant', id: hit.id, dx: pt.x - q.x, dy: pt.y - q.y, orig: { X: hit.X, Z: hit.Z } }, tap: 'select' }; }
    if (adding) return { drag: { kind: 'pan' }, tap: null };
    return { drag: { kind: 'pan' }, tap: 'clear' };
  }
  function pressTap(p) {
    const pt = p.pt;
    if (p.tap === 'outside') { if (state.libSel || state.mode !== 'plant') toast('Tap inside the photo'); return; }
    const tooFar = () => fenceZ() ? 'That is beyond the back fence. Tap the lawn in front of it.' : 'That is too far away. Tap nearer the camera.';
    if (p.tap === 'depth') { const pl = cam.toPlan(pt.x, pt.y); if (!pl) { toast('Tap the ground, below the horizon'); return; } if (pl.Z > maxPlantZ() + 0.3) { toast(tooFar()); return; } const m = state.masks.find(x => x.id === state.maskSel); if (m) { m.Z = pl.Z; state.maskSetDepth = false; save(); renderMasks(); setContext(null); setMode('plant'); toast('Distance set'); } return; }
    if (p.tap === 'corner') {
      const pl = cam.toPlan(pt.x, pt.y); if (!pl) { toast('Tap on the ground, below the horizon'); return; }
      if (pl.Z > maxPlantZ() + 0.3) { toast(tooFar()); return; }
      if (!state.drawingBed) state.drawingBed = [];
      const last = state.drawingBed[state.drawingBed.length - 1]; if (last && Math.hypot(last.X - pl.X, last.Z - pl.Z) < 0.05) return;
      state.drawingBed.push(pl); $('doneBtn').disabled = state.drawingBed.length < 3; invalidate(); updateHint(); return;
    }
    if (p.tap === 'plant') {
      const pl = cam.toPlan(pt.x, pt.y); if (!pl) { toast('Tap on the ground, below the horizon'); return; }
      if (pl.Z > maxPlantZ() + 0.3) { toast(tooFar()); return; }
      /* a nervous double tap is one tap */
      if (lastPlanted && performance.now() - lastPlanted.t < 600 && Math.hypot(p.x0 - lastPlanted.x, p.y0 - lastPlanted.y) < 24) return;
      lastPlanted = { t: performance.now(), x: p.x0, y: p.y0 };
      if (state.beds.length && !state.lawnOk && !inAnyBed(pl)) { confirmDialog('That spot is outside your borders. Plant it on the lawn anyway?', 'Plant here').then(ok => { if (ok) { state.lawnOk = true; placeChosen(pl); } }); return; }
      placeChosen(pl); return;
    }
    if (p.tap === 'select') { renderSelected(); if (sheet.pos === 'peek' && !state.libSel) setSheet('half'); return; }
    if (p.tap === 'unselect') { state.multi.delete(p.hit); if (state.sel === p.hit) state.sel = [...state.multi].pop() || null; if (state.multi.size < 2) { const last = [...state.multi][0]; state.multi.clear(); if (last) state.sel = last; } renderSelected(); invalidate(); return; }
    if (p.tap === 'clear') { if (state.sel || state.multi.size) { state.sel = null; state.multi.clear(); state.multiMode = false; renderSelected(); invalidate(); } }
  }
  function inAnyBed(pl) { return state.beds.some(b => { const pts = b.pts; let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const a = pts[i], c = pts[j]; if ((a.Z > pl.Z) !== (c.Z > pl.Z) && pl.X < (c.X - a.X) * (pl.Z - a.Z) / (c.Z - a.Z) + a.X) inside = !inside; } return inside; }); }
  function placeChosen(pl) {
    { const lp = LIB.byId[state.libSel]; if (!lp) return;
      const np = { id: uid(), pid: lp.id, X: pl.X, Z: pl.Z, seed: Math.floor(Math.random() * 1e9), size: 1 };
      if (lp.rootstocks) np.rootstock = Object.keys(lp.rootstocks)[1] || Object.keys(lp.rootstocks)[0];
      state.plants.push(np); state.sel = np.id; afterChange();
      if (state.plants.length === 1 && !lsGet('netgarden.tip.year') && !/[?&]tour=0/.test(location.search)) { lsSet('netgarden.tip.year', '1'); setTimeout(yearTip, 1800); }
      if (!placeChosen.explainedAge && state.years < 15) { placeChosen.explainedAge = true; toast(`Planted ${lp.name}, shown ${state.years} years after planting. Garden age is in Review.`, 4500); }
      else toast(isPhone() ? `Planted ${lp.name}` : `Planted ${lp.name}. Tap again for another.`, 1800);
    }
  }
  function pressMove(p, ev) {
    const pt = toImg(ev), d = p.drag, g = state.ground;
    if (d.kind === 'horizon') { g.horizon = Math.max(0.02, Math.min(0.9, pt.y / state.photo.h)); rebuild(); }
    else if (d.kind === 'ref1') { g.ref.x1 = pt.x; g.ref.y1 = pt.y; rebuild(); }
    else if (d.kind === 'ref2') { g.ref.x2 = pt.x; g.ref.y2 = pt.y; rebuild(); }
    else if (d.kind === 'refVt') { g.refV.yt = Math.min(pt.y, g.refV.yb - 2); rebuild(); }
    else if (d.kind === 'refVb') { const dy = pt.y - g.refV.yb; g.refV.x = pt.x; g.refV.yb = pt.y; g.refV.yt += dy; rebuild(); }
    else if (d.kind === 'figure') { const pl = cam.toPlan(pt.x, Math.max(cam.horizonY + 2, pt.y)); if (pl) g.figure = { X: pl.X, Z: Math.min(pl.Z, maxPlantZ() + 2) }; }
    else if (d.kind === 'paint') { const m = state.masks.find(x => x.id === d.id); if (m) { window.Masks.line(m, d.last.x, d.last.y, pt.x, pt.y, state.brush, state.erase || ev.altKey); d.last = pt; } }
    else if (d.kind === 'plant') {
      const bx = Math.max(0, Math.min(state.photo.w, pt.x - d.dx)), by = Math.max(cam.horizonY + 2, Math.min(state.photo.h, pt.y - d.dy));
      const pl = cam.toPlan(bx, by); if (pl) { const plant = state.plants.find(x => x.id === d.id); if (plant) { plant.X = pl.X; plant.Z = Math.min(pl.Z, maxPlantZ()); } }
    }
    else if (d.kind === 'group' && d.start) {
      const now = cam.toPlan(pt.x, Math.max(cam.horizonY + 2, pt.y)); if (now) { const dX = now.X - d.start.X, dZ = now.Z - d.start.Z, zMax = maxPlantZ();
        d.origs.forEach(o => { const pl = state.plants.find(x => x.id === o.id); if (pl) { pl.X = o.X + dX; pl.Z = Math.max(0.4, Math.min(zMax, o.Z + dZ)); } }); }
    }
    else if (d.kind === 'pan') { if (view.zoom > 1) { view.panX = d.panX0 + (ev.clientX - p.x0); view.panY = d.panY0 + (ev.clientY - p.y0); layout(); } }
    invalidate();
  }
  function pressEnd(p) {
    const d = p.drag;
    if (d.kind === 'plant') { const plant = state.plants.find(x => x.id === d.id); if (plant && d.orig && Math.hypot(plant.X - d.orig.X, plant.Z - d.orig.Z) < 0.05) { plant.X = d.orig.X; plant.Z = d.orig.Z; renderSelected(); } else afterChange(); }
    else if (d.kind === 'group') { if (d.origs.some(o => { const pl = state.plants.find(x => x.id === o.id); return pl && Math.hypot(pl.X - o.X, pl.Z - o.Z) > 0.05; })) afterChange(); else renderSelected(); }
    else if (d.kind === 'paint') { save(); renderMasks(); }
    else if (d.kind !== 'pan') { save(); renderPhoto(); }
    invalidate();
  }
  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return; blurInputs(); wakeZoom(); lastPointerType = ev.pointerType;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); try { canvas.setPointerCapture(ev.pointerId); } catch (e) { }
    if (pointers.size === 2) { cancelPress(); startPinch(); return; }
    if (pointers.size > 2 || pinch || !cam) return;
    const pt = toImg(ev), intent = pressIntent(ev, pt);
    press = { id: ev.pointerId, pt, x0: ev.clientX, y0: ev.clientY, client: { x: ev.clientX, y: ev.clientY }, touch: ev.pointerType === 'touch', moved: !!intent.started, drag: intent.drag, tap: intent.tap };
    if (press.drag.kind === 'pan') { press.drag.panX0 = view.panX; press.drag.panY0 = view.panY; }
    state.hoverPt = pt; invalidate();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch) { if (pointers.size === 2) movePinch(); return; }
    if (!cam) return;
    if (press && ev.pointerId === press.id) {
      press.client = { x: ev.clientX, y: ev.clientY };
      if (!press.moved) { if (Math.hypot(ev.clientX - press.x0, ev.clientY - press.y0) < (press.touch ? TOUCH_SLOP : TAP_SLOP)) return; press.moved = true; }
      state.hoverPt = toImg(ev); pressMove(press, ev); return;
    }
    if (ev.pointerType === 'mouse') {
      const pt = toImg(ev); state.hoverPt = pt;
      if (state.mode === 'plant') { const h = hitPlant(pt); state.hover = h ? h.id : null; canvas.style.cursor = state.libSel ? 'crosshair' : (h ? 'move' : 'default'); }
      invalidate();
    }
  });
  const endPointer = (ev) => {
    pointers.delete(ev.pointerId);
    if (pinch) { if (pointers.size < 2) { const c = pinch; pinch = null; settleZoom(c.cx, c.cy); } return; }
    if (!press || ev.pointerId !== press.id) return;
    const p = press; press = null; lastCanvasUp = performance.now();
    if (ev.type === 'pointercancel') { invalidate(); return; }
    /* a short wobble that could not pan anything is still a tap */
    if (p.moved && p.drag.kind === 'pan' && view.zoom === 1 && p.tap && Math.hypot(ev.clientX - p.x0, ev.clientY - p.y0) < 20) p.moved = false;
    if (p.moved) pressEnd(p); else if (p.tap) pressTap(p); else pressEnd(p);
    if (p.touch) { state.hoverPt = null; invalidate(); }
  };
  canvas.addEventListener('pointerup', endPointer); canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !press) { state.hoverPt = null; state.hover = null; invalidate(); } });
  canvas.addEventListener('dblclick', () => { if (state.mode === 'bed' && lastPointerType === 'mouse') finishBed(); });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  /* the selection bar appears where the finger just was: ignore a click that follows a canvas tap too closely */
  ['sbFlip', 'sbDup', 'sbDel', 'sbClose'].forEach(id => $(id).addEventListener('click', (ev) => { if (performance.now() - lastCanvasUp < 400) { ev.stopImmediatePropagation(); ev.preventDefault(); } }, true));
  window.addEventListener('keydown', (ev) => {
    if (ev.target.matches('input, select, textarea')) return;
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (mod && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (ev.key === 'Escape') cancelContext();
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && (state.sel || state.multi.size)) removeSelected();
    if (ev.key === 'Enter' && state.mode === 'bed') finishBed();
    if (ev.key === 'ArrowRight') setTime(state.t + 0.25); if (ev.key === 'ArrowLeft') setTime(state.t - 0.25);
    if (ev.key === '[') { state.brush = Math.max(4, state.brush * 0.8); renderMasks(); invalidate(); } if (ev.key === ']') { state.brush = Math.min(400, state.brush * 1.25); renderMasks(); invalidate(); }
  });

  /* ---------------- bottom sheet (phones held upright) ----------------
   * The panel slides over the photo with three resting positions. The stage above it is
   * resized only when the sheet settles, so dragging stays smooth. */
  const sheet = { pos: 'half', v: 0, peek: 150 };   /* v: visible height of the sheet at rest */
  const sideEl = $('side'), layoutEl = $('layout'), sheetHead = $('sheetHead');
  function sheetMetrics() { const tb = $('timebar'); sheet.peek = sheetHead.offsetHeight + (tb.parentElement === sideEl ? tb.offsetHeight : 0); sheet.L = layoutEl.clientHeight; }
  function sheetV(pos) { return pos === 'full' ? Math.max(sheet.peek, sheet.L - 8) : pos === 'half' ? Math.max(sheet.peek, Math.round(sheet.L * 0.5)) : sheet.peek; }
  /* animate from the current visual position to a resting height */
  function snapTo(v) {
    const cur = sheet.v - (parseFloat(sideEl.style.getPropertyValue('--sheet-dy')) || 0);
    sheet.v = v; sideEl.style.height = v + 'px'; layoutEl.style.setProperty('--peek', v + 'px'); document.documentElement.style.setProperty('--peek', v + 'px');
    sideEl.classList.add('dragging'); sideEl.style.setProperty('--sheet-dy', (v - cur) + 'px'); void sideEl.offsetHeight;
    sideEl.classList.remove('dragging'); sideEl.style.setProperty('--sheet-dy', '0px');
    fit(); /* the stage has a new height now; anything that zooms next must see it */
  }
  function setSheet(pos) {
    sheet.pos = pos; $('sheetToggle').textContent = pos === 'peek' ? '⌃' : '⌄'; $('sheetToggle').setAttribute('aria-label', pos === 'peek' ? 'Show panel' : 'Hide panel');
    if (!mqSheet.matches) return;
    sheetMetrics(); snapTo(sheetV(pos)); sideEl.classList.toggle('peek', pos === 'peek'); layoutEl.classList.toggle('sheetFull', pos === 'full');
  }
  let sheetDrag = null;
  function sheetDown(y) { sheetMetrics(); sheetDrag = { y0: y, v0: sheet.v, v: sheet.v, last: y, lastT: performance.now(), vel: 0, moved: false }; sideEl.classList.add('dragging'); }
  function sheetMove(y) {
    if (!sheetDrag) return; const d = sheetDrag, now = performance.now(), dt = Math.max(1, now - d.lastT);
    d.vel = 0.6 * d.vel + 0.4 * ((d.last - y) / dt); d.last = y; d.lastT = now; if (Math.abs(y - d.y0) > 4) d.moved = true;
    let v = d.v0 + (d.y0 - y); const lo = sheetV('peek'), hi = sheetV('full');
    if (v > hi) v = hi + (v - hi) * 0.3; if (v < lo) v = lo - (lo - v) * 0.3;
    d.v = v; sideEl.style.setProperty('--sheet-dy', (d.v0 - v) + 'px'); sideEl.classList.remove('peek');
  }
  function sheetUp() {
    if (!sheetDrag) return; const d = sheetDrag; sheetDrag = null; sideEl.classList.remove('dragging');
    if (!d.moved) { setSheet(sheet.pos); return; }
    const proj = d.v + d.vel * 160; let best = 'half', bd = Infinity;
    ['full', 'half', 'peek'].forEach(p => { const dd = Math.abs(sheetV(p) - proj); if (dd < bd) { bd = dd; best = p; } });
    setSheet(best);
  }
  sheetHead.addEventListener('pointerdown', (ev) => { if (ev.button > 0 || !mqSheet.matches || ev.target.closest('button')) return; blurInputs(); try { sheetHead.setPointerCapture(ev.pointerId); } catch (e) { } sheetDown(ev.clientY); });
  sheetHead.addEventListener('pointermove', (ev) => sheetMove(ev.clientY));
  const sheetHeadUp = (ev) => { if (!sheetDrag) return; const moved = sheetDrag.moved; sheetUp(); if (!moved && ev.type === 'pointerup') setSheet(sheet.pos === 'peek' ? 'half' : sheet.pos === 'half' ? 'full' : 'half'); };
  sheetHead.addEventListener('pointerup', sheetHeadUp); sheetHead.addEventListener('pointercancel', sheetHeadUp);
  /* pulling the panel content down when it is at the top, or up when the sheet is not yet full, moves the sheet */
  let panelTouch = null;
  document.querySelectorAll('.panel').forEach(panel => {
    panel.addEventListener('touchstart', (ev) => { if (!mqSheet.matches || ev.touches.length !== 1) { panelTouch = null; return; } panelTouch = { y: ev.touches[0].clientY, top: panel.scrollTop, decided: false, drag: false }; }, { passive: true });
    panel.addEventListener('touchmove', (ev) => {
      if (!panelTouch || ev.touches.length !== 1 || cardDrag) return; const y = ev.touches[0].clientY, dy = y - panelTouch.y;
      if (!panelTouch.decided) { if (Math.abs(dy) < 3) return; panelTouch.decided = true; panelTouch.drag = (dy > 0 && panel.scrollTop <= 0) || (dy < 0 && sheet.pos !== 'full'); if (panelTouch.drag) sheetDown(panelTouch.y); }
      if (panelTouch.drag) { ev.preventDefault(); sheetMove(y); }
    }, { passive: false });
    const end = () => { if (panelTouch && panelTouch.drag) sheetUp(); panelTouch = null; };
    panel.addEventListener('touchend', end); panel.addEventListener('touchcancel', end);
  });
  /* the time bar lives in the sheet on an upright phone and under the photo everywhere else */
  function relayout() {
    const tb = $('timebar'), stage = $('stage');
    $('time').classList.toggle('vh', isPhone());
    if (mqSheet.matches) { if (tb.parentElement !== sideEl) sideEl.insertBefore(tb, sheetHead.nextSibling); setSheet(sheet.pos); }
    else { if (tb.parentElement !== stage) stage.appendChild(tb); sideEl.style.removeProperty('--sheet-dy'); sideEl.style.removeProperty('height'); sideEl.classList.remove('peek', 'dragging'); layoutEl.classList.remove('sheetFull'); layoutEl.style.removeProperty('--peek'); }
    renderBands(); fit();
  }
  mqSheet.addEventListener('change', relayout); mqPhone.addEventListener('change', relayout);
  /* nothing may scroll the app frame itself (a focused input or a tap can try) */
  layoutEl.addEventListener('scroll', () => { layoutEl.scrollTop = 0; layoutEl.scrollLeft = 0; });
  window.addEventListener('resize', () => { if (mqSheet.matches) setSheet(sheet.pos); });
  window.addEventListener('focusout', () => { if (isPhone()) setTimeout(() => window.scrollTo(0, 0), 50); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (isPhone() && !document.activeElement.matches('input, select, textarea')) window.scrollTo(0, 0); });

  /* ---------------- photo step as a short guided flow on phones ---------------- */
  const wiz = { page: 0, n: 5 };
  function renderWiz() {
    const pages = document.querySelectorAll('#panel-photo .wizPage'); if (!pages.length) return;
    wiz.page = Math.max(0, Math.min(wiz.n - 1, wiz.page));
    pages.forEach(p => p.classList.toggle('on', +p.dataset.page === wiz.page));
    $('wizDots').innerHTML = Array.from({ length: wiz.n }, (_, i) => `<i class="${i === wiz.page ? 'on' : ''}"></i>`).join('');
    $('wizBack').disabled = wiz.page === 0; $('wizNext').classList.toggle('hidden', wiz.page === wiz.n - 1);
    document.querySelector('#panel-photo .wizEnd').classList.toggle('on', wiz.page === wiz.n - 1);
    $('showGrid').checked = $('showGrid').checked || (isPhone() && (wiz.page === 1 || wiz.page === 2));
    updateHint(); invalidate();
  }
  $('wizBack').addEventListener('click', () => { wiz.page--; renderWiz(); $('panel-photo').scrollTop = 0; });
  $('wizNext').addEventListener('click', () => { wiz.page++; renderWiz(); $('panel-photo').scrollTop = 0; });

  /* ---------------- steps, modes, contextual Done/Cancel ---------------- */
  const TITLES = { photo: 'Photo and your garden', beds: 'Beds and what is in front', plants: 'Plants', review: 'Review' };
  function showStep(name) {
    state.step = name; hideToast();
    if (state.refClicks != null || state.refVClicks != null) cancelContext();
    if (name === 'photo') ensureFigure();
    if (name !== 'plants' && state.libSel) { state.libSel = null; setContext(null); renderLibrary(); }
    if ((name === 'photo' || name === 'beds') && state.sel) { state.sel = null; renderSelected(); }
    document.querySelectorAll('.steps button').forEach(b => { b.classList.toggle('active', b.dataset.step === name); if (b.dataset.step === name) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + name));
    $('panelTitle').textContent = TITLES[name]; setSheet(name === 'plants' && state.libSel ? 'peek' : 'half');
    if (name === 'photo') renderWiz();
    if (state.mode !== 'plant') setMode('plant');
    if (name === 'review') renderReview(); if (name === 'photo') renderPhoto(); if (name === 'beds') { renderBeds(); renderMasks(); }
    updateHint(); invalidate();
  }
  document.querySelectorAll('.steps button').forEach(b => b.addEventListener('click', () => showStep(b.dataset.step)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => showStep(b.dataset.goto)));
  $('sheetToggle').addEventListener('click', () => setSheet(sheet.pos === 'peek' ? 'half' : 'peek'));

  let context = null; /* { done, cancel } */
  function setContext(c) { context = c; $('doneBtn').classList.toggle('hidden', !c || !c.done); $('cancelBtn').classList.toggle('hidden', !c); $('doneBtn').disabled = !!(c && c.disabled); updateCtxbar(); if (c && mqSheet.matches) setSheet('peek'); }
  $('doneBtn').addEventListener('click', () => { if (context && context.done) context.done(); });
  $('cancelBtn').addEventListener('click', cancelContext);
  function cancelContext() {
    if (context && context.cancel) { context.cancel(); setContext(null); return; }
    if (state.libSel) { state.libSel = null; renderLibrary(); } else if (state.sel || state.multi.size) { state.sel = null; state.multi.clear(); state.multiMode = false; renderSelected(); }
    updateHint(); invalidate();
  }
  function setMode(m) {
    state.mode = m; state.drawingBed = null; state.maskSetDepth = false; state.refClicks = null; state.refVClicks = null; press = null;
    if (m !== 'plant' && state.sel) { state.sel = null; renderSelected(); }
    $('brushRow').classList.toggle('hidden', m !== 'mask');
    updateHint(); invalidate();
  }
  function updateHint() {
    const ph = isPhone();
    if (state.step === 'photo') {
      if (state.refVClicks != null) hint(state.refVClicks === 0 ? 'Tap the bottom of the fence.' : 'Now tap the top of the fence at the same spot.');
      else if (state.refClicks != null) hint(state.refClicks === 0 ? 'Tap one end of the back fence.' : 'Now tap the other end.');
      else if (ph) hint(['Choose a photo, or keep the sample.', 'Drag the yellow line to your eye level.', 'Mark a fence panel. Does the person look the right height?', '', ''][wiz.page] || '');
      else hint('Drag the yellow line to your eye level. Mark a fence panel. If the grey person looks the right height, the scale is right.');
    }
    else if (state.mode === 'mask') hint(state.maskSetDepth ? 'Tap the ground where this object stands.' : (ph ? (state.erase ? 'Rub out paint, then Done.' : 'Paint over the object, then Done.') : `Paint over the object. ${state.erase ? 'Erasing.' : 'Tick "erase" to remove paint.'} Then press Done.`));
    else if (state.mode === 'bed') hint(state.drawingBed && state.drawingBed.length ? `${state.drawingBed.length} corner${state.drawingBed.length > 1 ? 's' : ''}. ${ph ? 'Keep tapping, then Done.' : 'Keep tapping, then press Done.'}` : (ph ? 'Tap the corners of the border.' : 'Tap the corners of the border on the lawn, then press Done.'));
    else if (state.replaceId) hint('Choose the plant to put in its place.');
    else if (state.multiMode) hint('Tap plants to add them to the selection. Drag one to move them all.');
    else if (state.libSel) hint(ph ? `Tap the lawn to plant ${LIB.byId[state.libSel].name}.` : `Tap the lawn or a border to plant ${LIB.byId[state.libSel].name}. Cancel to stop.`);
    else hint(state.step === 'plants' ? (ph ? (state.plants.length ? '' : state.beds.length ? 'Pick a plant, then tap inside a border.' : 'Pick a plant, then tap the lawn. Or draw a border first (Beds).') : (state.beds.length ? 'Choose a plant on the right, then click inside a border. Drag plants to move them.' : 'Choose a plant on the right, then click where it should go. Drawing a border first (Beds) lets you zoom straight to it.')) : '');
  }

  /* ---------------- beds ---------------- */
  function startBed() {
    showStepQuiet('beds'); setMode('bed'); state.drawingBed = [];
    setContext({ done: finishBed, cancel: () => { state.drawingBed = null; setMode('plant'); }, disabled: true });
    updateHint();
  }
  function finishBed() {
    if (state.drawingBed && state.drawingBed.length > 0 && state.drawingBed.length < 3) { toast('A border needs at least 3 corners. Keep tapping, or Cancel.'); return; }
    if (state.drawingBed && state.drawingBed.length >= 3) { state.beds.push({ id: uid(), pts: state.drawingBed, surface: 'soil' }); toast('Border added'); }
    state.drawingBed = null; setContext(null); setMode('plant'); afterChange(); renderBeds();
  }
  function showStepQuiet(name) { if (state.step !== name) showStep(name); }
  $('bedDraw').addEventListener('click', startBed);
  function renderBeds() {
    const bz = $('bedZoom'); bz.classList.toggle('hidden', !state.beds.length);
    bz.innerHTML = state.beds.length ? `<span class="small" style="align-self:center">Zoom to:</span>` + state.beds.map((b, i) => `<button type="button" data-zoombed="${b.id}">Border ${i + 1}</button>`).join('') + `<button type="button" data-zoombed="">Whole photo</button>` : '';
    bz.querySelectorAll('[data-zoombed]').forEach(btn => btn.addEventListener('click', () => { const bed = state.beds.find(b => b.id === btn.dataset.zoombed); if (bed) zoomToBed(bed); else glideTo(1, 0, 0); if (mqSheet.matches) setSheet('peek'); }));
    const sw = { soil: '#4a3422', bark: '#5a3b26', gravel: '#9a948a' };
    $('bedList').innerHTML = state.beds.length ? state.beds.map((b, i) => `<div class="card"><div class="sw" style="background:${sw[b.surface || 'soil']}"></div><div><div class="nm">Border ${i + 1}</div><div class="meta"><select data-surface="${b.id}"><option value="soil"${(b.surface || 'soil') === 'soil' ? ' selected' : ''}>Bare soil</option><option value="bark"${b.surface === 'bark' ? ' selected' : ''}>Bark mulch</option><option value="gravel"${b.surface === 'gravel' ? ' selected' : ''}>Gravel</option></select></div></div><button data-bed="${b.id}" title="Delete border">×</button></div>`).join('') : '<p class="small">No borders yet.</p>';
    $('bedList').querySelectorAll('[data-bed]').forEach(b => b.addEventListener('click', () => { state.beds = state.beds.filter(x => x.id !== b.dataset.bed); afterChange(); renderBeds(); }));
    $('bedList').querySelectorAll('[data-surface]').forEach(sl => sl.addEventListener('change', () => { const bed = state.beds.find(x => x.id === sl.dataset.surface); if (bed) { bed.surface = sl.value; afterChange(); renderBeds(); } }));
  }

  /* ---------------- foreground masks ---------------- */
  function newMask() { const m = { id: uid(), Z: null, name: `Object ${state.masks.length + 1}`, canvas: window.Masks.makeMaskCanvas(state.photo.w, state.photo.h), version: 1 }; state.masks.push(m); state.maskSel = m.id; renderMasks(); return m; }
  function startMask(m) {
    showStepQuiet('beds'); setMode('mask'); if (m) state.maskSel = m.id; else newMask();
    setContext({ done: () => { const cur = state.masks.find(x => x.id === state.maskSel); if (cur && window.Masks.isEmpty(cur)) { state.masks = state.masks.filter(x => x !== cur); state.maskSel = null; } save(); renderMasks(); setContext(null); if (cur && cur.Z == null && !window.Masks.isEmpty(cur)) { startDepth(); toast('Painted. Now tap the ground where it stands, so plants behind it are hidden.', 4500); } else { setMode('plant'); afterChange(true); } }, cancel: () => { setMode('plant'); renderMasks(); } });
    updateHint();
  }
  function startDepth() {
    if (!state.maskSel) { toast('Paint an object first'); return; }
    showStepQuiet('beds'); setMode('mask'); state.maskSetDepth = true;
    setContext({ cancel: () => { state.maskSetDepth = false; setMode('plant'); } }); updateHint();
  }
  $('maskNew').addEventListener('click', () => startMask(null));
  $('maskDepth').addEventListener('click', startDepth);
  $('brush').addEventListener('input', (e) => { state.brush = +e.target.value; $('brushVal').textContent = `${Math.round(state.brush)} px`; });
  $('eraseChk').addEventListener('change', (e) => { state.erase = e.target.checked; updateHint(); });
  function renderMasks() {
    $('brushVal').textContent = `${Math.round(state.brush)} px`; $('brush').value = state.brush; $('eraseChk').checked = state.erase;
    $('maskList').innerHTML = state.masks.length ? state.masks.map(m => `<div class="card ${m.id === state.maskSel ? 'active' : ''}" data-mask="${m.id}"><div class="sw" style="background:#ff3b6b"></div><div><div class="nm">${m.name}</div><div class="meta">${m.Z == null ? `<button class="mini" data-setdepth="${m.id}">Set how far away it is</button>` : m.Z.toFixed(1) + ' m away'}</div></div><button data-maskdel="${m.id}" title="Delete" aria-label="Delete object">×</button></div>`).join('') : '<p class="small">Nothing painted yet.</p>';
    $('maskList').querySelectorAll('[data-mask]').forEach(c => c.addEventListener('click', () => { startMask(state.masks.find(m => m.id === c.dataset.mask)); }));
    $('maskList').querySelectorAll('[data-setdepth]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); state.maskSel = b.dataset.setdepth; startDepth(); }));
    $('maskList').querySelectorAll('[data-maskdel]').forEach(b => b.addEventListener('click', (e) => { e.stopPropagation(); state.masks = state.masks.filter(x => x.id !== b.dataset.maskdel); if (state.maskSel === b.dataset.maskdel) state.maskSel = null; save(); renderMasks(); invalidate(); }));
  }

  /* ---------------- plant library / palette ---------------- */
  const thumbCache = {};
  function thumb(p) {
    if (thumbCache[p.id]) return thumbCache[p.id];
    const c = document.createElement('canvas'); c.width = 150; c.height = 90; const x = c.getContext('2d');
    const flowerM = p.flower ? p.flower.m[Math.floor(p.flower.m.length / 2)] : (p.fruit ? p.fruit.m[0] : 7);
    const st = stateAt(p, flowerM - 0.5);
    const ppm = 70 / Math.max(p.h, p.s * 0.9, 0.3);
    window.Render.drawPlant(x, p, st, 75, 84, ppm, 4242, { t: flowerM - 0.5 });
    thumbCache[p.id] = c.toDataURL(); return thumbCache[p.id];
  }
  function monthsText(ms) {
    if (!ms || !ms.length) return ''; const s = ms.slice().sort((a, b) => a - b);
    const wraps = s[0] === 1 && s[s.length - 1] === 12 && s.length < 12;
    if (wraps) { const start = s.find((m, i) => i > 0 && s[i - 1] !== m - 1) || s[0]; return `${SHORT[start - 1]}–${SHORT[(start + s.length - 2) % 12]}`; }
    return s.length === 1 ? SHORT[s[0] - 1] : `${SHORT[s[0] - 1]}–${SHORT[s[s.length - 1] - 1]}`;
  }
  const ROLES = [['all', 'All'], ['tree', 'Trees'], ['shrub', 'Shrubs'], ['climber', 'Climbers'], ['perennial', 'Perennials'], ['grass', 'Grasses'], ['bulb', 'Bulbs'], ['hedging', 'Hedging'], ['groundcover', 'Ground cover'], ['fern', 'Ferns'], ['herb', 'Herbs'], ['veg', 'Veg & fruit'], ['bedding', 'Annuals']];
  const FILTERS = [['suits', 'Suits my garden'], ['pollinator', 'Pollinators'], ['evergreen', 'Evergreen'], ['winter', 'Winter interest'], ['shade', 'For shade'], ['fruit', 'Fruit & berries'], ['small', 'Under 1 m']];
  function suitsIssues(p) { return window.Site.suitability(p, state.profile); }
  function renderLibrary() {
    const rc = $('roleChips'), fc = $('filterChips');
    if (!rc.children.length) {
      rc.innerHTML = ROLES.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('');
      rc.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.role = b.dataset.k; state.libLimit = 60; saveLibPrefs(); renderLibrary(); }));
      fc.innerHTML = FILTERS.map(([k, v]) => `<button data-k="${k}">${v}</button>`).join('');
      fc.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { if (state.filters.has(b.dataset.k)) state.filters.delete(b.dataset.k); else state.filters.add(b.dataset.k); state.libLimit = 60; saveLibPrefs(); renderLibrary(); }));
      [rc, fc].forEach(el => { const upd = () => el.classList.toggle('atEnd', el.scrollLeft + el.clientWidth >= el.scrollWidth - 4); el.addEventListener('scroll', upd, { passive: true }); setTimeout(upd, 0); });
    }
    rc.querySelectorAll('button').forEach(b => { b.classList.toggle('active', b.dataset.k === state.role); b.setAttribute('aria-pressed', String(b.dataset.k === state.role)); });
    fc.querySelectorAll('button').forEach(b => { b.classList.toggle('active', state.filters.has(b.dataset.k)); b.setAttribute('aria-pressed', String(state.filters.has(b.dataset.k))); });
    $('quickPlace').classList.toggle('hidden', !state.libSel);
    const q = state.search.trim().toLowerCase(), F = state.filters;
    const base = LIB.all.filter(p => {
      if (state.role !== 'all' && p.role !== state.role && !(state.role === p.type && !p.group)) return false;
      if (F.has('suits') && suitsIssues(p).some(i => i.level !== 'note')) return false;
      if (F.has('pollinator') && !p.pollinator) return false;
      if (F.has('evergreen') && !p.ev) return false;
      if (F.has('winter') && !(p.ev || p.bare || (p.flower && p.flower.m.some(m => m === 12 || m <= 2)) || (p.fruit && p.fruit.m.some(m => m === 12 || m <= 1)))) return false;
      if (F.has('shade') && p.sun !== 'shade') return false;
      if (F.has('fruit') && !p.fruit) return false;
      if (F.has('small') && p.h > 1) return false;
      if (F.has('fav') && !favs.has(p.id)) return false;
      return true;
    });
    /* search: whole words in the name, Latin name, type or group first; notes only when that finds nothing */
    const terms = q ? q.split(/\s+/).filter(Boolean) : [], esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wb = (h, t) => new RegExp('(^|[^a-z])' + esc(t)).test(h);
    let list = base;
    if (terms.length) {
      /* rank: a whole word in the name beats a word that merely starts with the term, which beats a mention in the notes */
      const exact = (h, t) => new RegExp('(^|[^a-z])' + esc(t) + '($|[^a-z])').test(h);
      const score = (p) => { const h1 = `${p.name} ${p.latin} ${p.type} ${p.group || ''}`.toLowerCase(), h2 = `${p.sun} ${p.notes || ''}`.toLowerCase(); let s = 0;
        for (const t of terms) { if (exact(h1, t)) s += 3; else if (wb(h1, t)) s += 2; else if (wb(h2, t)) s += 1; else return 0; } return s; };
      list = base.map((p, i) => ({ p, s: score(p), i })).filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i).map(x => x.p);
    }
    const shown = list.slice(0, state.libLimit || 60);
    $('plantList').innerHTML = shown.map(p => {
      const issues = suitsIssues(p).filter(i => i.level !== 'note');
      const sp = (window.SPRITE_MANIFEST || {})[p.id] || {}, spFile = (sp.flower && sp.flower.file) || (sp.leaf && sp.leaf.file) || (sp.fruit && sp.fruit.file);
      const good = profileSet() && !issues.length ? window.Site.explain(p, state.profile).good : [];
      return `<div class="cardWrap"><button type="button" class="card ${state.libSel === p.id ? 'active' : ''}" data-id="${p.id}" aria-pressed="${state.libSel === p.id}" aria-label="${p.name}, ${p.latin}">
        ${spFile ? `<img class="th" src="${spFile}" alt="" loading="lazy">` : `<canvas data-thumb="${p.id}" width="150" height="90"></canvas>`}
        <div class="nm">${p.name}</div><div class="lt">${p.latin}</div>
        <div class="meta">${p.h} × ${p.s} m · ${p.sun} sun${p.ev ? ' · evergreen' : ''}${p.flower ? ' · flowers ' + monthsText(p.flower.m) : ''}${p.fruit ? ' · fruit ' + monthsText(p.fruit.m) : ''}</div>
        ${issues.length ? `<div class="flag">⚠ ${issues[0].text.split(';')[0]}</div>` : good.length ? `<div class="ok">✓ Suits your garden</div>` : ''}</button>
        <button type="button" class="info" data-info="${p.id}" aria-label="About ${p.name}" title="About this plant">i</button>
        <button type="button" class="fav" data-fav="${p.id}" aria-pressed="${favs.has(p.id)}" aria-label="${favs.has(p.id) ? 'Remove from' : 'Add to'} shortlist" title="Shortlist">${favs.has(p.id) ? '★' : '☆'}</button></div>`;
    }).join('') + (list.length > shown.length ? `<button type="button" class="more" id="libMore">Show more (${list.length - shown.length} left)</button>` : '') || '<p class="small">Nothing matches. Try another word, or clear the filters.</p>';
    const more = $('libMore'); if (more) more.addEventListener('click', () => { state.libLimit = (state.libLimit || 60) + 60; renderLibrary(); });
    /* thumbnails drawn lazily as cards scroll into view */
    const io = new IntersectionObserver((entries) => { entries.forEach(e => { if (e.isIntersecting) { const c = e.target, p = LIB.byId[c.dataset.thumb]; const im = new Image(); im.onload = () => c.getContext('2d').drawImage(im, 0, 0); im.src = thumb(p); io.unobserve(c); } }); }, { root: $('panel-plants') });
    $('plantList').querySelectorAll('canvas[data-thumb]').forEach(c => io.observe(c));
    $('plantList').querySelectorAll('[data-info]').forEach(b => b.addEventListener('click', () => openPlantDetail(b.dataset.info)));
    $('plantList').querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => toggleFav(b.dataset.fav)));
    renderSuitsNote(); $('starterRow').classList.toggle('hidden', state.plants.length > 0);
    $('plantList').querySelectorAll('.card').forEach(c => c.addEventListener('click', () => {
      if (state.replaceId) { replacePlant(state.replaceId, c.dataset.id); return; }
      if (state.libSel === c.dataset.id) { setSheet('peek'); return; }
      state.libSel = c.dataset.id; state.sel = null;
      if (state.libSel && state.mode !== 'plant') setMode('plant');
      setContext(state.libSel ? { cancel: () => { state.libSel = null; renderLibrary(); updateHint(); } } : null);
      renderLibrary(); renderSelected(); updateHint(); invalidate();
      if (state.libSel) { setSheet('peek'); blurInputs(); if (state.beds.length && view.zoom === 1) zoomToBed(nearestBed()); if (!isPhone()) toast(`Now tap the photo where the ${LIB.byId[state.libSel].name} should go`, 2500); }
    }));
  }
  $('search').addEventListener('input', (e) => { state.search = e.target.value; state.libLimit = 60; renderLibrary(); });
  /* drag a plant card onto the photo: press and hold on touch, or just drag with a mouse */
  let cardDrag = null;
  function startCardDrag() {
    const d = cardDrag; if (!d || d.started) return; d.started = true; d.el.classList.add('dragging'); sideEl.classList.add('cardDrag');
    if (!d.touch) { try { d.el.setPointerCapture(d.pointerId); } catch (e) { } }
    /* mark the card in place: re-rendering the list would detach the element the finger is on and end the touch */
    if (state.libSel !== d.id) { state.libSel = d.id; state.sel = null; setContext({ cancel: () => { state.libSel = null; renderLibrary(); updateHint(); } }); markLibSel(); renderSelected(); }
    updateHint(); setSheet('peek'); if (state.beds.length && view.zoom === 1) zoomToBed(nearestBed()); toast('Drop it on the lawn', 2000);
  }
  function cardDragAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect(); const over = clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
    state.hoverPt = over ? toImg({ clientX, clientY }) : null; invalidate();
  }
  function cardDragMove(ev) {
    const d = cardDrag; if (!d || ev.pointerId !== d.pointerId || d.touch) return;
    if (!d.started) { const moved = Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0); if (ev.pointerType === 'mouse' && moved > 8) startCardDrag(); else if (moved > 10) { clearTimeout(d.timer); cardDrag = null; } return; }
    const r = canvas.getBoundingClientRect(); const over = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
    state.hoverPt = over ? toImg(ev) : null; invalidate();
  }
  function markLibSel() { $('plantList').querySelectorAll('.card').forEach(c => { const on = c.dataset.id === state.libSel; c.classList.toggle('active', on); c.setAttribute('aria-pressed', String(on)); }); $('quickPlace').classList.toggle('hidden', !state.libSel); }
  function finishCardDrag(drop, clientX, clientY, touch) {
    const d = cardDrag; if (!d) return; clearTimeout(d.timer); cardDrag = null; d.el.classList.remove('dragging'); sideEl.classList.remove('cardDrag');
    if (!d.started) return;
    setTimeout(renderLibrary, 0);
    const pt = state.hoverPt; state.hoverPt = null; invalidate();
    if (drop && pt && inPhoto(pt)) pressTap({ tap: 'plant', pt, x0: clientX, y0: clientY, touch });
  }
  function cardDragEnd(ev) { const d = cardDrag; if (!d || ev.pointerId !== d.pointerId || d.touch) return; finishCardDrag(ev.type === 'pointerup', ev.clientX, ev.clientY, false); }
  $('plantList').addEventListener('pointerdown', (ev) => { const el = ev.target.closest('.card'); if (!el || (ev.pointerType === 'mouse' && ev.button !== 0)) return; const touch = ev.pointerType !== 'mouse'; cardDrag = { id: el.dataset.id, el, pointerId: ev.pointerId, x0: ev.clientX, y0: ev.clientY, started: false, touch, timer: touch ? setTimeout(startCardDrag, 280) : null }; });
  document.addEventListener('pointermove', cardDragMove, { passive: true });
  document.addEventListener('pointerup', cardDragEnd); document.addEventListener('pointercancel', cardDragEnd);
  /* touch drags are driven by touch events, which stay bound to the card even as the sheet drops away under the finger */
  document.addEventListener('touchmove', (ev) => {
    const d = cardDrag; if (!d || !d.touch || ev.touches.length !== 1) return; const t = ev.touches[0];
    if (!d.started) { if (Math.hypot(t.clientX - d.x0, t.clientY - d.y0) > 10) { clearTimeout(d.timer); cardDrag = null; } return; }
    ev.preventDefault(); cardDragAt(t.clientX, t.clientY);
  }, { passive: false });
  document.addEventListener('touchend', (ev) => { const d = cardDrag; if (!d || !d.touch) return; const t = ev.changedTouches[0]; finishCardDrag(true, t.clientX, t.clientY, true); });
  document.addEventListener('touchcancel', () => { if (cardDrag && cardDrag.touch) finishCardDrag(false); });
  $('search').addEventListener('focus', () => { if (mqSheet.matches) setSheet('full'); });
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

  /* ---------------- selected plant ---------------- */
  const SPRITE_STATES = ['leaf', 'flower', 'fruit', 'autumn', 'spring', 'bare'];
  function renderSelected() {
    [...state.multi].forEach(id => { if (!state.plants.some(p => p.id === id)) state.multi.delete(id); });
    const sel = state.plants.find(p => p.id === state.sel), box = $('selectedBox'), bar = $('selbar'), group = state.multi.size > 1;
    bar.classList.toggle('hidden', !sel && !group); box.classList.toggle('hidden', !sel && !group); wrap.classList.toggle('hasSel', !!sel || group);
    $('sbMulti').setAttribute('aria-pressed', String(state.multiMode)); $('sbLine').classList.toggle('hidden', state.multi.size < 3); $('sbFlip').classList.toggle('hidden', group);
    if (group) {
      $('selName').textContent = `${state.multi.size} plants selected`;
      box.innerHTML = `<div class="nm"><b>${state.multi.size} plants selected</b></div><p class="small">Drag any of them on the photo to move them all. ${isPhone() ? 'Tap + then more plants to add them.' : 'Shift-click more plants to add or remove them.'}</p>
        <div class="row selActions">${state.multi.size >= 3 ? '<button data-gact="line">Line up evenly</button>' : ''}<button data-gact="dup">⧉ Duplicate all</button><button data-gact="del" class="danger">Delete all</button><button data-gact="done">Done</button></div>`;
      box.querySelectorAll('[data-gact]').forEach(b => b.addEventListener('click', () => { const a = b.dataset.gact; if (a === 'line') lineUp(); else if (a === 'dup') duplicateSel(); else if (a === 'del') removeSelected(); else { state.multi.clear(); state.multiMode = false; state.sel = null; renderSelected(); invalidate(); updateHint(); } }));
      return;
    }
    if (!sel) return;
    const p = LIB.byId[sel.pid], d = dims(sel);
    $('selName').textContent = p.name;
    const issues = window.Site.suitability(p, state.profile);
    box.innerHTML = `<div class="nm"><b>${p.name}</b> <span class="small"><i>${p.latin}</i></span></div>
      <p class="small">${p.notes || ''}</p>
      ${issues.length ? `<ul class="flags">${issues.map(i => `<li class="${i.level}">${i.level === 'bad' ? '✖' : i.level === 'warn' ? '⚠' : 'ℹ'} ${p.name} ${i.text}.</li>`).join('')}</ul>` : ''}
      ${p.rootstocks ? `<label>Rootstock <span class="count">(controls how big the tree grows)</span> <select id="selRoot" aria-label="Rootstock">${Object.entries(p.rootstocks).map(([k, v]) => `<option value="${k}"${sel.rootstock === k ? ' selected' : ''}>${k}: about ${v[0]} m tall</option>`).join('')}</select></label>` : ''}
      ${p.pollination === 'partner' ? '<p class="small">Needs a different variety of the same fruit nearby to pollinate.</p>' : ''}
      <div class="row selActions"><button data-act="flip">⇋ Flip</button><button data-act="dup">⧉ Duplicate</button><button data-act="replace">⇄ Replace…</button><button data-act="info">About</button><button data-act="del" class="danger">Delete</button></div>
      <label>Size <span class="count">${Math.round(sel.size * 100)}% (${(d.h * sizeOf(sel)).toFixed(1)} m tall ${state.years < 15 ? 'at ' + state.years + ' years' : 'mature'})</span>
        <input type="range" id="selSize" min="0.25" max="1.4" step="0.05" value="${sel.size}"></label>
      <details class="photoBox"><summary>Photos of this plant</summary>
        <p class="small">${window.Render.hasSprites(p) ? 'Drawn from photographs where a season has one.' : 'No photos yet, so this plant is drawn. Add a photo with a transparent background for any season.'}</p>
        <div class="states">${SPRITE_STATES.map(st => { const e = ((window.SPRITE_MANIFEST || {})[p.id] || {})[st]; return `<div class="st"><span>${st}</span>${e && e.file ? `<img src="${e.file}" alt="${st}"> ${e.license === 'own' ? `<button data-rm="${st}" class="mini">×</button>` : ''}` : '<em class="small">none</em>'}</div>`; }).join('')}</div>
        <div class="row"><select id="spriteState">${SPRITE_STATES.map(st => `<option value="${st}">${st}</option>`).join('')}</select><label class="btn">Add photo <input type="file" id="spriteFile" accept="image/png,image/webp" hidden></label></div>
        <p class="small">Photograph the plant against something plain, lift the subject (iPhone: long-press it in Photos and share), and add the PNG.</p>
      </details>`;
    $('selSize').addEventListener('input', (e) => { sel.size = +e.target.value; invalidate(); });
    $('selSize').addEventListener('change', () => afterChange());
    const root = $('selRoot'); if (root) root.addEventListener('change', (e) => { sel.rootstock = e.target.value; afterChange(); });
    $('spriteFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) addUserSprite(p.id, $('spriteState').value, f); });
    box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => removeUserSprite(p.id, b.dataset.rm)));
    box.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => { const a = b.dataset.act; if (a === 'del') removePlant(sel.id); else if (a === 'dup') duplicateSel(); else if (a === 'replace') startReplace(sel.id); else if (a === 'info') openPlantDetail(sel.pid); else { sel.flip = !sel.flip; afterChange(); } }));
  }
  function renderPlantTools() { const n = state.plants.length; $('starterRow').classList.toggle('hidden', n > 0); $('plantTools').classList.toggle('hidden', !n); $('plantCount').textContent = n === 1 ? '1 plant placed' : `${n} plants placed`; }
  async function removeAllPlants() { if (!state.plants.length) { toast('Nothing to remove'); return; } if (await confirmDialog(`Remove all ${state.plants.length} plants? Borders stay. You can undo.`, 'Remove all')) { state.plants = []; state.sel = null; state.libSel = null; setContext(null); afterChange(); renderLibrary(); toast('All plants removed. Undo is in the top bar.'); } }
  $('removeAll').addEventListener('click', removeAllPlants);
  document.querySelectorAll('#quickPlace [data-place]').forEach(b => b.addEventListener('click', () => {
    if (!state.libSel || !cam) return; const lp = LIB.byId[state.libSel], far = maxPlantZ(), near = Math.max(1, cam.hc * 0.8);
    const Z = b.dataset.place === 'back' ? far - 0.8 : b.dataset.place === 'front' ? near + 0.6 : (far + near) / 2;
    const taken = (X) => state.plants.some(q => Math.abs(q.X - X) < 0.6 && Math.abs(q.Z - Z) < 0.6);
    let X = 0; for (let k = 0; k < 12 && taken(X); k++) X = (k % 2 ? -1 : 1) * Math.ceil((k + 1) / 2) * 0.8;
    const np = { id: uid(), pid: lp.id, X, Z, seed: Math.floor(Math.random() * 1e9), size: 1 }; if (lp.rootstocks) np.rootstock = Object.keys(lp.rootstocks)[1] || Object.keys(lp.rootstocks)[0];
    state.plants.push(np); state.sel = np.id; afterChange(); toast(`Planted ${lp.name} ${b.dataset.place === 'back' ? 'at the back' : b.dataset.place === 'front' ? 'at the front' : 'in the middle'}. Drag it to move.`);
  }));
  /* the canvas describes itself for screen readers */
  function describeCanvas() { const n = state.plants.length; const names = [...new Set(state.plants.map(p => LIB.byId[p.pid] && LIB.byId[p.pid].name))].filter(Boolean); canvas.setAttribute('aria-label', n ? `Garden photo with ${n} plant${n === 1 ? '' : 's'}: ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' and more' : ''}` : 'Garden photo with no plants yet'); }
  /* the ⋯ menu: things people look for from anywhere */
  $('menuBtn').addEventListener('click', () => { const d = $('menuDlg'); if (typeof d.showModal !== 'function') return; d.returnValue = ''; d.showModal(); });
  $('menuDlg').addEventListener('close', async () => {
    const v = $('menuDlg').returnValue;
    if (v === 'removeAll') removeAllPlants();
    else if (v === 'startAgain') { if (await confirmDialog('Start again with an empty design? Plants, borders and painted objects go. You can then choose a new photo.', 'Start again')) { state.plants = []; state.beds = []; state.masks = []; state.maskSel = null; state.sel = null; state.libSel = null; setContext(null); afterChange(); renderBeds(); renderMasks(); renderLibrary(); wiz.page = 0; showStep('photo'); toast('Cleared. Choose a photo, or keep the sample.', 3000); } }
    else if (v === 'share') shareDesign();
    else if (v === 'starter') openStarter();
    else if (v === 'care') openCare();
    else if (v === 'tour') startTour();
    else if (v === 'exportPng') $('exportPng').click();
    else if (v === 'exportJson') $('exportJson').click();
    else if (v === 'importJson') $('importJson').click();
  });
  function removePlant(id) { state.plants = state.plants.filter(p => p.id !== id); if (state.sel === id) state.sel = null; afterChange(); toast('Removed. Undo is in the top bar.'); }
  function renderPlaced() { renderPlantTools(); describeCanvas(); }
  function removeSelected() { if (state.multi.size > 1) { const n = state.multi.size; state.plants = state.plants.filter(p => !state.multi.has(p.id)); state.multi.clear(); state.multiMode = false; state.sel = null; afterChange(); toast(`Removed ${n} plants. Undo is in the top bar.`); } else if (state.sel) removePlant(state.sel); }
  function lineUp() {
    const ps = [...state.multi].map(id => state.plants.find(p => p.id === id)).filter(Boolean); if (ps.length < 3) { toast('Select at least three plants to line them up'); return; }
    ps.sort((a, b) => a.X - b.X); const a = ps[0], b = ps[ps.length - 1];
    ps.forEach((p, i) => { const k = i / (ps.length - 1); p.X = a.X + (b.X - a.X) * k; p.Z = a.Z + (b.Z - a.Z) * k; }); afterChange(); toast(`Lined up ${ps.length} plants evenly`);
  }
  function startReplace(id) { state.replaceId = id; state.libSel = null; setContext({ cancel: () => { state.replaceId = null; updateHint(); } }); updateHint(); setSheet('full'); toast('Choose the plant to put in its place', 3000); }
  function replacePlant(id, pid) {
    const pl = state.plants.find(p => p.id === id), np = LIB.byId[pid]; state.replaceId = null; setContext(null);
    if (!pl || !np) { updateHint(); return; } const old = LIB.byId[pl.pid];
    pl.pid = pid; if (np.rootstocks) pl.rootstock = Object.keys(np.rootstocks)[1] || Object.keys(np.rootstocks)[0]; else delete pl.rootstock;
    state.sel = id; afterChange(); renderLibrary(); updateHint(); setSheet('half'); toast(`Replaced ${old ? old.name : 'it'} with ${np.name}`);
  }
  function duplicateSel() {
    if (state.multi.size > 1) { const ids = []; [...state.multi].forEach(id => { const q = state.plants.find(p => p.id === id); if (!q) return; const np = Object.assign({}, q, { id: uid(), X: q.X + 0.6, seed: Math.floor(Math.random() * 1e9) }); state.plants.push(np); ids.push(np.id); }); state.multi = new Set(ids); state.sel = ids[ids.length - 1]; afterChange(); toast(`Duplicated ${ids.length} plants; the copies are selected`); return; }
    const sel = state.plants.find(p => p.id === state.sel); if (!sel) return; const p = LIB.byId[sel.pid]; const np = Object.assign({}, sel, { id: uid(), X: sel.X + p.s * 0.9, seed: Math.floor(Math.random() * 1e9) }); state.plants.push(np); state.sel = np.id; afterChange(); }
  $('sbFlip').addEventListener('click', () => { const sel = state.plants.find(p => p.id === state.sel); if (sel) { sel.flip = !sel.flip; afterChange(); } });
  $('sbDup').addEventListener('click', duplicateSel);
  $('sbDel').addEventListener('click', removeSelected);
  $('sbClose').addEventListener('click', () => { state.sel = null; state.multi.clear(); state.multiMode = false; renderSelected(); invalidate(); updateHint(); });
  $('sbLine').addEventListener('click', lineUp);
  $('sbMulti').addEventListener('click', () => { state.multiMode = !state.multiMode; if (state.multiMode && state.sel && !state.multi.size) state.multi.add(state.sel); renderSelected(); updateHint(); if (state.multiMode) toast('Tap more plants to select them', 2500); });

  /* ---------------- user photos of plants (IndexedDB) ---------------- */
  const userSprites = {};
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('netgarden', 1); r.onupgradeneeded = () => r.result.createObjectStore('sprites'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbAll() { const db = await idb(); return new Promise((res) => { const out = {}; const c = db.transaction('sprites').objectStore('sprites').openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return res(out); out[cur.key] = cur.value; cur.continue(); }; c.onerror = () => res(out); }); }
  async function idbPut(key, blob) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('sprites', 'readwrite'); t.objectStore('sprites').put(blob, key); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function idbDel(key) { const db = await idb(); return new Promise((res) => { const t = db.transaction('sprites', 'readwrite'); t.objectStore('sprites').delete(key); t.oncomplete = res; t.onerror = res; }); }
  function applyUserSprites() {
    window.SPRITE_MANIFEST = window.SPRITE_MANIFEST || {};
    Object.entries(userSprites).forEach(([pid, states]) => { window.SPRITE_MANIFEST[pid] = Object.assign({}, window.SPRITE_MANIFEST[pid] || {}); Object.entries(states).forEach(([st, e]) => { window.SPRITE_MANIFEST[pid][st] = Object.assign({ source: 'your photo', credit: '', license: 'own' }, e); }); });
  }
  function blobEntry(blob) { return new Promise((res) => { const url = URL.createObjectURL(blob); const im = new Image(); im.onload = () => res({ file: url, w: im.naturalWidth, h: im.naturalHeight }); im.onerror = () => res({ file: url }); im.src = url; }); }
  async function loadUserSprites() { try { const all = await idbAll(); for (const [key, blob] of Object.entries(all)) { const [pid, st] = key.split('/'); (userSprites[pid] = userSprites[pid] || {})[st] = await blobEntry(blob); } applyUserSprites(); } catch (e) { } }
  async function addUserSprite(pid, st, file) {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const cx = c.getContext('2d'); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0, any = false, opaque = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const a = d[(y * c.width + x) * 4 + 3]; if (a > 16) { any = true; opaque++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (!any || opaque > c.width * c.height * 0.97) { toast('That image has no transparent background. Lift the subject first, then save as PNG.', 4000); return; }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, k = Math.min(1, 1200 / h);
    const o = document.createElement('canvas'); o.width = Math.round(w * k); o.height = Math.round(h * k); o.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, o.width, o.height);
    const blob = await new Promise(r => o.toBlob(r, 'image/png'));
    await idbPut(`${pid}/${st}`, blob); (userSprites[pid] = userSprites[pid] || {})[st] = await blobEntry(blob);
    applyUserSprites(); delete thumbCache[pid]; window.Compose.clearCache(); renderCredits(); renderSelected(); invalidate(); toast('Photo added');
  }
  async function removeUserSprite(pid, st) { await idbDel(`${pid}/${st}`); if (userSprites[pid]) { delete userSprites[pid][st]; if (window.SPRITE_MANIFEST[pid]) delete window.SPRITE_MANIFEST[pid][st]; } delete thumbCache[pid]; window.Compose.clearCache(); renderCredits(); renderSelected(); invalidate(); }
  function renderCredits() {
    const rows = [];
    Object.entries(window.SPRITE_MANIFEST || {}).forEach(([pid, states]) => Object.entries(states).forEach(([st, e]) => { if (!e || !e.file || e.license === 'own') return; const p = LIB.byId[pid]; if (!p) return; rows.push(`<li>${p.name} (${st}): ${e.source && e.source.startsWith('http') ? `<a href="${e.source}" target="_blank" rel="noopener">Wikimedia Commons</a>` : e.source}${e.credit ? ' by ' + e.credit : ''}, ${e.license}</li>`); }));
    $('credits').innerHTML = rows.length ? `<details class="credits"><summary>${rows.length} photo credits</summary><ul class="small">${rows.join('')}</ul></details>` : '<p class="small">No bundled photo sprites yet. See tools/sprites.py in the repository.</p>';
  }

  /* ---------------- photo step ---------------- */
  function rebuild() { buildCamera(); invalidate(); renderPhoto(); }
  function renderPhoto() {
    if (!cam) return; const g = state.ground;
    $('photoName').textContent = /sample/.test(state.photo.name) ? 'Using the sample garden' : state.photo.name;
    $('usePhotoBtn').classList.toggle('hidden', !/sample/.test(state.photo.name));
    $('horizon').value = g.horizon; $('horizonVal').textContent = `${Math.round(g.horizon * 100)}% down the photo`;
    $('refLen').value = g.refLen;
    const lensSel = $('lens'); let auto = lensSel.querySelector('option[data-auto]');
    if (g.lensFrom) { if (!auto) { auto = document.createElement('option'); auto.dataset.auto = '1'; lensSel.prepend(auto); } auto.value = String(g.lens); auto.textContent = `Read from the photo (${g.lensFrom} mm)`; }
    else if (auto) auto.remove();
    lensSel.value = String(g.lens); if (lensSel.value !== String(g.lens)) { const o = document.createElement('option'); o.value = String(g.lens); o.textContent = `Custom (${Math.round(g.lens * 36)} mm)`; lensSel.appendChild(o); lensSel.value = o.value; }
    const fz = fenceZ();
    $('refH').value = g.refH || (g.refV && g.refV.h) || 1.8;
    const plaus = (hc) => hc >= 1.1 && hc <= 1.9 ? ' That looks right for a phone held at chest or eye height.' : hc < 0.6 || hc > 3 ? ' <span style="color:#a33a2a">That camera height looks wrong: check the eye-level line and the marks.</span>' : ' Unusual but possible (kneeling, or standing on a step).';
    const refPx = g.ref ? Math.hypot(g.ref.x2 - g.ref.x1, g.ref.y2 - g.ref.y1) : 0;
    $('camReadout').innerHTML = g.refV && g.refV.yt < g.refV.yb - 2 ? `The fence is about <b>${fz != null ? fz.toFixed(1) : '?'} m</b> away and the camera was <b>${cam.hc.toFixed(2)} m</b> up.` + plaus(cam.hc) : g.ref && refPx < 6 ? '<span style="color:#a33a2a">The two ends are on the same spot. Mark the fence again, tapping each end.</span>' : g.ref && fz == null ? '<span style="color:#a33a2a">The fence ends are above the eye-level line. Move the yellow line up, above the fence.</span>' : g.ref ? `The fence is about <b>${fz.toFixed(1)} m</b> away and the camera was <b>${cam.hc.toFixed(2)} m</b> up.` + (cam.hc < 0.6 || cam.hc > 3 ? ' <span style="color:#a33a2a">That camera height looks wrong: check the eye-level line and the length.</span>' : ' That looks right for a phone at chest height.') : 'Nothing marked yet, so the camera is assumed to be 1.5 m up.';
    $('heading').value = state.profile.heading || ''; $('region').value = state.profile.region; $('soil').value = state.profile.soil; $('drainage').value = state.profile.drainage; $('ph').value = state.profile.ph; $('exposure').value = state.profile.exposure;
    const L = state.light || window.Compose.autoLight(state.stats || {});
    $('sunAz').value = state.sun.az; $('sunEl').value = state.sun.el;
    $('sunAzVal').textContent = state.sun.az === 0 ? 'behind you' : `${Math.abs(state.sun.az)}° to the ${state.sun.az > 0 ? 'right' : 'left'}${Math.abs(state.sun.az) > 90 ? ', ahead' : ''}`;
    $('sunElVal').textContent = `${state.sun.el}° up`;
    ['brightness', 'warmth', 'contrast', 'saturation', 'shadow', 'grain'].forEach(k => { $('light-' + k).value = L[k]; });
    $('lightAuto').textContent = L.auto ? 'Auto (from the photo)' : 'Reset to auto';
  }
  $('horizon').addEventListener('input', (e) => { state.ground.horizon = +e.target.value; rebuild(); });
  $('horizon').addEventListener('change', save);
  $('refLen').addEventListener('change', (e) => { state.ground.refLen = Math.min(50, Math.max(0.5, +e.target.value || 1)); rebuild(); save(); renderReview(); });
  $('lens').addEventListener('change', (e) => { state.ground.lens = +e.target.value; if (!e.target.selectedOptions[0].dataset.auto) delete state.ground.lensFrom; rebuild(); save(); });
  $('markRefV').addEventListener('click', () => { const prev = state.ground.refV ? Object.assign({}, state.ground.refV) : null; state.ground.refH = Math.min(4, Math.max(0.5, +$('refH').value || 1.8)); state.refVClicks = 0; setContext({ cancel: () => { state.refVClicks = null; state.ground.refV = prev; rebuild(); renderPhoto(); updateHint(); } }); updateHint(); toast('Tap the bottom of the fence, then the top'); if (mqSheet.matches) setSheet('peek'); });
  $('refH').addEventListener('change', (e) => { const h = Math.min(4, Math.max(0.5, +e.target.value || 1.8)); state.ground.refH = h; if (state.ground.refV) state.ground.refV.h = h; rebuild(); save(); renderReview(); });
  $('markRef').addEventListener('click', () => { const prev = state.ground.ref ? Object.assign({}, state.ground.ref) : null; state.refClicks = 0; setContext({ cancel: () => { state.refClicks = null; state.ground.ref = prev; rebuild(); renderPhoto(); updateHint(); } }); updateHint(); toast('Tap one end of the fence, then the other'); });
  ['heading', 'region', 'soil', 'drainage', 'ph', 'exposure'].forEach(k => $(k).addEventListener('change', (e) => { state.profile[k] = e.target.value || null; save(); renderLibrary(); renderSelected(); renderReview(); renderBands(); invalidate(); }));
  $('sunAz').addEventListener('input', (e) => { state.sun.az = +e.target.value; renderPhoto(); invalidate(); });
  $('sunEl').addEventListener('input', (e) => { state.sun.el = +e.target.value; renderPhoto(); invalidate(); });
  ['sunAz', 'sunEl'].forEach(id => $(id).addEventListener('change', save));
  ['brightness', 'warmth', 'contrast', 'saturation', 'shadow', 'grain'].forEach(k => { const el = $('light-' + k); el.addEventListener('input', (e) => { state.light = Object.assign({}, state.light || window.Compose.autoLight(state.stats || {}), { [k]: +e.target.value, auto: false }); renderPhoto(); invalidate(); }); el.addEventListener('change', save); });
  $('lightAuto').addEventListener('click', () => { state.light = Object.assign(window.Compose.autoLight(state.stats || {}), { auto: true }); renderPhoto(); invalidate(); save(); });
  $('showGrid').addEventListener('change', invalidate);
  $('usePhotoBtn').addEventListener('click', () => { showStep('photo'); $('photoFile').click(); });
  $('cameraFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); $('photoFile').files = dt.files; $('photoFile').dispatchEvent(new Event('change')); } });
  $('photoFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file); await loadPhoto(url, file.name, true); URL.revokeObjectURL(url);
    let ex = null; try { ex = exifFocal35(await file.slice(0, 512 * 1024).arrayBuffer()); } catch (err) { }
    state.ground = defaultGround();
    if (ex && ex.focal35 >= 10 && ex.focal35 <= 200) { state.ground.lens = ex.focal35 / 36; state.ground.lensFrom = ex.focal35; } state.beds = []; state.plants = []; state.sel = null; state.masks = []; state.maskSel = null; state.stats = null; state.light = null; state.undo = []; state.redo = [];
    view.zoom = 1; view.panX = view.panY = 0;
    buildCamera(); fit(); lastSnap = snapshot(); save(); renderPhoto(); renderBeds(); renderMasks(); renderReview(); renderBands(); updateUndoButtons();
    wiz.page = 1; showStep('photo'); toast(isPhone() ? 'Photo in. Now set your eye level.' : 'Your photo is in. Drag the yellow line to your eye level and mark the fence.', 4000);
  });

  /* ---------------- review ---------------- */
  function renderReview() {
    if (!cam) return;
    $('yearsVal').textContent = state.years >= 15 ? 'mature' : `${state.years} year${state.years === 1 ? '' : 's'} after planting`; $('years').value = state.years;
    const site = { heading: state.profile.heading, fenceZ: fenceZ() };
    const checks = window.Site.checks(state.plants, state.beds, LIB.byId, site, state.profile, dims);
    const seen = new Map(); checks.forEach(c => { const k = c.level + '|' + c.text; if (seen.has(k)) seen.get(k).n++; else seen.set(k, Object.assign({ n: 1 }, c)); });
    $('checks').innerHTML = checks.length ? [...seen.values()].map(c => `<li class="${c.level}" data-go="${c.id}"><b>${c.level === 'warn' ? 'Warning:' : c.level === 'note' ? 'Note:' : ''}</b>${c.n > 1 ? `${c.n} × ` : ''}${c.text}</li>`).join('') : `<li class="ok">${state.plants.length ? 'No sun, soil, spacing or pollination problems found.' : 'Checks appear here once you have placed plants.'}${state.profile.heading ? '' : ' Set which way the camera faces (Photo step) for sun checks.'}</li>`;
    $('checks').querySelectorAll('[data-go]').forEach(li => li.addEventListener('click', () => { state.sel = li.dataset.go; showStep('plants'); renderSelected(); invalidate(); }));
    const tips = window.Site.designRules(state.plants, state.beds, LIB.byId, state.profile);
    $('tips').innerHTML = tips.length ? tips.map(t => `<li class="${t.level}"><b>Tip:</b>${t.text}</li>`).join('') : `<li class="ok">${state.plants.length ? 'Nothing to add: layering, evergreen backbone and grouping all look reasonable.' : 'Tips about layering, grouping and succession appear once borders have plants in them.'}</li>`;
    renderCare(); renderCalendar(); renderPlan(); renderShopping();
  }
  $('years').addEventListener('input', (e) => { state.years = +e.target.value; $('yearsVal').textContent = state.years >= 15 ? 'mature' : `${state.years} years after planting`; invalidate(); renderPlan(); });
  $('years').addEventListener('change', () => { save(); renderReview(); renderSelected(); });
  function renderCalendar() {
    const ids = [...new Set(state.plants.map(p => p.pid))].map(id => LIB.byId[id]).filter(Boolean), now = Math.floor(state.t) + 1, cal = $('calendar');
    if (!ids.length) { cal.innerHTML = '<p class="small">Place some plants and their year appears here.</p>'; $('inFlower').innerHTML = ''; return; }
    ids.sort((a, b) => ((a.flower ? Math.min(...a.flower.m) : 99) - (b.flower ? Math.min(...b.flower.m) : 99)));
    let html = '<table class="cal"><tr><th></th>' + SHORT.map((m, i) => `<th class="${i + 1 === now ? 'now' : ''}">${m[0]}</th>`).join('') + '</tr>';
    ids.forEach(p => { html += `<tr><td class="name" title="${p.name}">${p.name}</td>` + yearRow(p).map((s, i) => `<td class="m ${i + 1 === now ? 'now' : ''}" style="background:${s.leaf > 0 ? rgba(s.leafColor, 0.25 + 0.7 * s.leaf) : 'transparent'}" title="${MONTHS[i]}: ${s.flower ? 'in flower' : s.leaf ? 'in leaf' : 'dormant'}${s.fruit ? ', fruiting' : ''}">${s.flower ? `<i style="background:${s.flowerColor}"></i>` : ''}${s.fruit ? `<u style="background:${s.fruitColor}"></u>` : ''}</td>`).join('') + '</tr>'; });
    cal.innerHTML = html + '</table><p class="small">Cell colour = foliage. Dot = in flower. Small dot = fruit or berries.</p>';
    const flowering = ids.map(p => ({ p, s: stateAt(p, tEff()) })).filter(x => x.s.flower > 0.3);
    $('inFlower').innerHTML = flowering.length ? flowering.map(x => `<span class="s"><b style="background:${x.s.flowerColor}"></b>${x.p.name}</span>`).join('') : '<span class="small">Nothing in flower at this point in the year.</span>';
  }
  const planC = $('plan'), planCtx = planC.getContext('2d'); let planMap = null;
  function renderPlan() {
    if (!cam) return; const W = planC.width, H = planC.height; let maxZ = 10, halfX = 5;
    const consider = (X, Z) => { maxZ = Math.max(maxZ, Z + 1.5); halfX = Math.max(halfX, Math.abs(X) + 1.5); };
    state.plants.forEach(p => consider(p.X, p.Z)); state.beds.forEach(b => b.pts.forEach(p => consider(p.X, p.Z)));
    const k = Math.min((W - 10) / (2 * halfX), (H - 10) / maxZ), map = (X, Z) => ({ x: W / 2 + X * k, y: H - 5 - Z * k });
    planMap = { inv: (x, y) => ({ X: (x - W / 2) / k, Z: (H - 5 - y) / k }) };
    planCtx.clearRect(0, 0, W, H); planCtx.fillStyle = '#dfe6cf'; planCtx.fillRect(0, 0, W, H);
    const halfFov = Math.atan((state.photo.w / 2) / cam.f), o = map(0, 0);
    planCtx.fillStyle = '#e9eadb'; planCtx.beginPath(); planCtx.moveTo(o.x, o.y); const far = map(Math.tan(halfFov) * maxZ * 1.2, maxZ * 1.2), farL = map(-Math.tan(halfFov) * maxZ * 1.2, maxZ * 1.2); planCtx.lineTo(far.x, far.y); planCtx.lineTo(farL.x, farL.y); planCtx.closePath(); planCtx.fill();
    planCtx.strokeStyle = 'rgba(0,0,0,0.08)'; planCtx.lineWidth = 1;
    for (let Z = 0; Z <= maxZ; Z++) { const a = map(-halfX, Z), b = map(halfX, Z); planCtx.beginPath(); planCtx.moveTo(a.x, a.y); planCtx.lineTo(b.x, b.y); planCtx.stroke(); }
    for (let X = -Math.floor(halfX); X <= halfX; X++) { const a = map(X, 0), b = map(X, maxZ); planCtx.beginPath(); planCtx.moveTo(a.x, a.y); planCtx.lineTo(b.x, b.y); planCtx.stroke(); }
    state.beds.forEach(b => { planCtx.fillStyle = 'rgba(74,52,34,0.75)'; planCtx.beginPath(); b.pts.forEach((p, i) => { const q = map(p.X, p.Z); i ? planCtx.lineTo(q.x, q.y) : planCtx.moveTo(q.x, q.y); }); planCtx.closePath(); planCtx.fill(); });
    state.plants.forEach(pl => {
      const p = dims(pl), st = stateAt(p, tEff()), q = map(pl.X, pl.Z), r = Math.max(2.5, p.s * sizeOf(pl) * k / 2);
      planCtx.fillStyle = st.leaf > 0.05 ? rgba(st.leafColor, 0.45 + 0.5 * st.leaf) : 'rgba(110,90,60,0.6)'; planCtx.beginPath(); planCtx.arc(q.x, q.y, r, 0, Math.PI * 2); planCtx.fill();
      if (st.flower > 0.1 && st.flowerColor) { planCtx.strokeStyle = st.flowerColor; planCtx.lineWidth = 3; planCtx.stroke(); }
      if (pl.id === state.sel) { planCtx.strokeStyle = '#d4a017'; planCtx.lineWidth = 2; planCtx.setLineDash([3, 2]); planCtx.beginPath(); planCtx.arc(q.x, q.y, r + 3, 0, Math.PI * 2); planCtx.stroke(); planCtx.setLineDash([]); }
    });
    planCtx.fillStyle = '#263a22'; planCtx.beginPath(); planCtx.arc(o.x, o.y, 4, 0, Math.PI * 2); planCtx.fill(); planCtx.font = '10px system-ui'; planCtx.fillText('you', o.x + 7, o.y - 2); planCtx.fillStyle = '#6b7266'; planCtx.fillText(`${maxZ.toFixed(0)} m`, 4, 12);
  }
  planC.addEventListener('click', (ev) => {
    if (!planMap) return; const r = planC.getBoundingClientRect(), x = (ev.clientX - r.left) * planC.width / r.width, y = (ev.clientY - r.top) * planC.height / r.height, pt = planMap.inv(x, y);
    let best = null, bd = 0.8; state.plants.forEach(pl => { const d = Math.hypot(pl.X - pt.X, pl.Z - pt.Z); if (d < bd) { bd = d; best = pl; } });
    state.sel = best ? best.id : null; if (best) showStep('plants'); renderSelected(); invalidate();
  });
  function renderShopping() {
    const counts = {}; state.plants.forEach(pl => { counts[pl.pid] = (counts[pl.pid] || 0) + 1; });
    const potSize = { tree: '10 L or bare-root', shrub: '3 L', climber: '2 L', perennial: '2 L', grass: '2 L', bulb: 'pack of 10 bulbs' };
    const rows = Object.entries(counts).map(([pid, n]) => { const p = LIB.byId[pid]; return { p, n, pot: p.type === 'bulb' ? 'pack of 10' : p.group === 'veg' || p.group === 'bedding' ? 'seed or plug plants' : potSize[p.type] }; }).sort((a, b) => a.p.type.localeCompare(b.p.type) || a.p.name.localeCompare(b.p.name));
    $('shopping').innerHTML = rows.length ? `<table class="shop">${rows.map(r => `<tr><td>${r.n} ×</td><td><b>${r.p.name}</b><br><i class="small">${r.p.latin}</i></td><td class="small">${r.pot}</td><td><a class="small" href="https://www.rhs.org.uk/plants/search-results?query=${encodeURIComponent(r.p.latin)}" target="_blank" rel="noopener">RHS</a></td></tr>`).join('')}</table>` : '<p class="small">Empty until you place plants.</p>';
    $('shopCopy').onclick = () => { const txt = rows.map(r => `${r.n} x ${r.p.name} (${r.p.latin}), ${r.pot}`).join('\n'); if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => toast('Shopping list copied')); };
  }
  function designBlob() { return new Blob([JSON.stringify({ version: 2, t: state.t, years: state.years, ground: state.ground, beds: state.beds, plants: state.plants, sun: state.sun, light: state.light, profile: state.profile, masks: state.masks.map(window.Masks.serialize), photoName: state.photo.name, photoData: state.photo.dataUrl })], { type: 'application/json' }); }
  async function shareDesign() {
    const file = new File([designBlob()], 'netgarden-design.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Netgarden design' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    $('exportJson').click(); toast('Design file saved. Open Netgarden on the other device and use Import.', 5000);
  }
  $('exportJson').addEventListener('click', () => { const blob = new Blob([JSON.stringify({ version: 2, t: state.t, years: state.years, ground: state.ground, beds: state.beds, plants: state.plants, sun: state.sun, light: state.light, profile: state.profile, masks: state.masks.map(window.Masks.serialize), photoName: state.photo.name, photoData: state.photo.dataUrl })], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'netgarden-design.json'; a.click(); });
  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const o = JSON.parse(await file.text());
      const fin = (v) => typeof v === 'number' && isFinite(v);
      if (!o || typeof o !== 'object' || (o.plants && !Array.isArray(o.plants)) || (o.beds && !Array.isArray(o.beds)) || (o.masks && !Array.isArray(o.masks))) throw new Error('shape');
      if ((o.plants || []).some(p => !p || !fin(p.X) || !fin(p.Z)) || (o.beds || []).some(b => !b || !Array.isArray(b.pts) || b.pts.length < 3 || b.pts.some(q => !q || !fin(q.X) || !fin(q.Z)))) throw new Error('values');
      if (o.ground && (!fin(o.ground.horizon) || !fin(o.ground.lens))) throw new Error('ground');
      if (o.photoData) await loadPhoto(o.photoData, o.photoName || 'photo.jpg', true); state.ground = o.ground || defaultGround(); if (fin(o.t)) state.t = o.t; if (fin(o.years)) state.years = o.years; state.beds = o.beds || []; state.plants = (o.plants || []).filter(p => LIB.byId[p.pid]); if (o.sun) state.sun = o.sun; if (o.light) state.light = o.light; if (o.profile) state.profile = Object.assign({}, window.Site.DEFAULT_PROFILE, o.profile); state.masks = o.masks ? await Promise.all(o.masks.map(m => window.Masks.restore(m, state.photo.w, state.photo.h))) : []; buildCamera(); fit(); afterChange(); renderPhoto(); renderBeds(); renderMasks(); toast('Design imported'); }
    catch (err) { toast('That file could not be read as a Netgarden design.', 3000); }
  });
  $('exportPng').addEventListener('click', () => { try { const a = document.createElement('a'); a.href = compositeCanvas().toDataURL('image/jpeg', 0.9); a.download = `netgarden-${timeLabel(state.t).replace(/\s+/g, '-').toLowerCase()}.jpg`; a.click(); } catch (err) { toast('The browser will not export the sample photo when the app is opened from a file. Upload your own photo or use the published site.', 4000); } });

  /* realistic render */
  async function doRender() {
    const key = $('apiKey').value.trim();
    if (!key) { toast('Enter your OpenAI API key first.'); return; } if (!state.plants.length) { toast('Place some plants first.'); return; }
    try { localStorage.setItem('netgarden.apikey', key); } catch (e) { }
    const btn = $('renderBtn'); btn.disabled = true; btn.textContent = 'Rendering… (30–90 s)';
    try {
      const hz = (state.stats && state.stats.haze) || [120, 120, 120];
      const r = await window.RenderAPI.render({ key, composite: compositeCanvas(), silhouette: compositeCanvas(true), polys: state.beds.map(b => b.pts.map(p => cam.toImage(p.X, p.Z))), month: timeLabel(state.t), photoMean: `rgb(${hz[0]},${hz[1]},${hz[2]})`, quality: $('renderQuality').value });
      const img = $('renderImg'), a = r.canvas.toDataURL('image/jpeg', 0.92), b = compositeCanvas().toDataURL('image/jpeg', 0.92);
      img.src = a; img.dataset.after = a; img.dataset.before = b; $('renderTitle').textContent = `Rendered: ${timeLabel(state.t)}`; $('renderDl').href = a; $('renderDl').download = `netgarden-render-${timeLabel(state.t).replace(/\s+/g, '-').toLowerCase()}.jpg`; $('renderDlg').showModal();
    } catch (err) { toast('Render failed: ' + err.message, 5000); }
    btn.disabled = false; btn.textContent = 'Render this month';
  }
  $('renderBtn').addEventListener('click', doRender);
  $('renderBefore').addEventListener('pointerdown', () => { $('renderImg').src = $('renderImg').dataset.before; });
  ['pointerup', 'pointerleave'].forEach(ev => $('renderBefore').addEventListener(ev, () => { $('renderImg').src = $('renderImg').dataset.after; }));
  $('renderClose').addEventListener('click', () => $('renderDlg').close());
  try { const k = localStorage.getItem('netgarden.apikey'); if (k) $('apiKey').value = k; } catch (e) { }

  /* ---------------- care calendar ---------------- */
  const REGION_WORDS = { south: 'southern England', midlands: 'the Midlands and Wales', north: 'northern England', scotland: 'Scotland' };
  function careTasks() { return window.Care.forPlants(state.plants, LIB.byId, state.profile, state.years); }
  function careDone() { try { return JSON.parse(lsGet('netgarden.care.done') || '{}'); } catch (e) { return {}; } }
  const careKey = (t) => `${new Date().getFullYear()}|${t.m}|${t.key}|${t.pids.join(',')}`;
  function plantNames(pids, max) {
    const names = pids.map(id => LIB.byId[id] && LIB.byId[id].name).filter(Boolean); max = max || 5;
    return names.length > max ? `${names.slice(0, max - 1).join(', ')} and ${names.length - max + 1} more` : names.join(', ');
  }
  function careList(tasks, tickable) {
    if (!tasks.length) return '<p class="empty">Nothing needs doing this month. Enjoy the garden.</p>';
    const done = careDone();
    return `<ul class="careList">${tasks.map(t => { const k = careKey(t), d = !!done[k], all = t.pids.length >= Math.max(4, new Set(state.plants.map(p => p.pid)).size);
      return `<li class="${d && tickable ? 'done' : ''}"><label>${tickable ? `<input type="checkbox" data-care="${encodeURIComponent(k)}"${d ? ' checked' : ''} aria-label="Done: ${t.text.replace(/"/g, '')}">` : ''}<span class="tag k-${t.kind}">${window.Care.KINDS[t.kind]}</span><span class="txt">${t.text}</span></label>
        ${t.general ? '' : `<div class="who">${all ? 'All your plants' : plantNames(t.pids)}</div>`}${t.why ? `<div class="why">${t.why}</div>` : ''}</li>`; }).join('')}</ul>`;
  }
  function renderCare() {
    const now = new Date().getMonth() + 1, next = now % 12 + 1, tasks = careTasks(), done = careDone();
    const thisMonth = tasks.filter(t => t.m === now), left = thisMonth.filter(t => !done[careKey(t)]).length;
    const badge = $('careBadge'); badge.textContent = left || ''; badge.classList.toggle('hidden', !left || !state.plants.length);
    if (!state.plants.length) { $('careCount').textContent = ''; $('careIntro').textContent = 'Place some plants and a year of jobs for them appears here: what to prune, cut back, feed, sow and pick, and when.'; $('careNow').innerHTML = ''; $('careNextBox').classList.add('hidden'); $('careYear').innerHTML = ''; return; }
    $('careNextBox').classList.remove('hidden');
    $('careCount').textContent = `${tasks.length} jobs a year`;
    $('careIntro').innerHTML = `For the plants in this design, timed for ${REGION_WORDS[state.profile.region] || 'your area'}${state.years <= 2 ? ', with extra watering while they settle in' : ''}. Tick jobs off as you do them.`;
    $('careNow').innerHTML = `<h3>This month: ${MONTHS[now - 1]}${left ? ` <span class="count">${left} to do</span>` : thisMonth.length ? ' <span class="count">all done</span>' : ''}</h3>` + careList(thisMonth, true);
    $('careNextHead').textContent = `Coming up in ${MONTHS[next - 1]} (${tasks.filter(t => t.m === next).length})`;
    $('careNext').innerHTML = careList(tasks.filter(t => t.m === next), false);
    $('careYear').innerHTML = MONTHS.map((name, i) => { const ts = tasks.filter(t => t.m === i + 1); return `<details${i + 1 === now ? ' open' : ''}><summary>${name} <span class="count">${ts.length} job${ts.length === 1 ? '' : 's'}</span></summary>${careList(ts, i + 1 === now)}</details>`; }).join('');
    $('careSection').querySelectorAll('[data-care]').forEach(cb => cb.addEventListener('change', () => {
      const d = careDone(), k = decodeURIComponent(cb.dataset.care); if (cb.checked) d[k] = 1; else delete d[k];
      lsSet('netgarden.care.done', JSON.stringify(d)); renderCare();
      if (cb.checked) toast('Ticked off', 1200);
    }));
  }
  function openCare() { showStep('review'); setSheet('full'); setTimeout(() => { const el = $('careSection'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 350); }

  /* the care calendar as calendar events: one all-day event each month, repeating every year */
  function icsText() {
    const tasks = careTasks(), today = new Date(), stamp = today.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const enc = new TextEncoder();
    const fold = (line) => { const out = []; let cur = '', n = 0; for (const ch of line) { const b = enc.encode(ch).length; if (n + b > 73) { out.push(cur); cur = ' '; n = 1; } cur += ch; n += b; } out.push(cur); return out.join('\r\n'); };
    const firstSat = (y, m) => { const d = new Date(y, m - 1, 1); d.setDate(1 + ((6 - d.getDay() + 7) % 7)); return d; };
    const ymd = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Netgarden//Care calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Garden jobs'];
    for (let m = 1; m <= 12; m++) {
      const ts = tasks.filter(t => t.m === m); if (!ts.length) continue;
      let start = firstSat(today.getFullYear(), m); if (start < new Date(today.getFullYear(), today.getMonth(), today.getDate())) start = firstSat(today.getFullYear() + 1, m);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const desc = ts.map(t => `• ${window.Care.KINDS[t.kind]}: ${t.text}${t.general ? '' : ` (${plantNames(t.pids, 6)})`}`).join('\n') + '\n\nFrom your Netgarden design.';
      lines.push('BEGIN:VEVENT', `UID:netgarden-care-${m}-${state.plants.length}-${stamp}@netgarden`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(end)}`, `RRULE:FREQ=YEARLY;BYMONTH=${m};BYDAY=1SA`,
        fold(`SUMMARY:${esc(`Garden jobs for ${MONTHS[m - 1]} (${ts.length})`)}`), fold(`DESCRIPTION:${esc(desc)}`), 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', fold(`DESCRIPTION:${esc(`Garden jobs for ${MONTHS[m - 1]}`)}`), 'TRIGGER:PT9H', 'END:VALARM', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR'); return lines.join('\r\n') + '\r\n';
  }
  $('careIcs').addEventListener('click', async () => {
    if (!state.plants.length) { toast('Place some plants first'); return; }
    const file = new File([icsText()], 'netgarden-garden-jobs.ics', { type: 'text/calendar' });
    if (isPhone() && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Garden jobs' }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast('Calendar file saved. Open it to add a reminder on the first Saturday of each month.', 5000);
  });
  $('carePrint').addEventListener('click', () => {
    if (!state.plants.length) { toast('Place some plants first'); return; }
    const tasks = careTasks();
    $('printSheet').innerHTML = `<h1>Care calendar</h1><p>${new Set(state.plants.map(p => p.pid)).size} kinds of plant · timed for ${REGION_WORDS[state.profile.region]} · Netgarden</p>` +
      MONTHS.map((name, i) => { const ts = tasks.filter(t => t.m === i + 1); if (!ts.length) return ''; return `<div class="careMonth"><h2>${name}</h2><table><tr><th>Job</th><th>What to do</th><th>Plants</th><th>Why</th></tr>${ts.map(t => `<tr><td>${window.Care.KINDS[t.kind]}</td><td>${t.text}</td><td>${t.general ? 'Whole garden' : plantNames(t.pids, 8)}</td><td>${t.why || ''}</td></tr>`).join('')}</table></div>`; }).join('');
    setTimeout(() => window.print(), 50);
  });

  /* ---------------- small storage helpers ---------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

  /* ---------------- shortlist and sticky filters ---------------- */
  const favs = new Set((() => { try { return JSON.parse(lsGet('netgarden.fav') || '[]'); } catch (e) { return []; } })());
  function toggleFav(id) { if (favs.has(id)) favs.delete(id); else favs.add(id); lsSet('netgarden.fav', JSON.stringify([...favs])); const p = LIB.byId[id]; toast(favs.has(id) ? `${p.name} added to your shortlist` : `${p.name} taken off your shortlist`, 2000); renderLibrary(); if ($('plantDlg').open) $('pdFav').textContent = favs.has(id) ? '★ On shortlist' : '☆ Shortlist'; }
  function saveLibPrefs() { lsSet('netgarden.lib', JSON.stringify({ role: state.role, filters: [...state.filters] })); }
  function loadLibPrefs() { try { const o = JSON.parse(lsGet('netgarden.lib') || 'null'); if (o) { if (o.role) state.role = o.role; if (Array.isArray(o.filters)) state.filters = new Set(o.filters); } } catch (e) { } }
  FILTERS.unshift(['fav', '★ Shortlist']);
  function profileSet() { const p = state.profile; return p.soil !== 'unknown' || p.drainage !== 'average' || p.ph !== 'unknown' || p.exposure !== 'sheltered' || p.region !== 'south'; }
  function renderSuitsNote() {
    const el = $('suitsNote'), on = state.filters.has('suits'); el.classList.toggle('hidden', !on); if (!on) return;
    const p = state.profile, W = { clay: 'clay soil', loam: 'loam', sand: 'sandy soil', chalk: 'chalky soil', unknown: 'soil not set' }, R = { south: 'southern England', midlands: 'the Midlands and Wales', north: 'northern England', scotland: 'Scotland' };
    el.innerHTML = `Showing plants with no problems for <b>${W[p.soil]}</b>, <b>${p.drainage === 'average' ? 'average drainage' : p.drainage === 'wet' ? 'wet ground' : 'dry ground'}</b>, <b>${p.ph === 'unknown' ? 'pH not set' : p.ph + ' soil'}</b>, <b>${p.exposure}</b>, <b>${R[p.region]}</b>. ${profileSet() ? '' : 'Tell it about your garden in the Photo step for a closer match. '}Tap <b>i</b> on a plant to see why.`;
  }

  /* ---------------- plant details ---------------- */
  let detailId = null;
  function openPlantDetail(id) {
    const p = LIB.byId[id]; if (!p) return; detailId = id;
    const sp = (window.SPRITE_MANIFEST || {})[p.id] || {}, img = ['flower', 'leaf', 'fruit', 'autumn'].map(s => sp[s]).find(e => e && e.file && !e.rejected);
    const ex = window.Site.explain(p, state.profile), SUN = { full: 'Full sun', partial: 'Sun or part shade', shade: 'Shade' };
    const POL = { self: 'Self-fertile: fruits on its own.', partial: 'Partly self-fertile: crops better with a partner nearby.', partner: 'Needs a different variety nearby to set fruit.' };
    const partners = p.pgroup ? LIB.all.filter(o => o.pgroup === p.pgroup && o.id !== p.id) : [];
    const have = partners.filter(o => state.plants.some(pl => pl.pid === o.id));
    const jobs = window.Care.forPlant(p, state.profile, state.years).sort((a, b) => a.m - b.m || window.Care.ORDER.indexOf(a.kind) - window.Care.ORDER.indexOf(b.kind));
    $('pdBody').innerHTML = `<div class="pdHead">${img ? `<img src="${img.file}" alt="">` : `<img src="${thumb(p)}" alt="">`}<div><h2 id="pdName">${p.name}</h2><div class="lt">${p.latin}</div></div></div>
      <p>${p.notes || ''}${p.notes2 ? ' ' + p.notes2 : ''}</p>
      <dl class="pdFacts"><dt>Grows to</dt><dd>${p.h} m tall, ${p.s} m across${p.rootstocks ? ' (depends on rootstock)' : ''}</dd>
        <dt>Plant</dt><dd>about ${(Math.max(0.2, p.s * 0.8)).toFixed(1)} m apart</dd>
        <dt>Light</dt><dd>${SUN[p.sun] || p.sun}</dd><dt>Foliage</dt><dd>${p.ev ? 'Evergreen' : 'Deciduous' + (p.autumn ? ', autumn colour' : '')}</dd>
        ${p.flower ? `<dt>Flowers</dt><dd>${monthsText(p.flower.m)}</dd>` : ''}${p.fruit ? `<dt>Fruit</dt><dd>${monthsText(p.fruit.m)}</dd>` : ''}
        ${p.pollinator ? '<dt>Wildlife</dt><dd>Good for bees and other pollinators</dd>' : ''}${p.tender ? '<dt>Hardiness</dt><dd>Borderline hardy: needs a sheltered spot</dd>' : ''}</dl>
      ${p.rootstocks ? `<h3>Rootstock (controls how big the tree grows)</h3><table class="rs">${Object.entries(p.rootstocks).map(([k, v]) => `<tr><td><b>${k}</b></td><td>about ${v[0]} m tall, ${v[1]} m across</td></tr>`).join('')}</table>` : ''}
      ${p.pollination ? `<h3>Pollination</h3><p>${POL[p.pollination] || ''}${partners.length && p.pollination !== 'self' ? ` Partners in the library: ${partners.slice(0, 6).map(o => o.name).join(', ')}.` : ''}${have.length ? ` <b>✓ Your design already has ${have.map(o => o.name).join(', ')}.</b>` : ''}</p>` : ''}
      <h3>For your garden</h3><ul class="pdList">${ex.good.map(g => `<li class="good">✓ ${g[0].toUpperCase() + g.slice(1)}</li>`).join('')}${ex.issues.map(i => `<li class="${i.level}">${i.level === 'note' ? 'ℹ' : '⚠'} ${i.text[0].toUpperCase() + i.text.slice(1)}</li>`).join('')}${!ex.good.length && !ex.issues.length ? '<li>No problems found for your garden.</li>' : ''}</ul>
      ${jobs.length ? `<h3>Care through the year</h3><ul class="pdList">${jobs.map(j => `<li><b>${MONTHS[j.m - 1]}:</b> ${j.text}${j.why ? ` <span class="small">${j.why}</span>` : ''}</li>`).join('')}</ul>` : ''}`;
    $('pdFav').textContent = favs.has(id) ? '★ On shortlist' : '☆ Shortlist';
    $('pdPlant').textContent = state.replaceId ? 'Put this here instead' : 'Plant this';
    const d = $('plantDlg'); d.returnValue = ''; d.showModal(); $('pdBody').scrollTop = 0;
  }
  $('plantDlg').addEventListener('close', () => {
    const v = $('plantDlg').returnValue, id = detailId; if (!id) return;
    if (v === 'fav') { toggleFav(id); setTimeout(() => openPlantDetail(id), 0); return; }
    if (v === 'plant') { if (state.replaceId) { replacePlant(state.replaceId, id); return; } const card = $('plantList').querySelector(`.card[data-id="${id}"]`); if (card) card.click(); else { state.libSel = id; state.sel = null; setContext({ cancel: () => { state.libSel = null; renderLibrary(); updateHint(); } }); renderLibrary(); updateHint(); setSheet('peek'); } }
  });

  /* ---------------- starter gardens ---------------- */
  const STARTERS = {
    cottage: { back: [['delphinium', 2], ['foxglove', 3], ['rose-gertrude', 2]], mid: [['lupin', 2], ['rose-munstead-wood', 1], ['peony', 1], ['echinacea', 2], ['nepeta', 2]], front: [['geranium-rozanne', 3], ['alchemilla', 3], ['lavender-hidcote', 3]] },
    wildlife: { back: [['verbena-bon', 3], ['echinops', 2], ['foxglove', 3], ['buddleja-buzz', 1]], mid: [['echinacea', 3], ['agastache', 2], ['achillea', 2], ['salvia-caradonna', 2]], front: [['sedum', 3], ['nepeta', 2], ['erysimum', 2], ['eryngium', 2]] },
    lowmaint: { back: [['choisya', 2], ['miscanthus-ml', 2], ['calamagrostis-kf', 3]], mid: [['hebe', 2], ['skimmia-rubella', 2], ['box', 3]], front: [['stipa-tenuissima', 4], ['hakonechloa', 3], ['festuca-glauca', 4]] },
    edible: { back: [['raspberry-autumn', 3], ['runner-bean', 2], ['tomato', 2], ['sweetcorn', 2]], mid: [['blackcurrant', 1], ['gooseberry', 1], ['rhubarb', 1], ['kale', 2], ['chard', 3]], front: [['strawberry', 5], ['lettuce', 4], ['chives', 2], ['thyme', 2], ['parsley', 2]] },
  };
  function openStarter() { const d = $('starterDlg'); d.returnValue = ''; d.showModal(); }
  $('starterOpen').addEventListener('click', openStarter);
  $('starterDlg').addEventListener('close', async () => {
    const v = $('starterDlg').returnValue; if (!STARTERS[v]) return;
    if ((state.plants.length || state.beds.length) && !(await confirmDialog('Replace the plants and borders in your design with this starter garden? You can undo.', 'Replace'))) return;
    buildStarter(v);
  });
  function buildStarter(theme) {
    if (!cam) return; const spec = STARTERS[theme], fz = fenceZ() || 9, back = fz - 0.35, depth = Math.min(3.2, Math.max(1.8, fz * 0.28)), front = back - depth;
    /* how wide the lawn is in view at the front of the border */
    const yF = cam.toImage(0, front).y, L = cam.toPlan(state.photo.w * 0.07, yF), Rr = cam.toPlan(state.photo.w * 0.93, yF);
    const half = Math.max(1.5, Math.min(Math.abs(L ? L.X : -3), Math.abs(Rr ? Rr.X : 3)));
    /* the border is as long as its longest row of plants, up to the width of lawn in view */
    const rowLen = (r) => spec[r].reduce((a, [id, n]) => a + (LIB.byId[id] ? n * Math.max(0.3, LIB.byId[id].s * 0.85) : 0), 0);
    const bedHalf = Math.min(half, Math.max(rowLen('back'), rowLen('mid'), rowLen('front')) / 2 + 0.3);
    state.beds = [{ id: uid(), pts: [{ X: -bedHalf, Z: front }, { X: bedHalf, Z: front }, { X: bedHalf, Z: back }, { X: -bedHalf, Z: back }], surface: theme === 'lowmaint' ? 'gravel' : theme === 'wildlife' ? 'bark' : 'soil' }];
    const plants = [], rows = [['back', back - 0.1], ['mid', (back + front) / 2], ['front', front + 0.35]];
    rows.forEach(([row, Zr]) => {
      const items = []; spec[row].forEach(([id, n]) => { const p = LIB.byId[id]; if (p) for (let i = 0; i < n; i++) items.push(p); });
      const widths = items.map(p => Math.max(0.3, p.s * 0.85)); let total = widths.reduce((a, b) => a + b, 0), scale = Math.min(1, (half * 2 - 0.3) / total);
      let x = -total * scale / 2;
      items.forEach((p, i) => { const w = widths[i] * scale, rnd = window.Render.mulberry32(i * 977 + row.length * 31)(); const Z = row === 'back' ? Math.min(back - Math.max(0.1, p.s * 0.3), Zr) : Zr + (rnd - 0.5) * 0.35;
        const pl = { id: uid(), pid: p.id, X: x + w / 2, Z, seed: Math.floor(rnd * 1e9), size: 1 }; if (p.rootstocks) pl.rootstock = Object.keys(p.rootstocks)[0]; plants.push(pl); x += w; });
    });
    state.plants = plants; state.sel = null; state.multi.clear(); state.libSel = null; setContext(null);
    afterChange(); renderBeds(); renderLibrary(); showStep('plants'); setSheet('peek'); zoomToBed(state.beds[0]);
    toast(`Starter ${theme === 'lowmaint' ? 'low-maintenance' : theme} border planted. Drag the year to see it through the seasons.`, 4500);
  }

  /* ---------------- first-run tour ---------------- */
  let tourStep = 0, tourSteps = null;
  function tourDefs() {
    const ph = isPhone();
    return [
      { title: 'Welcome to Netgarden', text: 'Plan a border on a photo of your own garden, then watch it flower, fruit and colour through the year. Want a quick look round?', buttons: [['Skip', 'skip'], ['Try a starter garden', 'starter'], ['Show me round', 'next']] },
      { sel: '.steps [data-step=photo]', before: () => showStep('plants'), title: '1. Your photo', text: 'Start with a photo taken from where you usually stand. Set eye level and mark one fence panel, and every plant comes out the right size.' },
      { sel: '.steps [data-step=beds]', title: '2. Borders', text: 'Draw where the beds go. When you choose a plant it zooms straight to the nearest border.' },
      { sel: ph ? '#side' : '#plantList', before: () => { showStep('plants'); setSheet('half'); }, title: '3. Plants', text: ph ? 'Pick a plant, then tap the lawn. Or press and hold a card and drag it onto the photo. Tap i for everything about a plant, ☆ to shortlist it.' : 'Pick a plant, then click the lawn, or drag a card onto the photo. Click i for everything about a plant, ☆ to shortlist it.' },
      { sel: '#bands', title: '4. The year', text: 'Drag along this band to move through the year. The coloured stripes show when each of your plants is in flower.' },
      { sel: '#menuBtn', title: 'Save, share, start again', text: 'Starter gardens, sending your design to your iPad, saving a picture and starting again are all in here.', buttons: [['Done', 'done']] },
    ];
  }
  function startTour() { tourSteps = tourDefs(); tourStep = 0; $('tour').classList.remove('hidden', 'light'); showTourStep(); }
  function endTour() { $('tour').classList.add('hidden'); lsSet('netgarden.tour', 'done'); tourSteps = null; }
  function placeBubble(r) {
    const b = $('tourBubble'), bw = b.offsetWidth, bh = b.offsetHeight, vw = innerWidth, vh = innerHeight, m = 12;
    let top, left;
    if (!r) { top = (vh - bh) / 2; left = (vw - bw) / 2; }
    else { left = Math.max(m, Math.min(vw - bw - m, r.left + r.width / 2 - bw / 2)); top = r.bottom + m + bh < vh ? r.bottom + m : r.top - bh - m; if (top < m) top = Math.max(m, Math.min(vh - bh - m, r.top + r.height / 2 - bh / 2)); }
    b.style.top = top + 'px'; b.style.left = left + 'px';
  }
  function showTourStep() {
    const s = tourSteps[tourStep]; if (!s) { endTour(); return; }
    if (s.before) s.before();
    $('tourTitle').textContent = s.title; $('tourText').textContent = s.text;
    const btns = s.buttons || [['Skip', 'skip'], ['Next', 'next']];
    $('tourBtns').innerHTML = btns.map(([l, a], i) => `<button data-tour="${a}" class="${a === 'skip' ? 'skip' : i === btns.length - 1 ? 'primary' : ''}">${l}</button>`).join('');
    $('tourBtns').querySelectorAll('[data-tour]').forEach(b => b.addEventListener('click', () => { const a = b.dataset.tour; if (a === 'next') { tourStep++; showTourStep(); } else if (a === 'starter') { endTour(); openStarter(); } else endTour(); }));
    const t = s.sel && document.querySelector(s.sel); $('tour').classList.toggle('centred', !t);
    setTimeout(() => { const r = t ? t.getBoundingClientRect() : null, sp = $('tourSpot'), pad = 6;
      if (r) { sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + pad * 2) + 'px'; sp.style.height = (r.height + pad * 2) + 'px'; } else { sp.removeAttribute('style'); }
      placeBubble(r); const f = $('tourBtns').querySelector('.primary'); if (f) f.focus(); }, s.before ? 380 : 30);
  }
  function yearTip() {
    if (tourSteps) return; const t = $('bands'); if (!t || !t.offsetParent) return;
    tourSteps = [{ sel: '#bands', title: 'See it through the year', text: 'Drag along the flower band to watch your plant change with the seasons.', buttons: [['Got it', 'done']] }]; tourStep = 0;
    $('tour').classList.remove('hidden'); $('tour').classList.add('light'); showTourStep();
    setTimeout(() => { if (tourSteps && tourSteps.length === 1) endTour(); }, 7000);
  }
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && tourSteps) endTour(); });
  window.addEventListener('resize', () => { if (tourSteps) showTourStep(); });

  /* ---------------- printable planting list ---------------- */
  $('printList').addEventListener('click', () => {
    if (!state.plants.length) { toast('Place some plants first'); return; }
    const counts = {}; state.plants.forEach(pl => { const k = pl.pid + '|' + (pl.rootstock || ''); counts[k] = counts[k] || { pl, n: 0 }; counts[k].n++; });
    const rows = Object.values(counts).map(({ pl, n }) => { const p = LIB.byId[pl.pid], d = dims(pl); const jobs = []; window.Care.forPlant(p, state.profile, state.years).filter(j => /prune|trim|cut|support|divide/.test(j.kind)).sort((a, b) => a.m - b.m).forEach(j => jobs.push(`${SHORT[j.m - 1]}: ${j.text}`)); return { p, n, d, pl, jobs }; })
      .sort((a, b) => b.d.h - a.d.h);
    let img = ''; try { const c = compositeCanvas(), k = Math.min(1, 900 / c.width), s = document.createElement('canvas'); s.width = Math.round(c.width * k); s.height = Math.round(c.height * k); s.getContext('2d').drawImage(c, 0, 0, s.width, s.height); img = s.toDataURL('image/jpeg', 0.85); } catch (e) { }
    const SUN = { full: 'full sun', partial: 'sun or part shade', shade: 'shade' };
    $('printSheet').innerHTML = `<h1>Planting list</h1><p>${state.plants.length} plants, ${rows.length} kinds · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · Netgarden</p>${img ? `<img src="${img}" alt="">` : ''}
      <table><tr><th>Qty</th><th>Plant</th><th>Mature size</th><th>Spacing</th><th>Light</th><th>Flowers</th><th>Care</th></tr>
      ${rows.map(r => `<tr><td>${r.n}</td><td><b>${r.p.name}</b><br><span class="lt">${r.p.latin}</span>${r.pl.rootstock ? `<br>on ${r.pl.rootstock}` : ''}</td><td>${r.d.h} × ${r.d.s} m</td><td>${(Math.max(0.2, r.d.s * 0.8)).toFixed(1)} m</td><td>${SUN[r.p.sun] || r.p.sun}</td><td>${r.p.flower ? monthsText(r.p.flower.m) : '–'}</td><td>${r.jobs.join('<br>') || '–'}</td></tr>`).join('')}</table>`;
    setTimeout(() => window.print(), 50);
  });

  /* ---------------- the year as an animated GIF ---------------- */
  $('yearGif').addEventListener('click', async () => {
    if (!state.plants.length) { toast('Place some plants first'); return; }
    const btn = $('yearGif'); if (btn.disabled) return; btn.disabled = true; const t0 = state.t;
    try {
      toast('Making the animation…', 60000);
      await window.Render.preload([...new Set(state.plants.map(p => LIB.byId[p.pid]))].filter(Boolean));
      const k = Math.min(1, 520 / Math.max(state.photo.w, state.photo.h)), W = Math.round(state.photo.w * k), H = Math.round(state.photo.h * k), frames = [];
      const fc = document.createElement('canvas'); fc.width = W; fc.height = H; const fx = fc.getContext('2d', { willReadFrequently: true });
      for (let i = 0; i < 24; i++) {
        state.t = i * 0.5 + 0.25; const c = compositeCanvas(); fx.drawImage(c, 0, 0, W, H);
        const fs = Math.max(13, Math.round(W / 26)); fx.font = `600 ${fs}px system-ui, sans-serif`; const label = timeLabel(state.t), tw = fx.measureText(label).width;
        fx.fillStyle = 'rgba(20,30,18,0.75)'; fx.fillRect(10, H - fs * 1.9 - 10, tw + fs, fs * 1.9); fx.fillStyle = '#fff'; fx.fillText(label, 10 + fs / 2, H - 10 - fs * 0.6);
        fx.font = `${Math.round(fs * 0.8)}px system-ui, sans-serif`; fx.fillStyle = 'rgba(255,255,255,0.85)'; const wm = '❧ Netgarden'; fx.fillText(wm, W - fx.measureText(wm).width - 10, H - 12);
        frames.push(fx.getImageData(0, 0, W, H)); toast(`Making the animation… ${Math.round((i + 1) / 24 * 80)}%`, 60000); await new Promise(r => setTimeout(r, 0));
      }
      state.t = t0; invalidate(); await new Promise(r => setTimeout(r, 0));
      const bytes = window.Gif.encode(frames, 30), file = new File([bytes], 'netgarden-year.gif', { type: 'image/gif' });
      if (isPhone() && navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'My garden through the year' }); toast('Done'); return; } catch (e) { if (e && e.name === 'AbortError') { hideToast(); return; } } }
      const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast(`Saved the year as an animation (${Math.round(bytes.length / 1024)} KB)`, 4000);
    } catch (e) { toast('Could not make the animation: ' + e.message, 5000); }
    finally { state.t = t0; btn.disabled = false; invalidate(); }
  });

  /* ---------------- time, play, flower bands ---------------- */
  let scrubbing = false, scrubTimer = null;
  function markScrub() { scrubbing = true; clearTimeout(scrubTimer); scrubTimer = setTimeout(() => { scrubbing = false; invalidate(); }, 160); }
  function setTime(t) {
    markScrub(); state.t = ((t % 12) + 12) % 12; $('time').value = state.t; $('timeLabel').textContent = timeLabel(state.t);
    invalidate(); renderPlan(); if (state.step === 'review') renderCalendar();
    drawBandCursor();
  }
  $('time').addEventListener('input', (e) => setTime(+e.target.value)); $('time').addEventListener('change', save);
  const monthMid = (m) => ((m % 12) + 12) % 12 + 0.5;   /* mid-month position for month index m (0 = January) */
  $('monthPrev').addEventListener('click', () => { setTime(monthMid(Math.ceil(state.t - 0.5) - 1)); save(); });
  $('monthNext').addEventListener('click', () => { setTime(monthMid(Math.floor(state.t - 0.5) + 1)); save(); });
  $('monthTicks').innerHTML = SHORT.map(m => `<span>${m}</span>`).join('');
  $('play').addEventListener('click', () => { state.playing = !state.playing; $('play').textContent = state.playing ? '❚❚' : '▶'; if (state.playing) { let last = performance.now(); const step = (now) => { if (!state.playing) return; setTime(state.t + (now - last) / 1000 * 0.9); last = now; requestAnimationFrame(step); }; requestAnimationFrame(step); } else save(); });
  const bands = $('bands'), bctx = bands.getContext('2d'); let bandImage = null;
  function renderBands() {
    const w = bands.clientWidth || 600, h = 34, dpr = window.devicePixelRatio || 1; bands.width = Math.round(w * dpr); bands.height = Math.round(h * dpr); bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h); bctx.fillStyle = '#eceae2'; bctx.fillRect(0, 0, w, h);
    const ids = [...new Set(state.plants.map(p => p.pid))].map(id => LIB.byId[id]).filter(p => p && p.flower);
    ids.sort((a, b) => Math.min(...a.flower.m) - Math.min(...b.flower.m));
    const rows = Math.min(ids.length, 10), rh = rows ? Math.max(2, (h - 2) / rows) : 0;
    ids.slice(0, 10).forEach((p, i) => { const y = 1 + i * rh; for (let m = 1; m <= 12; m++) { const s = window.Phenology.monthState(p, m); if (s.flower > 0) { bctx.fillStyle = s.flowerColor; bctx.globalAlpha = 0.4 + 0.6 * s.flower; bctx.fillRect((m - 1) / 12 * w, y, w / 12 + 0.5, rh - 1); } } });
    bctx.globalAlpha = 1;
    if (!ids.length) { bctx.fillStyle = '#9a9a90'; bctx.font = '11px system-ui'; let txt = state.plants.length ? 'None of the placed plants flower' : 'Flowering months of your plants will show here'; if (bctx.measureText(txt).width > w - 16) txt = state.plants.length ? 'No flowers yet' : 'Flowering months show here'; bctx.fillText(txt, 8, h / 2 + 4); }
    else ids.slice(0, 10).forEach((p, i) => { /* name the band so colour is not the only cue */ const y = 1 + i * rh; if (rh >= 9) { bctx.fillStyle = 'rgba(20,30,18,0.75)'; bctx.font = `${Math.min(11, rh - 1)}px system-ui`; bctx.fillText(p.name, 4, y + rh - 2); } });
    for (let m = 1; m < 12; m++) { bctx.fillStyle = 'rgba(0,0,0,0.08)'; bctx.fillRect(m / 12 * w, 0, 1, h); }
    if (isPhone()) { bctx.fillStyle = 'rgba(40,50,36,0.8)'; bctx.font = '9px system-ui'; bctx.textAlign = 'center'; for (let m = 0; m < 12; m++) bctx.fillText(SHORT[m][0], (m + 0.5) / 12 * w, h - 3); bctx.textAlign = 'left'; }
    bandImage = bctx.getImageData(0, 0, bands.width, bands.height); drawBandCursor();
    bands.setAttribute('aria-label', ids.length ? 'Flowering months: ' + ids.slice(0, 10).map(p => `${p.name} ${monthsText(p.flower.m)}`).join(', ') : 'Flowering months of your plants will show here');
  }
  function drawBandCursor() { if (!bandImage) return; bctx.putImageData(bandImage, 0, 0); const dpr = window.devicePixelRatio || 1, w = bands.width / dpr; bctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.fillStyle = 'rgba(38,58,34,0.9)'; bctx.fillRect(state.t / 12 * w - 1, 0, 2, 34); }
  function inFlowerText(m) { const ids = [...new Set(state.plants.map(p => p.pid))].map(id => LIB.byId[id]).filter(p => p && p.flower && p.flower.m.includes(m)); return `${MONTHS[m - 1]}: ${ids.length ? ids.map(p => p.name).join(', ') : 'nothing in flower'}`; }
  let scrub = null;
  bands.addEventListener('pointerdown', (ev) => { if (ev.button > 0) return; blurInputs(); try { bands.setPointerCapture(ev.pointerId); } catch (e) { } const r = bands.getBoundingClientRect(); scrub = { x0: ev.clientX, moved: false, r }; if (state.playing) $('play').click(); setTime((ev.clientX - r.left) / r.width * 12); });
  bands.addEventListener('pointermove', (ev) => { if (scrub) { if (Math.abs(ev.clientX - scrub.x0) > 3) scrub.moved = true; setTime((ev.clientX - scrub.r.left) / scrub.r.width * 12); return; } if (ev.pointerType === 'mouse') { const r = bands.getBoundingClientRect(); bands.title = inFlowerText(Math.max(1, Math.min(12, Math.floor((ev.clientX - r.left) / r.width * 12) + 1))); } });
  const endScrub = (ev) => { if (!scrub) return; const s = scrub; scrub = null; save(); if (!s.moved && ev.pointerType !== 'mouse') toast(inFlowerText(Math.floor(state.t) + 1), 2200); };
  bands.addEventListener('pointerup', endScrub); bands.addEventListener('pointercancel', endScrub);
  window.addEventListener('resize', renderBands);

  /* ---------------- boot ---------------- */
  window.netgarden = { state, invalidate, get cam() { return cam; }, draw, save, showStep, setTime, undo, redo, setSheet, view, get sheet() { return sheet; }, get press() { return press; }, get pinch() { return pinch; }, get pointers() { return pointers.size; } };
  async function boot() {
    window.Render.api.onImageLoad = invalidate;
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => { });
    await loadUserSprites();
    const saved = loadSaved();
    try { if (saved && saved.photoData) await loadPhoto(saved.photoData, saved.photoName || 'photo.jpg', true); else await loadPhoto('assets/sample-garden.jpg', 'sample-garden.jpg', false); }
    catch (e) { hint('Could not load a photo. Use the Photo step to upload one.'); return; }
    state.ground = (saved && saved.ground) || defaultGround();
    if (saved) {
      state.beds = saved.beds || []; state.plants = (saved.plants || []).filter(p => LIB.byId[p.pid]); if (typeof saved.t === 'number') state.t = saved.t; if (typeof saved.years === 'number') state.years = saved.years;
      if (saved.sun) state.sun = saved.sun; if (saved.light) state.light = saved.light; if (saved.profile) state.profile = Object.assign({}, window.Site.DEFAULT_PROFILE, saved.profile);
      if (saved.masks) state.masks = await Promise.all(saved.masks.map(m => window.Masks.restore(m, state.photo.w, state.photo.h)));
    }
    buildCamera(); relayout(); fit(); lastSnap = snapshot();
    loadLibPrefs(); renderCredits(); renderLibrary(); renderPhoto(); renderBeds(); renderMasks(); renderSelected(); renderPlaced(); renderReview(); renderBands(); updateUndoButtons(); renderWiz();
    const firstRun = !saved; showStep(firstRun && !/sample/.test(state.photo.name) ? 'photo' : 'plants'); setTime(state.t); wakeZoom();
    const tourOff = /[?&]tour=0/.test(location.search);
    if (!tourOff && !lsGet('netgarden.tour') && firstRun) setTimeout(startTour, 500);
    else if (firstRun) toast(isPhone() ? 'Welcome. Pick a plant, then tap the lawn.' : 'Welcome. Pick a plant below or on the right, then tap the lawn.', 4000);
  }
  boot();
})();
