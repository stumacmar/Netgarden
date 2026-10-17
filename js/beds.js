/* Netgarden — border surfaces. Procedural soil, bark mulch and gravel textures,
 * mapped through the ground-plane perspective so beds look like ground, not paint. */
(function (global) {
  'use strict';
  const TILE = 256;             /* pixels per metre in the texture */
  const tiles = {};

  function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function makeTile(kind) {
    const c = document.createElement('canvas'); c.width = c.height = TILE;
    const x = c.getContext('2d'), r = rnd(kind === 'soil' ? 11 : kind === 'bark' ? 23 : 37);
    const base = { soil: '#4a3524', bark: '#5a3b26', gravel: '#9a948a' }[kind];
    x.fillStyle = base; x.fillRect(0, 0, TILE, TILE);
    const n = kind === 'gravel' ? 2600 : kind === 'bark' ? 900 : 3500;
    /* every speck is drawn at the 4 wrap offsets so the tile repeats seamlessly */
    const wrap = (fn) => { for (const dx of [0, TILE, -TILE]) for (const dy of [0, TILE, -TILE]) { x.save(); x.translate(dx, dy); fn(); x.restore(); } };
    for (let i = 0; i < n; i++) {
      const px = r() * TILE, py = r() * TILE, rot = r() * 3.14, a = r(), b = r();
      if (kind === 'soil') {
        const v = 30 + a * 70, s = 1.5 + b * 4;
        x.fillStyle = `rgba(${v + 25},${v + 5},${v * 0.6},${0.6 + r() * 0.4})`;
        wrap(() => { x.beginPath(); x.ellipse(px, py, s, s * (0.5 + b * 0.6), rot, 0, 7); x.fill(); });
        if (i % 40 === 0) { x.fillStyle = `rgba(${150 + a * 60},${140 + a * 50},${120 + a * 40},0.9)`; wrap(() => { x.beginPath(); x.ellipse(px, py, 1.5 + a * 2, 1 + b * 1.5, rot, 0, 7); x.fill(); }); }
      } else if (kind === 'bark') {
        const v = 50 + a * 90, w = 4 + b * 12, h = 2 + a * 4;
        x.fillStyle = `rgba(${v + 40},${v * 0.7},${v * 0.4},0.95)`;
        wrap(() => { x.save(); x.translate(px, py); x.rotate(rot); x.fillRect(-w / 2, -h / 2, w, h); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(-w / 2, h / 2 - 1, w, 1); x.restore(); });
      } else {
        const v = 110 + a * 120, s = 1.5 + b * 3.5;
        x.fillStyle = `rgba(${v},${v - 5},${v - 12},0.95)`;
        wrap(() => { x.beginPath(); x.ellipse(px, py, s, s * (0.7 + a * 0.5), rot, 0, 7); x.fill(); x.fillStyle = 'rgba(0,0,0,0.2)'; x.beginPath(); x.ellipse(px + 0.6, py + 0.8, s, s * (0.7 + a * 0.5), rot, 0, 7); x.fill(); });
      }
    }
    return c;
  }
  function tile(kind) { return tiles[kind] || (tiles[kind] = makeTile(kind in { soil: 1, bark: 1, gravel: 1 } ? kind : 'soil')); }

  /* Draw a bed polygon (plan coordinates) with its texture mapped through cam. */
  function drawBed(ctx, bed, cam, opts) {
    opts = opts || {};
    const pts = bed.pts.map(p => cam.toImage(p.X, p.Z));
    if (pts.length < 3) return;
    const path = () => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); };
    ctx.save();
    ctx.globalAlpha = opts.alpha == null ? 1 : opts.alpha;
    path(); ctx.clip();
    /* fill cells of the plan-space bounding box with the texture, each cell affine-mapped */
    const tex = tile(bed.surface || 'soil');
    let X0 = Infinity, X1 = -Infinity, Z0 = Infinity, Z1 = -Infinity;
    bed.pts.forEach(p => { X0 = Math.min(X0, p.X); X1 = Math.max(X1, p.X); Z0 = Math.min(Z0, p.Z); Z1 = Math.max(Z1, p.Z); });
    /* cell size is a whole fraction of the tile so no cell ever straddles a tile edge */
    const area = (X1 - X0) * (Z1 - Z0);
    const step = area > 400 ? 1 : area > 60 ? 0.5 : 0.25;
    const gx0 = Math.floor(X0 / step) * step, gz0 = Math.floor(Z0 / step) * step;
    const base = { soil: '#3d2b1c', bark: '#4a2e1c', gravel: '#8a847a' }[bed.surface || 'soil'];
    ctx.fillStyle = base; ctx.fillRect(-1e5, -1e5, 2e5, 2e5);  /* under-colour for any hairline gaps */
    const s = step * TILE;
    for (let Z = gz0; Z < Z1; Z += step) for (let X = gx0; X < X1; X += step) {
      const a = cam.toImage(X, Z + step), b = cam.toImage(X + step, Z + step), c = cam.toImage(X, Z);
      if (!isFinite(a.x) || !isFinite(b.x) || !isFinite(c.x)) continue;
      /* affine map from texture cell (0..s px) to image: origin at the far-left corner */
      const m11 = (b.x - a.x) / s, m12 = (b.y - a.y) / s, m21 = (c.x - a.x) / s, m22 = (c.y - a.y) / s;
      ctx.save(); ctx.transform(m11, m12, m21, m22, a.x, a.y);
      const u = ((Math.round(X / step) % (TILE / s)) + (TILE / s)) % (TILE / s) * s, v = ((Math.round(Z / step) % (TILE / s)) + (TILE / s)) % (TILE / s) * s;
      ctx.drawImage(tex, u, v, s, s, -s * 0.02, -s * 0.02, s * 1.04, s * 1.04);
      ctx.restore();
    }
    /* darker, slightly sunken edge against the lawn */
    const lw = (opts.lineWidth || 2);
    ctx.globalCompositeOperation = 'multiply';
    path(); ctx.strokeStyle = 'rgba(20,14,8,0.8)'; ctx.lineWidth = lw * 6; ctx.filter = `blur(${lw * 2}px)`; ctx.stroke();
    ctx.restore();
    ctx.save(); path(); ctx.strokeStyle = 'rgba(25,18,10,0.55)'; ctx.lineWidth = lw; ctx.stroke(); ctx.restore();
  }

  global.Beds = { drawBed, tile };
})(window);
