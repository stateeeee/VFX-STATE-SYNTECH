/* Feedback parity, frame-rate independent: after a seek with feedbackAmt=0.9
 * the distance to steady state must decay ~×0.9 per RENDERED frame on both
 * sides (engine ~59fps vs standalone ~4fps in this sandbox, so wall-time
 * comparison is meaningless — per-frame math is the 1:1 claim). */
const { chromium } = require('playwright');
const path = require('path');
const SCRATCH = '__SCRATCH__';
const DW = 128, DH = 72;
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
const mad = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]-b[i]); return s / a.length; };

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  const clip = path.join(SCRATCH, 'parity1080.webm');

  const sa = await ctx.newPage();
  await sa.goto('http://localhost:3000/effects/analog/index.html', { waitUntil: 'load' });
  await sa.setInputFiles('#file-input', clip);
  await sa.waitForTimeout(2000);
  await sa.evaluate(async () => {
    video.pause(); video.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    // neutral except feedback
    ['feedbackZoom','feedbackRot','feedbackDecay','hueShift','feedbackDriftX','tearAmt','dropoutAmt','chromaAmt','noiseAmt','rollBar','trackingErr','barrelAmt','scanlinesAmt','phosphorAmt','bloomAmt','vignetteAmt'].forEach((k) => syncKnob(k, 0));
    syncKnob('crtBlend', 1);
    syncKnob('feedbackAmt', 0.9);
    syncKnob('feedbackDecay', 0.05);
    const led = (id, want) => { const el = document.getElementById(id); if (el && el.classList.contains('on') !== want) el.click(); };
    led('btn-mirror', false); led('btn-sort', false); led('btn-react', false);
    clearFeedback();
  });

  const en = await ctx.newPage();
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-analog"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]');
  await en.setInputFiles('[data-testid="chain-file"]', clip);
  await en.waitForTimeout(1500);
  await en.evaluate(async () => {
    const S = window.__SYN;
    S.engine.adaptiveRes = false;
    S.engine.setResScale(1);
    const v = S.engine.source;
    v.pause(); v.currentTime = 1.0;
    await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]);
    const node = S.engine.chain.find((n) => n.id === 'analog');
    node.params.forEach((p) => { if (p.type === 'number') S.bus.setBase(node, p.key, ({ crtBlend: 1, sortThresh: 0.5, sortPasses: 3, reactSens: 1 })[p.key] ?? 0); });
    S.bus.setBase(node, 'feedbackAmt', 0.9);
    S.bus.setBase(node, 'feedbackDecay', 0.05);
    node.setParam('feedbackMirror', 0); node.setParam('sortEnabled', 0); node.setParam('reactEnabled', 0);
  });
  await sa.waitForTimeout(2500); // both trails converge on frame A

  const seq = async (page, sel, seekSrc, frameSrc) => {
    await page.evaluate(seekSrc);
    const out = [];
    for (let i = 0; i < 18; i++) {
      const g = await page.evaluate(`(${grabOnceSrc})(${JSON.stringify(sel)})`);
      const f = await page.evaluate(frameSrc);
      out.push({ g, f });
      await page.waitForTimeout(260);
    }
    const final = out[out.length - 1].g;
    return out.map(({ g, f }) => ({ d: mad(g, final), f }));
  };
  const [sSeq, eSeq] = [
    await seq(sa, '#glcanvas',
      `(async () => { video.currentTime = 1.6; await Promise.race([new Promise((r) => { const on = () => { video.removeEventListener('seeked', on); r(); }; video.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]); })()`,
      `STATE.frameCount`),
    await seq(en, '[data-testid="chain-canvas"]',
      `(async () => { const v = window.__SYN.engine.source; v.currentTime = 1.6; await Promise.race([new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); }), new Promise((r) => setTimeout(r, 2500))]); })()`,
      `window.__SYN.engine.frame`),
  ];
  const perFrameRatio = (arr) => {
    const rs = [];
    for (let i = 1; i < arr.length; i++) {
      const df = arr[i].f - arr[i - 1].f;
      if (df < 1 || arr[i - 1].d < 0.02 || arr[i].d < 0.004) continue;
      rs.push(Math.pow(arr[i].d / arr[i - 1].d, 1 / df));
    }
    if (!rs.length) return NaN;
    return rs.reduce((s, v) => s * v, 1) ** (1 / rs.length);
  };
  const rS = perFrameRatio(sSeq);
  const rE = perFrameRatio(eSeq);
  const ok = Math.abs(rS - 0.9) < 0.06 && Math.abs(rE - 0.9) < 0.06;
  console.log(`${ok ? 'PASS' : 'FAIL'}  feedback per-frame decay matches fa=0.9 — r S=${rS.toFixed(3)} E=${rE.toFixed(3)}`);
  console.log('  S:', sSeq.map((x) => `${x.d.toFixed(3)}@f${x.f}`).slice(0, 10).join(' '));
  console.log('  E:', eSeq.map((x) => `${x.d.toFixed(3)}@f${x.f}`).slice(0, 10).join(' '));
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
