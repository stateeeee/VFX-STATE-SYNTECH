/*
 * Measures GEMINI_FLOOR_Y: where the black opening of the Gemini panel ENDS at
 * the bottom, as a fraction of the viewport height.
 *
 * The cage artwork is drawn on top of the panel (object-fit: fill), and the
 * opening is organic: the material starts ABOVE/BELOW the panel box's bottom
 * edge depending on the column. The API-key card is centred between the panel
 * header's violet line and this floor, so the floor must come from the artwork
 * itself, never be eyeballed.
 *
 * Source: public/assets/cage.webp, i.e. the exact image the app shows. It is
 * composited over the black bed and scanned DOWN, in each column under the key
 * card, from the middle of the opening until the first pixel that is no longer
 * black (max channel > 26 — the same threshold build-frame.cjs uses to call a
 * pixel "dark"). Because the image is stretched to the viewport, the result in
 * fractions of the image is the same fraction of the viewport at any window size.
 *
 * Columns: 11 points across the card, which at the 1440px reference width spans
 * the panel box minus 5px inset, 1px border, 16px padding on each side.
 * GEMINI_FLOOR_Y is the value at the card's centre column; the min..max spread
 * across the card is printed so a curved frame edge is visible.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/frame/measure-gemini-floor.cjs
 * Then paste the printed GEMINI_FLOOR_Y into src/cage/cage.ts.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ART = path.join(ROOT, 'public/assets/cage.webp');
const HOLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'holes.json'), 'utf8'));
const g = HOLES.gemini; // the box cageBox(HOLES.gemini) pins the panel to (not HOLES.boxes.gemini, the day backdrop)
const REF_W = 1440, SIDE = 5 + 1 + 16; // cageBox inset + panel border + scroll padding

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');
  const b64 = fs.readFileSync(ART).toString('base64');
  const res = await page.evaluate(async ({ b64, g, REF_W, SIDE }) => {
    const im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(im, 0, 0);
    const d = ctx.getImageData(0, 0, W, H).data;
    const left = g.x * REF_W + SIDE, right = (g.x + g.w) * REF_W - SIDE;
    const cols = [];
    for (let i = 0; i <= 10; i++) {
      const fx = (left + (right - left) * i / 10) / REF_W;
      const x = Math.min(W - 1, Math.round(fx * W));
      let y = Math.round((g.y + g.h * 0.4) * H), hit = -1;
      for (; y < H; y++) {
        const p = (y * W + x) * 4;
        if (Math.max(d[p], d[p + 1], d[p + 2]) > 26) { hit = y; break; }
      }
      cols.push({ fx, y: hit / H });
    }
    return { W, H, cols };
  }, { b64, g, REF_W, SIDE });
  await browser.close();

  const ys = res.cols.map((c) => c.y);
  const centre = res.cols[5].y;
  console.log(`image ${res.W}x${res.H}, gemini box bottom y = ${(g.y + g.h).toFixed(5)}`);
  res.cols.forEach((c, i) => console.log(`  col ${String(i).padStart(2)}  x=${c.fx.toFixed(4)}  floor y=${c.y.toFixed(5)}`));
  console.log(`spread across the card: min ${Math.min(...ys).toFixed(5)}  max ${Math.max(...ys).toFixed(5)}  (${((Math.max(...ys) - Math.min(...ys)) * 900).toFixed(1)}px at 900px tall)`);
  console.log(`GEMINI_FLOOR_Y = ${centre.toFixed(4)}   (centre column)`);
})();
