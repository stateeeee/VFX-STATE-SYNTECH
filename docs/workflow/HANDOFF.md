# HANDOFF — session continuation brief (written 2026-07-18)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> It carries everything the previous session learned that is not obvious
> from the repo: exact position, environment quirks, and the verification
> machinery. Delete or archive this file when it stops being current.

## Where we are — exactly

- Branch: `claude/fable-5-merge-roadmap-phase-uzbso9` (work + push here).
  `main` is at the workflow-docs commit; the operator merges between
  sessions. Session commits so far, all pushed:
  - `d160864` Phase 0 (baseline, dead scripts removed, cards clickable)
  - `c836d3c` Phase 1 (settings bridge in the 5 HTMLs + EffectHost/Save)
  - `e2703e0` Phase 2 (drag wiring, armed AI Lab, rack⇄graph sync)
  - `73345ef` Phase 3 (real AudioEngine/VideoAnalyzer/ParamBus/PersonMask)
  - `ddfb9c8` Phase 4 (ANALOG 1:1 port + parity evidence)
- Phases 0–4 are DONE and verified (see the STATE.md log entries — they
  contain the full parity numbers and decisions).
- **Next step: Phase 5 — 1:1 port of BOKEH** per the port template in
  `05-ROADMAP.md`, one phase per session. STATE.md "Next step" has the
  concrete instruction.

## Phase 5 recon already done (bokeh standalone)

`public/effects/bokeh/index.html` (~3800 lines + our bridge at the end):
- Controls: 9 range sliders `sl-*` (incl. `sl-bokehRadius`,
  `sl-anam*`), custom knobs `.knob[data-id]` (e.g. `bokehBloom`,
  `bokehFeather`) settable via the GLOBAL `setKnob(knobEl, value)`;
  bokeh style seg group `#style-sel .seg-btn` (click-driven); toggles
  `tog-anamLetterbox`/`tog-anamBreathing` (P-object flags); `btn-bshape`
  toggles the BSHAPE pad (stashes `P.bokehStyle`, restores on off — in
  the Phase 1 bridge we apply style BEFORE btn-bshape for that reason);
  double-click knob popup uses `#knob-popup-input` (type=number — never
  save/restore it). File input: `#file-input` (video, off-DOM `video`
  element — `drop-overlay` hides + `#info-file` shows the name on load).
- MediaPipe selfie_segmentation loads EAGERLY from a `<script>` tag at
  the top (cdn.jsdelivr.net — blocked in this sandbox, see below).
  The engine node must instead consume the shared PersonMask via
  `segEnabled` + `ctx.personMask` (see how ChainLab wires
  `engine.personMaskSource`; SynEngine passes it as `ctx.personMask`).
- The Phase 1 bridge block at the bottom of the HTML documents the
  save/restore surface — it is a good param checklist starting point,
  but the port needs the FULL table read from the HTML (renderer uses a
  `P` object like analog's; find `const P=` and the shader sources).

## The verification machinery (now in `tools/verify/`)

The previous session's headless suites are committed under
`tools/verify/` (they used to live only in the ephemeral scratchpad).
Before running them, substitute the scratchpad placeholder:

```bash
SCRATCH=<your scratchpad dir>
sed -i "s|__SCRATCH__|$SCRATCH|g" tools/verify/*.js   # or copy them there first
```

- `verify-phase1.js` (21 checks) / `verify-phase2.js` (26) /
  `verify-phase3.js` (14): regression suites — run all three at the end
  of every phase (06-VERIFICATION §5).
- `verify-phase4.js`: ANALOG motion/behavior suite (long-exposure
  comparisons, stochastic variance, reactivity, chain fps).
- `verify-phase4-static.js`: the parity workhorse — static
  pixel-comparison template. Adapt it for each new port.
- `verify-phase4-step2.js`: frame-based temporal parity (feedback decay
  per rendered frame) — template for any temporal feature.
- `make-beat-wav.js` (Node; writes `beat120.wav`, 120 BPM kick pattern)
  and `gen1080.js` (Playwright; records `parity1080.webm`, a structured
  1920×1080 3 s clip via canvas+MediaRecorder). Regenerate both into the
  new scratchpad first; `test.webm` (Phase 0/3 suites) is generated
  in-page by the suites themselves.

Run pattern:
```bash
npm run dev &   # tsx server.ts → :3000
NODE_PATH=/opt/node22/lib/node_modules node tools/verify/<suite>.js
```

## Parity method that works (use for Phases 5–8)

1. **Static pixel parity**: dev-only tap `window.__SYN`
   ({engine, audio, bus, mask}, set in ChainLab mount) → set
   `engine.adaptiveRes=false; engine.setResScale(1)`; pause BOTH videos
   on the same frame (`engine.source` for the lab; the standalone's
   top-level `video` global). **Use a 1920×1080 source clip** so the
   engine canvas matches the standalone's fixed 1080p CONFIG — with
   mismatched canvas sizes, fixed-frequency patterns (scanlines,
   phosphor triads) alias differently and corrupt the comparison.
   Expect corr≈1.000 / mad≈0.000 for deterministic passes.
2. **Temporal features**: compare per RENDERED FRAME, never wall-time —
   in the sandbox the engine runs ~59 fps while the WebGL1 standalone
   does ~4.5 fps (SwiftShader). Frame counters: standalone
   `STATE.frameCount` (top-level global), engine `__SYN.engine.frame`.
   Discard the first post-seek sample (it captures the source frame
   switch, not the effect's dynamics).
3. **Stochastic passes** (noise/grain/jitter): judge behavior (temporal
   variance vs a neutral baseline), not pixels.
4. Drive the standalone's controls via its own globals
   (`syncKnob`/`setKnob`, sliders + `input` events, LED `.click()`);
   drive the engine via the rack testids (`param-<id>-<key>`,
   `toggle-<id>`) or `__SYN.bus.setBase`.

## Sandbox environment facts (will bite you if forgotten)

- **Network policy**: `cdn.jsdelivr.net` and `cdnjs.cloudflare.com` are
  BLOCKED (403 CONNECT). `registry.npmjs.org` is open. Mirror CDN
  packages via `npm pack three@0.128.0 @mediapipe/selfie_segmentation
  @mediapipe/face_mesh@0.4.1633559619 @mediapipe/pose@0.5.1675469404
  @mediapipe/tasks-vision@0.10.3`, extract into `<scratch>/cdn/<pkg>/…`,
  and serve with Playwright `context.route()` (see any suite's `routeCdn`
  — jsdelivr `/npm/<pkg>@<ver>/<file>` maps 1:1 to package contents).
  `fonts.googleapis.com` works via the tool proxy but NOT from the
  headless browser (launch Chromium WITHOUT a proxy — localhost must
  stay direct; browser-proxying localhost hits the relay's
  CONNECT-only error page).
- **Playwright**: global install — `NODE_PATH=/opt/node22/lib/node_modules`.
  Launch args that matter: `--autoplay-policy=no-user-gesture-required`
  (audio), `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`
  (mic/webcam), `--enable-unsafe-swiftshader` (quiet software-GL).
  `locator.boundingBox()` is flaky on SVG `<g>` — use
  `getBoundingClientRect` via `evaluate`. `page.screenshot` can starve
  under heavy GL — read canvases with `toDataURL` instead.
  No usable ffmpeg (`lavfi` missing in Playwright's build) — generate
  WAVs in Node (see `make-beat-wav.js`) and videos with
  canvas+MediaRecorder. MediaRecorder webms have no cues: `seeked` may
  never fire — always race seeks against a ~2.5 s timeout.
- **React StrictMode double-mount** (dev): ChainLab's cleanup runs on
  ref-persistent service instances — any `dispose()` must be reversible
  (PersonMask uses a load token for exactly this; same care for future
  services).
- **Adaptive resolution**: engine steps 1 → .75 → .5 under low fps; every
  step resizes node targets and legitimately clears feedback-style
  buffers. Pin it during parity runs (see above).
- The `≥30 fps @720p chain` acceptance is a GPU-machine criterion — the
  sandbox is SwiftShader-only (19–25 fps @50%). Measure, report
  honestly, flag for the operator; don't block the phase on it.
- `npm run lint` = `tsc --noEmit` (src only; `tools/verify/*.js` is not
  type-checked). Keep it clean before every commit.

## Protocol reminders

- One phase per session; read the phase section + specs first; post a
  short plan; verify per 06-VERIFICATION; update STATE.md (checkboxes,
  log entry with evidence, next step) in the same commit; push with
  retries (2s/4s/8s/16s). Operator communication in Italian; repo docs
  in English. Never touch the five effect HTMLs outside the delimited
  bridge blocks. ModuleIds and `--syn-*` tokens are load-bearing.
