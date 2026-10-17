/* Netgarden — procedural plant renderer.
 * Every plant is drawn from its library parameters and current seasonal state,
 * so the time slider changes foliage, flowers, fruit and bare stems live.
 * Drawing happens in photo-pixel space; (x, y) is the plant's base on the ground. */
(function (global) {
  'use strict';
  const { shade, rgba, mixHex } = global.Phenology;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let shadowsOff = false;
  function shadow(ctx, x, y, w) {
    if (shadowsOff) return;
    ctx.save();
    ctx.fillStyle = 'rgba(20,30,10,0.22)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.48, Math.max(2, w * 0.11), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function blob(ctx, cx, cy, r, color, light) {
    const g = ctx.createRadialGradient(cx + r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, shade(color, 0.14 + light));
    g.addColorStop(0.65, color);
    g.addColorStop(1, shade(color, -0.2));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /* Foliage mass that stays inside the ellipse (cx, cy, rx, ry). */
  function canopy(ctx, rnd, cx, cy, rx, ry, color, density, n) {
    const rb = Math.min(rx, ry) * 0.3;
    ctx.save();
    ctx.globalAlpha *= 0.35 + 0.65 * density;
    /* soft silhouette so gaps between blobs are not see-through */
    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1);
    sg.addColorStop(0, rgba(shade(color, -0.15), 0.85)); sg.addColorStop(0.75, rgba(shade(color, -0.15), 0.7)); sg.addColorStop(1, rgba(shade(color, -0.15), 0));
    ctx.save(); ctx.translate(cx, cy); ctx.scale(rx * 0.95, ry * 0.95); ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const pts = [];
    const ex = Math.max(1, rx - rb * 0.55), ey = Math.max(1, ry - rb * 0.55);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); pts.push({ x: cx + Math.cos(a) * ex * r, y: cy + Math.sin(a) * ey * r, k: 0.6 + rnd() * 0.5 }); }
    pts.sort((a, b) => a.y - b.y);
    pts.forEach(pt => blob(ctx, pt.x, pt.y, rb * pt.k * (0.7 + 0.3 * density), color, (cy - pt.y) / ry * 0.12));
    /* leaf texture */
    const texN = Math.round(n * 2.2);
    for (let i = 0; i < texN; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      const x = cx + Math.cos(a) * ex * r, y = cy + Math.sin(a) * ey * r;
      ctx.fillStyle = rgba(shade(color, rnd() < 0.5 ? 0.25 : -0.3), 0.5);
      ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.8, rb * 0.16), Math.max(0.5, rb * 0.09), rnd() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function dots(ctx, rnd, n, color, r, within) {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const p = within(rnd);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (0.7 + rnd() * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function inEllipse(cx, cy, rx, ry, bias) {
    return (rnd) => {
      const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), bias || 0.5);
      return { x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r };
    };
  }

  function branches(ctx, rnd, x, y, len, angle, depth, width, color) {
    if (depth === 0 || len < 1.5) return;
    const ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.6, width); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = angle + (rnd() - 0.5) * 1.3;
      branches(ctx, rnd, ex, ey, len * (0.55 + rnd() * 0.25), a, depth - 1, width * 0.6, color);
    }
  }

  /* ---------- forms ---------- */

  function drawTree(ctx, p, st, x, y, w, h, rnd) {
    const trunkH = h * 0.3, trunkW = Math.max(1.5, w * 0.06);
    const cx = x, cy = y - h * 0.64, rx = w / 2, ry = h * 0.36;
    shadow(ctx, x, y, w);
    /* trunk */
    ctx.fillStyle = st.bare === '#e9e6df' ? '#e9e6df' : '#6b5a48';
    ctx.beginPath();
    ctx.moveTo(x - trunkW, y); ctx.lineTo(x + trunkW, y); ctx.lineTo(x + trunkW * 0.6, cy); ctx.lineTo(x - trunkW * 0.6, cy); ctx.closePath(); ctx.fill();
    if (st.bare === '#e9e6df') { /* birch bark marks */
      ctx.strokeStyle = 'rgba(40,40,40,0.5)'; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) { const yy = y - trunkH * rnd(); ctx.beginPath(); ctx.moveTo(x - trunkW * 0.8, yy); ctx.lineTo(x + trunkW * 0.3, yy); ctx.stroke(); }
    }
    /* branches, visible when leaf cover is thin */
    if (st.leaf < 0.95) {
      ctx.save(); ctx.globalAlpha = 1 - st.leaf * 0.9;
      const r2 = mulberry32(1);
      for (let i = 0; i < 4; i++) branches(ctx, r2, x, cy + ry * 0.35, ry * 0.5, -Math.PI / 2 + (i - 1.5) * 0.6, 4, trunkW * 0.55, st.bare);
      ctx.restore();
    }
    /* canopy */
    if (st.leaf > 0.02) canopy(ctx, rnd, cx, cy, rx, ry, st.leafColor, st.leaf, 26);
    if (st.flower > 0.02 && st.flowerColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.flower * 1.2);
      dots(ctx, rnd, Math.round(90 * st.flower), st.flowerColor, Math.max(1.2, Math.min(rx, ry) * 0.07), inEllipse(cx, cy, rx * 0.9, ry * 0.9, 0.4));
      ctx.restore();
    }
    if (st.fruit > 0.02 && st.fruitColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.fruit * 1.2);
      dots(ctx, rnd, Math.round(30 * st.fruit), st.fruitColor, Math.max(1.2, Math.min(rx, ry) * 0.065), inEllipse(cx, cy + ry * 0.1, rx * 0.85, ry * 0.85, 0.5));
      ctx.restore();
    }
  }

  function drawShrub(ctx, p, st, x, y, w, h, rnd) {
    const rx = w / 2, ry = h * 0.5, cx = x, cy = y - ry;
    shadow(ctx, x, y, w);
    if (st.leaf < 0.95) {
      ctx.save(); ctx.globalAlpha = 1 - st.leaf * 0.9;
      const r2 = mulberry32(7);
      ctx.strokeStyle = st.bare; ctx.lineCap = 'round';
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.5;
        branches(ctx, r2, x + (r2() - 0.5) * rx * 0.4, y, h * 0.42, a, 3, Math.max(1, w * 0.025), st.bare);
      }
      ctx.restore();
    }
    if (st.leaf > 0.02) canopy(ctx, rnd, cx, cy, rx, ry, st.leafColor, st.leaf, 20);
    if (st.flower > 0.02 && st.flowerColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.flower * 1.2);
      const big = /hydrangea|rhododendron|peony|camellia|rose/i.test(p.name);
      dots(ctx, rnd, Math.round((big ? 22 : 60) * st.flower), st.flowerColor, Math.max(1.3, Math.min(rx, ry) * (big ? 0.18 : 0.08)), inEllipse(cx, cy - ry * 0.1, rx * 0.85, ry * 0.85, 0.35));
      ctx.restore();
    }
    if (st.fruit > 0.02 && st.fruitColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.fruit * 1.2);
      dots(ctx, rnd, Math.round(24 * st.fruit), st.fruitColor, Math.max(1.2, Math.min(rx, ry) * 0.07), inEllipse(cx, cy, rx * 0.85, ry * 0.85, 0.5));
      ctx.restore();
    }
  }

  function drawClimber(ctx, p, st, x, y, w, h, rnd) {
    const rx = w / 2, cx = x;
    if (st.leaf < 0.95) {
      ctx.save(); ctx.globalAlpha = 1 - st.leaf * 0.9;
      ctx.strokeStyle = st.bare; ctx.lineWidth = Math.max(1, w * 0.025); ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(x + (i - 1.5) * rx * 0.3, y);
        let px = x + (i - 1.5) * rx * 0.3, py = y;
        for (let k = 0; k < 6; k++) { px += (rnd() - 0.5) * rx * 0.6; py -= h / 6; ctx.lineTo(px, py); }
        ctx.stroke();
      }
      ctx.restore();
    }
    if (st.leaf > 0.02) {
      ctx.save(); ctx.globalAlpha = 0.35 + 0.65 * st.leaf;
      const n = 22, pts = [], rb = Math.min(rx, h * 0.12) * 0.55;
      for (let i = 0; i < n; i++) { const t = rnd(); pts.push({ x: cx + (rnd() - 0.5) * (w - 2 * rb) * (0.5 + t * 0.5), y: y - rb - (h - 2 * rb) * (0.05 + t * 0.9) }); }
      pts.sort((a, b) => a.y - b.y);
      pts.forEach(pt => blob(ctx, pt.x, pt.y, rb * (0.7 + rnd() * 0.5) * (0.6 + 0.4 * st.leaf), st.leafColor, (y - h * 0.5 - pt.y) / h * 0.15));
      ctx.restore();
    }
    const within = (r) => { const t = r(); return { x: cx + (r() - 0.5) * w * (0.5 + t * 0.6), y: y - h * (0.1 + t * 0.85) }; };
    if (st.flower > 0.02 && st.flowerColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.flower * 1.2);
      dots(ctx, rnd, Math.round(60 * st.flower), st.flowerColor, Math.max(1.3, rx * 0.12), within);
      ctx.restore();
    }
    if (st.fruit > 0.02 && st.fruitColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.fruit * 1.2);
      dots(ctx, rnd, Math.round(30 * st.fruit), st.fruitColor, Math.max(1.2, rx * 0.08), within);
      ctx.restore();
    }
  }

  function drawPerennial(ctx, p, st, x, y, w, h, rnd) {
    const rx = w / 2;
    shadow(ctx, x, y, w * 0.9);
    if (st.leaf <= 0.02 && st.flower <= 0.02) { /* dormant crown */
      ctx.strokeStyle = 'rgba(110,90,60,0.7)'; ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + (i - 2) * rx * 0.15, y); ctx.lineTo(x + (i - 2) * rx * 0.3, y - h * 0.12); ctx.stroke(); }
      return;
    }
    const stems = Math.max(5, Math.round(7 + w / 6));
    const tops = [];
    ctx.save(); ctx.globalAlpha = 0.4 + 0.6 * Math.max(st.leaf, st.flower * 0.8);
    /* leafy mound */
    const mound = Math.max(0.25, st.leaf);
    const pts = [];
    for (let i = 0; i < 10; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); pts.push({ x: x + Math.cos(a) * rx * 0.7 * r, y: y - h * 0.22 * mound + Math.sin(a) * h * 0.14 * mound }); }
    pts.sort((a, b) => a.y - b.y);
    pts.forEach(pt => blob(ctx, pt.x, pt.y, Math.max(1.5, rx * 0.45 * mound), st.leafColor, 0.05));
    /* stems */
    ctx.strokeStyle = shade(st.leafColor, -0.15); ctx.lineWidth = Math.max(0.8, w * 0.02); ctx.lineCap = 'round';
    for (let i = 0; i < stems; i++) {
      const sx = x + (rnd() - 0.5) * rx * 1.2, sh = h * (0.55 + rnd() * 0.45) * (0.5 + 0.5 * Math.max(st.leaf, st.flower));
      const tx = sx + (rnd() - 0.5) * rx * 0.4, ty = y - sh;
      ctx.beginPath(); ctx.moveTo(sx, y - h * 0.1); ctx.quadraticCurveTo(sx, y - sh * 0.6, tx, ty); ctx.stroke();
      tops.push({ x: tx, y: ty });
    }
    ctx.restore();
    if (st.flower > 0.02 && st.flowerColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.flower * 1.3);
      const spike = /salvia|delphinium|lupin|foxglove|verbena|astilbe|nepeta|penstemon|camassia/i.test(p.name + p.latin);
      const headR = Math.max(1.5, rx * (spike ? 0.08 : 0.16));
      ctx.fillStyle = st.flowerColor;
      tops.forEach((t, i) => {
        if (i / tops.length > st.flower + 0.1) return;
        if (spike) { for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(t.x + (rnd() - 0.5) * headR, t.y + k * headR * 1.4, headR, 0, Math.PI * 2); ctx.fill(); } }
        else { blob(ctx, t.x, t.y, headR, st.flowerColor, 0.1); }
      });
      ctx.restore();
    }
  }

  function drawGrass(ctx, p, st, x, y, w, h, rnd) {
    const rx = w / 2;
    shadow(ctx, x, y, w * 0.8);
    if (st.leaf <= 0.02) return;
    ctx.save(); ctx.globalAlpha = 0.5 + 0.5 * st.leaf;
    const n = Math.max(14, Math.round(18 + w / 4));
    ctx.lineCap = 'round'; ctx.lineWidth = Math.max(0.7, w * 0.012);
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * 2.4 + (rnd() - 0.5) * 0.3;
      const L = h * (0.6 + rnd() * 0.4) * (0.6 + 0.4 * st.leaf);
      const ex = x + Math.sin(a) * rx * 1.1, ey = y - L * Math.cos(a * 0.6);
      ctx.strokeStyle = shade(st.leafColor, (rnd() - 0.5) * 0.3);
      ctx.beginPath(); ctx.moveTo(x + (rnd() - 0.5) * rx * 0.3, y);
      ctx.quadraticCurveTo(x + Math.sin(a) * rx * 0.3, y - L * 0.8, ex, ey); ctx.stroke();
    }
    ctx.restore();
    if (st.flower > 0.02 && st.flowerColor) {
      ctx.save(); ctx.globalAlpha = Math.min(1, st.flower * 1.2);
      ctx.strokeStyle = st.flowerColor; ctx.fillStyle = st.flowerColor; ctx.lineWidth = Math.max(0.7, w * 0.012);
      const m = Math.round(8 * st.flower + 3);
      for (let i = 0; i < m; i++) {
        const a = (rnd() - 0.5) * 1.2, L = h * (1.05 + rnd() * 0.25);
        const ex = x + Math.sin(a) * rx * 0.9, ey = y - L;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.sin(a) * rx * 0.2, y - L * 0.7, ex, ey); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(ex, ey - h * 0.04, Math.max(1, w * 0.04), Math.max(2, h * 0.08), a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawBulb(ctx, p, st, x, y, w, h, rnd, ppm) {
    if (st.leaf <= 0.02 && st.flower <= 0.02) return;
    const clump = 7, spread = Math.max(w * 2.5, ppm * 0.35);
    const headR = Math.max(1.5, Math.max(0.025, p.s * 0.3) * ppm);
    ctx.save();
    for (let i = 0; i < clump; i++) {
      const bx = x + (rnd() - 0.5) * spread, by = y + (rnd() - 0.5) * spread * 0.25;
      const bh = h * (0.8 + rnd() * 0.3);
      if (st.leaf > 0.02) {
        ctx.globalAlpha = 0.5 + 0.5 * st.leaf;
        ctx.strokeStyle = st.leafColor; ctx.lineWidth = Math.max(0.8, ppm * 0.012); ctx.lineCap = 'round';
        for (let k = 0; k < 3; k++) { const a = (k - 1) * 0.35 + (rnd() - 0.5) * 0.2, L = Math.max(bh * 0.6, ppm * 0.12) * st.leaf; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + Math.sin(a) * L * 0.3, by - L * 0.7, bx + Math.sin(a) * L * 0.6, by - L); ctx.stroke(); }
      }
      if (st.flower > 0.02 && st.flowerColor) {
        ctx.globalAlpha = Math.min(1, st.flower * 1.3);
        ctx.strokeStyle = shade(st.leafColor, -0.1); ctx.lineWidth = Math.max(0.8, ppm * 0.01);
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - bh); ctx.stroke();
        blob(ctx, bx, by - bh, headR * (0.6 + 0.4 * st.flower), st.flowerColor, 0.1);
      }
    }
    ctx.restore();
  }

  /* ---------- photo sprites ---------- */
  const FALLBACK = {
    flower: ['flower', 'leaf', 'spring', 'autumn', 'fruit'], fruit: ['fruit', 'leaf', 'autumn', 'flower', 'spring'],
    autumn: ['autumn', 'leaf', 'fruit', 'flower', 'spring'], spring: ['spring', 'leaf', 'flower', 'autumn', 'fruit'],
    leaf: ['leaf', 'spring', 'autumn', 'fruit', 'flower'], bare: ['bare'],
  };
  const imgCache = {};
  const api = { onImageLoad: null };
  function getImage(path) {
    let im = imgCache[path];
    if (!im) {
      im = new Image(); imgCache[path] = im;
      im.onload = () => { if (api.onImageLoad) api.onImageLoad(); };
      im.src = path;
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  function spriteSet(p) { return (window.SPRITE_MANIFEST || {})[p.id] || null; }
  /* resolve a state to a loaded image, following the fallback chain */
  function resolveSprite(p, state) {
    const set = spriteSet(p); if (!set) return null;
    for (const s of FALLBACK[state] || [state]) {
      const e = set[s]; if (e && e.file) { const im = getImage(e.file); if (im) return { im, state: s }; }
    }
    return null;
  }
  function hasSprites(p) { const set = spriteSet(p); return !!(set && Object.values(set).some(e => e && e.file)); }
  function spriteAspect(p) {
    const set = spriteSet(p); if (!set) return null;
    for (const s of ['leaf', 'flower', 'spring', 'autumn', 'fruit', 'bare']) { const e = set[s]; if (e && e.w && e.h) return e.w / e.h; }
    return null;
  }
  function drawSprite(ctx, im, x, y, h, alpha) {
    const w = h * im.naturalWidth / im.naturalHeight;
    ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(im, x - w / 2, y - h, w, h); ctx.restore();
    return w;
  }

  /* Draw a plant at image position (x,y) with pixels-per-metre scale. */
  function drawPlant(ctx, p, st, x, y, ppm, seed, opts) {
    opts = opts || {};
    const sizeF = opts.size || 1;
    const w = Math.max(3, p.s * ppm * sizeF), h = Math.max(3, p.h * ppm * sizeF);
    const rnd = mulberry32(seed);
    ctx.save();
    shadowsOff = !!opts.noShadow;
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    /* photo sprites first: crossfade between the two nearest seasonal states */
    if (hasSprites(p) && opts.t != null) {
      const blend = window.Phenology.spriteBlend(p, opts.t);
      const a = resolveSprite(p, blend[0].state), b = resolveSprite(p, blend[1].state);
      const bareA = blend[0].state === 'bare' && !a, bareB = blend[1].state === 'bare' && !b;
      if ((a || bareA) && (b || bareB)) {
        shadow(ctx, x, y, (a || b) ? h * ((a || b).im.naturalWidth / (a || b).im.naturalHeight) : w);
        if (bareA || bareB) { /* no winter photo: draw bare structure procedurally underneath */
          const alpha = bareA ? blend[0].w : blend[1].w;
          ctx.save(); ctx.globalAlpha *= alpha;
          const bareSt = Object.assign({}, st, { leaf: 0, flower: 0, fruit: 0 });
          if (p.type === 'tree') drawTree(ctx, p, bareSt, x, y, w, h, rnd);
          else if (p.type === 'shrub') drawShrub(ctx, p, bareSt, x, y, w, h, rnd);
          else if (p.type === 'climber') drawClimber(ctx, p, bareSt, x, y, w, h, rnd);
          ctx.restore();
        }
        if (a && b && a.im === b.im) drawSprite(ctx, a.im, x, y, h, 1);
        else { if (a) drawSprite(ctx, a.im, x, y, h, blend[0].w); if (b) drawSprite(ctx, b.im, x, y, h, blend[1].w); }
        ctx.restore(); shadowsOff = false;
        return { w, h };
      }
    }
    switch (p.type) {
      case 'tree': drawTree(ctx, p, st, x, y, w, h, rnd); break;
      case 'shrub': drawShrub(ctx, p, st, x, y, w, h, rnd); break;
      case 'climber': drawClimber(ctx, p, st, x, y, w, h, rnd); break;
      case 'perennial': drawPerennial(ctx, p, st, x, y, w, h, rnd); break;
      case 'grass': drawGrass(ctx, p, st, x, y, w, h, rnd); break;
      case 'bulb': drawBulb(ctx, p, st, x, y, w, h, rnd, ppm); break;
    }
    ctx.restore(); shadowsOff = false;
    return { w, h };
  }

  /* Bounding box in image space for hit testing. */
  function bounds(p, x, y, ppm, sizeF) {
    const asp = spriteAspect(p);
    const h = Math.max(12, p.h * ppm * (sizeF || 1));
    const w = asp ? Math.max(12, h * asp) : Math.max(12, p.s * ppm * (sizeF || 1));
    const ww = p.type === 'bulb' && !asp ? Math.max(w * 2.5, ppm * 0.35) : w;
    return { x0: x - ww / 2, x1: x + ww / 2, y0: y - h, y1: y + Math.max(4, ww * 0.12) };
  }

  global.Render = { drawPlant, bounds, mulberry32, hasSprites, api };
})(window);
