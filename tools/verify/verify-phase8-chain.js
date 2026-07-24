/* Phase 8 close-out — BLOB TRACKER chain sanity + mirrorBg (engine-only).
 *  1. the node renders in a chain with a broad feature set on (panels + ripple
 *     + flow + contour + FX) — non-black output, no GL errors, no page errors,
 *     frames keep advancing;
 *  2. mirrorBg horizontally flips the tracked video (the bright side swaps
 *     from right to left);
 *  3. a fresh grab differs over time (the composite is live). */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const DW = 320, DH = 180;
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// grab returns { g:[luma], meanL, leftL, rightL }
const grabSrc = `(sel) => {
  const cv = document.querySelector(sel);
  const off = document.createElement('canvas'); off.width = ${DW}; off.height = ${DH};
  const cx = off.getContext('2d', { willReadFrequently: true });
  cx.drawImage(cv, 0, 0, ${DW}, ${DH});
  const d = cx.getImageData(0, 0, ${DW}, ${DH}).data;
  const g = new Array(${DW * DH});
  let sum = 0, lSum = 0, rSum = 0, lN = 0, rN = 0;
  for (let y = 0; y < ${DH}; y++) for (let x = 0; x < ${DW}; x++) {
    const i = (y*${DW}+x); const l = (d[i*4]*0.2126 + d[i*4+1]*0.7152 + d[i*4+2]*0.0722)/255;
    g[i] = l; sum += l;
    if (x < ${DW}*0.33) { lSum += l; lN++; } else if (x > ${DW}*0.67) { rSum += l; rN++; }
  }
  return { g, meanL: sum/g.length, leftL: lSum/lN, rightL: rSum/rN };
}`;
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]-b[i]); return s / a.length; };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];
  const en = await ctx.newPage();
  en.on('pageerror', (e) => { const s = String(e); if (!/SelfieSegmentation|MediaPipe|tasks-vision|THREE is not defined/i.test(s)) pageErrors.push('engine: ' + s.slice(0, 150)); });
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

  const grab = () => en.evaluate(`(${grabSrc})('[data-testid="chain-canvas"]')`);
  const setBool = (k, on) => en.evaluate(({ k, on }) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.checked !== on) el.click(); }, { k, on });
  const setNum = (k, val) => en.evaluate(({ k, val }) => { const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.type === 'range') { setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); } }, { k, val });

  // 2) mirrorBg: the clip is dark on the left, bright on the right
  const off = await grab();
  step('mirror OFF: clip bright side is on the RIGHT', off.rightL > off.leftL + 0.05, `L=${off.leftL.toFixed(3)} R=${off.rightL.toFixed(3)}`);
  await setBool('mirrorBg', true);
  await en.waitForTimeout(800);
  const mir = await grab();
  step('mirrorBg flips the video (bright side now on the LEFT)', mir.leftL > mir.rightL + 0.05, `L=${mir.leftL.toFixed(3)} R=${mir.rightL.toFixed(3)}`);
  await setBool('mirrorBg', false);
  await en.waitForTimeout(600);

  // 1) broad feature set on → chain sanity
  await setBool('panelsEnabled', true);
  await setBool('rippleOn', true);
  await setBool('flowOn', true);
  await setNum('ctMode', 1); // edge contour
  await setBool('fxThermal', true);
  await setBool('connEnabled', true);
  await en.evaluate(() => { const S = window.__SYN; const v = S.engine.source; v.play().catch(() => {}); }); // motion for flow/panels
  await en.waitForTimeout(2500);
  const a = await grab();
  await en.waitForTimeout(900);
  const b = await grab();
  step('broad feature set renders non-black output', a.meanL > 0.02, `meanL=${a.meanL.toFixed(3)}`);
  step('composite is live (frames advance)', mad(a.g, b.g) > 0.0005, `mad t→t2=${mad(a.g, b.g).toFixed(4)}`);

  const glErr = await en.evaluate(() => window.__SYN.engine.gl.getError());
  step('no GL errors on the engine context', glErr === 0, `glErr=${glErr}`);
  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  const fps = await en.evaluate(() => window.__SYN.engine.fps ?? -1);
  console.log(`  (info) engine fps under SwiftShader = ${fps} — the ≥30fps@720p acceptance stays a GPU-machine criterion`);

  fs.writeFileSync(path.join(SCRATCH, 'phase8-chain-summary.json'), JSON.stringify({ off, mir: { leftL: mir.leftL, rightL: mir.rightL }, broadMeanL: a.meanL, live: mad(a.g, b.g), glErr, fps, pageErrors }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
