# Effect-card cover sources

The operator loaded their logo (the "star") into each of the five effect apps and
screenshotted the result, so every card in the right sidebar shows what that
effect actually does to the same subject — a like-for-like comparison without
having to open each one.

These are those screenshots, recovered from the session transcript (they were
delivered in chat, not on disk), 2000×1250 each:

| File | Effect app | Look captured |
|---|---|---|
| `1-blob_tracker.webp` | `blob_state_tracker.html` | tracker boxes, IDs and connection lines |
| `2-analog.webp` | `analog_state.html` | sort → feedback → CRT tearing |
| `3-blob_reveal.webp` | `blob reveal (1).html` | rotoscope SEG reveal, floating fragments |
| `4-bokeh.webp` | `bokeh_state_v1 (3).html` | BOKEH STYLE = SWIRLY |
| `5-anamorphic.webp` | `bokeh_state_v1 (3).html`, ANAMORPHIC section | letterbox + squeeze 2.20 |

| `6-invisible.webp` | INVISIBLE app | the cloak: only a glowing outline of the star is left |
| `7-time_machine.webp` | TIME MACHINE app | frame-buffer displacement, MOTION map |
| `8-pointcloud.webp` | POINTCLOUD app | bloomed 3D point cloud |
| `9-painting.webp` | PAINTING app | TEMPERA style |
| `10-quadtree.webp` | QUADTREE | bare 1672×941 render frame (no app chrome) |

Files 6–10 were added on 2026-10-22 with the same recipe and the same 466×320 plate.
POINTCLOUD and PAINTING carry a `floor` (black point) in the generator because their bloom halo would
otherwise be cut by the crop into a faint rectangle.

**Note on the fifth:** it is the anamorphic *look*, captured from the bokeh app's
ANAMORPHIC section, not from the standalone `anamorphic_lab` app — that is the
screenshot the operator delivered as the fifth. A shot from `anamorphic_lab`
itself can replace it: drop it in as `5-anamorphic.webp` and re-run the generator.

## Regenerating the covers

```bash
NODE_PATH=/opt/node22/lib/node_modules node tools/gen/gen-effect-covers.cjs [ModuleId ...]   # ids = rebuild only those
NODE_PATH=/opt/node22/lib/node_modules node tools/frame/build-day-covers.cjs [ModuleId ...]  # keyed day variants
NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-covers.js
```

The suite is CommonJS in a `"type":"module"` package: run it from a `.cjs` copy (known issue, see STATE).

The generator crops each shot to its render area, finds the content's bounding
box and redraws it centred on a tight black plate; the window coordinates live at
the top of the script. Output goes to `public/assets/covers/<ModuleId>.webp`.
