/* Netgarden — site profile, plant suitability, sun and spacing checks, design rules,
 * monthly jobs, growth with age. Deliberately rough rules of thumb, labelled as such. */
(function (global) {
  'use strict';
  const HEADINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const REGIONS = { south: 0, midlands: 1, north: 2, scotland: 3 }; /* weeks later than the south */
  const MATURITY = { tree: 10, shrub: 5, climber: 4, perennial: 2, grass: 2, bulb: 1 };
  const DEFAULT_PROFILE = { heading: null, region: 'south', soil: 'unknown', drainage: 'average', ph: 'unknown', exposure: 'sheltered' };

  /* fraction of mature size after `years` */
  function growth(p, years) {
    if (years == null || years >= 15) return 1;
    return Math.max(0.15, Math.min(1, Math.pow(years / MATURITY[p.type], 0.7)));
  }

  /* ---- suitability of a library plant for the site profile ---- */
  function suitability(p, prof) {
    const issues = [];
    if (p.ph === 'acid') {
      if (prof.ph === 'alkaline') issues.push({ level: 'bad', text: 'needs acid soil; yours is alkaline (grow it in a pot of ericaceous compost)' });
      else if (prof.ph === 'neutral') issues.push({ level: 'warn', text: 'prefers acid soil; borderline on neutral ground' });
      else if (prof.ph === 'unknown') issues.push({ level: 'note', text: 'needs acid soil: check your soil pH first' });
    }
    if (p.drain === 'dry' && (prof.drainage === 'wet' || prof.soil === 'clay')) issues.push({ level: prof.drainage === 'wet' ? 'bad' : 'warn', text: 'needs sharp drainage; likely to rot in ' + (prof.drainage === 'wet' ? 'wet ground' : 'heavy clay without grit') });
    if (p.drain === 'moist' && (prof.drainage === 'dry' || prof.soil === 'sand')) issues.push({ level: 'warn', text: 'needs soil that stays moist; will struggle on ' + (prof.soil === 'sand' ? 'sand' : 'dry ground') });
    if (p.tender) {
      const r = prof.region;
      if (r === 'scotland' || r === 'north') issues.push({ level: r === 'scotland' ? 'bad' : 'warn', text: 'borderline hardy this far north; needs a sheltered warm spot or winter protection' });
      else if (prof.exposure === 'exposed') issues.push({ level: 'warn', text: 'borderline hardy in an exposed garden' });
    }
    if (p.sun === 'full' && prof.heading && HEADINGS[prof.heading] === 0 && false) { /* placeholder: handled per placement */ }
    return issues;
  }

  /* why a plant suits the site, in plain words, alongside any problems */
  const SOIL_WORDS = { clay: 'clay', loam: 'loam', sand: 'sandy soil', chalk: 'chalky soil' };
  function explain(p, prof) {
    prof = prof || DEFAULT_PROFILE; const good = [], issues = suitability(p, prof);
    const known = prof.soil !== 'unknown' || prof.drainage !== 'average' || prof.ph !== 'unknown';
    if (p.drain === 'dry' && (prof.drainage === 'dry' || prof.soil === 'sand' || prof.soil === 'chalk')) good.push('likes the free-draining ' + (SOIL_WORDS[prof.soil] || 'ground') + ' you have');
    if (p.drain === 'moist' && (prof.drainage === 'wet' || prof.soil === 'clay' || prof.soil === 'loam')) good.push('happy in soil that holds moisture, like yours');
    if (!p.drain && prof.soil !== 'unknown') good.push('grows in most soils, including ' + (SOIL_WORDS[prof.soil] || 'yours'));
    if (p.ph === 'acid' && prof.ph === 'acid') good.push('suits your acid soil');
    if (!p.ph && prof.ph === 'alkaline') good.push('does not mind lime');
    if (!p.tender && (prof.region === 'north' || prof.region === 'scotland')) good.push('fully hardy, fine this far north');
    if (!p.tender && prof.exposure === 'exposed' && (p.type === 'grass' || p.group === 'hedging' || p.ev)) good.push('tough enough for a windy garden');
    if (!issues.length && !known) good.push('no problems found yet; set soil, drainage and pH in the Photo step for a closer check');
    return { good, issues };
  }

  /* 'full' | 'partial' | 'shade' for a placed plant */
  function exposure(pl, plants, lib, site) {
    let level = 2; /* 2 full, 1 partial, 0 shade */
    /* the back boundary: when the camera faces south-ish, the back fence is on the sunny side and shades the strip in front of it */
    if (site.heading != null && site.fenceZ != null && pl.Z > site.fenceZ - 2.2) {
      const h = HEADINGS[site.heading];
      if (h >= 135 && h <= 225) level = Math.min(level, 0);
      else if ((h >= 90 && h < 135) || (h > 225 && h <= 270)) level = Math.min(level, 1);
    }
    /* trees: shade falls mostly on the side away from the sun; approximate as the north half */
    plants.forEach(o => {
      if (o === pl) return; const op = lib[o.pid]; if (!op || op.type !== 'tree' || op.h < 3) return;
      const d = Math.hypot(o.X - pl.X, o.Z - pl.Z), r = op.s * (o.size || 1) / 2;
      /* north direction in plan: camera heading tells which way +Z points */
      let northBias = 0;
      if (site.heading != null) { const h = HEADINGS[site.heading] * Math.PI / 180; const nX = -Math.sin(h), nZ = Math.cos(h); northBias = ((pl.X - o.X) * nX + (pl.Z - o.Z) * nZ) / Math.max(1e-6, d); }
      const shadeR = r * (0.7 + 0.6 * Math.max(0, northBias)); /* longer on the north side */
      if (d < shadeR * 0.8) level = Math.min(level, 0); else if (d < shadeR * 1.3) level = Math.min(level, 1);
    });
    return ['shade', 'partial', 'full'][level];
  }

  function pointInPoly(X, Z, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.Z > Z) !== (b.Z > Z) && X < (b.X - a.X) * (Z - a.Z) / (b.Z - a.Z) + a.X) inside = !inside;
    }
    return inside;
  }

  function checks(plants, beds, lib, site, prof, dimsOf) {
    const out = [];
    prof = prof || DEFAULT_PROFILE;
    dimsOf = dimsOf || ((pl) => lib[pl.pid]);
    plants.forEach(pl => {
      const p = lib[pl.pid]; if (!p) return;
      const ex = exposure(pl, plants, lib, site);
      if (p.sun === 'full' && ex === 'shade') out.push({ id: pl.id, level: 'warn', kind: 'sun', text: `${p.name} wants full sun but will be in shade here.` });
      else if (p.sun === 'full' && ex === 'partial') out.push({ id: pl.id, level: 'note', kind: 'sun', text: `${p.name} prefers more sun than this spot gets.` });
      else if (p.sun === 'shade' && ex === 'full' && site.heading != null) out.push({ id: pl.id, level: 'warn', kind: 'sun', text: `${p.name} is a shade plant and may scorch in full sun here.` });
      suitability(p, prof).forEach(i => out.push({ id: pl.id, level: i.level === 'bad' ? 'warn' : i.level, kind: 'site', text: `${p.name} ${i.text}.` }));
    });
    /* spacing: mature spreads overlapping by more than 40 %; hedging, bulbs and climbers exempt */
    const exempt = (p) => p.type === 'bulb' || p.type === 'climber' || p.group === 'hedging' || p.group === 'veg' || p.group === 'bedding';
    for (let i = 0; i < plants.length; i++) for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i], b = plants[j], pa = lib[a.pid], pb = lib[b.pid]; if (!pa || !pb || exempt(pa) || exempt(pb)) continue;
      const da = dimsOf(a) || pa, db = dimsOf(b) || pb;
      const d = Math.hypot(a.X - b.X, a.Z - b.Z), need = (da.s + db.s) / 2;
      if (d < need * 0.6) out.push({ id: a.id, id2: b.id, level: 'warn', kind: 'spacing', text: `${pa.name} and ${pb.name} are ${d.toFixed(1)} m apart; mature they need about ${need.toFixed(1)} m.` });
    }
    /* pollination partners for fruit */
    plants.forEach(pl => {
      const p = lib[pl.pid]; if (!p || p.pollination !== 'partner') return;
      const partner = plants.some(o => o !== pl && lib[o.pid] && lib[o.pid].pgroup === p.pgroup && o.pid !== pl.pid);
      if (!partner) out.push({ id: pl.id, level: 'warn', kind: 'pollination', text: `${p.name} needs a different ${p.pgroup} variety nearby to set fruit (a neighbour's tree within 20 m also counts).` });
    });
    return out;
  }

  /* ---- design rules per bed ---- */
  function designRules(plants, beds, lib, prof) {
    const tips = [];
    if (!plants.length) return tips;
    const inBed = (bed) => plants.filter(pl => pointInPoly(pl.X, pl.Z, bed.pts));
    beds.forEach((bed, bi) => {
      const list = inBed(bed); if (list.length < 3) return;
      const label = `Border ${bi + 1}`;
      /* layering: height should rise with distance from the viewer (Z) */
      const zs = list.map(pl => pl.Z), hs = list.map(pl => lib[pl.pid].h);
      const mz = zs.reduce((a, b) => a + b) / zs.length, mh = hs.reduce((a, b) => a + b) / hs.length;
      let cov = 0, vz = 0, vh = 0; zs.forEach((z, i) => { cov += (z - mz) * (hs[i] - mh); vz += (z - mz) ** 2; vh += (hs[i] - mh) ** 2; });
      const corr = vz && vh ? cov / Math.sqrt(vz * vh) : 0;
      if (corr < 0.1 && Math.max(...hs) - Math.min(...hs) > 0.6) tips.push({ level: 'note', text: `${label}: taller plants are not at the back. Put the tallest furthest from where you look from, and step down to the front.` });
      /* evergreen backbone */
      const ev = list.filter(pl => lib[pl.pid].ev).length;
      if (ev / list.length < 0.25) tips.push({ level: 'note', text: `${label}: only ${ev} of ${list.length} plants are evergreen. Around a third gives the border shape in winter.` });
      /* groups of small plants */
      const singles = {};
      list.forEach(pl => { const p = lib[pl.pid]; if ((p.type === 'perennial' || p.type === 'grass' || p.type === 'bulb') && p.s <= 0.8) singles[pl.pid] = (singles[pl.pid] || 0) + 1; });
      const lonely = Object.entries(singles).filter(([, n]) => n === 1).map(([id]) => lib[id].name);
      if (lonely.length) tips.push({ level: 'note', text: `${label}: ${lonely.slice(0, 3).join(', ')}${lonely.length > 3 ? ' and others' : ''} are planted singly. Small plants read better in groups of three or five.` });
      /* repetition */
      if (list.length >= 8 && Object.keys(singles).length + list.filter(pl => lib[pl.pid].type !== 'perennial').length === list.length && new Set(list.map(pl => pl.pid)).size === list.length) tips.push({ level: 'note', text: `${label}: every plant is different. Repeating two or three of them along the border ties it together.` });
    });
    /* whole garden: flowering succession */
    const ids = [...new Set(plants.map(pl => pl.pid))].map(id => lib[id]);
    const quiet = []; for (let m = 1; m <= 12; m++) if (!ids.some(p => p.flower && p.flower.m.includes(m))) quiet.push(m);
    if (quiet.length >= 3) tips.push({ level: 'note', text: `Nothing flowers in ${quiet.length} months of the year. Winter-interest shrubs and early bulbs would fill the gap.` });
    return tips;
  }

  /* ---- jobs this month ---- */
  const GENERIC = {
    tree: { 1: 'Check tree ties and stakes after winter winds.', 11: 'Plant bare-root trees from now until March.' },
    shrub: { 3: 'Mulch around shrubs with compost or bark.', 10: 'Plant new shrubs while the soil is warm.' },
    climber: { 3: 'Tie in climbers to their wires before growth starts.' },
    perennial: { 2: 'Cut back last year\'s dead perennial stems.', 6: 'Stake taller perennials before they flop.', 10: 'Divide congested clumps.' },
    grass: { 2: 'Cut deciduous grasses to the ground; comb out evergreen ones.' },
    bulb: { 9: 'Plant spring bulbs from now until November.', 6: 'Let bulb leaves die down naturally before tidying.' },
  };
  function jobs(plants, lib, month) {
    const out = [], seen = new Set();
    const ids = [...new Set(plants.map(pl => pl.pid))].map(id => lib[id]).filter(Boolean);
    ids.forEach(p => {
      if (p.jobs && p.jobs[month]) out.push({ plant: p.name, text: p.jobs[month] });
      if (p.flower && p.flower.m.length >= 3 && p.flower.m.includes(month) && /rose|dahlia|cosmos|penstemon|geum|scabious|salvia/i.test(p.name + p.latin) && !seen.has('deadhead')) { seen.add('deadhead'); out.push({ plant: '', text: 'Deadhead repeat-flowering plants to keep them going.' }); }
    });
    const types = new Set(ids.map(p => p.type));
    types.forEach(t => { const g = GENERIC[t] && GENERIC[t][month]; if (g) out.push({ plant: '', text: g }); });
    if (month === 7 || month === 8) out.push({ plant: '', text: 'Water new plantings deeply once a week in dry spells.' });
    if (month === 4) out.push({ plant: '', text: 'Feed borders with a general fertiliser as growth starts.' });
    return out;
  }

  global.Site = { HEADINGS, REGIONS, MATURITY, DEFAULT_PROFILE, growth, suitability, explain, exposure, checks, designRules, jobs, pointInPoly };
})(window);
