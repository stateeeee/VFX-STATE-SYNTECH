/* Phase 7 static parity — BLOB REVEAL standalone vs SynEngine node.
 *
 * The deterministic core of the effect is the bright-region blob-window
 * pipeline (segEnabled OFF): 320×180 luma threshold → dilate → BFS
 * connected components → top-N windows clipping the full-res video onto
 * black. It needs no segmentation mask, so it is pixel-compared here across
 * a battery of detection configs. The subject-reveal (mask erode/feather/
 * destination-in cut) and audio-reactive blob expansion are behavioural
 * (they need the shared mask / real audio) and live in the behavior suite.
 *
 * Sizing: the standalone canvas is viewport-fit, not fixed. Both sides are
 * pinned to 1280×720 — the engine via resScale 2/3 (1920×1080 clip), the
 * standalone by forcing its dc/c-* canvases to 1280×720 through their DOM
 * ids (fit() only runs on load, so the forced size sticks). minPx and blob
 * scaling depend on W×H, so the match must be exact. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const SHOTS = path.join(SCRATCH, 'shots');
const DW = 160, DH = 90;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* standalone boot state (P), blob-relevant subset */
const DEFAULTS = { lumThr: 170, minArea: 300, maxBlobs: 14, dilate: 4 };

const CONFIGS = [
  { name: 'defaults', p: {} },
  { name: 'lum-low', p: { lumThr: 100 } },
  { name: 'lum-high', p: { lumThr: 220 } },
  { name: 'minarea-low', p: { minArea: 20 } },
  { name: 'minarea-high', p: { minArea: 2000 } },
  { name: 'maxblobs-1', p: { maxBlobs: 1 } },
  { name: 'maxblobs-30', p: { maxBlobs: 30 } },
  { name: 'dilate-0', p: { dilate: 0 } },
  { name: 'dilate-high', p: { dilate: 15 } },
  { name: 'combo', p: { lumThr: 140, minArea: 100, maxBlobs: 20, dilate: 8 } },
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
  // no CDN: seg is OFF, no MediaPipe needed on either side
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  const sa = await ctx.newPage();
  // the standalone eagerly runs initSeg() at load; with the CDN intentionally
  // blocked here (seg is OFF, MediaPipe unneeded) `new SelfieSegmentation`
  // throws once — an environment artefact, not a port defect, so it is
  // filtered out of the page-error gate (the same blocked-CDN allowance as
  // Phases 5–6).
  const isEnvSegError = (s) => /SelfieSegmentation is not defined/.test(s);
  sa.on('pageerror', (e) => { const s = String(e); if (!isEnvSegError(s)) pageErrors.push('standalone: ' + s.slice(0, 150)); });
  await sa.goto('http://localhost:3000/effects/blob_reveal/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#file-input', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2500);

  const en = await ctx.newPage();
  en.on('pageerror', (e) => pageErrors.push('engine: ' + String(e).slice(0, 150)));
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-blob_reveal"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]', { state: 'attached', timeout: 120000 });
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(2000);

  /* pin engine → 1280×720, seg OFF, paused on t=1.0 */
  const pinned = await en.evaluate(async () => {
    const S = window.__SYN;
    if (!S) return 'no tap';
    S.engine.adaptiveRes = false;
    S.engine.setResScale(2 / 3);
    // turn segEnabled OFF (blob windows only)
    const seg = document.querySelector('[data-testid="param-blob_reveal-segEnabled"]');
    if (seg && seg.checked) seg.click();
    const v = S.engine.source;
    if (!v) return 'no source';
    v.pause();
    v.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    const c = document.querySelector('[data-testid="chain-canvas"]');
    return `${c.width}x${c.height}@${v.currentTime.toFixed(2)}s`;
  });
  step('engine pinned (adaptive off, 2/3 = 1280×720, seg off, paused)', /^1280x720@1\.0/.test(pinned), pinned);

  /* standalone: force canvases to 1280×720, seg OFF, paused on t=1.0 */
  const saPinned = await sa.evaluate(async () => {
    ['dc', 'c-blob', 'c-mask', 'c-sub', 'c-erode'].forEach((id) => {
      const c = document.getElementById(id); c.width = 1280; c.height = 720;
    });
    // seg OFF via the toggle (starts ENABLED)
    const btn = document.getElementById('btn-seg');
    if (btn.classList.contains('on')) btn.click();
    const v = document.getElementById('vid');
    v.pause(); v.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    const dc = document.getElementById('dc');
    return `${dc.width}x${dc.height}@${v.currentTime.toFixed(2)}s seg=${btn.classList.contains('on')}`;
  });
  step('standalone pinned (1280×720 forced, seg off, paused same frame)', /^1280x720@1\.0.*seg=false/.test(saPinned), saPinned);

  const SL = { lumThr: 'sl-lum', minArea: 'sl-minarea', maxBlobs: 'sl-maxblobs', dilate: 'sl-dil' };
  const applySA = (over) => sa.evaluate(({ P2, SL }) => {
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.getElementById(SL[k]);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, { P2: { ...DEFAULTS, ...over }, SL });
  const applyEN = (over) => en.evaluate((P2) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.querySelector(`[data-testid="param-blob_reveal-${k}"]`);
      if (!el || el.type !== 'range') return;
      setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, { ...DEFAULTS, ...over });
  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
  // paused source → output is static once the param change has propagated one
  // rendered frame; a light settle guards against grabbing mid-update
  const settled = async (page, sel) => {
    let prev = await grab(page, sel);
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(250);
      const cur = await grab(page, sel);
      if (mad(prev, cur) < 0.0008) return cur;
      prev = cur;
    }
    return prev;
  };

  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg.p);
    await applyEN(cfg.p);
    await sa.waitForTimeout(500);
    const sG = await settled(sa, '#dc');
    const eG = await settled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG);
    const d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`static ${cfg.name}`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  const shot = async (page, sel, file) => {
    const dataUrl = await page.evaluate((s) => document.querySelector(s).toDataURL('image/png'), sel);
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  };
  await applySA({ lumThr: 140, minArea: 100, maxBlobs: 20, dilate: 8 });
  await applyEN({ lumThr: 140, minArea: 100, maxBlobs: 20, dilate: 8 });
  await sa.waitForTimeout(700);
  await settled(sa, '#dc'); await settled(en, '[data-testid="chain-canvas"]');
  await shot(sa, '#dc', 'p7s-combo-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p7s-combo-engine.png');

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase7-static-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nstatic summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
