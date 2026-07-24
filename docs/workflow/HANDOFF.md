# HANDOFF — session continuation brief (updated 2026-07-20, Phases 0–9 done + Phase 10 IN PROGRESS)

> For the next Claude session (the operator is switching chats). Read this AFTER
> `CLAUDE.md` and `STATE.md`. **Continue EXACTLY from here: Phases 0–9 are
> complete and Phase 10 (Assets & polish) is mid-flight — its search box (item 2)
> is DONE; the remaining Phase-10 items are waiting on the operator** (see NEXT).
>
> **Branch state:** all work through the search box is committed AND the operator
> asked to MERGE `claude/vfx-syntech-layer-6-rgv14l` into `main` from the chat —
> so by the time you read this that branch may already be merged. Per the branch
> policy, if it shows merged, **restart the SAME branch name from the latest
> `origin/main`** (`git fetch origin main && git checkout -B
> claude/vfx-syntech-layer-6-rgv14l origin/main`) before any new Phase-10 work —
> do NOT stack new commits on merged history.

## Where we are — exactly

- **Phases 0–9 DONE and verified.** The five standalone effects are all ported
  to SynEngine nodes: `analog`, `bokeh`, `anamorphic_lab`, `blob_reveal`,
  `blob_tracker`. `src/engine/nodes.ts` wires all five to their real classes —
  **no DummyNode remains**. `three@0.128.0` is a real dep (added in Phase 8).
- **Phase 9 (Master MP4 export) DONE**: `public/effects/vendor/mp4-muxer.min.js`
  (real mp4-muxer v5.2.2 UMD, `window.Mp4Muxer`) + `syntech-export.js`
  (`window.SyntechExport`, WebCodecs frame-stepping → MP4). Codec: prefer
  universal H.264, fall back AV1→VP9. Video-only v1 (audio = follow-up).
  `tools/verify/verify-phase9-export.js` 7/7 (valid MP4, frame count + duration
  correct, real ChainLab button exports). Headless has no H.264 encoder → uses
  AV1 in-sandbox; the operator's Chrome uses H.264.
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

## NEXT — Phase 10: Assets & polish (the FINAL phase, IN PROGRESS)

Read `05-ROADMAP.md` Phase 10 + `06-VERIFICATION.md`. Status of the 5 items:
1. **Integrate the 6 operator images** (logo top-left; 5 effect-card covers on
   the right sidebar) — 🔴 **BLOCKED: waiting on the operator to upload them**
   (prompt D in `08-PROMPTS.md`). When delivered: place under
   `public/` (e.g. `public/assets/`), wire the logo slot in the top bar and the 5
   card covers in the right sidebar (`App.tsx`, the `effect-card-<id>` cards +
   `EFFECT_META`). Don't fabricate placeholders as if real.
2. ✅ **Functional search box — DONE** (this session). `App.tsx` `systemSearch`
   state filters the cards by name/id; testids `effect-search` /
   `effect-search-clear` / `effect-search-empty`. Verified
   `tools/verify/verify-phase10-search.js` 6/6.
3. **Vendor CDN deps locally** — three.js, MediaPipe models, fonts — 🟡 **needs an
   operator decision**: the effect HTMLs load these from CDNs, and repointing
   their `<script src>` edits the five `public/effects/*/index.html` OUTSIDE the
   bridge blocks, which brushes against hard rule #1 (never rewrite them). The
   shell-side CDN use (PersonMask MediaPipe in `PersonMask.ts`, fonts) CAN be
   vendored freely. Confirm scope with the operator before touching the HTMLs.
4. **Perf pass** — 5-effect chain ≥30fps@720p or graceful adaptive-res — ⚪ a
   GPU-machine check; unassessable under sandbox SwiftShader (~1–2fps). Runs on
   the operator's machine.
5. **Colour sweep / day-mode audit** — 🟡 the shell is largely token-compliant
   (violet `#8b5cf6` accent + neutrals); the only off-palette hexes are 4 one-off
   chromatic colours (`#e0913f` amber, `#e0554b` red, `#c65b9c` pink, `#6ea8e0`
   blue) that look like intentional semantic colours — a subjective refinement to
   confirm with the operator, not to change blindly.

**Items 1, 3, 5 all need the operator; item 4 needs a GPU machine.** So Phase 10
is effectively **paused pending the operator's images + a couple of decisions** —
there is no further cleanly-autonomous Phase-10 work. The audio track in the MP4
export (Phase 9 was video-only) is a reasonable optional follow-up the muxer
already supports.
5. **Colour sweep** — stray non-`--syn-*`/off-palette colours; day-mode audit.

Items 2–5 can proceed WITHOUT the images; item 1 waits on the operator.
Audio in the MP4 export is a reasonable follow-up too (the muxer supports an
audio track; v1 is video-only). Persistence stays localStorage (hard rule #7).

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
