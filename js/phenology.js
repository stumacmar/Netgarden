/* Netgarden — seasonal state engine.
 * Turns a plant's library record into a visual state for any point in the year.
 * Time is continuous: t in [0,12), where 0 = 1 January, 5.5 = mid June.
 * Each month's record describes the plant at the MIDDLE of that month; the
 * slider interpolates between neighbouring months so transitions are smooth. */
(function (global) {
  'use strict';

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* --- colour helpers --- */
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex([r, g, b]) {
    return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }
  function mixHex(a, b, f) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f]);
  }
  function shade(hex, f) { /* f<0 darker, f>0 lighter */
    const [r, g, b] = hexToRgb(hex);
    return f < 0 ? rgbToHex([r * (1 + f), g * (1 + f), b * (1 + f)]) : rgbToHex([r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f]);
  }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  const STRAW = '#c9b67a';
  const DULL = '#8a8a4a';
  const DIEBACK = '#b8b06a';

  /* deciduous woody profile built from leafOut / leafFall (defaults April / November) */
  function woodyProfile(p, m, base, autumn) {
    const out = p.leafOut || 4, fall = p.leafFall || 11;
    const inSeason = (x) => (out <= fall ? (x >= out && x <= fall) : (x >= out || x <= fall));
    if (!inSeason(m)) return { d: 0, c: base };
    if (m === out) return { d: 0.5, c: p.flush ? p.flush : base };
    if (m === (out % 12) + 1 && p.flush) return { d: 1, c: mixHex(p.flush, base, 0.6) };
    if (m === fall) return { d: 0.35, c: autumn };
    if (m === ((fall - 2 + 12) % 12) + 1) return { d: 1, c: autumn };
    return { d: 1, c: base };
  }

  /* Leaf density + colour for month m (1..12). */
  function leafAt(p, m) {
    const base = p.leaf;
    if (p.ev) {
      if (p.flush && (m === 4 || m === 5)) return { d: 1, c: m === 4 ? p.flush : mixHex(p.flush, base, 0.6) };
      return { d: 1, c: base };
    }
    if (p.leafMonths) {
      const i = p.leafMonths.indexOf(m);
      if (i < 0) return { d: 0, c: base };
      const first = i === 0, last = i === p.leafMonths.length - 1;
      if (last && p.autumn) return { d: 0.8, c: p.autumn };
      if (last && p.type === 'bulb') return { d: 0.6, c: DIEBACK };
      return { d: first ? 0.6 : 1, c: base };
    }
    const autumn = p.autumn || DULL;
    switch (p.type) {
      case 'tree': case 'shrub': case 'climber': return woodyProfile(p, m, base, autumn);
      case 'perennial': {
        const tbl = { 3: [0.3, base], 4: [0.7, base], 5: [1, base], 6: [1, base], 7: [1, base], 8: [1, base], 9: [1, base], 10: [0.8, p.autumn || base], 11: [0.3, DULL] };
        const v = tbl[m]; return v ? { d: v[0], c: v[1] } : { d: 0, c: base };
      }
      case 'grass': {
        const straw = p.autumn || STRAW;
        const tbl = { 3: [0.4, mixHex(straw, base, 0.5)], 4: [0.8, base], 5: [1, base], 6: [1, base], 7: [1, base], 8: [1, base], 9: [1, base], 10: [1, mixHex(base, straw, 0.5)], 11: [1, straw], 12: [0.7, straw], 1: [0.6, straw], 2: [0.5, straw] };
        const v = tbl[m]; return v ? { d: v[0], c: v[1] } : { d: 0, c: base };
      }
      case 'bulb': {
        /* leaves appear a month before flowering, die back yellow a month after */
        const fm = p.flower ? p.flower.m : [];
        const before = new Set(fm.map(x => ((x - 2 + 12) % 12) + 1)), after = new Set(fm.map(x => (x % 12) + 1));
        if (fm.includes(m)) return { d: 1, c: base };
        if (after.has(m)) return { d: 0.6, c: DIEBACK };
        if (before.has(m)) return { d: 0.6, c: base };
        return { d: 0, c: base };
      }
    }
    return { d: 1, c: base };
  }

  function monthState(p, m) {
    const leaf = leafAt(p, m);
    const fl = p.flower && p.flower.m.includes(m) ? (p.peak ? (p.peak.includes(m) ? 1 : 0.5) : 1) : 0;
    const fr = p.fruit && p.fruit.m.includes(m) ? 1 : 0;
    return {
      leaf: leaf.d, leafColor: leaf.c,
      flower: fl, flowerColor: p.flower ? p.flower.c : null,
      fruit: fr, fruitColor: p.fruit ? p.fruit.c : null,
      bare: p.bare || (p.type === 'tree' ? '#6b5a48' : '#7a6a58'),
    };
  }

  /* Continuous state at t in [0,12). */
  function stateAt(p, t) {
    t = ((t % 12) + 12) % 12;
    const centre = t - 0.5; /* month records sit at mid-month */
    const i0 = Math.floor(((centre % 12) + 12) % 12), f = ((centre % 12) + 12) % 12 - i0;
    const a = monthState(p, i0 + 1), b = monthState(p, (i0 + 1) % 12 + 1);
    const lerp = (x, y) => x + (y - x) * f;
    const leaf = lerp(a.leaf, b.leaf);
    let leafColor = a.leafColor;
    if (a.leaf > 0 && b.leaf > 0) leafColor = mixHex(a.leafColor, b.leafColor, f);
    else if (b.leaf > 0 && a.leaf === 0) leafColor = b.leafColor;
    return {
      leaf, leafColor,
      flower: lerp(a.flower, b.flower), flowerColor: a.flowerColor,
      fruit: lerp(a.fruit, b.fruit), fruitColor: a.fruitColor,
      bare: a.bare,
    };
  }

  /* Which photo sprite best shows month m: flower | fruit | autumn | spring | leaf | bare */
  function spriteLabel(p, m) {
    const s = monthState(p, m);
    if (s.flower > 0) return 'flower';
    if (s.fruit > 0) return 'fruit';
    if (s.leaf <= 0) return 'bare';
    if (s.leafColor !== p.leaf) return 'autumn';
    if (s.leaf < 1 && !p.ev) return 'spring';
    return 'leaf';
  }
  /* Two sprite states with crossfade weights at continuous time t. */
  function spriteBlend(p, t) {
    t = ((t % 12) + 12) % 12;
    const centre = ((t - 0.5) % 12 + 12) % 12;
    const i0 = Math.floor(centre), f = centre - i0;
    return [{ state: spriteLabel(p, i0 + 1), w: 1 - f }, { state: spriteLabel(p, (i0 + 1) % 12 + 1), w: f }];
  }

  function label(t) {
    const m = Math.floor(t) % 12, f = t - Math.floor(t);
    const part = f < 0.33 ? 'Early' : f < 0.66 ? 'Mid' : 'Late';
    return `${part} ${MONTHS[m]}`;
  }

  /* Summary rows for the calendar: 12 entries per plant. */
  function yearRow(p) {
    const out = [];
    for (let m = 1; m <= 12; m++) out.push(monthState(p, m));
    return out;
  }

  global.Phenology = { MONTHS, SHORT, stateAt, monthState, yearRow, label, spriteLabel, spriteBlend, mixHex, shade, rgba, hexToRgb };
})(window);
