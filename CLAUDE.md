# VFX SYNTECH — Project Brief for Claude

VFX SYNTECH is a browser-based, audio/video-reactive VFX web app for videomakers,
built by a professional director ("State"). It applies curated, high-end visual
effects to video files, images, and webcam input — faster and more intuitively
than After Effects or TouchDesigner. React 19 + Vite + Tailwind v4 shell and ten
standalone WebGL/Canvas effect apps. The Lab chains the REAL effects: one iframe
per node, each fed the previous node's output stream (LAB v2, 2026-10-28). The
older WebGL2 engine (SynEngine, 1:1 ports of five effects) stays in the repo but
no longer runs the Lab.

**Before doing ANY work, read `docs/workflow/STATE.md`** — it tracks what is
done, what is next, and every decision made so far. Then follow
`docs/workflow/07-SESSION-PROTOCOL.md` for how to run the session.

## The workflow documents (docs/workflow/)

| File | What it contains |
|---|---|
| `STATE.md` | **Live progress tracker. Read first, update before every push.** |
| `01-VISION.md` | Product vision, the 4 pillars, quality bar, target user |
| `02-ARCHITECTURE.md` | Repo map, the LAB v2 iframe chain + SynLab contract, known gaps |
| `03-SPEC-SHELL.md` | Exact functional spec of the app shell (Home, Save, AI Lab, node wiring) |
| `04-SPEC-EFFECTS.md` | Per-effect inventory: tech, parameters, reactive features |
| `05-ROADMAP.md` | Phased implementation plan with acceptance criteria per phase |
| `06-VERIFICATION.md` | How to verify each phase (commands, Playwright, parity protocol) |
| `07-SESSION-PROTOCOL.md` | How every work session must start, run, and end |
| `08-PROMPTS.md` | The prompts the operator pastes to drive each session |
| `09-MODEL-ROUTING.md` | **Which model does which task** (Haiku / Sonnet / Opus) + the mandatory Opus review gate |
| `10-EXPORT-MASTER.md` | Offline frame-by-frame MP4 render (RENDER MP4): why realtime REC loses quality/fps, the SynExport design |
| `11-EXPORT-STILLS-LAB.md` | Photo export PNG · JPEG · PDF (SynStill, real alpha, native size) + the Lab's offline frame-by-frame render (SynFx) |
| `DESKTOP.md` | The double-click desktop app (Electron): how it is built, tested, delivered |

## Commands

```bash
npm install          # first time only
npm run dev          # tsx server.ts → http://localhost:3000 (Express + Vite middleware)
npm run lint         # tsc --noEmit (must stay clean)
npm run build        # vite build + esbuild server bundle
npm run desktop      # build + open the desktop app (Electron, unpackaged)
npm run desktop:dist # package the desktop app for this OS into release/
```

The desktop app (Windows .exe + macOS .zip) is built and tested on every push
by `.github/workflows/desktop.yml` — see `docs/workflow/DESKTOP.md`.

The Gemini panel (Art Director / Agent / Optimizer) needs a Gemini key:
paste it in the panel, or put `GEMINI_API_KEY` in `.env.local` (used only for
browsers on this machine). Without a key the AI modes are simply locked — there
are no offline AI answers. No non-AI feature ever needs a key; never make one
require it. The model + effort are picked IN the panel (default
`gemini-4-hydrogen` · High; the list comes from Google, so new models appear by
themselves — 03-SPEC-SHELL §9.14); the operator stays on free models. The Agent
can change the chain and write a beat-synced cue timeline (§9.15).

## Repo map (the parts that matter)

```
server.ts                       Express: /api/gemini/* endpoints, serves /effects statically
ai-provider.ts                  Gemini client: key resolution (header / loopback .env), errors, Files upload
ai-roles.ts                     The three roles: prompts, per-request schemas, plan validator
desktop/main.ts                 Electron shell: runs server.ts inside the app on 127.0.0.1:47291
src/App.tsx                     Shell: top bar, left nav, layout, composition state, save/projects
src/components/VfxCanvas.tsx    Animated "brain graph" hero (canvas), hub-drag chaining
src/components/NodalComposition.tsx  Node graph panel (INPUT → effects → OUTPUT)
src/components/ChainLab.tsx     Lab surface: iframe chain of the real effects, INPUT + transport, audio, presets, Master MP4, LabHandle, cue engine + lane
src/lab/beatgrid.ts             Beat grid of the source's soundtrack (BPM, phase, energy sections), decoded in the browser
src/lab/cues.ts                 Cue timeline helpers (state at t, snapping, lane segments)
src/lab/offline.ts              Lab offline export: shared-engine loader, OfflineChain (SynFx node by node), native photo decode
src/components/EffectHost.tsx   Full-screen iframe host for one standalone effect
src/components/IntroSplash.tsx  Desktop-app opening: logo → pet video + LOADING 0–100% (browser: ?intro)
src/components/AiDirector.tsx   Gemini panel: key form, model + effort picker, Art Director / Agent / Optimizer, Apply/Undo
src/ai/contract.ts              Panel ⇄ server wire format: types, safety lists, LabHandle
src/ai/client.ts                Panel → /api/gemini/*: key header, AiError, upload cache
src/ai/capture.ts               On-demand capture: JPEG frames, output webm clip
src/engine/SynEngine.ts         WebGL2 render graph + src/engine/nodes/ 1:1 ports — NOT used by the Lab since LAB v2 (kept)
src/engine/AudioEngine.ts       The Lab's audio: clip / track / mic, FFT bands / beat / BPM, meter tap, output stream
src/engine/VideoAnalyzer.ts     ★ STUB — motion / brightness signals
src/engine/ParamBus (params.ts) ★ partial — base + modulation routing
src/engine/PersonMask.ts        ★ STUB — MediaPipe selfie segmentation service
src/effects-registry.ts         ModuleId → iframe src mapping
public/effects/<id>/index.html  The 10 standalone effect apps (SOURCE OF TRUTH for effect look)
public/effects/shared/          syn-chrome.css/.js — Bokeh's chrome + day theme, shared by all 10 (§5.1); syn-extras.js — work timer + timeline;
                                syn-lab.js — the Lab chain link (window.SynLab, §5.2);
                                syn-export.js — offline MP4 render engine (window.SynExport, §5.3);
                                syn-still.js — PNG / JPEG / PDF of a photo (window.SynStill; each effect's window.SynFx)
```

## Hard rules

1. **The ten `public/effects/*/index.html` files are the ground truth** for how
   each effect looks and behaves. Never rewrite them. Only additive, clearly
   delimited bridge snippets are allowed (see 03-SPEC-SHELL.md §5), plus the
   delimited `SYNTECH-UNIFORM` edits (shared-chrome link, markup, ids, frame
   sizing) that put Bokeh's top bar / frame / panel on every effect (§5.1,
   `public/effects/shared/syn-chrome.css`), plus the delimited `SYNTECH-LAB`
   adapter block that links the effect into the Lab chain (§5.2), plus the
   delimited `SYNTECH-EXPORT` block + `/* SYNTECH-EXPORT */` hooks for the
   offline RENDER MP4 (§5.3, `10-EXPORT-MASTER.md`).
2. **The Lab runs the real effects** (LAB v2, operator decision 2026-10-28 —
   "option 1"): each Lab node is the standalone effect in an iframe with its
   whole interface, fed the previous node's `canvas.captureStream()` as an
   external source through `window.SynLab` (03-SPEC-SHELL §3, §5.2). This
   supersedes the old rule "AI Lab ports must be 1:1 in SynEngine": nothing is
   ported any more, so there is no parity to keep. A new effect joins the Lab by
   getting its `SYNTECH-LAB` adapter — never a reimplementation.
3. `ModuleId` values (`blob_tracker`, `analog`, `blob_reveal`, `bokeh`,
   `anamorphic_lab`, `invisible`, `time_machine`, `quadtree`, `pointcloud`,
   `painting`) are load-bearing across registry, engine, presets, and
   localStorage keys. Never rename them.
4. All UI styling reads from the design tokens in `src/index.css` (`--syn-*`).
   Violet `#8b5cf6` is the accent. No hardcoded off-palette colors.
5. `npm run lint` must be clean before every commit.
6. Do not add dependencies unless a phase explicitly calls for it.
7. Persistence is `localStorage` for v1 (sessions, presets, effect settings).
   No backend state.
8. Update `docs/workflow/STATE.md` (progress log + next step) in the same
   commit as the work it describes, then push.
9. Route work by model per `docs/workflow/09-MODEL-ROUTING.md` (agents in
   `.claude/agents/`: `syn-scout` Haiku, `syn-builder` Sonnet, `syn-architect`
   Opus, `syn-reviewer` Opus). Nothing is committed without the Opus
   reviewer's PASS on the full diff.
