/* Phase 8 Layer-1 parity — BLOB TRACKER tracker core (base video +
 * detect + blob markers + connections) vs the standalone's DEFAULT state.
 *
 * At boot the standalone renders exactly L1: FX.blob+conn on, everything
 * else off (ripple/panels/contour/flow/fixedPts all off), and its
 * bgFxMode-off else-branch is a no-op at default (_applyFxBg touches
 * nothing when no FX flag is set). So default #dc == the L1 node output.
 * Both pinned to 1280×720, paused on the same frame; slider-driven configs
 * with a direct 1:1 value mapping exercise processForDetect / getBinary /
 * findBlobs / drawBlobMarker / drawConnections. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const DW = 160, DH = 90;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DEFAULTS = { threshold: 127, minArea: 100, brightness: 31, contrast: 2.15, connWidth: 10 };
const CONFIGS = [
  { name: 'default', p: {} },
  { name: 'thr-low', p: { threshold: 80 } },
  { name: 'thr-high', p: { threshold: 180 } },
  { name: 'minarea-high', p: { minArea: 800 } },
  { name: 'bri-high', p: { brightness: 80 } },
  { name: 'con-high', p: { contrast: 4 } },
  { name: 'connwidth-thin', p: { connWidth: 3 } },
];

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
const corr = (a, b) => {
  const ma = meanOf(a), mb = meanOf(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i]-ma, y = b[i]-mb; n += x*y; da += x*x; db += y*y; }
  return n / Math.sqrt(da*db || 1);
};
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]-b[i]); return s / a.length; };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  // blob_tracker uses THREE in its init — serve the three.js r128 mirror so
  // the standalone script finishes wiring (its file-input handler); block
  // everything else (fonts / MediaPipe not needed at the default tracker state)
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
  await sa.setInputFiles('#fi-v', clip); // #fi-v = video file input → loadVideo → startTracker
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

  const pinned = await en.evaluate(async () => {
    const S = window.__SYN;
    if (!S) return 'no tap';
    S.engine.adaptiveRes = false;
    S.engine.setResScale(2 / 3);
    const v = S.engine.source;
    if (!v) return 'no source';
    v.pause(); v.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    const c = document.querySelector('[data-testid="chain-canvas"]');
    return `${c.width}x${c.height}@${v.currentTime.toFixed(2)}s`;
  });
  step('engine pinned (adaptive off, 2/3 = 1280×720, paused)', /^1280x720@1\.0/.test(pinned), pinned);

  const saPinned = await sa.evaluate(async () => {
    const dc = document.getElementById('dc');
    dc.width = 1280; dc.height = 720;
    const v = document.getElementById('vid');
    v.pause(); v.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    return `${dc.width}x${dc.height}@${v.currentTime.toFixed(2)}s`;
  });
  step('standalone pinned (1280×720 dc, default tracker, paused same frame)', /^1280x720@1\.0/.test(saPinned), saPinned);

  const SL = { threshold: 'sThr', minArea: 'sMin', brightness: 'sBri', contrast: 'sCon', connWidth: 'sLW' };
  const applySA = (over) => sa.evaluate(({ P2, SL }) => {
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.getElementById(SL[k]); if (!el) return;
      el.value = val; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, { P2: { ...DEFAULTS, ...over }, SL });
  const applyEN = (over) => en.evaluate((P2) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`);
      if (!el || el.type !== 'range') return;
      setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, { ...DEFAULTS, ...over });
  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
  const settled = async (page, sel) => {
    let prev = await grab(page, sel);
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(280);
      const cur = await grab(page, sel);
      if (mad(prev, cur) < 0.001) return cur;
      prev = cur;
    }
    return prev;
  };

  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg.p); await applyEN(cfg.p);
    await sa.waitForTimeout(500);
    const sG = await settled(sa, '#dc');
    const eG = await settled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG), d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`L1 ${cfg.name}`, c > 0.9 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase8-L1-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nL1 summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
