/*
 * Background artwork verification (operator direction, 2026-07-25).
 *
 * Spec: the chosen artwork sits behind the whole night-mode UI; the sections keep
 * **90% opacity and cover it**, so it is only just perceptible through them and
 * reads at full strength solely in the gaps between sections. Day mode keeps its
 * cream surfaces and must NOT show the artwork at all.
 *
 * The interesting assertions are the quantitative ones: a patch sampled in an
 * outer gap must be markedly brighter/more colourful than a patch sampled inside
 * a panel, which must stay near-black — that is the "sections cover it, barely
 * visible" requirement expressed as pixels.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-bgtexture.js
 */
const { chromium } = require('playwright');

let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

/* Mean brightness (max channel), colourfulness (channel spread) and — the robust
   signal that an IMAGE is present rather than a flat fill — the standard
   deviation of brightness. Saturation alone is unreliable: parts of this artwork
   are legitimately grey, so a low spread there says nothing about visibility. */
const patch = (page, box) => page.evaluate(async ({ d }) => {
  const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
  c.getContext('2d').drawImage(im, 0, 0);
  const q = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const vals = [];
  let b = 0, s = 0, n = 0;
  for (let i = 0; i < q.length; i += 4) {
    const mx = Math.max(q[i], q[i + 1], q[i + 2]), mn = Math.min(q[i], q[i + 1], q[i + 2]);
    b += mx; s += mx - mn; n++; vals.push(mx);
  }
  const mean = b / n;
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  return { bright: +mean.toFixed(1), colour: +(s / n).toFixed(1), sd: +sd.toFixed(1), max: Math.max(...vals) };
}, { d: box.png });

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  const asset = { status: 0 };
  page.on('response', (r) => { if (r.url().includes('/assets/bg-texture')) asset.status = r.status(); });

  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(3000); // let the graph settle + the artwork decode

  step('artwork asset served', asset.status === 200, `HTTP ${asset.status}`);
  step('background layer rendered in night mode', !!(await page.$('[data-testid="bg-layer"]')));

  const tok = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const nav = document.querySelector('nav');
    return {
      bg: cs.getPropertyValue('--syn-bg').trim(),
      ink950: cs.getPropertyValue('--syn-ink-950').trim(),
      ink900: cs.getPropertyValue('--syn-ink-900').trim(),
      hero: cs.getPropertyValue('--syn-hero-canvas').trim(),
      navBg: nav ? getComputedStyle(nav).backgroundColor : '',
    };
  });
  step('gaps between sections are transparent (artwork shows)', tok.bg === 'transparent', `--syn-bg: ${tok.bg}`);
  step('sections are 90% opaque', /0\.9(0)?\)/.test(tok.ink950) && /0\.9(0)?\)/.test(tok.ink900), `ink950=${tok.ink950}`);
  step('a real panel computes to 90% black', tok.navBg.replace(/\s/g, '') === 'rgba(0,0,0,0.9)', tok.navBg);
  step('hero canvas set to clear (so the artwork shows through the hero)', tok.hero === 'transparent', tok.hero);

  // quantitative: the full outer left margin (a gap) vs inside a panel
  const gapPng = (await page.screenshot({ clip: { x: 2, y: 100, width: 11, height: 800 } })).toString('base64');
  const panPng = (await page.screenshot({ clip: { x: 40, y: 860, width: 30, height: 60 } })).toString('base64');
  const gap = await patch(page, { png: gapPng });
  const pan = await patch(page, { png: panPng });
  /* In the gaps the artwork is unattenuated, so it shows strong local contrast and
     keeps real highlights; inside a section it is flattened to near-uniform black.
     Local contrast (sd), not mean brightness, is the honest measure here: this
     artwork's own left edge is largely dark, so its mean is low by nature. */
  step('artwork at full strength in the gaps (contrast + highlights)', gap.sd > 25 && gap.max > 120,
    `gap sd=${gap.sd} max=${gap.max} bright=${gap.bright}`);
  step('artwork only just perceptible inside a section (flattened, near-black)', pan.bright < 34 && pan.sd < 10,
    `panel bright=${pan.bright} sd=${pan.sd}`);
  step('sections demonstrably cover the artwork', gap.sd > pan.sd * 5, `sd ${gap.sd} vs ${pan.sd}`);

  // day mode: no artwork at all
  await page.click('button[title="Toggle day / night"]').catch(() => {});
  await page.waitForTimeout(900);
  step('day mode does NOT show the artwork', !(await page.$('[data-testid="bg-layer"]')));
  const dayPng = (await page.screenshot({ clip: { x: 2, y: 560, width: 10, height: 120 } })).toString('base64');
  const dayGap = await patch(page, { png: dayPng });
  step('day mode gap stays cream (not the artwork)', dayGap.bright > 230 && dayGap.colour < 14, `bright=${dayGap.bright} colour=${dayGap.colour}`);

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
