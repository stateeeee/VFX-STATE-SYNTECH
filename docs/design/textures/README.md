# Background texture references (operator-supplied, 2026-07-25)

Two artworks the operator uploaded as candidates for the app's **3D background**:
the texture replaces the darkest blacks of the UI (`--syn-bg` #0e0e0e and
`--syn-ink-950/900/850` #000000) with the sections, text and logos sitting on top.

| File | What it is |
|---|---|
| `texture-A-jewel-mosaic.jpg` | Beaded/jewel mosaic plate, saturated teal→gold→magenta |
| `texture-B-holographic-film.jpg` | Iridescent holographic film, soft pastel rainbow |

**These are design references, not shipped app assets.** Nothing in the app reads
them; the experiment is rendered by `tools/preview/bg-texture-preview.cjs`, which
injects the look into the running app at runtime and screenshots it:

```bash
npm run dev   # in another shell
NODE_PATH=/opt/node22/lib/node_modules node tools/preview/bg-texture-preview.cjs \
  --tex docs/design/textures/texture-A-jewel-mosaic.jpg \
  --deg 45 --mode flat --scrim 0.55 --zoom 1.2 --out /tmp/a45.png --label "A · 45°"
# --mode wrap adds the 3D cover that folds over the UI edges
```

## DECIDED (2026-07-25): texture A at 0°, sections at 90% — SHIPPED

10 previews were delivered (4 rotations × 2 textures + one 3D wrap each). The
operator chose **texture A, rotation 0°**, with the correction that **the sections
must keep 90% opacity and cover the artwork, which stays only just perceptible**
(the previews had them at 55%, which let the artwork dominate and washed out the
sidebar labels). The 3D wrap variant was not chosen.

It is now live in the app, not just a preview:

- `public/assets/bg-texture.jpg` — the shipped asset (a copy of texture A).
- `src/index.css` — `.syn-bg-layer` (fixed, `inset:-10%` so `cover` crops the
  artwork's own black margin) + the night surface tokens at 90% (`--syn-ink-950/
  900/850`), `--syn-bg: transparent` so the gaps show the artwork, and
  `--syn-hero-canvas: transparent`.
- `src/App.tsx` — renders the layer in night mode only (day keeps its cream).
- `src/components/VfxCanvas.tsx` — clears instead of filling when
  `--syn-hero-canvas` is `transparent`, so the artwork also shows through the
  hero panel. A translucent fill would have accumulated to solid black.
- Verified by `tools/verify/verify-phase10-bgtexture.js` (12/12).

**To swap in the full-resolution artwork:** replace `public/assets/bg-texture.jpg`
— nothing else changes. **To revert the look:** restore the flat token values
noted in `src/index.css` and drop the layer element.

Note: both files are the chat-downscaled versions (736px). They are upscaled
~2–3× to cover a 1600×1000 viewport in the previews, so the previews look softer
than the final would with the operator's full-resolution originals.
