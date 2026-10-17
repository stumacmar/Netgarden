/* Netgarden — "Render this month": sends the composite to an image model that re-renders
 * the planted areas so they look photographed in place. Everything outside the planting
 * is protected by a mask. Needs the user's own API key (kept in this browser only). */
(function (global) {
  'use strict';

  function fitSize(w, h) {
    /* gpt-image-1 output sizes */
    const portrait = h > w;
    const target = portrait ? { w: 1024, h: 1536 } : (w > h ? { w: 1536, h: 1024 } : { w: 1024, h: 1024 });
    const k = Math.min(target.w / w, target.h / h);
    const dw = Math.round(w * k), dh = Math.round(h * k);
    return { target, k, dx: Math.round((target.w - dw) / 2), dy: Math.round((target.h - dh) / 2), dw, dh };
  }

  /* composite: the scene at photo size; silhouette: the plants alone on transparency (same size);
   * polys: bed polygons [[{x,y}]] in photo px. Editable = plant silhouettes dilated a little, plus beds. */
  function buildInputs(composite, silhouette, polys, photoMean) {
    const w = composite.width, h = composite.height, f = fitSize(w, h);
    const img = document.createElement('canvas'); img.width = f.target.w; img.height = f.target.h;
    const ic = img.getContext('2d');
    ic.fillStyle = photoMean || '#777'; ic.fillRect(0, 0, img.width, img.height);
    ic.drawImage(composite, f.dx, f.dy, f.dw, f.dh);
    const mask = document.createElement('canvas'); mask.width = f.target.w; mask.height = f.target.h;
    const mc = mask.getContext('2d');
    mc.fillStyle = '#000'; mc.fillRect(0, 0, mask.width, mask.height);     /* opaque = keep */
    mc.globalCompositeOperation = 'destination-out';                        /* transparent = edit */
    if (silhouette) {
      /* dilate: draw the silhouette blurred, then threshold by drawing it several times */
      const d = document.createElement('canvas'); d.width = mask.width; d.height = mask.height;
      const dc = d.getContext('2d');
      dc.filter = `blur(${Math.round(mask.width * 0.012)}px)`;
      for (let i = 0; i < 6; i++) dc.drawImage(silhouette, f.dx, f.dy, f.dw, f.dh);
      dc.filter = 'none';
      for (let i = 0; i < 4; i++) dc.drawImage(d, 0, 0);  /* harden the soft edge */
      mc.drawImage(d, 0, 0);
    }
    polys.forEach(poly => { mc.beginPath(); poly.forEach((p, i) => i ? mc.lineTo(f.dx + p.x * f.k, f.dy + p.y * f.k) : mc.moveTo(f.dx + p.x * f.k, f.dy + p.y * f.k)); mc.closePath(); mc.fill(); });
    return { img, mask, fit: f };
  }

  function toBlob(c) { return new Promise(r => c.toBlob(r, 'image/png')); }

  async function render(opts) {
    const { key, composite, silhouette, polys, month, photoMean, quality } = opts;
    const { img, mask, fit } = buildInputs(composite, silhouette, polys, photoMean);
    const prompt = `This is a photograph of a garden with new planting mocked up on it. Re-render only the planting so every plant looks naturally photographed in this garden in ${month}: keep each plant's species, size and position exactly, match the photo's lighting direction, shadows, perspective, colour balance and grain, with realistic foliage, flowers and soil. Keep everything outside the planting identical.`;
    const fd = new FormData();
    fd.append('model', 'gpt-image-1');
    fd.append('prompt', prompt);
    fd.append('image[]', await toBlob(img), 'scene.png');
    fd.append('mask', await toBlob(mask), 'mask.png');
    fd.append('size', `${fit.target.w}x${fit.target.h}`);
    fd.append('quality', quality || 'medium');
    fd.append('n', '1');
    const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
    if (!res.ok) { let msg = res.status + ' ' + res.statusText; try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch (e) { } throw new Error(msg); }
    const j = await res.json();
    const d = j.data && j.data[0];
    const src = d && (d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url);
    if (!src) throw new Error('No image came back.');
    /* crop the padding back off so the result matches the photo */
    const out = await new Promise((resolve, reject) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => resolve(im); im.onerror = reject; im.src = src; });
    const c = document.createElement('canvas'); c.width = composite.width; c.height = composite.height;
    c.getContext('2d').drawImage(out, fit.dx * out.width / fit.target.w, fit.dy * out.height / fit.target.h, fit.dw * out.width / fit.target.w, fit.dh * out.height / fit.target.h, 0, 0, c.width, c.height);
    return { canvas: c, prompt };
  }

  global.RenderAPI = { render, buildInputs, fitSize };
})(window);
