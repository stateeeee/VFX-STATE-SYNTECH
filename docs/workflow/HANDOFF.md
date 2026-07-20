# HANDOFF — session continuation brief (updated 2026-07-20, Phase 8 mid-flight, L1–L6 done)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`,
> and read the **`src/engine/nodes/blob_tracker.ts` header LAYER MAP** — it is
> the live authority on what is done (■/◐) vs remaining (□).
> **This session merged the branch into `main`** (operator's request), so start
> from up-to-date `main` on the SAME branch name
> (`claude/vfx-syntech-workflow-vawwx9`); if it shows as merged, restart the
> branch from the new `origin/main` per the branch policy.

## Where we are — exactly

- Phases 0–7 DONE and verified (analog, bokeh, anamorphic_lab, blob_reveal
  are real 1:1 ports; STATE.md log has all numbers).
- **Phase 8 (blob_tracker) is MID-FLIGHT — L1–L6 done.** The port lives in
  `src/engine/nodes/blob_tracker.ts` and is **temp-wired** into
  `src/engine/nodes.ts` (factory entry `blob_tracker: () => new
  BlobTrackerNode()`, with the old DummyNode line kept commented right below —
  revert to it only if you ever need the passthrough). `three@0.128.0` is a
  real dep now (package.json).
- **Done + parity-verified** (suites in `tools/verify/verify-phase8-*.js`):
  - **L1 tracker core** — base video → 320×180 detect (processForDetect γ=1.75
    → getBinary threshold+padY, invert flips the binary → findBlobs
    connected-components + minArea + circularity<0.15) → drawBlobMarker
    (square/rect/circle/corner) → drawConnections (neonLine/drawArrow) →
    computeMotion. `verify-phase8-static-L1.js` **7/7 pixel-identical**.
  - **L2 FX system** — drawFxInBlob (invert/thermal/security/liquid/
    glitch1(data)/glitch2) + drawTextFill + applyFxBg + bgFxMode branch.
    `verify-phase8-static-L2.js` **12/12** (invert+thermal pixel-identical;
    security/liquid/glitch/text behavioural).
  - **L3 edge contour** — radialContour→douglasPeucker→catmullRom + fill;
    drawBlobMarker delegates when ctMode≥1 and contour ≥6 pts.
    `verify-phase8-static-L3.js` **8/8 pixel-identical**. (Smart contour = L3b,
    still □.)
  - **L4 optical flow** — Lucas-Kanade per blob + arrows/trails.
    `verify-phase8-behavior-L4.js` **3/3** (temporal → behavioural; magnitude
    is fps-dependent, not cross-comparable). flowFeedAR deferred to L7.
  - **L5 three.js ripple** — verbatim wave-sim + displacement shaders on the
    node's own offscreen `THREE.WebGLRenderer` (float rRtA/rRtB ping-pong 512²),
    canvas uploaded as the node texture. **Operator decision (a): the mouse
    force is replaced by the reactive `rippleForce` param pre-wired to `beat`.**
    `verify-phase8-L5.js` **5/5** (ripple@force0 = pixel-identical passthrough
    corr=1.000; force displaces; field evolves; no GL errors).
  - **L6 three.js panels** — the FIXED 8-panel 3D montage (PANEL_DEFS/LBLS/VS/FS
    + SimplexNoise verbatim) on a SECOND offscreen `THREE.WebGLRenderer`
    (transparent), composited OVER dc BEFORE the ripple. **Operator decision #9:
    labels + connector lines drawn INTO dc via Canvas-2D** at the projected
    positions (not HTML/SVG — accepted non-pixel-identical deviation). Params:
    panelsEnabled/panelScale(sScale)/panelTurb/panelCamZ/panelsBgOpacity(dims the
    tracker behind the panels)/panelsLabels/panelsConnLines/mirrorPanels.
    autoMode/AR/VR panel driving deferred to L7. `verify-phase8-L6.js` **7/7**
    (panels-on Δ0.20; static@turb0 mad 0.0000; labels Δ; mirror Δ; animates;
    no GL/page errors).

## NEXT — Layer 3b (smart contour) and/or Layer 7 (reactivity + colours)

L6 is DONE (panels). Pick up L3b and/or L7, then L8 close-out. (The L6 build
notes live in the node header LAYER MAP + the STATE.md 2026-07-20 log; the
`panelsAnimate` auto/AR/VR branch was intentionally deferred here to L7.)

## Then — the rest of Phase 8

- **L3b smart contour** (ctMode=2): a NEW MediaPipe **Tasks-Vision
  ImageSegmenter** (selfie_segmenter.tflite, storage.googleapis.com, standalone
  `_ctRunSmartSeg` L4886), distinct from the shared PersonMask's
  SelfieSegmentation. Decide per 04-SPEC: map to the shared PersonMask (its
  mask is a person-confidence alpha — could feed `_ctSmartMask`) OR add the new
  dep. Currently ctMode=2 falls back to edge.
- **L7 reactivity + colours + fixedPtsMode**: the ar-* audio gains
  (`ar-bass/mid/hi-gain`, `ar-onset-sens`) and vr-* video-react
  (`vr-mot-sens`, `vr-cut-thr`, `vr-smooth`, `vr-srate`) — map to ParamBus
  defaultRoutes (bass/mid→loud, hi→treble; vr→VideoAnalyzer motion/bright),
  the Phase-4 pattern. AUDIT which ar-*/vr-* are ENABLE/AUTO toggles for
  built-in analysers the shared engines replace (consolidate those, like
  blob_reveal's beatSens/beatGap). `audioReactiveFrame`/`videoReactiveFrame`
  are the standalone drivers. **Colours**: trackerColor/connColor/vfxColor are
  currently FIXED to the standalone defaults (the number/boolean ParamSchema
  can't hold colours) — decide with the operator (hex-as-3-number-params? a
  small palette enum? leave fixed?). `fixedPtsMode` (L5472) is a "chaos
  engine" that replaces standard detection — port or consolidate.
- **L8 close-out**: reconcile the FULL param table against the control
  inventory in the appendix below (add anything still missing: connColor/sat,
  mirror toggles, etc.); write the full `verify-phase8-{static,behavior,chain}`
  suites (fold the L1–L5 checks together + regression 1/2/3/5-static/6-static/
  7-static); flip the Phase 8 checkbox; append the Phase 8 log entry; rewrite
  this HANDOFF for Phase 9 (Chain export / Master MP4).

## Verification harness — operational playbook (this WILL bite you)

- **Dev server is flaky in this sandbox** (dies on container restart, and
  sometimes spawns duplicate `tsx server.ts` procs fighting for :3000). Start
  it with the Bash tool's `run_in_background: true` (NOT `(… &)` subshells),
  then poll `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` for
  200 before running any suite. If :3000 gives 000 with procs alive, `pkill -9
  -f 'tsx server.ts'`, wait, and restart one clean instance.
- **The standalone loads THREE from cdnjs at init** — a suite that blocks the
  CDN must SERVE the three.js r128 mirror or the standalone script aborts
  before wiring `#fi-v` (its video file input). See any phase-8 suite's
  `ctx.route` (serve `$S/cdn/three/build/three.min.js` for the r128 URL, abort
  the rest). Filter `THREE is not defined` / `SelfieSegmentation is not
  defined` out of the page-error gate.
- Standalone video input is **`#fi-v`** (not #file-input). It auto-plays +
  startTracker. Force its `#dc` to 1280×720 (and the engine to resScale 2/3)
  and pause both on the same 1080p-clip frame; the standalone's DEFAULT state
  is the L1 tracker core (FX/ripple/panels/contour/flow all off).
- Drive standalone controls: sliders by id + dispatch `input`
  (sThr/sBri/sCon/sMin/sLW/ct-smooth-sl/ct-expand-sl/flow-scale-sl/…); LED
  toggles by `.click()` (fx-invert/fx-thermal/…/btn-bgfx/ct-edge/ct-fill/
  flow-on-btn/fx-panels/btn-plabels/…). Engine params by the
  `param-blob_tracker-<key>` testids (range→set value+`change`, checkbox→click).
- Scratchpad rebuild (session scratchpads don't carry over): copy
  `tools/verify/*.js` + `sed -i "s|__SCRATCH__|$S|g"`; `npm pack three@0.128.0
  @mediapipe/selfie_segmentation` → extract to `$S/cdn/three/…` +
  `$S/cdn/@mediapipe/selfie_segmentation/…`; `node gen1080.js` (parity1080.webm)
  + `node make-beat-wav.js` (beat120.wav); `cp parity1080.webm $S/test.webm`.
  Playwright: `NODE_PATH=/opt/node22/lib/node_modules`, launch args
  `--autoplay-policy=no-user-gesture-required --enable-unsafe-swiftshader`.
- Temporal/three.js layers are fps-dependent under SwiftShader → verify
  BEHAVIOURALLY (change on both sides / passthrough at rest), not pixel-exact.
  Deterministic 2D configs ARE pixel-exact (mad 0.000). fps (≥30@720p) stays a
  GPU-machine criterion.
- **Never write a repo file while a suite drives the shell** (Vite HMR reload
  kills the run) — stage suites in the scratchpad, edit the repo copies
  between runs.
- `npm run lint` = `tsc --noEmit`; clean before every commit. Two bugs this
  port already surfaced: getBinary must flip on invert; the three mirror is
  required for the standalone init.

## Protocol reminders

One layer at a time, each committed as clearly-labelled `wip(phase8)` with its
verify suite; keep the node lint-clean and the app working at every commit;
the checkbox flips to done only after the full param table + full
static/behavior/chain suites + regression. Never touch the five effect HTMLs
outside the bridge blocks. ModuleIds + `--syn-*` tokens are load-bearing.
Operator speaks Italian; repo docs English.

---

## APPENDIX — blob_tracker control inventory (extracted 2026-07-19)

Ground-truth ranges/defaults from the markup (verify against the HTML before
porting; the pipeline order still needs a full read of the ~6876 lines).

**Two three.js renderers + one 2D canvas** (line refs approx):
- `dc` (2D, `#dc`) — the main composite canvas the effect presents.
- `glC` (`#glC`) — `rRenderer = new THREE.WebGLRenderer` (~L2424): the
  ripple/fluid SIM×SIM float ping-pong (rRtA/rRtB), OrthographicCamera,
  PlaneGeometry(2,2) passes. ✅ ported (L5).
- `panels-canvas` — `panelsRenderer = new THREE.WebGLRenderer`
  (~L2506, antialias, alpha, preserveDrawingBuffer): the 8-panel 3D scene.
  ✅ ported (L6) — the node's second offscreen three renderer; labels/lines
  drawn into dc (operator decision #9). autoMode/AR/VR branch deferred to L7.

**Sliders** (id: [min..max] def step):
- Tracking: `sThr` [0..255] 127 /1 · `sBri` [-100..100] 31 /1 ·
  `sCon` [0.5..5] 2.15 /0.05 · `sMin` [10..2000] 100 /10 · `sScale`
  [0.2..3.0] 1.0 /0.05
- Contour: `ct-smooth-sl` [0..20] 5 /1 · `ct-expand-sl` [-20..20] 0 /1
- Optical flow: `flow-scale-sl` [0..10] 3 /0.5 · `flow-trail-sl` [0..10] 0 /1
- Dynamics: `sDisp` [0.002..0.04] 0.013 /0.001 · `sTurb` [0..3] 1 /0.1 ·
  `sWave` [0.05..0.5] 0.22 /0.01 · `sDamp` [0.96..0.999] 0.988 /0.001 ·
  `sDmx` (Glitch1) [0..30] 8 /1 · `sFixedMax` [1..10] 5 /1
- Look: `sBgOp` [0..100] 50 /1 · `sCamZ` [3..14] 7 /0.5 · `sGlx` (Glitch2)
  [0..20] 6 /1 · `sFxOp` [0..100] 100 /1 · `sConnOp` [0..100] 100 /1 ·
  `sConnSat` [0..100] 100 /1 · `sConnGlow` [0..100] 0 /1 · `sLW` [1..20] 10 /1
- Audio-react gains: `ar-bass-gain` [0..300] 100 · `ar-mid-gain` [0..300] 100 ·
  `ar-hi-gain` [0..300] 100 · `ar-onset-sens` [0..200] 100 (all /1, percent)
- Video-react: `vr-mot-sens` [0..300] 100 /1 · `vr-cut-thr` [5..100] 35 /1 ·
  `vr-smooth` [0..100] 50 /1 · `vr-srate` [1..10] 2 /1
- Camera sims (SOURCE concerns — consolidate like anamorphic/blob_reveal):
  `cam-iso-sl` [100..25600] 400 · `cam-exp-sl` [100..500000] 8333 ·
  `cam-wb-sl` [2850..7000] 5500 · `cam-zoom-sl` [1.0..10.0] 1.0

**Toggles / LED buttons**: contour mode `ct-edge`/`ct-smart`/`ct-fill` ·
`flow-on-btn`/`flow-ar-btn` · `btn-ripple` · `btn-bgfx` · `btn-dashed` ·
`btn-mirror-bg`/`btn-mirror-panels` · `btn-pconnlines`/`btn-plabels` ·
`ar-on-btn`/`ar-auto-btn` · `vr-on-btn`/`vr-auto-btn`/`vr-face-btn`/
`vr-pose-btn`/`vr-flow-btn` (video-react + face/pose detection — extra
MediaPipe-family deps to check) · colour pickers `btn-tracker-color`/
`btn-vfx-color`/`btn-panels-color` + custom text (bridge serializes these,
Phase 1) · SHELL/source: `btn-play`/`btn-loop`/`btn-webcam`/`btn-rec`/
`btn-fs`/`cam-*`.

**Params already in the node** (`blob_tracker.ts` PARAMS): threshold,
brightness, contrast, minArea, blobScale, padThresh, blobEnabled, blobShape,
blobDashed, connEnabled, connStyle, connWidth, connOpacity, connGlow (L1);
bgFxMode, fxOpacity, fxInvert/Thermal/Security/Liquid/Data/Glitch, datamosh,
glitchAmt, padX, textMode, textPadX/Y (L2); ctMode, ctExpand, ctSmooth, ctFill
(L3); flowOn, flowScale, flowTrail (L4); rippleOn, rippleForce, rippleX/Y,
rippleDisp/Damp/Wave (L5); panelsEnabled, panelScale, panelTurb, panelCamZ,
panelsBgOpacity, panelsLabels, panelsConnLines, mirrorPanels (L6). **Still to
add (L7–L8)**: connSat, mirror-bg toggle, ar-*/vr-* reactive params + routes,
colours (trackerColor/connColor/vfxColor).
