/*
 * Phase 10 — effect-card cover art (EffectCardArt), now that the operator's five
 * covers are shipped in public/assets/covers/.
 *
 * The operator's direction for the art (2026-07-29): each cover is ONLY what the
 * effect's HTML renders — the logo/"star" on black, no app chrome — and the star
 * must sit CENTRED and NEVER CUT, so the five cards can be compared at a glance.
 *
 * That is a geometric contract, and this suite checks it as one:
 *   - all five covers load and decode, and are drawn with `object-contain`
 *     (object-cover would crop the star top and bottom on any card wider than the
 *     plate — which is most screens);
 *   - every plate is narrower than the narrowest the card can get, so `contain`
 *     always binds on height: the star fills the card top to bottom at every
 *     sidebar width, verified by dragging the sidebar to both extremes;
 *   - the art sits on a black bed, so the letterbox either side is seamless;
 *   - the label is centred, in the vendored mono face, and carries its own halo
 *     (no scrim band — a band would darken the star exactly at its waist);
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
  // what object-contain actually paints
  const k = nat.w ? Math.min(cr.width / nat.w, cr.height / nat.h) : 0;
  return {
    id, found: true, hasImg: !!img, nat: `${nat.w}x${nat.h}`,
    natAspect: nat.h ? +(nat.w / nat.h).toFixed(2) : 0,
    cardAspect: +(cr.width / cr.height).toFixed(2),
    shownH: Math.round(nat.h * k), shownW: Math.round(nat.w * k),
    cardH: Math.round(cr.height), cardW: Math.round(cr.width),
    fit: img ? getComputedStyle(img).objectFit : '', opacity: img ? +getComputedStyle(img).opacity : null,
    bed,
    label: label.textContent.trim(),
    font: cs.fontFamily.split(',')[0].replace(/"/g, ''),
    size: cs.fontSize, tracking: cs.letterSpacing, shadow: cs.textShadow,
    labelOffset: +Math.abs((lr.x + lr.width / 2) - (cr.x + cr.width / 2)).toFixed(1),
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

  /* The card can only get as narrow as the sidebar's minSize (16% of the
     horizontal group). A plate wider than that ratio would start binding on
     WIDTH and shrink the star; every plate must stay under it. */
  const NARROWEST_CARD_ASPECT = 2.5;
  step('every plate is narrow enough to stay height-bound at any sidebar width',
    cards.every((c) => c.natAspect > 0 && c.natAspect < NARROWEST_CARD_ASPECT),
    cards.map((c) => `${c.id} ${c.natAspect}`).join(' | '));
  step('the star fills the card height at the default width',
    cards.every((c) => c.shownH === c.cardH), cards.map((c) => `${c.shownH}/${c.cardH}`).join(' '));

  const lbl = cards[0];
  step('label in the vendored mono face', cards.every((c) => c.font === 'JetBrains Mono'), lbl.font);
  step('label kept at 14px, tracked', cards.every((c) => c.size === '14px' && parseFloat(c.tracking) > 1),
    `${lbl.size} / ${lbl.tracking}`);
  step('label centred in the card', cards.every((c) => c.labelOffset < 2),
    cards.map((c) => c.labelOffset).join(','));
  step('label carries its own halo instead of a scrim band',
    cards.every((c) => /rgba?\(0, 0, 0/.test(c.shadow)), lbl.shadow.slice(0, 60));

  // ── the sidebar drag: both extremes must keep the star whole ───────────────
  const handles = await page.$$('[data-panel-resize-handle-id]');
  const grip = handles[handles.length - 1]; // the sidebar boundary
  // re-measure every time: the grip MOVES with the drag, and a stale box would
  // silently start the next drag from empty space (the second drag then no-ops)
  const drag = async (dx) => {
    const hb = await grip.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + dx, hb.y + hb.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };

  await drag(400); // sidebar to its minimum
  const narrow = await probe(page);
  step('narrowest sidebar: star still whole, full card height',
    narrow.every((c) => c.shownH === c.cardH && c.shownW <= c.cardW),
    `card ${narrow[0].cardW}x${narrow[0].cardH} (aspect ${narrow[0].cardAspect})`);

  await drag(-900); // sidebar to its maximum
  const wide = await probe(page);
  step('widest sidebar: star still whole, full card height',
    wide.every((c) => c.shownH === c.cardH && c.shownW <= c.cardW),
    `card ${wide[0].cardW}x${wide[0].cardH} (aspect ${wide[0].cardAspect})`);
  await drag(500);
  await page.waitForTimeout(300);

  // ── day mode ──────────────────────────────────────────────────────────────
  await page.click('button[title="Toggle day / night"]');
  await page.waitForTimeout(600);
  const day = await probe(page);
  step('day mode keeps the covers', day.every((c) => c.opacity === 1 && c.shownH === c.cardH));
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

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
