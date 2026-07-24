/* Phase 8 Layer-3b check — BLOB TRACKER smart contour (ctMode=2, engine-only).
 * Smart contour ray-casts the shared PersonMask instead of the detection
 * binary (mapped to the standalone's _ctSmartMask, per 04-SPEC — same shared-
 * service substitution as blob_reveal/bokeh/anamorphic). Verified without
 * MediaPipe by injecting a synthetic mask through the PersonMask tap:
 *  1. segEnabled derives from ctMode (0 at edge, 1 at smart) → the shell
 *     lazy-loads the segmenter exactly like the standalone's ct-smart button;
 *  2. ctMode=2 with NO mask present falls back to edge → PIXEL-IDENTICAL to
 *     ctMode=1 (the standalone's `_ctSmartMask ?? _ctBinMask`);
 *  3. injecting a person mask whose shape ≠ the luma blobs makes the smart
 *     contour follow the MASK → the frame changes;
 *  4. no GL errors, no page errors. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const DW = 320, DH = 180;
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

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];

  const en = await ctx.newPage();
  en.on('pageerror', (e) => { const s = String(e); if (!/SelfieSegmentation|MediaPipe|tasks-vision/i.test(s)) pageErrors.push('engine: ' + s.slice(0, 150)); });
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
  });

  const grab = () => en.evaluate(`(${grabOnceSrc})('[data-testid="chain-canvas"]')`);
  const setNum = (k, val) => en.evaluate(({ k, val }) => { const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.type === 'range') { setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); } }, { k, val });
  const setBool = (k, on) => en.evaluate(({ k, on }) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.checked !== on) el.click(); }, { k, on });
  const segEnabledFor = (mode) => en.evaluate((mode) => { const n = window.__SYN.engine.chain.find((x) => x.id === 'blob_tracker'); n.setParam('ctMode', mode); return Number(n.getParam('segEnabled')); }, mode);
  const settle = async (ms = 1600) => { await en.waitForTimeout(ms); return grab(); };

  // Neutralise the real MediaPipe loader up front so it never runs (the CDN is
  // blocked here) — otherwise its async failure sets ready=false and can wipe
  // an injected mask mid-flight. With enable/tick as no-ops we drive the mask
  // deterministically through the same personMask plumbing the node reads.
  await en.evaluate(() => { const mk = window.__SYN.mask; mk.enable = () => {}; mk.tick = () => {}; });

  await setBool('ctFill', true); // fill amplifies the edge-vs-mask contour delta

  // 1) segEnabled derives from ctMode
  const segEdge = await segEnabledFor(1), segSmart = await segEnabledFor(2);
  step('L3b segEnabled derives from ctMode (edge=0, smart=1) → shell loads the mask', segEdge === 0 && segSmart === 1, `edge=${segEdge} smart=${segSmart}`);

  // 2) smart with NO mask == edge (pixel-identical fallback)
  await setNum('ctMode', 1);
  const edge = await settle(1400);
  await setNum('ctMode', 2); // segEnabled→1: shell tries to load MediaPipe (fails in sandbox → mask stays null)
  const smartNoMask = await settle(1600);
  const cFall = corr(edge, smartNoMask), dFall = mad(edge, smartNoMask);
  step('L3b smart falls back to edge with no mask (pixel-identical)', cFall > 0.999 && dFall < 0.001, `corr=${cFall.toFixed(4)} mad=${dFall.toFixed(4)}`);

  // 3) inject a synthetic person mask (box ≠ the luma blob) → contour follows it
  await en.evaluate(() => {
    const mk = window.__SYN.mask;
    const mc = document.createElement('canvas'); mc.width = 256; mc.height = 256;
    const g = mc.getContext('2d'); g.clearRect(0, 0, 256, 256);
    g.fillStyle = 'rgba(255,255,255,1)'; g.fillRect(40, 40, 176, 176); // centred person box, alpha 255
    mk.maskCanvas = mc; mk.ready = true; mk.state = 'ready'; mk.version = (mk.version || 0) + 100;
  });
  const smartMask = await settle(1800);
  const dMask = mad(smartNoMask, smartMask);
  step('L3b injected person mask changes the smart contour (mask-driven, not luma)', dMask > 0.0004, `mad vs edge-fallback=${dMask.toFixed(4)}`);

  const glErr = await en.evaluate(() => window.__SYN.engine.gl.getError());
  step('no GL errors on the engine context', glErr === 0, `glErr=${glErr}`);
  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase8-L3b-summary.json'), JSON.stringify({ segEdge, segSmart, fallbackCorr: +cFall.toFixed(4), fallbackMad: +dFall.toFixed(4), maskDelta: +dMask.toFixed(4), glErr, pageErrors }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
