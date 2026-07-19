# HANDOFF — session continuation brief (updated 2026-07-19, Phase 6 CLOSED)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> Phases 0–6 are DONE and verified (STATE.md log has all numbers).
> The next session executes **Phase 7 — 1:1 port: blob_reveal** per the
> port template in 05-ROADMAP.md (Phases 4–8 section).

## Where we are

- Branch: `claude/vfx-syntech-workflow-vawwx9`, restarted from `origin/main`
  (= merge `b9c0001`) after the Phase-5/6-WIP merge. Work + push here.
- Real ports live in `src/engine/nodes/`: **analog**, **bokeh**,
  **anamorphic_lab** — all parity-verified (static ≈ pixel-identical).
  DummyNodes remain for blob_reveal and blob_tracker.
- Verify suites for phases 1–6 live in `tools/verify/` (`__SCRATCH__`
  placeholder pattern). Phase 6 close-out numbers are in the STATE.md log.

## Phase 7 — blob_reveal: facts already gathered (save a read)

- `public/effects/blob_reveal/index.html` (~1763 lines) is **pure Canvas 2D**
  — seven 2d contexts (`dc`, `cBlob`, `cMask`, `cSub`, `cErode`, `cProc`
  willReadFrequently, waveform), NO WebGL. 04-SPEC port note (binding):
  the 2D pipeline may render offscreen and upload to the node's GL texture
  per frame — 1:1 means identical output, not identical plumbing. The mask
  comes from the shared PersonMask (its own MediaPipe load must be replaced
  the way bokeh/anamorphic did it, via `segEnabled`).
- Canvas size is **viewport-fit** (`fit()` at line ~983: aspect-fits
  `canvas-area` minus 24px padding to the video aspect), NOT fixed like
  bokeh (1920×1080) or capped like anamorphic (1280). For static parity,
  read the standalone's actual `dc.width/height` after fit and pin the
  engine canvas to exactly that (drive the viewport so it lands on a
  clean size).
- **It HAS real audio reactivity** (unlike anamorphic): its own
  AudioContext/analyser (fft 2048, smoothing 0.82) fed by the VIDEO's
  audio track or mic; beat detection drives blob expansion
  (`sl-audioexp` = audio-driven expansion, `sl-bsens` = beat sensitivity).
  Per the port template this maps to **defaultRoutes on the real
  AudioEngine** (the Phase-4 analog substitution pattern: real analysis
  replaces the built-in analyser; the sliders keep their exact math).
- Controls (04-SPEC): `sl-thr, sl-lum, sl-segn, sl-feather, sl-erode,
  sl-dil, sl-minarea, sl-maxblobs, sl-bgap, sl-bsens, sl-opacity,
  sl-audioexp` + `btn-seg`/`btn-model` toggles (bridge v1 already
  serializes these — see Phase 1 log).
- The erode trick is GPU-compositing ("shadow" offset draws + threshold),
  documented in a comment block right after `fit()`. `cProc` uses
  `willReadFrequently` — there IS CPU pixel work (blob detection);
  expect a CPU stage like bokeh's pixel sort (fixed-res it if the
  original does).

## Phase 7 session plan (per protocol)

1. Read the HTML end-to-end; extract the FULL param table (ranges/steps/
   defaults from the markup) and the exact render pipeline order.
2. Implement `src/engine/nodes/blob_reveal.ts`; factory swap in
   `nodes.ts`. Offscreen-2D + texture upload is sanctioned (04-SPEC).
3. Audio reactivity via defaultRoutes; segmentation via shared PersonMask
   (`segEnabled` + `personMaskVersion` like bokeh).
4. Parity per 06-VERIFICATION §4: static (match the standalone's REAL
   fitted canvas size), behavior (beat expansion, seg on/off, blob
   dynamics), chain (4 real ports), regression 1/2/3/5/6-static, lint.
5. STATE.md flip + log + next step (Phase 8 blob_tracker), commit, push,
   rewrite this HANDOFF for Phase 8.

## Parity method (unchanged)

- Static: `__SYN` tap; pin `adaptiveRes=false`; match the STANDALONE's
  actual canvas size; pause both videos on the same 1080p-clip frame;
  inject the SAME mask both sides (standalone global seg callback,
  engine PersonMask tap); settle-detect grabs; corr>0.93/mad<0.06 gates
  (expect ≈1.000 where the pipeline is deterministic — blob_reveal has
  CPU blob detection: check determinism before promising pixel-identity).
- Temporal: count RENDERED frames per side (engine `__SYN.engine.frame`;
  standalone: rAF-wrapper counter trick — works when render() re-invokes
  rAF via the global).
- Drive the standalone through its own globals (function declarations are
  on window; `const`/`let` objects only through those functions).
- GLSL ES 3.00 reserved words (`active` bit Phase 6) — scan before first
  compile.

## Sandbox facts (will bite you if forgotten)

- NEVER write any repo file while a suite drives the shell page (Vite
  full-reload kills the run). Stage texts in the scratchpad.
- `page.screenshot` starves under GL load — use canvas `toDataURL`.
- ChainLab racks ALL five nodes (unwired ⇒ enabled=false): wait on chain
  CONTENT, never length. Two heavy pages: `__SYN.engine.stop()` around
  navigation; close the standalone page as soon as it's done.
- Network: jsdelivr/cdnjs blocked → npm mirror + `context.route()`.
  Scratchpad rebuild: copy `tools/verify/*.js` + `sed -i
  "s|__SCRATCH__|$S|g"`; `npm pack three@0.128.0
  @mediapipe/selfie_segmentation` → extract to `$S/cdn/three/…` and
  `$S/cdn/@mediapipe/selfie_segmentation/…`; `node gen1080.js`;
  `node make-beat-wav.js`; `cp parity1080.webm $S/test.webm`.
  Launch args: `--autoplay-policy=no-user-gesture-required
  --enable-unsafe-swiftshader` (+ fake media flags when mic/webcam).
  Playwright global: `NODE_PATH=/opt/node22/lib/node_modules`.
  MediaRecorder webms have no cues → race seeks with ~2.5s timeout.
- React StrictMode double-mount: services must dispose reversibly.
- fps acceptance (≥30 @720p) is a GPU-machine criterion — sandbox is
  SwiftShader. Report honestly.
- `npm run lint` = `tsc --noEmit`. Clean before every commit.

## Protocol reminders

One phase per session; specs first; short plan; verify per
06-VERIFICATION; STATE.md (checkboxes, log with evidence, next step) in
the same commit as the work; push with retries. Operator speaks Italian;
repo docs English. Never touch the five effect HTMLs outside the bridge
blocks. ModuleIds and `--syn-*` tokens are load-bearing.
