/* Phase 4 static parity — deterministic frame-level comparison.
 * Both sides pinned: engine adaptiveRes off @ 1:1, both videos PAUSED at the
 * same timestamp → identical input pixels. Per config: downscaled luma corr +
 * mean-abs-diff between standalone (ground truth) and SynEngine node.
 * Plus a feedback step-response: after a seek, trails make the output
 * converge gradually instead of snapping. */
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

const NEUTRAL = {
  feedbackAmt: 0, feedbackZoom: 0, feedbackRot: 0, feedbackDecay: 0, hueShift: 0, feedbackDriftX: 0,
  tearAmt: 0, dropoutAmt: 0, chromaAmt: 0, noiseAmt: 0, rollBar: 0, trackingErr: 0,
  barrelAmt: 0, scanlinesAmt: 0, phosphorAmt: 0, bloomAmt: 0, vignetteAmt: 0, crtBlend: 1,
  sortThresh: 0.5, sortPasses: 3, sortDir: 0, reactSens: 1, modDepth: 0,
};
const BOOLS_OFF = { feedbackMirror: 0, sortEnabled: 0, reactEnabled: 0 };

// static configs: time-dependent stochastic passes stay 0 (their u_seed keeps
// running per frame by design — those were verified behaviorally already)
const CONFIGS = [
  { name: 'neutral', p: {} },
  { name: 'barrel-max', p: { barrelAmt: 1 } },
  { name: 'vignette-max', p: { vignetteAmt: 1 } },
  { name: 'scanlines-max', p: { scanlinesAmt: 1 } },
  { name: 'phosphor-max', p: { phosphorAmt: 1 } },
  { name: 'chroma-max', p: { chromaAmt: 1 } },
  { name: 'bloom-max', p: { bloomAmt: 1 } },
  { name: 'blend-0-heavy', p: { crtBlend: 0, barrelAmt: 1, scanlinesAmt: 1, vignetteAmt: 1, phosphorAmt: 1 } },
  { name: 'sort-h', p: { sortEnabled: 1, sortThresh: 0.25, sortPasses: 12 } },
  { name: 'sort-v', p: { sortEnabled: 1, sortThresh: 0.25, sortPasses: 12, sortDir: 1 } },
  { name: 'hero-static', p: { chromaAmt: 0.4, scanlinesAmt: 0.7, phosphorAmt: 0.5, barrelAmt: 0.5, vignetteAmt: 0.6, bloomAmt: 0.5 } },
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
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/analog/index.html', { waitUntil: 'load' });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2000);

  const en = await ctx.newPage();
  en.on('pageerror', (e) => pageErrors.push('engine: ' + String(e).slice(0, 150)));
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-analog"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]');
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(1500);

  // pin the engine: adaptive res off, native 1:1, then pause both at t=1.0
  const pinned = await en.evaluate(async () => {
    const S = window.__SYN;
    if (!S) return 'no tap';
    S.engine.adaptiveRes = false;
    S.engine.setResScale(1);
    const v = S.engine.source;
    if (!v) return 'no source';
    v.pause();
    v.currentTime = 1.0;
    await new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); });
    const c = document.querySelector('[data-testid="chain-canvas"]');
    return `${c.width}x${c.height}@${v.currentTime.toFixed(2)}s`;
  });
  step('engine pinned (adaptive off, 1:1, paused)', /^1920x1080@1\.0/.test(pinned), pinned);
  const saPinned = await sa.evaluate(async () => {
    video.pause();
    video.currentTime = 1.0;
    await new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); });
    return `${video.videoWidth}x${video.videoHeight}@${video.currentTime.toFixed(2)}s`;
  });
  step('standalone pinned (paused same frame)', /@1\.0/.test(saPinned), saPinned);

  const applySA = (over) => sa.evaluate(({ N, B, over }) => {
    const P2 = { ...N, ...over };
    Object.keys(P2).forEach((k) => {
      if (['sortThresh','sortPasses','reactSens','modDepth'].includes(k)) {
        const el = document.getElementById('sl-'+k);
        if (el) { el.value = P2[k]; el.dispatchEvent(new Event('input',{bubbles:true})); }
      } else if (k === 'sortDir') {
        const b = document.querySelector(`#sort-dir-sel .seg-btn[data-dir="${P2[k]}"]`);
        if (b && !b.classList.contains('on')) b.click();
      } else if (typeof syncKnob === 'function' && document.querySelector(`.knob[data-id="${k}"]`)) syncKnob(k, P2[k]);
    });
    const led = (id, want) => { const el = document.getElementById(id); if (el && el.classList.contains('on') !== !!want) el.click(); };
    const B2 = { ...B, ...over };
    led('btn-mirror', B2.feedbackMirror); led('btn-sort', B2.sortEnabled); led('btn-react', B2.reactEnabled);
    if (typeof clearFeedback === 'function') clearFeedback();
  }, { N: NEUTRAL, B: BOOLS_OFF, over });
  const applyEN = (over) => en.evaluate(({ N, B, over }) => {
    const P2 = { ...N, ...over }; const B2 = { ...B, ...over };
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    Object.keys(P2).forEach((k) => {
      const el = document.querySelector(`[data-testid="param-analog-${k}"]`);
      if (el && el.type === 'range') { setV.call(el, P2[k]); el.dispatchEvent(new Event('change',{bubbles:true})); }
    });
    Object.keys(B2).forEach((k) => {
      const el = document.querySelector(`[data-testid="param-analog-${k}"]`);
      if (el && el.type === 'checkbox' && el.checked !== !!B2[k]) el.click();
    });
  }, { N: NEUTRAL, B: BOOLS_OFF, over });
  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);

  /* ── static parity per config ── */
  const summary = {};
  for (const cfg of CONFIGS) {
    await applySA(cfg.p);
    await applyEN(cfg.p);
    // feedback buffers converge on the static frame; stochastic passes are 0
    await sa.waitForTimeout(1800);
    const sG = await grab(sa, '#glcanvas');
    const eG = await grab(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG);
    const d = mad(sG, eG);
    summary[cfg.name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`static ${cfg.name}`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }
  // evidence pair on the heaviest static look
  const shot = async (page, sel, file) => {
    const box = await page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel);
    await page.screenshot({ path: path.join(SHOTS, file), clip: box });
  };
  await shot(sa, '#glcanvas', 'p4s-hero-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p4s-hero-engine.png');

  /* ── feedback step response (trails converge gradually after a seek) ── */
  const stepResp = async (page, sel, seekSrc) => {
    await page.evaluate(`(${seekSrc})(2.0)`);
    const frames = [];
    for (let i = 0; i < 14; i++) {
      frames.push(await grab(page, sel));
      await page.waitForTimeout(140);
    }
    const final = frames[frames.length - 1];
    return frames.map((f) => +mad(f, final).toFixed(4));
  };
  const saSeek = `async (t) => { video.currentTime = t; await new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); }); }`;
  const enSeek = `async (t) => { const v = window.__SYN.engine.source; v.currentTime = t; await new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }); }`;

  // neutral: snap (distance collapses immediately)
  await applySA({}); await applyEN({});
  await sa.waitForTimeout(800);
  const snapS = await stepResp(sa, '#glcanvas', saSeek);
  const snapE = await stepResp(en, '[data-testid="chain-canvas"]', enSeek);
  // feedback: gradual
  await applySA({ feedbackAmt: 0.9, feedbackDecay: 0.05 });
  await applyEN({ feedbackAmt: 0.9, feedbackDecay: 0.05 });
  await sa.waitForTimeout(2500);
  const gradS = await stepResp(sa, '#glcanvas', saSeek);
  const gradE = await stepResp(en, '[data-testid="chain-canvas"]', enSeek);
  const settleIdx = (arr) => { const th = Math.max(...arr) * 0.25; for (let i = 0; i < arr.length; i++) if (arr[i] <= th) return i; return arr.length; };
  const sSnap = settleIdx(snapS), eSnap = settleIdx(snapE), sGrad = settleIdx(gradS), eGrad = settleIdx(gradE);
  step('feedback trails: gradual convergence both sides (vs instant when off)',
    sGrad > sSnap && eGrad > eSnap && sGrad >= 3 && eGrad >= 3,
    `settle idx neutral S/E=${sSnap}/${eSnap} feedback S/E=${sGrad}/${eGrad}; decay S=[${gradS.slice(0, 8).join(',')}] E=[${gradE.slice(0, 8).join(',')}]`);
  await shot(sa, '#glcanvas', 'p4s-feedback-standalone.png');
  await shot(en, '[data-testid="chain-canvas"]', 'p4s-feedback-engine.png');

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase4-static-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nstatic summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
