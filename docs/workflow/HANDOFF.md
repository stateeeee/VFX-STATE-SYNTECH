# HANDOFF — session continuation brief (updated 2026-07-18, post-Phase 5)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> It carries everything previous sessions learned that is not obvious from
> the repo: exact position, environment quirks, and the verification
> machinery. Delete or archive this file when it stops being current.

## Where we are — exactly

- Branch: `claude/vfx-syntech-workflow-48260a` (work + push here). `main`
  is at the Phase 0–4 merge; the operator merges between sessions.
  Session commits so far: `834bd6d` (Phase 5 wip checkpoint) + the Phase 5
  close-out commit that carries this file.
- Phases 0–5 are DONE and verified (see the STATE.md log entries — they
  contain the full parity numbers and decisions). Real ports so far:
  **analog** (`src/engine/nodes/analog.ts`) and **bokeh**
  (`src/engine/nodes/bokeh.ts`); the other three are DummyNodes.
- **Next step: Phase 6 — 1:1 port of ANAMORPHIC_LAB** per the port
  template in `05-ROADMAP.md`, one phase per session. STATE.md "Next
  step" has the concrete instruction.

## Phase 6 recon (anamorphic_lab standalone, ~155 KB)

- 28 range sliders (`s-fStop`, `s-bokeh`, `s-bokehMM`, `s-ratio`,
  `s-squeeze`, `s-barrel`, `s-ovalFineTune`, `s-riccardoBlur`, flare
  group `s-flare*`, grade group `s-exposure/contrast/lift/rolloff/sat/
  temp/lutMix`, texture group `s-grain/halation/vignette/ca`, camera sims
  `cam-*-sl`) + toggles (e.g. `tog-flare`) — see 04-SPEC-EFFECTS.
- **This build HAS an AudioContext** (unlike bokeh): find its reactive
  wiring and map it to ParamBus `defaultRoute`s like analog did.
- MediaPipe selfie_segmentation from jsdelivr (blocked in sandbox — same
  PersonMask consumption + mask-injection parity approach as Phase 5).
- The Phase 1 bridge block at the bottom of the HTML lists the
  save/restore surface — a good param checklist starting point, but the
  port needs the FULL table read from the HTML.

## The verification machinery (`tools/verify/`)

Substitute the scratchpad placeholder before running (or copy them):

```bash
S=<your scratchpad dir>
cp tools/verify/*.js $S/verify/ && sed -i "s|__SCRATCH__|$S|g" $S/verify/*.js
```

- `verify-phase1.js` (21) / `verify-phase2.js` (26) / `verify-phase3.js`
  (14): regression suites — run all three at the end of every phase.
  phase1 needs `cdn/three/build/three.min.js`; phase3 needs `test.webm`
  in the scratchpad (any short webm; `gen1080.js` output works too).
- `verify-phase4-static.js` / `verify-phase4.js` / `verify-phase4-step2.js`:
  ANALOG parity suites.
- `verify-phase5-static.js`: BOKEH static parity — the mask-injection
  template for any segmentation-dependent port (Phases 6–8): the SAME
  drawn mask goes to the standalone via global `onSegResults({...})` and
  to the engine via the PersonMask tap (`__SYN.mask`: set state/ready,
  draw into maskCanvas, bump `version` once per engine frame). 18 configs,
  all corr=1.000/mad=0.000 for bokeh.
- `verify-phase5-behavior.js`: temporal/stochastic/reactive checks
  (real-MediaPipe path, bgfx subject-protection, frame-based datamosh
  cadence engine-side, breathing, manual mod routing).
- `verify-phase5-chain.js`: chain sanity in a fresh session (bokeh→analog
  + three bypassed rack nodes).
- Asset generators: `gen1080.js` (1080p parity clip — REQUIRED at
  1920×1080 or fixed-frequency looks alias), `make-beat-wav.js` (120 BPM).
- Mirror CDN packages into `<scratch>/cdn/` first:
  `npm pack three@0.128.0 @mediapipe/selfie_segmentation` → extract to
  `cdn/three/…` and `cdn/@mediapipe/selfie_segmentation/…`.

Run pattern:
```bash
npm run dev &   # tsx server.ts → :3000
NODE_PATH=/opt/node22/lib/node_modules node $S/verify/<suite>.js
```

## Parity method that works (Phases 6–8)

1. **Static pixel parity**: `window.__SYN` tap ({engine, audio, bus,
   mask}) → `engine.adaptiveRes=false; engine.setResScale(1)`; pause BOTH
   videos on the same frame of the 1920×1080 clip; inject the SAME person
   mask both sides (see phase5-static) stepping the temporal smoothing
   equally; expect corr≈1.000/mad≈0.000 for deterministic passes.
   Clock-seeded jitter (gold noise etc.) differs per side — invisible at
   the 128×72 verification downscale but exclude configs whose LOOK
   depends on wall-clock phase (e.g. breathing oscillation).
2. **Temporal features**: compare per RENDERED FRAME (standalone
   `STATE.frameCount`, engine `__SYN.engine.frame`) — never wall-time; a
   frame-based clock at standalone SwiftShader fps (<1fps under heavy
   shaders) can make cadence effects unobservable headless: prove the
   mechanism engine-side, log it, flag a GPU spot check.
3. **Stochastic passes**: judge behavior (variance vs baseline), not
   pixels. For playing-video cross-side comparisons, grab BOTH sides at
   the same instants (`Promise.all`) — sequential sweeps average
   different windows of the looping clip.
4. Drive the standalone via its own globals (`updateParam` writes any P
   key; `syncKnob`; sliders + `input` events; **bgfx/style switches via
   their real seg-button `.click()`** — the click handlers run
   `clearBgFx()`, matching the engine node's style-change clear); drive
   the engine via rack testids (`param-bokeh-<key>` etc.) or `__SYN.bus`.

## Sandbox facts (will bite you if forgotten)

- **Never write ANY file into the repo while a suite is driving the
  shell page** — the dev server full-reloads the page and kills the run.
  Stage STATE.md text in the scratchpad; write repo files only between
  runs.
- `page.screenshot` starves under heavy GL — grab canvases with
  `toDataURL` (see phase5-static's `shot`).
- ChainLab racks ALL five registry nodes (unwired ⇒ `enabled=false`):
  wait on chain CONTENT (ids + enabled), never on `chain.length`.
- When two heavy pages must coexist (standalone + engine), boot the
  second one with the first QUIET: `__SYN.engine.stop()` /
  `engine.source.pause()` around the navigation, restart after. Close the
  standalone page as soon as it's no longer needed.
- Network: `cdn.jsdelivr.net`/`cdnjs.cloudflare.com` blocked (mirror from
  npm + `context.route()`); launch args
  `--autoplay-policy=no-user-gesture-required --enable-unsafe-swiftshader`
  (+ fake media-stream flags for mic/webcam). No usable ffmpeg;
  MediaRecorder webms have no cues — race seeks against ~2.5s timeouts.
- Playwright: global install → `NODE_PATH=/opt/node22/lib/node_modules`.
- **React StrictMode double-mount** (dev): services must dispose
  reversibly (PersonMask uses a load token + `version` counter).
- Adaptive resolution steps clear feedback-style buffers — pin it during
  parity (`adaptiveRes=false`, `setResScale(1)`).
- The `≥30fps @720p chain` acceptance is a GPU-machine criterion — the
  sandbox is SwiftShader-only (bokeh→analog measured 1fps @ 50% res
  there). Measure, report honestly, flag for the operator.
- `npm run lint` = `tsc --noEmit` (src only). Keep it clean before every
  commit.

## Protocol reminders

- One phase per session; read the phase section + specs first; post a
  short plan; verify per 06-VERIFICATION; update STATE.md (checkboxes,
  log entry with evidence, next step) in the same commit; push with
  retries (2s/4s/8s/16s). Operator communication in Italian; repo docs
  in English. Never touch the five effect HTMLs outside the delimited
  bridge blocks. ModuleIds and `--syn-*` tokens are load-bearing.
