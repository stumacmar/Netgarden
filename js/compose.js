/* Netgarden — compositing. Makes a plant sit *in* the photo rather than on it:
 * cast shadow along the sun direction, mirror to face the light, exposure and
 * warmth matched to the photo, distance haze, film grain and a feathered edge. */
(function (global) {
  'use strict';
  const { rgba } = global.Phenology;

  /* ---- reusable scratch canvases ---- */
  const scratch = { plant: document.createElement('canvas'), sil: document.createElement('canvas') };
  /* rendered-plant cache: drawing hundreds of leaves per plant per frame is too slow for a live slider */
  const cache = new Map(); let cachePixels = 0; const MAX_PIXELS = 70e6;
  function cacheGet(key) { const e = cache.get(key); if (e) { cache.delete(key); cache.set(key, e); } return e; }
  function cachePut(key, plant, sil) {
    const px = plant.width * plant.height * 2; cache.set(key, { plant, sil }); cachePixels += px;
    while (cachePixels > MAX_PIXELS && cache.size > 1) { const k = cache.keys().next().value, e = cache.get(k); cachePixels -= e.plant.width * e.plant.height * 2; cache.delete(k); }
  }
  function clone(c) { const d = document.createElement('canvas'); d.width = c.width; d.height = c.height; d.getContext('2d').drawImage(c, 0, 0); return d; }
  let noiseTile = null;
  function noise() {
    if (noiseTile) return noiseTile;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const cx = c.getContext('2d'), img = cx.createImageData(128, 128), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 90; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    cx.putImageData(img, 0, 0);
    noiseTile = c; return c;
  }

  /* Photo statistics for automatic light matching: mean colour of the ground region. */
  function photoStats(img, w, h, horizonY) {
    try {
      const c = document.createElement('canvas'), k = 160 / w;
      c.width = 160; c.height = Math.max(8, Math.round(h * k));
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0, c.width, c.height);
      const y0 = Math.min(c.height - 2, Math.round((horizonY * k) + c.height * 0.05));
      const d = cx.getImageData(0, y0, c.width, c.height - y0).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      r /= n; g /= n; b /= n;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const warmth = (r - b) / Math.max(1, r + b);
      /* sky colour for haze: mean of the top rows */
      const ds = cx.getImageData(0, 0, c.width, Math.max(1, Math.round(c.height * 0.15))).data;
      let sr = 0, sg = 0, sb = 0, sn = 0;
      for (let i = 0; i < ds.length; i += 4) { sr += ds[i]; sg += ds[i + 1]; sb += ds[i + 2]; sn++; }
      return { lum, warmth, haze: [Math.round(sr / sn), Math.round(sg / sn), Math.round(sb / sn)], ok: true };
    } catch (e) { return { lum: 0.42, warmth: 0.12, haze: [200, 210, 225], ok: false }; }
  }

  /* Automatic light settings from the photo stats. */
  function autoLight(stats) {
    return {
      brightness: Math.max(0.7, Math.min(1.3, stats.lum / 0.40)),
      warmth: Math.max(-1, Math.min(1, (stats.warmth - 0.10) * 4)),
      contrast: 1.0,
      saturation: 1.0,
      shadow: 0.45,
      grain: 0.25,
    };
  }

  /* Shadow transform: maps the plant's local billboard (base at origin, top at (0,-H))
   * onto the ground along the sun direction. Returns {sx, sy, kTop} in image pixels. */
  function shadowVector(cam, X, Z, heightM, sun) {
    const el = Math.max(5, Math.min(85, sun.el)) * Math.PI / 180, az = sun.az * Math.PI / 180;
    const L = heightM / Math.tan(el);
    const dX = -Math.sin(az) * L, dZ = Math.cos(az) * L;
    let tz = Z + dZ, tx = X + dX;
    if (tz < 0.4) { const f = (Z - 0.4) / Math.max(1e-6, (Z - tz)); tz = 0.4; tx = X + dX * f; }
    const base = cam.toImage(X, Z), top = cam.toImage(tx, tz);
    return { sx: top.x - base.x, sy: top.y - base.y, kTop: cam.ppm(tx, tz) / cam.ppm(X, Z) };
  }

  /* Draw one placed plant with the full treatment.
   * spec: { p, st, t, seed, size, flip, X, Z, heightM }   env: { cam, sun, light, stats, quality } */
  function drawPlant(ctx, spec, env) {
    const { cam, sun, light } = env;
    const q = cam.toImage(spec.X, spec.Z), ppm = cam.ppm(spec.X, spec.Z);
    const b = global.Render.bounds(spec.p, 0, 0, ppm, spec.size);
    const pad = Math.ceil(Math.max(8, (b.x1 - b.x0) * 0.25));
    const W = Math.ceil(b.x1 - b.x0) + pad * 2, H = Math.ceil(-b.y0) + pad * 2;
    if (W > 4000 || H > 4000) { global.Render.drawPlant(ctx, spec.p, spec.st, q.x, q.y, ppm, spec.seed, { size: spec.size, t: spec.t }); return; }
    const hazeK = Math.max(0, Math.min(0.35, (spec.Z - 6) / 60));
    const sat = light.saturation * (1 - hazeK * 0.6);
    const filt = [`brightness(${light.brightness.toFixed(3)})`, `contrast(${light.contrast.toFixed(3)})`, `saturate(${sat.toFixed(3)})`, env.quality !== 'fast' ? `blur(${(0.25 + hazeK * 1.5).toFixed(2)}px)` : ''].join(' ');
    const blurPx = Math.max(1, ppm * 0.04);
    const key = [spec.p.id, spec.seed, W, H, Math.round(spec.t * 10) / 10, light.grain, light.warmth.toFixed(2), hazeK.toFixed(2), filt, blurPx.toFixed(1), global.Render.hasSprites(spec.p) ? 's' : 'd'].join('|');
    let hit = cacheGet(key), pc, sc;
    if (hit) { pc = hit.plant; sc = hit.sil; }
    else {
      pc = document.createElement('canvas'); pc.width = W; pc.height = H;
      const px = pc.getContext('2d');
      global.Render.drawPlant(px, spec.p, spec.st, W / 2, H - pad, ppm, spec.seed, { size: spec.size, t: spec.t, noShadow: true });
      /* grain + warmth + haze, applied only where the plant is (source-atop) */
      px.save(); px.globalCompositeOperation = 'source-atop';
      if (light.grain > 0) { px.globalAlpha = light.grain * 0.35; px.fillStyle = px.createPattern(noise(), 'repeat'); px.fillRect(0, 0, W, H); }
      if (light.warmth) { px.globalAlpha = Math.abs(light.warmth) * 0.12; px.fillStyle = light.warmth > 0 ? '#ff9a2a' : '#4a7aff'; px.fillRect(0, 0, W, H); }
      if (hazeK > 0.01 && env.stats) { const hz = env.stats.haze; px.globalAlpha = hazeK; px.fillStyle = `rgb(${hz[0]},${hz[1]},${hz[2]})`; px.fillRect(0, 0, W, H); }
      px.restore();
      /* silhouette, pre-blurred for the cast shadow */
      sc = document.createElement('canvas'); sc.width = W; sc.height = H;
      const sx2 = sc.getContext('2d'); sx2.drawImage(pc, 0, 0); sx2.globalCompositeOperation = 'source-in'; sx2.fillStyle = '#0b1408'; sx2.fillRect(0, 0, W, H);
      const sb = document.createElement('canvas'); sb.width = W; sb.height = H; const sbx = sb.getContext('2d'); sbx.filter = `blur(${blurPx}px)`; sbx.drawImage(sc, 0, 0); sc = sb;
      /* bake the exposure match and feather into the plant image */
      const fc = document.createElement('canvas'); fc.width = W; fc.height = H; const fx = fc.getContext('2d'); fx.filter = filt; fx.drawImage(pc, 0, 0); pc = fc;
      cachePut(key, pc, sc);
    }
    const cx = W / 2, cy = H - pad;

    /* cast shadow from the silhouette */
    if (light.shadow > 0 && spec.p.type !== 'climber') {
      const hPx = cy - pad; /* plant height in px at base */
      const heightM = hPx / ppm;
      const v = shadowVector(cam, spec.X, spec.Z, heightM, sun);
      const k = (1 + v.kTop) / 2;
      ctx.save();
      ctx.translate(q.x, q.y);
      if (spec.flip) ctx.scale(-1, 1);
      /* local (u, vv) with vv in [-hPx, 0]:  x' = k u - (sx/hPx) vv ; y' = -(sy/hPx) vv */
      const fx = spec.flip ? -1 : 1;
      ctx.transform(k, 0, -v.sx / hPx * fx, -v.sy / hPx, 0, 0);
      ctx.globalAlpha = light.shadow * (0.9 - 0.4 * Math.min(1, spec.Z / 20));
      ctx.drawImage(sc, -cx, -cy);
      ctx.restore();
    }
    /* contact shadow */
    ctx.save(); ctx.fillStyle = 'rgba(10,20,8,0.35)'; ctx.beginPath();
    ctx.ellipse(q.x, q.y, (b.x1 - b.x0) * 0.42, Math.max(2, (b.x1 - b.x0) * 0.08), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();

    /* the plant (exposure match and feather already baked in) */
    ctx.save(); ctx.translate(q.x, q.y); if (spec.flip) ctx.scale(-1, 1); ctx.drawImage(pc, -cx, -cy); ctx.restore();
  }

  global.Compose = { drawPlant, photoStats, autoLight, shadowVector, clearCache: () => { cache.clear(); cachePixels = 0; } };
})(window);
