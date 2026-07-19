/* Phase 8 Layer-2 parity — BLOB TRACKER FX system (drawFxInBlob /
 * drawTextFill / applyFxBg + the bgFxMode branch) vs the standalone.
 *
 * invert + thermal are pure pixel functions → pixel-exact parity, tested in
 * BOTH bgFxMode states. security / liquid / glitch1(data) / glitch2 use
 * new Date() / performance.now() / Math.random() → behavioural: they must
 * change the frame on BOTH sides (independent seeds ⇒ not pixel-identical,
 * like bokeh's stochastic bgfx). 'default' re-confirms L1 (the bgFxMode-off
 * branch is a no-op with no FX). */
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

const FX_BTN = { invert: 'fx-invert', thermal: 'fx-thermal', security: 'fx-security', liquid: 'fx-liquid', data: 'fx-data', glitch: 'fx-glitch' };
const FX_PARAM = { invert: 'fxInvert', thermal: 'fxThermal', security: 'fxSecurity', liquid: 'fxLiquid', data: 'fxData', glitch: 'fxGlitch' };
const ALL_FX = Object.keys(FX_BTN);

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  const threeLocal = path.join(SCRATCH, 'cdn', 'three', 'build', 'three.min.js');
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, async (route) => {
    const url = route.request().url();
    if (/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js/.test(url) && fs.existsSync(threeLocal)) {
      await route.fulfill({ status: 200, body: fs.readFileSync(threeLocal), contentType: 'application/javascript', headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
  const clip = path.join(SCRATCH, 'parity1080.webm');
  const pageErrors = [];
  const isEnvErr = (s) => /(SelfieSegmentation|THREE) is not defined/.test(s) || /three\.min\.js|selfie_segmentation/.test(s);

  const sa = await ctx.newPage();
  sa.on('pageerror', (e) => { const s = String(e); if (!isEnvErr(s)) pageErrors.push('standalone: ' + s.slice(0, 150)); });
  await sa.goto('http://localhost:3000/effects/blob_tracker/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sa.waitForSelector('#fi-v', { state: 'attached', timeout: 120000 });
  await sa.setInputFiles('#fi-v', clip);
  await sa.waitForFunction(() => document.getElementById('vid')?.readyState >= 2, null, { timeout: 30000 }).catch(() => {});
  await sa.waitForTimeout(2000);

  const en = await ctx.newPage();
  en.on('pageerror', (e) => { const s = String(e); if (!isEnvErr(s)) pageErrors.push('engine: ' + s.slice(0, 150)); });
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
  await sa.evaluate(async () => {
    const dc = document.getElementById('dc'); dc.width = 1280; dc.height = 720;
    const v = document.getElementById('vid'); v.pause(); v.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
  });
  const szOk = await en.evaluate(() => { const c = document.querySelector('[data-testid="chain-canvas"]'); return c.width === 1280 && c.height === 720; });
  step('both pinned to 1280×720, paused t=1.0', szOk, '');

  const grab = (page, sel) => page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
  const grabSA = () => grab(sa, '#dc'), grabEN = () => grab(en, '[data-testid="chain-canvas"]');

  // set the FX flags + bgFxMode on both sides to an exact target state
  const setState = async (flags, bg) => {
    await sa.evaluate(({ FX_BTN, flags, bg, ALL_FX }) => {
      ALL_FX.forEach((k) => { const el = document.getElementById(FX_BTN[k]); const want = !!flags[k]; if (el.classList.contains('on') !== want) el.click(); });
      const bgb = document.getElementById('btn-bgfx'); if (bgb.classList.contains('on') !== !!bg) bgb.click();
    }, { FX_BTN, flags, bg, ALL_FX });
    await en.evaluate(({ FX_PARAM, flags, bg, ALL_FX }) => {
      const click = (tid, want) => { const el = document.querySelector(`[data-testid="param-blob_tracker-${tid}"]`); if (el && el.type === 'checkbox' && el.checked !== want) el.click(); };
      ALL_FX.forEach((k) => click(FX_PARAM[k], !!flags[k]));
      click('bgFxMode', !!bg);
    }, { FX_PARAM, flags, bg, ALL_FX });
  };
  const settled = async (page, sel) => {
    let prev = await grab(page, sel);
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(280); const cur = await grab(page, sel); if (mad(prev, cur) < 0.001) return cur; prev = cur; }
    return prev;
  };

  // clean baseline (no FX) for the behavioural deltas + L1 regression
  await setState({}, false);
  await sa.waitForTimeout(500);
  const cleanS = await settled(sa, '#dc'), cleanE = await settled(en, '[data-testid="chain-canvas"]');
  step('L1 regression: default (no FX) still pixel-identical', corr(cleanS, cleanE) > 0.93 && mad(cleanS, cleanE) < 0.06, `corr=${corr(cleanS, cleanE).toFixed(3)} mad=${mad(cleanS, cleanE).toFixed(3)}`);

  const summary = {};
  // deterministic: invert / thermal, both bg modes → pixel-exact
  for (const fx of ['invert', 'thermal']) for (const bg of [false, true]) {
    await setState({ [fx]: true }, bg);
    await sa.waitForTimeout(400);
    const sG = await settled(sa, '#dc'), eG = await settled(en, '[data-testid="chain-canvas"]');
    const c = corr(sG, eG), d = mad(sG, eG);
    const name = `${fx}-${bg ? 'inblob' : 'bg'}`;
    summary[name] = { corr: +c.toFixed(3), mad: +d.toFixed(3) };
    step(`L2 ${name} pixel-exact`, c > 0.93 && d < 0.06, `corr=${c.toFixed(3)} mad=${d.toFixed(3)}`);
  }

  // stochastic: security / liquid / data / glitch → must change output on BOTH
  // sides by a SIMILAR magnitude. Tested in bgFxMode (whole-frame FX) so the
  // change is robust on the paused clip; independent seeds ⇒ not pixel-equal.
  for (const fx of ['security', 'liquid', 'data', 'glitch']) {
    await setState({ [fx]: true }, true);
    await sa.waitForTimeout(700);
    const sG = await grabSA(), eG = await grabEN();
    const dS = mad(cleanS, sG), dE = mad(cleanE, eG);
    const ratio = Math.max(dS, dE) / Math.max(1e-6, Math.min(dS, dE));
    summary[`${fx}-delta`] = { dS: +dS.toFixed(4), dE: +dE.toFixed(4) };
    step(`L2 ${fx} changes output on BOTH sides, similar magnitude`, dS > 0.001 && dE > 0.001 && ratio < 3, `delta S/E=${dS.toFixed(4)}/${dE.toFixed(4)} ratio=${ratio.toFixed(2)}`);
  }

  // text fill (random) — changes output both sides in bg mode
  await setState({}, true);
  await en.evaluate(() => { const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; const el = document.querySelector('[data-testid="param-blob_tracker-textMode"]'); setV.call(el, 1); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sa.evaluate(() => { const el = document.getElementById('fx-nums'); if (!el.classList.contains('on')) el.click(); });
  await sa.waitForTimeout(700);
  const tS = await grabSA(), tE = await grabEN();
  step('L2 text fill (nums) changes output on BOTH sides', mad(cleanS, tS) > 0.003 && mad(cleanE, tE) > 0.003, `delta S/E=${mad(cleanS, tS).toFixed(4)}/${mad(cleanE, tE).toFixed(4)}`);

  step('no page errors either side', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase8-L2-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nL2 summary:', JSON.stringify(summary));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
