/* Netgarden — site checks: sun and shade from the garden's aspect and from placed trees,
 * planting distances, growth with age, regional timing. All deliberately rough. */
(function (global) {
  'use strict';
  const HEADINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  const REGIONS = { south: 0, midlands: 1, north: 2, scotland: 3 }; /* weeks later than the south */
  const MATURITY = { tree: 10, shrub: 5, climber: 4, perennial: 2, grass: 2, bulb: 1 };

  /* fraction of mature size after `years` */
  function growth(p, years) {
    if (years == null || years >= 15) return 1;
    return Math.max(0.15, Math.min(1, Math.pow(years / MATURITY[p.type], 0.7)));
  }

  /* 'full' | 'partial' | 'shade' for a placed plant */
  function exposure(pl, plants, lib, site) {
    let level = 2; /* 2 full, 1 partial, 0 shade */
    /* the back boundary: when the camera faces south-ish, the back fence shades the strip in front of it */
    if (site.heading != null && site.fenceZ != null && pl.Z > site.fenceZ - 2.2) {
      const h = HEADINGS[site.heading];
      if (h >= 135 && h <= 225) level = Math.min(level, 0);
      else if ((h >= 90 && h < 135) || (h > 225 && h <= 270)) level = Math.min(level, 1);
    }
    /* trees cast shade over their spread; the north side of a big tree is shadiest but keep it simple */
    plants.forEach(o => {
      if (o === pl) return; const op = lib[o.pid]; if (!op || op.type !== 'tree' || op.h < 3) return;
      const d = Math.hypot(o.X - pl.X, o.Z - pl.Z), r = op.s * (o.size || 1) / 2;
      if (d < r * 0.8) level = Math.min(level, 0); else if (d < r * 1.3) level = Math.min(level, 1);
    });
    return ['shade', 'partial', 'full'][level];
  }

  function checks(plants, lib, site) {
    const out = [];
    plants.forEach(pl => {
      const p = lib[pl.pid]; if (!p) return;
      const ex = exposure(pl, plants, lib, site);
      if (p.sun === 'full' && ex === 'shade') out.push({ id: pl.id, level: 'warn', text: `${p.name} wants full sun but will be in shade here.` });
      else if (p.sun === 'full' && ex === 'partial') out.push({ id: pl.id, level: 'note', text: `${p.name} prefers more sun than this spot gets.` });
      else if (p.sun === 'shade' && ex === 'full') out.push({ id: pl.id, level: 'warn', text: `${p.name} is a shade plant and may scorch in full sun here.` });
    });
    /* spacing: mature spreads overlapping by more than 40 % */
    for (let i = 0; i < plants.length; i++) for (let j = i + 1; j < plants.length; j++) {
      const a = plants[i], b = plants[j], pa = lib[a.pid], pb = lib[b.pid]; if (!pa || !pb) continue;
      if (pa.type === 'bulb' || pb.type === 'bulb' || pa.type === 'climber' || pb.type === 'climber') continue;
      const d = Math.hypot(a.X - b.X, a.Z - b.Z), need = (pa.s + pb.s) / 2;
      if (d < need * 0.6) out.push({ id: a.id, id2: b.id, level: 'warn', text: `${pa.name} and ${pb.name} are ${d.toFixed(1)} m apart; mature they need about ${need.toFixed(1)} m.` });
    }
    return out;
  }

  global.Site = { HEADINGS, REGIONS, MATURITY, growth, exposure, checks };
})(window);
