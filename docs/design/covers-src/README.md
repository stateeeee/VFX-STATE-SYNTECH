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

**Note on the fifth:** it is the anamorphic *look*, captured from the bokeh app's
ANAMORPHIC section, not from the standalone `anamorphic_lab` app — that is the
screenshot the operator delivered as the fifth. A shot from `anamorphic_lab`
itself can replace it: drop it in as `5-anamorphic.webp` and re-run the generator.

## Regenerating the covers

```bash
NODE_PATH=/opt/node22/lib/node_modules node tools/gen/gen-effect-covers.cjs
NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-covers.js
```

The generator crops each shot to its render area, finds the content's bounding
box and redraws it centred on a tight black plate; the window coordinates live at
the top of the script. Output goes to `public/assets/covers/<ModuleId>.webp`.
