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

10 previews were delivered to the operator (4 rotations × 2 textures + one 3D
wrap per texture). **Pending the operator's decision** (2026-07-25 morning)
whether to adopt it; if adopted, the same token swap moves into `src/index.css`
and the chosen texture becomes a real asset under `public/assets/`.

Note: both files are the chat-downscaled versions (736px). They are upscaled
~2–3× to cover a 1600×1000 viewport in the previews, so the previews look softer
than the final would with the operator's full-resolution originals.
