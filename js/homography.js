/* Netgarden — ground-plane perspective maths.
 * A homography maps plan coordinates (metres, top-down) to photo pixels.
 * Built from four user-marked corners of a real-world rectangle on the lawn. */
(function (global) {
  'use strict';

  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const p = M[c][c];
      if (Math.abs(p) < 1e-12) return null;
      for (let k = c; k <= n; k++) M[c][k] /= p;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(row => row[n]);
  }

  function invert3(h) {
    const [a, b, c, d, e, f, g, hh, i] = h;
    const A = e * i - f * hh, B = -(d * i - f * g), C = d * hh - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [
      A / det, -(b * i - c * hh) / det, (b * f - c * e) / det,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
      C / det, -(a * hh - b * g) / det, (a * e - b * d) / det,
    ];
  }

  /* src: 4 plan points [{u,v}], dst: 4 image points [{x,y}] */
  function fromPoints(src, dst) {
    const A = [], b = [];
    for (let k = 0; k < 4; k++) {
      const { u, v } = src[k], { x, y } = dst[k];
      A.push([u, v, 1, 0, 0, 0, -x * u, -x * v]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -y * u, -y * v]); b.push(y);
    }
    const h = solveLinear(A, b);
    if (!h) return null;
    const H = h.concat([1]);
    const inv = invert3(H);
    return { H, inv };
  }

  function apply(h, u, v) {
    const w = h[6] * u + h[7] * v + h[8];
    return { x: (h[0] * u + h[1] * v + h[2]) / w, y: (h[3] * u + h[4] * v + h[5]) / w };
  }

  /* Ground object: created from quad corners + real width/depth in metres. */
  function makeGround(corners, widthM, depthM) {
    const src = [{ u: 0, v: 0 }, { u: widthM, v: 0 }, { u: widthM, v: depthM }, { u: 0, v: depthM }];
    const hom = fromPoints(src, corners);
    if (!hom) return null;
    return {
      widthM, depthM, corners,
      toImage(u, v) { return apply(hom.H, u, v); },
      toPlan(x, y) { const p = apply(hom.inv, x, y); return { u: p.x, v: p.y }; },
      /* approximate pixels per metre at a plan point (horizontal) */
      pxPerMetre(u, v) {
        const a = apply(hom.H, u - 0.5, v), b = apply(hom.H, u + 0.5, v);
        return Math.hypot(b.x - a.x, b.y - a.y);
      },
    };
  }

  global.Homography = { fromPoints, apply, makeGround };
})(window);
