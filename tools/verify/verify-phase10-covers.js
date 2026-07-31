/*
 * Phase 10 — effect-card cover art (EffectCardArt), now that the operator's five
 * covers are shipped in public/assets/covers/.
 *
 * The operator's direction for the art (2026-07-29): each cover is ONLY what the
 * effect's HTML renders — the logo/"star" on black, no app chrome — and the star
 * must be NEVER CUT, so the five cards can be compared at a glance. Second pass,
 * same day: the label no longer sits over the art — **label centre-LEFT, art
 * centre-RIGHT**.
 *
 * That is a geometric contract, and this suite checks it as one:
 *   - all five covers load and decode, and are drawn with `object-contain`
 *     (object-cover would crop the star);
 *   - the art is right-aligned and fills the card height at the default width;
 *   - the label sits on the left, vertically centred, and its right edge NEVER
 *     reaches the art — checked with the sidebar dragged to both extremes, where
 *     the name truncates rather than running under the star;
 *   - the art sits on a black bed, so the card reads as one preview surface;
 *   - the label is in the vendored mono face, left-aligned in its band;
 *   - the fallback still works when a cover is missing (forced with a 404 route).
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-covers.js
 */
const { chromium } = require('playwright');
const path = require('path');

const IDS = ['blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab'];
const MISSING = 'bokeh';           // forced to 404 in the fallback pass
const SHOT_DIR = process.env.SHOT_DIR || '';

let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const probe = (page) => page.evaluate((ids) => ids.map((id) => {
  const card = document.querySelector(`[data-testid="effect-card-${id}"]`);
  if (!card) return { id, found: false };
  const img = card.querySelector('img');
  const label = card.querySelector('span');
  const cr = card.getBoundingClientRect(), lr = label.getBoundingClientRect();
  const cs = getComputedStyle(label);
  // the bed is `absolute inset-0`, so it spans the padding box — the card's width
  // less its 1px borders
  const bed = [...card.querySelectorAll('div')].some((d) => {
    const b = getComputedStyle(d).backgroundColor;
    return b === 'rgb(0, 0, 0)' && d.getBoundingClientRect().width >= cr.width - 3;
  });
  const nat = img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 0, h: 0 };
  // what object-contain paints INSIDE the img's own box (which is now a column on
  // the right, not the whole card)
  const ir = img ? img.getBoundingClientRect() : { x: 0, width: 0, height: 0, right: 0 };
  const k = nat.w ? Math.min(ir.width / nat.w, ir.height / nat.h) : 0;
  return {
    id, found: true, hasImg: !!img, nat: `${nat.w}x${nat.h}`,
    natAspect: nat.h ? +(nat.w / nat.h).toFixed(2) : 0,
    cardAspect: +(cr.width / cr.height).toFixed(2),
    shownH: Math.round(nat.h * k), shownW: Math.round(nat.w * k),
    cardH: Math.round(cr.height), cardW: Math.round(cr.width),
    // the art is positioned against the PADDING box, so "full height" means the
    // card's height less its 1px borders — not the border-box height
    innerH: card.clientHeight,
    fit: img ? getComputedStyle(img).objectFit : '', opacity: img ? +getComputedStyle(img).opacity : null,
    bed,
    // geometry of the two halves, in card-relative pixels
    artLeft: +(ir.x - cr.x).toFixed(1), artRightGap: +(cr.right - ir.right).toFixed(1),
    labelLeft: +(lr.x - cr.x).toFixed(1), labelRight: +(lr.right - cr.x).toFixed(1),
    labelMidOffset: +((lr.y + lr.height / 2) - (cr.y + cr.height / 2)).toFixed(1),
    label: label.textContent.trim(),
    font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
    size: cs.fontSize, tracking: cs.letterSpacing, align: cs.textAlign,
  };
}), IDS);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2000); // img load + fade-in

  const cards = await probe(page);
  step('all five cards carry a decoded cover',
    cards.length === 5 && cards.every((c) => c.found && c.hasImg && c.nat !== '0x0'),
    cards.map((c) => `${c.id} ${c.nat}`).join(' | '));
  step('covers are visible (opacity 1)', cards.every((c) => c.opacity === 1));
  step('covers are drawn with object-contain (the star is never cropped)',
    cards.every((c) => c.fit === 'contain'), cards.map((c) => c.fit).join(','));
  step('each cover sits on a black bed (seamless letterbox)', cards.every((c) => c.bed));

  /* Under the cage the systems column is no longer a resizable panel: it is the
     width of its opening in the artwork (~223px at 1600), narrower than the
     column this suite was written against. The art therefore meets its 45% cap
     before it meets the card's height, and `object-contain` letterboxes it.
     What still has to hold — and is what the direction was actually about — is
     that the star is WHOLE, right-aligned, and the SAME size on all five cards,
     so they can be compared at a glance. */
  step('the art is right-aligned, whole, and identical on all five cards',
    cards.every((c) => c.artRightGap <= 1 && c.shownH > 0 && c.shownH <= c.innerH)
      && new Set(cards.map((c) => c.shownH)).size === 1,
    cards.map((c) => `${c.id} h=${c.shownH}/${c.innerH} gap=${c.artRightGap}`).join(' | '));

  const lbl = cards[0];
  step('label in the vendored mono face', cards.every((c) => c.font === 'JetBrains Mono'), lbl.font);
  step('label at the smaller 11px, still tracked',
    cards.every((c) => c.size === '11px' && parseFloat(c.tracking) > 0.9),
    `${lbl.size} / ${lbl.tracking}`);
  step('label band is on the left, vertically centred, text left-aligned in it',
    cards.every((c) => c.labelLeft < c.cardW * 0.2 && Math.abs(c.labelMidOffset) < 1.5 && c.align === 'left'),
    cards.map((c) => `l=${c.labelLeft} dy=${c.labelMidOffset} ${c.align}`).join(' '));
  step('label never reaches the art',
    cards.every((c) => c.labelRight <= c.artLeft),
    cards.map((c) => `${c.id} text→${c.labelRight} art→${c.artLeft}`).join(' | '));

  // ── day mode, and the reference shot — both at the DEFAULT sidebar width, so
  //    they must come before the drags ────────────────────────────────────────
  await page.click('button[title="Toggle day / night"]');
  await page.waitForTimeout(600);
  const day = await probe(page);
  /* By day the cards load the KEYED covers (covers/day/), so the black plate the
     star stands on does not read as a rectangle on the cage's ivory. Same source
     art, same box — so the drawn size must be identical to the night one. */
  step('day mode keeps the covers, at the same size',
    day.every((c, i) => c.opacity === 1 && c.shownH === cards[i].shownH && c.shownH > 0),
    day.map((c) => `${c.shownH}/${c.innerH}`).join(' '));
  if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, 'covers-day.png') });
  await page.click('button[title="Toggle day / night"]');
  await page.waitForTimeout(500);

  if (SHOT_DIR) {
    const box = await page.evaluate(() => {
      const a = document.querySelector('[data-testid="effect-card-blob_tracker"]').getBoundingClientRect();
      const z = document.querySelector('[data-testid="effect-card-anamorphic_lab"]').getBoundingClientRect();
      return { x: a.x - 12, y: a.y - 12, width: a.width + 24, height: z.bottom - a.y + 24 };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'covers-cards.png'), clip: box });
  }

  /* The two sidebar-drag cases are gone with the cage: the openings are fixed
     organic shapes in the artwork, so the resize handles are inert and there is
     no narrowest/widest column any more. What replaces them is the window
     stretch — the sections are positioned in FRACTIONS of the viewport, so the
     same contract has to hold at any window size, with no JS re-layout. */
  for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(500);
    const at = await probe(page);
    step(`at ${vp.width}x${vp.height}: art whole, right-aligned, label clear of it`,
      at.every((c) => c.shownH > 0 && c.shownH <= c.innerH && c.artRightGap <= 1 && c.labelRight <= c.artLeft),
      `card ${at[0].cardW}x${at[0].cardH} — ` + at.map((c) => `${c.id} h=${c.shownH} text→${c.labelRight} art→${c.artLeft}`).join(' | '));
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(400);
  // ── fallback: a missing cover falls back to the plain label ────────────────
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx2.route(new RegExp(`/assets/covers/${MISSING}\\.(webp|png|jpg)`), (r) => r.fulfill({ status: 404, body: '' }));
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page2.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page2.waitForTimeout(3500); // cold cache in a fresh context
  const all2 = await probe(page2);
  const fb = all2.find((c) => c.id === MISSING);
  const others = all2.filter((c) => c.id !== MISSING);
  step(`${MISSING}: missing cover falls back to the plain card`,
    (!fb.hasImg || fb.opacity === 0) && !fb.bed && fb.label.length > 0,
    `hasImg=${fb.hasImg} opacity=${fb.opacity} bed=${fb.bed} "${fb.label}"`);
  step('the other four are unaffected', others.every((c) => c.opacity === 1),
    others.map((c) => `${c.id}=${c.opacity}`).join(' '));

  /* The systems column was narrowed by direction, but this PanelGroup persists its
     layout — a browser that had already run the app would restore the old 74/26
     split and the new default would never appear. The autoSaveId carries a -v2
     suffix for exactly that reason; seed the OLD key and prove it is ignored. */
  const ctx3 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx3.addInitScript(() => {
    localStorage.setItem('react-resizable-panels:syntech-main-horiz',
      JSON.stringify({ '{"direction":"horizontal"}': { layout: [74, 26], expandToSizes: {} } }));
  });
  const page3 = await ctx3.newPage();
  page3.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page3.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page3.waitForTimeout(1500);
  const stale = await page3.evaluate(() =>
    Math.round(document.querySelector('[data-testid="effect-card-bokeh"]').getBoundingClientRect().width));
  step('a stored pre-change layout does not resurrect the wide column', stale < 300, `card ${stale}px`);

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
