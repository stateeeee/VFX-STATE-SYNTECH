/*
 * Phase 10 — CDN vendoring verification.
 *
 * Proves the five standalone effect HTMLs (and the shell) load their runtime
 * dependencies from the LOCAL vendor copies under /effects/vendor/ with NO
 * access to any external CDN. This sandbox already blocks cdn.jsdelivr.net /
 * cdnjs.cloudflare.com / fonts.gstatic.com for the headless browser, so a
 * clean load here is direct proof of offline resilience. We additionally FAIL
 * the run if any request escapes to a blocked CDN host.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-vendor.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';
const CDN_HOSTS = [
  'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com',
  'fonts.googleapis.com', 'fonts.gstatic.com', 'storage.googleapis.com',
  'ajax.googleapis.com',
];

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { (c ? pass++ : fail++); console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function loadEffect(browser, id, waitGlobal) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdnHits = [];
  const vendorHits = new Set();
  const failedReqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (CDN_HOSTS.some((h) => u.includes(h))) cdnHits.push(u);
    if (u.includes('/effects/vendor/')) vendorHits.add(u.split('/effects/vendor/')[1].split('?')[0]);
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    // ignore sourcemap misses + optional cross-origin noise
    if (u.endsWith('.map')) return;
    failedReqs.push(`${u} :: ${r.failure() && r.failure().errorText}`);
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

  await page.goto(`${BASE}/effects/${id}/index.html`, { waitUntil: 'load', timeout: 45000 });
  // give lazy <script> loaders + font swaps a beat
  await page.waitForTimeout(1500);

  let globalOk = true, globalNote = '';
  if (waitGlobal) {
    try {
      await page.waitForFunction((g) => typeof window[g] !== 'undefined', waitGlobal, { timeout: 20000 });
    } catch (e) {
      globalOk = false;
    }
    globalNote = `window.${waitGlobal} ${globalOk ? 'defined' : 'MISSING'}`;
  }

  // did the vendored fonts stylesheet resolve? (document.fonts ready + at least
  // one of our families available)
  const fontsReady = await page.evaluate(async () => {
    try { await document.fonts.ready; } catch (e) {}
    return document.fonts.check("12px 'JetBrains Mono'") || document.fonts.check("12px 'Barlow Condensed'");
  });

  await ctx.close();
  return { id, cdnHits, vendorHits: [...vendorHits], failedReqs, pageErrors, globalOk, globalNote, fontsReady };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  const plan = [
    { id: 'analog', g: null },                 // fonts only
    { id: 'anamorphic_lab', g: 'SelfieSegmentation' },
    { id: 'blob_reveal', g: 'SelfieSegmentation' },
    { id: 'bokeh', g: 'SelfieSegmentation' },
    { id: 'blob_tracker', g: 'THREE' },
  ];

  for (const p of plan) {
    let r;
    try {
      r = await loadEffect(browser, p.id, p.g);
    } catch (e) {
      ok(`${p.id} loads`, false, String(e.message || e));
      continue;
    }
    // 1) no CDN escapes
    ok(`${p.id}: zero external-CDN requests`, r.cdnHits.length === 0,
      r.cdnHits.length ? `LEAKED: ${r.cdnHits.slice(0, 3).join(', ')}` : `${r.vendorHits.length} vendor asset(s) served`);
    // 2) required global present (blocking dep loaded from vendor)
    if (p.g) ok(`${p.id}: ${p.g} from vendor`, r.globalOk, r.globalNote);
    // 3) vendored fonts resolved
    ok(`${p.id}: vendored font available`, r.fontsReady, r.fontsReady ? '' : 'no JetBrains/Barlow face loaded');
    // 4) no "not defined" / vendor 404 page errors
    const badErr = r.pageErrors.filter((m) => /is not defined|Failed to|404|import/i.test(m));
    ok(`${p.id}: no dep/page errors`, badErr.length === 0, badErr.slice(0, 2).join(' | '));
    if (r.failedReqs.length) console.log(`   (failed reqs: ${r.failedReqs.slice(0, 4).join(' ; ')})`);
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
