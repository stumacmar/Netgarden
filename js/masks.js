/* Netgarden — foreground occlusion. The user paints things that stand in front of
 * new planting (an existing shrub, a wall, the stone edge) and gives each a distance;
 * the photo is re-drawn through the mask at that depth so plants behind are hidden. */
(function (global) {
  'use strict';
  const SCALE = 0.5;  /* mask resolution relative to the working photo */
  const cache = {};   /* mask id -> { key, canvas (masked photo at full size) } */

  function makeMaskCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.round(w * SCALE); c.height = Math.round(h * SCALE); return c; }

  function paint(mask, x, y, radius, erase) {
    const cx = mask.canvas.getContext('2d');
    cx.save(); cx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(x * SCALE, y * SCALE, radius * SCALE, 0, Math.PI * 2); cx.fill(); cx.restore();
    mask.version = (mask.version || 0) + 1;
  }
  function line(mask, x0, y0, x1, y1, radius, erase) {
    const d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / (radius * 0.4)));
    for (let i = 0; i <= n; i++) paint(mask, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, radius, erase);
  }

  /* photo seen through the mask, cached per mask version */
  function maskedPhoto(mask, photo) {
    const e = cache[mask.id];
    if (e && e.key === mask.version) return e.canvas;
    const c = (e && e.canvas) || document.createElement('canvas'); c.width = photo.w; c.height = photo.h;
    const cx = c.getContext('2d');
    cx.clearRect(0, 0, c.width, c.height);
    cx.drawImage(photo.img, 0, 0, photo.w, photo.h);
    cx.globalCompositeOperation = 'destination-in';
    cx.imageSmoothingEnabled = true;
    cx.drawImage(mask.canvas, 0, 0, photo.w, photo.h);
    cache[mask.id] = { key: mask.version, canvas: c };
    return c;
  }

  function isEmpty(mask) {
    const cx = mask.canvas.getContext('2d'), d = cx.getImageData(0, 0, mask.canvas.width, mask.canvas.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
    return true;
  }

  function serialize(mask) { return { id: mask.id, Z: mask.Z, name: mask.name, data: mask.canvas.toDataURL('image/png') }; }
  function restore(o, w, h) {
    return new Promise((res) => {
      const m = { id: o.id, Z: o.Z, name: o.name, canvas: makeMaskCanvas(w, h), version: 1 };
      if (!o.data) return res(m);
      const im = new Image(); im.onload = () => { m.canvas.getContext('2d').drawImage(im, 0, 0, m.canvas.width, m.canvas.height); res(m); }; im.onerror = () => res(m); im.src = o.data;
    });
  }

  global.Masks = { SCALE, makeMaskCanvas, paint, line, maskedPhoto, isEmpty, serialize, restore };
})(window);
