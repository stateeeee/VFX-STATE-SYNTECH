/* Phase 5 chain sanity (H) — bokeh + analog (the two real ports) composed in
 * one engine, real MediaPipe path, playing video: chain order, GL errors,
 * non-black output, fps under SwiftShader (GPU criterion reported honestly).
 * Standalone script: the synchronous SwiftShader recompile of the full node
 * chain wedges the main thread long enough to defeat visibility-based waits
 * inside the bigger suite — here it gets a clean session and generous,
 * attachment-based waits. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const CDN = path.join(SCRATCH, 'cdn');
const MIME = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.tflite': 'application/octet-stream', '.binarypb': 'application/octet-stream', '.data': 'application/octet-stream' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

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
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 150)));

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.click('[data-testid="nodal-add"]');
  await page.click('[data-testid="nodal-add-bokeh"]');
  await page.click('[data-testid="nodal-add"]');
  await page.click('[data-testid="nodal-add-analog"]');
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForSelector('[data-testid="chain-canvas"]', { state: 'attached', timeout: 300000 });
  // ChainLab racks ALL registry effects (unwired ones stay enabled=false) —
  // ready when the tap is live and the two wired ports lead the chain enabled
  await page.waitForFunction(() => {
    const c = window.__SYN?.engine?.chain;
    return !!c && c.length >= 2 && c[0]?.id === 'bokeh' && c[0]?.enabled && c[1]?.id === 'analog' && c[1]?.enabled;
  }, null, { timeout: 300000 });
  await page.setInputFiles('[data-testid="chain-file"]', path.join(SCRATCH, 'parity1080.webm'));
  await page.waitForTimeout(2000);
  const segReady = await page.waitForFunction(
    () => document.querySelector('[data-testid="seg-status"]')?.textContent?.includes('READY'),
    null, { timeout: 180000 }
  ).then(() => true).catch(() => false);
  step('PersonMask READY on the real path (fresh session, 2-node chain)', segReady, '');
  await page.evaluate(() => { const v = window.__SYN.engine.source; if (v) { v.currentTime = 0; v.play(); } });
  await page.waitForTimeout(10000);
  const stat = await page.evaluate(() => {
    const S = window.__SYN;
    const gl = S.engine.gl;
    const c = document.querySelector('[data-testid="chain-canvas"]');
    const off = document.createElement('canvas'); off.width = 64; off.height = 36;
    const cx = off.getContext('2d');
    cx.drawImage(c, 0, 0, 64, 36);
    const d = cx.getImageData(0, 0, 64, 36).data;
    let lum = 0;
    for (let i = 0; i < d.length; i += 4) lum += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return {
      fps: S.engine.fps, res: S.engine.resScale, glErr: gl.getError(),
      chain: S.engine.chain.map((n) => `${n.id}${n.enabled ? '' : '(off)'}`).join('→'),
      meanLum: +(lum / (64 * 36)).toFixed(1),
      maskV: S.mask.version,
    };
  });
  const restOff = stat.chain.split('→').slice(2).every((s) => s.endsWith('(off)'));
  step('bokeh→analog chain renders (no GL errors, non-black, others bypassed)',
    stat.glErr === 0 && stat.meanLum > 2 && /^bokeh→analog(→|$)/.test(stat.chain) && restOff,
    JSON.stringify(stat));
  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));
  fs.writeFileSync(path.join(SCRATCH, 'phase5-chain-summary.json'), JSON.stringify(stat, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
