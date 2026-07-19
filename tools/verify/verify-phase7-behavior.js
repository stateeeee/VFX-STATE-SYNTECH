/* Phase 7 behavior suite — BLOB REVEAL checks a paused seg-off pixel
 * comparison cannot cover:
 *  A. real MediaPipe path through the shared PersonMask
 *  B. playing-video long-exposure parity of the blob windows (seg off)
 *  C. subject reveal: with the SAME injected mask both sides, the erode/
 *     feather/opacity/threshold compositing matches, and enabling seg puts
 *     the revealed subject on screen
 *  D. audio-reactive expansion: the beatReact→loud default route grows the
 *     blob windows when a beat track plays (engine side — the standalone's
 *     built-in analyser is the replaced subsystem, Phase-4 substitution)
 *  E. the beatReact default route modulates its readout with the beat
 * Chain sanity lives in verify-phase7-chain.js. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const CDN = path.join(SCRATCH, 'cdn');
const DW = 160, DH = 90;
const MIME = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.data': 'application/octet-stream' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const DEFAULTS = { segThr: 40, erode: 4, feather: 3, opacity: 1, segN: 1, lumThr: 170, minArea: 300, maxBlobs: 14, dilate: 4, audioExp: 24 };

/* alpha-encoded person mask: opaque white ellipse on transparent bg — the
 * destination-in cut reads alpha, so this is what drives the reveal. Same
 * draw on both sides. */
const maskDrawSrc = `(cv) => {
  cv.width = 480; cv.height = 270;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 480, 270);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath(); g.ellipse(240, 150, 96, 120, 0, 0, 7); g.fill();
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
  await en.click('[data-testid="nodal-add-blob_reveal"]');
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

  // deterministic mask on the engine tap from here on
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

  /* ── standalone: real MP fires onResults; createImageBitmap override makes
     lastMaskBitmap the SAME synthetic mask (a fresh bitmap each call, since
     onResults closes the previous one) ── */
  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => pageErrors.push('standalone: ' + String(e).slice(0, 150)));
  await sa.goto('http://localhost:3000/effects/blob_reveal/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#file-input', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2500);
  await sa.evaluate(`(() => {
    ['dc','c-blob','c-mask','c-sub','c-erode'].forEach((id)=>{ const c=document.getElementById(id); c.width=1280; c.height=720; });
    window.__mcv = document.createElement('canvas');
    (${maskDrawSrc})(window.__mcv);
    const orig = window.createImageBitmap.bind(window);
    window.createImageBitmap = () => orig(window.__mcv);
  })()`);
  const saSegReady = await sa.waitForFunction(
    () => document.getElementById('bb-status')?.textContent?.includes('READY'),
    null, { timeout: 60000 }
  ).then(() => true).catch(() => false);
  step('A. standalone MediaPipe READY (drives the injected-mask override)', saSegReady, '');

  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
  const grabSA = () => grab(sa, '#dc');
  const grabEN = () => grab(en, '[data-testid="chain-canvas"]');

  const SL = { segThr: 'sl-thr', erode: 'sl-erode', feather: 'sl-feather', opacity: 'sl-opacity', segN: 'sl-segn', lumThr: 'sl-lum', minArea: 'sl-minarea', maxBlobs: 'sl-maxblobs', dilate: 'sl-dil', audioExp: 'sl-audioexp' };
  const applySA = (over, segOn) => sa.evaluate(({ P2, SL, segOn }) => {
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.getElementById(SL[k]);
      if (!el) return;
      el.value = k === 'opacity' ? Math.round(val * 100) : val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    if (segOn !== undefined) {
      const btn = document.getElementById('btn-seg');
      if (btn.classList.contains('on') !== segOn) btn.click();
    }
  }, { P2: { ...DEFAULTS, ...over }, SL, segOn });
  const applyEN = (over, segOn) => en.evaluate(({ P2, segOn }) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    Object.entries(P2).forEach(([k, val]) => {
      const el = document.querySelector(`[data-testid="param-blob_reveal-${k}"]`);
      if (!el || el.type !== 'range') return;
      setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (segOn !== undefined) {
      const seg = document.querySelector('[data-testid="param-blob_reveal-segEnabled"]');
      if (seg && seg.checked !== segOn) seg.click();
    }
  }, { P2: { ...DEFAULTS, ...over }, segOn });

  const pauseBoth = async (t) => {
    await sa.evaluate(async (tt) => {
      const v = document.getElementById('vid'); v.pause(); v.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
    await en.evaluate(async (tt) => {
      const v = window.__SYN.engine.source; v.pause(); v.currentTime = tt;
      await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    }, t);
  };
  const settled = async (page, sel) => {
    let prev = await grab(page, sel);
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const cur = await grab(page, sel);
      if (mad(prev, cur) < 0.001) return cur;
      prev = cur;
    }
    return prev;
  };

  /* ── B. playing blob-window long-exposure parity (seg OFF) ── */
  await applySA({}, false); await applyEN({}, false);
  await sa.evaluate(() => { const v = document.getElementById('vid'); v.currentTime = 0; v.play(); });
  await en.evaluate(() => { const v = window.__SYN.engine.source; v.currentTime = 0; v.play(); });
  await sa.waitForTimeout(700);
  const accS = new Array(DW * DH).fill(0), accE = new Array(DW * DH).fill(0);
  for (let i = 0; i < 10; i++) {
    const [gS, gE] = await Promise.all([grabSA(), grabEN()]);
    for (let j = 0; j < accS.length; j++) { accS[j] += gS[j] / 10; accE[j] += gE[j] / 10; }
    await en.waitForTimeout(300);
  }
  const cLE = corr(accS, accE);
  step('B. playing blob-window long-exposure corr (seg off)', cLE > 0.9, `corr=${cLE.toFixed(3)}`);

  /* ── C. subject reveal with the SAME injected mask both sides ── */
  await applySA({}, false); await applyEN({}, false);
  await pauseBoth(1.0);
  const offS = await settled(sa, '#dc'); const offE = await settled(en, '[data-testid="chain-canvas"]');
  // enable seg both sides; the standalone's frame() loop keeps calling
  // segObj.send() on the paused frame, so onResults (→ the createImageBitmap
  // override → lastMaskBitmap = synthetic) fires without advancing the frame
  await applySA({}, true); await applyEN({}, true);
  await bumpMask(6);
  await sa.waitForTimeout(1500);
  const SUBJECT = [
    { name: 'subject-default', p: {} },
    { name: 'subject-erode', p: { erode: 20 } },
    { name: 'subject-feather', p: { feather: 20 } },
    { name: 'subject-opacity', p: { opacity: 0.5 } },
    { name: 'subject-thr-high', p: { segThr: 90 } },
  ];
  const subj = {};
  for (const cfg of SUBJECT) {
    await applySA(cfg.p, true); await applyEN(cfg.p, true);
    await bumpMask(3);
    await sa.waitForTimeout(400);
    const sG = await settled(sa, '#dc'); const eG = await settled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG);
    subj[cfg.name] = +c.toFixed(3);
    step(`C. ${cfg.name} parity (same injected mask)`, c > 0.9, `corr=${c.toFixed(3)}`);
  }
  // seg on adds the subject vs seg off (both sides)
  await applySA({}, true); await applyEN({}, true);
  await bumpMask(3); await sa.waitForTimeout(400);
  const onS = await settled(sa, '#dc'); const onE = await settled(en, '[data-testid="chain-canvas"]');
  const dS = mad(offS, onS), dE = mad(offE, onE);
  step('C. enabling seg reveals the subject on BOTH sides', dS > 0.01 && dE > 0.01, `delta S/E=${dS.toFixed(3)}/${dE.toFixed(3)}`);

  /* ── D. audio-reactive expansion (engine): beatReact→loud default route.
     D/E are engine-only (the standalone's built-in analyser is the replaced
     subsystem) — close the standalone to free the second heavy page. ── */
  await sa.close();
  await applyEN({}, false); // seg off, blob windows only
  await en.evaluate(async () => {
    const v = window.__SYN.engine.source; v.pause(); v.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
  });
  const quietE = await settled(en, '[data-testid="chain-canvas"]');
  await en.setInputFiles('[data-testid="audio-file"]', path.join(SCRATCH, 'beat120.wav'));
  // the DOM playpause appears once React re-renders the transport; wait on the
  // engine's own audio state instead (robust under load), then let loud rise
  const audioUp = await en.waitForFunction(() => !!window.__SYN.audio?.transport && window.__SYN.audio.levels.loud > 0.02, null, { timeout: 25000 })
    .then(() => true).catch(() => false);
  step('D. audio file loaded and driving the loud signal', audioUp, '');
  // sample the blob-window area over a couple of seconds of beat playback
  let maxD = 0;
  for (let i = 0; i < 16; i++) {
    const g = await grabEN();
    maxD = Math.max(maxD, mad(quietE, g));
    await en.waitForTimeout(200);
  }
  step('D. beat track expands the blob windows (beatReact→loud route)', maxD > 0.004, `max mad vs quiet=${maxD.toFixed(4)}`);

  /* ── E. beatReact default-route readout modulates with the beat ── */
  const src = await en.locator('[data-testid="mod-src-blob_reveal-beatReact"]').textContent().catch(() => '');
  step('E. beatReact is pre-wired to LOUD by default', String(src).trim() === 'LOUD', String(src).trim());
  const modVals = [];
  for (let i = 0; i < 14; i++) {
    const t = await en.locator('[data-testid="mod-val-blob_reveal-beatReact"]').textContent().catch(() => '');
    const m = String(t).match(/[\d.]+/);
    if (m) modVals.push(parseFloat(m[0]));
    await en.waitForTimeout(180);
  }
  const spread = modVals.length ? Math.max(...modVals) - Math.min(...modVals) : 0;
  step('E. routed beatReact readout modulates with the beat', spread >= 0.05 && modVals.length >= 8, `spread=${spread.toFixed(2)}`);

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase7-behavior-summary.json'), JSON.stringify({
    longExposureCorr: +cLE.toFixed(3), subject: subj,
    revealDelta: { dS: +dS.toFixed(3), dE: +dE.toFixed(3) },
    audioMaxD: +maxD.toFixed(4), reactSpread: +spread.toFixed(2),
  }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
