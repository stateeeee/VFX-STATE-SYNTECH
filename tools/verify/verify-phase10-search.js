const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0,120)));
  await page.goto('http://localhost:3000', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const results = [];
  const step = (n, ok, d='') => { results.push(ok); console.log(`${ok?'PASS':'FAIL'}  ${n}${d?'  — '+d:''}`); };
  const cards = async () => page.$$eval('[data-testid^="effect-card-"]', els => els.map(e => e.getAttribute('data-testid').replace('effect-card-','')));
  const type = async (v) => page.fill('[data-testid="effect-search"]', v);

  const all = await cards();
  step('search input present + all 5 cards shown', (await page.$('[data-testid="effect-search"]')) && all.length === 5, `cards=${all.length}`);

  await type('blob'); await page.waitForTimeout(200);
  const blob = await cards();
  step('typing "blob" filters to blob_* effects', blob.length === 2 && blob.every(id => id.includes('blob')), blob.join(','));

  await type('bok'); await page.waitForTimeout(200);
  const bok = await cards();
  step('typing "bok" → only bokeh', bok.length === 1 && bok[0] === 'bokeh', bok.join(','));

  await type('zzzz'); await page.waitForTimeout(200);
  const none = await cards();
  const empty = await page.$('[data-testid="effect-search-empty"]');
  step('no-match shows empty state + zero cards', none.length === 0 && !!empty, `cards=${none.length}`);

  await page.click('[data-testid="effect-search-clear"]'); await page.waitForTimeout(200);
  const cleared = await cards();
  step('clear button restores all 5 cards', cleared.length === 5, `cards=${cleared.length}`);

  step('no page errors', errs.length === 0, errs.slice(0,3).join(' | '));
  const fails = results.filter(r => !r).length;
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails} failed =====`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
