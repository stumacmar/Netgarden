/* Render starting images for the local image model: each plant and state drawn by the app's
 * own renderer on white at 512x512. Usage: node tools/render_inits.js <out-dir> [pid:state ...]
 * With no pairs, renders the primary state of every plant. Needs playwright. */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2]); const pairs = process.argv.slice(3);
const html = `<!doctype html><html><body style="margin:0;background:#fff"><canvas id="c" width="512" height="512"></canvas>
<script src="file://${ROOT}/js/phenology.js"></script><script src="file://${ROOT}/js/plants.js"></script><script src="file://${ROOT}/js/render.js"></script>
<script>
window.stateT = (p, st) => { const m = { flower: p.flower ? p.flower.m[Math.floor(p.flower.m.length / 2)] : 7, fruit: p.fruit ? p.fruit.m[Math.floor(p.fruit.m.length / 2)] : 9, autumn: p.leafFall ? p.leafFall - 1 : 10, bare: 1, spring: p.leafOut || 4, leaf: 7 }[st];
  let t = m - 0.5; if (st === 'leaf' && p.flower && p.flower.m.includes(7)) { const free = [6, 8, 5, 9, 7].find(x => !p.flower.m.includes(x)); t = (free || 7) - 0.5; } return t; };
window.renderOne = (id, st) => { const c = document.getElementById('c'), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 512, 512);
  const p = window.PLANTS.byId[id], t = window.stateT(p, st); const ppm = Math.min(420 / Math.max(p.h, 0.4), 440 / Math.max(p.s, 0.4));
  window.Render.drawPlant(x, p, window.Phenology.stateAt(p, t), 256, 480, ppm, 99, { t, noShadow: true }); return c.toDataURL('image/png'); };
window.primary = () => window.PLANTS.all.map(p => p.id + ':' + (p.flower ? 'flower' : 'leaf'));
</script></body></html>`;
const tmp = path.join(out, '_init.html'); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(tmp, html);
(async () => {
  const b = await chromium.launch(); const page = await b.newPage(); page.on('pageerror', e => console.error('pageerror', e.message));
  await page.goto('file://' + tmp); await page.waitForTimeout(300);
  const list = pairs.length ? pairs : await page.evaluate(() => window.primary());
  let n = 0;
  for (const pr of list) { const [pid, st] = pr.split(':'); const d = await page.evaluate(([pid, st]) => window.renderOne(pid, st), [pid, st]); const dir = path.join(out, pid); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, st + '.png'), Buffer.from(d.split(',')[1], 'base64')); n++; }
  console.log('rendered', n, 'init images'); await b.close();
})();
