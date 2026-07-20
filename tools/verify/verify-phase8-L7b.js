/* Phase 8 Layer-7b check — BLOB TRACKER colours (engine-only).
 * The standalone's hex colour pickers (trackerColor/connColor/vfxColor) become
 * palette-enum indices (ParamSchema can't hold a hex). Verified by driving each
 * index and measuring the mean-RGB shift of the rendered frame in the expected
 * direction, on deterministic overlays:
 *  A. trackerColor — a filled contour (ctMode=1, ctFill=1): white→red drops
 *     mean G and B;
 *  B. connColor — the panel connection graph (glowing): blue→amber raises mean
 *     R and drops mean B;
 *  C. vfxColor — the Text-Fill FX (random, so averaged over frames): AUTO green
 *     → magenta raises mean R and B;
 *  D. no page errors. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

const grabRGBsrc = `(sel)=>{const cv=document.querySelector(sel);const off=document.createElement('canvas');off.width=320;off.height=180;const cx=off.getContext('2d',{willReadFrequently:true});cx.drawImage(cv,0,0,320,180);const d=cx.getImageData(0,0,320,180).data;let r=0,g=0,b=0;const n=320*180;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];b+=d[i+2];}return [r/n,g/n,b/n];}`;

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

  const grabRGB = () => en.evaluate(`(${grabRGBsrc})('[data-testid="chain-canvas"]')`);
  const setNum = (k, val) => en.evaluate(({ k, val }) => { const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.type === 'range') { setV.call(el, val); el.dispatchEvent(new Event('change', { bubbles: true })); } }, { k, val });
  const setBool = (k, on) => en.evaluate(({ k, on }) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${k}"]`); if (el && el.checked !== on) el.click(); }, { k, on });
  const avgRGB = async (n, gap = 220) => { const acc = [0, 0, 0]; for (let i = 0; i < n; i++) { await en.waitForTimeout(gap); const c = await grabRGB(); acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; } return acc.map((v) => v / n); };
  const settle = async (ms = 1400) => { await en.waitForTimeout(ms); return grabRGB(); };

  // A) trackerColor via a filled contour (deterministic)
  await setNum('ctMode', 1); await setBool('ctFill', true);
  await setNum('trackerColorIdx', 0); // white
  const tWhite = await settle(1500);
  await setNum('trackerColorIdx', 5); // red #ef4444
  const tRed = await settle(1400);
  const dTG = tRed[1] - tWhite[1], dTB = tRed[2] - tWhite[2];
  step('L7b trackerColorIdx tints markers/contours (white→red drops G+B)', dTG < -1 && dTB < -1, `dG=${dTG.toFixed(2)} dB=${dTB.toFixed(2)}`);
  await setNum('ctMode', 0); await setBool('ctFill', false);

  // B) connColor via the panel connection graph (glowing, static). Panel lines
  // are intentionally thin (connWidth×0.08) so they cover little of the frame —
  // widen + glow them for a clear mean shift; the direction is what matters.
  await setBool('panelsEnabled', true); await setNum('panelTurb', 0); await setNum('connGlow', 1); await setNum('connWidth', 20);
  await setNum('connColorIdx', 1); // blue #0011ff
  const cBlue = await settle(2200);
  await setNum('connColorIdx', 6); // amber #f59e0b
  const cAmber = await settle(1600);
  const dCR = cAmber[0] - cBlue[0], dCB = cAmber[2] - cBlue[2];
  step('L7b connColorIdx tints the connection graph (blue→amber raises R, drops B)', dCR > 0.4 && dCB < -0.4, `dR=${dCR.toFixed(2)} dB=${dCB.toFixed(2)}`);
  await setBool('panelsEnabled', false); await setNum('connGlow', 0);

  // C) vfxColor override on the Text-Fill FX (random → averaged over frames)
  await setNum('textMode', 1); // numbers
  await setBool('vfxColorOn', false);
  const vAuto = await avgRGB(7);
  await setBool('vfxColorOn', true); await setNum('vfxColorIdx', 8); // magenta #e879f9
  const vMag = await avgRGB(7);
  const dVR = vMag[0] - vAuto[0], dVB = vMag[2] - vAuto[2];
  step('L7b vfxColor override recolours Text-Fill (AUTO green→magenta raises R+B)', dVR > 0.5 && dVB > 0.5, `dR=${dVR.toFixed(2)} dB=${dVB.toFixed(2)}`);
  await setNum('textMode', 0);

  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase8-L7b-summary.json'), JSON.stringify({ tWhite, tRed, cBlue, cAmber, vAuto, vMag }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
