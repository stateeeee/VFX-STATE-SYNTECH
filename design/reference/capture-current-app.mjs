import { chromium } from 'playwright-core';
import { setTimeout as wait } from 'node:timers/promises';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/VFX-STATE-SYNTECH/design/reference';
const URL = 'http://localhost:3000/';

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const page = await ctx.newPage();

async function go(state) {
  // set theme via localStorage before app reads it
  await page.addInitScript((s) => {
    try { localStorage.setItem('syntech.session', JSON.stringify({ isDayMode: s === 'day' })); } catch {}
  }, state);
}
async function shot(name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}
async function click(testid) {
  const el = page.locator(`[data-testid="${testid}"]`);
  if (await el.count()) { await el.first().click({ timeout: 3000 }).catch(() => {}); }
}

// 1. HOME — night (default)
await go('night');
await page.goto(URL, { waitUntil: 'networkidle' });
await wait(3500); // let the constellation animate + fonts load
await shot('01-home-night');

// 2. GEMINI panel — Art Director (night)
await click('nav-gemini-art_director');
await wait(1200);
await shot('02-gemini-artdirector-night');

// 3. GEMINI panel — Agent (night)
await click('nav-gemini-agent');
await wait(900);
await shot('03-gemini-agent-night');

// 4. AI LAB / SynEngine (night)
await click('nav-ailab');
await wait(2000);
await shot('04-ailab-night');

// 5. PROJECTS modal (night)
await click('nav-home');
await wait(600);
await click('nav-projects');
await wait(700);
await shot('05-projects-modal-night');

// 6. HOME — day mode
await go('day');
await page.goto(URL, { waitUntil: 'networkidle' });
await wait(3500);
await shot('06-home-day');

// 7. AI LAB — day
await click('nav-ailab');
await wait(2000);
await shot('07-ailab-day');

await browser.close();
console.log('DONE');
