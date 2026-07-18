/* Phase 4 parity run — ANALOG standalone (ground truth) vs SynEngine node.
 * 06-VERIFICATION §4: same clip both sides; defaults, per-param sweeps, hero
 * look. Loop-phase differences are neutralized by comparing "long exposures"
 * (mean of 16 downscaled captures across >1 video loop) plus per-config
 * structural metrics computed identically on both sides. Stochastic passes
 * (noise/tear/dropout) are judged by behavior (temporal variance), not pixels. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const SHOTS = path.join(SCRATCH, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// every numeric param at 0 → passthrough-ish; booleans off; blend 1
const NEUTRAL = {
  feedbackAmt: 0, feedbackZoom: 0, feedbackRot: 0, feedbackDecay: 0, hueShift: 0, feedbackDriftX: 0,
  tearAmt: 0, dropoutAmt: 0, chromaAmt: 0, noiseAmt: 0, rollBar: 0, trackingErr: 0,
  barrelAmt: 0, scanlinesAmt: 0, phosphorAmt: 0, bloomAmt: 0, vignetteAmt: 0, crtBlend: 1,
  sortThresh: 0.5, sortPasses: 3, sortDir: 0,
  reactSens: 1, modDepth: 0,
};
const BOOLS_OFF = { feedbackMirror: 0, sortEnabled: 0, reactEnabled: 0 };

const CONFIGS = [
  { name: 'neutral', p: {}, kind: 'exposure' },
  { name: 'barrel-max', p: { barrelAmt: 1 }, kind: 'exposure' },
  { name: 'vignette-max', p: { vignetteAmt: 1 }, kind: 'vignette' },
  { name: 'scanlines-max', p: { scanlinesAmt: 1 }, kind: 'rows' },
  { name: 'phosphor-max', p: { phosphorAmt: 1 }, kind: 'exposure' },
  { name: 'chroma-max', p: { chromaAmt: 1 }, kind: 'exposure' },
  { name: 'bloom-max', p: { bloomAmt: 1 }, kind: 'exposure' },
  { name: 'rollbar-max', p: { rollBar: 1 }, kind: 'exposure' },
  { name: 'sort-h', p: { sortEnabled: 1, sortThresh: 0.25, sortPasses: 12 }, kind: 'sort' },
  { name: 'blend-0-heavy', p: { crtBlend: 0, barrelAmt: 1, scanlinesAmt: 1, vignetteAmt: 1, phosphorAmt: 1 }, kind: 'exposure' },
  { name: 'hero', p: { feedbackAmt: 0.6, feedbackZoom: 0.2, hueShift: 0.3, chromaAmt: 0.4, scanlinesAmt: 0.7, phosphorAmt: 0.5, barrelAmt: 0.5, vignetteAmt: 0.6, bloomAmt: 0.5 }, kind: 'exposure' },
  // last: adaptive-res steps must be over — a resize legitimately clears the
  // feedback buffer, which would mask the trail damping this config measures
  { name: 'feedback', p: { feedbackAmt: 0.85, feedbackDecay: 0.1 }, kind: 'temporal' },
];

const DW = 128, DH = 72; // downscale size for all captures

// ---------- in-page capture helpers (identical on both sides) ----------
const captureFnSrc = `async (canvasSel, frames, gapMs) => {
  const cv = document.querySelector(canvasSel);
  const off = document.createElement('canvas'); off.width = ${DW}; off.height = ${DH};
  const cx = off.getContext('2d', { willReadFrequently: true });
  const acc = new Float64Array(${DW * DH});
  const singles = [];
  let interDiff = 0;
  let prev = null;
  for (let f = 0; f < frames; f++) {
    cx.drawImage(cv, 0, 0, ${DW}, ${DH});
    const d = cx.getImageData(0, 0, ${DW}, ${DH}).data;
    const g = new Float64Array(${DW * DH});
    for (let i = 0; i < g.length; i++) {
      g[i] = (d[i * 4] * 0.2126 + d[i * 4 + 1] * 0.7152 + d[i * 4 + 2] * 0.0722) / 255;
      acc[i] += g[i];
    }
    if (prev) { let s = 0; for (let i = 0; i < g.length; i++) s += Math.abs(g[i] - prev[i]); interDiff += s / g.length; }
    prev = g;
    if (f === 0) singles.push(Array.from(g));
    await new Promise((r) => setTimeout(r, gapMs));
  }
  const mean = Array.from(acc, (v) => v / frames);
  return { mean, interDiff: interDiff / (frames - 1), single: singles[0] };
}`;

// ---------- metric helpers (node side) ----------
const meanOf = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const corr = (a, b) => {
  const ma = meanOf(a), mb = meanOf(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db || 1);
};
const cornerCenterRatio = (g) => {
  const px = (x, y) => g[y * DW + x];
  let corner = 0, n = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { corner += px(x, y) + px(DW - 1 - x, y) + px(x, DH - 1 - y) + px(DW - 1 - x, DH - 1 - y); n += 4; }
  corner /= n;
  let center = 0, m = 0;
  for (let y = DH / 2 - 6; y < DH / 2 + 6; y++) for (let x = DW / 2 - 6; x < DW / 2 + 6; x++) { center += px(x, y); m++; }
  return corner / (center / m || 1);
};
const gradRatio = (g) => {
  let gh = 0, gv = 0;
  for (let y = 1; y < DH; y++) for (let x = 1; x < DW; x++) {
    gh += Math.abs(g[y * DW + x] - g[y * DW + x - 1]);
    gv += Math.abs(g[y * DW + x] - g[(y - 1) * DW + x]);
  }
  return gh / (gv || 1);
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  const pageErrors = [];

  /* ── 0. build a structured 3s 1280x720 parity clip (once) ── */
  const clipPath = path.join(SCRATCH, 'parity.webm');
  if (!fs.existsSync(clipPath)) {
    const gen = await ctx.newPage();
    await gen.goto('about:blank');
    const dataUrl = await gen.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
      const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(24), { mimeType: 'video/webm', videoBitsPerSecond: 8e6 });
      const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
      const stopped = new Promise((r) => (rec.onstop = r));
      rec.start();
      const t0 = performance.now();
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        const grad = g.createLinearGradient(0, 0, 1280, 0);
        grad.addColorStop(0, '#101020'); grad.addColorStop(0.5, '#3a6a4a'); grad.addColorStop(1, '#c0c8d8');
        g.fillStyle = grad; g.fillRect(0, 0, 1280, 720);
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(640 + Math.cos(t * 2.1) * 380, 360 + Math.sin(t * 2.1) * 200, 110, 0, 7);
        g.fill();
        g.fillStyle = '#000000';
        g.fillRect(((t * 260) % 1400) - 60, 0, 90, 720);
        g.fillStyle = '#d03030';
        g.fillRect(200, 520 + Math.sin(t * 3.3) * 60, 160, 90);
      };
      const iv = setInterval(draw, 1000 / 24);
      await new Promise((r) => setTimeout(r, 3000));
      clearInterval(iv); rec.stop(); await stopped;
      const blob = new Blob(chunks, { type: 'video/webm' });
      return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    });
    fs.writeFileSync(clipPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await gen.close();
  }
  step('parity clip ready (1280x720)', fs.statSync(clipPath).size > 50000, `${fs.statSync(clipPath).size} bytes`);

  /* ── 1. STANDALONE side ── */
  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/analog/index.html', { waitUntil: 'load' });
  await sa.setInputFiles('#file-input', clipPath);
  await sa.waitForTimeout(2500);
  const saPlaying = await sa.evaluate(() => typeof video !== 'undefined' && video.readyState >= 2 && !video.paused);
  step('standalone: clip playing', saPlaying);

  const applyStandalone = (cfg) => sa.evaluate(({ N, B, over }) => {
    const P2 = { ...N, ...over };
    Object.keys(P2).forEach((k) => {
      if (k === 'sortThresh' || k === 'sortPasses' || k === 'reactSens' || k === 'modDepth') {
        const el = document.getElementById('sl-' + k);
        if (el) { el.value = P2[k]; el.dispatchEvent(new Event('input', { bubbles: true })); }
      } else if (k === 'sortDir') {
        const b = document.querySelector(`#sort-dir-sel .seg-btn[data-dir="${P2[k]}"]`);
        if (b && !b.classList.contains('on')) b.click();
      } else if (typeof syncKnob === 'function' && document.querySelector(`.knob[data-id="${k}"]`)) {
        syncKnob(k, P2[k]);
      }
    });
    const led = (id, want) => { const el = document.getElementById(id); if (el && el.classList.contains('on') !== !!want) el.click(); };
    const B2 = { ...B, ...over };
    led('btn-mirror', B2.feedbackMirror);
    led('btn-sort', B2.sortEnabled);
    led('btn-react', B2.reactEnabled);
    if (typeof clearFeedback === 'function') clearFeedback();
  }, { N: NEUTRAL, B: BOOLS_OFF, over: cfg });

  /* ── 2. ENGINE side ── */
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
  await en.setInputFiles('[data-testid="chain-file"]', clipPath);
  await en.waitForTimeout(2500);
  // let the adaptive resolution settle (SwiftShader steps 1 → .75 → .5;
  // every step resizes node targets and clears the feedback buffer)
  let lastRes = '';
  for (let i = 0; i < 20; i++) {
    const r = await en.textContent('[data-testid="chain-res"]');
    if (r === lastRes && i > 3) break;
    lastRes = r;
    await en.waitForTimeout(1800);
  }
  const enSize = await en.evaluate(() => {
    const c = document.querySelector('[data-testid="chain-canvas"]');
    return c ? `${c.width}x${c.height}` : 'none';
  });
  step('engine: analog node runs on the clip', /1280x720|960x540|640x360/.test(enSize), `canvas ${enSize} res=${lastRes}%`);

  const applyEngine = (cfg) => en.evaluate(({ N, B, over }) => {
    const P2 = { ...N, ...over };
    const B2 = { ...B, ...over };
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.keys(P2).forEach((k) => {
      const el = document.querySelector(`[data-testid="param-analog-${k}"]`);
      if (el && el.type === 'range') { setV.call(el, P2[k]); el.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    Object.keys(B2).forEach((k) => {
      const el = document.querySelector(`[data-testid="param-analog-${k}"]`);
      if (el && el.type === 'checkbox' && el.checked !== !!B2[k]) el.click();
    });
  }, { N: NEUTRAL, B: BOOLS_OFF, over: cfg });

  /* ── 3. run the configs on both sides ── */
  const grab = async (page, sel) => {
    return await page.evaluate(`(${captureFnSrc})(${JSON.stringify(sel)}, 16, 250)`);
  };

  const summary = {};
  for (const cfg of CONFIGS) {
    await applyStandalone(cfg.p);
    await applyEngine(cfg.p);
    await sa.waitForTimeout(cfg.kind === 'temporal' ? 3000 : 1200); // let feedback buffers converge
    const [sRes, eRes] = await Promise.all([
      grab(sa, '#glcanvas'),
      grab(en, '[data-testid="chain-canvas"]'),
    ]);
    const c = corr(sRes.mean, eRes.mean);
    const mS = meanOf(sRes.mean), mE = meanOf(eRes.mean);
    const rec = { corr: +c.toFixed(3), lumaS: +mS.toFixed(3), lumaE: +mE.toFixed(3), interS: +sRes.interDiff.toFixed(4), interE: +eRes.interDiff.toFixed(4) };
    summary[cfg.name] = rec;

    let ok = c > 0.9 && Math.abs(mS - mE) < 0.09;
    let extra = '';
    if (cfg.kind === 'vignette') {
      const rs = cornerCenterRatio(sRes.mean), re = cornerCenterRatio(eRes.mean);
      extra = ` cc-ratio S=${rs.toFixed(2)} E=${re.toFixed(2)}`;
      ok = ok && Math.abs(rs - re) < 0.22;
    }
    if (cfg.kind === 'sort') {
      const gs = gradRatio(sRes.mean), ge = gradRatio(eRes.mean);
      extra = ` gradH/V S=${gs.toFixed(2)} E=${ge.toFixed(2)}`;
      ok = c > 0.85 && (gs < 1 === ge < 1); // both smear horizontally (lower H gradient)
    }
    if (cfg.kind === 'temporal') {
      // trails damp inter-frame change on both sides vs neutral
      const dampS = sRes.interDiff / summary['neutral'].interS;
      const dampE = eRes.interDiff / summary['neutral'].interE;
      extra = ` damp S=${dampS.toFixed(2)} E=${dampE.toFixed(2)}`;
      ok = c > 0.85 && dampS < 0.75 && dampE < 0.75;
    }
    step(`parity ${cfg.name}`, ok, `corr=${c.toFixed(3)} luma S/E=${mS.toFixed(3)}/${mE.toFixed(3)}${extra}`);
    await sa.screenshot({ path: path.join(SHOTS, `p4-${cfg.name}-standalone.png`), clip: { x: 0, y: 0, width: 850, height: 500 } });
    await en.screenshot({ path: path.join(SHOTS, `p4-${cfg.name}-engine.png`), clip: { x: 0, y: 0, width: 850, height: 500 } });
  }

  /* ── 4. stochastic passes: behavior (temporal variance rises) ── */
  await applyStandalone({ noiseAmt: 0.8, tearAmt: 0.7, trackingErr: 0.5 });
  await applyEngine({ noiseAmt: 0.8, tearAmt: 0.7, trackingErr: 0.5 });
  await sa.waitForTimeout(800);
  const [sN, eN] = await Promise.all([grab(sa, '#glcanvas'), grab(en, '[data-testid="chain-canvas"]')]);
  const upS = sN.interDiff / summary['neutral'].interS;
  const upE = eN.interDiff / summary['neutral'].interE;
  step('stochastic glitches raise temporal variance on both sides', upS > 1.15 && upE > 1.15, `S x${upS.toFixed(2)} E x${upE.toFixed(2)} (corr=${corr(sN.mean, eN.mean).toFixed(3)})`);

  /* ── 5. reactivity: real audio drives the react channels in the engine ── */
  await applyEngine({ tearAmt: 0.5, modDepth: 1, reactEnabled: 1 });
  await en.setInputFiles('[data-testid="audio-file"]', path.join(SCRATCH, 'beat120.wav'));
  await en.waitForTimeout(3500);
  const reactVals = [];
  for (let i = 0; i < 10; i++) {
    reactVals.push(parseFloat(await en.textContent('[data-testid="mod-val-analog-reactBass"]').catch(() => 'NaN')));
    await en.waitForTimeout(160);
  }
  const rSpread = Math.max(...reactVals) - Math.min(...reactVals);
  step('reactBass channel pulses with real audio (default route)', rSpread >= 0.1 && Math.max(...reactVals) > 0.3,
    `values ${reactVals.map((v) => (v ?? NaN).toFixed(2)).join(',')} spread ${rSpread.toFixed(2)}`);

  /* ── 6. chain sanity: analog + 2 dummies, fps + no GL errors ── */
  await en.click('[data-testid="toggle-blob_reveal"]');
  await en.click('[data-testid="toggle-bokeh"]');
  await en.waitForTimeout(4000);
  const fps = parseInt(await en.textContent('[data-testid="chain-fps"]'));
  const res = await en.textContent('[data-testid="chain-res"]');
  step('chain (analog + 2 nodes) renders continuously', fps > 0, `fps=${fps} res=${res}% (SwiftShader — no GPU in sandbox; ≥30fps criterion applies to the operator machine)`);

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase4-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nmetric summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
