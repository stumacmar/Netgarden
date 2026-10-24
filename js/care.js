/* Netgarden — care calendar.
 * Turns the plants in a design into a year of jobs: pruning, cutting back, deadheading, feeding,
 * mulching, watering, staking, dividing, sowing, planting, harvesting, protecting and pest watch.
 * Hand-written jobs in plants.js always win; everything else is derived from what the library
 * knows about each plant (type, flowering and fruiting months, evergreen, hardiness, soil needs),
 * following standard UK practice. Timings are for southern England; frost-tied jobs move a month
 * later in the north and Scotland.
 *   Care.forPlants(placed, lib, profile, years) -> [{ m, kind, text, why, pids: [] }]
 *   Care.forPlant(p, profile, years)            -> the same, for one library plant */
(function (global) {
  'use strict';
  const KINDS = {
    prune: 'Prune', trim: 'Trim', cut: 'Cut back', deadhead: 'Deadhead', feed: 'Feed', mulch: 'Mulch', water: 'Water',
    support: 'Support', divide: 'Divide', sow: 'Sow', plant: 'Plant', harvest: 'Harvest', protect: 'Protect', pests: 'Pests', tidy: 'Tidy',
  };
  const ORDER = Object.keys(KINDS);
  const wrapM = (m) => ((m - 1 + 12) % 12) + 1;

  /* first and last month of a run of months that may wrap the new year (e.g. Dec–Feb) */
  function span(ms) {
    if (!ms || !ms.length) return null;
    const set = new Set(ms); if (set.size === 12) return { first: 1, last: 12, months: [...set] };
    let first = ms.find(m => !set.has(wrapM(m - 1))) || Math.min(...ms), last = first;
    while (set.has(wrapM(last + 1)) && wrapM(last + 1) !== first) last = wrapM(last + 1);
    return { first, last, months: [...set] };
  }
  const is = (p, re) => re.test(p.latin + ' ' + p.name);
  const genus = (p) => (p.latin || '').split(/[\s']/)[0].toLowerCase();
  const EDIBLE_FRUIT = /^(malus domestica|pyrus|prunus domestica|prunus avium|prunus cerasus|prunus persica|ficus|vitis|ribes|rubus|fragaria|vaccinium|cydonia|mespilus|actinidia|morus)/i;
  const SEEDHEADS = /echinacea|sedum|hylotelephium|echinops|eryngium|rudbeckia|phlomis|allium|achillea|verbena|agastache|cirsium|astrantia|aster|symphyotrichum/i;
  const CHELSEA = /sedum|hylotelephium|echinacea|aster|symphyotrichum|phlox|helenium|rudbeckia|nepeta|solidago|monarda|eupatorium|achillea/i;
  const NO_DIVIDE = /paeonia|helleborus|eryngium|euphorbia|acanthus|lupinus|papaver|baptisia|dictamnus|gypsophila|digitalis|alchemilla|verbena/i;
  const SLUG_BAIT = /hosta|delphinium|lupinus|dahlia|ligularia|lactuca|lettuce|helianthus|sunflower|zinnia|tagetes|marigold|clematis|lilium/i;
  const BLEEDERS = /^(acer|betula|juglans|vitis|aesculus)/i;
  const SELF_CLINGING = /hedera|parthenocissus|hydrangea (anomala|petiolaris)|schizophragma/i;
  const PERENNIAL_VEG = /rhubarb|asparagus|artichoke|strawberr/i;

  /* a few crops need their own words */
  const SPECIFIC = {
    asparagus: [[5, 'harvest', 'Cut asparagus spears when 15–20 cm tall, just below the soil.', 'Only from the third year after planting, so the crowns build up first.'], [6, 'harvest', 'Stop cutting asparagus by the middle of June.', 'The ferny growth that follows feeds next year\'s spears.'], [10, 'cut', 'Cut yellowed asparagus ferns to the ground and mulch.', '']],
    'globe-artichoke': [[6, 'harvest', 'Cut artichoke heads while the scales are still tight.', 'Once the scales open the heart turns tough.'], [11, 'protect', 'Mulch artichoke crowns with straw for the winter.', 'Young crowns can be lost in a hard frost.']],
    rhubarb: [[4, 'harvest', 'Pull rhubarb stems by twisting them off at the base.', 'Leave at least a third of the stems so the crown keeps its strength.'], [7, 'harvest', 'Stop pulling rhubarb for the year.', 'The crown needs the rest of summer to recover.']],
    tomato: [[7, 'trim', 'Pinch out side shoots of cordon tomatoes each week.', 'It sends the plant\'s energy into fruit rather than leaves.'], [7, 'feed', 'Feed tomatoes weekly with tomato feed once the first fruits set.', 'High-potash feed keeps the fruit coming.'], [8, 'trim', 'Stop tomato plants by pinching out the tip above the fourth or fifth truss.', 'Late fruit will not ripen before the cold.']],
    courgette: [[7, 'feed', 'Feed courgettes weekly with tomato feed once they start cropping.', ''], [7, 'harvest', 'Pick courgettes every couple of days, at 10–15 cm.', 'Left on, they turn into marrows and the plant stops producing.']],
    cucumber: [[7, 'feed', 'Feed cucumbers weekly with tomato feed once they flower.', '']],
    'sweet-pea': [[4, 'trim', 'Pinch out sweet pea tips above the third pair of leaves.', 'It makes bushier plants with more flowering stems.'], [6, 'deadhead', 'Pick sweet peas every few days.', 'If pods form, the plant stops flowering.']],
    potato: [[6, 'tidy', 'Earth up potatoes, drawing soil over the shoots.', 'Tubers exposed to light turn green and poisonous.'], [7, 'harvest', 'Lift early potatoes when the flowers open; maincrop when the leaves yellow.', '']],
    onion: [[8, 'harvest', 'Lift onions when the leaves yellow and flop, and dry them in the sun.', '']],
    garlic: [[7, 'harvest', 'Lift garlic when the lower leaves turn yellow.', '']],
    leek: [[11, 'harvest', 'Lift leeks as needed through the winter.', 'They stand happily in the ground until spring.']],
    basil: [[7, 'trim', 'Pinch out basil tips and any flower buds.', 'Keeps it bushy and full of leaves.']],
    mint: [[4, 'plant', 'Keep mint in a pot, even when it is sunk in the border.', 'Its roots run and will take over a bed.']],
    lavender: [],
  };

  function forPlant(p, prof, years) {
    prof = prof || {}; const out = [], add = (m, kind, text, why, key) => out.push({ m: wrapM(m), kind, text, why: why || '', key: key || (kind + '|' + text) });
    const late = (prof.region === 'north' || prof.region === 'scotland') ? 1 : 0;
    const fl = span(p.flower && p.flower.m), fr = span(p.fruit && p.fruit.m), lv = span(p.leafMonths);
    const explicit = p.jobs || {}, exText = Object.values(explicit).join(' ').toLowerCase();
    const hasEx = (re) => re.test(exText);
    Object.entries(explicit).forEach(([m, text]) => {
      const t = text.toLowerCase(), kind = /plant|sow/.test(t) ? (/sow/.test(t) ? 'sow' : 'plant') : /deadhead/.test(t) ? 'deadhead' : /trim|clip|shear/.test(t) ? 'trim' : /cut .*(ground|down|back)|coppice/.test(t) ? 'cut' : /prune|cut/.test(t) ? 'prune' : /stake/.test(t) ? 'support' : /slug|net/.test(t) ? 'pests' : /lift|mulch deeply/.test(t) ? 'protect' : /divide/.test(t) ? 'divide' : /force/.test(t) ? 'harvest' : 'tidy';
      add(+m, kind, text, '', 'own|' + text);
    });
    const exPrune = hasEx(/prune|cut|trim|clip|shear|coppice/);
    const role = p.role, g = genus(p), edibleFruit = EDIBLE_FRUIT.test(p.latin) || (role === 'veg' && fr);
    const annual = (role === 'veg' && !PERENNIAL_VEG.test(p.id + p.name)) || role === 'bedding' || (role === 'herb' && p.leafMonths && !p.ev);
    (SPECIFIC[p.id] || []).forEach(([m, kind, text, why]) => add(m, kind, text, why, 'spec|' + p.id + '|' + m + '|' + kind));

    /* ---- annual crops and bedding: sow, plant out, harvest, clear ---- */
    if (annual && lv) {
      const autumnStart = lv.first >= 8;
      if (!hasEx(/sow|plant/)) {
        if (p.tender) { add(lv.first - 2, 'sow', 'Sow indoors on a warm windowsill.', 'It needs a head start; seedlings cannot go out until frosts are over.', 'sow-in'); add(lv.first + late, 'plant', 'Plant out once all risk of frost has passed.', late ? 'Frosts linger later this far north.' : 'Usually from late May in the south.', 'plant-out'); }
        else if (autumnStart) add(lv.first, 'plant', 'Plant out for flowers next spring.', 'Plants set out in autumn root in before winter.', 'plant-bien');
        else add(lv.first - 1 + (lv.first <= 5 ? late : 0), 'sow', 'Sow outdoors where it is to grow, or in modules to plant out.', '', 'sow-out');
      }
      if (role === 'veg' || role === 'herb') {
        if (fr) fr.months.forEach(m => add(m, 'harvest', 'Pick as it ripens.', 'Regular picking keeps plants producing.', 'pick'));
        else if (!SPECIFIC[p.id] || !SPECIFIC[p.id].some(s => s[1] === 'harvest')) { const L = lv.months.length; const start = wrapM(lv.first + Math.max(1, Math.floor(L / 2))); for (let k = 0, m = start; k < Math.max(1, Math.ceil(L / 2)); k++, m = wrapM(m + 1)) add(m, 'harvest', role === 'herb' ? 'Pick leaves often.' : 'Harvest as it is ready.', role === 'herb' ? 'Picking keeps it bushy; flowering makes leaves bitter.' : '', role === 'herb' ? 'pick-herb' : 'harvest-veg'); }
      }
      if (role === 'bedding' && fl && fl.months.length >= 2) fl.months.slice(0, -1).forEach(m => add(m, 'deadhead', 'Deadhead fading flowers.', 'It keeps the plants flowering instead of setting seed.', 'deadhead'));
      if (!autumnStart && lv.last >= 9) add(lv.last + 1, 'tidy', role === 'veg' ? 'Clear finished crops and add them to the compost.' : 'Clear spent bedding to the compost heap.', '', 'clear');
      if (p.tender || /tomato|courgette|cucumber|squash|sweetcorn/.test(p.id)) add(7, 'water', 'Water every day or two in warm weather.', 'Irregular watering causes split fruit and blossom end rot.', 'water-crops');
      return finish(out, p, prof, years, late, true);
    }

    /* ---- pruning and cutting back, by type ---- */
    if (!exPrune) {
      if (p.type === 'tree') {
        if (edibleFruit && /^(malus|pyrus)/i.test(p.latin)) add(1, 'prune', 'Winter-prune while dormant: take out crossing branches and shorten new growth by a third.', 'Winter pruning shapes the tree and encourages fruiting spurs.', 'prune-pome');
        else if (/^prunus/i.test(p.latin)) add(7, 'prune', 'Prune only in summer, and only if needed.', 'Cherries and plums cut in winter are open to silver leaf and canker.', 'prune-prunus');
        else if (/^magnolia/i.test(p.latin)) add(7, 'prune', 'Prune in midsummer, if at all.', 'Magnolias heal best when in full leaf and resent hard pruning.', 'prune-magnolia');
        else if (BLEEDERS.test(p.latin)) add(12, 'prune', 'Remove dead, damaged or crossing branches in early winter.', 'It bleeds sap if cut in late winter and spring.', 'prune-bleeder');
        else if (p.ev) add(5, 'trim', 'Trim to shape once hard frosts are over.', 'New growth after a late trim is soft and frost-tender.', 'trim-ev');
        else add(1, 'prune', 'Remove dead, damaged or crossing branches while it is dormant.', 'With the leaves off you can see the framework.', 'prune-tree');
      } else if (p.type === 'shrub') {
        if (role === 'hedging' || p.group === 'hedging') add(8, 'trim', 'Trim the hedge in late summer.', 'Waiting until birds have finished nesting; disturbing an active nest is an offence.', 'trim-hedge');
        else if (/^rosa\b/i.test(p.latin)) add(2, 'prune', 'Prune roses by a third, cutting to an outward-facing bud.', 'Late winter, just before growth starts.', 'prune-rose');
        else if (fl && !p.ev && fl.last <= 6 && fl.first >= 2) add(fl.last + 1, 'prune', 'Prune right after flowering, cutting flowered stems back to strong new shoots.', 'It flowers on last year\'s stems, so later pruning cuts off next year\'s flowers.', 'prune-after-fl');
        else if (fl && !p.ev && fl.first >= 7) add(3, 'prune', 'Cut back hard to a low framework.', 'It flowers on the new stems it makes this year.', 'prune-hard');
        else if (fl && p.ev && fl.last <= 7) add(fl.last + 1, 'trim', 'Trim lightly after flowering to keep it compact.', 'Never cut into old bare wood; it rarely regrows.', 'trim-after-fl');
        else if (p.ev) add(5, 'trim', 'Trim to shape once hard frosts are over.', 'New growth after a late trim is soft and frost-tender.', 'trim-ev');
        else add(2, 'prune', 'Remove dead, damaged or crossing stems.', 'Late winter, before the buds break.', 'prune-shrub');
      } else if (p.type === 'climber') {
        if (/^clematis/i.test(p.latin)) {
          if (fl && fl.last <= 5) add(fl.last + 1, 'prune', 'Trim after flowering only if it has outgrown its space.', 'Early clematis flower on old growth.', 'prune-clem1');
          else if (fl && fl.first >= 7) add(2, 'prune', 'Cut all stems down to 30 cm above a pair of buds.', 'Late clematis flower on this year\'s growth.', 'prune-clem3');
          else add(2, 'prune', 'Lightly prune, removing dead stems and cutting back to fat buds.', 'Mid-season clematis flower on both old and new growth.', 'prune-clem2');
        } else if (SELF_CLINGING.test(p.latin)) add(8, 'trim', 'Trim back from windows, gutters and roof tiles.', '', 'trim-cling');
        else if (/^rosa\b/i.test(p.latin)) add(2, 'prune', 'Prune climbing roses: tie in main stems, shorten side shoots to three buds.', '', 'prune-climb-rose');
        else if (fl && fl.last <= 6) add(fl.last + 1, 'prune', 'Prune after flowering, removing some of the oldest stems.', 'It flowers on last year\'s growth.', 'prune-after-fl');
        if (!SELF_CLINGING.test(p.latin)) add(6, 'support', 'Tie in new shoots to the wires or trellis.', 'Shoots trained sideways flower more than ones growing straight up.', 'tie-in');
      } else if (p.type === 'grass') {
        if (p.ev) add(3, 'tidy', 'Comb out dead leaves with gloved fingers.', 'Evergreen grasses sulk if cut to the ground.', 'comb-grass');
        else add(2, 'cut', 'Cut to the ground before new shoots appear.', 'Leaving it standing over winter gives structure and shelter for insects.', 'cut-grass');
      } else if (p.type === 'perennial' && role !== 'herb') {
        if (role === 'fern') add(p.ev ? 3 : 2, 'cut', 'Cut away last year\'s fronds before the new ones unfurl.', '', 'cut-fern');
        else if (p.ev) add(3, 'tidy', 'Tidy away tatty or winter-damaged leaves.', '', 'tidy-ev');
        else if ((fl && fl.first >= 7) || SEEDHEADS.test(p.latin + ' ' + p.name)) add(2, 'cut', 'Cut last year\'s stems down to the ground.', 'Left standing over winter they feed birds and shelter insects.', 'cut-late');
        else add(11, 'cut', 'Cut back to the ground once the leaves yellow.', '', 'cut-autumn');
      } else if (role === 'herb' && p.type === 'perennial' && !p.ev) add(10, 'cut', 'Cut back old stems once they die down.', '', 'cut-herb');
    }

    /* ---- flowering care ---- */
    if (fl && fl.months.length >= 3 && (p.type === 'perennial' || /^rosa\b/i.test(p.latin)) && role !== 'herb' && role !== 'veg' && !SEEDHEADS.test(p.latin + ' ' + p.name) && !hasEx(/deadhead|shear/))
      fl.months.slice(0, -1).forEach(m => add(m, 'deadhead', 'Deadhead to keep the flowers coming.', 'Removing faded flowers stops seed setting, so the plant makes more buds.', 'deadhead'));
    if (p.type === 'perennial' && fl && fl.first >= 7 && p.h >= 0.5 && p.h <= 1.6 && CHELSEA.test(p.latin + ' ' + p.name)) add(5, 'trim', 'Chelsea chop: cut a third of the stems back by half in late May.', 'Gives sturdier plants that need no staking and flower a little later and longer.', 'chelsea');
    if (p.type === 'perennial' && p.h >= 1.2 && role !== 'veg' && !hasEx(/stake/)) add(fl && fl.first <= 6 ? 4 : 5, 'support', 'Put supports in place before the stems need them.', 'Tall stems flop in summer rain; supports put in early are hidden by the leaves.', 'stake');
    if (p.type === 'perennial' && role !== 'fern' && role !== 'veg' && role !== 'herb' && !NO_DIVIDE.test(p.latin) && !hasEx(/divide/)) add(fl && fl.last <= 5 ? 9 : 3, 'divide', 'Divide every three or four years, when the centre starts to die out.', fl && fl.last <= 5 ? 'Spring flowerers are best divided in early autumn.' : 'Divide as growth starts; replant the young outer pieces.', 'divide');

    /* ---- bulbs ---- */
    if (p.type === 'bulb') {
      if (fl && fl.first <= 5) {
        if (/^tulipa/i.test(p.latin)) add(11, 'plant', 'Plant tulip bulbs, 15 cm deep.', 'Planting in November avoids tulip fire disease.', 'plant-tulip');
        else if (/^galanthus/i.test(p.latin)) add(3, 'plant', 'Plant or divide snowdrops "in the green", just after flowering.', 'Dry snowdrop bulbs often fail; moved in leaf they establish quickly.', 'plant-snowdrop');
        else add(9, 'plant', 'Plant spring bulbs at three times their own depth.', '', 'plant-bulbs-autumn');
      } else add(4, 'plant', 'Plant summer bulbs once the soil warms.', '', 'plant-bulbs-spring');
      if (fl) add(fl.last + 1, 'tidy', 'Let the leaves die down naturally for six weeks before tidying.', 'The leaves feed next year\'s flowers.', 'bulb-leaves');
      if (fl && !/^allium/i.test(p.latin)) add(fl.last, 'feed', 'Deadhead and give a potash feed as flowers fade.', 'Builds up the bulb for next year.', 'bulb-feed');
    }

    /* ---- fruit ---- */
    if (edibleFruit && fr) {
      fr.months.forEach(m => add(m, 'harvest', 'Pick the fruit as it ripens.', '', 'pick-fruit'));
      add(2, 'feed', 'Scatter sulphate of potash round fruit trees and bushes.', 'Potash encourages flowers and fruit.', 'potash');
      if (/^(malus|pyrus|prunus domestica)/i.test(p.latin)) add(6, 'tidy', 'Thin the fruit after the June drop to one or two per cluster.', 'Fewer, bigger fruit, and the tree does not exhaust itself.', 'thin-fruit');
      if (/^(prunus avium|prunus cerasus|ribes|fragaria|vaccinium|rubus)/i.test(p.latin)) add(fr.first - 1 < 1 ? fr.first : fr.first, 'pests', 'Net the fruit against birds.', '', 'net');
      if (/^ribes (rubrum|uva-crispa)/i.test(p.latin) && !exPrune) add(1, 'prune', 'Shorten side shoots to one bud and remove a quarter of the oldest stems.', '', 'prune-currant');
      if (/^vaccinium/i.test(p.latin) && !exPrune) add(2, 'prune', 'Cut out a few of the oldest, least fruitful stems.', '', 'prune-blueberry');
    }
    return finish(out, p, prof, years, late);
  }

  /* jobs shared by many plants: feeding, mulching, watering, protection, pests */
  function finish(out, p, prof, years, late, annual) {
    const add = (m, kind, text, why, key) => out.push({ m: wrapM(m), kind, text, why: why || '', key: key || (kind + '|' + text) });
    const rose = /^rosa\b/i.test(p.latin);
    if (rose) { add(3, 'feed', 'Feed roses with rose fertiliser as growth starts.', '', 'feed-rose'); add(7, 'feed', 'Feed roses again after the first flush of flowers.', '', 'feed-rose-2'); add(11, 'pests', 'Clear fallen rose leaves.', 'Black spot overwinters on them.', 'rose-leaves'); }
    if (p.ph === 'acid') { add(4, 'feed', 'Feed with ericaceous fertiliser.', 'Acid-loving plants turn yellow on ordinary feeds.', 'feed-acid'); add(3, 'mulch', 'Mulch with pine bark or ericaceous compost.', '', 'mulch-acid'); add(7, 'water', 'Water with rainwater in dry spells.', 'Tap water is often limy, which acid-lovers dislike.', 'water-rain'); }
    if (p.drain === 'moist') add(7, 'water', 'Water well in dry spells; it hates drying out.', '', 'water-moist');
    if (p.tender && !annual) { add(11 - late, 'protect', 'Protect from frost: wrap in fleece, mulch the base, or move pots somewhere sheltered.', '', 'protect'); add(4 + late, 'protect', 'Take off winter protection once hard frosts are over.', '', 'unprotect'); }
    if (SLUG_BAIT.test(p.latin + ' ' + p.name)) add(4, 'pests', 'Protect young shoots from slugs and snails.', 'Wool pellets, copper or a night-time torch patrol all help.', 'slugs');
    if (/^buxus/i.test(p.latin)) add(6, 'pests', 'Check box for box tree caterpillar webbing.', '', 'box-caterpillar');
    if (/^lilium/i.test(p.latin)) add(5, 'pests', 'Look for red lily beetles and pick them off.', '', 'lily-beetle');
    if (p.type !== 'bulb' && p.role !== 'veg' && p.role !== 'bedding') add(3, 'mulch', 'Mulch with compost or bark, 5 cm deep, on moist soil.', 'Holds in moisture, smothers weeds and feeds the soil.', 'mulch');
    if ((p.type === 'shrub' || p.type === 'perennial' || p.type === 'climber') && !rose && p.ph !== 'acid' && p.role !== 'veg' && p.role !== 'bedding' && p.role !== 'herb') add(4, 'feed', 'Feed with a general fertiliser as growth starts.', '', 'feed-general');
    if (years != null && years <= 2 && p.role !== 'veg' && p.role !== 'bedding') { add(6, 'water', 'Water new plantings deeply once a week in dry spells.', 'For the first two summers, until roots reach deeper soil.', 'water-new'); add(8, 'water', 'Water new plantings deeply once a week in dry spells.', 'For the first two summers, until roots reach deeper soil.', 'water-new'); }
    if (p.type === 'tree' && years != null && years <= 3) add(1, 'tidy', 'Check tree ties and stakes after winter winds.', 'A tie left too tight cuts into the bark.', 'tree-ties');
    return out;
  }

  /* all plants in a design, with identical jobs in the same month merged */
  function forPlants(placed, lib, prof, years) {
    const pids = [...new Set(placed.map(pl => pl.pid))].filter(id => lib[id]), byKey = new Map();
    pids.forEach(id => forPlant(lib[id], prof, years).forEach(t => {
      const k = t.m + '|' + t.key; let e = byKey.get(k);
      if (!e) { e = { m: t.m, kind: t.kind, text: t.text, why: t.why, key: t.key, pids: [] }; byKey.set(k, e); }
      if (!e.pids.includes(id)) e.pids.push(id);
    }));
    /* a few jobs for the garden as a whole */
    if (pids.length) {
      const has = (f) => pids.some(id => f(lib[id]));
      const general = [
        [1, 'tidy', 'Shake heavy snow off evergreens and hedges before it breaks branches.', '', has(p => p.ev && (p.type === 'shrub' || p.type === 'tree'))],
        [9, 'sow', 'Collect seed from plants you would like more of, on a dry day.', 'Store it in paper envelopes somewhere cool and dry.', has(p => p.flower && (p.type === 'perennial' || p.role === 'bedding'))],
        [10, 'tidy', 'Rake fallen leaves off borders and lawn, and stack them to rot into leaf mould.', 'Wet leaves smother low plants and harbour slugs.', true],
        [10, 'plant', 'Plant new trees, shrubs and perennials while the soil is still warm.', 'Autumn planting roots in before winter and needs far less watering next summer.', true],
        [12, 'tidy', 'Keep off borders when the soil is frozen or waterlogged.', 'Walking on it then squashes the soil structure.', true],
      ];
      general.forEach(([m, kind, text, why, on]) => { if (on) byKey.set(m + '|general|' + text, { m, kind, text, why, key: 'general|' + text, pids: [], general: true }); });
    }
    return [...byKey.values()].sort((a, b) => a.m - b.m || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || b.pids.length - a.pids.length);
  }

  global.Care = { KINDS, ORDER, forPlant, forPlants, span };
})(window);
