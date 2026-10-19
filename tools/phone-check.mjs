/* Phone and desktop checks for Netgarden, driven by Playwright.
 *   node tools/phone-check.mjs [url] [shots-dir]
 * Serves nothing itself: run `python3 -m http.server 8123` in the repository root first.
 * Needs playwright on NODE_PATH or in node_modules (npm i -D playwright) and a Chromium.
 * It taps, drags, pinches and swipes an emulated iPhone through every step, checks mouse
 * and keyboard on a desktop viewport, and writes screenshots of each step. */
import { chromium, devices } from 'playwright';
import fs from 'fs';
const URL = process.argv[2] || 'http://localhost:8123/';
const OUT = process.argv[3] || 'phone-check-shots';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const results = []; const check = (name, ok, detail) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`);

/* ---------- phone gestures (real multi-touch through CDP) ---------- */
{
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'] });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await page.waitForTimeout(1200);
  const ng = (fn) => page.evaluate(fn);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await touch('touchEnd', []); };
  const swipe = async (from, to, steps = 12, hold = 0) => { await touch('touchStart', [from]); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps]]); await page.waitForTimeout(12); } if (hold) await page.waitForTimeout(hold); await touch('touchEnd', []); };
  const pinch = async (c, d0, d1, steps = 12) => { const a = (d) => [[c[0] - d / 2, c[1]], [c[0] + d / 2, c[1]]]; await touch('touchStart', a(d0)); for (let i = 1; i <= steps; i++) { await touch('touchMove', a(d0 + (d1 - d0) * i / steps)); await page.waitForTimeout(12); } await touch('touchEnd', []); };
  const rect = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const screenOf = () => ng(() => { const g = window.netgarden, p = g.state.plants[0], q = g.cam.toImage(p.X, p.Z); const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + g.view.ox + q.x * g.view.scale, y: r.top + g.view.oy + q.y * g.view.scale }; });
  const shot = (n) => page.screenshot({ path: `${OUT}/iphone-${n}.png` });
  let s, cv, pos;
  await shot('1-plants');
  await page.locator('#plantList .card').first().tap(); await page.waitForTimeout(500);
  s = await ng(() => ({ pos: window.netgarden.sheet.pos, lib: window.netgarden.state.libSel }));
  check('card tap drops sheet to peek', s.pos === 'peek' && !!s.lib, JSON.stringify(s)); await shot('2-plant-chosen');
  cv = await rect('#view'); await tap(cv.x + cv.w * 0.5, cv.y + cv.h * 0.62); await page.waitForTimeout(400);
  let n = await ng(() => window.netgarden.state.plants.length); check('one tap plants exactly one plant', n === 1, 'plants=' + n); await shot('3-plant-placed');
  await page.locator('#cancelBtn').tap(); await page.waitForTimeout(300);
  let before = await ng(() => window.netgarden.state.plants[0].X); pos = await screenOf();
  await swipe([pos.x, pos.y - 20], [pos.x + 60, pos.y - 30], 10, 80); await page.waitForTimeout(400);
  let after = await ng(() => ({ n: window.netgarden.state.plants.length, X: window.netgarden.state.plants[0].X }));
  check('drag moves the plant and keeps the count', after.n === 1 && Math.abs(after.X - before) > 0.2, JSON.stringify(after));
  await ng(() => window.netgarden.setSheet('peek')); await page.waitForTimeout(400);
  pos = await screenOf(); await tap(pos.x, pos.y - 20); await page.waitForTimeout(500);
  s = await ng(() => ({ sel: window.netgarden.state.sel, pos: window.netgarden.sheet.pos }));
  check('tap on a plant selects it and raises the sheet to half', !!s.sel && s.pos === 'half', JSON.stringify(s)); await shot('4-plant-selected');
  await ng(() => window.netgarden.setSheet('peek')); await page.waitForTimeout(400);
  cv = await rect('#view'); const centre = [cv.x + cv.w / 2, cv.y + cv.h / 2];
  before = await ng(() => window.netgarden.state.plants[0].X);
  await pinch(centre, 60, 220); await page.waitForTimeout(400);
  let z = await ng(() => ({ zoom: window.netgarden.view.zoom, X: window.netgarden.state.plants[0].X, n: window.netgarden.state.plants.length }));
  check('pinch out zooms in without moving or adding plants', z.zoom > 1.5 && z.zoom <= 5 && Math.abs(z.X - before) < 1e-6 && z.n === 1, JSON.stringify(z));
  await pinch(centre, 300, 40); await page.waitForTimeout(500);
  z = await ng(() => window.netgarden.view.zoom); check('pinch in past the limit settles back to 1', Math.abs(z - 1) < 1e-3, 'zoom=' + z);
  let hd = await rect('#sheetHead'); await swipe([hd.x + hd.w / 2, hd.y + 20], [hd.x + hd.w / 2, hd.y - 300], 14); await page.waitForTimeout(500);
  s = await ng(() => window.netgarden.sheet.pos); check('swipe handle up goes to full', s === 'full', s);
  hd = await rect('#sheetHead'); await swipe([hd.x + hd.w / 2, hd.y + 20], [hd.x + hd.w / 2, hd.y + 500], 14); await page.waitForTimeout(500);
  s = await ng(() => window.netgarden.sheet.pos); check('swipe handle down goes to peek', s === 'peek', s);
  await ng(() => window.netgarden.setSheet('half')); await page.waitForTimeout(400);
  const pn = await rect('#panel-plants'); await swipe([pn.x + pn.w / 2, pn.y + 60], [pn.x + pn.w / 2, pn.y - 240], 14); await page.waitForTimeout(500);
  s = await ng(() => window.netgarden.sheet.pos); check('swipe panel content up raises sheet to full', s === 'full', s);
  await page.locator('#search').tap(); await page.waitForTimeout(400);
  s = await ng(() => ({ pos: window.netgarden.sheet.pos, scroll: document.getElementById('layout').scrollTop, focused: document.activeElement.id }));
  check('search focus: sheet full, frame not scrolled', s.pos === 'full' && s.scroll === 0 && s.focused === 'search', JSON.stringify(s)); await shot('5-search');
  await ng(() => window.netgarden.setSheet('peek')); await page.waitForTimeout(400);
  const bd = await rect('#bands'); await swipe([bd.x + bd.w * 0.2, bd.y + bd.h / 2], [bd.x + bd.w * 0.8, bd.y + bd.h / 2], 10); await page.waitForTimeout(300);
  const t1 = await ng(() => window.netgarden.state.t); check('scrubbing the flower bands changes the month', Math.abs(t1 - 9.6) < 0.6, 't=' + t1.toFixed(2));
  await ng(() => { window.netgarden.showStep('photo'); window.netgarden.setSheet('peek'); }); await page.waitForTimeout(500); await shot('6-photo');
  const hy = await ng(() => { const g = window.netgarden; const r = document.getElementById('view').getBoundingClientRect(); return { x: r.left + g.view.ox + 0.5 * g.state.photo.w * g.view.scale, y: r.top + g.view.oy + g.cam.horizonY * g.view.scale, h: g.state.ground.horizon }; });
  await swipe([hy.x, hy.y + 12], [hy.x, hy.y + 40], 10, 100); await page.waitForTimeout(400);
  const h2 = await ng(() => window.netgarden.state.ground.horizon); check('finger drag 12px off the horizon line still grabs it', h2 > hy.h + 0.01, `${hy.h.toFixed(3)} -> ${h2.toFixed(3)}`);
  await ng(() => window.netgarden.showStep('beds')); await page.waitForTimeout(300); await shot('7-beds');
  await page.locator('#bedDraw').tap(); await page.waitForTimeout(400); cv = await rect('#view');
  for (const [fx, fy] of [[0.3, 0.6], [0.7, 0.6], [0.6, 0.75], [0.35, 0.75]]) { await tap(cv.x + cv.w * fx, cv.y + cv.h * fy); await page.waitForTimeout(150); }
  const corners = await ng(() => (window.netgarden.state.drawingBed || []).length);
  await page.locator('#doneBtn').tap({ timeout: 3000 }); await page.waitForTimeout(400);
  const beds = await ng(() => window.netgarden.state.beds.length); check('bed: four corner taps then Done makes a border', corners === 4 && beds === 1, `corners=${corners} beds=${beds}`);
  await ng(() => window.netgarden.showStep('review')); await page.waitForTimeout(400); await shot('8-review');
  await page.locator('#clearAll').tap({ timeout: 5000 }); await page.waitForTimeout(300);
  const dlgOpen = await ng(() => document.getElementById('confirmDlg').open);
  await page.locator('#confirmDlg button[value=cancel]').tap(); await page.waitForTimeout(300);
  const still = await ng(() => window.netgarden.state.plants.length); check('clear design asks in-app and cancel keeps the plants', dlgOpen && still === 1, `open=${dlgOpen} plants=${still}`);
  const small = await ng(() => { const bad = []; document.querySelectorAll('input:not([hidden]):not([type=range]):not([type=checkbox]):not([type=file]), select').forEach(el => { if (el.offsetParent === null) return; if (parseFloat(getComputedStyle(el).fontSize) < 16) bad.push(el.id || el.tagName); }); return bad; });
  check('visible text inputs and selects are 16px or larger (no Safari auto-zoom)', small.length === 0, small.join(','));
  const tiny = await ng(() => { const bad = []; document.querySelectorAll('button, .btn, .card, .chips button').forEach(el => { if (el.offsetParent === null || el.closest('.hidden')) return; const r = el.getBoundingClientRect(); if (r.height < 36 && r.width < 44) bad.push((el.id || el.className) + ':' + Math.round(r.width) + 'x' + Math.round(r.height)); }); return bad.slice(0, 10); });
  check('no visible control under 36px tall and 44px wide', tiny.length === 0, tiny.join(','));
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
/* ---------- phone, landscape ---------- */
{
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro landscape'] }); const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/iphone-landscape.png` });
  const tb = await page.evaluate(() => document.getElementById('timebar').parentElement.id);
  check('landscape: time bar under the photo, panel beside it', tb === 'stage', tb);
  check('landscape: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}
/* ---------- desktop: mouse, wheel, keyboard ---------- */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL); await page.waitForTimeout(1200);
  const ng = (fn) => page.evaluate(fn);
  await page.screenshot({ path: `${OUT}/desktop-plants.png` });
  await page.locator('#plantList .card').nth(3).click(); await page.waitForTimeout(200);
  const r = await page.locator('#view').boundingBox();
  await page.mouse.click(r.x + r.width * 0.5, r.y + r.height * 0.7); await page.waitForTimeout(300);
  const n = await ng(() => window.netgarden.state.plants.length); check('mouse: card then lawn click plants one', n === 1, 'plants=' + n);
  await page.locator('#cancelBtn').click(); await page.waitForTimeout(200);
  const sp = await ng(() => { const g = window.netgarden, p = g.state.plants[0], q = g.cam.toImage(p.X, p.Z); const c = document.getElementById('view').getBoundingClientRect(); return { x: c.left + g.view.ox + q.x * g.view.scale, y: c.top + g.view.oy + q.y * g.view.scale, X: p.X }; });
  await page.mouse.move(sp.x, sp.y - 15); await page.mouse.down(); await page.mouse.move(sp.x + 80, sp.y - 15, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(200);
  const X2 = await ng(() => window.netgarden.state.plants[0].X); check('mouse: drag moves the plant', Math.abs(X2 - sp.X) > 0.2, `${sp.X.toFixed(2)} -> ${X2.toFixed(2)}`);
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
  const z = await ng(() => window.netgarden.view.zoom); check('mouse: wheel zooms in', z > 1, 'zoom=' + z.toFixed(2));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
  const X3 = await ng(() => window.netgarden.state.plants[0].X); check('keyboard: Ctrl+Z undoes the move', Math.abs(X3 - sp.X) < 1e-6, X3.toFixed(2));
  await page.mouse.move(sp.x + 2, sp.y - 20); await page.waitForTimeout(100);
  const cursor = await ng(() => document.getElementById('view').style.cursor); check('mouse: hover over a plant shows the move cursor', cursor === 'move', cursor);
  check('desktop: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}
await browser.close();
console.log(results.join('\n'));
const failed = results.filter(r => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}/`);
process.exit(failed ? 1 : 0);
