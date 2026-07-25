# HANDOFF — session continuation brief

> **Updated 2026-07-25 (late).** Read this AFTER `CLAUDE.md` and
> `docs/workflow/STATE.md`. It is a full rewrite, not another layer: everything a
> fresh session needs to continue **exactly** from where the last one stopped.
>
> Operator speaks **Italian**; repo docs and code comments stay **English**.

---

## 1. Where the project is

**Phases 0–9 are COMPLETE and verified.** All five effects are real 1:1 SynEngine
ports (`analog`, `bokeh`, `anamorphic_lab`, `blob_reveal`, `blob_tracker` — no
DummyNode remains) and the ChainLab **Master MP4** export works end to end.

**Phase 10 (Assets & polish) is done except for two external items.** Beyond the
roadmap, the operator drove a substantial visual pass over several rounds; all of
it is implemented, verified and pushed.

| Phase-10 item | State |
|---|---|
| Operator images — **logo** | ✅ done (definitive iridescent mark) |
| Operator images — **5 effect-card covers** | 🔴 **waiting on the operator's files** (drop-in wiring is live) |
| Functional search box | ✅ done |
| Vendor CDN deps locally | ✅ done, proven 100% offline |
| Perf pass ≥30fps@720p | ⚪ **operator's GPU machine** (self-serve, see §6) |
| Colour / day-mode sweep | ✅ audited; one open question in §6 |

The Phase-10 checkbox in `STATE.md` stays unchecked until the covers land and the
operator confirms the perf run.

---

## 2. What to do next

1. **When the operator delivers the 5 covers** — drop each at
   `public/assets/covers/<ModuleId>.webp` (or `.png` / `.jpg`; ModuleIds:
   `analog`, `anamorphic_lab`, `blob_reveal`, `blob_tracker`, `bokeh`). The
   right-sidebar card renders it under a legibility scrim automatically
   (`EffectCardArt` in `App.tsx`) — **no code change**. Then run
   `verify-phase10-covers.js`, tick Phase 10 in `STATE.md`, commit, push.
2. **Remind the operator about the perf run** (§6) — they asked to be reminded.
3. **Answer their day-mode gradient question** (§6) if they raise it.
4. Nothing else is pending. Optional follow-up, never started: **audio track in
   the MP4 export** (Phase 9 shipped video-only; the vendored muxer already
   supports an audio track).

---

## 3. The visual system as it stands (all operator-directed)

The look was built over four rounds of operator notes. Current state:

**Sections** are **100% opaque black** (`--syn-ink-950/900/850: #000000`). They
read as holes cut over a **gel slab** that shows only in the gaps between them.

**The gel slab** (`.syn-bg-layer`, night mode only — `App.tsx` mounts it when the
dark theme is active; day mode keeps its cream surfaces and renders no slab):
- `.syn-gel-sheet` — the violet→gold ramp, a plate 4× wide with the ramp laid
  twice, sliding by half its width so the loop is seamless.
- `.syn-gel-material` — swell, air bubbles and wet gloss baked into ONE seamless
  640px tile painted on a canvas by `src/lib/gelTexture.ts`, tiled, **unblended**.
- `.syn-bubble` ×28 — discrete bubbles rising through the gel (`GEL_BUBBLES` in
  `App.tsx`, negative delays so the field is already in motion at load).

**The logo** (`public/assets/logo.{png,webp}`, `.syn-logo*`) keeps its inflated
glossy 3D while riding the same ramp: a masked gradient layer supplies the hue and
the mark sits on top in `luminosity` blend, contributing only light and shade. It
is **never inverted** (that would destroy the brand colours); day mode gets a
deeper ramp instead.

**The two wordmarks** share one font (Space Grotesk, **weight 700**, tracking-tight,
Title Case) and one animation, each at its own size (15px top bar / 60px hero).
The hero one is additionally **cast in the gel** (`.hero-gel-text`): four
background layers on one element clipped to the glyphs — tile, lit crown, shaded
base, colour ramp — plus a hairline dark `-webkit-text-stroke` for the moulded rim.
The top-bar one stays plain (at 15px the bubbles would be noise).

**One cadence:** slab, logo and both wordmarks all animate on **6s**, so the whole
brand shifts colour together.

**Day mode** has a deeper gradient variant (`.syn-day .hero-gradient` /
`.hero-gel-text`): the bright gold measured **1.48:1** contrast on the cream top
bar, which is unreadable; the deeper violet/amber stops bring it to ~3.8–4.6:1.

**Effect host** adds **nothing** above or below an open effect — the "← BACK TO
GRAPH" + module-name bar is gone and the iframe fills the panel edge to edge. Each
standalone HTML already carries its own header and status bar. Closing is the
sidebar HOME nav (03-SPEC §2). `onBack` stays in the props contract.

**Audio meter** (`src/components/AudioMeter.tsx`) sits in the left sidebar under
OPTIMIZER: one column (channels summed, Premiere-style), green low → amber → red
hot, ticks at −6/−12/−24 dB, white peak-hold, dB readout, RMS over a −54…0 dB
scale, "hot" above −6 dB. It taps the hero `<video>` through WebAudio — the element
ships `muted` so it can autoplay, and **a muted element analyses as silence**, so
the meter unmutes it and routes it through a **gain of 0**: the analyser sees real
samples, playback stays as silent as before, and both are restored on unmount. One
`MediaElementAudioSourceNode` per element is cached in a WeakMap (a second one
throws).

### File map for the visual layer

```
src/index.css                  design tokens + gel slab + logo + wordmark rules
src/lib/gelTexture.ts          canvas-painted seamless gel tile (bubbles/gloss)
src/App.tsx                    slab markup, GEL_BUBBLES, logo, wordmarks, meter mount
src/components/AudioMeter.tsx  the sidebar level meter
src/components/EffectHost.tsx  bare iframe host (no chrome)
src/components/VfxCanvas.tsx   reads --syn-hero-canvas (opaque | transparent)
public/assets/logo.{png,webp}  the definitive mark (png = keyed, webp = original)
docs/design/textures/          the operator's two backdrop artworks — REFERENCE ONLY
tools/preview/bg-texture-preview.cjs   renders the (superseded) photo-backdrop idea
```

---

## 4. ⚠️ Traps that will bite you

**FRAME-COST CONTRACT for the backdrop — no blend modes, no filters, animate
`transform` only.** Anything blended or filtered over the sliding ramp is
re-composited every frame; without a GPU that lands on the CPU and **skews
AudioEngine's BPM estimate**, because beat detection reads spectral flux BETWEEN
frames. Measured on `verify-phase3`'s BPM check (target 120):

| backdrop | BPM |
|---|---|
| `filter: blur()` on a full-viewport layer | 189 ❌ |
| four blended layers | 171 ❌ |
| one blended layer | 138 ❌ |
| **zero blends, zero filters** | **120–124 ✅** |

`verify-ui-gel-pass.js` asserts zero blended layers and zero filters in the slab;
phase 3's BPM check is the canary. **Don't reintroduce either.**

**Three traps in the hero wordmark**, all now asserted — each was invisible in a
still frame:
1. The ramp layer **must repeat**. It is 200% wide and slides a full 200%, so with
   `no-repeat` it scrolls clean out of the box and the glyphs — being
   `color: transparent` — drop to **black** for part of every cycle.
2. The lighting must be **vertical** (lit crown over shaded base). A dome at the
   top-left plus a shadow at the bottom-right sums to a left-to-right ramp that
   sinks the tail of the word into black.
3. The tile must be drawn at its **natural 640px**. Any other `background-size`
   makes the browser resample a 640² image on every repaint of the animated
   wordmark (BPM 133 vs 120).

**Other standing gotchas:**
- **The dev server serves STALE code after a source edit in this sandbox.**
  Restart before every verify run: `fuser -k 3000/tcp` (NOT `pkill -f 'tsx
  server.ts'` — that pattern does not match the real cmdline), then `npm run dev`
  in the background, then poll `curl -s -o /dev/null -w '%{http_code}'
  http://localhost:3000` for 200. Vendored `public/` files are static and need no
  restart.
- **The ParamBus pushes each param's base every frame**, so a headless
  `node.setParam(k,v)` is reverted next frame — drive params through the UI control
  (`param-<id>-<key>` testid, which calls `bus.setBase`). Read routes via
  `window.__SYN.bus.state`.
- **Injecting a PersonMask** must neutralise `__SYN.mask.enable`/`.tick` first,
  then set `.maskCanvas`/`.ready`/`.state='ready'` and bump `.version`.
- **`page.screenshot` starves under GL load** — grab canvases with `toDataURL`.
- **Never write a repo file while a suite drives the shell** (Vite HMR reload kills
  the run) — stage suites in the scratchpad, edit repo copies between runs.
- **fps ≥30@720p stays a GPU-machine criterion** — the chain runs ~1–2 fps under
  sandbox SwiftShader. Verify behaviourally, flag fps for the operator.
- The container can restart mid-session. `npm install` again only if
  `node_modules` is gone.
- **Watch the block-comment `*/` trap**: a literal `ar-*/vr-*` inside a `/* */`
  comment closes it early. Write `ar-* / vr-*`.

---

## 5. Verification harness

Suites live in `tools/verify/`. The repo is `"type": "module"`, so **copy each
suite to the scratchpad as `.cjs`** and run it from there:

```bash
S=<scratchpad>
cp tools/verify/verify-ui-gel-pass.js "$S/vgel.cjs"
NODE_PATH=/opt/node22/lib/node_modules node "$S/vgel.cjs"
```

Chromium: `executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`,
args `--no-sandbox --enable-unsafe-swiftshader
--autoplay-policy=no-user-gesture-required`.

**Fixture rebuild** (scratchpads do not carry over) — `sed 's|__SCRATCH__|'$S'|g'`
the suites and the generators, then:
- `node gen1080.cjs` → `parity1080.webm`; `cp parity1080.webm test.webm`
- `node makebeat.cjs` → `beat120.wav` (phase 3 needs both)
- **a clip WITH audio** for the meter test: the generator lives in the scratchpad
  (`gen-audio-video.cjs` — canvas stream + an oscillator whose gain ramps quiet→hot,
  recorded with MediaRecorder). Pass it as `AUDIO_CLIP=<file>` to
  `verify-ui-gel-pass.js`, which otherwise SKIPS the level assertions. Recreate it
  if lost; the existing fixtures are video-only, so the meter would legitimately
  read zero.
- Standalone parity also needs `npm pack three@0.128.0 @mediapipe/selfie_segmentation`
  extracted into `$S/cdn/...` — **though CDN mirroring is no longer needed since
  Phase 10 vendored everything locally.**

**Current green baseline** (re-run these after any shell change):

| suite | result |
|---|---|
| `verify-ui-gel-pass.js` (needs `AUDIO_CLIP`) | **36/36** |
| `verify-phase10-brand.js` | 13/13 |
| `verify-phase10-search.js` | 6/6 |
| `verify-phase10-covers.js` | 7/7 |
| `verify-phase10-vendor.js` | 19/19 |
| `verify-phase10-vendor-lazy.js` | 6/6 |
| `verify-phase1.js` | 21/21 |
| `verify-phase2.js` | 26/26 |
| `verify-phase3.js` | 14/14 (**BPM 120** — the frame-cost canary) |
| `verify-phase9-export.js` | 7/7 |
| phase 8 layer suites (L1…L7c, chain) | all green |

`npm run lint` (= `tsc --noEmit`) and `npm run build` must both be clean before
every commit.

---

## 6. Open operator items

1. **The 5 effect-card covers** — see §2.
2. **🔔 Perf run — the operator asked to be reminded.** It is self-serve, no
   tooling: open **AI Lab**, wire the 5-effect chain, play a 720p clip and read
   ChainLab's live **FPS** / **RES%** badges (`chain-fps` / `chain-res`). The engine
   already does graceful adaptive-res (auto down/upscale in
   `SynEngine.evalAdaptiveRes`), so an amber RES% below 100 satisfies the "or
   graceful adaptive-res" half of the acceptance.
3. **Day-mode title gradient** — deeper stops (current, legible) vs the identical
   bright night ramp. Their call; one CSS block to revert.
4. **Full-resolution artwork** is moot for now: the photographic backdrop was
   superseded by the gel slab, and `docs/design/textures/` is reference only.

---

## 7. Branch and merge state

Work happened on **`claude/vfx-syntech-fase-10-ofhpna`**. On 2026-07-25 the
operator asked for it to be **merged into `main`**, which was done (12 commits, no
open PR before it). So:

- If `main` already contains this work, **start the next session from `main`** — or,
  if you keep the same branch name, restart it from the latest `origin/main`
  (`git fetch origin main && git checkout -B claude/vfx-syntech-fase-10-ofhpna
  origin/main`). **Never stack new commits on already-merged history.**
- A merged pull request is finished: follow-up work needs a fresh branch/PR.

## 8. Protocol reminders

`npm run lint` clean before every commit; keep the app working at every commit;
update `STATE.md` in the same commit as the work it describes, then push. Never
touch the five `public/effects/*/index.html` files outside the delimited bridge
blocks — **the one authorised exception** (operator, 2026-07-25) is the vendored
`<script>` / `locateFile` / `import()` paths for offline CDN independence. The
ModuleIds (`blob_tracker`, `analog`, `blob_reveal`, `bokeh`, `anamorphic_lab`) and
the `--syn-*` tokens are load-bearing. Persistence stays `localStorage`.
