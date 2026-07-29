/*
 * Brain graph — WHITE IS RESERVED (operator direction, 2026-07-29):
 * "solo vfx syntech e l'effetto selezionato devono avere il puntino bianco".
 *
 * A still frame cannot prove this: the graph used to whiten each hub in turn as a
 * heartbeat pulse ARRIVED, so any single screenshot showed a different, plausible
 * set. This instruments the 2D context instead — every filled arc is recorded with
 * its radius and its fill colour, and `clearRect` marks the frame boundary — then
 * counts the white node dots PER FRAME over a few hundred frames.
 *
 * Node radii: core 9·scale, hubs 6.5·scale, satellites ≤2.7·scale, travelling
 * pulses 1.8/1.1. A radius floor of 4 therefore keeps the core and the hubs and
 * drops the rest; the halo rings are strokes (not fills) and the glows are canvas
 * gradients (not colour strings), so neither is counted.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-graph-highlight.js
 */
const { chromium } = require('playwright');

const R_FLOOR = 4;      // keeps core + hubs, drops satellites and pulses
const SAMPLE_MS = 5000; // a few hundred frames — every hub flashes several times

let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    const proto = CanvasRenderingContext2D.prototype;
    const arc = proto.arc, fill = proto.fill, clearRect = proto.clearRect, fillRect = proto.fillRect;
    window.__frame = 0;
    window.__white = [];   // { f, x, y, r }
    window.__dots = [];    // every node-sized filled arc, white or not
    /* Frame boundary. The loop clears with clearRect only when the hero canvas is
       transparent; with the opaque theme it paints a full-canvas fillRect instead,
       so both have to count or the per-frame maths silently collapses to one frame. */
    const wholeCanvas = (x, y, w, h) => x === 0 && y === 0 && w > 200 && h > 200;
    proto.clearRect = function (x, y, w, h) { if (wholeCanvas(x, y, w, h)) window.__frame++; return clearRect.call(this, x, y, w, h); };
    proto.fillRect = function (x, y, w, h) { if (wholeCanvas(x, y, w, h)) window.__frame++; return fillRect.call(this, x, y, w, h); };
    proto.arc = function (x, y, r, ...rest) { this.__lastArc = { x, y, r }; return arc.call(this, x, y, r, ...rest); };
    proto.fill = function (...a) {
      const fs = this.fillStyle, la = this.__lastArc;
      if (la && la.r >= 4 && typeof fs === 'string') {
        window.__dots.push({ f: window.__frame, r: +la.r.toFixed(1), fs });
        if (/^#f{3,6}$/i.test(fs) || /rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(fs)) {
          window.__white.push({ f: window.__frame, x: Math.round(la.x), y: Math.round(la.y), r: +la.r.toFixed(1) });
        }
      }
      return fill.apply(this, a);
    };
  });

  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);

  const sample = async (label) => {
    await page.evaluate(() => { window.__white = []; window.__dots = []; });
    await page.waitForTimeout(SAMPLE_MS);
    return page.evaluate(() => {
      const perFrame = new Map();
      for (const w of window.__white) perFrame.set(w.f, (perFrame.get(w.f) || 0) + 1);
      const counts = [...perFrame.values()];
      const frames = new Set(window.__dots.map((d) => d.f)).size;
      // cluster the white dots by position, so we can see WHICH nodes they are
      const clusters = [];
      for (const w of window.__white) {
        const c = clusters.find((k) => Math.abs(k.x - w.x) < 60 && Math.abs(k.y - w.y) < 60);
        if (c) { c.n++; c.x = (c.x * (c.n - 1) + w.x) / c.n; c.y = (c.y * (c.n - 1) + w.y) / c.n; }
        else clusters.push({ x: w.x, y: w.y, n: 1, r: w.r });
      }
      return {
        frames, whites: window.__white.length, dots: window.__dots.length,
        max: counts.length ? Math.max(...counts) : 0,
        min: counts.length ? Math.min(...counts) : 0,
        modal: counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0,
        clusters: clusters.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), n: c.n, r: c.r })),
      };
    });
  };

  const first = await sample('blob_tracker selected');
  step('the graph is actually animating while sampled', first.frames > 60 && first.dots > 300,
    `${first.frames} frames, ${first.dots} node dots`);
  step('never more than two white dots in a frame (core + selected)', first.max <= 2,
    `max ${first.max}, median ${first.modal} per frame`);
  step('both of them are white every frame', first.min === 2 && first.modal === 2,
    `min ${first.min} per frame`);
  step('the two whites are two fixed nodes, not whichever just pulsed',
    first.clusters.length === 2,
    first.clusters.map((c) => `(${c.x},${c.y}) r=${c.r} ×${c.n}`).join(' | '));

  // switch the selection: the white pair must FOLLOW it, still two
  await page.click('[data-testid="effect-card-bokeh"]');
  await page.waitForTimeout(1200);
  await page.click('[data-testid="nav-home"]');
  await page.waitForTimeout(1500);
  const second = await sample('bokeh selected');
  step('after switching module: still exactly two whites', second.max <= 2 && second.min === 2,
    `min ${second.min} max ${second.max}, clusters ${second.clusters.length}`);
  const moved = second.clusters.some((c) => !first.clusters.some((k) => Math.abs(k.x - c.x) < 40 && Math.abs(k.y - c.y) < 40));
  step('the white followed the newly selected module', moved,
    `was ${first.clusters.map((c) => `(${c.x},${c.y})`).join(',')} → now ${second.clusters.map((c) => `(${c.x},${c.y})`).join(',')}`);

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
