/*
 * Builds desktop/icon.png — the desktop app's icon — from public/assets/logo.png.
 *
 * One 1024×1024 PNG is all electron-builder needs: it derives the Windows .ico
 * and the macOS .icns from it at package time. The logo sits centred on a black
 * rounded square (the app's own bed colour), because a free-floating transparent
 * star reads as a hole in the Dock and on the Windows taskbar.
 *
 * Rendered with Chromium's canvas so no image library is needed.
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/gen/gen-app-icon.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'public/assets/logo.png');
const OUT = path.join(ROOT, 'desktop/icon.png');

const SIZE = 1024;
/* Apple's icon grid: the plate is 824 px inside a 1024 canvas, corner radius
   ~185. Windows and Linux get the same file, so the margin is kept there too. */
const PLATE = 824;
const RADIUS = 185;
/* How much of the plate the star may cover (its longest side). */
const ART = 0.84;

(async () => {
  const logo = 'data:image/png;base64,' + fs.readFileSync(SRC).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const png = await page.evaluate(async ({ logo, SIZE, PLATE, RADIUS, ART }) => {
    const img = new Image();
    img.src = logo;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const o = (SIZE - PLATE) / 2;
    g.beginPath();
    g.roundRect(o, o, PLATE, PLATE, RADIUS);
    g.fillStyle = '#000000';
    g.fill();
    g.save();
    g.clip();
    const k = (PLATE * ART) / Math.max(img.width, img.height);
    const w = img.width * k, h = img.height * k;
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    g.restore();
    return c.toDataURL('image/png');
  }, { logo, SIZE, PLATE, RADIUS, ART });
  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZE}×${SIZE})`);
})();
