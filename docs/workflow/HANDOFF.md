# HANDOFF — session continuation brief (updated 2026-07-20, Phase 8 COMPLETE)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> **Phase 8 is done — all five effects are now real 1:1 SynEngine ports.**
> Next up is **Phase 9 — Chain export (Master MP4)**. Develop on the branch the
> operator names in the session brief; if the current PR is already merged,
> restart the branch from the latest `origin/main` per the branch policy.

## Where we are — exactly

- **Phases 0–8 DONE and verified.** The five standalone effects are all ported
  to SynEngine nodes: `analog`, `bokeh`, `anamorphic_lab`, `blob_reveal`,
  `blob_tracker`. `src/engine/nodes.ts` wires all five to their real classes —
  **no DummyNode remains**. `three@0.128.0` is a real dep (added in Phase 8).
- **blob_tracker** (the last + hardest, ~6876-line three.js + many-Canvas2D
  hybrid) is complete. Layer map + per-layer parity numbers live in the
  `src/engine/nodes/blob_tracker.ts` header and the STATE.md 2026-07-20 logs.
  Per-layer verify suites: `tools/verify/verify-phase8-{static-L1,static-L2,
  static-L3,L3b,behavior-L4,L5,L6,L7a,L7b,L7c,chain}.js`.
- **Accepted deltas / consolidations for blob_tracker** (all decision-#1
  consistent — the chain uses the shared AudioEngine/VideoAnalyzer + ParamBus,
  not the standalone's bespoke analysers; recorded in STATE Decisions #8–#13):
  - Reactivity: the standalone's 7-band auto-driver → ParamBus defaultRoutes
    (connWidth←bass, connGlow←loud, datamosh←treble, glitchAmt←beat,
    panelScale←bass, panelTurb←motion, rippleForce←beat). ar-* / vr-* gains +
    enable/auto toggles consolidated.
  - Colours: palette-enum indices (ParamSchema has no hex type).
  - Panels labels/lines: drawn INTO the node texture (Canvas-2D), not HTML/SVG.
  - Smart contour: mapped to the shared PersonMask, not a new MediaPipe dep.
  - Chaos points: auto-placed (no mouse in a chain); autoMode per-panel onset
    choreography omitted (covered by the routes above).
  - Panels-label colour override + cam-* hardware sliders: not ported (styling /
    source concerns).

## NEXT — Phase 9: Chain export (Master MP4)

Read `05-ROADMAP.md` Phase 9 + `06-VERIFICATION.md` for the acceptance criteria.
The goal: make the ChainLab **"Master MP4"** button real — capture the live
chain composite (the `chain-canvas`) to a downloadable file.
- The button currently references `/effects/vendor/*` files that **do not exist
  yet** (see STATE Open items) — Phase 9 provides them or replaces the approach.
- The five ports render a real composite now, so there is genuine output to
  capture. Likely approach: `MediaRecorder` on `canvas.captureStream()` (webm),
  or WebCodecs/mp4 if the phase calls for MP4 specifically — check the roadmap.
- Mind audio: if the export should carry the track, mux the AudioEngine output.
- Persistence stays localStorage (hard rule #7); no backend.

## Verification harness — operational playbook (this WILL bite you)

- **Dev server serves STALE code after a source edit in this sandbox.** RESTART
  it before every verify run: `fuser -k 3000/tcp` (NOT `pkill -f 'tsx
  server.ts'` — that pattern does not match the real
  `node --require .../tsx ... server.ts` cmdline), then `npm run dev` via Bash
  `run_in_background`, then poll `curl -s -o /dev/null -w '%{http_code}'
  http://localhost:3000` for 200. If :3000 is 000 with procs alive, find the PID
  with `fuser 3000/tcp` and `kill -9` it.
- **The container can restart mid-session** (the working tree + node_modules +
  scratchpad survived last time, but don't count on the dev server or background
  tasks). Re-`npm install` only if `node_modules` is gone.
- **The ParamBus pushes each param's base every frame**, so a headless
  `node.setParam(k,v)` is reverted next frame — drive params through the UI
  control (the `param-<id>-<key>` testid, which calls `bus.setBase`), not
  `setParam` directly. Read routes/mods via `window.__SYN.bus.state`.
- **Injecting a PersonMask** (for smart-seg tests) must neutralise
  `__SYN.mask.enable`/`.tick` to no-ops first, then set `.maskCanvas`/`.ready`/
  `.state='ready'`/bump `.version` — otherwise the real loader's async CDN
  failure sets `ready=false` and wipes the injection mid-flight.
- **Standalone parity** (if a Phase-9 suite opens a standalone HTML): it loads
  THREE from cdnjs at init — the suite MUST serve the three.js r128 mirror via
  `ctx.route` or the standalone aborts before wiring `#fi-v`. Filter
  `THREE is not defined` / `SelfieSegmentation is not defined` out of the
  page-error gate. (This is exactly why the Phase-1 regression showed 5 CDN
  fails — not a real regression.)
- **Scratchpad rebuild** (session scratchpads don't carry over): copy
  `tools/verify/*.js` + `sed -i "s|__SCRATCH__|$S|g"`; `node gen1080.js`
  (parity1080.webm) + `node make-beat-wav.js` (beat120.wav);
  `cp parity1080.webm $S/test.webm`. For standalone parity also `npm pack
  three@0.128.0 @mediapipe/selfie_segmentation` → extract to `$S/cdn/...`.
  Playwright: `NODE_PATH=/opt/node22/lib/node_modules`, launch args
  `--autoplay-policy=no-user-gesture-required --enable-unsafe-swiftshader`.
  Grab canvases with `toDataURL` (page.screenshot starves under GL load).
- **fps ≥30@720p stays a GPU-machine criterion** — under sandbox SwiftShader the
  chain runs ~1–2 fps; verify behaviourally, flag fps for the operator.
- **Never write a repo file while a suite drives the shell** (Vite HMR reload
  kills the run) — stage suites in the scratchpad, edit the repo copies between
  runs.

## Protocol reminders

`npm run lint` (= `tsc --noEmit`) clean before every commit; keep the app
working at every commit; update STATE.md in the same commit as the work. Never
touch the five `public/effects/*/index.html` files outside the delimited bridge
blocks. ModuleIds (`blob_tracker`, `analog`, `blob_reveal`, `bokeh`,
`anamorphic_lab`) + the `--syn-*` tokens are load-bearing. Operator speaks
Italian; repo docs English. **Watch the block-comment `*/` trap** — a literal
`ar-*/vr-*` inside a `/* */` comment closes the comment early (bit this port
twice); write `ar-* / vr-*`.
