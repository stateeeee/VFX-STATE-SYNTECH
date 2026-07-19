# HANDOFF — session continuation brief (updated 2026-07-19, Phase 7 CLOSED)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> Phases 0–7 are DONE and verified (STATE.md log has all numbers).
> The next session executes **Phase 8 — 1:1 port: blob_tracker**, the LAST
> and HARDEST port, per the port template in 05-ROADMAP.md (Phases 4–8).

## Where we are

- Branch: `claude/vfx-syntech-workflow-vawwx9`, restarted from `origin/main`
  after the Phase-5/6 merge. Work + push here (unless it too was merged —
  then restart the same branch name from the new `origin/main`).
- Real ports live in `src/engine/nodes/`: **analog, bokeh, anamorphic_lab,
  blob_reveal** — all parity-verified. Only **blob_tracker** remains a
  DummyNode.
- Verify suites for phases 1–7 live in `tools/verify/` (`__SCRATCH__`
  placeholder pattern). Phase 7 numbers are in the STATE.md log.
- Phase 7 established the **offscreen-2D→GL-texture** node pattern
  (`blob_reveal.ts`): run a Canvas-2D pipeline on the node's own canvases,
  upload the finished `dc` to the output texture with FLIP_Y. Reuse it.

## Phase 8 — blob_tracker: facts already gathered

- `public/effects/blob_tracker/index.html` is **~6876 lines** — by far the
  biggest. It is a **three.js r128 + many-Canvas2D hybrid**:
  - three.js `WebGLRenderer` on a canvas `glC` (line ~2424), with FLOAT/
    HalfFloat WebGLRenderTargets ping-ponged for a ripple/fluid simulation
    (SIM×SIM), OrthographicCamera, PlaneGeometry(2,2) full-screen passes.
    Also a `panelsScene/panelsRenderer` (three.js) for panel visuals.
  - Many 2D contexts, several `willReadFrequently`: `_vrFCtx` (video-react),
    `vrCtx`, `_ctMaskCtx` (contour mask), `fxOvCtx` (fx overlay),
    `panelsReadCtx`, `dCtx` (main `dc`), `pCtx` (`procCv` tracking),
    `pipCtx`, `motionCtx`, `rSrcCtx`, `capCtx`.
  - CDN: three.js from **cdnjs.cloudflare.com/ajax/libs/three.js/r128** (the
    sandbox blocks cdnjs — the `three@0.128.0` npm mirror already used by the
    other suites serves it; route-intercept cdnjs → the mirror, OR the engine
    node imports three as an npm dep per 04-SPEC).
- **04-SPEC port note (binding)**: "a 1:1 port may keep three.js rendering to
  an offscreen canvas whose output is uploaded as the node's texture, rather
  than translating every three.js pass to raw GL. 1:1 means identical output,
  not identical plumbing. (three.js becomes a real npm dependency for the
  engine — allowed by the roadmap in THIS phase.)" So: `npm i three@0.128.0`
  (Hard Rule 6 lets Phase 8 add it), build the three.js scene + the 2D
  overlays inside the node on offscreen canvases, composite to `dc`, upload
  FLIP_Y like blob_reveal.
- **Heaviest reactivity of all** (04-SPEC): dedicated audio-react gains
  (`ar-bass-gain`, `ar-mid-gain`, `ar-hi-gain`, `ar-onset-sens`) AND
  video-react (`vr-mot-sens`, `vr-cut-thr`, `vr-smooth`, `vr-srate`). Map the
  audio gains to ParamBus defaultRoutes (bass/mid→loud/hi→treble, the Phase-4
  pattern) and the video-react to the VideoAnalyzer motion/bright signals.
  Confirm against the HTML which are real vs built-in-analyser tuning
  (blob_reveal's beat-detector tuning was consolidated; do the same audit).
- Controls (04-SPEC, verify ranges in the markup): tracking (`sThr`, `sMin`,
  `sScale`, `ct-expand-sl`, `ct-smooth-sl`), optical flow (`flow-scale-sl`,
  `flow-trail-sl`), dynamics (`sDisp`, `sTurb`, `sWave`, `sDamp`, `sDmx`,
  `sFixedMax`), look (`sBri`, `sCon`, `sBgOp`, `sFxOp`, `sConnGlow`,
  `sConnOp`, `sConnSat`, `sLW`, `sGlx`, `sCamZ`), audio gains, video-react,
  camera sims (`cam-exp-sl`, `cam-iso-sl`, `cam-wb-sl`, `cam-zoom-sl`).
  Camera sims are SOURCE concerns (consolidate, like anamorphic/blob_reveal).
- It has custom text + colors (the bridge already serializes them, Phase 1).
- Canvas sizing: check the resize code (like blob_reveal's viewport-fit
  `fit()`); match the standalone's REAL canvas size before static compare.

## Phase 8 session plan (per protocol)

1. Read the HTML end-to-end (it's long — budget for it). Extract the FULL
   param table + the render pipeline (three.js passes + 2D overlays order).
2. `npm i three@0.128.0`; implement `src/engine/nodes/blob_tracker.ts`
   (three.js offscreen + 2D overlays → `dc` → FLIP_Y upload). Factory swap.
3. Audio gains → defaultRoutes; video-react → VideoAnalyzer; segmentation if
   any via shared PersonMask.
4. Parity per 06-VERIFICATION §4: static (match the standalone's real canvas
   size; the tracking BFS + optical flow are deterministic given the same
   frame — expect high corr, but the ripple sim is temporal/feedback so
   compare it behaviorally like bokeh's datamosh), behavior, chain (all 5
   real ports), regression 1/2/3/5-static/6-static/7-static, lint.
5. STATE.md flip → Phase 9 (Chain export / Master MP4); rewrite this HANDOFF
   for Phase 9; commit; push.

## Parity method (unchanged — reuse the Phase 7 suites as templates)

- Static: `__SYN` tap; pin `adaptiveRes=false`; match the STANDALONE's real
  canvas size (blob_reveal forced dc/c-* to 1280×720 via DOM ids + engine
  resScale 2/3 — do the same); pause both on the same 1080p-clip frame;
  inject the SAME mask if seg is used; settle-detect grabs; corr>0.93/
  mad<0.06 (blob_reveal hit pixel-identical 1.000 on the deterministic path).
- The standalone drives via globals (function declarations on window;
  const/let objects only through those functions). For blob_reveal the seg
  toggle/sliders were reached by DOM id + dispatch 'input'; the mask was
  injected by overriding `window.createImageBitmap` while real MediaPipe
  fired onResults (the onResults var was unreachable directly). blob_tracker
  may expose different globals — check first.
- Temporal (ripple sim / optical-flow trails): count RENDERED frames per side
  (engine `__SYN.engine.frame`; standalone: rAF-wrapper counter trick).
- ES 3.00 reserved words if you hand-write any GLSL (three.js handles its own).

## Sandbox facts (unchanged — will bite you if forgotten)

- NEVER write any repo file while a suite drives the shell page (Vite full
  reload kills the run). Stage texts in the scratchpad.
- Scratchpad rebuild: copy `tools/verify/*.js` + `sed -i
  "s|__SCRATCH__|$S|g"`; `npm pack three@0.128.0
  @mediapipe/selfie_segmentation` → extract to `$S/cdn/three/…` and
  `$S/cdn/@mediapipe/selfie_segmentation/…`; `node gen1080.js`;
  `node make-beat-wav.js`; `cp parity1080.webm $S/test.webm`.
- `page.screenshot` starves under GL load — use canvas `toDataURL`.
- Two heavy pages starve each other: close the standalone page as soon as its
  side is done (Phase 7's audio block only passed AFTER closing it); wait on
  engine state via `window.__SYN` (engine/audio/mask), not 5 s DOM timeouts.
- ChainLab racks ALL five nodes (unwired ⇒ enabled=false): wait on chain
  CONTENT, never length.
- Network: jsdelivr/cdnjs blocked → npm mirror + `context.route()`. Launch
  args: `--autoplay-policy=no-user-gesture-required
  --enable-unsafe-swiftshader`. Playwright global:
  `NODE_PATH=/opt/node22/lib/node_modules`. MediaRecorder webms have no cues
  → race seeks with ~2.5 s timeout.
- The standalone eagerly loads its CDN libs at boot; when a suite blocks the
  CDN (e.g. seg-off runs), filter the resulting `ReferenceError` out of the
  page-error gate (Phase 7 static did this for `SelfieSegmentation`; Phase 8
  will need the same for `THREE`).
- fps acceptance (≥30 @720p) is a GPU-machine criterion — sandbox is
  SwiftShader (measured ~1fps). Report honestly.
- `npm run lint` = `tsc --noEmit`. Clean before every commit.

## Protocol reminders

One phase per session; specs first; short plan; verify per 06-VERIFICATION;
STATE.md (checkboxes, log with evidence, next step) in the same commit as the
work; push with retries. Operator speaks Italian; repo docs English. Never
touch the five effect HTMLs outside the bridge blocks. ModuleIds and
`--syn-*` tokens are load-bearing.
