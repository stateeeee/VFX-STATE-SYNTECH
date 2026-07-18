/* Phase 5 static parity — BOKEH standalone vs SynEngine node.
 * Both sides pinned (engine adaptiveRes off @1:1, both videos paused on the
 * same 1080p frame) and fed the SAME injected person mask so the comparison
 * is independent of MediaPipe: standalone via its global onSegResults(),
 * engine via the PersonMask service tap (state/ready/maskCanvas/version).
 * The bokeh kernel's gold-noise jitter is clock-seeded per side, so a small
 * per-pixel shimmer is expected — thresholds match the Phase 4 gates. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const SHOTS = path.join(SCRATCH, 'shots');
const DW = 128, DH = 72;
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

/* every P key the node exposes, at the standalone's defaults */
const DEFAULTS = {
  bokehRadius: 18, bokehStyle: 0, bokehBloom: 1.2, bokehFeather: 0.42, bokehVignette: 0.35,
  bshapeX: 0, bshapeY: 0,
  anamSqueeze: 1, anamRatio: 2.39, anamBarrel: 0.22, anamVignette: 0.4,
  anamLetterbox: 1, anamBreathing: 0,
  distortMode: 0, distortSwirl: 1.8, distortFalloff: 2.5, distortExplosive: 0.4, distortSqueeze: 1.5,
  bgfxStyle: 0,
};

const CONFIGS = [
  { name: 'defaults', p: {} },
  { name: 'radius-min', p: { bokehRadius: 2 } },
  { name: 'radius-max', p: { bokehRadius: 50 } },
  { name: 'style-swirly', p: { bokehStyle: 1 } },
  { name: 'style-explosive', p: { bokehStyle: 2 } },
  { name: 'style-anamorphic', p: { bokehStyle: 3 } },
  { name: 'style-pad-center', p: { bokehStyle: 4, bshapeX: 0, bshapeY: 0 } },
  { name: 'style-pad-star', p: { bokehStyle: 4, bshapeX: -0.84, bshapeY: -0.84 } },
  { name: 'feather-0', p: { bokehFeather: 0 } },
  { name: 'feather-1', p: { bokehFeather: 1 } },
  { name: 'vignette-max', p: { bokehVignette: 1 } },
  { name: 'anam-full', p: { anamSqueeze: 1.8, anamBarrel: 1, anamVignette: 1, anamRatio: 2.0 } },
  { name: 'letterbox-off', p: { anamLetterbox: 0 } },
  { name: 'ratio-max', p: { anamRatio: 2.8 } },
  { name: 'distort-swirl', p: { distortMode: 1, distortSwirl: 3.0 } },
  { name: 'distort-explosive', p: { distortMode: 2, distortExplosive: 1 } },
  { name: 'distort-anam', p: { distortMode: 3, distortSqueeze: 2 } },
  { name: 'hero-static', p: { bokehRadius: 28, bokehStyle: 3, bokehBloom: 2, bokehFeather: 0.5, bokehVignette: 0.5, anamSqueeze: 1.4, anamBarrel: 0.5, anamVignette: 0.8, distortMode: 3 } },
];

/* deterministic person-like mask: torso ellipse + head, feathered edges,
 * confidence in ALPHA (what both mask paths consume) */
const maskDrawSrc = `(cv) => {
  cv.width = 480; cv.height = 270;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 480, 270);
  let gr = g.createRadialGradient(240, 165, 40, 240, 165, 100);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.78, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(240, 165, 78, 98, 0, 0, 7); g.fill();
  gr = g.createRadialGradient(240, 62, 12, 240, 62, 44);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.8, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(240, 62, 42, 0, 7); g.fill();
}`;

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
  // CDN stays blocked on purpose: neither side gets real MediaPipe, both
  // consume ONLY the injected mask (PersonMask fails soft to 'off')
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  /* ── standalone ── */
  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/bokeh/index.html', { waitUntil: 'load' });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2500);

  /* ── engine ── */
  const en = await ctx.newPage();
  en.on('pageerror', (e) => pageErrors.push('engine: ' + String(e).slice(0, 150)));
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-bokeh"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]');
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(2000);

  /* pin both sides on the same frame */
  const pinned = await en.evaluate(async () => {
    const S = window.__SYN;
    if (!S) return 'no tap';
    S.engine.adaptiveRes = false;
    S.engine.setResScale(1);
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
  step('engine pinned (adaptive off, 1:1, paused)', /^1920x1080@1\.0/.test(pinned), pinned);
  const saPinned = await sa.evaluate(async () => {
    video.pause();
    video.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    return `${video.videoWidth}x${video.videoHeight}@${video.currentTime.toFixed(2)}s`;
  });
  step('standalone pinned (paused same frame)', /@1\.0/.test(saPinned), saPinned);

  /* inject the identical mask on both sides, stepping the temporal EMA the
   * same number of times so both converge to the same smoothed mask */
  await sa.evaluate(`(() => {
    window.__pmask = document.createElement('canvas');
    (${maskDrawSrc})(window.__pmask);
  })()`);
  await en.evaluate(`(() => {
    const m = window.__SYN.mask;
    m.state = 'ready'; m.ready = true;
    if (!m.maskCanvas) { m.maskCanvas = document.createElement('canvas'); m.maskCtx = m.maskCanvas.getContext('2d'); }
    (${maskDrawSrc})(m.maskCanvas);
  })()`);
  for (let i = 0; i < 14; i++) {
    await sa.evaluate(() => onSegResults({ segmentationMask: window.__pmask }));
    const f0 = await en.evaluate(() => { const m = window.__SYN.mask; m.state = 'ready'; m.ready = true; m.version++; return window.__SYN.engine.frame; });
    // one engine frame consumes one version bump
    await en.waitForFunction((f) => window.__SYN.engine.frame > f + 1, f0, { timeout: 8000 }).catch(() => {});
  }
  const maskState = await en.evaluate(() => {
    const m = window.__SYN.mask;
    return `v=${m.version} ready=${m.ready} seg=${document.querySelector('[data-testid="seg-status"]')?.textContent}`;
  });
  step('identical mask injected both sides (EMA stepped 14×)', /v=14 ready=true/.test(maskState), maskState);

  /* param application: standalone through its own globals, engine through the rack */
  const applySA = (over) => sa.evaluate((P2) => {
    Object.entries(P2).forEach(([k, v]) => {
      if (k === 'bshapeX' || k === 'bshapeY') return;
      updateParam(k, v);
    });
    updateBshapeUI((P2.bshapeX + 1) / 2, (1 - P2.bshapeY) / 2);
  }, { ...DEFAULTS, ...over });
  const applyEN = (over) => en.evaluate((P2) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.entries(P2).forEach(([k, v]) => {
      const el = document.querySelector(`[data-testid="param-bokeh-${k}"]`);
      if (!el) return;
      if (el.type === 'range') { setV.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (el.type === 'checkbox' && el.checked !== !!v) el.click();
    });
  }, { ...DEFAULTS, ...over });
  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);

  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg.p);
    await applyEN(cfg.p);
    await sa.waitForTimeout(1600); // several frames both sides at SwiftShader pace
    const sG = await grab(sa, '#glcanvas');
    const eG = await grab(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG);
    const d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`static ${cfg.name}`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  const shot = async (page, sel, file) => {
    const box = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);
    await page.screenshot({ path: path.join(SHOTS, file), clip: box });
  };
  await shot(sa, '#glcanvas', 'p5s-hero-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p5s-hero-engine.png');
  await applySA({}); await applyEN({});
  await sa.waitForTimeout(1200);
  await shot(sa, '#glcanvas', 'p5s-defaults-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p5s-defaults-engine.png');

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase5-static-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nstatic summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
