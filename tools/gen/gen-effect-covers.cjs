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
 *   3. Redraw every box centred on a black plate, all five at ONE COMMON ASPECT —
 *      the widest of the five (bokeh's swirl) plus a 2% margin.
 *
 * Why one common aspect: the card draws the cover with `object-contain` at
 * `h-full w-auto`, so the plate's aspect IS the width of the art column. Cut tight
 * per effect, the columns came out 0.88 … 1.46 wide and the labels beside them sat
 * on five different axes — and the widest one hit the column's max-width and
 * rendered its star shorter than the rest. One aspect makes every column the same
 * width, so the five stars share a height and the labels line up.
 *
 * The plate stays far narrower than the card (1.46:1 against 2.2:1 at the very
 * narrowest sidebar), so `contain` binds on HEIGHT and the star fills the card top
 * to bottom. `object-cover` would instead crop it.
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

  /* Pass 1 — find every content box, and with them the aspect all five plates
     will share. */
  const found = [];
  for (const s of SHOTS) {
    const b64 = fs.readFileSync(path.join(SRC, s.f)).toString('base64');
    const box = await page.evaluate(async ({ b64, win }) => {
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
      return [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1];
    }, { b64, win: s.win });
    found.push({ ...s, box, b64 });
  }

  const plateAspect = Math.max(...found.map(({ box: [, , bw, bh] }) => {
    const m = Math.max(bw, bh) * MARGIN;
    return (bw + 2 * m) / (bh + 2 * m);
  }));
  const W = Math.round(H * plateAspect);
  console.log(`common plate: ${W}x${H} (aspect ${plateAspect.toFixed(2)})\n`);

  /* Pass 2 — compose each cover on that one plate. */
  for (const s of found) {
    const webp = await page.evaluate(async ({ b64, win, box, W, H, MARGIN }) => {
      const im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
      const [x0, y0, x1, y1] = win, w = x1 - x0, h = y1 - y0;
      const src = document.createElement('canvas'); src.width = w; src.height = h;
      src.getContext('2d').drawImage(im, x0, y0, w, h, 0, 0, w, h);

      const [bx0, by0, bw, bh] = box;
      const m = Math.max(bw, bh) * MARGIN;
      const k = H / (bh + 2 * m);            // the margin sets the height, as before
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      const dw = Math.round(bw * k), dh = Math.round(bh * k);
      g.drawImage(src, bx0, by0, bw, bh, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
      return c.toDataURL('image/webp', 0.92);
    }, { b64: s.b64, win: s.win, box: s.box, W, H, MARGIN });

    const file = path.join(OUT, `${s.id}.webp`);
    fs.writeFileSync(file, Buffer.from(webp.split(',')[1], 'base64'));
    console.log(`${s.id.padEnd(15)} content ${s.box[2]}x${s.box[3]} @${s.box[0]},${s.box[1]}` +
                `  ->  ${W}x${H}  ${(fs.statSync(file).size / 1024).toFixed(1)} KB`);
  }
  await browser.close();
  console.log(`\nwritten to ${OUT} — verify with tools/verify/verify-phase10-covers.js`);
})();
