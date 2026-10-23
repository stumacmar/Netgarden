/* Netgarden — plant renderer.
 * Photo sprites are used when a plant has them. Otherwise plants are drawn from
 * individual leaves and flowers: each species has a leaf shape and a flower form,
 * leaves are stamped along branches and over the canopy with lighting, and flowers
 * are built from petals. Drawing happens in photo-pixel space with (x, y) the base. */
(function (global) {
  'use strict';
  const { shade, rgba, mixHex } = global.Phenology;

  function mulberry32(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let shadowsOff = false;
  function shadow(ctx, x, y, w) { if (shadowsOff) return; ctx.save(); ctx.fillStyle = 'rgba(20,30,10,0.22)'; ctx.beginPath(); ctx.ellipse(x, y, w * 0.48, Math.max(2, w * 0.11), 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }

  /* ---------- species look-up: leaf shape and flower form ---------- */
  function leafShape(p) {
    if (p.leafShape) return p.leafShape;
    const t = (p.latin + ' ' + p.name).toLowerCase();
    if (p.type === 'grass') return 'strap';
    if (p.group === 'fern') return 'frond';
    if (/acer|quercus|liquidambar|vitis|parthenocissus|humulus|ribes|crataegus|hibiscus|hydrangea quercifolia|cucurbita|cucumis|passiflora|fatsia|rheum|cynara|artichoke/.test(t)) return 'lobed';
    if (/sorbus|rosa|rose|sambucus|fraxinus|wisteria|laburnum|robinia|gleditsia|aquilegia|astilbe|thalictrum|potentilla|koelreuteria|juglans|physocarpus|clematis|jasmin|tomato|solanum|achillea|foeniculum|anethum|cosmos|nigella|ammi|coriandrum|petroselinum|dicentra|lamprocapnos|polemonium|geranium|erodium/.test(t)) return 'pinnate';
    if (/lavandula|rosmarin|salvia rosmarinus|olea|salix|buddleja|elaeagnus|perovskia|caryopteris|santolina|helianthemum|cistus|thymus|phlomis|ceanothus|escallonia|hebe|nerium|daphne|chaenomeles|cotoneaster|pittosporum|rhododendron|camellia|pieris|skimmia|sarcococca|viburnum tinus|photinia|laurus|prunus laurocerasus|prunus lusitanica|ligustrum|eucalyptus|arbutus|griselinia|leucothoe|nandina|mahonia|berberis|ilex|magnolia|amelanchier|betula|carpinus|fagus|corylus|pyrus|malus|prunus|cydonia|mespilus|ficus|morus|cornus|euonymus|syringa|philadelphus|deutzia|weigela|forsythia|kerria|spiraea|exochorda|abelia|fuchsia|hypericum|choisya|osmanthus|hamamelis|chimonanthus|lonicera|callicarpa|clerodendrum|cotinus|cercis|ginkgo/.test(t)) return /lavandula|rosmarin|olea|salix|perovskia|santolina|thymus|nerium|eucalyptus|elaeagnus|caryopteris|helianthemum|hebe|pittosporum|cistus|buddleja/.test(t) ? 'lanceolate' : 'oval';
    if (/pinus|taxus|juniperus|thuja|picea|abies|cupressus|chamaecyparis|cedrus|erica|calluna/.test(t)) return 'needle';
    if (/hosta|bergenia|brunnera|pulmonaria|heuchera|tiarella|primula|viola|cyclamen|arum|ligularia|rodgersia|darmera|nasturtium|tropaeolum|pelargonium|begonia|impatiens|lactuca|beta|brassica|rhubarb/.test(t)) return 'round';
    if (/iris|hemerocallis|agapanthus|kniphofia|crocosmia|phormium|yucca|cordyline|narcissus|tulipa|allium|galanthus|crocus|muscari|hyacinth|scilla|camassia|nerine|leucojum|gladiolus|lilium|fritillaria|eucomis|dierama|sisyrinchium|libertia|ophiopogon|liriope|zea|asparagus|allium|chives|leek|onion|garlic/.test(t)) return 'strap';
    if (/trachycarpus|chamaerops|phoenix/.test(t)) return 'palm';
    if (/sedum|hylotelephium|sempervivum|phedimus|delosperma/.test(t)) return 'succulent';
    if (p.type === 'bulb') return 'strap';
    return 'oval';
  }
  function flowerForm(p) {
    if (p.flowerForm) return p.flowerForm;
    const t = (p.latin + ' ' + p.name).toLowerCase();
    if (p.type === 'grass') return 'plume';
    if (/echinacea|rudbeckia|aster|symphyotrichum|cosmos|leucanthemum|helenium|erigeron|calendula|helianthus|anemone|geum|coreopsis|gaura|oenothera|scabiosa|knautia|zinnia|tagetes|dianthus|erysimum|potentilla|cistus|helianthemum|geranium|erodium|primula|viola|argyranthemum|osteospermum|gazania|bellis|hepatica|cyclamen|tulipa sprengeri/.test(t)) return 'daisy';
    if (/hosta|salvia|delphinium|lupin|digitalis|veronica|veronicastrum|liatris|agastache|lavandula|nepeta|persicaria|kniphofia|verbascum|buddleja|acanthus|ligularia|stachys|lamium|ajuga|penstemon|antirrhinum|lobelia|camassia|muscari|hyacinth|eremurus|lythrum|lysimachia|actaea|cimicifuga|perovskia|caryopteris|monarda|phlomis|mahonia|hebe|lavatera|vicia|pisum|phaseolus|lathyrus|teucrium|origanum|thymus|mentha|melissa/.test(t)) return 'spike';
    if (/ammi|achillea|sedum|hylotelephium|foeniculum|anethum|angelica|coriandrum|daucus|selinum|eupatorium|eutrochium|sambucus|viburnum|cornus|sorbus|crataegus|pyracantha|cotoneaster|photinia|euphorbia|alchemilla|astrantia|hydrangea paniculata|heracleum|valerian|centranthus|phlox|verbena|syringa|lilac|spiraea|choisya|skimmia|elaeagnus|ceanothus|escallonia|abelia|deutzia|philadelphus|exochorda|osmanthus|arbutus|aucuba|fatsia|ivy|hedera|ligustrum|privet|laurus|prunus laurocerasus|prunus lusitanica|olea|griselinia|solanum|akebia|passiflora|lonicera|jasminum|trachelospermum|clematis armandii|kiwi|actinidia|vitis|hop|humulus|rubus|fragaria|ribes/.test(t)) return 'umbel';
    if (/allium|echinops|eryngium|hydrangea|nectaroscordum|globe|armeria|craspedia|trollius|buxus/.test(t)) return 'ball';
    if (/campanula|fritillaria|galanthus|hyacinthoides|bluebell|convallaria|polygonatum|erythronium|leucojum|chionodoxa|scilla|enkianthus|pieris|arbutus|fuchsia|dicentra|lamprocapnos|penstemon|aquilegia|daphne|sarcococca|lonicera x purpusii|abelia|hellebor|clematis cirrhosa|clematis freckles|nicotiana|brugmansia/.test(t)) return 'bell';
    if (/rosa|rose|paeonia|peony|camellia|dahlia|ranunculus|zinnia|cistus|magnolia|kerria|exochorda|gardenia/.test(t)) return 'rose';
    if (/tulipa|crocus|colchicum|magnolia|anemone blanda|eranthis|nymphaea|papaver|eschscholzia|iris|hemerocallis|alstroemeria|hibiscus|lavatera|malva|abutilon|calystegia|ipomoea|petunia|convolvulus/.test(t)) return 'cup';
    if (/narcissus|daffodil|lilium|lily|campsis|hemerocallis|agapanthus|amaryllis|nerine|gladiolus|zantedeschia|arum|datura|nicotiana|mirabilis|eucomis|crocosmia/.test(t)) return 'trumpet';
    if (/wisteria|laburnum|robinia|cytisus|genista|lathyrus|sweet pea|ribes|pieris|akebia|cercis|phaseolus|vicia|kolkwitzia/.test(t)) return 'raceme';
    if (/corylus|betula|garrya|alnus|carpinus|salix|quercus|juglans|zea/.test(t)) return 'catkin';
    if (p.type === 'tree' || p.type === 'shrub' || p.type === 'climber') return 'blossom';
    return 'daisy';
  }

  /* ---------- leaf stamps ---------- */
  function leaf(ctx, x, y, L, W, rot, color, shapeName, rnd, light) {
    const c = shade(color, (rnd() - 0.5) * 0.3 + light);
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = c;
    switch (shapeName) {
      case 'lanceolate': ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(W * 0.5, -L * 0.5, 0, -L); ctx.quadraticCurveTo(-W * 0.5, -L * 0.5, 0, 0); ctx.fill(); break;
      case 'round': ctx.beginPath(); ctx.ellipse(0, -L * 0.55, W * 0.55, L * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = rgba(shade(c, -0.25), 0.6); ctx.lineWidth = Math.max(0.5, W * 0.03); ctx.beginPath(); ctx.moveTo(0, -L * 0.1); ctx.lineTo(0, -L); ctx.stroke(); break;
      case 'lobed': {
        ctx.beginPath(); const n = 5; ctx.moveTo(0, 0);
        for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.55; const r = L * (i === 2 ? 1 : i === 1 || i === 3 ? 0.85 : 0.6); const mid = a - 0.27, rm = r * 0.45; ctx.quadraticCurveTo(Math.cos(mid) * rm, Math.sin(mid) * rm, Math.cos(a) * r, Math.sin(a) * r); if (i < n - 1) { const nx = a + 0.27; ctx.quadraticCurveTo(Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75, Math.cos(nx) * r * 0.42, Math.sin(nx) * r * 0.42); } }
        ctx.closePath(); ctx.fill(); break;
      }
      case 'pinnate': { ctx.strokeStyle = shade(c, -0.2); ctx.lineWidth = Math.max(0.5, W * 0.08); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.stroke(); const n = 3 + Math.floor(L / Math.max(2, W * 0.7)); for (let i = 1; i <= n; i++) { const yy = -L * i / (n + 0.5), s = W * 0.5 * (1 - i / (n + 2)); ctx.beginPath(); ctx.ellipse(s * 0.9, yy, s, s * 0.45, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(-s * 0.9, yy, s, s * 0.45, -0.5, 0, Math.PI * 2); ctx.fill(); } break; }
      case 'frond': { ctx.strokeStyle = shade(c, -0.2); ctx.lineWidth = Math.max(0.5, W * 0.06); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(W * 0.3, -L * 0.6, 0, -L); ctx.stroke(); const n = 6 + Math.floor(L / 6); for (let i = 1; i <= n; i++) { const f = i / (n + 1), yy = -L * f, len = W * 0.6 * Math.sin(Math.PI * f * 0.9 + 0.1); ctx.lineWidth = Math.max(0.5, W * 0.07); ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(len, yy - len * 0.3); ctx.moveTo(0, yy); ctx.lineTo(-len, yy - len * 0.3); ctx.stroke(); } break; }
      case 'needle': { ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.5, L * 0.08); ctx.lineCap = 'round'; for (let i = 0; i < 7; i++) { const a = (i - 3) * 0.32 + (rnd() - 0.5) * 0.2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * L, -Math.cos(a) * L); ctx.stroke(); } break; }
      case 'strap': ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.6, W * 0.35); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(W * 0.3, -L * 0.7, W * 0.9, -L); ctx.stroke(); break;
      case 'palm': { ctx.strokeStyle = c; ctx.lineWidth = Math.max(0.6, W * 0.08); for (let i = 0; i < 9; i++) { const a = (i - 4) * 0.22; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.sin(a) * L, -Math.cos(a) * L); ctx.stroke(); } break; }
      case 'succulent': ctx.beginPath(); ctx.ellipse(0, -L * 0.4, W * 0.5, L * 0.4, 0, 0, Math.PI * 2); ctx.fill(); break;
      default: /* oval with a point */ ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(W * 0.7, -L * 0.25, W * 0.6, -L * 0.8, 0, -L); ctx.bezierCurveTo(-W * 0.6, -L * 0.8, -W * 0.7, -L * 0.25, 0, 0); ctx.fill();
        if (L > 6) { ctx.strokeStyle = rgba(shade(c, 0.35), 0.5); ctx.lineWidth = Math.max(0.4, W * 0.04); ctx.beginPath(); ctx.moveTo(0, -L * 0.08); ctx.lineTo(0, -L * 0.9); ctx.stroke(); }
    }
    ctx.restore();
  }

  /* ---------- flower stamps ---------- */
  function petalDaisy(ctx, x, y, r, color, rnd, n, centre) {
    ctx.save(); ctx.translate(x, y); const rot = rnd() * Math.PI;
    for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2; ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.15); ctx.beginPath(); ctx.ellipse(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6, r * 0.45, r * 0.2, a, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = centre || '#e8b020'; ctx.beginPath(); ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function petalSmall(ctx, x, y, r, color, rnd) { /* five round petals, used for blossom, umbels, clusters */
    ctx.save(); ctx.translate(x, y); const rot = rnd() * Math.PI; ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.2);
    for (let i = 0; i < 5; i++) { const a = rot + i / 5 * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.42, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = rgba(shade(color, -0.35), 0.8); ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  function roseHead(ctx, x, y, r, color, rnd) {
    ctx.save(); ctx.translate(x, y); const rot = rnd() * Math.PI;
    for (let ring = 3; ring >= 0; ring--) { const rr = r * (0.35 + ring * 0.22), n = 5 + ring * 2; for (let i = 0; i < n; i++) { const a = rot + ring * 0.4 + i / n * Math.PI * 2; ctx.fillStyle = shade(color, -0.25 + ring * 0.12); ctx.beginPath(); ctx.ellipse(Math.cos(a) * rr * 0.5, Math.sin(a) * rr * 0.5, rr * 0.5, rr * 0.32, a, 0, Math.PI * 2); ctx.fill(); } }
    ctx.restore();
  }
  function cup(ctx, x, y, r, color, rnd) { ctx.save(); ctx.translate(x, y); ctx.fillStyle = shade(color, -0.15); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = shade(color, 0.12); ctx.beginPath(); ctx.ellipse(-r * 0.3, 0, r * 0.4, r * 0.95, 0.15, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(r * 0.3, 0, r * 0.4, r * 0.95, -0.15, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  function trumpet(ctx, x, y, r, color, rnd) { petalDaisy(ctx, x, y, r, color, rnd, 6, shade(color, -0.1)); ctx.save(); ctx.fillStyle = shade(color, 0.15); ctx.beginPath(); ctx.ellipse(x, y, r * 0.38, r * 0.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  function bell(ctx, x, y, r, color, rnd) { ctx.save(); ctx.translate(x, y); ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.2); ctx.beginPath(); ctx.moveTo(-r * 0.45, -r); ctx.quadraticCurveTo(-r * 0.7, r * 0.4, -r * 0.5, r * 0.8); ctx.lineTo(r * 0.5, r * 0.8); ctx.quadraticCurveTo(r * 0.7, r * 0.4, r * 0.45, -r); ctx.closePath(); ctx.fill(); ctx.restore(); }
  function sprig(ctx, x, y, h, w, color, rnd, dots) { /* a spike: dots of colour up a stem */
    ctx.save(); ctx.strokeStyle = shade('#5a7a3a', -0.2); ctx.lineWidth = Math.max(0.6, w * 0.12); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
    const n = Math.max(4, Math.round(h / Math.max(1.5, w * 0.35)));
    for (let i = 0; i < n * dots; i++) { const f = i / (n * dots), yy = y - h * (0.25 + f * 0.75), ww = w * (1 - f * 0.6); ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.25); ctx.beginPath(); ctx.ellipse(x + (rnd() - 0.5) * ww, yy, Math.max(0.8, ww * 0.28), Math.max(0.8, ww * 0.2), rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function umbel(ctx, x, y, r, color, rnd) { ctx.save(); const n = Math.max(6, Math.round(r * 1.2)); for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r; ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.25); ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.45, Math.max(0.8, r * 0.14), Math.max(0.7, r * 0.1), 0, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  function ball(ctx, x, y, r, color, rnd) { ctx.save(); const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r); g.addColorStop(0, shade(color, 0.2)); g.addColorStop(1, shade(color, -0.3)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); const n = Math.max(8, Math.round(r * 1.5)); for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r * 0.95; ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.4 + 0.1); ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, Math.max(0.6, r * 0.12), 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  function plume(ctx, x, y, h, w, color, rnd) { ctx.save(); ctx.strokeStyle = shade(color, -0.2); ctx.lineWidth = Math.max(0.6, w * 0.1); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.3, y - h * 0.7, x + w * 0.6, y - h); ctx.stroke(); const n = Math.max(6, Math.round(h / 3)); for (let i = 0; i < n; i++) { const f = 0.35 + 0.65 * i / n, px = x + w * 0.6 * f * f, py = y - h * f; ctx.strokeStyle = rgba(shade(color, (rnd() - 0.5) * 0.3), 0.8); ctx.lineWidth = Math.max(0.5, w * 0.05); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + (rnd() - 0.3) * w * 0.5, py - rnd() * w * 0.3); ctx.stroke(); } ctx.restore(); }
  function raceme(ctx, x, y, h, w, color, rnd) { ctx.save(); ctx.strokeStyle = '#6a7a4a'; ctx.lineWidth = Math.max(0.5, w * 0.08); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.2, y + h * 0.5, x + w * 0.3, y + h); ctx.stroke(); const n = Math.max(5, Math.round(h / Math.max(2, w * 0.4))); for (let i = 0; i < n; i++) { const f = i / n, px = x + w * 0.3 * f + (rnd() - 0.5) * w * 0.5, py = y + h * f; ctx.fillStyle = shade(color, (rnd() - 0.5) * 0.25); ctx.beginPath(); ctx.ellipse(px, py, Math.max(0.8, w * 0.25), Math.max(0.8, w * 0.18), 0, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  function catkin(ctx, x, y, h, w, color, rnd) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, w * 0.3); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w * 0.3, y + h * 0.6, x + w * 0.2, y + h); ctx.stroke(); ctx.restore(); }

  /* draw one flower of the given form; r = nominal radius in px; stem height for spikes */
  function flowerStamp(ctx, form, x, y, r, color, rnd, p) {
    switch (form) {
      case 'daisy': petalDaisy(ctx, x, y, r, color, rnd, 10 + Math.floor(rnd() * 4), /rudbeckia|echinacea|helenium|cosmos|sunflower|helianthus/i.test(p.latin + p.name) ? '#5a3a1a' : '#e8c030'); break;
      case 'rose': roseHead(ctx, x, y, r, color, rnd); break;
      case 'cup': cup(ctx, x, y, r, color, rnd); break;
      case 'trumpet': trumpet(ctx, x, y, r, color, rnd); break;
      case 'bell': bell(ctx, x, y, r * 0.8, color, rnd); break;
      case 'spike': sprig(ctx, x, y + r * 2, r * 4, r * 1.2, color, rnd, 2.2); break;
      case 'umbel': umbel(ctx, x, y, r * 1.3, color, rnd); break;
      case 'ball': ball(ctx, x, y, r, color, rnd); break;
      case 'plume': plume(ctx, x, y + r * 3, r * 5, r * 1.2, color, rnd); break;
      case 'raceme': raceme(ctx, x, y - r, r * 4, r * 1.2, color, rnd); break;
      case 'catkin': catkin(ctx, x, y - r, r * 3, r, color, rnd); break;
      default: petalSmall(ctx, x, y, r, color, rnd);
    }
  }

  /* ---------- structure ---------- */
  function branches(ctx, rnd, x, y, len, angle, depth, width, color, out) {
    if (depth === 0 || len < 1.5) { if (out) out.push({ x, y }); return; }
    const ex = x + Math.cos(angle) * len, ey = y + Math.sin(angle) * len;
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.6, width); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    if (out && depth <= 2) out.push({ x: ex, y: ey });
    const n = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) branches(ctx, rnd, ex, ey, len * (0.55 + rnd() * 0.25), angle + (rnd() - 0.5) * 1.3, depth - 1, width * 0.6, color, out);
  }
  function trunk(ctx, x, y, h, w, color, rnd) {
    ctx.save(); const g = ctx.createLinearGradient(x - w, 0, x + w, 0); g.addColorStop(0, shade(color, -0.35)); g.addColorStop(0.45, shade(color, 0.08)); g.addColorStop(1, shade(color, -0.3)); ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x - w * 0.7, y - h * 0.5, x - w * 0.55, y - h); ctx.lineTo(x + w * 0.55, y - h); ctx.quadraticCurveTo(x + w * 0.7, y - h * 0.5, x + w, y); ctx.closePath(); ctx.fill();
    if (w > 3) { ctx.strokeStyle = rgba(shade(color, -0.5), 0.5); ctx.lineWidth = 0.8; for (let i = 0; i < 6; i++) { const xx = x + (rnd() - 0.5) * w * 1.2; ctx.beginPath(); ctx.moveTo(xx, y - rnd() * h); ctx.lineTo(xx + (rnd() - 0.5) * w * 0.3, y - rnd() * h); ctx.stroke(); } }
    ctx.restore();
  }

  /* fill an ellipse with leaves: outer leaves lit, inner shaded; count scales with area */
  function foliage(ctx, rnd, cx, cy, rx, ry, color, density, shapeName, lod) {
    const area = Math.PI * rx * ry;
    const needle = shapeName === 'needle';
    const L = Math.max(2.2, Math.min(Math.max(rx, ry) * 0.3, 3 + Math.sqrt(area) * (needle ? 0.07 : 0.13))) * lod.leafScale;
    const Lk = shapeName === 'lanceolate' ? 0.6 : 1;
    const W = L * Lk * ({ lanceolate: 0.28, strap: 0.25, needle: 0.5, pinnate: 0.7, frond: 0.6, lobed: 1, round: 0.9, palm: 1.4, succulent: 0.7 }[shapeName] || 0.62);
    const n = Math.min(lod.maxLeaves, Math.max(16, Math.round(area / (L * W * (needle ? 0.5 : 0.32))))) * Math.max(0.3, density);
    /* dark interior first */
    ctx.save(); ctx.globalAlpha *= 0.35 + 0.65 * density;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 1); g.addColorStop(0, rgba(shade(color, -0.3), 0.9)); g.addColorStop(0.8, rgba(shade(color, -0.3), 0.75)); g.addColorStop(1, rgba(shade(color, -0.3), 0));
    ctx.save(); ctx.translate(cx, cy); ctx.scale(rx * 0.9, ry * 0.9); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    const pts = [];
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()); pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r, r }); }
    pts.sort((a, b) => a.r - b.r); /* inner first, outer on top */
    pts.forEach(pt => {
      const light = (cy - pt.y) / ry * 0.18 + (pt.x - cx) / rx * 0.08 + pt.r * 0.12 - 0.12;
      const rot = Math.atan2(pt.y - cy, pt.x - cx) + Math.PI / 2 + (rnd() - 0.5) * 1.2;
      leaf(ctx, pt.x, pt.y, L * Lk * (0.7 + rnd() * 0.6), W * (0.8 + rnd() * 0.4), rot, color, shapeName, rnd, light);
    });
    ctx.restore();
    return { L, W };
  }
  function scatterFlowers(ctx, rnd, form, cx, cy, rx, ry, color, density, r, p, bias) {
    const n = Math.round(Math.max(4, (rx * ry) / (r * r * 3)) * Math.min(1.2, density * 1.2));
    ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + density);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), bias || 0.5); flowerStamp(ctx, form, cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, r * (0.8 + rnd() * 0.4), color, rnd, p); }
    ctx.restore();
  }
  function fruits(ctx, rnd, cx, cy, rx, ry, color, density, r) {
    const n = Math.round(Math.max(3, (rx * ry) / (r * r * 6)) * density); ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + density);
    for (let i = 0; i < n; i++) { const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * 0.9, x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d, rr = r * (0.8 + rnd() * 0.4); const g = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, rr * 0.1, x, y, rr); g.addColorStop(0, shade(color, 0.3)); g.addColorStop(1, shade(color, -0.3)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function lodFor(h) { return h < 40 ? { leafScale: 1.5, maxLeaves: 60 } : h < 120 ? { leafScale: 1.15, maxLeaves: 300 } : h < 300 ? { leafScale: 1, maxLeaves: 900 } : { leafScale: 0.9, maxLeaves: 1400 }; }
  const sizeOfFlower = (p, w, h) => { const big = /hydrangea|rhododendron|paeonia|peony|camellia|dahlia|magnolia|rosa|rose|allium|hibiscus|lilium|helianthus annuus|sunflower|tulipa|narcissus|iris|papaver|clematis|passiflora|cosmos|echinacea|rudbeckia|leucanthemum/i.test(p.latin + p.name); return Math.max(1.8, Math.sqrt(w * h) * (big ? 0.1 : 0.045) + (big ? 2 : 1)); };

  /* ---------- forms ---------- */
  function drawTree(ctx, p, st, x, y, w, h, rnd) {
    const shapeName = leafShape(p), form = flowerForm(p), lod = lodFor(h);
    const conifer = shapeName === 'needle', weeping = /weeping|babylonica|'pendula'|youngii/i.test(p.latin + p.name), columnar = w / h < 0.3;
    const trunkH = conifer ? h * 0.12 : h * (columnar ? 0.2 : 0.3), trunkW = Math.max(1.2, w * (conifer ? 0.04 : 0.055));
    const cx = x, ry = conifer ? h * 0.45 : h * 0.36, cy = y - trunkH - ry * (conifer ? 1 : 0.95), rx = w / 2;
    shadow(ctx, x, y, w);
    const barkColor = p.bare === '#e9e6df' ? '#e4e0d8' : (p.bare || '#6b5a48');
    trunk(ctx, x, y, trunkH + ry * 0.6, trunkW, barkColor, rnd);
    if (p.bare === '#e9e6df') { ctx.save(); ctx.strokeStyle = 'rgba(40,40,40,0.55)'; ctx.lineWidth = Math.max(0.6, trunkW * 0.15); for (let i = 0; i < 7; i++) { const yy = y - (trunkH + ry * 0.6) * rnd(); ctx.beginPath(); ctx.moveTo(x - trunkW * 0.7, yy); ctx.lineTo(x + trunkW * 0.3, yy + rnd() * 2); ctx.stroke(); } ctx.restore(); }
    const tips = [];
    ctx.save(); ctx.globalAlpha *= st.leaf < 0.95 ? 1 : 0.35;
    const r2 = mulberry32(1);
    if (!conifer) for (let i = 0; i < 4; i++) branches(ctx, r2, x, cy + ry * 0.35, ry * 0.5, -Math.PI / 2 + (i - 1.5) * 0.6, 4, trunkW * 0.55, p.bare && p.bare !== '#e9e6df' ? p.bare : barkColor, tips);
    ctx.restore();
    if (st.leaf > 0.02) {
      if (conifer) { /* layered triangles of needles */
        ctx.save(); ctx.globalAlpha *= 0.4 + 0.6 * st.leaf; const layers = Math.max(4, Math.round(h / 12));
        for (let i = 0; i < layers; i++) { const f = i / layers, yy = y - trunkH - h * 0.88 * f, ww = rx * (1 - f) * 1.9 + rx * 0.1; const cc = shade(st.leafColor, (f - 0.5) * 0.3 + (rnd() - 0.5) * 0.1); ctx.fillStyle = cc; ctx.beginPath(); ctx.moveTo(x, yy - h * 0.12); ctx.lineTo(x + ww / 2, yy + h * 0.02); ctx.lineTo(x - ww / 2, yy + h * 0.02); ctx.closePath(); ctx.fill(); for (let k = 0; k < Math.min(30, ww / 4); k++) leaf(ctx, x + (rnd() - 0.5) * ww, yy + (rnd() - 0.2) * h * 0.06, Math.max(2, ww * 0.12), 2, Math.PI + (rnd() - 0.5) * 1.5, st.leafColor, 'needle', rnd, (rnd() - 0.5) * 0.2); }
        ctx.restore();
      } else if (weeping) {
        ctx.save(); ctx.globalAlpha *= 0.4 + 0.6 * st.leaf; const n = Math.min(lod.maxLeaves, Math.round(rx * 1.2));
        for (let i = 0; i < n; i++) { const a = rnd() * Math.PI, sx = cx + Math.cos(a) * rx * 0.9, sy = cy - ry * 0.3 + rnd() * ry * 0.3, len = ry * (0.9 + rnd() * 0.8); ctx.strokeStyle = shade(st.leafColor, (rnd() - 0.5) * 0.3 - 0.1); ctx.lineWidth = Math.max(0.7, w * 0.012); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + (rnd() - 0.5) * rx * 0.2, sy + len * 0.5, sx + (rnd() - 0.5) * rx * 0.3, sy + len); ctx.stroke(); }
        foliage(ctx, rnd, cx, cy - ry * 0.2, rx * 0.8, ry * 0.6, st.leafColor, st.leaf, shapeName, lod); ctx.restore();
      } else {
        const clusters = tips.length ? tips : [{ x: cx, y: cy }];
        /* one main canopy mass plus smaller masses at branch tips for an uneven outline */
        foliage(ctx, rnd, cx, cy, rx * 0.86, ry * 0.86, st.leafColor, st.leaf, shapeName, lod);
        clusters.slice(0, 6).forEach(t => foliage(ctx, rnd, Math.max(cx - rx * 0.9, Math.min(cx + rx * 0.9, t.x)), Math.max(cy - ry * 0.9, Math.min(cy + ry * 0.7, t.y)), rx * 0.3, ry * 0.3, st.leafColor, st.leaf, shapeName, { leafScale: lod.leafScale, maxLeaves: Math.round(lod.maxLeaves / 6) }));
      }
    }
    const fr = sizeOfFlower(p, w, h);
    if (st.flower > 0.02 && st.flowerColor) scatterFlowers(ctx, rnd, form === 'spike' || form === 'daisy' ? 'blossom' : form, cx, cy, rx * 0.9, ry * 0.9, st.flowerColor, st.flower, form === 'raceme' || form === 'catkin' ? fr * 0.8 : fr * 0.8, p, 0.4);
    if (st.fruit > 0.02 && st.fruitColor) fruits(ctx, rnd, cx, cy + ry * 0.1, rx * 0.85, ry * 0.85, st.fruitColor, st.fruit, Math.max(1.2, Math.min(rx, ry) * 0.06));
  }

  function drawShrub(ctx, p, st, x, y, w, h, rnd) {
    const shapeName = leafShape(p), form = flowerForm(p), lod = lodFor(h);
    const rx = w / 2, ry = h * 0.5, cx = x, cy = y - ry;
    shadow(ctx, x, y, w);
    const stemColor = p.bare || '#7a6a58';
    ctx.save(); ctx.globalAlpha *= st.leaf < 0.95 ? Math.max(0.4, 1 - st.leaf) + 0.3 : 0.25; const r2 = mulberry32(7); const n = 9;
    if (shapeName !== 'needle' || st.leaf < 0.5) for (let i = 0; i < n; i++) branches(ctx, r2, x + (r2() - 0.5) * rx * 0.4, y, h * (shapeName === 'needle' ? 0.3 : 0.42), -Math.PI / 2 + (i / (n - 1) - 0.5) * 1.5, 3, Math.max(0.8, w * 0.02), stemColor, null);
    ctx.restore();
    if (st.leaf > 0.02) foliage(ctx, rnd, cx, cy + ry * 0.05, rx * 0.95, ry * 0.95, st.leafColor, st.leaf, shapeName, lod);
    const fr = sizeOfFlower(p, w, h);
    if (st.flower > 0.02 && st.flowerColor) {
      if (form === 'spike' || form === 'plume') { ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower); const m = Math.round(Math.max(6, rx / Math.max(3, fr)) * 1.6 * st.flower + 3); const spikeH = Math.max(fr * 3, h * 0.18); for (let i = 0; i < m; i++) { const sx = cx + (rnd() - 0.5) * rx * 1.7, base = cy - ry * (0.2 + rnd() * 0.6) * (1 - Math.abs(sx - cx) / rx * 0.5); sprig(ctx, sx, base, spikeH, Math.max(fr * 1.3, spikeH * 0.2), st.flowerColor, rnd, 2.2); } ctx.restore(); }
      else { ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower); const n = Math.round(Math.max(4, (rx * ry) / (fr * fr * 3)) * Math.min(1.2, st.flower * 1.2)); for (let i = 0; i < n; i++) { const a = -Math.PI * (0.05 + rnd() * 0.9), d = 0.55 + rnd() * 0.45; flowerStamp(ctx, form, cx + Math.cos(a) * rx * d * 0.95, cy + Math.sin(a) * ry * d * 0.95 + ry * 0.1, fr * (0.8 + rnd() * 0.4), st.flowerColor, rnd, p); } ctx.restore(); }
    }
    if (st.fruit > 0.02 && st.fruitColor) fruits(ctx, rnd, cx, cy, rx * 0.85, ry * 0.85, st.fruitColor, st.fruit, Math.max(1.2, Math.min(rx, ry) * 0.07));
  }

  function drawClimber(ctx, p, st, x, y, w, h, rnd) {
    const shapeName = leafShape(p), form = flowerForm(p), lod = lodFor(h), rx = w / 2;
    ctx.save(); ctx.globalAlpha *= st.leaf < 0.95 ? 1 : 0.6; ctx.strokeStyle = p.bare || '#6a5a48'; ctx.lineWidth = Math.max(1, w * 0.025); ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) { ctx.beginPath(); let px = x + (i - 1.5) * rx * 0.3, py = y; ctx.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (rnd() - 0.5) * rx * 0.6; py -= h / 6; ctx.lineTo(px, py); } ctx.stroke(); }
    ctx.restore();
    if (st.leaf > 0.02) { const bands = Math.max(3, Math.round(h / Math.max(20, w * 0.6))); for (let i = 0; i < bands; i++) { const f = (i + 0.5) / bands, cy = y - h * (0.08 + f * 0.85), ww = w * (0.45 + f * 0.55); foliage(ctx, rnd, x, cy, ww / 2, (h / bands) * 0.6, st.leafColor, st.leaf, shapeName, { leafScale: lod.leafScale, maxLeaves: Math.round(lod.maxLeaves / bands) }); } }
    const fr = sizeOfFlower(p, w, h);
    if (st.flower > 0.02 && st.flowerColor) { ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower); const n = Math.round(Math.max(6, (w * h) / (fr * fr * 14)) * st.flower); for (let i = 0; i < n; i++) { const t = rnd(); flowerStamp(ctx, form === 'spike' ? 'umbel' : form, x + (rnd() - 0.5) * w * (0.5 + t * 0.6), y - h * (0.1 + t * 0.85), fr, st.flowerColor, rnd, p); } ctx.restore(); }
    if (st.fruit > 0.02 && st.fruitColor) { const n = Math.round(30 * st.fruit); ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.fruit); for (let i = 0; i < n; i++) { const t = rnd(); const fx = x + (rnd() - 0.5) * w * (0.5 + t * 0.6), fy = y - h * (0.1 + t * 0.85), rr = Math.max(1.2, rx * 0.06); ctx.fillStyle = shade(st.fruitColor, (rnd() - 0.5) * 0.3); ctx.beginPath(); ctx.arc(fx, fy, rr, 0, Math.PI * 2); ctx.fill(); } ctx.restore(); }
  }

  function drawPerennial(ctx, p, st, x, y, w, h, rnd) {
    const shapeName = leafShape(p), form = flowerForm(p), lod = lodFor(h), rx = w / 2;
    shadow(ctx, x, y, w * 0.9);
    if (st.leaf <= 0.02 && st.flower <= 0.02) { ctx.save(); ctx.strokeStyle = 'rgba(110,90,60,0.7)'; ctx.lineWidth = 1; for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x + (i - 2) * rx * 0.15, y); ctx.lineTo(x + (i - 2) * rx * 0.3, y - h * 0.12); ctx.stroke(); } ctx.restore(); return; }
    const mound = Math.max(0.25, st.leaf), moundH = h * (shapeName === 'strap' ? 0.55 : 0.4) * mound;
    if (st.leaf > 0.02) {
      if (shapeName === 'strap') { ctx.save(); ctx.globalAlpha *= 0.5 + 0.5 * st.leaf; const n = Math.min(lod.maxLeaves, Math.max(12, Math.round(w / 2))); for (let i = 0; i < n; i++) { const a = (i / (n - 1) - 0.5) * 2.2 + (rnd() - 0.5) * 0.3, L = moundH * (0.7 + rnd() * 0.5); ctx.strokeStyle = shade(st.leafColor, (rnd() - 0.5) * 0.3); ctx.lineWidth = Math.max(0.8, w * 0.02); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + (rnd() - 0.5) * rx * 0.3, y); ctx.quadraticCurveTo(x + Math.sin(a) * rx * 0.4, y - L * 0.8, x + Math.sin(a) * rx * 1.05, y - L * Math.cos(a * 0.5)); ctx.stroke(); } ctx.restore(); }
      else foliage(ctx, rnd, x, y - moundH * 0.55, rx * 0.95, moundH * 0.6, st.leafColor, st.leaf, shapeName, lod);
    }
    if (st.flower > 0.02 && st.flowerColor && form === 'daisy' && h > w * 2.5) {
      /* tall single-stem plants such as sunflowers: a few stems, big heads, leaves up the stem */
      ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower); const stems = Math.max(1, Math.min(4, Math.round(w / Math.max(8, h * 0.12))));
      for (let i = 0; i < stems; i++) { const sx = x + (i - (stems - 1) / 2) * w * 0.5, sh = h * (0.8 + rnd() * 0.2), headR = Math.max(3, w * 0.32); ctx.strokeStyle = shade(st.leafColor, -0.25); ctx.lineWidth = Math.max(1, w * 0.04); ctx.beginPath(); ctx.moveTo(sx, y); ctx.lineTo(sx, y - sh + headR); ctx.stroke(); const nl = Math.round(sh / Math.max(10, w * 0.35)); for (let k = 1; k <= nl; k++) { const ly = y - sh * k / (nl + 1.5); leaf(ctx, sx, ly, w * 0.45, w * 0.3, (k % 2 ? 1 : -1) * 1.1, st.leafColor, 'oval', rnd, 0); } flowerStamp(ctx, 'daisy', sx, y - sh + headR, headR, st.flowerColor, rnd, p); }
      ctx.restore();
    } else if (st.flower > 0.02 && st.flowerColor) {
      const fr = sizeOfFlower(p, w, h);
      const stems = Math.max(3, Math.min(24, Math.round(w / Math.max(4, fr * 1.6)))) ;
      ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower);
      const shown = Math.max(1, Math.round(stems * Math.min(1, st.flower + 0.2)));
      for (let i = 0; i < shown; i++) {
        const sx = x + (rnd() - 0.5) * rx * 1.4, sh = h * (0.6 + rnd() * 0.4), tx = sx + (rnd() - 0.5) * rx * 0.2, ty = y - sh;
        if (form === 'spike') { const spikeH = Math.max(fr * 3, (sh - moundH * 0.3) * 0.5); ctx.strokeStyle = shade(st.leafColor, -0.2); ctx.lineWidth = Math.max(0.7, w * 0.015); ctx.beginPath(); ctx.moveTo(sx, y - moundH * 0.3); ctx.lineTo(tx, ty + spikeH); ctx.stroke(); sprig(ctx, tx, ty + spikeH, spikeH, Math.max(fr * 1.4, spikeH * 0.22), st.flowerColor, rnd, 2.4); continue; }
        if (form === 'plume') { plume(ctx, sx, y - moundH * 0.3, sh - moundH * 0.3, Math.max(fr, w * 0.08), st.flowerColor, rnd); continue; }
        ctx.strokeStyle = shade(st.leafColor, -0.2); ctx.lineWidth = Math.max(0.7, w * 0.015); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(sx, y - moundH * 0.3); ctx.quadraticCurveTo(sx, y - sh * 0.6, tx, ty + fr * 0.5); ctx.stroke();
        flowerStamp(ctx, form, tx, ty, fr, st.flowerColor, rnd, p);
      }
      ctx.restore();
    }
    if (st.fruit > 0.02 && st.fruitColor) fruits(ctx, rnd, x, y - moundH * 0.5, rx * 0.8, moundH * 0.5, st.fruitColor, st.fruit, Math.max(1.2, rx * 0.08));
  }

  function drawGrass(ctx, p, st, x, y, w, h, rnd) {
    const rx = w / 2; shadow(ctx, x, y, w * 0.8); if (st.leaf <= 0.02) return;
    ctx.save(); ctx.globalAlpha *= 0.5 + 0.5 * st.leaf; const n = Math.max(16, Math.round(18 + w / 3)); ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) { const a = (i / (n - 1) - 0.5) * 2.4 + (rnd() - 0.5) * 0.3, L = h * (0.6 + rnd() * 0.4) * (0.6 + 0.4 * st.leaf); ctx.lineWidth = Math.max(0.7, w * 0.012); ctx.strokeStyle = shade(st.leafColor, (rnd() - 0.5) * 0.35); ctx.beginPath(); ctx.moveTo(x + (rnd() - 0.5) * rx * 0.3, y); ctx.quadraticCurveTo(x + Math.sin(a) * rx * 0.3, y - L * 0.8, x + Math.sin(a) * rx * 1.1, y - L * Math.cos(a * 0.6)); ctx.stroke(); }
    ctx.restore();
    if (st.flower > 0.02 && st.flowerColor) { ctx.save(); ctx.globalAlpha *= Math.min(1, 0.3 + st.flower); const upright = /calamagrostis|molinia|panicum|miscanthus|pennisetum/i.test(p.latin); const m = Math.round((upright ? 14 : 9) * st.flower + 3); for (let i = 0; i < m; i++) { const a = (rnd() - 0.5) * (upright ? 0.35 : 1.2); plume(ctx, x + (rnd() - 0.5) * rx * (upright ? 1.2 : 0.4), y, h * (1.05 + rnd() * 0.25), rx * (upright ? 0.15 + a * 0.3 : 0.6 + a), st.flowerColor, rnd); } ctx.restore(); }
  }

  function drawBulb(ctx, p, st, x, y, w, h, rnd, ppm) {
    if (st.leaf <= 0.02 && st.flower <= 0.02) return;
    const form = flowerForm(p), clump = 7, spread = Math.max(w * 2.5, ppm * 0.35);
    const headR = Math.max(1.5, Math.max(0.025, p.s * 0.3) * ppm);
    ctx.save();
    for (let i = 0; i < clump; i++) {
      const bx = x + (rnd() - 0.5) * spread, by = y + (rnd() - 0.5) * spread * 0.25, bh = h * (0.8 + rnd() * 0.3);
      if (st.leaf > 0.02) { ctx.globalAlpha = 0.5 + 0.5 * st.leaf; ctx.strokeStyle = st.leafColor; ctx.lineWidth = Math.max(0.8, ppm * 0.012); ctx.lineCap = 'round'; for (let k = 0; k < 3; k++) { const a = (k - 1) * 0.35 + (rnd() - 0.5) * 0.2, L = Math.max(bh * 0.6, ppm * 0.12) * st.leaf; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + Math.sin(a) * L * 0.3, by - L * 0.7, bx + Math.sin(a) * L * 0.6, by - L); ctx.stroke(); } }
      if (st.flower > 0.02 && st.flowerColor) { ctx.globalAlpha = Math.min(1, st.flower * 1.3); ctx.strokeStyle = shade(st.leafColor, -0.1); ctx.lineWidth = Math.max(0.8, ppm * 0.01); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by - bh); ctx.stroke(); flowerStamp(ctx, form === 'blossom' ? 'cup' : form, bx, by - bh, headR * (0.6 + 0.4 * st.flower), st.flowerColor, rnd, p); }
    }
    ctx.restore();
  }

  /* ---------- photo sprites ---------- */
  const FALLBACK = { flower: ['flower', 'leaf', 'spring', 'autumn', 'fruit'], fruit: ['fruit', 'leaf', 'autumn', 'flower', 'spring'], autumn: ['autumn', 'leaf', 'fruit', 'flower', 'spring'], spring: ['spring', 'leaf', 'flower', 'autumn', 'fruit'], leaf: ['leaf', 'spring', 'autumn', 'fruit', 'flower'], bare: ['bare'] };
  const imgCache = {}; const api = { onImageLoad: null };
  /* Sprites were cut out from a white background, which leaves a bright fringe round every leaf and white
   * specks in the gaps. Once loaded, each sprite is cleaned: the colour is un-mixed from white at the
   * semi-transparent edge and the alpha is eroded by one pixel so the fringe and specks go. */
  function cleanSprite(im) {
    try {
      const w = im.naturalWidth, h = im.naturalHeight, c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
      const img = cx.getImageData(0, 0, w, h), d = img.data, a0 = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 3; i < a0.length; i++, j += 4) a0[i] = d[j];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, a = a0[i], j = i * 4; if (!a) continue;
        if (a < 255) { const k = 255 / a, m = 255 - a; d[j] = Math.max(0, (d[j] - m) * k); d[j + 1] = Math.max(0, (d[j + 1] - m) * k); d[j + 2] = Math.max(0, (d[j + 2] - m) * k); }
        let mn = a; for (let dy = -2; dy <= 2; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) { mn = 0; continue; } for (let dx = -2; dx <= 2; dx++) { if (Math.abs(dx) + Math.abs(dy) > 3) continue; const xx = x + dx; if (xx < 0 || xx >= w) { mn = 0; continue; } const v = a0[yy * w + xx]; if (v < mn) mn = v; } }
        d[j + 3] = Math.round(a * (0.15 + 0.85 * mn / 255));
      }
      cx.putImageData(img, 0, 0); c.naturalWidth = w; c.naturalHeight = h; c.complete = true; return c;
    } catch (e) { return im; /* a file:// page cannot read pixels; the raw sprite still draws */ }
  }
  function getImage(path) {
    let im = imgCache[path];
    if (!im) { im = new Image(); imgCache[path] = im; im.onload = () => { if (imgCache[path] === im) imgCache[path] = cleanSprite(im); if (api.onImageLoad) api.onImageLoad(); }; im.src = path; }
    if (im instanceof HTMLImageElement) { if (im.complete && im.naturalWidth) { imgCache[path] = cleanSprite(im); return imgCache[path]; } return null; }
    return im;
  }
  function spriteSet(p) { return (global.SPRITE_MANIFEST || {})[p.id] || null; }
  const usableEntry = (e) => e && e.file && !e.rejected;
  function resolveSprite(p, state) { const set = spriteSet(p); if (!set) return null; for (const s of FALLBACK[state] || [state]) { const e = set[s]; if (usableEntry(e)) { const im = getImage(e.file); if (im) return { im, state: s }; } } return null; }
  function hasSprites(p) { const set = spriteSet(p); return !!(set && Object.values(set).some(usableEntry)); }
  function spriteAspect(p) { const set = spriteSet(p); if (!set) return null; for (const s of ['leaf', 'flower', 'spring', 'autumn', 'fruit', 'bare']) { const e = set[s]; if (e && e.w && e.h) return e.w / e.h; } return null; }
  function drawSprite(ctx, im, x, y, h, alpha) { const w = h * im.naturalWidth / im.naturalHeight; ctx.save(); ctx.globalAlpha *= alpha; ctx.drawImage(im, x - w / 2, y - h, w, h); ctx.restore(); return w; }

  function drawPlant(ctx, p, st, x, y, ppm, seed, opts) {
    opts = opts || {}; const sizeF = opts.size || 1;
    const w = Math.max(3, p.s * ppm * sizeF), h = Math.max(3, p.h * ppm * sizeF), rnd = mulberry32(seed);
    ctx.save(); shadowsOff = !!opts.noShadow; if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    if (hasSprites(p) && opts.t != null) {
      const blend = global.Phenology.spriteBlend(p, opts.t);
      /* a flowering or fruiting photo must not stand in for a leaf-only month: draw those months instead */
      const usable = (want, got) => got && !((want === 'leaf' || want === 'spring' || want === 'autumn' || want === 'bare') && (got.state === 'flower' || got.state === 'fruit'));
      let a = resolveSprite(p, blend[0].state), b = resolveSprite(p, blend[1].state);
      if (!usable(blend[0].state, a)) a = null; if (!usable(blend[1].state, b)) b = null;
      if (a || b) {
        shadow(ctx, x, y, (a || b) ? h * ((a || b).im.naturalWidth / (a || b).im.naturalHeight) : w);
        const drawn = (wgt) => { /* the non-photo part of the blend, drawn from the plant's own description at that moment */
          ctx.save(); ctx.globalAlpha *= wgt; const drawSt = Object.assign({}, st, { flower: 0, fruit: 0 });
          const f = { tree: drawTree, shrub: drawShrub, climber: drawClimber, perennial: drawPerennial, grass: drawGrass }[p.type];
          if (f) f(ctx, p, drawSt, x, y, w, h, rnd); else drawBulb(ctx, p, drawSt, x, y, w, h, rnd, ppm); ctx.restore();
        };
        if (!a) drawn(blend[0].w); if (!b) drawn(blend[1].w);
        if (a && b && a.im === b.im) drawSprite(ctx, a.im, x, y, h, 1); else { if (a) drawSprite(ctx, a.im, x, y, h, blend[0].w); if (b) drawSprite(ctx, b.im, x, y, h, blend[1].w); }
        ctx.restore(); shadowsOff = false; return { w, h };
      }
    }
    switch (p.type) {
      case 'tree': drawTree(ctx, p, st, x, y, w, h, rnd); break;
      case 'shrub': drawShrub(ctx, p, st, x, y, w, h, rnd); break;
      case 'climber': drawClimber(ctx, p, st, x, y, w, h, rnd); break;
      case 'perennial': drawPerennial(ctx, p, st, x, y, w, h, rnd); break;
      case 'grass': drawGrass(ctx, p, st, x, y, w, h, rnd); break;
      case 'bulb': drawBulb(ctx, p, st, x, y, w, h, rnd, ppm); break;
    }
    ctx.restore(); shadowsOff = false; return { w, h };
  }
  function bounds(p, x, y, ppm, sizeF) {
    const asp = spriteAspect(p), h = Math.max(12, p.h * ppm * (sizeF || 1));
    const w = asp ? Math.max(12, h * asp) : Math.max(12, p.s * ppm * (sizeF || 1));
    const ww = p.type === 'bulb' && !asp ? Math.max(w * 2.5, ppm * 0.35) : w;
    return { x0: x - ww / 2, x1: x + ww / 2, y0: y - h, y1: y + Math.max(4, ww * 0.12) };
  }
  /* load every usable sprite of these plants before an export draws them */
  function preload(plants) {
    const files = new Set(); plants.forEach(p => { const set = spriteSet(p); if (set) Object.values(set).forEach(e => { if (usableEntry(e)) files.add(e.file); }); });
    return Promise.all([...files].map(f => new Promise(res => { const im = getImage(f); if (im) return res(); const raw = imgCache[f]; if (!raw || !(raw instanceof HTMLImageElement)) return res(); raw.addEventListener('load', () => { getImage(f); res(); }, { once: true }); raw.addEventListener('error', res, { once: true }); setTimeout(res, 8000); })));
  }
  global.Render = { drawPlant, bounds, mulberry32, hasSprites, api, leafShape, flowerForm, preload };
})(window);
