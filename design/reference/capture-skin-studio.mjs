import { chromium } from 'playwright-core';
import { setTimeout as wait } from 'node:timers/promises';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = '/home/user/VFX-STATE-SYNTECH/design/reference';
const FILE = 'file:///home/user/VFX-STATE-SYNTECH/design/skin-studio.html';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox','--disable-gpu','--hide-scrollbars'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1050 }, deviceScaleFactor: 1.25 });
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto(FILE, { waitUntil: 'load' });
await wait(1500);
async function dir(n){ await p.locator('#dirs .chip').nth(n).click(); await wait(1400); }
async function theme(t){ await p.locator(`#theme button[data-t="${t}"]`).click(); await wait(900); }
async function shot(name){ await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); }
await dir(0); await shot('skin-d1-obsidian-night');
await dir(3); await shot('skin-d4-mission-night');
await dir(5); await shot('skin-d6-deepspace-night');
await dir(2); await shot('skin-d3-liquidobsidian-night');
await theme('light'); await dir(0); await shot('skin-d1-obsidian-day');
await b.close(); console.log('DONE');
