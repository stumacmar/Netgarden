/* Netgarden — a small animated GIF encoder (no dependencies).
 * Median-cut palette shared by all frames, light ordered dithering, LZW as in the GIF89a spec.
 *   Gif.encode(frames: ImageData[], delayCs) -> Uint8Array */
(function (global) {
  'use strict';
  /* median cut over sampled pixels -> up to 256 [r,g,b] */
  function palette(frames) {
    const samples = [];
    frames.forEach(f => { const d = f.data; for (let i = 0; i < d.length; i += 4 * 13) samples.push((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); });
    let boxes = [samples];
    const ch = (c, k) => (c >> (16 - 8 * k)) & 255;
    while (boxes.length < 255) {   /* index 255 is kept for 'unchanged since the last frame' */
      let bi = -1, best = -1, bk = 0;
      boxes.forEach((b, i) => { if (b.length < 2) return; for (let k = 0; k < 3; k++) { let lo = 255, hi = 0; for (let j = 0; j < b.length; j += 7) { const v = ch(b[j], k); if (v < lo) lo = v; if (v > hi) hi = v; } const r = (hi - lo) * Math.sqrt(b.length); if (r > best) { best = r; bi = i; bk = k; } } });
      if (bi < 0 || best <= 0) break;
      const b = boxes[bi].sort((x, y) => ch(x, bk) - ch(y, bk)), mid = b.length >> 1;
      boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
    }
    return boxes.filter(b => b.length).map(b => { let r = 0, g = 0, bl = 0; b.forEach(c => { r += c >> 16; g += (c >> 8) & 255; bl += c & 255; }); return [Math.round(r / b.length), Math.round(g / b.length), Math.round(bl / b.length)]; });
  }
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function indexer(pal) {
    const cache = new Int16Array(32768).fill(-1);
    return (r, g, b) => {
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); let v = cache[key]; if (v >= 0) return v;
      const rr = (r & 0xF8) | 4, gg = (g & 0xF8) | 4, bb = (b & 0xF8) | 4; let bd = Infinity;
      for (let i = 0; i < pal.length; i++) { const p = pal[i], d = (p[0] - rr) ** 2 * 2 + (p[1] - gg) ** 2 * 4 + (p[2] - bb) ** 2 * 3; if (d < bd) { bd = d; v = i; } }
      cache[key] = v; return v;
    };
  }
  function Bytes() { let buf = new Uint8Array(1 << 20), n = 0; const grow = (k) => { if (n + k > buf.length) { const nb = new Uint8Array(Math.max(buf.length * 2, n + k)); nb.set(buf.subarray(0, n)); buf = nb; } };
    return { byte(b) { grow(1); buf[n++] = b; }, word(w) { grow(2); buf[n++] = w & 255; buf[n++] = (w >> 8) & 255; }, str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }, bytes(a) { grow(a.length); buf.set(a, n); n += a.length; }, done() { return buf.subarray(0, n); } };
  }
  /* LZW, following the reference sequence: emit the prefix, grow the code size, then add the entry */
  function lzw(out, idx, minSize) {
    const clear = 1 << minSize, eoi = clear + 1; let size = minSize + 1, next = eoi + 1, dict = new Map();
    let acc = 0, bits = 0; const block = []; const flushByte = (b) => { block.push(b); if (block.length === 255) { out.byte(255); out.bytes(block); block.length = 0; } };
    const emit = (code) => { acc |= code << bits; bits += size; while (bits >= 8) { flushByte(acc & 255); acc >>>= 8; bits -= 8; } };
    out.byte(minSize); emit(clear);
    let prefix = idx[0];
    for (let i = 1; i < idx.length; i++) {
      const k = idx[i], key = (prefix << 8) | k, hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next === 4096) { emit(clear); dict = new Map(); next = eoi + 1; size = minSize + 1; }
      else { if (next >= (1 << size)) size++; dict.set(key, next++); }
      prefix = k;
    }
    emit(prefix); emit(eoi); if (bits > 0) flushByte(acc & 255);
    if (block.length) { out.byte(block.length); out.bytes(block); }
    out.byte(0);
  }
  function encode(frames, delayCs) {
    const w = frames[0].width, h = frames[0].height, pal = palette(frames), map = indexer(pal), out = Bytes();
    out.str('GIF89a'); out.word(w); out.word(h); out.byte(0xF7); out.byte(0); out.byte(0);
    for (let i = 0; i < 256; i++) { const p = pal[i] || [0, 0, 0]; out.byte(p[0]); out.byte(p[1]); out.byte(p[2]); }
    out.bytes([0x21, 0xFF, 0x0B]); out.str('NETSCAPE2.0'); out.bytes([3, 1, 0, 0, 0]);
    const TRANSPARENT = 255; let prev = null;
    frames.forEach(f => {
      /* disposal 1 (keep the previous frame) with a transparent index: only what changed is stored */
      out.bytes([0x21, 0xF9, 4, prev ? 0x05 : 0x04]); out.word(delayCs || 25); out.byte(prev ? TRANSPARENT : 0); out.byte(0);
      out.byte(0x2C); out.word(0); out.word(0); out.word(w); out.word(h); out.byte(0);
      const d = f.data, idx = new Uint8Array(w * h);
      for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) { const t = BAYER[((y & 3) << 2) | (x & 3)] - 7.5, j = p * 4; idx[p] = map(Math.max(0, Math.min(255, d[j] + t)), Math.max(0, Math.min(255, d[j + 1] + t)), Math.max(0, Math.min(255, d[j + 2] + t))); }
      if (prev) { const diff = new Uint8Array(idx.length); for (let i = 0; i < idx.length; i++) diff[i] = idx[i] === prev[i] ? TRANSPARENT : idx[i]; lzw(out, diff, 8); }
      else lzw(out, idx, 8);
      prev = idx;
    });
    out.byte(0x3B); return out.done();
  }
  global.Gif = { encode };
})(window);
