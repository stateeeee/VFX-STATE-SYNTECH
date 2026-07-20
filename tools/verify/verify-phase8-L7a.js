/* Phase 8 Layer-7a check — BLOB TRACKER reactivity ROUTES (engine-only).
 * The standalone's bespoke auto-driver (audioReactiveFrame/applyAudioToParams/
 * videoReactiveFrame — a 7-band analyser modulating params) is mapped to
 * ParamBus defaultRoutes on the shared AudioEngine/VideoAnalyzer signals
 * (decision #1, the analog pattern). Verified via the ParamBus tap:
 *  1. each seeded route (source + amount) is present on the node;
 *  2. driving the signals modulates every routed param UP from its base by the
 *     ParamBus formula base + signal*amount*(max-min);
 *  3. zero signals return every param to its base;
 *  4. no page errors. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

// expected seeded routes + the base/range needed to predict the modulated value
const EXPECT = {
  connWidth:   { source: 'bass',   amount: 0.45, base: 10, min: 1,   max: 20 },
  connGlow:    { source: 'loud',   amount: 0.4,  base: 0,  min: 0,   max: 1  },
  datamosh:    { source: 'treble', amount: 0.5,  base: 8,  min: 0,   max: 30 },
  glitchAmt:   { source: 'beat',   amount: 0.5,  base: 6,  min: 0,   max: 20 },
  panelScale:  { source: 'bass',   amount: 0.4,  base: 1,  min: 0.2, max: 3  },
  panelTurb:   { source: 'motion', amount: 0.6,  base: 1,  min: 0,   max: 3  },
  rippleForce: { source: 'beat',   amount: 1,    base: 0,  min: 0,   max: 1  },
};

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
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
  await en.waitForTimeout(1500);

  // 1) routes seeded on the ParamBus
  const routes = await en.evaluate(() => {
    const S = window.__SYN;
    const out = {};
    for (const k of Object.keys(S.bus.state)) { if (k.startsWith('blob_tracker.')) out[k.slice('blob_tracker.'.length)] = S.bus.state[k].mod; }
    return out;
  });
  let routeOk = true; const routeDetail = [];
  for (const [k, e] of Object.entries(EXPECT)) {
    const m = routes[k];
    const ok = m && m.source === e.source && near(m.amount, e.amount, 0.001);
    if (!ok) { routeOk = false; routeDetail.push(`${k}:${m ? m.source + '/' + m.amount : 'MISSING'}`); }
  }
  step('L7a all reactivity routes seeded (source+amount)', routeOk, routeOk ? `${Object.keys(EXPECT).length} routes ok` : 'bad: ' + routeDetail.join(', '));

  // 2) drive signals=1 → every routed param rises to base + amount*(max-min)
  const hot = await en.evaluate(() => {
    const S = window.__SYN;
    S.bus.apply(S.engine.chain, { bass: 1, loud: 1, treble: 1, beat: 1, motion: 1, bright: 1 });
    const n = S.engine.chain.find((x) => x.id === 'blob_tracker');
    const o = {}; for (const k of ['connWidth', 'connGlow', 'datamosh', 'glitchAmt', 'panelScale', 'panelTurb', 'rippleForce']) o[k] = Number(n.getParam(k));
    return o;
  });
  let modOk = true; const modDetail = [];
  for (const [k, e] of Object.entries(EXPECT)) {
    const expected = Math.min(e.max, e.base + 1 * e.amount * (e.max - e.min));
    if (!near(hot[k], expected, 0.06)) { modOk = false; modDetail.push(`${k}:${hot[k].toFixed(2)}≠${expected.toFixed(2)}`); }
  }
  step('L7a signals modulate every routed param by base + amt*(max-min)', modOk, modOk ? 'all 7 match' : modDetail.join(', '));

  // 3) zero signals → back to base
  const cold = await en.evaluate(() => {
    const S = window.__SYN;
    S.bus.apply(S.engine.chain, { bass: 0, loud: 0, treble: 0, beat: 0, motion: 0, bright: 0 });
    const n = S.engine.chain.find((x) => x.id === 'blob_tracker');
    const o = {}; for (const k of ['connWidth', 'connGlow', 'datamosh', 'glitchAmt', 'panelScale', 'panelTurb', 'rippleForce']) o[k] = Number(n.getParam(k));
    return o;
  });
  let baseOk = true; const baseDetail = [];
  for (const [k, e] of Object.entries(EXPECT)) { if (!near(cold[k], e.base, 0.06)) { baseOk = false; baseDetail.push(`${k}:${cold[k].toFixed(2)}≠${e.base}`); } }
  step('L7a zero signals return every param to base', baseOk, baseOk ? 'all 7 at base' : baseDetail.join(', '));

  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase8-L7a-summary.json'), JSON.stringify({ routes, hot, cold }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
