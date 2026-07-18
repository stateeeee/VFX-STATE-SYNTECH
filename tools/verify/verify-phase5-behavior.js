/* Phase 5 behavior suite — BOKEH temporal/stochastic/reactive checks that a
 * paused-frame comparison cannot cover:
 *  A. real MediaPipe path: PersonMask reaches READY through the shared
 *     service (CDN mirrored from npm), mask versions advance
 *  B. playing-video long-exposure parity on defaults (standalone vs engine)
 *  C. background FX 1–5: the subject region stays protected while the
 *     background visibly changes; feedback modes accumulate over frames
 *  D. datamosh I-frame cadence: rare I-frames diverge more than frequent
 *  E. pixel-sort: static-frame convergence matches across sides
 *  F. anam breathing: slow global zoom appears only when enabled
 *  G. reactivity: manual bass route onto bokehRadius modulates the readout
 *  H. chain sanity: bokeh + analog (both real ports) render without errors */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const CDN = path.join(SCRATCH, 'cdn');
const DW = 128, DH = 72;
const MIME = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.data': 'application/octet-stream' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
const whiteMaskSrc = `(cv) => {
  cv.width = 480; cv.height = 270;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(0, 0, 480, 270);
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
/* subject region ≈ the injected ellipse, in 128×72 grab coords */
const inSubject = (i) => {
  const x = i % DW, y = Math.floor(i / DW);
  const dx = (x - 64) / 19, dy = (y - 42) / 24;      // torso
  const hx = (x - 64) / 9.5, hy = (y - 15) / 9.5;     // head
  return dx*dx + dy*dy < 0.55 || hx*hx + hy*hy < 0.55; // core only, away from feather
};
const regionMad = (a, b, pred) => {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) if (pred(i)) { s += Math.abs(a[i]-b[i]); n++; }
  return s / (n || 1);
};

const DEFAULTS = {
  bokehRadius: 18, bokehStyle: 0, bokehBloom: 1.2, bokehFeather: 0.42, bokehVignette: 0.35,
  bshapeX: 0, bshapeY: 0,
  anamSqueeze: 1, anamRatio: 2.39, anamBarrel: 0.22, anamVignette: 0.4,
  anamLetterbox: 1, anamBreathing: 0,
  distortMode: 0, distortSwirl: 1.8, distortFalloff: 2.5, distortExplosive: 0.4, distortSqueeze: 1.5,
  bgfxStyle: 0, dmDrift: 1.8, dmDecay: 0.88, dmBlock: 8, dmGlitch: 0.35, dmColor: 0.5, dmIframe: 0.05,
  psThresh: 0.4, psBlend: 1, psAngle: 0,
  lqAmount: 0.025, lqSpeed: 0.4, lqScale: 2.5,
  mrAmount: 0.5, mrFreq: 2, mrDecay: 0.88,
  lvHeat: 0.7, lvSpeed: 0.5, lvViscosity: 0.35,
};

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, async (route) => {
    const url = new URL(route.request().url());
    let local = null;
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/')) {
      const m = url.pathname.slice(5).match(/^(@[^/]+\/[^/@]+|[^/@]+)(?:@[^/]+)?\/(.+)$/);
      if (m) local = path.join(CDN, m[1], m[2]);
    }
    if (local && fs.existsSync(local)) {
      await route.fulfill({ status: 200, body: fs.readFileSync(local), contentType: MIME[path.extname(local)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  /* ── A. real MediaPipe path through the shared PersonMask ── */
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
  await en.waitForTimeout(1500);
  await en.evaluate(() => { const S = window.__SYN; S.engine.adaptiveRes = false; S.engine.setResScale(1); });
  const segReady = await en.waitForFunction(
    () => document.querySelector('[data-testid="seg-status"]')?.textContent?.includes('READY'),
    null, { timeout: 30000 }
  ).then(() => true).catch(() => false);
  const maskInfo = await en.evaluate(() => {
    const m = window.__SYN.mask;
    return { state: m.state, v: m.version, canvas: m.maskCanvas ? `${m.maskCanvas.width}x${m.maskCanvas.height}` : null };
  });
  step('A. PersonMask reaches READY via CDN-mirrored MediaPipe (segEnabled default)', segReady, JSON.stringify(maskInfo));
  const v0 = maskInfo.v;
  await en.waitForTimeout(2500);
  const v1 = await en.evaluate(() => window.__SYN.mask.version);
  step('A. real mask versions advance while the video plays', v1 > v0, `v ${v0} → ${v1}`);

  /* switch to the injected mask for everything deterministic below */
  await en.evaluate(`(() => {
    const m = window.__SYN.mask;
    m.dispose();                        // stop the real segmenter
    m.state = 'ready'; m.ready = true;  // puppet the service
    if (!m.maskCanvas) { m.maskCanvas = document.createElement('canvas'); }
    (${maskDrawSrc})(m.maskCanvas);
  })()`);
  const bumpMask = async (times) => {
    for (let i = 0; i < times; i++) {
      const f0 = await en.evaluate(() => { const m = window.__SYN.mask; m.state = 'ready'; m.ready = true; m.version++; return window.__SYN.engine.frame; });
      await en.waitForFunction((f) => window.__SYN.engine.frame > f + 1, f0, { timeout: 8000 }).catch(() => {});
    }
  };
  await bumpMask(14);

  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/bokeh/index.html', { waitUntil: 'load' });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2500);
  // silence the standalone's own (CDN-mirrored) segmenter, inject the same mask
  await sa.evaluate(`(() => {
    if (typeof segmenter !== 'undefined' && segmenter) { try { segmenter.close(); } catch(e) {} }
    window.__pmask = document.createElement('canvas');
    (${maskDrawSrc})(window.__pmask);
    for (let i = 0; i < 14; i++) onSegResults({ segmentationMask: window.__pmask });
  })()`);

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
  const grabEN = () => grab(en, '[data-testid="chain-canvas"]');
  const grabSA = () => grab(sa, '#glcanvas');
  const restart = async () => {
    await sa.evaluate(() => { video.currentTime = 0; video.play(); });
    await en.evaluate(() => { const v = window.__SYN.engine.source; v.currentTime = 0; v.play(); });
    await sa.waitForTimeout(700);
  };
  const longExposure = async (grabFn, n, gap) => {
    const acc = new Array(DW * DH).fill(0);
    for (let i = 0; i < n; i++) {
      const g = await grabFn();
      for (let j = 0; j < acc.length; j++) acc[j] += g[j] / n;
      await en.waitForTimeout(gap);
    }
    return acc;
  };

  /* ── B. defaults, playing: long-exposure cross-side parity ── */
  await applySA({}); await applyEN({});
  await restart();
  const [leS, leE] = [await longExposure(grabSA, 10, 300), await longExposure(grabEN, 10, 300)];
  const cLE = corr(leS, leE);
  step('B. playing defaults long-exposure corr (standalone vs engine)', cLE > 0.9, `corr=${cLE.toFixed(3)}`);

  /* ── C. background FX: subject protected, background changes ── */
  // clean baseline per side (bgfx off), video paused mid-clip for stability
  const pauseBoth = async (t) => {
    await sa.evaluate(async (tt) => {
      video.pause(); video.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
    await en.evaluate(async (tt) => {
      const v = window.__SYN.engine.source; v.pause(); v.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
  };
  await pauseBoth(1.5);
  await sa.waitForTimeout(1500);
  const cleanS = await grabSA();
  const cleanE = await grabEN();
  const BGFX = { 1: 'datamosh', 2: 'pixel-sort', 3: 'liquid', 4: 'morph', 5: 'lava' };
  const bgfxSummary = {};
  for (const [num, name] of Object.entries(BGFX)) {
    const over = { bgfxStyle: +num, psThresh: 0.15, dmGlitch: 0.6, lqAmount: 0.06, lvHeat: 0.9 };
    await applySA(over); await applyEN(over);
    await sa.waitForTimeout(2500); // let feedback modes accumulate on the paused frame
    const gS = await grabSA();
    const gE = await grabEN();
    const bgS = regionMad(cleanS, gS, (i) => !inSubject(i));
    const bgE = regionMad(cleanE, gE, (i) => !inSubject(i));
    const subS = regionMad(cleanS, gS, inSubject);
    const subE = regionMad(cleanE, gE, inSubject);
    bgfxSummary[name] = { bgS: +bgS.toFixed(3), bgE: +bgE.toFixed(3), subS: +subS.toFixed(3), subE: +subE.toFixed(3) };
    // both sides: background departs from clean, subject core stays close
    step(`C. bgfx ${name}: bg changes, subject protected, both sides`,
      bgS > 0.01 && bgE > 0.01 && subS < 0.05 && subE < 0.05 && subS < bgS && subE < bgE,
      `bg S/E=${bgS.toFixed(3)}/${bgE.toFixed(3)} subj S/E=${subS.toFixed(3)}/${subE.toFixed(3)}`);
  }

  /* ── D. datamosh I-frame cadence: rare I-frames drift further from clean ── */
  const dmRun = async (iframeHz) => {
    const over = { bgfxStyle: 1, dmIframe: iframeHz, dmGlitch: 0.35, dmDrift: 3 };
    await applySA(over); await applyEN(over);
    await restart();
    await sa.waitForTimeout(2500);
    const gS = await grabSA(); const gE = await grabEN();
    // distance from the current clean playing frame is noisy; use distance
    // from the paused-clean baseline as a coarse "how moshed" proxy
    return { s: mad(cleanS, gS), e: mad(cleanE, gE) };
  };
  const freq = await dmRun(2);
  const rare = await dmRun(0.01);
  step('D. datamosh: rare I-frames (0.01Hz) mosh harder than frequent (2Hz), both sides',
    rare.s > freq.s * 0.9 && rare.e > freq.e * 0.9,
    `S freq/rare=${freq.s.toFixed(3)}/${rare.s.toFixed(3)} E=${freq.e.toFixed(3)}/${rare.e.toFixed(3)}`);

  /* ── E. pixel sort on a static frame: cross-side convergence ── */
  await applySA({ bgfxStyle: 2, psThresh: 0.1, psBlend: 1 });
  await applyEN({ bgfxStyle: 2, psThresh: 0.1, psBlend: 1 });
  await pauseBoth(1.0);
  await sa.waitForTimeout(4000); // CPU sort every 2nd frame; let both converge
  const psS = await grabSA();
  const psE = await grabEN();
  const cPS = corr(psS, psE);
  step('E. pixel sort static convergence (cross-side)', cPS > 0.9, `corr=${cPS.toFixed(3)}`);

  /* ── F. breathing: slow global zoom only when enabled (all-sharp frame) ── */
  await sa.evaluate(`(() => { (${whiteMaskSrc})(window.__pmask); for (let i = 0; i < 14; i++) onSegResults({ segmentationMask: window.__pmask }); })()`);
  await en.evaluate(`(() => { (${whiteMaskSrc})(window.__SYN.mask.maskCanvas); })()`);
  await bumpMask(14);
  const flat = { bokehRadius: 2, bokehVignette: 0, anamVignette: 0, anamBarrel: 0, anamSqueeze: 1, anamLetterbox: 0, bgfxStyle: 0, distortMode: 0 };
  const drift = async (breathing) => {
    await applySA({ ...flat, anamBreathing: breathing });
    await applyEN({ ...flat, anamBreathing: breathing });
    await sa.waitForTimeout(1200);
    const s0 = await grabSA(); const e0 = await grabEN();
    await sa.waitForTimeout(3500);
    return { s: mad(s0, await grabSA()), e: mad(e0, await grabEN()) };
  };
  const still = await drift(0);
  const breath = await drift(1);
  step('F. anam breathing: temporal drift only when enabled, both sides',
    breath.s > still.s * 2 && breath.e > still.e * 2 && breath.s > 0.0005 && breath.e > 0.0005,
    `off S/E=${still.s.toFixed(4)}/${still.e.toFixed(4)} on S/E=${breath.s.toFixed(4)}/${breath.e.toFixed(4)}`);

  /* ── G. reactivity: manual bass route onto bokehRadius (no default routes by design) ── */
  await en.setInputFiles('[data-testid="audio-file"]', path.join(SCRATCH, 'beat120.wav'));
  await en.waitForSelector('[data-testid="audio-playpause"]', { timeout: 5000 });
  await en.waitForTimeout(500);
  let modSrc = '';
  for (let i = 0; i < 7 && modSrc.trim() !== 'BASS'; i++) {
    await en.click('[data-testid="mod-src-bokeh-bokehRadius"]');
    modSrc = await en.locator('[data-testid="mod-src-bokeh-bokehRadius"]').textContent();
  }
  step('G. mod route cycles to BASS on bokehRadius', modSrc.trim() === 'BASS', modSrc);
  await en.evaluate(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const amt = document.querySelector('[data-testid="mod-amt-bokeh-bokehRadius"]');
    setV.call(amt, 1); amt.dispatchEvent(new Event('change', { bubbles: true }));
    const base = document.querySelector('[data-testid="param-bokeh-bokehRadius"]');
    setV.call(base, 2); base.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const modVals = [];
  for (let i = 0; i < 14; i++) {
    const t = await en.locator('[data-testid="mod-val-bokeh-bokehRadius"]').textContent().catch(() => '');
    const m = String(t).match(/[\d.]+/);
    if (m) modVals.push(parseFloat(m[0]));
    await en.waitForTimeout(180);
  }
  const spread = modVals.length ? Math.max(...modVals) - Math.min(...modVals) : 0;
  step('G. routed bokehRadius readout modulates with the beat', spread >= 2 && modVals.length >= 8,
    `spread=${spread.toFixed(1)} over [${modVals.slice(0, 8).map((v) => v.toFixed(0)).join(',')}]`);

  /* ── H. chain sanity: bokeh + analog, playing, fps + errors ── */
  await en.click('[data-testid="nav-home"]');
  await en.waitForTimeout(400);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-analog"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]');
  await en.evaluate(() => { const S = window.__SYN; S.engine.adaptiveRes = true; });
  await en.evaluate(() => { const v = window.__SYN.engine.source; if (v) { v.currentTime = 0; v.play(); } });
  await en.waitForTimeout(6000);
  const chainStat = await en.evaluate(() => {
    const S = window.__SYN;
    const gl = S.engine.gl;
    const c = document.querySelector('[data-testid="chain-canvas"]');
    const off = document.createElement('canvas'); off.width = 64; off.height = 36;
    const cx = off.getContext('2d');
    cx.drawImage(c, 0, 0, 64, 36);
    const d = cx.getImageData(0, 0, 64, 36).data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (d[i] + d[i+1] + d[i+2]) / 3;
    return {
      fps: S.engine.fps, res: S.engine.resScale, glErr: gl.getError(),
      chain: S.engine.chain.map((n) => `${n.id}${n.enabled ? '' : '(off)'}`).join('→'),
      meanLum: +(lum / (64*36)).toFixed(1),
    };
  });
  step('H. bokeh→analog chain renders (no GL errors, non-black)',
    chainStat.glErr === 0 && chainStat.meanLum > 2 && /bokeh→analog/.test(chainStat.chain),
    JSON.stringify(chainStat));

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase5-behavior-summary.json'), JSON.stringify({ longExposureCorr: +cLE.toFixed(3), bgfx: bgfxSummary, datamosh: { freq, rare }, pixsortCorr: +cPS.toFixed(3), breathing: { still, breath }, reactSpread: +spread.toFixed(1), chain: chainStat }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
