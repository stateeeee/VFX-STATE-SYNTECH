/*
 * THE CAGE — the geometric contract.
 *
 * This replaces verify-ui-gel-pass.js, which asserted the coloured gel slab in
 * the gaps between the sections. The cage removes that slab: those 41 assertions
 * would have gone red BY DESIGN, not by regression, and a suite that has to be
 * ignored is worse than no suite. What is checked here is what the redesign
 * actually promises:
 *
 *   1. The cage is ONE image, on top, with no blend mode, no filter and no
 *      animation — the frame-cost contract that keeps the BPM canary green.
 *   2. The gel slab and its LEDs are gone.
 *   3. Every section sits INSIDE its opening: no spill, in either theme.
 *   4. The geometry is in fractions of the viewport, so it tracks a window
 *      resize with no JavaScript — checked at three sizes.
 *   5. The bed is BLACK in both themes.
 *   6. Day: the openings that host a panel are lit; the empty one is not; the
 *      bottom-right corner is lit WHOLE (the operator's round-12 correction).
 *   7. Everywhere the cage is material, day and night are IDENTICAL — that is
 *      the property that was violated when the outer rim was keyed and every
 *      backdrop leaked through it as pale specks.
 *
 * Needs the dev server on :3000.
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-ui-cage.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HOLES = JSON.parse(fs.readFileSync(path.join(__dirname, '../frame/holes.json'), 'utf8'));

let pass = 0, fail = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

/* Sections, and the opening each one must stay inside. A section may be smaller
   than its hole (it carries an inset), never larger. */
const SECTIONS = [
  ['header', 'topbar'],
  ['nav', 'railTop'],
  ['[data-testid="audio-meter"]', 'meter'],
  ['[data-testid="effect-search"]', 'sidebar'],
  ['[data-testid="nodal-add"]', 'nodes'],
];

/* Windows the cage is MATERIAL in — no opening, in either theme. Day and night
   must be pixel-identical here. Measured off the region map; see HANDOFF-CAGE §4.4. */
const MATERIAL = {
  'bottom rim, left        ': [0.10, 0.955, 0.40, 0.980],
  'bottom rim, centre      ': [0.45, 0.955, 0.62, 0.980],
  'bottom rim, below nodes ': [0.40, 0.928, 0.45, 0.940],
  'bottom rim, below gemini': [0.62, 0.955, 0.75, 0.980],
  'right margin            ': [0.975, 0.20, 0.995, 0.60],
  'empty opening, right    ': [0.915, 0.50, 0.940, 0.62],
};
/* Inside the bottom-right corner opening: lit by day, black at night. The first
   one is the lobe that used to be cut off black at y=0.838. */
const CORNER = {
  'corner upper lobe       ': [0.74, 0.76, 0.84, 0.86],
  'corner right lobe       ': [0.928, 0.738, 0.950, 0.768],
  'corner lower sweep      ': [0.83, 0.90, 0.87, 0.93],
};

const shoot = async (page) => (await page.screenshot()).toString('base64');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 953 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2500);

  // ── 1. the frame itself ────────────────────────────────────────────────────
  const frame = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')].filter((i) => /cage/.test(i.getAttribute('src') || ''));
    if (imgs.length !== 1) return { n: imgs.length };
    const el = imgs[0], cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return {
      n: 1, blend: cs.mixBlendMode, filter: cs.filter, anim: cs.animationName,
      transition: cs.transitionProperty, fit: cs.objectFit, pos: cs.position,
      z: cs.zIndex, pe: cs.pointerEvents, decoded: el.naturalWidth > 0,
      covers: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1,
      /* it must be ABOVE the sections: the cage's material is what masks their
         rectangular edges into the organic openings */
      overPanels: (() => {
        const p = document.querySelector('header');
        return parseInt(cs.zIndex || '0', 10) > parseInt(getComputedStyle(p).zIndex || '0', 10);
      })(),
    };
  });
  step('exactly ONE cage image, decoded', frame.n === 1 && frame.decoded, `n=${frame.n}`);
  step('no blend mode, no filter, no animation on it',
    frame.blend === 'normal' && frame.filter === 'none' && frame.anim === 'none',
    `blend=${frame.blend} filter=${frame.filter} anim=${frame.anim}`);
  step('it stretches to fill the window — no black bands',
    frame.fit === 'fill' && frame.covers, `object-fit=${frame.fit} covers=${frame.covers}`);
  step('it sits on top of the sections and takes no pointer events',
    frame.overPanels && frame.pe === 'none', `z=${frame.z} pointer-events=${frame.pe}`);

  // ── 2. the gel slab is gone ────────────────────────────────────────────────
  const gel = await page.evaluate(() => ({
    layer: !!document.querySelector('.syn-bg-layer, [data-testid="bg-layer"]'),
    sheet: !!document.querySelector('.syn-gel-sheet'),
    bubbles: !!document.querySelector('[data-testid="bg-bubbles"]'),
  }));
  step('the gel slab, its LED sheet and its bubbles are gone',
    !gel.layer && !gel.sheet && !gel.bubbles, JSON.stringify(gel));

  // ── 3+4. every section inside its opening, at three window sizes ───────────
  for (const vp of [{ width: 1600, height: 953 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(450);
    const out = await page.evaluate(({ SECTIONS, HOLES }) => {
      const W = window.innerWidth, H = window.innerHeight;
      return SECTIONS.map(([sel, hole]) => {
        const el = document.querySelector(sel);
        if (!el) return { hole, missing: true };
        /* the search box and the "add node" button are probes INSIDE their panel —
           walk up to the panel shell so the whole section is measured */
        const box = (sel.startsWith('[') && !sel.includes('audio-meter'))
          ? el.closest('[data-panel] > div, [class*="syn-hole"]') || el
          : el;
        const r = box.getBoundingClientRect();
        const h = HOLES[hole];
        const slack = 1.5; // sub-pixel rounding on a fractional layout
        return {
          hole,
          spill: +Math.max(
            h.x * W - r.left, h.y * H - r.top,
            r.right - (h.x + h.w) * W, r.bottom - (h.y + h.h) * H,
          ).toFixed(1),
          ok: r.left >= h.x * W - slack && r.top >= h.y * H - slack
            && r.right <= (h.x + h.w) * W + slack && r.bottom <= (h.y + h.h) * H + slack,
        };
      });
    }, { SECTIONS, HOLES });
    step(`at ${vp.width}x${vp.height}: every section inside its opening, no spill`,
      out.every((o) => o.ok && !o.missing),
      out.map((o) => `${o.hole}${o.missing ? '=MISSING' : `:${o.spill > 0 ? `+${o.spill}` : 'in'}`}`).join(' '));
  }
  await page.setViewportSize({ width: 1600, height: 953 });
  await page.waitForTimeout(500);

  // ── 5–7. the day / night bed rules, measured on the pixels ─────────────────
  const nightShot = await shoot(page);
  await page.click('button[title="Toggle day / night"]');
  await page.waitForTimeout(1400);
  const dayShot = await shoot(page);
  await page.click('button[title="Toggle day / night"]');

  const work = await (await browser.newContext()).newPage();
  await work.goto('about:blank');
  const px = await work.evaluate(async ({ dayShot, nightShot, MATERIAL, CORNER }) => {
    const grab = async (b64) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
      return { W: c.width, H: c.height, d: g.getImageData(0, 0, c.width, c.height).data };
    };
    const D = await grab(dayShot), N = await grab(nightShot);
    const mean = ({ W, H, d }, [x0, y0, x1, y1]) => {
      let s = 0, n = 0;
      for (let y = Math.round(y0 * H); y < Math.round(y1 * H); y++)
        for (let x = Math.round(x0 * W); x < Math.round(x1 * W); x++) {
          const i = (y * W + x) * 4; s += Math.max(d[i], d[i + 1], d[i + 2]); n++;
        }
      return s / n;
    };
    const out = { material: {}, corner: {} };
    for (const [k, w] of Object.entries(MATERIAL)) out.material[k] = [+mean(D, w).toFixed(1), +mean(N, w).toFixed(1)];
    for (const [k, w] of Object.entries(CORNER)) out.corner[k] = [+mean(D, w).toFixed(1), +mean(N, w).toFixed(1)];
    return out;
  }, { dayShot, nightShot, MATERIAL, CORNER });

  for (const [k, [d, n]] of Object.entries(px.material)) {
    step(`material reads the same in both themes: ${k}`, Math.abs(d - n) <= 1.5,
      `day=${d} night=${n} |diff|=${Math.abs(d - n).toFixed(2)}`);
  }
  for (const [k, [d, n]] of Object.entries(px.corner)) {
    step(`corner opening: lit by day, black at night: ${k}`, d >= 200 && n <= 16,
      `day=${d} night=${n}`);
  }

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  console.log(`\n${pass}/${pass + fail} checks pass`);
  await browser.close();
  process.exitCode = fail ? 1 : 0;
})();
