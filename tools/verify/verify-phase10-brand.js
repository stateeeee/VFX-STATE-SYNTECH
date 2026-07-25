/* Phase 10 — brand: definitive logo + unified titles.
 * Verify: definitive logo installed + both titles share font & shimmer animation.
 * Captures full shots + tight crops of each title in night/day, plus two frames
 * to prove the gradient animation is actually running. */
const { chromium } = require('playwright');
const S = '/tmp/claude-0/-home-user-VFX-STATE-SYNTECH/10dd2dff-58cd-581c-8fc6-a55f8ba1577e/scratchpad';
let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);

  // logo: decoded + colourful (not white) + never inverted
  const logo = await page.evaluate(() => {
    const im = document.querySelector('img[alt="VFX Syntech"]');
    if (!im) return null;
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    // colourfulness over opaque pixels: mean |max-min| channel spread
    let n = 0, spread = 0, alphaLow = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) { if (d[i + 3] < 20) alphaLow++; continue; }
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      spread += mx - mn; n++;
    }
    return { nw: im.naturalWidth, nh: im.naturalHeight, cls: im.className, meanSpread: n ? +(spread / n).toFixed(1) : 0, transparentPx: alphaLow };
  });
  step('logo decoded', !!logo && logo.nw > 0, logo ? `${logo.nw}x${logo.nh}` : 'missing');
  step('logo is the multicolour mark (chromatic, not white)', !!logo && logo.meanSpread > 25, `mean channel spread=${logo && logo.meanSpread}`);
  step('logo has a keyed transparent field', !!logo && logo.transparentPx > 1000, `transparent px=${logo && logo.transparentPx}`);
  step('logo NOT inverted in night mode', !!logo && !/invert/.test(logo.cls));

  // titles: same font family/weight/tracking + both animated by hero-gradient
  const t = await page.evaluate(() => {
    const small = document.querySelector('header span.hero-gradient');
    const bigs = [...document.querySelectorAll('h1.hero-gradient')];
    const info = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { text: el.textContent.trim(), family: cs.fontFamily, weight: cs.fontWeight, spacing: cs.letterSpacing, size: cs.fontSize, anim: cs.animationName, dur: cs.animationDuration, clip: cs.webkitBackgroundClip || cs.backgroundClip, color: cs.color };
    };
    return { small: info(small), big: bigs.map(info) };
  });
  const s = t.small, B = t.big;
  step('small top title exists + animated', !!s && s.anim === 'gradient-shimmer', s ? `"${s.text}" anim=${s.anim} ${s.dur}` : 'missing');
  step('big hero title: BOTH lines animated', B.length === 2 && B.every((x) => x.anim === 'gradient-shimmer'), B.map((x) => `"${x.text}"`).join(' + '));
  step('same font family on both titles', !!s && B.length > 0 && B.every((x) => x.family === s.family), s && s.family);
  step('same font weight on both titles', !!s && B.every((x) => x.weight === s.weight), `small=${s && s.weight} big=${B.map((x) => x.weight).join('/')}`);
  step('same tracking ratio (tracking-tight) on both', !!s && B.every((x) => {
    const r = (v, fs) => parseFloat(v) / parseFloat(fs);
    return Math.abs(r(x.spacing, x.size) - r(s.spacing, s.size)) < 0.002;
  }), `small=${s && s.spacing}@${s && s.size} big=${B.map((x) => x.spacing + '@' + x.size).join(' ')}`);
  step('sizes still differ (each keeps its own dimension)', !!s && B.every((x) => parseFloat(x.size) > parseFloat(s.size) * 2), `small=${s && s.size} big=${B[0] && B[0].size}`);

  // animation actually moves: sample background-position twice
  const bp = async () => page.evaluate(() => getComputedStyle(document.querySelector('h1.hero-gradient')).backgroundPosition);
  const p1 = await bp(); await page.waitForTimeout(900); const p2 = await bp();
  step('shimmer is running (background-position advances)', p1 !== p2, `${p1} → ${p2}`);

  await page.screenshot({ path: `${S}/t_night_full.png` });
  const header = await page.$('header'); if (header) await header.screenshot({ path: `${S}/t_night_topbar.png` });
  const hero = await page.$('h1.hero-gradient');
  if (hero) await page.screenshot({ path: `${S}/t_night_hero.png`, clip: { x: 110, y: 75, width: 640, height: 220 } });
  const side = await page.$('nav'); if (side) await side.screenshot({ path: `${S}/t_night_sidebar.png` });

  // DAY MODE
  await page.click('button[title="Toggle day / night"]').catch(() => {});
  await page.waitForTimeout(900);
  const dayCls = await page.evaluate(() => document.querySelector('img[alt="VFX Syntech"]').className);
  step('logo NOT inverted in day mode either (colours preserved)', !/invert/.test(dayCls), dayCls.includes('invert') ? 'INVERTED (bad)' : 'no invert');
  await page.screenshot({ path: `${S}/t_day_full.png` });
  const header2 = await page.$('header'); if (header2) await header2.screenshot({ path: `${S}/t_day_topbar.png` });
  await page.screenshot({ path: `${S}/t_day_hero.png`, clip: { x: 110, y: 75, width: 640, height: 220 } });

  step('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
  await b.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
