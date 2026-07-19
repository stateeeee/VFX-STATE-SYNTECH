# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phase 7 — 1:1 port: blob_reveal** (NOT STARTED)

## Next step

**Read `docs/workflow/HANDOFF.md` first** — it carries the Phase 7 brief
with the blob_reveal facts already gathered (pure-Canvas2D pipeline,
viewport-fit canvas sizing, real audio reactivity → defaultRoutes) and
the scratchpad rebuild steps. Then execute Phase 7 per the port template
in 05-ROADMAP.md (Phases 4–8 section): read the effect HTML end-to-end,
implement `src/engine/nodes/blob_reveal.ts`, factory swap, parity run
per 06-VERIFICATION §4, regression, STATE.md + HANDOFF update, commit,
push.

## Phase board

- [x] Phase 0 — Baseline & housekeeping
- [x] Phase 1 — Single-effect mode + settings save (bridge v1)
- [x] Phase 2 — AI Lab UX (armed mode + drag wiring)
- [x] Phase 3 — Engine services (AudioEngine, VideoAnalyzer, ParamBus, PersonMask)
- [x] Phase 4 — 1:1 port: analog
- [x] Phase 5 — 1:1 port: bokeh
- [x] Phase 6 — 1:1 port: anamorphic_lab
- [ ] Phase 7 — 1:1 port: blob_reveal
- [ ] Phase 8 — 1:1 port: blob_tracker
- [ ] Phase 9 — Chain export (Master MP4)
- [ ] Phase 10 — Assets & polish

## Open items

- Operator will deliver 6 images (logo + 5 effect covers) → Phase 10,
  prompt D in 08-PROMPTS.md. Not delivered yet.
- `ChainLab` "Master MP4" button references `/effects/vendor/*` files that do
  not exist until Phase 9 — expected to fail until then.
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

## Log

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
