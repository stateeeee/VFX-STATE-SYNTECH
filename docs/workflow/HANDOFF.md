# HANDOFF — session continuation brief (updated 2026-07-19, MID-Phase 6)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> **Phase 6 is MID-FLIGHT**: the port is implemented and its static parity
> is fully green; three verification items remain before the phase can be
> marked done. Continue EXACTLY from "What remains" below — do not
> re-implement, do not restart verification from scratch.

## Where we are — exactly

- Branch: `claude/vfx-syntech-workflow-48260a` (work + push here). The
  operator asked this branch to be merged to `main` at handoff time —
  after the merge, keep working on the SAME branch name restarted from
  `origin/main` if the previous head became merged history.
- Phases 0–5 DONE and verified (STATE.md log has all numbers).
  Real ports live: **analog**, **bokeh** (parity pixel-identical), and
  **anamorphic_lab** (implemented; verification 70% done, see below).
- Commits: `3540fac` Phase 5 close-out; `73a29c9` Phase 6 WIP (node +
  factory swap); this handoff commit adds the phase-6 verify suites under
  `tools/verify/` (already calibrated — reuse, don't rewrite).

## Phase 6 verification — what is ALREADY PROVEN (do not redo)

Suites: `tools/verify/verify-phase6-{static,behavior,chain}.js`
(`__SCRATCH__` placeholder, same run pattern as always).

1. **Static parity GREEN — 26 steps, 0 failed**: 22/22 configs
   corr ≥0.999, mad ≤0.004 at matched 1280×720 (the standalone caps its
   canvas via `resizeCanvasToVideo` MAX=1280 → engine pinned at
   `setResScale(2/3)`), same injected mask both sides (standalone global
   `bkOnSegResults({segmentationMask})`, engine PersonMask tap, EMA ×14),
   settle-detected grabs. Configs: isco defaults, raw-neutral, temp ±1,
   lift+contrast, sat 0/1.8, rolloff, exposure ±1, halation, bloom, CA,
   barrel, vignette, squeeze 2.2, ratio 2.8, compare split,
   bokehMM-100-f2, bokehMM-oval, ghost-glitch, hero. Summary numbers:
   all corr=1.000 except rolloff-max/exposure-up/ghost-glitch at 0.999;
   mad ≤0.004. Evidence PNGs were in the (now lost) session scratchpad —
   regenerate hero/defaults pairs during close-out if wanted.
2. **Behavior A–D + F GREEN across 3 runs**: A real-MediaPipe READY;
   B playing long-exposure corr 0.955–0.978; C auto-flare fires on both
   sides (on-vs-off delta S/E ≈ 0.078/0.094–0.097) and flickers;
   D breathing drift only when enabled (both sides); F manual bass route
   onto `vignette` modulates the readout (runs 1–2; no default routes BY
   DESIGN — the original has NO audio reactivity, its only AudioContext
   is REC-export plumbing; reactivity is video-driven auto-flare).
3. **Behavior E (f-stop easing) — NOT yet green, check freshly
   rewritten**: first two attempts were test-calibration failures
   (fixed-time waits, then a settle-detector that can't tell "no frame
   rendered" from "settled" under 1fps). The CURRENT committed version is
   frame-aware: it hooks a rAF counter into the standalone
   (`window.__fc`, works because render() re-invokes rAF via the global),
   waits 40 rendered frames per endpoint (≈99.5% convergence at the
   0.25s-clamped per-frame step k≈0.13), asserts gradual easing + settled
   cross-side corr >0.97. It ran ONCE and was still grinding after ~50min
   because f/0.95 drops the standalone below ~0.5fps under SwiftShader
   with two heavy pages — the run was killed at session handoff, NOT
   failed. Options for the next session (pick one, note it in STATE.md):
   (a) rerun as-is with patience (E alone can take ~1h in sandbox);
   (b) cheaper equivalent: run E at fStop jump 22→2.8 (radius 27px —
   standalone stays >2fps, same easing math exercised) and rely on the
   already-green static configs (f/2, f/1.4) for wide-aperture settled
   parity. (b) is recommended and honest — say so in the log.
4. **Chain script (3 real ports) — ready, never ran**:
   `verify-phase6-chain.js` (anamorphic_lab→bokeh→analog + 2 bypassed,
   fresh session, real MediaPipe, fps reported honestly).
5. **Regression — not run yet for Phase 6**: suites 1–3 + the phase-5
   suites (static at least) after any engine-touching change. Phase 6
   only added a node + factory entry, so expect green.

## What remains (concrete TODO for the next session)

1. Rebuild scratchpad prerequisites (session scratchpads do NOT carry
   over): copy `tools/verify/*.js` + `sed -i "s|__SCRATCH__|$S|g"`;
   `npm pack three@0.128.0 @mediapipe/selfie_segmentation` → extract to
   `$S/cdn/three/…` and `$S/cdn/@mediapipe/selfie_segmentation/…`;
   `node gen1080.js` (parity1080.webm), `node make-beat-wav.js`
   (beat120.wav), `cp parity1080.webm $S/test.webm` (phase‑3 suite input;
   any short webm works).
2. Run `verify-phase6-behavior.js` (decide E option a/b first — for (b),
   edit the fStop jump in the E block to 2.8 and note it) — expect
   9 steps green. Then `verify-phase6-chain.js`.
3. Regression: `verify-phase1.js` (21), `verify-phase2.js` (26),
   `verify-phase3.js` (14), `verify-phase5-static.js` (22 cfgs) — all
   green today.
4. `npm run lint`; update STATE.md: flip Phase 6 checkbox, replace the
   "Current phase/Next step" block (next = Phase 7 blob_reveal per the
   port template), append the Phase 6 log entry — a COMPLETE draft of
   that entry (all static numbers + consolidations + the
   no-audio-reactivity finding) is embedded at the bottom of this file:
   fill in the behavior/chain/regression numbers and use it verbatim.
5. Commit (Phase 6 close-out), push, update this HANDOFF for Phase 7.

## Parity method (unchanged — Phases 7–8)

- Static: `__SYN` tap; pin `adaptiveRes=false`; match the STANDALONE's
  actual canvas size (blob_reveal/blob_tracker: check their resize code
  first — anamorphic capped at 1280, bokeh was fixed 1920×1080); pause
  both videos on the same 1080p-clip frame; inject the SAME mask both
  sides; settle-detect grabs; corr>0.93/mad<0.06 gates (expect ≈1.000).
- Temporal: count RENDERED frames per side (engine `__SYN.engine.frame`;
  standalone: hook rAF via the global wrapper trick above when it has no
  frame counter global).
- Drive the standalone through its own globals (function declarations
  are on window; `const`/`let` objects are reachable only through those
  functions — e.g. anamorphic's `set()/tog()/setBokehMM()`).
- GLSL ES 3.00 reserves words WebGL1 allows (`active` bit Phase 6) —
  scan shader params/locals against the ES 3.00 reserved list BEFORE
  first compile.

## Sandbox facts (will bite you if forgotten)

- NEVER write any repo file while a suite drives the shell page (Vite
  full-reload kills the run). Stage texts in the scratchpad.
- `page.screenshot` starves under GL load — use canvas `toDataURL`.
- ChainLab racks ALL five nodes (unwired ⇒ enabled=false): wait on chain
  CONTENT, never length. Two heavy pages: boot the second with
  `__SYN.engine.stop()` around navigation; close the standalone page as
  soon as it's done.
- Network: jsdelivr/cdnjs blocked → npm mirror + `context.route()`.
  Launch args: `--autoplay-policy=no-user-gesture-required
  --enable-unsafe-swiftshader` (+ fake media flags when mic/webcam).
  Playwright global: `NODE_PATH=/opt/node22/lib/node_modules`.
  MediaRecorder webms have no cues → race seeks with ~2.5s timeout.
- React StrictMode double-mount: services must dispose reversibly.
- fps acceptance (≥30 @720p) is a GPU-machine criterion — sandbox is
  SwiftShader (phase-5 chain measured 1fps @0.5 res). Report honestly.
- `npm run lint` = `tsc --noEmit`. Clean before every commit.

## Protocol reminders

One phase per session; specs first; short plan; verify per
06-VERIFICATION; STATE.md (checkboxes, log with evidence, next step) in
the same commit as the work; push with retries. Operator speaks Italian;
repo docs English. Never touch the five effect HTMLs outside the bridge
blocks. ModuleIds and `--syn-*` tokens are load-bearing.

---

## APPENDIX — ready STATE.md log entry draft for Phase 6 close-out

Fill BEHAVIOR/CHAIN/REGRESSION placeholders, adjust date, then prepend to
the STATE.md Log section:

### 2026-07-XX — Phase 6 complete (1:1 port: ANAMORPHIC LAB)

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
     oval bokeh, ghost-glitch, hero combo.
  2. *Behavior suite* — BEHAVIOR_PLACEHOLDER (A real-MediaPipe READY;
     B long-exposure corr ~0.955–0.978; C auto-flare both sides
     ~0.078/0.094 + flicker; D breathing gated; E f-stop easing —
     note which option was used; F manual route spread).
  3. *Chain sanity* — CHAIN_PLACEHOLDER (anamorphic_lab→bokeh→analog,
     real MediaPipe, GL errors, fps honestly).
  4. Regression: REGRESSION_PLACEHOLDER; lint clean.
- Notes for Phases 7–8: ES 3.00 reserved words; frame-aware waits for
  anything eased per rendered frame; match the standalone's real canvas
  size before comparing.
