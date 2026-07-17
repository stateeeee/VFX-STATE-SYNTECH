# VFX SYNTECH — Project Brief for Claude

VFX SYNTECH is a browser-based, audio/video-reactive VFX web app for videomakers,
built by a professional director ("State"). It applies curated, high-end visual
effects to video files, images, and webcam input — faster and more intuitively
than After Effects or TouchDesigner. React 19 + Vite + Tailwind v4 shell, five
standalone WebGL/Canvas effect apps, and a shared WebGL2 engine (SynEngine) for
chaining effects.

**Before doing ANY work, read `docs/workflow/STATE.md`** — it tracks what is
done, what is next, and every decision made so far. Then follow
`docs/workflow/07-SESSION-PROTOCOL.md` for how to run the session.

## The workflow documents (docs/workflow/)

| File | What it contains |
|---|---|
| `STATE.md` | **Live progress tracker. Read first, update before every push.** |
| `01-VISION.md` | Product vision, the 4 pillars, quality bar, target user |
| `02-ARCHITECTURE.md` | Repo map, engine design, iframe vs SynEngine, known gaps |
| `03-SPEC-SHELL.md` | Exact functional spec of the app shell (Home, Save, AI Lab, node wiring) |
| `04-SPEC-EFFECTS.md` | Per-effect inventory: tech, parameters, reactive features |
| `05-ROADMAP.md` | Phased implementation plan with acceptance criteria per phase |
| `06-VERIFICATION.md` | How to verify each phase (commands, Playwright, parity protocol) |
| `07-SESSION-PROTOCOL.md` | How every work session must start, run, and end |
| `08-PROMPTS.md` | The prompts the operator pastes to drive each session |

## Commands

```bash
npm install          # first time only
npm run dev          # tsx server.ts → http://localhost:3000 (Express + Vite middleware)
npm run lint         # tsc --noEmit (must stay clean)
npm run build        # vite build + esbuild server bundle
```

`GEMINI_API_KEY` in `.env.local` is optional in dev: AI endpoints degrade to
offline fallbacks. Never require it for non-AI features to work.

## Repo map (the parts that matter)

```
server.ts                       Express: /api/gemini/* endpoints, serves /effects statically
src/App.tsx                     Shell: top bar, left nav, layout, composition state, save/projects
src/components/VfxCanvas.tsx    Animated "brain graph" hero (canvas), hub-drag chaining
src/components/NodalComposition.tsx  Node graph panel (INPUT → effects → OUTPUT)
src/components/ChainLab.tsx     AI Lab surface: SynEngine rack, audio/video signals, presets
src/components/EffectHost.tsx   Full-screen iframe host for one standalone effect
src/components/AiDirector.tsx   Gemini panel (art director / agent / optimizer)
src/engine/SynEngine.ts         Shared WebGL2 render graph (real, working)
src/engine/nodes.ts             ★ STUB — DummyNode factory, effects must be ported here 1:1
src/engine/AudioEngine.ts       ★ STUB — FFT bands / beat / BPM / file transport
src/engine/VideoAnalyzer.ts     ★ STUB — motion / brightness signals
src/engine/ParamBus (params.ts) ★ partial — base + modulation routing
src/engine/PersonMask.ts        ★ STUB — MediaPipe selfie segmentation service
src/effects-registry.ts         ModuleId → iframe src mapping
public/effects/<id>/index.html  The 5 standalone effect apps (SOURCE OF TRUTH for effect look)
```

## Hard rules

1. **The five `public/effects/*/index.html` files are the ground truth** for how
   each effect looks and behaves. Never rewrite them. Only additive, clearly
   delimited bridge snippets are allowed (see 03-SPEC-SHELL.md §5).
2. **AI Lab ports must be 1:1** — every parameter, every visual detail of the
   standalone effect, replicated in its SynEngine node and verified with the
   parity protocol in 06-VERIFICATION.md. No "close enough" shortcuts.
3. `ModuleId` values (`blob_tracker`, `analog`, `blob_reveal`, `bokeh`,
   `anamorphic_lab`) are load-bearing across registry, engine, presets, and
   localStorage keys. Never rename them.
4. All UI styling reads from the design tokens in `src/index.css` (`--syn-*`).
   Violet `#8b5cf6` is the accent. No hardcoded off-palette colors.
5. `npm run lint` must be clean before every commit.
6. Do not add dependencies unless a phase explicitly calls for it.
7. Persistence is `localStorage` for v1 (sessions, presets, effect settings).
   No backend state.
8. Update `docs/workflow/STATE.md` (progress log + next step) in the same
   commit as the work it describes, then push.
