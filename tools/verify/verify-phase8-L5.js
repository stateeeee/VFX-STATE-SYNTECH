/* Phase 8 Layer-5 check — BLOB TRACKER three.js ripple sim (engine-only).
 * The mouse force is replaced by the audio-reactive rippleForce (operator
 * decision a), so there is no standalone mouse equivalent to pixel-match.
 * Two engine checks instead:
 *  1. rippleOn with force 0 ≈ ripple OFF  → the wave field is flat, the
 *     display shader is a clean passthrough of dc (proves the sim + shaders +
 *     orientation are correct through the offscreen three.js renderer);
 *  2. injecting rippleForce visibly displaces the frame (the wave sim runs). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const DW = 160, DH = 90;
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
  en.on('pageerror', (e) => pageErrors.push('engine: ' + String(e).slice(0, 150)));
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
  const setBool = (k, on) => en.evaluate(({ k, on }) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.checked !== on) el.click(); }, { k, on });
  const setNum = (k, val) => en.evaluate(({ k, val }) => { const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.type === 'range') { setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); } }, { k, val });
  const settle = async (ms = 1600) => { await en.waitForTimeout(ms); return grab(); };

  const off = await settle(800);
  await setBool('rippleOn', true);
  await setNum('rippleForce', 0); // no beat, no manual force → flat field
  const onFlat = await settle(1800);
  const cPass = corr(off, onFlat), dPass = mad(off, onFlat);
  step('L5 ripple ON @ force 0 is a clean passthrough of dc (sim+orientation ok)', cPass > 0.93 && dPass < 0.06, `corr=${cPass.toFixed(3)} mad=${dPass.toFixed(3)}`);

  // inject a strong continuous force at max displacement → waves emanate
  await setNum('rippleDisp', 0.04); // max displacement for a clear signal
  await setNum('rippleForce', 1.0);
  const onForce = await settle(3000);
  const dForce = mad(onFlat, onForce);
  step('L5 injecting rippleForce visibly displaces the frame (wave sim runs)', dForce > 0.003, `mad vs flat=${dForce.toFixed(4)}`);

  // ripple keeps evolving over time (feedback sim, not a static frame)
  const onForce2 = await settle(1400);
  step('L5 ripple field evolves over time (feedback ping-pong)', mad(onForce, onForce2) > 0.0006, `mad t→t2=${mad(onForce, onForce2).toFixed(4)}`);

  const glErr = await en.evaluate(() => window.__SYN.engine.gl.getError());
  step('no GL errors on the engine context', glErr === 0, `glErr=${glErr}`);
  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase8-L5-summary.json'), JSON.stringify({ passCorr: +cPass.toFixed(3), passMad: +dPass.toFixed(3), forceDelta: +dForce.toFixed(4) }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
