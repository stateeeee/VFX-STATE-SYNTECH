/* Phase 6 static parity — ANAMORPHIC LAB standalone vs SynEngine node.
 * Same method as Phase 5: both sides pinned and fed the SAME injected person
 * mask (standalone via its global bkOnSegResults(), engine via the PersonMask
 * tap). The standalone caps its canvas at 1280×720 (resizeCanvasToVideo
 * MAX=1280) — the engine is pinned to resScale 2/3 so both render 1280×720;
 * the bokeh pre-pass is a fixed 1280×720 on both sides by construction.
 * Time-seeded looks (flare flicker, breathing, heavy grain) are excluded
 * here and covered behaviorally. */
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

/* the standalone's boot state: P literals + the isco preset it applies */
const DEFAULTS = {
  exposure: 0.05, temp: 0.58, lift: 0.05, contrast: 0.32, sat: 0.8, rolloff: 0.58, lutMix: 0,
  grain: 0.08, bokeh: 0.42, halation: 0.52, ca: 0.28,
  barrel: 0.26, vignette: 0.44, squeeze: 1.15, ratio: 2.39,
  letterbox: 1, breathing: 0,
  flareMaster: 0, flare: 0, flareAmt: 0.65, flareLength: 0.5, flareColor: 0, flareHeight: 0.5,
  bokehMM: 0, fStop: 4, ovalFineTune: 0, ghostGlitch: 0, compare: 0,
};

const CONFIGS = [
  { name: 'defaults-isco', p: {} },
  { name: 'raw-neutral', p: { temp: 0, lift: 0, contrast: 0, sat: 1, rolloff: 0, halation: 0, grain: 0, bokeh: 0, ca: 0, barrel: 0, vignette: 0, squeeze: 1, ratio: 1.78, letterbox: 0, exposure: 0 } },
  { name: 'temp-warm', p: { temp: 1, grain: 0 } },
  { name: 'temp-cool', p: { temp: -1, grain: 0 } },
  { name: 'lift-contrast', p: { lift: 0.15, contrast: 1, grain: 0 } },
  { name: 'sat-0', p: { sat: 0, grain: 0 } },
  { name: 'sat-max', p: { sat: 1.8, grain: 0 } },
  { name: 'rolloff-max', p: { rolloff: 1, grain: 0 } },
  { name: 'exposure-up', p: { exposure: 1, grain: 0 } },
  { name: 'exposure-down', p: { exposure: -1, grain: 0 } },
  { name: 'halation-max', p: { halation: 1, grain: 0 } },
  { name: 'bloom-max', p: { bokeh: 1, grain: 0 } },
  { name: 'ca-max', p: { ca: 1, grain: 0 } },
  { name: 'barrel-max', p: { barrel: 1, grain: 0 } },
  { name: 'vignette-max', p: { vignette: 1, grain: 0 } },
  { name: 'squeeze-max', p: { squeeze: 2.2, letterbox: 0, grain: 0 } },
  { name: 'ratio-max', p: { ratio: 2.8, grain: 0 } },
  { name: 'compare-split', p: { compare: 1, grain: 0 } },
  { name: 'bokehMM-100-f2', p: { bokehMM: 100, fStop: 2, grain: 0 } },
  { name: 'bokehMM-oval', p: { bokehMM: 100, fStop: 1.4, squeeze: 1.8, ovalFineTune: 0.3, letterbox: 0, grain: 0 } },
  { name: 'ghost-glitch', p: { bokehMM: 100, fStop: 2, ghostGlitch: 1, grain: 0 } },
  { name: 'hero-static', p: { bokehMM: 135, fStop: 2.8, squeeze: 1.3, vignette: 0.6, halation: 0.7, ca: 0.4, grain: 0 } },
];

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
  // no CDN: both sides consume ONLY the injected mask
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/anamorphic_lab/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#file-input', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(3000);

  const en = await ctx.newPage();
  en.on('pageerror', (e) => pageErrors.push('engine: ' + String(e).slice(0, 150)));
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-anamorphic_lab"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]', { state: 'attached', timeout: 120000 });
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(2000);

  /* pin: standalone caps its canvas at 1280×720 → engine at resScale 2/3 */
  const pinned = await en.evaluate(async () => {
    const S = window.__SYN;
    if (!S) return 'no tap';
    S.engine.adaptiveRes = false;
    S.engine.setResScale(2 / 3);
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
  step('engine pinned (adaptive off, 2/3 = 1280×720, paused)', /^1280x720@1\.0/.test(pinned), pinned);
  const saPinned = await sa.evaluate(async () => {
    vid.pause();
    vid.currentTime = 1.0;
    await Promise.race([
      new Promise((r) => { const on = () => { vid.removeEventListener('seeked', on); r(); }; vid.addEventListener('seeked', on); }),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    return `${cv.width}x${cv.height}@${vid.currentTime.toFixed(2)}s`;
  });
  step('standalone pinned (1280×720 canvas, paused same frame)', /^1280x720@1\.0/.test(saPinned), saPinned);

  /* identical mask both sides, temporal EMA stepped equally */
  await sa.evaluate(`(() => {
    window.__pmask = document.createElement('canvas');
    (${maskDrawSrc})(window.__pmask);
  })()`);
  await en.evaluate(`(() => {
    const m = window.__SYN.mask;
    m.state = 'ready'; m.ready = true;
    if (!m.maskCanvas) { m.maskCanvas = document.createElement('canvas'); }
    (${maskDrawSrc})(m.maskCanvas);
  })()`);
  // the engine node consumes mask versions only while bokehMM > 0 — raise it
  // on BOTH sides first, step the EMA 14×, then configs take it from there
  await sa.evaluate(() => setBokehMM(100));
  await en.evaluate(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const el = document.querySelector('[data-testid="param-anamorphic_lab-bokehMM"]');
    setV.call(el, 100); el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (let i = 0; i < 14; i++) {
    await sa.evaluate(() => bkOnSegResults({ segmentationMask: window.__pmask }));
    const f0 = await en.evaluate(() => { const m = window.__SYN.mask; m.state = 'ready'; m.ready = true; m.version++; return window.__SYN.engine.frame; });
    await en.waitForFunction((f) => window.__SYN.engine.frame > f + 1, f0, { timeout: 8000 }).catch(() => {});
  }
  const maskState = await en.evaluate(() => `v=${window.__SYN.mask.version} seg=${document.querySelector('[data-testid="seg-status"]')?.textContent}`);
  step('identical mask injected both sides (EMA stepped 14×)', /v=14/.test(maskState), maskState);

  const BOOLS = ['letterbox', 'breathing', 'flare', 'flareMaster', 'compare', 'ghostGlitch'];
  const applySA = (over) => sa.evaluate(({ P2, BOOLS }) => {
    Object.entries(P2).forEach(([k, v]) => {
      if (BOOLS.includes(k)) { if (!!P[k] !== !!v) tog(k); return; }
      if (k === 'bokehMM') { setBokehMM(v); return; }
      if (k === 'fStop') { setFStop(v); return; }
      if (k === 'ovalFineTune') { setOvalFineTune(v); return; }
      set(k, v);
    });
  }, { P2: { ...DEFAULTS, ...over }, BOOLS });
  const applyEN = (over) => en.evaluate((P2) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.entries(P2).forEach(([k, v]) => {
      const el = document.querySelector(`[data-testid="param-anamorphic_lab-${k}"]`);
      if (!el) return;
      if (el.type === 'range') { setV.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (el.type === 'checkbox' && el.checked !== !!v) el.click();
    });
  }, { ...DEFAULTS, ...over });
  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);

  // the f-stop easing advances per RENDERED frame when frame time exceeds the
  // 0.25s dt clamp, so a fixed wall-clock wait leaves the two sides at
  // different convergence under SwiftShader — wait until each side's output
  // stops changing instead
  const waitSettled = async (page, sel) => {
    let prev = await grab(page, sel);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(700);
      const cur = await grab(page, sel);
      if (mad(prev, cur) < 0.0015) return cur;
      prev = cur;
    }
    return prev;
  };

  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg.p);
    await applyEN(cfg.p);
    await sa.waitForTimeout(1200);
    const sG = await waitSettled(sa, '#cv');
    const eG = await waitSettled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG);
    const d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`static ${cfg.name}`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  const shot = async (page, sel, file) => {
    const dataUrl = await page.evaluate((s) => document.querySelector(s).toDataURL('image/png'), sel);
    fs.writeFileSync(path.join(SHOTS, file), Buffer.from(dataUrl.split(',')[1], 'base64'));
  };
  await shot(sa, '#cv', 'p6s-hero-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p6s-hero-engine.png');
  await applySA({}); await applyEN({});
  await sa.waitForTimeout(1500);
  await shot(sa, '#cv', 'p6s-defaults-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p6s-defaults-engine.png');

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase6-static-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nstatic summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
