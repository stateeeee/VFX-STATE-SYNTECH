/*
 * Builds desktop/icon.png — the desktop app's icon — from the operator's own
 * icon artwork, desktop/icon-source.webp (2026-09-28: the glass tile with the
 * star; it replaced the first icon, which was the logo on a plain black plate).
 *
 * One 1024×1024 PNG is all electron-builder needs: it derives the Windows .ico
 * and the macOS .icns from it at package time.
 *
 * The artwork is NOT redrawn. Two things are done to it, both about the frame
 * around it, never the art:
 *   1. The black OUTSIDE the glass tile becomes transparent. The source is a
 *      full black square; in the Dock that reads as a black tile with square
 *      corners. The cut is a rounded rectangle just outside the tile's glow,
 *      so every lit pixel stays (the script fails if any would be cut).
 *   2. The tile is fitted to Apple's icon grid (an ~824 px body in a 1024 px
 *      canvas), so it sits in the Dock at the same size as every other app.
 *
 * Rendered with Chromium's canvas so no image library is needed.
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/gen/gen-app-icon.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC = path.join(ROOT, 'desktop/icon-source.webp');
const OUT = path.join(ROOT, 'desktop/icon.png');

const SIZE = 1024;
/* Width the tile (glow included) takes in the 1024 canvas. Apple's body is 824;
   the glow is allowed a little past it. */
const TILE = 850;
/* The cut: how far outside the lit area it runs, its corner radius and its
   softness, in SOURCE pixels. */
const PAD = 10;
const RADIUS = 220;
const FEATHER = 6;
/* A source pixel brighter than this (max channel, 0–255) counts as art. */
const LIT = 20;

(async () => {
  const src = 'data:image/webp;base64,' + fs.readFileSync(SRC).toString('base64');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const r = await page.evaluate(async ({ src, SIZE, TILE, PAD, RADIUS, FEATHER, LIT }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const W = img.width, H = img.height;
    const s = document.createElement('canvas');
    s.width = W; s.height = H;
    const sg = s.getContext('2d');
    sg.drawImage(img, 0, 0);
    const d = sg.getImageData(0, 0, W, H).data;
    const lum = (k) => Math.max(d[k], d[k + 1], d[k + 2]);

    // The lit area's bounding box = the tile plus its glow.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (lum((y * W + x) * 4) > LIT) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    const rx0 = x0 - PAD, ry0 = y0 - PAD, rx1 = x1 + PAD, ry1 = y1 + PAD;

    // Signed distance to the rounded rectangle (negative inside).
    const sd = (x, y) => {
      const cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2;
      const hx = (rx1 - rx0) / 2 - RADIUS, hy = (ry1 - ry0) / 2 - RADIUS;
      const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy;
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RADIUS;
    };

    // Apply the cut as alpha; record the brightest pixel it would lose.
    let lost = 0;
    const out = sg.getImageData(0, 0, W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const a = Math.min(1, Math.max(0, -sd(x + 0.5, y + 0.5) / FEATHER));
      if (a < 1) lost = Math.max(lost, lum(k) * (1 - a));
      out.data[k + 3] = Math.round(255 * a);
    }
    sg.putImageData(out, 0, 0);

    // Fit the cut tile into the 1024 canvas, centred.
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d');
    const bw = rx1 - rx0, bh = ry1 - ry0;
    const k = TILE / Math.max(bw, bh);
    g.imageSmoothingQuality = 'high';
    g.drawImage(s, rx0, ry0, bw, bh, (SIZE - bw * k) / 2, (SIZE - bh * k) / 2, bw * k, bh * k);
    return { png: c.toDataURL('image/png'), box: [x0, y0, x1, y1], src: [W, H], lost: Math.round(lost) };
  }, { src, SIZE, TILE, PAD, RADIUS, FEATHER, LIT });
  await browser.close();

  if (r.lost > LIT) throw new Error(`the cut would remove lit pixels (brightest lost: ${r.lost}) — raise PAD or lower RADIUS`);
  fs.writeFileSync(OUT, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(`source ${r.src.join('×')}, lit box ${r.box.join(',')}, brightest pixel cut: ${r.lost}`);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZE}×${SIZE})`);
})();
