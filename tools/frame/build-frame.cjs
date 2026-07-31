/*
 * Builds the CAGE: the operator's artwork turned into the app's chrome.
 *
 * Reads   docs/design/frame/cage.webp   (their artwork, never modified)
 * Writes  tools/frame/out/frame-keyed.png   the frame with its openings keyed out,
 *                                           a soft contour laid along every opening
 *                                           and a colour grade baked in
 *         tools/frame/holes.json            the measured geometry every section is
 *                                           positioned from
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/frame/build-frame.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const ART = path.join(ROOT, 'docs/design/frame/cage.webp');
const OUT = path.join(__dirname, 'out');
const VW = 1600, VH = Math.round(1600 / 1.679);

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const work = await (await browser.newContext()).newPage();
  await work.goto('about:blank');
  fs.mkdirSync(OUT, { recursive: true });
  const b64 = fs.readFileSync(ART).toString('base64');

  const keyed = await work.evaluate(async (b64) => {
    const im = new Image(); im.src = 'data:image/webp;base64,' + b64; await im.decode();
    const W = im.naturalWidth, H = im.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const img = g.getImageData(0, 0, W, H), d = img.data;

    const T = 26;
    const dark = new Uint8Array(W * H);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) if (Math.max(d[i], d[i + 1], d[i + 2]) <= T) dark[p] = 1;

    const seen = new Uint8Array(W * H), stack = new Int32Array(W * H);
    const regions = [];
    for (let p0 = 0; p0 < W * H; p0++) {
      if (!dark[p0] || seen[p0]) continue;
      let sp = 0; stack[sp++] = p0; seen[p0] = 1;
      const px = []; let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      while (sp) {
        const p = stack[--sp]; px.push(p);
        const x = p % W, y = (p - x) / W; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && dark[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < W - 1 && dark[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && dark[p - W] && !seen[p - W]) { seen[p - W] = 1; stack[sp++] = p - W; }
        if (y < H - 1 && dark[p + W] && !seen[p + W]) { seen[p + W] = 1; stack[sp++] = p + W; }
      }
      if (n > W * H * 0.0008) regions.push({ n, x0, y0, x1, y1, px });
    }
    regions.sort((a, b) => b.n - a.n);
    const isBorder = (r) => r.x0 <= 1 && r.y0 <= 1 && r.x1 >= W - 2 && r.y1 >= H - 2;

    /* Punch the openings and lay the contour — with a SOFT profile.
       The first version eroded a binary mask by whole pixels and painted the 2px
       ring it left: the result was a stair-stepped, razor-sharp line (the operator
       called it seghettato, and it was). Blur the mask instead and read the ramp:
       m≈1 deep in the hole, m≈0 in the material, a smooth band across the edge.
       Alpha follows (1-m), so the material fades out instead of being cut, and the
       contour is painted where the ramp crosses the middle — antialiased for free,
       and it follows the organic curve instead of the pixel grid. */
    const hole = new Uint8Array(W * H);
    for (const r of regions) { if (!isBorder(r)) for (const p of r.px) hole[p] = 1; }

    /* The artwork's outer black rim flood-fills as ONE region that touches all four
       edges, and it reaches deep into the bottom-right corner — which is why that
       corner stayed black whatever backdrop was put behind it: it was never an
       opening at all, it was opaque black material. Key that region too, but keep a
       RIM of pixels near the image border so the cage still has its dark outline. */
    const RIM = 14;
    for (const r of regions) {
      if (!isBorder(r)) continue;
      for (const p of r.px) {
        const x = p % W, y = (p - x) / W;
        if (x >= RIM && y >= RIM && x < W - RIM && y < H - RIM) hole[p] = 1;
      }
    }

    const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
    const mg = mc.getContext('2d', { willReadFrequently: true });
    const mdat = mg.createImageData(W, H);
    for (let p = 0; p < W * H; p++) {
      const v = hole[p] ? 255 : 0;
      mdat.data[p * 4] = v; mdat.data[p * 4 + 1] = v; mdat.data[p * 4 + 2] = v; mdat.data[p * 4 + 3] = 255;
    }
    mg.putImageData(mdat, 0, 0);

    const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
    const bg2 = bc.getContext('2d', { willReadFrequently: true });
    bg2.filter = 'blur(3px)';
    bg2.drawImage(mc, 0, 0);
    const ramp = bg2.getImageData(0, 0, W, H).data;

    /* Colour correction on the cage itself: the artwork reads flat, so a light
       hand — exposure +8%, contrast +12% pivoted at mid grey, and VIBRANCE (not
       saturation): the boost is weighted by (1 - s), so the pale blues and the
       greys come up while the already-saturated reds and golds barely move and
       do not clip. Graded first, then the contour is drawn on top of the result. */
    const EXPO = 1.08, CONTRAST = 1.12, VIBRANCE = 0.30;
    const grade = (r, g2, b2) => {
      let R = Math.min(255, r * EXPO), G = Math.min(255, g2 * EXPO), B = Math.min(255, b2 * EXPO);
      R = Math.min(255, Math.max(0, (R - 128) * CONTRAST + 128));
      G = Math.min(255, Math.max(0, (G - 128) * CONTRAST + 128));
      B = Math.min(255, Math.max(0, (B - 128) * CONTRAST + 128));
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      if (mx > 0) {
        const sat = (mx - mn) / mx;
        const boost = VIBRANCE * (1 - sat);          // pale pixels gain the most
        const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
        R = Math.min(255, Math.max(0, lum + (R - lum) * (1 + boost)));
        G = Math.min(255, Math.max(0, lum + (G - lum) * (1 + boost)));
        B = Math.min(255, Math.max(0, lum + (B - lum) * (1 + boost)));
      }
      return [R, G, B];
    };

    let nRing = 0;
    for (let p = 0; p < W * H; p++) {
      const i = p * 4;
      const m = ramp[i] / 255;
      const [gr, gg, gb] = grade(d[i], d[i + 1], d[i + 2]);
      d[i] = Math.round(gr); d[i + 1] = Math.round(gg); d[i + 2] = Math.round(gb);
      if (m < 0.02 && !hole[p]) continue;          // graded material, nothing else to do
      const a = 1 - m;                              // hole → transparent, soft
      const l = Math.max(0, 1 - Math.abs(m - 0.52) / 0.34);  // the contour band
      const k = l * l * 0.95;                       // squared: a tighter core
      if (k > 0.02) nRing++;
      d[i]     = Math.round(d[i]     * (1 - k) + 6 * k);
      d[i + 1] = Math.round(d[i + 1] * (1 - k) + 6 * k);
      d[i + 2] = Math.round(d[i + 2] * (1 - k) + 8 * k);
      d[i + 3] = Math.round(Math.min(1, Math.max(a, k)) * 255);
    }
    const nHole = 0, nKey = 0, nLine = 0;
    window.__dbg = { nHole, nKey, nLine, nRing };
    g.putImageData(img, 0, 0);
    const R = regions.filter((r) => !isBorder(r));

    /* Fit a rectangle to an organic opening: start at its bounding box and pull in
       only the edges that actually sit on material. The CORNERS are deliberately
       ignored (only the middle 84% of each edge is tested) — the panels have their
       own 16px radius, so a rounded hole and a rounded panel agree there, and
       testing the corners would shrink the whole rect to satisfy two pixels.
       (The max-area inscribed rectangle was tried first: on a rounded opening it
       trades away ~200px of width to gain a few px of height. Wrong objective.) */
    const fitRect = (px, rowFrom, rowTo, tol = 0.04) => {
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      const set = new Set();
      for (const p of px) {
        const x = p % W, y = (p - x) / W;
        if (y < rowFrom || y > rowTo) continue;
        set.add(p);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const inside = (x, y) => set.has(y * W + x);
      const outsideRatio = (edge) => {
        const m = 0.08; // skip the corner eighths
        let out = 0, tot = 0;
        if (edge === 'top' || edge === 'bottom') {
          const y = edge === 'top' ? y0 : y1;
          const a = Math.round(x0 + (x1 - x0) * m), b = Math.round(x1 - (x1 - x0) * m);
          for (let x = a; x <= b; x++) { tot++; if (!inside(x, y)) out++; }
        } else {
          const x = edge === 'left' ? x0 : x1;
          const a = Math.round(y0 + (y1 - y0) * m), b = Math.round(y1 - (y1 - y0) * m);
          for (let y = a; y <= b; y++) { tot++; if (!inside(x, y)) out++; }
        }
        return tot ? out / tot : 0;
      };
      for (let i = 0; i < 400; i++) {
        const r = { top: outsideRatio('top'), bottom: outsideRatio('bottom'), left: outsideRatio('left'), right: outsideRatio('right') };
        const worst = Object.entries(r).sort((a, b) => b[1] - a[1])[0];
        if (worst[1] <= tol) break;
        if (worst[0] === 'top') y0 += 2; else if (worst[0] === 'bottom') y1 -= 2;
        else if (worst[0] === 'left') x0 += 2; else x1 -= 2;
        if (x1 - x0 < 40 || y1 - y0 < 20) break;
      }
      return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H };
    };
    const inscribe = fitRect;

    /* Largest circle that fits inside an opening. The bottom-right blob is a
       diagonal organic shape: its best RECTANGLE is a squashed 226x105 letterbox,
       while its best CIRCLE is far bigger — and a colour wheel wants a circle. */
    const inscribeCircle = (px) => {
      const set = new Set(px);
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (const p of px) { const x = p % W, y = (p - x) / W;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const fits = (cx, cy, r) => {
        for (let a = 0; a < 32; a++) {
          const t = a / 32 * Math.PI * 2;
          const x = Math.round(cx + Math.cos(t) * r), y = Math.round(cy + Math.sin(t) * r);
          if (!set.has(y * W + x)) return false;
        }
        return true;
      };
      let best = { r: 0, cx: 0, cy: 0 };
      for (let cy = y0; cy <= y1; cy += 3) for (let cx = x0; cx <= x1; cx += 3) {
        if (!set.has(cy * W + cx)) continue;
        let r = best.r + 1;
        while (fits(cx, cy, r) && r < 400) r++;
        if (r - 1 > best.r) best = { r: r - 1, cx, cy };
      }
      return { cx: best.cx / W, cy: best.cy / H, r: best.r / W };
    };

    /* The top slot and the hero are one region (joined at the left). Walk down a
       middle column to find where the slot ends and the hero begins. */
    const big = R[0];
    const col = Math.round(W * 0.35);
    let y = big.y0;
    while (y <= big.y1 && !dark[y * W + col]) y++;   // the slot's first dark row HERE
    while (y <= big.y1 && dark[y * W + col]) y++;    // down through the slot
    const slotBottom = y - 1;
    while (y <= big.y1 && !dark[y * W + col]) y++;   // across the band of material
    const heroTop = y;

    const bbox = (r) => ({ x: r.x0 / W, y: r.y0 / H, w: (r.x1 - r.x0) / W, h: (r.y1 - r.y0) / H });
    const union = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
      h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) });

    let sx0b = W, sx1b = 0, hx0b = W, hx1b = 0;
    for (const p of big.px) {
      const x = p % W, y = (p - x) / W;
      if (y <= slotBottom) { if (x < sx0b) sx0b = x; if (x > sx1b) sx1b = x; }
      else if (y >= heroTop) { if (x < hx0b) hx0b = x; if (x > hx1b) hx1b = x; }
    }

    const slotL = inscribe(big.px, big.y0, slotBottom);
    const slotR = inscribe(R[6].px, 0, H);
    return {
      png: c.toDataURL('image/png'), W, H, split: { slotBottom, heroTop }, dbg: window.__dbg,
      holes: {
        topbar: union(slotL, slotR),
        slotL, slotR,
        rail: union(bbox(R[4]), bbox(R[7])),
        railTop: inscribe(R[4].px, 0, H),
        meter: inscribe(R[7].px, 0, H),
        hero: inscribe(big.px, heroTop, big.y1),
        sidebar: inscribe(R[1].px, 0, H),
        nodes: inscribe(R[2].px, 0, H),
        gemini: inscribe(R[3].px, 0, H),
        palette: inscribe(R[5].px, 0, H),   // the empty oval bottom-right
        /* Bounding boxes of the openings that HOST a panel. A rect this size placed
           BEHIND the frame shows through exactly that opening's organic shape, so
           the panel's surface fills its whole hole — no black strip around it —
           while every EMPTY opening keeps the black bed. */
        boxes: {
          topbarL: bbox({ x0: sx0b, y0: big.y0, x1: sx1b, y1: slotBottom }),
          topbarR: bbox(R[6]),
          rail: bbox(R[4]),
          meter: bbox(R[7]),
          hero: bbox({ x0: hx0b, y0: heroTop, x1: hx1b, y1: big.y1 }),
          sidebar: bbox(R[1]),
          nodes: bbox(R[2]),
          gemini: bbox(R[3]),
        },
        /* The three openings in the bottom-right corner: they host the raw-video
           reference, and by day they light up like a panel — unlike the opening
           beside the effects column, which stays black. */
        /* Only the LOW strip of the bottom-right corner lights up by day (the
           operator ringed it in blue); the two shapes above it stay black. Whole
           regions are the wrong unit here — the corner reads as several openings
           but flood-fills as one diagonal blob, so this is a window over it. */
        videoBoxes: [{ x: 0.655, y: 0.838, w: 0.345, h: 0.162 }],
        _spare: {
        },
        paletteCircle: inscribeCircle(R[5].px),
      },
    };
  }, b64);

  console.log('mask debug:', JSON.stringify(keyed.dbg));
  console.log(`slot ends at y=${keyed.split.slotBottom}, hero starts at y=${keyed.split.heroTop}`);
  /* Print whatever shape each entry happens to be. This loop has now crashed
     three times on a newly added key — and because it runs BEFORE the writes, a
     crash meant holes.json and the keyed PNG silently kept their old contents
     while I believed the change had landed. Never let reporting gate the output. */
  for (const [k, v] of Object.entries(keyed.holes)) {
    if (Array.isArray(v)) { console.log(`  ${k.padEnd(13)} ${v.length} boxes`); continue; }
    if (v && v.r !== undefined) { console.log(`  ${k.padEnd(13)} circle r=${(v.r * VW).toFixed(0)}px`); continue; }
    if (!v || typeof v.x !== 'number') { console.log(`  ${k.padEnd(13)} ${v ? Object.keys(v).join(', ') : v}`); continue; }
    console.log(`  ${k.padEnd(13)} x=${v.x.toFixed(3)} y=${v.y.toFixed(3)} w=${v.w.toFixed(3)} h=${v.h.toFixed(3)}`
      + `   → ${Math.round(v.w * VW)}x${Math.round(v.h * VH)} px`);
  }

  fs.writeFileSync(__dirname + '/holes.json', JSON.stringify(keyed.holes, null, 1));
  /* preview3 reads the keyed frame FROM DISK — write it here, or every mask change
     made in this file silently never reaches the composite (it didn't, for three
     rounds: the erosion and the hairline were computed and thrown away). */
  fs.writeFileSync(path.join(OUT, 'frame-keyed.png'), Buffer.from(keyed.png.split(',')[1], 'base64'));

  console.log('\nwrote', path.join(OUT, 'frame-keyed.png'), 'and tools/frame/holes.json');
  await browser.close();
})();
