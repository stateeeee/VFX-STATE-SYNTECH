/*
 * Background-texture preview generator (design exploration, NOT an app change).
 *
 * Renders the real running app with an operator-supplied texture standing in for
 * the app's darkest blacks — `--syn-bg` (#0e0e0e, the space between sections)
 * and `--syn-ink-950/900/850` (#000000: top bar, sidebar, panels) — so the
 * sections, text and logos read as "stuck on top of" the image.
 *
 * How it works (and why this way):
 *   - The rotation is BAKED into the image, then the texture is used as a
 *     `background-attachment: fixed` layer on the page AND on every dark panel.
 *     Fixed attachment aligns every layer to the viewport, so the separate
 *     panels show one single continuous image behind the whole UI. (Rotating a
 *     transformed layer instead would need blend groups that break the next
 *     point, and `fixed` can't be rotated — hence baking.)
 *   - Each panel keeps a dark scrim layer over the texture for text legibility.
 *     No `backdrop-filter` is used anywhere: it creates a stacking context that
 *     ISOLATES blending, which is what stops the hero canvas trick below.
 *   - The hero brain-graph canvas paints an opaque dark fill every frame, so it
 *     is screen-blended: its black drops out and only the glowing nodes/links
 *     float over the texture.
 *
 * Modes:
 *   flat — the texture at --deg (0/45/90/135).
 *   wrap — the "3D" variant: same background, PLUS perspective shell pieces of
 *          the same texture folding forward over the UI edges (above the panels)
 *          so the app looks encased in a cover that wraps behind AND in front,
 *          with fold highlights and an inner shadow seating it inside.
 *
 * Usage: NODE_PATH=/opt/node22/lib/node_modules node bg-texture-preview.cjs \
 *          --tex <file> --deg 45 --mode flat|wrap --out <png> --label "A · 45°"
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const TEX = arg('tex'), DEG = Number(arg('deg', 0)), MODE = arg('mode', 'flat');
const OUT = arg('out'), LABEL = arg('label', ''), URL = arg('url', 'http://localhost:3000');
const VW = Number(arg('vw', 1600)), VH = Number(arg('vh', 1000)), DSF = Number(arg('dsf', 1.5));
const SCRIM = arg('scrim', '0.50'); // panel darkening over the texture
// extra zoom beyond "cover": the source artworks sit on their own black margin,
// so a little over-crop keeps the background full-bleed instead of showing the
// artwork's own black frame at the viewport edges
const ZOOM = Number(arg('zoom', 1.2));
// wrap-mode geometry: flap width/height as % of the viewport and the fold angle
const WRAP_W = Number(arg('wrapw', 7)), WRAP_H = Number(arg('wraph', 6)), WRAP_DEG = Number(arg('wrapdeg', 30));
const WRAP_OPACITY = Number(arg('wrapop', 0.86));

(async () => {
  const ext = path.extname(TEX).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  const rawUrl = `data:${mime};base64,${fs.readFileSync(TEX).toString('base64')}`;

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2200); // let the brain graph settle

  // bake the rotation: a VW×VH plate holding the texture rotated by DEG, scaled
  // to cover the rotated bounding box (least upscaling that still covers)
  const baked = await page.evaluate(async ({ rawUrl, DEG, VW, VH, DSF, ZOOM }) => {
    const im = new Image(); im.src = rawUrl; await im.decode();
    const r = (DEG * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
    const needW = VW * c + VH * s, needH = VW * s + VH * c;      // pre-rotation coverage
    const scale = Math.max(needW / im.naturalWidth, needH / im.naturalHeight) * ZOOM;
    const W = Math.round(VW * DSF), H = Math.round(VH * DSF);     // bake at output res
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.translate(W / 2, H / 2); x.rotate(r);
    const dw = im.naturalWidth * scale * DSF, dh = im.naturalHeight * scale * DSF;
    x.drawImage(im, -dw / 2, -dh / 2, dw, dh);
    return { url: cv.toDataURL('image/jpeg', 0.94), upscale: +scale.toFixed(2), src: `${im.naturalWidth}x${im.naturalHeight}` };
  }, { rawUrl, DEG, VW, VH, DSF, ZOOM });

  await page.addStyleTag({ content: `
    /* ── the texture takes over the app's darkest blacks (token-level swap) ──
       Overriding the TOKENS (not the utility classes) catches both \`bg-ink-*\`
       classes and the inline \`var(--syn-ink-900)\` styles (the node graph panel),
       and turning them translucent lets the ONE fixed texture on <body> show
       through every section — so it stays a single continuous image, with the
       alpha doubling as the text-legibility scrim. */
    :root {
      --syn-tex: url("${baked.url}");
      --syn-bg: transparent;                        /* space between sections (#0e0e0e) */
      --syn-ink-950: rgba(0,0,0,${SCRIM});          /* top bar / sidebar   (was #000) */
      --syn-ink-900: rgba(0,0,0,${SCRIM});          /* deep panel + hero   (was #000) */
      --syn-ink-850: rgba(0,0,0,${Math.max(0, Number(SCRIM) - 0.06).toFixed(2)}); /* panel (was #000) */
      --syn-ink-800: rgba(22,22,28,${Math.min(1, Number(SCRIM) + 0.06).toFixed(2)}); /* card (was #1a1a1a) */
    }
    html { background: #05050a; }
    body {
      background-color: transparent !important;
      background-image: var(--syn-tex) !important;
      background-attachment: fixed !important;
      background-size: cover !important;
      background-position: center !important;
    }
    /* the few one-off dark hexes that don't read a token */
    .bg-\\[\\#0e0e0e\\], .bg-\\[\\#0c0c0c\\], .bg-\\[\\#080808\\] { background-color: rgba(0,0,0,${SCRIM}) !important; }
    /* the brain graph: screen-blend so its opaque black drops out */
    canvas { mix-blend-mode: screen; }
    /* preview annotation */
    #syn-label {
      position: fixed; left: 10px; bottom: 8px; z-index: 999;
      font: 600 10px/1 "JetBrains Mono", monospace; letter-spacing: .14em; text-transform: uppercase;
      color: rgba(255,255,255,.7); background: rgba(0,0,0,.5); border: 1px solid rgba(255,255,255,.16);
      padding: 5px 9px; border-radius: 6px; pointer-events: none;
    }
  ` });

  if (MODE === 'wrap') {
    // Deliberately restrained: the flaps only bite a few dozen pixels into the
    // sections ("un minimo") and fade out fast, so the wrap reads as a 3D cover
    // without burying the sidebar, the title or the cards.
    await page.addStyleTag({ content: `
      #syn-3d { position: fixed; inset: 0; z-index: 60; pointer-events: none; perspective: 1400px; perspective-origin: 50% 50%; }
      .syn-shell {
        position: absolute; background-image: var(--syn-tex);
        background-size: cover; background-position: center;
        filter: saturate(1.12) contrast(1.06) brightness(1.05);
        /* slightly translucent: the sections stay perceptible UNDER the shell,
           which is what makes the UI read as encased inside it rather than hidden */
        opacity: ${WRAP_OPACITY};
      }
      /* side flaps curl toward the viewer over the left/right edges */
      .syn-shell.l { left: 0; top: 0; width: ${WRAP_W}%; height: 100%; transform-origin: left center;
        transform: rotateY(${WRAP_DEG}deg);
        -webkit-mask-image: linear-gradient(to right, #000 0 30%, rgba(0,0,0,.55) 62%, transparent 100%);
                mask-image: linear-gradient(to right, #000 0 30%, rgba(0,0,0,.55) 62%, transparent 100%); }
      .syn-shell.r { right: 0; top: 0; width: ${WRAP_W}%; height: 100%; transform-origin: right center;
        transform: rotateY(-${WRAP_DEG}deg);
        -webkit-mask-image: linear-gradient(to left, #000 0 30%, rgba(0,0,0,.55) 62%, transparent 100%);
                mask-image: linear-gradient(to left, #000 0 30%, rgba(0,0,0,.55) 62%, transparent 100%); }
      /* top/bottom flaps complete the wrap */
      .syn-shell.t { left: 0; top: 0; width: 100%; height: ${WRAP_H}%; transform-origin: center top;
        transform: rotateX(-${WRAP_DEG}deg);
        -webkit-mask-image: linear-gradient(to bottom, #000 0 28%, rgba(0,0,0,.5) 60%, transparent 100%);
                mask-image: linear-gradient(to bottom, #000 0 28%, rgba(0,0,0,.5) 60%, transparent 100%); }
      .syn-shell.b { left: 0; bottom: 0; width: 100%; height: ${WRAP_H}%; transform-origin: center bottom;
        transform: rotateX(${WRAP_DEG}deg);
        -webkit-mask-image: linear-gradient(to top, #000 0 28%, rgba(0,0,0,.5) 60%, transparent 100%);
                mask-image: linear-gradient(to top, #000 0 28%, rgba(0,0,0,.5) 60%, transparent 100%); }
      /* fold highlights + inner shadow: the UI sits recessed inside the shell */
      #syn-folds { position: fixed; inset: 0; z-index: 61; pointer-events: none;
        background:
          linear-gradient(to bottom, rgba(255,255,255,.16), rgba(255,255,255,.04) 70%, transparent) left ${WRAP_W}% top / 1.5px 100% no-repeat,
          linear-gradient(to bottom, rgba(255,255,255,.16), rgba(255,255,255,.04) 70%, transparent) right ${WRAP_W}% top / 1.5px 100% no-repeat,
          linear-gradient(to right, rgba(255,255,255,.12), rgba(255,255,255,.03) 70%, transparent) left top ${WRAP_H}% / 100% 1.5px no-repeat,
          linear-gradient(to right, rgba(255,255,255,.12), rgba(255,255,255,.03) 70%, transparent) left bottom ${WRAP_H}% / 100% 1.5px no-repeat;
        box-shadow: inset 0 0 130px 34px rgba(0,0,0,.5), inset 0 0 40px 6px rgba(0,0,0,.4); }
    ` });
  }

  await page.evaluate(({ label, mode }) => {
    if (mode === 'wrap') {
      const s = document.createElement('div'); s.id = 'syn-3d';
      for (const k of ['t', 'b', 'l', 'r']) { const d = document.createElement('div'); d.className = 'syn-shell ' + k; s.appendChild(d); }
      document.body.appendChild(s);
      const f = document.createElement('div'); f.id = 'syn-folds'; document.body.appendChild(f);
    }
    if (label) { const l = document.createElement('div'); l.id = 'syn-label'; l.textContent = label; document.body.appendChild(l); }
  }, { label: LABEL, mode: MODE });

  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT });
  console.log(`${path.basename(OUT)}  mode=${MODE} deg=${DEG} src=${baked.src} upscale=${baked.upscale}x`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
