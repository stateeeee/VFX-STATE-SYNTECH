/*
 * Builds the five effect-card covers in public/assets/covers/ from the operator's
 * own effect screenshots in docs/design/covers-src/.
 *
 * The operator's direction (2026-07-29): use ONLY what the effect's HTML renders
 * — their logo/"star" on black, no app chrome — with the star CENTRED and NEVER
 * CUT, so the five cards show what each effect does and can be compared at a
 * glance.
 *
 * How it works
 *   1. Crop a render window that sits well inside each app's canvas, so the corner
 *      brackets, the frame hairline, the "1920 × 1080 · …" caption, the transport
 *      bar and the PIP thumbnail are all outside it.
 *   2. Find the bounding box of the render content inside that window. A row or
 *      column only counts when several pixels clear the floor, so one antialiased
 *      pixel cannot drag the box out to the frame.
 *   3. Redraw that box centred on a black plate cut TIGHT around it (2% margin).
 *
 * Why the plate is tight, and not a wide 4:1 thumbnail: the card draws the cover
 * with `object-contain`, and a plate NARROWER than the card always binds on
 * height — so the star fills the card top to bottom, centred, at every sidebar
 * width. The plates come out 0.88:1 … 1.46:1 against a narrowest-possible card of
 * 2.5:1, so there is plenty of margin. (`object-cover` would crop the star top and
 * bottom on any card wider than the plate, which is most screens.)
 *
 * Run (needs the vendored Chromium, like every other tool here):
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/gen/gen-effect-covers.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'docs/design/covers-src');
const OUT = path.join(ROOT, 'public/assets/covers');

const H = 320;       // output height — 4× the card's 80px, for high-DPI screens
const MARGIN = 0.02; // breathing room around the content, as a fraction of its long side

/* Render windows in SOURCE pixels (every shot is 2000×1250). */
const SHOTS = [
  { id: 'blob_tracker',   f: '1-blob_tracker.webp', win: [70, 300, 1530, 1190] },
  { id: 'analog',         f: '2-analog.webp',       win: [70, 300, 1530, 1180] },
  { id: 'blob_reveal',    f: '3-blob_reveal.webp',  win: [110, 290, 1500, 1120] },
  { id: 'bokeh',          f: '4-bokeh.webp',        win: [70, 355, 1530, 1160] },
  // NOTE: the fifth shot is the bokeh app's ANAMORPHIC section (letterbox +
  // squeeze 2.20), which is what the operator delivered as the anamorphic look.
  { id: 'anamorphic_lab', f: '5-anamorphic.webp',   win: [70, 355, 1530, 1160] },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');
  fs.mkdirSync(OUT, { recursive: true });

  for (const s of SHOTS) {
    const b64 = fs.readFileSync(path.join(SRC, s.f)).toString('base64');
    const r = await page.evaluate(async ({ b64, win, H, MARGIN }) => {
      const im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
      const [x0, y0, x1, y1] = win, w = x1 - x0, h = y1 - y0;

      const src = document.createElement('canvas'); src.width = w; src.height = h;
      const sg = src.getContext('2d', { willReadFrequently: true });
      sg.drawImage(im, x0, y0, w, h, 0, 0, w, h);
      const d = sg.getImageData(0, 0, w, h).data;

      const T = 40, MINRUN = 4;
      const colN = new Int32Array(w), rowN = new Int32Array(h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (Math.max(d[i], d[i + 1], d[i + 2]) > T) { colN[x]++; rowN[y]++; }
      }
      let bx0 = -1, bx1 = -1, by0 = -1, by1 = -1;
      for (let x = 0; x < w; x++) if (colN[x] >= MINRUN) { if (bx0 < 0) bx0 = x; bx1 = x; }
      for (let y = 0; y < h; y++) if (rowN[y] >= MINRUN) { if (by0 < 0) by0 = y; by1 = y; }
      const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;

      const m = Math.round(Math.max(bw, bh) * MARGIN);
      const k = H / (bh + 2 * m);
      const W = Math.round((bw + 2 * m) * k);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const dw = Math.round(bw * k), dh = Math.round(bh * k);
      g.drawImage(src, bx0, by0, bw, bh, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);

      return { box: [bx0, by0, bw, bh], plate: [W, H], webp: c.toDataURL('image/webp', 0.92) };
    }, { b64, win: s.win, H, MARGIN });

    const file = path.join(OUT, `${s.id}.webp`);
    fs.writeFileSync(file, Buffer.from(r.webp.split(',')[1], 'base64'));
    console.log(`${s.id.padEnd(15)} content ${r.box[2]}x${r.box[3]} @${r.box[0]},${r.box[1]}  ->  ${r.plate.join('x')} ` +
                `(aspect ${(r.plate[0] / r.plate[1]).toFixed(2)})  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  }
  await browser.close();
  console.log(`\nwritten to ${OUT} — verify with tools/verify/verify-phase10-covers.js`);
})();
