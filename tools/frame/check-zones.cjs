/* Measures the zones the operator called out, so their state is checked, not eyeballed.
 *
 * Reads out/preview-day.png and out/preview-night.png (run preview-frame.cjs first).
 *
 * The contract it asserts, after the round-12 corrections:
 *   1. The bottom-right corner opening is lit WHOLE by day — including the upper
 *      lobe the operator ringed in red, which used to be cut off black at y=0.838.
 *   2. Nothing else in that corner lights up: the cage's outer rim is material, and
 *      material must read the SAME by day as by night. Every white piece the
 *      operator ringed in green was a backdrop leaking through the keyed rim.
 *   3. Empty openings stay black by day (the one beside the effects column).
 *   4. A panel opening is lit by day (the canary: if this fails the run is bogus).
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/frame/check-zones.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');

/* Windows are fractions of the viewport, measured off the region map — every one of
   them sits well inside a single region, never across an edge. */
const LIT_BY_DAY = {          // inside the corner opening: ivory by day, black at night
  'corner upper lobe (was the black rectangle)': [0.74, 0.76, 0.84, 0.86],
  'corner right lobe                          ': [0.928, 0.738, 0.950, 0.768],
  'corner lower sweep                         ': [0.83, 0.90, 0.87, 0.93],
  'nodes panel (canary)                       ': [0.20, 0.70, 0.35, 0.85],
};
const NEVER_LIT = {           // cage material + the empty opening: identical in both themes
  'bottom rim, left                           ': [0.10, 0.955, 0.40, 0.980],
  'bottom rim, centre                         ': [0.45, 0.955, 0.62, 0.980],
  'bottom rim below the nodes panel           ': [0.40, 0.928, 0.45, 0.940],
  'bottom rim below the gemini panel          ': [0.62, 0.955, 0.75, 0.980],
  'bottom rim, right of the corner            ': [0.972, 0.930, 0.995, 0.980],
  'right margin                               ': [0.975, 0.20, 0.995, 0.60],
  'empty opening beside the effects column    ': [0.915, 0.50, 0.940, 0.62],
};
/* The straight cut the operator ringed: a horizontal edge where the backdrop ended
   INSIDE the opening. Walk the column and demand an unbroken ivory run. */
const COLUMNS = [0.76, 0.79, 0.82];
const COL_FROM = 0.755, COL_TO = 0.855;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.goto('about:blank');
  const read = (f) => fs.readFileSync(`${__dirname}/out/${f}`).toString('base64');
  const out = await page.evaluate(async ({ day, night, LIT_BY_DAY, NEVER_LIT, COLUMNS, COL_FROM, COL_TO }) => {
    const grab = async (b64) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      return { W: c.width, H: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const D = await grab(day), N = await grab(night);
    const mean = ({ W, H, d }, [x0, y0, x1, y1]) => {
      let s = 0, n = 0;
      for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
        for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
          const i = (y * W + x) * 4; s += Math.max(d[i], d[i + 1], d[i + 2]); n++;
        }
      return s / n;
    };
    const lines = [];
    let fails = 0;
    const check = (ok, text) => { if (!ok) fails++; lines.push(`${ok ? 'PASS' : 'FAIL'}  ${text}`); };

    for (const [k, w] of Object.entries(LIT_BY_DAY)) {
      const dm = mean(D, w), nm = mean(N, w);
      check(dm >= 200 && nm <= 16, `${k}  day=${dm.toFixed(0)} (want >=200)  night=${nm.toFixed(0)} (want <=16)`);
    }
    for (const [k, w] of Object.entries(NEVER_LIT)) {
      const dm = mean(D, w), nm = mean(N, w);
      check(Math.abs(dm - nm) <= 1.5, `${k}  day=${dm.toFixed(1)}  night=${nm.toFixed(1)}  |diff|=${Math.abs(dm - nm).toFixed(2)} (want <=1.5)`);
    }
    for (const fx of COLUMNS) {
      const x = Math.round(fx * D.W);
      let dark = 0, worstRun = 0, worstY = 0;
      for (let y = Math.round(COL_FROM * D.H); y < Math.round(COL_TO * D.H); y++) {
        const i = (y * D.W + x) * 4;
        const v = Math.max(D.d[i], D.d[i + 1], D.d[i + 2]);
        if (v < 150) { dark++; if (dark > worstRun) { worstRun = dark; worstY = y / D.H; } } else dark = 0;
      }
      check(worstRun <= 3, `corner column x=${fx.toFixed(2)}  longest dark run ${worstRun}px` + (worstRun > 3 ? ` at y=${worstY.toFixed(3)} — the backdrop ends inside the opening` : ''));
    }
    return { lines, fails };
  }, { day: read('preview-day.png'), night: read('preview-night.png'), LIT_BY_DAY, NEVER_LIT, COLUMNS, COL_FROM, COL_TO });

  out.lines.forEach((l) => console.log(l));
  console.log(`\n${out.lines.length - out.fails}/${out.lines.length} checks pass`);
  await b.close();
  process.exitCode = out.fails ? 1 : 0;
})();
