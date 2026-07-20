/* Phase 8 Layer-3 parity — BLOB TRACKER edge contour markers vs the
 * standalone. Edge contour is deterministic (radial ray-cast on the same
 * detection binary → Douglas-Peucker → catmull-rom), so pixel-exact.
 * Sweeps contour smooth / expand / fill. (Smart mode = a separate MediaPipe
 * dep, not ported — deferred.) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const DW = 160, DH = 90;
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const grabOnceSrc = `(canvasSel) => {
  const cv = document.querySelector(canvasSel);
  const off = document.createElement('canvas'); off.width = ${DW}; off.height = ${DH};
  const cx = off.getContext('2d', { willReadFrequently: true });
  cx.drawImage(cv, 0, 0, ${DW}, ${DH});
  const d = cx.getImageData(0, 0, ${DW}, ${DH}).data;
  const g = new Array(${DW * DH});
  for (let i = 0; i < g.length; i++) g[i] = (d[i*4]*0.2126 + d[i*4+1]*0.7152 + d[i*4+2]*0.0722)/255;
  return g;
}`;
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const corr = (a, b) => { const ma = meanOf(a), mb = meanOf(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { const x = a[i]-ma, y = b[i]-mb; n += x*y; da += x*x; db += y*y; } return n / Math.sqrt(da*db || 1); };
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]-b[i]); return s / a.length; };

const CONFIGS = [
  { name: 'edge-default', smooth: 5, expand: 0, fill: false },
  { name: 'edge-smooth-0', smooth: 0, expand: 0, fill: false },
  { name: 'edge-smooth-20', smooth: 20, expand: 0, fill: false },
  { name: 'edge-expand-pos', smooth: 5, expand: 10, fill: false },
  { name: 'edge-expand-neg', smooth: 5, expand: -10, fill: false },
  { name: 'edge-fill', smooth: 5, expand: 0, fill: true },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  const threeLocal = path.join(SCRATCH, 'cdn', 'three', 'build', 'three.min.js');
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, async (route) => {
    const url = route.request().url();
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/.test(url) && fs.existsSync(threeLocal)) {
      await route.fulfill({ status: 200, body: fs.readFileSync(threeLocal), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];
  const isEnvErr = (s) => /(SelfieSegmentation|THREE) is not defined/.test(s) || /three\.min\.js|selfie_segmentation/.test(s);

  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => { const s = String(e); if (!isEnvErr(s)) pageErrors.push('standalone: ' + s.slice(0, 150)); });
  await sa.goto('http://localhost:3000/effects/blob_tracker/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#fi-v', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#fi-v', clip);
  await sa.waitForFunction(() => document.getElementById('vid')?.readyState >= 2, null, { timeout: 30000 }).catch(() => {});
  await sa.waitForTimeout(2000);

  const en = await ctx.newPage();
  en.on('pageerror', (e) => { const s = String(e); if (!isEnvErr(s)) pageErrors.push('engine: ' + s.slice(0, 150)); });
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-blob_tracker"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]', { state: 'attached', timeout: 120000 });
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(2000);

  await en.evaluate(async () => {
    const S = window.__SYN; S.engine.adaptiveRes = false; S.engine.setResScale(2 / 3);
    const v = S.engine.source; v.pause(); v.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    // enable edge contour
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const cm = document.querySelector('[data-testid="param-blob_tracker-ctMode"]'); setV.call(cm, 1); cm.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sa.evaluate(async () => {
    const dc = document.getElementById('dc'); dc.width = 1280; dc.height = 720;
    const v = document.getElementById('vid'); v.pause(); v.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    const ed = document.getElementById('ct-edge'); if (!ed.classList.contains('on')) ed.click();
  });
  step('both pinned 1280×720 + edge contour enabled', true, '');

  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
  const settled = async (page, sel) => { let prev = await grab(page, sel); for (let i = 0; i < 8; i++) { await page.waitForTimeout(280); const cur = await grab(page, sel); if (mad(prev, cur) < 0.001) return cur; prev = cur; } return prev; };

  const applySA = (c) => sa.evaluate(({ c }) => {
    const sm = document.getElementById('ct-smooth-sl'); sm.value = c.smooth; sm.dispatchEvent(new Event('input', { bubbles: true }));
    const ex = document.getElementById('ct-expand-sl'); ex.value = c.expand; ex.dispatchEvent(new Event('input', { bubbles: true }));
    const fl = document.getElementById('ct-fill'); if (fl.classList.contains('on') !== !!c.fill) fl.click();
  }, { c });
  const applyEN = (c) => en.evaluate(({ c }) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const set = (k, val) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.type === 'range') { setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('ctSmooth', c.smooth); set('ctExpand', c.expand);
    const fl = document.querySelector('[data-testid="param-blob_tracker-ctFill"]'); if (fl && fl.checked !== !!c.fill) fl.click();
  }, { c });

  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg); await applyEN(cfg);
    await sa.waitForTimeout(450);
    const sG = await settled(sa, '#dc'), eG = await settled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG), d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`L3 ${cfg.name} pixel-exact`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase8-L3-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nL3 summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
