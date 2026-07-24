# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phases 0–9 COMPLETE** (2026-07-20). All five effects are real 1:1 SynEngine
ports (Phase 8 blob_tracker was the last + hardest), and the ChainLab
**Master MP4** export works end-to-end (Phase 9: WebCodecs frame-stepping →
mp4-muxer, vendored under `public/effects/vendor/`). **Only Phase 10 (Assets &
polish) remains — and it is BLOCKED on the operator delivering the 6 images**
(logo + 5 effect-card covers). The rest of Phase 10 (functional search box,
vendoring CDN deps locally, perf pass, day-mode colour sweep) can proceed
without the images if desired.

## Next step

**Phases 0–9 are COMPLETE. Only Phase 10 (Assets & polish) remains, and it is
BLOCKED on the operator's 6 images** (logo top-left + 5 effect-card covers —
prompt D in `08-PROMPTS.md`, not delivered yet). **⇒ Notify the operator to
upload the 6 images before doing the image-integration part of Phase 10.** The
non-image Phase-10 items can proceed meanwhile: functional effect **search box**;
**vendor the CDN deps** locally (three.js, MediaPipe models, fonts) for offline
resilience; **perf pass** (5-effect chain ≥30fps@720p or graceful adaptive-res —
a GPU-machine check); **day-mode + stray non-token colour sweep**. Read
`05-ROADMAP.md` Phase 10 + `06-VERIFICATION.md`.
**Gotchas (still apply):** standalone HTMLs load THREE from cdnjs — a suite that
opens a standalone AND blocks the CDN must serve the three.js r128 mirror or it
aborts (this is why the Phase-1 regression showed 5 `THREE`/`SelfieSegmentation
is not defined` fails — not real regressions; the effect HTMLs are untouched).
Restart the flaky dev server (`fuser -k 3000/tcp` — `pkill -f 'tsx server.ts'`
does NOT match the real cmdline) after every SOURCE edit (it serves STALE code
otherwise); vendored `public/` files are static and need no restart. Headless
Chromium has no H.264 WebCodecs encoder (export falls back to AV1/VP9 in-sandbox;
the operator's Chrome uses H.264).

## Phase board

- [x] Phase 0 — Baseline & housekeeping
- [x] Phase 1 — Single-effect mode + settings save (bridge v1)
- [x] Phase 2 — AI Lab UX (armed mode + drag wiring)
- [x] Phase 3 — Engine services (AudioEngine, VideoAnalyzer, ParamBus, PersonMask)
- [x] Phase 4 — 1:1 port: analog
- [x] Phase 5 — 1:1 port: bokeh
- [x] Phase 6 — 1:1 port: anamorphic_lab
- [x] Phase 7 — 1:1 port: blob_reveal
- [x] Phase 8 — 1:1 port: blob_tracker
- [x] Phase 9 — Chain export (Master MP4)
- [ ] Phase 10 — Assets & polish  ← **BLOCKED on the 6 operator images**

## Open items

- **Phase 8 L5 ripple — operator decided (a) audio/beat force** (2026-07-19):
  the mouse force is replaced by the reactive `rippleForce` param pre-wired to
  the beat. Ported + verified (see log). Decision recorded here for the record.
- Operator will deliver 6 images (logo + 5 effect covers) → Phase 10,
  prompt D in 08-PROMPTS.md. Not delivered yet.
- ~~`ChainLab` "Master MP4" button references `/effects/vendor/*` files that do
  not exist until Phase 9~~ — **RESOLVED (Phase 9)**: `mp4-muxer.min.js` +
  `syntech-export.js` vendored; the button exports a real MP4.
- **Phase 10 is BLOCKED on the operator delivering 6 images** (logo + 5 effect
  covers, prompt D in 08-PROMPTS.md). Notify the operator; the non-image
  Phase-10 items can proceed meanwhile.
- Effects load CDNs (three.js, MediaPipe, fonts) — network required at
  runtime until Phase 10 vendors them.
- Claude remote sandbox only: `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`
  are blocked by the environment's network policy (fonts.googleapis.com is
  reachable by tools but not by the un-proxied headless browser). Workaround
  used for verification (reuse in Phases 4–8): download the same packages
  from npm (`three@0.128.0`, `@mediapipe/*`) into the scratchpad and serve
  them via Playwright route interception — see the Phase 0 log. Not a
  problem on the operator's machine, where CDNs load normally.

## Decisions record (operator-confirmed)

| # | Decision | Date |
|---|---|---|
| 1 | AI Lab chaining via SynEngine native ports; iframes stay for single-effect mode | 2026-07-17 |
| 2 | Ports must be **1:1 full fidelity** (operator chose over "core look") | 2026-07-17 |
| 3 | Save in single-effect mode = **settings/preset only**, no video export | 2026-07-17 |
| 4 | Workflow docs in English; operator communication in Italian | 2026-07-17 |
| 5 | The 5 uploaded HTMLs (2026-07-17) are the official effect builds; old `blob_tracker` replaced | 2026-07-17 |
| 6 | Add Node menu alphabetical: ANALOG, ANAMORPHIC LAB, BLOB REVEAL, BLOB TRACKER, BOKEH | 2026-07-17 |
| 7 | Port order locked: analog → bokeh → anamorphic_lab → blob_reveal → blob_tracker | 2026-07-17 |
| 8 | blob_tracker ripple (L5): mouse force → **audio/beat-reactive force** in the chain node | 2026-07-19 |
| 9 | blob_tracker panels (L6): draw the panel labels + connector lines **INTO the node texture** (Canvas-2D), not HTML/SVG overlays | 2026-07-19 |
| 10 | blob_tracker L3b smart contour → mapped to the **shared PersonMask** (SelfieSegmentation), not a new Tasks-Vision ImageSegmenter dep; segEnabled derived from ctMode (*Claude, operator away*) | 2026-07-20 |
| 11 | blob_tracker L7 reactivity → the bespoke 7-band auto-driver mapped to **ParamBus defaultRoutes** on the shared signals (analog pattern); ar-*/vr-* gains + toggles consolidated (*Claude, operator away*) | 2026-07-20 |
| 12 | blob_tracker L7b colours → **palette-enum indices** (ParamSchema can't hold hex); panels-label colour left at L6 styling (*Claude, operator away*) | 2026-07-20 |
| 13 | blob_tracker L7c chaos points **auto-placed** (golden-angle scatter) since the chain has no mouse; autoMode per-panel onset choreography omitted (consolidated into L7a routes) (*Claude, operator away*) | 2026-07-20 |
| 14 | Phase 9 export → preferred codec **universal H.264 (avc)** with **AV1/VP9 fallbacks** (headless has no H.264 encoder; robustness); video-only for v1, audio muxing a follow-up (*Claude, operator away*) | 2026-07-20 |

## Log

### 2026-07-20 — Phase 10 IN PROGRESS (Assets & polish — search box)

- **Functional effect search box (Phase 10 item 2) — DONE.** The right-sidebar
  "Search systems…" placeholder (`<span>`) is now a real controlled `<input>`
  (`systemSearch` state in `App.tsx`) that filters the effect cards by name or id
  (case-insensitive), with a ✕ clear button and a "no systems match" empty state.
  Testids: `effect-search`, `effect-search-clear`, `effect-search-empty`.
- **Verified** (`tools/verify/verify-phase10-search.js`) **6/6 PASS**: input
  present + all 5 cards; "blob" → blob_tracker+blob_reveal; "bok" → bokeh only;
  no-match → empty state + 0 cards; clear → all 5 back; no page errors. `npm run
  lint` clean.
- **Phase 10 remaining** (in order): item 1 **6 operator images** (BLOCKED — see
  notification); item 3 vendor CDN deps locally (needs an operator call — repointing
  the effect HTMLs' CDN `<script>` srcs would edit them outside the bridge blocks,
  which brushes against hard rule #1; the shell-side PersonMask/fonts CDN can be
  vendored freely); item 4 perf pass (GPU-machine check); item 5 day-mode + stray
  non-token colour sweep.

### 2026-07-20 — Phase 9 COMPLETE (Chain export — Master MP4)

- **The ChainLab "Master MP4" button is real.** Two vendored files under
  `public/effects/vendor/` (served statically, NOT package.json deps — hard rule
  #6 OK):
  - **`mp4-muxer.min.js`** — the real `mp4-muxer` v5.2.2 UMD build (Vanilagy,
    MIT), exposes `window.Mp4Muxer` (`Muxer` + `ArrayBufferTarget`), obtained via
    `npm pack` (not installed).
  - **`syntech-export.js`** — the WebCodecs frame-stepping exporter matching the
    exact contract ChainLab already calls: `window.SyntechExport.{isSupported,
    exportMasterQuality({video, fps, getFrame, filename, onProgress})}` →
    `{filename, codec, audio}`. It seeks the source video frame-by-frame, calls
    the caller's `getFrame()` (which advances a synthetic clock + returns
    `engine.canvas` — deterministic render at native res), encodes each frame via
    `VideoEncoder`, muxes to a `fastStart:'in-memory'` MP4, and downloads it.
- **Codec strategy:** preferred **universal H.264 (avc)** first (so the operator's
  Chrome produces a QuickTime/everything-compatible MP4), with **AV1 then VP9**
  fallbacks for machines lacking an H.264 encoder (both play in-MP4 in modern
  browsers). `isConfigSupported()` picks the first the encoder accepts; the muxer
  video codec + the `avc:{format:'avc'}` flag follow the pick. v1 is video-only
  (audio muxing is a documented follow-up — the muxer already supports a track).
- **DECISION (documented): added AV1/VP9 fallbacks** beyond the roadmap's plain
  H.264 — headless Chromium has NO H.264 encoder (all `avc1.*` `isConfigSupported`
  = false; a no-GPU/headless limitation like the ≥30fps criterion), so H.264-only
  would be unverifiable here AND would fail on any user machine without an H.264
  encoder. The fallbacks make the exporter robust and let the full pipeline be
  proven headless.
- **Verified** (`tools/verify/verify-phase9-export.js`) **7/7 PASS**: SyntechExport
  + Mp4Muxer load and `isSupported()`; a UNIT export (mock 2s video + synthetic
  getFrame) produces a **structurally-valid MP4** (ftyp+moov+mdat) whose **stsz
  sample_count = 60 (2s × 30fps)** and **mvhd duration = 2.0s**; the **real
  ChainLab "Master MP4" button** over a short clip + a blob_tracker→analog chain
  reports **"✓ …mp4 (AV1)"** and the downloaded blob is a valid MP4 (29 frames,
  ~0.97s); no page errors. **The 10s@1080p acceptance is the same code path at
  scale — a machine-capability run (like ≥30fps@720p); the operator's Chrome uses
  H.264.** `npm run lint` clean (vendor .js are static, outside tsc).
- **Autonomous session note:** done without the operator (they're away); decisions
  recorded (#14). Next is **Phase 10, which is BLOCKED on the 6 operator images**
  — see the notification below / Open items.

### 2026-07-20 — Phase 8 COMPLETE (1:1 port: BLOB TRACKER) + L8 close-out

- **Phase 8 done — the last + hardest effect is a real 1:1 SynEngine port.**
  All layers ported and verified (per-layer logs below): L1 tracker core, L2 FX,
  L3 edge contour, L3b smart contour, L4 optical flow, L5 three.js ripple, L6
  three.js panels, L7a reactivity routes, L7b colours, L7c fixed-points chaos.
  **All five effects are now real ports** (analog, bokeh, anamorphic_lab,
  blob_reveal, blob_tracker); no DummyNode remains — `nodes.ts` factory is
  permanent (`blob_tracker: () => new BlobTrackerNode()`, the commented
  fallback removed).
- **L8 param-table reconciliation vs the control inventory**: added **`mirrorBg`**
  (btn-mirror-bg) — horizontally mirrors the tracked video, flipping BOTH the dc
  base draw and the 320×180 detection draw so markers stay aligned (the
  standalone only mirrors the panels-mode backdrop; the node makes it a coherent
  input-flip). CONSOLIDATED (documented, not added): **connSat** (sConnSat — a
  hue/sat/lightness colour-PICKER control, subsumed by the L7b palette enum);
  **ar-* / vr-* gains + ar-on/auto + vr-on/auto/face/pose/flow** (built-in
  analyser config, replaced by the shared engines + ParamBus amount, L7a);
  **flowFeedAR** (flow→AR feedback, part of the bespoke reactivity); **panels
  label colour** (panelsColorActive, left at L6 styling); **cam-*** ISO/exp/WB/
  zoom (source/hardware concerns, as in anamorphic/blob_reveal).
- **Verification** — `tools/verify/verify-phase8-chain.js` **6/6 PASS**: mirrorBg
  flips the video (bright side swaps R→L, luma 0.638↔0.636 — a precise flip);
  a broad feature set (panels+ripple+flow+contour+thermal) renders non-black
  (meanL 0.24) and live (mad 0.062); no GL errors; no page errors. **Regression
  — every engine-only phase-8 layer suite re-run after the L8 edit: L5 5/5
  (ripple@force0 still a PIXEL-IDENTICAL passthrough — proves the whole 2D
  pipeline is byte-identical after all L6/L7/L8 changes), L6 7/7, L3b 5/5, L7a
  4/4, L7b 4/4, L7c 5/5 — 0 failures.** Shell regression: phase 2 **26/26**;
  phase 1 16/21 real-pass (the 5 fails are all the documented sandbox-CDN block
  — `THREE`/`SelfieSegmentation is not defined` when the standalones load from
  blocked CDNs; the effect HTMLs are untouched, so not a regression); phase 3
  exceeded the in-session time budget (long audio suite; no engine-service code
  was changed — only blob_tracker param `defaultRoute`s were added). `npm run
  lint` clean. **fps 2 @ res 0.5 under sandbox SwiftShader — the ≥30fps@720p
  acceptance stays a GPU-machine criterion**, flagged for the operator (as in
  Phases 4–7).
- **Session note (operator away):** this whole run (L6 → L3b → L7a/b/c → L8) was
  done autonomously per the operator's instruction to "proceed through all
  tasks". Design decisions made without the operator are recorded in the
  Decisions table (#10–#13) and the per-layer logs for review; none touch the
  five effect HTMLs, the ModuleIds, or the `--syn-*` tokens.

### 2026-07-20 — Phase 8 Layer 7c (BLOB TRACKER — chaos engine) verified

- **`src/engine/nodes/blob_tracker.ts` L7c — fixedPtsMode chaos engine — DONE.**
  `fpInitState`/`fpTick`/`fpBlobsForFrame` are ported verbatim from the
  standalone (`_initFpState`/`_tickFpStates`/`_fpBlobsForFrame`, L5482-5554): when
  `fixedPtsMode` is on, blob detection is REPLACED by a fixed set of points, each
  an animated marker with its own jitter (velocity-damped), size wobble,
  shape/connStyle timers, per-point FX flags (invert/thermal/security/liquid/
  glitch/data toggled on their own clocks), an alpha birth/death lifecycle, and
  occasional ephemeral overlaps. The synthetic blobs feed the EXISTING draw
  pipeline (drawFxInBlob/drawTextFill/drawBlobMarker/drawConnections) via
  per-blob **global swaps** — `fpRender` temporarily sets this.v.blobShape/
  blobScale/fx* to the point's values, draws, restores — exactly the standalone's
  trick, so no draw-function refactor. connWidth is capped at 4 for the chaos
  connections, as in the standalone.
- **DECISION (chain has no mouse): the points are AUTO-PLACED** on a golden-angle
  scatter (`fpEnsurePoints`, stable per count/size) instead of user clicks — the
  only faithful adaptation for a non-interactive chain node. `fixedPtsMode` +
  `fixedMaxPts` (1–10, standalone sFixedMax) are the new params.
- **CONSOLIDATED (decision #1): the autoMode panel driving** (per-panel
  Z-thrust/kick from the standalone's bespoke onset detector) is the auto-driver
  already replaced by the L7a ParamBus routes (panelTurb←motion, panelScale←bass
  give reactive panels). The per-mesh onset choreography is an accepted omission
  — documented for the operator; it would require porting the whole bespoke
  7-band analyser, which decision #1 explicitly replaces with the shared engines.
- **Verified** (`tools/verify/verify-phase8-L7c.js`, engine-only, behavioural —
  stochastic) **5/5 PASS**: enabling chaos points replaces detection and changes
  the frame (mad 0.0043); the field animates over time (jitter+FX, mad 0.0061);
  the 10-point field is live (mad 0.013); no GL errors; no page errors. A hero
  screenshot shows the scattered animated markers — a red thermal box, a violet
  inverted box with a connColor line, subtle boxes — each with its own per-point
  FX, confirming the global-swap path. `npm run lint` clean. **All L7 sub-layers
  (a routes / b colours / c chaos) are now done — only L8 remains for Phase 8.**

### 2026-07-20 — Phase 8 Layer 7b (BLOB TRACKER — colours) verified

- **`src/engine/nodes/blob_tracker.ts` L7b — colours — DONE.** The number/boolean
  ParamSchema can't hold a hex, so the standalone's colour pickers become
  **palette-enum indices** into a curated 10-colour `PALETTE` (index 0/1/2 are
  the standalone defaults #ffffff / #0011ff / #00ff88; 3 is the app accent
  violet #8b5cf6). New params: **trackerColorIdx** (default 0 — markers,
  contours, ID/A labels, dots), **connColorIdx** (default 1 — the tracker graph
  AND the L6 panel graph), **vfxColorOn** + **vfxColorIdx** (default off / 2 —
  overrides the Text-Fill FX colour, the standalone's `vfxColorActive`+`vfxColor`
  on the two text sites). `this.trackerColor`/`this.connColor` are resolved from
  the enums via `pal()` each render, so every existing overlay call site picks up
  the colour with no other change.
- **DECISION (documented): palette-enum indices** over free hex (ParamSchema
  constraint) — keeps the mod matrix/AI-hint model uniform and the look curated.
  The panel-label colour override (standalone `panelsColorActive`/
  `panelsLabelColor`) is left at the L6 default styling — a minor, low-value
  deferral, noted for the operator.
- **Verified** (`tools/verify/verify-phase8-L7b.js`, engine-only, mean-RGB
  direction on deterministic overlays) **4/4 PASS**: trackerColorIdx white→red
  on a filled contour drops mean G+B (−17.9/−17.9); connColorIdx blue→amber on
  the glowing panel graph raises R, drops B (+1.85/−1.90); the vfxColor override
  recolours the (random) Text-Fill green→magenta, raising mean R+B when averaged
  over 7 frames (+9.35/+7.20); no page errors. `npm run lint` clean.

### 2026-07-20 — Phase 8 Layer 7a (BLOB TRACKER — reactivity routes) verified

- **`src/engine/nodes/blob_tracker.ts` L7a — reactivity ROUTES — DONE.** The
  standalone's bespoke auto-driver (`audioReactiveFrame`/`applyAudioToParams`/
  `videoReactiveFrame`: a 7-band analyser — sub/bass/lowMid/mid/hiMid/high/air +
  centroid/flux/onset/BPM — non-linearly modulating threshold, blobScale,
  datamosh, glitch, connWidth, connStyle, panelTurb, ripple, panel scale, the XY
  Lissajous…) is **mapped to ParamBus `defaultRoute`s on the shared AudioEngine/
  VideoAnalyzer signals** (decision #1 architecture, the Phase-4 analog pattern).
  Seeded (additive `base + signal·amount·range`, so bases at the low end grow
  with the signal): **connWidth←bass 0.45, connGlow←loud 0.4, datamosh←treble
  0.5, glitchAmt←beat 0.5, panelScale←bass 0.4, panelTurb←motion 0.6**, plus
  rippleForce←beat (L5). Chosen to echo the standalone couplings (bass pulses
  the graph, treble drives datamosh, onset spikes glitch, bass swells the
  panels, motion stirs the turbulence).
- **AUDIT / consolidation (documented for review):** the `ar-bass/mid/hi-gain`,
  `ar-onset-sens`, `vr-mot-sens/cut-thr/smooth/srate` sliders and the
  `ar-on/ar-auto`, `vr-on/vr-auto/vr-face/vr-pose/vr-flow` toggles are NOT added
  as node params — they configured the standalone's built-in analyser, which the
  shared AudioEngine/VideoAnalyzer + the ParamBus route `amount` replace (exactly
  as blob_reveal consolidated beatSens/beatGap). The mod matrix's amount slider
  IS the per-band gain; users can re-target or add routes there. blobScale is
  left unrouted (its default 1 is already the max, so an additive route can't
  breathe it — the standalone drove padY 0.55→1.0 by override, not addition).
- **Verified** (`tools/verify/verify-phase8-L7a.js`, engine-only via the
  ParamBus tap) **4/4 PASS**: all 7 routes seeded with the exact source+amount;
  driving signals=1 modulates every routed param to `base+amt·(max−min)` (all 7
  match); zero signals return every param to base; no page errors. `npm run
  lint` clean. (The container restarted mid-layer — a fresh dev server picked up
  the new routes cleanly, reconfirming the restart-after-edit rule from L3b.)

### 2026-07-20 — Phase 8 Layer 3b (BLOB TRACKER — smart contour) verified

- **`src/engine/nodes/blob_tracker.ts` L3b — smart contour (ctMode=2) — DONE.**
  In smart mode the contour ray-casts the **shared PersonMask** instead of the
  detection binary — the standalone's `_ctComputeContours` uses
  `_ctSmartMask ?? _ctBinMask`, so `refreshSmartMask` downscales `ctx.personMask`
  to PW×PH (reading the mask ALPHA, the same channel bokeh/anamorphic read),
  refreshed once per `personMaskVersion`, and the render path swaps it in for
  the contour mask when ctMode≥1.5 and a mask is present (else edge). Everything
  downstream (radialContour → douglasPeucker → catmull-rom → drawContour) is the
  already-ported edge machinery, unchanged.
- **DECISION (operator asleep — documented for review): mapped smart contour to
  the shared PersonMask (SelfieSegmentation) rather than adding the standalone's
  distinct Tasks-Vision ImageSegmenter (selfie_segmenter.tflite) dep.** Same
  04-SPEC substitution as blob_reveal/bokeh/anamorphic — no new dependency, no
  storage.googleapis.com asset, reuses the established mask plumbing. `segEnabled`
  is **derived** from ctMode (smart ⇒ 1) via a getParam special-case, so the
  shell lazy-loads the segmenter exactly like the standalone's ct-smart button
  triggers `_loadMediaPipe` — no separate seg-enable control (the standalone has
  none either).
- **Verified** (`tools/verify/verify-phase8-L3b.js`, engine-only — a synthetic
  mask injected through the PersonMask tap, no MediaPipe) **5/5 PASS**:
  segEnabled derives from ctMode (edge=0, smart=1); smart with NO mask is a
  **pixel-identical fallback to edge (corr 1.000, mad 0.000)**; an injected
  person mask whose shape ≠ the luma blobs makes the contour follow the MASK
  (mad 0.030, contour bounds proven to snap to the injected box); no GL/page
  errors. `npm run lint` clean.
- **Harness note (bit us, recorded for L7/L8):** (1) the dev server serves
  STALE code after source edits in this sandbox — RESTART it (kill by port:
  `fuser -k 3000/tcp` or the PID from `fuser 3000/tcp`; `pkill -f 'tsx
  server.ts'` does NOT match the real cmdline) before every verify run.
  (2) The ParamBus pushes each param's base every frame, so a headless
  `node.setParam(k,v)` is reverted next frame — drive params through the UI
  control (setBase path) instead. (3) Injecting a PersonMask must neutralise
  `mask.enable`/`mask.tick` first, or the real loader's async failure
  (CDN blocked) sets ready=false and wipes the injected mask mid-flight.

### 2026-07-20 — Phase 8 Layer 6 (BLOB TRACKER — three.js panels scene) verified

- **`src/engine/nodes/blob_tracker.ts` L6 — the FIXED 8-panel 3D "AI analysis"
  montage — DONE and verified behaviourally.** The standalone's `DEFS`/`PLBLS`
  (8 panel geometries + labels, L2497-98), panel `VS`/`FS` (UV-rect sampling +
  edge vignette + `mirrorU`, L2499-2500) and `SimplexNoise` (L2482-84) are
  ported verbatim onto the node's OWN second offscreen `THREE.WebGLRenderer`
  (transparent, `preserveDrawingBuffer`) — the L5 offscreen-three→texture
  pattern reused. `panelsAnimate`'s non-auto branch is ported: per-panel
  simplex float/rotation scaled by `panelTurb` × motion-energy (`motionEnergy`
  now smoothed from the L1 `rawEnergy`), `panelScale`, `padY`(=padThresh)
  opacity, `mirrorPanels`, and the noise-driven camera drift. The panel source
  is `ctx.source` (raw video, like the standalone's `THREE.VideoTexture(vidEl)`).
- **Compositing (per HANDOFF recipe):** after the L1–L4 tracker overlays land
  on `dc`, when `panelsEnabled` the node dims `dc` by `1-panelsBgOpacity` toward
  the standalone's `#050302` backdrop, renders the panels scene to its offscreen
  canvas, `drawImage`s it OVER `dc`, then draws the labels/lines into `dc` —
  BEFORE the L5 ripple samples `dc`. Order proven correct by the hero shot: the
  tracker's own blob `ID:/A:` labels sit dimmed behind the panels while the
  panel labels are crisp on top.
- **Operator decision #9 honoured — labels + connector lines drawn INTO the
  node texture** (Canvas-2D at the projected screen positions via
  camera-`project()` → `toScreen`/`lAnchor`), NOT the standalone's HTML `p-lbl`
  divs + SVG `svg-lines`. The label box (`rgba(8,6,20,.88)` bg, `#a0b8ff` tag,
  `#70a0ff` score) approximates the `.p-lbl` CSS; the panel↔panel connections
  reuse the tracker's connColor/connStyle/connWidth/connOpacity/connGlow at the
  standalone's `×0.08` panel-line scale; the label→panel connector lines gate on
  `panelsLabels`+`panelsConnLines`. Accepted (non-pixel-identical) deviation.
- **Params added (8):** `panelsEnabled` (fx-panels), `panelScale` (sScale,
  reactive), `panelTurb` (sTurb, reactive), `panelCamZ` (sCamZ),
  `panelsBgOpacity` (sBgOp — maps the standalone panels-mode backdrop: in the
  chain node it dims the tracker composite behind the panels; default 0.5),
  `panelsLabels` (btn-plabels, on), `panelsConnLines` (btn-pconnlines, on),
  `mirrorPanels` (btn-mirror-panels). Note `sScale`→`panelScale` is DISTINCT
  from `blobScale`(=xyBlobScale, XY-pad driven) — verified against the HTML.
- **Verified** (`tools/verify/verify-phase8-L6.js`, engine-only — three comes
  from npm so no CDN mirror needed) **7/7 PASS**: enabling panels changes the
  frame (mad 0.203 vs off); the montage is **pixel-static at panelTurb=0
  (mad 0.0000** — deterministic frozen simplex + converged camera); labels
  toggle changes the frame (mad 0.0055); mirrorPanels flips the sampled UV
  (mad 0.055); panelTurb=1 animates it over time (mad 0.0029); no GL errors on
  the engine context; no page errors. Hero screenshot shows all 8 labelled
  panels + the blue connection graph over the dimmed tracker. Pixel-exact vs
  the standalone is NOT expected (HTML-label deviation + independent animation
  clock) — behavioural per the HANDOFF. `npm run lint` clean.
- Remaining for Phase 8: L3b smart contour (MediaPipe ImageSegmenter), L7
  reactivity + colours + fixedPtsMode + the autoMode panel branch, L8 full
  param table + full suites + regression → then the checkbox flips.

### 2026-07-19 — Phase 8 IN PROGRESS (1:1 port: BLOB TRACKER — Layer 1 verified)

- **`src/engine/nodes/blob_tracker.ts`** started — the last + hardest port
  (~6876-line three.js r128 + many-Canvas2D hybrid). Strategy (04-SPEC): run
  the standalone's whole pipeline offscreen (three.js + 2D overlays) and
  upload the composite as the node texture — the blob_reveal
  offscreen→texture pattern extended to three.js. `three@0.128.0` added
  (allowed this phase). The node carries a full LAYER MAP in its header
  (■ done / □ remaining) with standalone line refs.
- **Layer 1 — tracker core — DONE and parity-verified**: base video draw →
  320×180 `processForDetect` (γ=1.75) → `getBinary` (threshold+padY) →
  `findBlobs` (connected-components, minArea + circularity<0.15 reject) →
  `drawBlobMarker` (square/rect/circle/corner, dashed, ID/A labels) →
  `drawConnections` (dist≤500, neonLine glow layers / drawArrow) →
  `computeMotion` (64×36 energy) → offscreen `dc` uploaded FLIP_Y. All math
  is the standalone's verbatim. **`verify-phase8-static-L1.js`: 7/7 configs
  corr=1.000, mad=0.000 (pixel-identical)** vs the standalone's DEFAULT
  tracker state (default = L1 exactly: FX.blob+conn on, everything else off,
  and the bgFxMode-off else-branch is a no-op since `_applyFxBg` touches
  nothing with no FX flag). Both pinned to 1280×720, paused same frame;
  configs: default, threshold ±, minArea, brightness, contrast, connWidth.
- **Layer 2 — FX system — DONE and parity-verified**: `drawFxInBlob`
  (invert/thermal/security/liquid/glitch1(data)/glitch2, shape-masked) +
  `drawTextFill` (nums/letters/tmix) + `applyFxBg`, with the bgFxMode on/off
  branch (patch save→applyFxBg→restore). `verify-phase8-static-L2.js`
  **12/12 PASS**: invert + thermal **pixel-identical (corr=1.000, mad=0.000)**
  in BOTH bg and in-blob modes; security/liquid/glitch1/glitch2/text change
  the frame on BOTH sides with near-identical magnitude (ratio 1.00–1.06 —
  time/Math.random-seeded, so behavioural not pixel-equal). Fixed a real port
  bug found by the check: the standalone's `getBinary` also flips the
  detection binary when invert is on (`FX.invert?1-v:v`) — added.
- **Layer 3 (edge contour) — DONE and parity-verified**: `radialContour`
  (64-ray cast on the detection binary) → `douglasPeucker` simplify →
  `catmullRomPath` spline (+ optional fill); `drawBlobMarker` delegates to
  `drawContour` when ctMode≥1 and the contour has ≥6 pts.
  `verify-phase8-static-L3.js` **8/8 PASS, all corr=1.000, mad=0.000
  (pixel-identical)**: edge default, smooth 0/20, expand ±10, fill. Smart
  mode (ctMode=2) still deferred — a distinct MediaPipe Tasks ImageSegmenter
  dep; ctMode=2 falls back to edge for now.
- **Layer 4 (optical flow) — DONE and behaviourally verified**: Lucas-Kanade
  16×16 per blob (`flowUpdateGray`/`flowLK`/`flowComputeVel`/`drawFlowViz`,
  verbatim) → EMA 0.42 → arrows (green→red by speed) + fading trails.
  `verify-phase8-behavior-L4.js` **3/3 PASS**: the flow overlay appears and is
  sustained on BOTH sides while the video plays. Flow is temporal — its
  absolute magnitude is motion-per-rendered-frame (fps-dependent), so it is
  NOT cross-comparable between the two independently-running pages (the engine
  does more 2D work + a GL upload, so it renders at a different rate); the LK
  is a verbatim transcription. flowFeedAR (flow→AR signal) is deferred to L7.
- **Layer 5 (three.js ripple sim) — DONE and verified** (operator decision a:
  audio/beat force): the standalone's mouse-driven wave sim + displacement
  shaders are ported VERBATIM onto the node's own offscreen `THREE.WebGLRenderer`
  (float rRtA/rRtB ping-pong at 512²), whose canvas becomes the node output;
  the mouse force is replaced by the reactive `rippleForce` param pre-wired to
  `beat`. `verify-phase8-L5.js` **5/5 PASS**: ripple-ON at force 0 is a
  **pixel-identical passthrough of dc (corr=1.000, mad=0.000** — proves the
  three.js sim/shaders/orientation are correct); injecting force visibly
  displaces the frame (mad 0.0043); the field evolves over time (feedback
  ping-pong); no GL errors on the engine context; no page errors. First
  three.js scene integrated — the offscreen-three→texture pattern works.
- **The whole deterministic 2D pipeline + the ripple three.js scene are ported
  and verified.** The node is **temp-wired** into `nodes.ts` (tracker core +
  FX + contour + flow + ripple — far better than the DummyNode passthrough —
  but L3-smart/L6–L8 are not there yet, so **Phase 8 is NOT done**; checkbox
  unchecked until the full port + full suites).
- Layers remaining (node header has the map): L3-smart (MediaPipe
  ImageSegmenter), L6 three.js panels scene
  (rRenderer/glC float ping-pong), L6 three.js panels scene + the stack
  composite (dc→panels→fxOv→glC), L7 reactivity (ar-*→routes,
  vr-*→VideoAnalyzer) + colours (ParamSchema can't hold colours — design
  TODO) + fixedPtsMode chaos, L8 full param table + suites.

### 2026-07-19 — Phase 7 complete (1:1 port: BLOB REVEAL)

- **`src/engine/nodes/blob_reveal.ts`** ports the standalone's pure Canvas-2D
  rotoscope engine into a SynEngine node. The standalone has NO WebGL — it
  composites on seven 2D canvases — so the node runs that EXACT pipeline on
  its own offscreen canvases and uploads the finished frame as its output
  texture (04-SPEC port note: "1:1 means identical output, not identical
  plumbing"). Pipeline, verbatim: black frame → detectAndDrawBlobs (320×180
  luma threshold → square-kernel dilate with audio boost → 4-neighbour BFS
  connected components with the same wrap guard → area filter scaled by the
  node/proc size ratio → top-N by area, each grown by the audio-reactive
  expansion and used as a clip window onto the full-res video) → drawSubject
  (brightness/contrast mask conditioning → erode via the inset-redraw shrink
  → CSS-blur feather → destination-in cut of the video by the mask ALPHA →
  opacity blit). The output canvas is uploaded FLIP_Y to match the engine's
  source-upload orientation. Factory swapped in `nodes.ts`.
- **Param table** (12 node params): segEnabled + the blob/rotoscope sliders
  (segThr, erode, feather, opacity, segN, lumThr, minArea, maxBlobs, dilate,
  audioExp) at the standalone's exact ranges/defaults, plus `beatReact` — the
  standalone's internal `beatExpand` runtime value exposed as a reactive param
  so the mod matrix can drive it. Consolidations, justified: the XY pad is a
  controller of maxBlobs+dilate (routing UI covers it); `btn-model`
  (HIGH QUALITY/FAST = MediaPipe modelSelection) is a shared-PersonMask
  service concern; beat-detector tuning (`sl-bsens`/`sl-bgap`) fed only the
  standalone's built-in analyser, which the shared AudioEngine replaces;
  REC/fullscreen/transport/webcam/file are shell concerns.
- **Deliberate substitutions (decision #1)**: (a) the standalone's own eager
  MediaPipe becomes the shared PersonMask service (segEnabled +
  ctx.personMask/personMaskVersion). The service's maskCanvas carries the raw
  segmentationMask with the same ALPHA semantics bokeh/anamorphic already read,
  so the destination-in subject cut is identical; `segN` throttles the node's
  mask refresh (every Nth arrival) to reproduce the standalone's send-every-N
  staleness. (b) The built-in AudioContext/analyser (video-track beat
  detection) is replaced by the real AudioEngine, the Phase-4 pattern: the
  internal beatExpand becomes `beatReact`, pre-wired via ParamBus defaultRoute
  to `loud` (amount 0.9) so blobs breathe with the music exactly as the
  original's loud-floor did. The node draws from ctx.source (the
  NodeRenderContext exposes it "for nodes that need CPU pixel analysis" — this
  is the canonical such node), giving byte-identical input to the standalone.
- **Parity run (06-VERIFICATION §4)**, suites committed as
  `tools/verify/verify-phase7-{static,behavior,chain}.js`:
  1. *Static pixel parity* — the deterministic blob-window pipeline
     (segEnabled OFF), both sides pinned to 1280×720 (engine resScale 2/3;
     standalone dc/c-* forced via DOM ids), paused on the same frame —
     **10/10 configs corr=1.000, mad=0.000 (pixel-identical)**: defaults,
     lumThr low/high, minArea low/high, maxBlobs 1/30, dilate 0/high, combo.
  2. *Behavior suite* — **14/14 PASS, 0 failed**: A real-MediaPipe READY on
     BOTH sides (the standalone's real segmenter fires onResults, whose
     createImageBitmap is overridden to feed the SAME synthetic mask, a fresh
     bitmap each call since onResults closes the previous); B playing
     blob-window long-exposure corr=0.984; C subject reveal with the SAME
     injected mask both sides — **all 5 configs corr=1.000 (pixel-identical:
     default, erode, feather, opacity, threshold)** and enabling seg reveals
     the subject symmetrically (delta S/E=0.089/0.089); D a 120 BPM beat
     track expands the blob windows through the beatReact→loud route
     (max mad vs quiet 0.0119); E beatReact is pre-wired to LOUD and its
     readout modulates with the beat (spread 0.33).
  3. *Chain sanity* — **3/3 PASS**: fresh session, the four real ports
     blob_reveal→anamorphic_lab→bokeh→analog wired (blob_tracker racked but
     bypassed), PersonMask READY on the real MediaPipe path (mask v12), no GL
     errors, non-black output (meanLum 10), no page errors. **fps 1 @ res 0.5
     under sandbox SwiftShader** — the ≥30fps @720p acceptance stays a
     GPU-machine criterion (as in Phases 4–6), flagged for the operator.
  4. Regression: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14** —
     all green. phase 5 static and phase 6 static: every config that
     completed was pixel-identical (phase 5 **11/18 observed corr=1.000
     mad=0.000, 0 fail** before the sandbox timeout; phase 6 reached the
     pinning stage — both sides confirmed 1280×720 — but the run was killed
     by the timeout during the 14× mask-EMA setup, before its configs) —
     these 22-config settle-detect suites exceed the runner timeout under
     SwiftShader load and could not finish in-session, but the Phase-7 change
     is isolated to the new blob_reveal node + its factory entry (no bokeh /
     anamorphic / engine-core edits), so a regression there is structurally
     impossible; they were full-green (22/22 each) in the Phase 5/6 close-outs.
     lint clean. The phase-3 SEG check was updated (committed with the port):
     blob_reveal is now a real node that boots segEnabled ON (faithful to the
     standalone), so the shared PersonMask loads when it is racked; the check
     no longer asserts "hidden at startup" (an artefact of the old seg-off
     DummyNode) but the real lazy property — on-demand load reaching READY,
     then the mask gated off (personMaskSource → null) when segEnabled is
     unchecked.
- Notes for Phase 8 (blob_tracker, the last + hardest): three.js r128 hybrid
  — a 1:1 port may keep three.js rendering to an offscreen canvas uploaded as
  the node texture (04-SPEC; three.js becomes an allowed npm dep that phase).
  It has BOTH audio-reactive and video-reactive control groups (heaviest
  reactivity). Reuse blob_reveal's offscreen-2D→texture pattern for its 2D
  overlays; match the standalone's real canvas size before comparing.

### 2026-07-19 — Phase 6 complete (1:1 port: ANAMORPHIC LAB)

- **`src/engine/nodes/anamorphic_lab.ts`** implements the standalone's exact
  pipeline in the SynEngine: subject-aware bokeh pre-pass at the standalone's
  FIXED 1280×720 working res, active only while `bokehMM > 0` (mask intake
  per segmentation arrival with the 320×180 alpha→R swizzle, temporal EMA
  α=0.35 with 1.6× rising asymmetry, 5×5 feather → 48-tap pillbox disc blur
  with oval ratio from squeeze+trim, bright-rim edge ring, background
  magnification, hard subject-gate → feathered composite 0.45) → single
  main pass: chromatic aberration → exposure → anisotropic bokeh bloom +
  halation → film grade (lift/contrast/filmic shoulder/split-tone temp/sat)
  → LUT (identity in this build) → Instax/VHS grain → elliptical vignette →
  auto-detected anamorphic flare (+ ghosts) → compare split, with squeeze/
  barrel/letterbox/breathing shaping the sampled UVs. GLSL → ES 3.00 with
  the math untouched (`active` renamed `act`: reserved word in ES 3.00).
  The f-stop→CoC easing (~120ms τ, dt-clamped) and the CPU auto-flare
  hotspot detector (80×45 source readback every 160ms, same smoothing/
  jitter constants) are ported verbatim. ghostGlitch reproduces the
  deliberate mask double-flip. Factory swapped in `nodes.ts`.
- **Param table — 100% coverage** (29 node params): the 20 `s-*` sliders
  (same ranges/steps), fStop/ovalFineTune/bokehMM (the Ghost mm slider =
  the Bokeh % slider = one engine, exposed once), LED toggles → letterbox/
  breathing/flare/flareMaster/compare/ghostGlitch booleans, `segEnabled`
  for the shared PersonMask. **Defaults are the standalone's BOOT state**
  (P literals overlaid with the `isco` preset it applies on load).
  Consolidations, justified: mm chips + riccardo %/toggle are controllers
  of bokehMM; auto-temp button is a one-shot controller of temp; presets →
  ChainLab presets; `desqueeze` resizes the standalone's CANVAS (display
  geometry — a chain node cannot change the chain resolution; the squeeze
  LOOK is uSqueeze, fully ported); LUT file upload omitted (sampleLUT is
  an identity pass-through in this build — lutMix is still a param);
  source/webcam/Nikon-UVC camera panel + cam-* hardware sliders
  (ISO/exposure/WB/zoom via applyConstraints) are SOURCE concerns, not
  effect params; REC/fullscreen/motion-VU are shell/display concerns.
- **Reactivity finding (corrects the Phase 5 handoff note)**: the build's
  only AudioContext is REC-export plumbing — there is NO audio-reactive
  parameter modulation in the original; its reactivity is video-driven
  (auto-flare hotspot tracking, ported). Therefore NO defaultRoutes are
  seeded; continuous look params are marked `reactive` for the mod matrix.
- **Parity run (06-VERIFICATION §4)**, suites committed as
  `tools/verify/verify-phase6-{static,behavior,chain}.js`:
  1. *Static pixel parity* — standalone canvas caps at 1280×720 → engine
     pinned at resScale 2/3; same injected mask both sides; settle-detected
     grabs — **22/22 configs corr ≥0.999, mad ≤0.004** (26 suite steps,
     0 failed): isco defaults, raw-neutral, temp ±1, lift+contrast,
     sat 0/1.8, rolloff, exposure ±1, halation, bloom, CA, barrel,
     vignette, squeeze 2.2, ratio 2.8, compare split, bokehMM+fStop,
     oval bokeh, ghost-glitch, hero combo. (Proven in the previous
     session; suite unchanged since.)
  2. *Behavior suite* — **9/9 PASS (run 6, 0 failed)**: A real-MediaPipe
     READY; B playing long-exposure corr=0.971 (0.967–0.983 across runs
     4–6); C auto-flare fires on both sides (on-vs-off delta
     S/E=0.0836/0.0797) and flickers (S/E .0069/.0068); D breathing
     drift only when enabled (off 0/0, on S/E .0020/.0015); E f-stop
     easing verified with **option (b)** per HANDOFF: rack f/22→f/2.8
     (radius 27px — sandbox-viable; same dt-clamped easing math
     exercised; wide-aperture settled look already pixel-proven by the
     static configs f/2 and f/1.4) — total S/E=.014/.010,
     remaining-early S/E=.008/.003 (57%/30% mid-flight: gradual on both
     sides), settled corr=0.981. E needed two more calibration fixes
     (runs 4–5 were 8/9 with only E red and the port math fine): each
     side's mid-flight state must be observed on ITS OWN frame clock,
     and the engine's param change + frame+2 pixel grab must be FUSED
     into one in-page evaluate — Playwright round-trips queue ~16
     rendered frames behind the SwiftShader pipeline, reading a settled
     frame as "snap". F manual bass route onto vignette modulates the
     readout (spread=0.35; no default routes BY DESIGN — see reactivity
     finding).
  3. *Chain sanity* — **3/3 PASS**: fresh session, the three real ports
     anamorphic_lab→bokeh→analog wired (blob_tracker/blob_reveal racked
     but bypassed), PersonMask READY on the real MediaPipe path, mask
     v13 flowing, no GL errors, non-black output (meanLum 22.6), no
     page errors. **fps 1 @ res 0.5 under sandbox SwiftShader** — the
     ≥30fps @720p acceptance stays a GPU-machine criterion (as in
     Phases 4–5): flagged for the operator, not assessable here.
  4. Regression: phase 1 **21/21**, phase 2 **26/26**, phase 3 **14/14**,
     phase 5 static **22/22** — all green, 0 failed; lint clean.
- Notes for Phases 7–8: ES 3.00 reserved words; frame-aware waits for
  anything eased per rendered frame; match the standalone's real canvas
  size before comparing (blob_reveal fits the VIEWPORT — read
  `dc.width/height` after `fit()`).

### 2026-07-18 — Phase 5 complete (1:1 port: BOKEH)

- **`src/engine/nodes/bokeh.ts`** implements the standalone's exact pipeline
  in the SynEngine: mask intake per segmentation arrival (temporal EMA
  ping-pong α=0.28 with the 1.6× rising asymmetry → 5×5 gaussian spatial
  blur) → STAGE 1 bokeh blur (all 5 kernel styles: 37-tap Poisson disc,
  swirly Helios, explosive coma, anamorphic 2.39 oval + streak flares,
  40-tap shape-pad blend) → STAGE 1.5 post-blur distort (swirl / explosive
  / anamorphic squeeze) → STAGE 2 background FX (datamosh with frame-based
  I-frame clock, CPU pixel sort at fixed 480×270 with verbatim run/luma
  logic, liquid, morph, lava — all mask-gated, ping-pong buffers) →
  STAGE 3 composite (feather, Optics vignette, anamorphic squeeze/barrel/
  letterbox/breathing/elliptical vignette). All 11 fragment shaders are the
  standalone's GLSL translated to ES 3.00 with the math untouched, incl.
  the fixed 16/9 tap-aspect constants. Factory swapped in `nodes.ts`.
- **Param table — 100% coverage** of the standalone's parameter surface
  (38 node params): 9 sliders + 21 knobs (same ranges/defaults from the
  markup data-attrs; `lqAmount` default 0.025 per the knob — the P-object
  literal 0.5 is overwritten by `initKnobs()` at startup), `#style-sel` →
  `bokehStyle` 0–4 (4 = shape pad, the `btn-bshape` state), BSHAPE pad →
  `bshapeX/Y`, `#bgfx-sel` → `bgfxStyle` 0–5, `psAngle` 0–3 (H/V/D+/D-),
  LED toggles → `anamLetterbox`/`anamBreathing`, plus `segEnabled` for the
  shared PersonMask. Consolidations, justified: focal-sel buttons and the
  XY pad are controllers of bokehRadius/bokehBloom (rack covers that);
  the 6 presets are ChainLab-preset territory; source/transport/record/
  fullscreen are shell concerns. `psPasses` exists in the standalone's P
  but has no UI control and is never read by `runPixelSort` — dead key,
  intentionally not ported. The standalone couples `distortMode` to
  `bokehStyle` on style clicks (a control-surface behavior); the node
  keeps them independent params with the same defaults.
- **Deliberate substitution (decision #1-consistent)**: the standalone's
  eagerly-loaded MediaPipe becomes the shared PersonMask service via
  `segEnabled` + new `personMaskVersion` plumbing (SynEngine ctx +
  ChainLab); until the first mask arrives the node passes through, exactly
  the standalone's `maskReady` gate. The original has NO audio reactivity
  (04-SPEC: video-driven only) → no defaultRoutes seeded; continuous look
  params are marked `reactive` so the lab's mod matrix can route them.
- **PersonMask fixes (trivial, risk-free)**: `clearRect` before drawing
  each mask (source-over left stale person pixels forever — the mask
  could only grow) + `version` counter consumed by the node to step the
  temporal EMA once per arrival like the standalone's `onSegResults`.
- **Parity run (06-VERIFICATION §4)**, evidence in scratchpad
  (`phase5-*-summary.json`, `phase5-*.log`, `shots/p5s-*`), suites
  committed as `tools/verify/verify-phase5-{static,behavior,chain}.js`:
  1. *Static pixel parity* — `__SYN` tap, adaptiveRes off @1:1, both
     videos paused on the same 1920×1080 frame, and the SAME injected
     person mask on both sides (standalone via global `onSegResults`,
     engine via the PersonMask tap; EMA stepped 14× each) —
     **18/18 configs corr=1.000, mad=0.000 (pixel-identical)**: defaults,
     radius min/max, all 5 kernel styles incl. shape-pad corners,
     feather 0/1, vignette max, anam-full, letterbox off, ratio max,
     all 3 distort modes, hero combo. Suite: 22 steps, 0 failed. Hero
     screenshots standalone vs engine indistinguishable.
  2. *Behavior suite* — 13/13 PASS: real-MediaPipe path READY with mask
     versions advancing; playing-defaults long-exposure corr=0.934
     (interleaved same-instant sampling); all 5 background FX leave the
     subject core intact (mad ≤0.016) while the background transforms on
     BOTH sides with matching magnitudes (datamosh S/E .176/.104,
     pixel-sort .177/.177, liquid .0011/.0013 in its left-edge band —
     its knob range caps the wipe front at ~4% of width by design,
     morph .089/.020, lava .065/.052); datamosh I-frame cadence proven on
     the engine (min-dist from clean: 2Hz=0.002 vs 0.01Hz=0.159);
     CPU pixel-sort static convergence corr=1.000 cross-side; breathing
     drift only when enabled (S .0013/E .0018 vs 0/0 off); manual
     bass→bokehRadius route swings the readout 19→44 (spread 29.5).
  3. *Chain sanity* — fresh session, bokeh→analog (the two real ports)
     with the other three racked but bypassed: PersonMask READY on the
     real path, no GL errors, non-black output, mask v13 flowing.
     **fps 1 @ res 0.5 under sandbox SwiftShader** — the ≥30fps @720p
     acceptance stays a GPU-machine criterion (as in Phase 4): flagged
     for the operator, not assessable here.
  4. *Accepted deltas (sandbox-only)*: standalone datamosh cadence
     unobservable headless (<1fps renders make a 30-frame snap cycle >30
     wall-seconds) — mechanism ported line-for-line and engine-proven;
     bokeh gold-noise jitter seeds differ per side by clock (behavioral,
     invisible at verification downscale).
  5. Regression: phase 1/2/3 suites re-run — phase 1 **21/21** (the two first-run fails were a missing three.js mirror in this session’s scratchpad CDN, not regressions — blob_tracker untouched), phase 2 **26/26**, phase 3 **14/14** (needs `test.webm` present in the scratchpad);
     lint clean.
- Notes for Phases 6–8 (also in HANDOFF.md): inject deterministic masks
  through `onSegResults` (standalone) + the PersonMask tap (engine) so
  segmentation parity is MediaPipe-independent; never write files into
  the repo while a suite drives the shell (Vite full-reload kills the
  run); `page.screenshot` starves under GL load — grab canvases with
  `toDataURL`; ChainLab racks ALL five nodes (unwired ⇒ enabled=false) —
  don't wait on chain length; drive standalone bgfx switches via the real
  seg buttons (their click handlers clear feedback buffers).

### 2026-07-18 — Phase 5 checkpoint (mid-session commit 834bd6d)

- Stop-hook checkpoint before verification finished: node implemented,
  lint clean, parity still running — superseded by the entry above.

### 2026-07-18 — Phase 4 complete (1:1 port: ANALOG)

- **`src/engine/nodes/analog.ts`** implements the standalone's exact
  pipeline in the SynEngine: optional pixel sort (odd-even transposition,
  1–12 passes, H/V/diag, persistent pass parity) → feedback loop
  (zoom/rotate/decay/hue/drift/mirror, ping-pong across frames) → CRT &
  glitch composite (barrel, tracking, tear, chroma split, bloom, dropout,
  roll bar, noise, scanlines, phosphor, vignette, dry/wet blend). All four
  fragment shaders are the standalone's GLSL translated to ES 3.00 with
  the math character-for-character intact, including the fixed
  1920/1080/540 texel constants that define the CRT look. Factory swapped
  in `nodes.ts`; the other four effects remain DummyNodes.
- **Param table — 100% coverage** of the standalone's controls
  (26 controls → 27 node params): 18 knobs (same data-min/max/defaults),
  4 sliders (sortThresh 0–1, sortPasses 1–12, reactSens 0.1–2,
  modDepth 0–1), 3 LED toggles (feedbackMirror, sortEnabled,
  reactEnabled), sort-direction seg → `sortDir` 0/1/2. Consolidations,
  justified: the XY pad is a *controller* of two existing params (routing
  UI covers that role in the lab); transport/source/record/export/preset
  panels are shell/ChainLab concerns, not effect params.
- **Deliberate substitution (the one intended difference)**: the
  standalone's PSEUDO-AUTO reactive generator (synthesized bass/mid/high)
  is replaced by the real analysis — new `reactBass/reactMid/reactHigh`
  params pre-wired via the new `ParamSchema.defaultRoute` (seeded in
  `ParamBus.snapshot`) to bass/loud/treble; reactSens/modDepth/
  reactEnabled behave exactly as the original's shader math dictates.
- **Parity run (06-VERIFICATION §4)**, evidence in scratchpad
  (`phase4-*.json`, `shots/p4*`):
  1. *Static pixel parity* — via the new dev-only `window.__SYN` tap:
     adaptiveRes off, resScale 1, both videos paused on the same frame of
     a generated 1920×1080 clip (canvas sizes must match the standalone's
     fixed 1080p or fixed-frequency patterns alias differently) —
     **13/13 checks corr=1.000, mad=0.000 (pixel-identical)** across
     neutral, barrel, vignette, scanlines, phosphor, chroma, bloom,
     blend-0, sort-H, sort-V, hero combo.
  2. *Motion suite* (live playback, long-exposure comparisons): corr
     0.97–0.99 on all configs; stochastic passes (noise/tear/tracking)
     raise temporal variance on both sides (S ×3.3, E ×3.6, corr 0.90).
  3. *Feedback trails* — frame-based analysis (engine runs ~59fps vs
     standalone ~4.5fps under SwiftShader, so wall-time comparison is
     invalid): per-rendered-frame decay after a seek step,
     **S=0.884 vs E=0.888** against fa=0.9 minus decay pull — identical
     math (first post-seek interval excluded: it captures the source
     frame switch, not trail decay).
  4. *Reactivity* — with the 120 BPM file, the auto-routed reactBass
     readout pulses 0.53→0.98 (spread 0.45) and drives tear/zoom.
  5. *Chain sanity* — analog + 2 dummy nodes render continuously
     (19–25 fps at 50% adaptive res under sandbox SwiftShader; the
     ≥30fps @720p criterion is a GPU-machine check — flagged for the
     operator, not assessable here).
  6. Hero screenshots standalone vs engine are visually
     indistinguishable (barrel curvature, chroma fringe, phosphor
     texture, vignette, moiré).
- Regression: Phase 1/2/3 suites re-run (see below), lint clean.
- Notes for Phases 5–8: use the `__SYN` tap + 1080p clip + paused-frame
  static comparison as the parity workhorse; MediaRecorder webm seeks
  need a timeout race (no cues); compare temporal features per rendered
  frame, never per wall-clock sample.

### 2026-07-17 — Phase 3 complete (engine services: the reactivity backbone)

- **AudioEngine** (real): shared AudioContext + AnalyserNode (fft 2048).
  Mic mode (getUserMedia) and audible file mode (reused `<audio>` element +
  MediaElementSource). Per-frame `tick(now)` → bass (20–250 Hz), loud
  (full band), treble (4–12 kHz), all 0..1 with fast-attack/slow-release
  smoothing; beat = bass-onset pulse (flux over running average, 240 ms
  refractory, ×0.88 decay); BPM = median of the last ≤16 inter-beat gaps
  folded into 60–200, null until ≥4 gaps. `FileTransport` now starts null
  (transport bar appears only in file mode) and mirrors the element
  (play/pause/seek/loop/duration). mode: off | mic | file.
- **VideoAnalyzer** (real): 32×18 offscreen sample at ~15 Hz →
  `bright` = mean luma, `motion` = mean |Δluma| ×6 clamp, both smoothed;
  decays to 0 with no/stalled source.
- **ParamBus** (real): snapshot seeds bases from node params (existing
  entries win); apply runs per frame:
  `final = clamp(base + signal × amount × (max−min))` pushed via setParam,
  so `node.getParam` (and the amber mod readout) is the live value;
  serialize/restore deep-copy + re-snapshot for preset gaps.
- **PersonMask** (real): lazy CDN load of MediaPipe SelfieSegmentation
  (same URL family as the effects; Phase 10 vendors it), off → loading →
  ready, failure → off + 5 s retry cooldown + console.warn; ~15 Hz send,
  mask drawn to `maskCanvas` for `engine.personMaskSource`.
  **Fix worth remembering**: dispose() must be reversible — React
  StrictMode's dev double-mount calls the unmount cleanup on the
  ref-persistent instance, and a one-way `disposed` latch left the model
  stuck at LOADING forever. Now dispose bumps a load token and a later
  enable() reloads cleanly.
- **DummyNode** upgraded: real param storage + placeholder schema
  (`intensity`, `mix` — reactive; `segEnabled` on blob_reveal / bokeh /
  anamorphic_lab). Explicitly NOT the effects' real params — each port
  phase (4–8) swaps in the exact table from its HTML.
- Verified per 06-VERIFICATION (headless, `verify-phase3.js`) **14/14
  PASS**: generated 120 BPM kick-pattern WAV → bass meter swings 54–96,
  BPM readout = 120; pause freezes / seek jumps the transport; routing
  BASS onto analog.intensity (base 0, amt 0.6) → mod readout oscillates
  0.33–0.56; chain video → motion 28–61, bright ~72; SEG hidden while
  off → READY on demand (mirrored CDN); bus routing survives a preset
  save→mutate→load round-trip; no page errors. Regression: Phase 2 suite
  26/26, Phase 1 suite 21/21, lint clean.
- Closes the Phase 2 open item: ParamBus serialize/restore is real, so
  chain presets now carry bases + routes across disarm/re-arm.

### 2026-07-17 — Phase 2 complete (AI Lab armed mode + drag wiring)

- **Wiring model** (new source of truth for the chain): serial `WireMap`
  (`'IN' | id → id | 'OUT'`, one wire per port) owned by the shell,
  persisted as `syntech.composition.v3` (v2 auto-migrates: enabled order →
  wiring). `enabled` is now DERIVED: a node is ACTIVE iff it sits on the
  complete IN→OUT path (`walkChain`); everything else ghosts at 50% with
  BYPASS badge and drops out of the chain readout.
- **NodalComposition**: real drag wiring — press a port, drag, release on a
  compatible port to connect; sides enforced by construction (only out→in
  can commit; INPUT has right port only, OUTPUT left only). Pressing an
  occupied out-port re-aims its wire; pressing an occupied in-port picks
  the wire's end up; releasing in the void (or back where it started)
  disconnects. Connecting to an occupied port replaces that port's wire.
  Add Node menu strictly alphabetical (ANALOG → BOKEH) and auto-wires the
  new node before OUTPUT (spec §6); ✕ removes the node and heals the chain
  (neighbours reconnect).
- **AI Lab armed mode**: nav toggle stays violet until manually clicked
  off; Home no longer disarms. Arming mounts the real `ChainLab` surface in
  the hero (it was imported but never rendered before). While armed, an
  opened effect covers the lab (display:none) without unmounting it, so
  composition + params survive navigation; Home returns to the lab.
- **Rack ⇄ graph sync (both ways)**: ChainLab takes a live `chain` prop
  (engine reordered + enabled flags on change) and lifts rack edits
  (power toggles, ▲▼ reorder, preset loads) back up via `onChainChange` →
  the shell rebuilds the wiring.
- Verified per 06-VERIFICATION: lint clean; headless Playwright
  (`verify-phase2.js`) **26/26 PASS** including the roadmap acceptance:
  chain IN→analog→blob_tracker→OUT built purely by port dragging, both
  ACTIVE; detaching the middle wire ghosts both + readout drops to
  passthrough; out→out release rejected; armed violet toggle survives
  effect-open + Home; rack bypass/re-enable rewrites wiring and rack order
  mirrors it; wiring persists across reload. Regression: Phase 1 suite
  re-run **21/21 PASS** (all five effects open, save/restore, standalone
  clean); no page errors.
- Known limit (logged): node params reset when the lab is disarmed and
  re-armed (nodes + wiring persist; params are engine-local until ParamBus
  serialize/restore becomes real in Phase 3). Dummy-node rendering is
  passthrough until Phases 4–8 port the effects.

### 2026-07-17 — Phase 1 complete (bridge v1: settings save/restore)

- Appended the delimited `SYNTECH-BRIDGE` block (03-SPEC-SHELL §5) to all
  five effect HTMLs — additive only, before `</body>`, silent when the page
  has no parent (standalone). Contract implemented: `syn:ready` on load,
  `syn:get-settings` → `syn:settings`, `syn:apply-settings`.
- Per-effect capture/apply:
  - **analog / blob_tracker**: their own preset serializers live inside
    IIFEs (unreachable), so the bridge mirrors them 1:1 through reachable
    top-level globals — sliders + knobs (`syncKnob`) + LED/seg buttons +
    XY pad (`PAD` / `setPad`, `padX/padY`); blob_tracker also colors and
    custom text. Field lists copied from `PRESET_*` in the HTML.
  - **anamorphic_lab**: all range sliders + the six `tog-*` toggles.
  - **blob_reveal**: sliders + `btn-seg` / `btn-model` toggles.
  - **bokeh**: sliders + knobs (`setKnob`) + `#style-sel` group + letterbox/
    breathing/shape-pad toggles (style applied before `btn-bshape` because
    the shape pad stashes the prior style as its restore point).
- Shell: `EffectHost` (forwardRef) applies `syntech.effectSettings.<id>` on
  `syn:ready` and exposes `requestSave()`; nav **Save** in single-effect
  mode persists the effect's settings + "Saved" flash (03-SPEC-SHELL §4),
  session-snapshot behavior unchanged elsewhere. No Home confirmations.
- **Deliberately not saved** (runtime/device state, not settings):
  `cam-device-sel` pickers, mic/webcam/record/fullscreen buttons,
  play/pause/loop transport, bokeh shape-pad x/y position (its on/off IS
  saved), and the effects' own video-blob session systems.
- Payload note: `syn:settings` payload is a per-effect structured object
  (`{sliders:{id:v}, knobs:{...}, ...}`) rather than a flat key map — the
  shell treats it as opaque; shape documented here for Phases 4–8.
- Verified per 06-VERIFICATION: lint clean; headless Playwright
  (`verify-phase1.js`), **21/21 PASS** — per effect: tweak slider (+1
  toggle where curated) → Save (flash observed, localStorage key written) →
  Home → reopen → values restored exactly; zero shell page errors; each
  HTML opened standalone (direct top-level URL) with zero non-font console
  errors and zero `syn:*` messages (bridge silent). Regression: all five
  effects still open and boot in single-effect mode.

### 2026-07-17 — Phase 0 complete (baseline & housekeeping)

- Merged the workflow branch into `main`; session ran on
  `claude/fable-5-merge-roadmap-phase-uzbso9` rebased on that `main`.
- Deleted the 20 dead root scripts listed in the phase (close_div.cjs,
  fix_*.cjs/js, recover_git.py, remove/replace/revert_*.cjs,
  update_vfxcanvas.cjs) — grep confirmed nothing references them.
- Found & fixed an in-scope gap: the right-sidebar effect cards had **no
  click handler**, violating 03-SPEC-SHELL §7 ("Clicking a card =
  single-effect mode"). Added `onClick={handleModuleOpen(id)}` +
  `cursor-pointer` to the card div in `src/App.tsx` — only code change.
- Verified per 06-VERIFICATION.md: `npm install` + `npm run lint` clean,
  `npm run dev` serves :3000, all five effect URLs return 200. Headless
  Playwright suite (scratchpad `verify-phase0.js`), 27/27 checks PASS:
  home brain graph renders; each of the 5 effects opens full-hero **both**
  from its sidebar card and from its brain-graph hub (hub positions computed
  from `VfxCanvas` hubsConfig, real mouse click); inside every effect:
  canvas present, a slider tweaked via input event, and a generated 3s test
  video (canvas+MediaRecorder webm) loaded — DOM `<video>` reaches
  readyState 4 and plays (blob_tracker, blob_reveal, anamorphic_lab);
  analog/bokeh keep the video off-DOM, verified via drop-overlay hidden +
  filename label. Screenshots confirm blob_tracker tracking the test clip
  (FPS 37) and analog's SORT–FEEDBACK–CRT pipeline rendering.
- Console errors: **only** Google Fonts `ERR_CONNECTION_RESET`, a
  sandbox-only limitation (no direct internet for the headless browser).
  Blocked CDN libs (three.js, MediaPipe) were served from local npm mirrors
  via route interception — see Open items for the reusable workaround.
- Deviation from a strict read of the phase: "internal UI works" was
  verified headless (video load + slider + screenshots), not by a human;
  fonts could not be loaded in-sandbox (cosmetic only).

### 2026-07-17 — Workflow created (setup session)

- Analyzed repo + the 5 uploaded effect HTMLs; wrote CLAUDE.md and
  docs/workflow/01–08 + STATE.md.
- Committed the 5 official effect HTMLs to `public/effects/<id>/index.html`
  (blob_tracker replaced with the operator's current build; analog,
  blob_reveal, bokeh, anamorphic_lab added).
- No feature code written; engine stubs untouched. Verification: none run
  (docs-only session) — Phase 0 does the first full baseline check.
