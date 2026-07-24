/*
 * Phase 10 — effect-card cover art (EffectCardArt) both paths.
 *
 * The operator's 5 cover graphics aren't delivered yet, so this proves the
 * drop-in contract WITHOUT shipping a placeholder: one card's cover request is
 * fulfilled at the network level with a generated test image (as if the file
 * existed at public/assets/covers/<id>.webp), the others are left to 404. We
 * assert the fulfilled card shows the cover (decoded, opaque) under a scrim with
 * a white label, and an un-fulfilled card falls back to the plain label — exactly
 * today's look. When the operator drops real files in, this is what happens.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-covers.js
 */
const { chromium } = require('playwright');

// 2x2 solid PNG (magenta) — enough to prove object-cover render + decode.
const TEST_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9Qz0BkYBxVSA0AAB6+Aa4v4a4pAAAAAElFTkSuQmCC',
  'base64'
);
const COVERED = 'blob_tracker'; // this one gets a cover; others fall back
const FALLBACK = 'analog';

let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  // fulfil ONLY the covered id's cover request; everything else passes through (404s)
  await ctx.route(new RegExp(`/assets/covers/${COVERED}\\.(webp|png|jpg)`), (r) =>
    r.fulfill({ status: 200, contentType: 'image/png', body: TEST_PNG }));

  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1800); // img load + fade-in

  const inspect = (id) => page.evaluate((id) => {
    const card = document.querySelector(`[data-testid="effect-card-${id}"]`);
    if (!card) return { found: false };
    const img = card.querySelector('img');
    const label = card.querySelector('span');
    const scrim = !!card.querySelector('div.absolute.inset-0');
    const op = img ? parseFloat(getComputedStyle(img).opacity) : null;
    return {
      found: true,
      hasImg: !!img,
      nw: img ? img.naturalWidth : 0,
      opacity: op,
      scrim,
      label: label ? label.textContent.trim() : '',
      labelWhite: label ? /(^|\s)text-white(\s|$)/.test(label.className) : false,
    };
  }, id);

  const cov = await inspect(COVERED);
  step(`${COVERED}: cover img decoded`, cov.found && cov.hasImg && cov.nw > 0, `naturalWidth=${cov.nw}`);
  step(`${COVERED}: cover visible (opacity 1)`, cov.opacity === 1, `opacity=${cov.opacity}`);
  step(`${COVERED}: legibility scrim present`, cov.scrim, cov.scrim ? '' : 'no scrim div');
  step(`${COVERED}: label white over cover`, cov.labelWhite, `"${cov.label}"`);

  const fb = await inspect(FALLBACK);
  // fallback: either no img rendered, or an img that stayed hidden (opacity 0)
  step(`${FALLBACK}: no cover shown (fallback)`, fb.found && (!fb.hasImg || fb.opacity === 0), `hasImg=${fb.hasImg} opacity=${fb.opacity}`);
  step(`${FALLBACK}: label still shown`, fb.label.length > 0, `"${fb.label}"`);

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await page.screenshot({ path: '/tmp/claude-0/-home-user-VFX-STATE-SYNTECH/10dd2dff-58cd-581c-8fc6-a55f8ba1577e/scratchpad/covers_demo.png' });
  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
