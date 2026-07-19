/* Phase 6 behavior suite — ANAMORPHIC LAB checks a paused-frame pixel
 * comparison cannot cover:
 *  A. real MediaPipe path through the shared PersonMask
 *  B. playing-video long-exposure parity on boot defaults
 *  C. auto-flare: the hotspot detector fires on the bright ball on BOTH
 *     sides (flare on-vs-off delta of matching magnitude) and flickers
 *  D. lens breathing: slow global drift only when enabled, both sides
 *  E. f-stop easing: a big aperture jump converges gradually (not a snap)
 *  F. reactivity: manual bass route onto vignette modulates the readout
 *     (the original has NO audio reactivity — no default routes by design)
 * Chain sanity lives in verify-phase6-chain.js (fresh-session script). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const CDN = path.join(SCRATCH, 'cdn');
const DW = 128, DH = 72;
const MIME = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.data': 'application/octet-stream' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DEFAULTS = {
  exposure: 0.05, temp: 0.58, lift: 0.05, contrast: 0.32, sat: 0.8, rolloff: 0.58, lutMix: 0,
  grain: 0.08, bokeh: 0.42, halation: 0.52, ca: 0.28,
  barrel: 0.26, vignette: 0.44, squeeze: 1.15, ratio: 2.39,
  letterbox: 1, breathing: 0,
  flareMaster: 0, flare: 0, flareAmt: 0.65, flareLength: 0.5, flareColor: 0, flareHeight: 0.5,
  bokehMM: 0, fStop: 4, ovalFineTune: 0, ghostGlitch: 0, compare: 0,
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

  /* ── A. engine + real MediaPipe ── */
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
  await en.waitForTimeout(1500);
  await en.evaluate(() => { const S = window.__SYN; S.engine.adaptiveRes = false; S.engine.setResScale(2 / 3); });
  const segReady = await en.waitForFunction(
    () => document.querySelector('[data-testid="seg-status"]')?.textContent?.includes('READY'),
    null, { timeout: 30000 }
  ).then(() => true).catch(() => false);
  step('A. PersonMask reaches READY via CDN-mirrored MediaPipe', segReady, '');

  // deterministic mask from here on
  await en.evaluate(`(() => {
    const m = window.__SYN.mask;
    m.dispose();
    m.state = 'ready'; m.ready = true;
    if (!m.maskCanvas) { m.maskCanvas = document.createElement('canvas'); }
    (${maskDrawSrc})(m.maskCanvas);
  })()`);
  const bumpMask = async (times) => {
    for (let i = 0; i < times; i++) {
      const f0 = await en.evaluate(() => { const m = window.__SYN.mask; m.state = 'ready'; m.ready = true; m.version++; return window.__SYN.engine.frame; });
      await en.waitForFunction((f) => window.__SYN.engine.frame > f + 1, f0, { timeout: 8000 }).catch(() => {});
    }
  };

  await en.evaluate(() => { const S = window.__SYN; S.engine.source?.pause(); S.engine.stop(); });
  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/anamorphic_lab/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#file-input', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(3000);
  await en.evaluate(() => window.__SYN.engine.start());
  await sa.evaluate(`(() => {
    if (typeof bkSegmenter !== 'undefined' && bkSegmenter) { try { bkSegmenter.close(); } catch (e) {} }
    window.__pmask = document.createElement('canvas');
    (${maskDrawSrc})(window.__pmask);
  })()`);

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
  const grabSA = () => grab(sa, '#cv');
  const grabEN = () => grab(en, '[data-testid="chain-canvas"]');
  const pauseBoth = async (t) => {
    await sa.evaluate(async (tt) => {
      vid.pause(); vid.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { vid.removeEventListener('seeked', on); r(); }; vid.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
    await en.evaluate(async (tt) => {
      const v = window.__SYN.engine.source; v.pause(); v.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
  };

  /* ── B. playing defaults: interleaved long-exposure parity ── */
  await applySA({}); await applyEN({});
  await sa.evaluate(() => { vid.currentTime = 0; vid.play(); });
  await en.evaluate(() => { const v = window.__SYN.engine.source; v.currentTime = 0; v.play(); });
  await sa.waitForTimeout(700);
  const accS = new Array(DW * DH).fill(0);
  const accE = new Array(DW * DH).fill(0);
  for (let i = 0; i < 10; i++) {
    const [gS, gE] = await Promise.all([grabSA(), grabEN()]);
    for (let j = 0; j < accS.length; j++) { accS[j] += gS[j] / 10; accE[j] += gE[j] / 10; }
    await en.waitForTimeout(300);
  }
  const cLE = corr(accS, accE);
  step('B. playing defaults long-exposure corr (standalone vs engine)', cLE > 0.9, `corr=${cLE.toFixed(3)}`);

  /* ── C. auto-flare fires on the bright ball, both sides ── */
  await pauseBoth(1.0); // white ball is in frame at t=1.0
  const flareOffCfg = { flareMaster: 0, flare: 0, grain: 0 };
  const flareOnCfg = { flareMaster: 1, flare: 1, flareAmt: 1, grain: 0 };
  await applySA(flareOffCfg); await applyEN(flareOffCfg);
  await sa.waitForTimeout(1500);
  const offS = await grabSA(); const offE = await grabEN();
  await applySA(flareOnCfg); await applyEN(flareOnCfg);
  await sa.waitForTimeout(1800); // detector cadence 160ms + confidence smoothing
  const onS = await grabSA(); const onE = await grabEN();
  const dS = mad(offS, onS); const dE = mad(offE, onE);
  step('C. auto-flare on-vs-off changes output on BOTH sides (hotspot detected)',
    dS > 0.005 && dE > 0.005 && dS < dE * 4 && dE < dS * 4,
    `delta S/E=${dS.toFixed(4)}/${dE.toFixed(4)}`);
  // flicker: consecutive grabs differ while flare is on (time-seeded)
  const f1S = await grabSA(); await sa.waitForTimeout(900);
  const f2S = await grabSA();
  const f1E = await grabEN(); await en.waitForTimeout(900);
  const f2E = await grabEN();
  step('C. flare flickers over time on both sides',
    mad(f1S, f2S) > 0.0005 && mad(f1E, f2E) > 0.0005,
    `flicker S=${mad(f1S, f2S).toFixed(4)} E=${mad(f1E, f2E).toFixed(4)}`);

  /* ── D. lens breathing: drift only when enabled (max over ~8s) ── */
  const flat = { flareMaster: 0, flare: 0, grain: 0, vignette: 0, barrel: 0, squeeze: 1, letterbox: 0, ca: 0, halation: 0, bokeh: 0 };
  const drift = async (breathing) => {
    await applySA({ ...flat, breathing }); await applyEN({ ...flat, breathing });
    await sa.waitForTimeout(1200);
    const s0 = await grabSA(); const e0 = await grabEN();
    let ms = 0, me = 0;
    for (let i = 0; i < 8; i++) {
      await sa.waitForTimeout(1000);
      ms = Math.max(ms, mad(s0, await grabSA()));
      me = Math.max(me, mad(e0, await grabEN()));
    }
    return { s: ms, e: me };
  };
  const still = await drift(0);
  const breath = await drift(1);
  step('D. breathing: temporal drift only when enabled, both sides',
    breath.s > still.s * 2 && breath.e > still.e * 2 && breath.s > 0.0005 && breath.e > 0.0005,
    `off S/E=${still.s.toFixed(4)}/${still.e.toFixed(4)} on S/E=${breath.s.toFixed(4)}/${breath.e.toFixed(4)}`);

  /* ── E. f-stop easing: aperture jump converges gradually, both sides ── */
  await sa.evaluate(`(() => { for (let i = 0; i < 14; i++) bkOnSegResults({ segmentationMask: window.__pmask }); })()`);
  await bumpMask(14);
  // the easing advances per RENDERED frame under the 0.25s dt clamp, and at
  // f/0.95 the 48-tap blur drops the standalone under 1fps — identical
  // consecutive grabs mean "no frame rendered", not "settled". Count real
  // frames: the standalone's render loop re-invokes requestAnimationFrame
  // through the global each frame, so a wrapper counts its frames; the
  // engine exposes __SYN.engine.frame. 40 frames ⇒ ≥99.5% converged at the
  // clamped per-frame step (k≈0.13).
  await sa.evaluate(() => {
    window.__fc = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => orig((t) => { window.__fc++; cb(t); });
  });
  const saFrames = async (k) => {
    const f0 = await sa.evaluate(() => window.__fc);
    await sa.waitForFunction((t) => window.__fc > t, f0 + k, { timeout: 240000 }).catch(() => {});
  };
  const enFrames = async (k) => {
    const f0 = await en.evaluate(() => window.__SYN.engine.frame);
    await en.waitForFunction((t) => window.__SYN.engine.frame > t, f0 + k, { timeout: 240000 }).catch(() => {});
  };
  // Rack 22→2.8 (radius 27px), not 22→0.95: at f/0.95 the standalone drops
  // below ~0.5fps under SwiftShader and the 80-frame wait exceeds an hour;
  // the same easing math is exercised at 2.8, and the wide-aperture settled
  // look (f/2, f/1.4) is already pixel-proven by the static suite.
  const easeCfg = { bokehMM: 100, fStop: 22, grain: 0 };
  await applySA(easeCfg); await applyEN(easeCfg);
  await saFrames(40); await enFrames(40);
  const sharpS = await grabSA(); const sharpE = await grabEN();
  await applySA({ ...easeCfg, fStop: 2.8 }); await applyEN({ ...easeCfg, fStop: 2.8 });
  await saFrames(2); await enFrames(2);
  const midS = await grabSA(); const midE = await grabEN();
  await saFrames(40); await enFrames(40);
  const wideS = await grabSA(); const wideE = await grabEN();
  const totS = mad(sharpS, wideS), totE = mad(sharpE, wideE);
  const remS = mad(midS, wideS), remE = mad(midE, wideE);
  const cWide = corr(wideS, wideE);
  step('E. f-stop rack eases per frame and settles identically, both sides',
    totS > 0.004 && totE > 0.004 && remS > totS * 0.15 && remE > totE * 0.15 && cWide > 0.97,
    `total S/E=${totS.toFixed(3)}/${totE.toFixed(3)} remaining-early S/E=${remS.toFixed(3)}/${remE.toFixed(3)} settled corr=${cWide.toFixed(3)}`);

  /* ── F. manual mod routing (no default routes by design) ── */
  await en.setInputFiles('[data-testid="audio-file"]', path.join(SCRATCH, 'beat120.wav'));
  await en.waitForSelector('[data-testid="audio-playpause"]', { timeout: 5000 });
  await en.waitForTimeout(500);
  let modSrc = '';
  for (let i = 0; i < 7 && modSrc.trim() !== 'BASS'; i++) {
    await en.click('[data-testid="mod-src-anamorphic_lab-vignette"]');
    modSrc = await en.locator('[data-testid="mod-src-anamorphic_lab-vignette"]').textContent();
  }
  step('F. mod route cycles to BASS on vignette', modSrc.trim() === 'BASS', modSrc);
  await en.evaluate(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const amt = document.querySelector('[data-testid="mod-amt-anamorphic_lab-vignette"]');
    setV.call(amt, 1); amt.dispatchEvent(new Event('change', { bubbles: true }));
    const base = document.querySelector('[data-testid="param-anamorphic_lab-vignette"]');
    setV.call(base, 0); base.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const modVals = [];
  for (let i = 0; i < 14; i++) {
    const t = await en.locator('[data-testid="mod-val-anamorphic_lab-vignette"]').textContent().catch(() => '');
    const m = String(t).match(/[\d.]+/);
    if (m) modVals.push(parseFloat(m[0]));
    await en.waitForTimeout(180);
  }
  const spread = modVals.length ? Math.max(...modVals) - Math.min(...modVals) : 0;
  step('F. routed vignette readout modulates with the beat', spread >= 0.05 && modVals.length >= 8,
    `spread=${spread.toFixed(2)} over [${modVals.slice(0, 8).map((v) => v.toFixed(2)).join(',')}]`);

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase6-behavior-summary.json'), JSON.stringify({
    longExposureCorr: +cLE.toFixed(3),
    flare: { dS: +dS.toFixed(4), dE: +dE.toFixed(4) },
    breathing: { still, breath },
    fstopEase: { totS: +totS.toFixed(3), totE: +totE.toFixed(3), remS: +remS.toFixed(3), remE: +remE.toFixed(3) },
    reactSpread: +spread.toFixed(2),
  }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
