# HANDOFF — session continuation brief (updated 2026-07-24, Phase 10 near-complete)

> For the next Claude session. Read this AFTER `CLAUDE.md` and `STATE.md`.
> **Phases 0–9 complete; Phase 10 (Assets & polish) is now substantially DONE**
> — logo integrated, search box done, **CDN deps fully vendored + proven
> offline**, colour/day-mode audited. **Only two items remain, both external:**
> the **5 effect-card covers** (operator finishing them; drop-in wiring is live)
> and the **≥30fps@720p perf pass** (a GPU-machine run — the operator asked to be
> reminded). See NEXT.
>
> **Branch state (2026-07-24):** this session's work is on
> `claude/vfx-syntech-fase-10-ofhpna` (level with `origin/main` at start). If by
> the time you read this that branch shows MERGED into `main`, restart the SAME
> branch name from the latest `origin/main` (`git fetch origin main && git
> checkout -B claude/vfx-syntech-fase-10-ofhpna origin/main`) before new work —
> do NOT stack new commits on merged history.
>
> **Covers drop-in (no code needed):** put each cover at
> `public/assets/covers/<ModuleId>.webp` (or `.png`/`.jpg`) — ModuleIds
> `analog`, `anamorphic_lab`, `blob_reveal`, `blob_tracker`, `bokeh` — and the
> right-sidebar card renders it under a scrim automatically (`EffectCardArt` in
> `App.tsx`).
>
> **Brand (done 2026-07-25):** the DEFINITIVE iridescent logo is in at
> `public/assets/logo.{webp,png}` (multicolour → never inverted; keyed with the
> central hole preserved). The two "VFX Syntech" titles are unified — top-bar font
> + hero shimmer on both, each at its own size. A `.syn-day .hero-gradient`
> variant (same animation, deeper stops) fixes day-mode legibility (was 1.48:1).
>
> **Current look (2026-07-25, latest operator pass):** sections are **100% opaque
> black**; the gaps between them show `.syn-bg-layer`, an animated violet→gold
> **"gel" LED slab** on the same ramp as the wordmarks. The logo rides that ramp
> too while keeping its glossy 3D (masked gradient + `luminosity` blend). The
> effect host adds **no chrome** above or below an open effect. A single-column
> **playback level meter** sits in the sidebar under OPTIMIZER (`AudioMeter.tsx`,
> taps the hero video through WebAudio at gain 0). Wordmarks are at weight 700.
> Verified by `verify-ui-gel-pass.js` (27/27, pass `AUDIO_CLIP=<webm with audio>`).
>
> The gel's material (swell, air bubbles, gloss) is a seamless 640px tile painted
> once on a canvas by `src/lib/gelTexture.ts` and tiled as a single unblended
> layer; only the rising bubbles and the sliding ramp move.
>
> ⚠️ **FRAME-COST CONTRACT for the backdrop: no blend modes, no filters, animate
> `transform` only.** Anything blended or filtered over the sliding ramp is
> re-composited every frame — on a GPU-less machine that lands on the CPU and skews
> AudioEngine's BPM estimate, because beat detection reads spectral flux between
> frames. Measured: **blur → 189 BPM, four blend layers → 171, one → 138, none →
> 124** (target 120). `verify-ui-gel-pass.js` asserts zero blended layers and zero
> filters in the slab; phase 3's BPM check is the canary. Don't reintroduce either.
>
> **OPEN OPERATOR ITEM:** the **day-mode title gradient** (deeper stops for
> legibility vs the identical bright ramp).

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

## NEXT — Phase 10: Assets & polish (the FINAL phase — 2 items left)

Read `05-ROADMAP.md` Phase 10 + `06-VERIFICATION.md`. Status of the 5 items:
1. **Operator images** — **logo ✅ DONE** (recovered from the chat upload →
   `public/assets/logo.{webp,png}`, wired sidebar top-left, theme-aware).
   **5 effect-card covers 🟡 still pending** (operator finishing them). Drop-in
   wiring is LIVE (`EffectCardArt` in `App.tsx`): drop
   `public/assets/covers/<ModuleId>.{webp,png,jpg}` and the card renders it — no
   code change. Don't fabricate the covers.
2. ✅ **Functional search box — DONE.** `verify-phase10-search.js` 6/6 (re-ran
   6/6 this session after the card refactor).
3. ✅ **Vendor CDN deps — DONE + verified 100% offline** (operator authorised the
   `<script>` edits). three.js r128 + all MediaPipe (SIMD wasm; pose lite only) +
   self-hosted fonts under `public/effects/vendor/`; all five effect HTMLs +
   `PersonMask.ts` repointed. `verify-phase10-vendor.js` **19/19** (zero CDN
   requests, THREE/SelfieSegmentation from vendor, fonts render) + a wasm-init run
   (5.6 MB simd wasm + tflite ran offline). Retires the old sandbox CDN gotcha.
4. **Perf pass** — 5-effect chain ≥30fps@720p — ⚪ still a **GPU-machine check**
   (~1–2 fps under sandbox SwiftShader). **The operator explicitly asked to be
   reminded to run this when everything else is closed** — do so. Self-serve, no
   tooling: AI Lab → wire the 5 nodes → play a 720p clip → read ChainLab's live
   **FPS**/**RES%** badges. Graceful adaptive-res already ships (auto down/upscale
   in `SynEngine.evalAdaptiveRes`), so an amber RES% <100 satisfies the "or
   graceful adaptive-res" half of the acceptance.
5. ✅ **Colour / day-mode audit — DONE.** `src/` hex grep = violet accent family +
   neutrals + intentional per-effect accents only. Operator chose to **keep** the
   4 one-off colours ("lasciarli"). Day mode re-verified with the logo change.

**Only items 1-covers (operator) and 4-perf (GPU machine) remain** — no further
cleanly-autonomous Phase-10 work until the covers land. Optional follow-up: audio
track in the MP4 export (Phase 9 was video-only; the muxer supports an audio
track). Persistence stays localStorage (hard rule #7).

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
