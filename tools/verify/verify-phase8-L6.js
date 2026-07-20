/* Phase 8 Layer-6 check — BLOB TRACKER three.js PANELS scene (engine-only).
 * The panels are a FIXED 8-panel 3D montage composited OVER dc, and the labels
 * + connector lines are drawn INTO dc via Canvas-2D at the projected positions
 * (operator decision — functionally equivalent to the standalone's HTML p-lbl
 * divs + SVG svg-lines, so NOT pixel-identical). Verified behaviourally:
 *  1. enabling panels visibly changes the frame (panels compose over dc);
 *  2. with panelTurb=0 + paused video the scene is STATIC (deterministic);
 *  3. toggling the labels changes the frame (labels + connector lines render);
 *  4. toggling mirrorPanels changes the frame (the panel FS flips the UV);
 *  5. with panelTurb>0 the montage animates over time (simplex turbulence);
 *  6/7. no GL errors on the engine context, no page errors. */
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

  const off = await settle(900); // tracker only, panels off

  // 1) enable panels — the 8-panel montage composites over dc (+ bg dim 0.5)
  await setBool('panelsEnabled', true);
  await setNum('panelTurb', 0); // freeze the montage so later diffs are isolated
  const s1 = await settle(2600);
  const dOn = mad(off, s1);
  step('L6 enabling panels visibly changes the frame (montage composites over dc)', dOn > 0.02, `mad vs off=${dOn.toFixed(4)}`);

  // 2) with turb=0 + paused video the montage is static (deterministic)
  const s2 = await settle(800);
  const dStatic = mad(s1, s2);
  step('L6 montage is static at panelTurb=0 (frozen simplex, converged camera)', dStatic < 0.005, `mad t→t2=${dStatic.toFixed(4)}`);

  // 3) toggling labels off removes the 8 label boxes + their connector lines
  await setBool('panelsLabels', false);
  const noLabels = await settle(800);
  const dLabels = mad(s2, noLabels);
  step('L6 labels + connector lines render into dc (labels toggle changes frame)', dLabels > 0.0006, `mad labels on→off=${dLabels.toFixed(4)}`);
  await setBool('panelsLabels', true);
  const base2 = await settle(800);

  // 4) mirrorPanels flips the UV sampled inside each panel (panel FS mirrorU)
  await setBool('mirrorPanels', true);
  const mir = await settle(800);
  const dMirror = mad(base2, mir);
  step('L6 mirrorPanels flips the sampled panel UV (frame changes)', dMirror > 0.001, `mad mirror on=${dMirror.toFixed(4)}`);
  await setBool('mirrorPanels', false);

  // 5) with turb>0 the montage animates over time (simplex turbulence + drift)
  await setNum('panelTurb', 1);
  const a1 = await settle(700);
  const a2 = await settle(1000);
  const dAnim = mad(a1, a2);
  step('L6 montage animates over time at panelTurb=1 (turbulence + camera drift)', dAnim > 0.0008, `mad t→t2=${dAnim.toFixed(4)}`);

  const glErr = await en.evaluate(() => window.__SYN.engine.gl.getError());
  step('no GL errors on the engine context', glErr === 0, `glErr=${glErr}`);
  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase8-L6-summary.json'), JSON.stringify({
    panelsOnDelta: +dOn.toFixed(4), staticDelta: +dStatic.toFixed(4), labelsDelta: +dLabels.toFixed(4),
    mirrorDelta: +dMirror.toFixed(4), animDelta: +dAnim.toFixed(4), glErr, pageErrors,
  }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
