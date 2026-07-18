# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phase 5 — 1:1 port: bokeh** (not started)

## Next step

**Read `docs/workflow/HANDOFF.md` first** (session continuation brief:
exact position, sandbox quirks, verification machinery in
`tools/verify/`). Then run Phase 5 of `05-ROADMAP.md` (port template)
for **bokeh**: read
`public/effects/bokeh/index.html` end-to-end; extract the full param table
(sliders, knobs via `setKnob`, `#style-sel` seg group, toggles, shape pad)
and the render pipeline; implement `src/engine/nodes/bokeh.ts`; swap the
factory; map its audio-reactive controls to ParamBus `defaultRoute`s; the
effect consumes the shared PersonMask (`segEnabled`). Verify with the
Phase 4 parity method: static pixel comparison via the `window.__SYN` dev
tap (pin adaptiveRes off + resScale 1, pause both videos on the same
frame, use a source clip at 1920×1080 so both canvases match the
standalone's fixed CONFIG resolution), motion/stochastic behavior checks,
and frame-based (not wall-time) analysis for any temporal feature.

## Phase board

- [x] Phase 0 — Baseline & housekeeping
- [x] Phase 1 — Single-effect mode + settings save (bridge v1)
- [x] Phase 2 — AI Lab UX (armed mode + drag wiring)
- [x] Phase 3 — Engine services (AudioEngine, VideoAnalyzer, ParamBus, PersonMask)
- [x] Phase 4 — 1:1 port: analog
- [ ] Phase 5 — 1:1 port: bokeh
- [ ] Phase 6 — 1:1 port: anamorphic_lab
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
