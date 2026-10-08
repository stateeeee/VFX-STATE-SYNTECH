# 02 — ARCHITECTURE

## Stack

- **Shell**: React 19 + TypeScript + Vite 6, Tailwind v4 (`@tailwindcss/vite`),
  `lucide-react` icons, `motion`, `react-resizable-panels`.
- **Server**: `server.ts` (Express, port `PORT` or 3000, launched via `tsx`;
  loads `.env.local`, then `.env`). Serves the Vite app, statically serves
  `public/effects` at `/effects`, and exposes the six Gemini 3.8 endpoints
  under `/api/gemini/*` (see "Gemini 3.8 layer" below). There are no offline
  AI answers: without a key the AI modes are simply locked, and nothing that
  is not AI ever needs one.
- **Effects**: five fully standalone single-file HTML apps in
  `public/effects/<id>/index.html`. Each has its own UI, video/webcam input,
  parameters, audio reactivity, and MediaRecorder export. They currently have
  **no communication bridge** with the shell.
- **Engine**: `src/engine/SynEngine.ts` — one WebGL2 context; the source video
  is uploaded once per frame and flows through enabled `EngineNode`s in series
  via ping-pong framebuffers. Includes adaptive internal resolution (steps
  1 → 0.75 → 0.5 when FPS < 45) and a deterministic `renderFrame(clock)` for
  offline export. **The engine core is real and working; the nodes are not.**

## Two rendering worlds (why both exist)

| | Single-effect mode | Lab (chain) |
|---|---|---|
| Surface | `EffectHost.tsx` iframe | `ChainLab.tsx` canvas |
| Renderer | The standalone HTML itself | SynEngine + one `EngineNode` per effect |
| Fidelity | Ground truth | Must be **1:1 port** of the ground truth |
| Why | The HTMLs are finished, polished apps | Two iframes cannot share a video frame; chaining requires one GL context |

This split is a hard architectural fact: browser iframes cannot pipe pixels to
each other at speed. Anything that must compose effects in series lives in
SynEngine.

## State flow (already implemented in the shell)

- `App.tsx` owns the **composition state**: `compEffects: {id, enabled}[]`
  (persisted to localStorage `syntech.composition.v2`) and the shared source
  (`compSource`: a video or a still photo — an object URL owned by the shell,
  plus the picked File and its name/kind/mime/size, which the Gemini panel
  uses to decide upload vs frames).
- `NodalComposition.tsx` renders that state as INPUT → effect nodes → OUTPUT.
- `ChainLab.tsx` opens with the same enabled chain and the same source; its
  rack order/bypass/params/mod-routes can be saved as presets
  (`syntech.chainPresets`), which the Projects modal lists.
- `VfxCanvas.tsx` (brain graph) can chain hubs by drag; that calls back into
  the same composition state.
- Save nav button currently stores `{activeModule, isDayMode}` to
  `syntech.session` — Phase 1 extends save semantics (see 03-SPEC-SHELL §4).

## Gemini 3.8 layer (panel ⇄ our server ⇄ Google)

One provider, Gemini only, because it can SEE: every role sends real pixels
and/or audio. Model `gemini-3.8-flash` (`GEMINI_MODEL` overrides it), through
`@google/genai`. The Groq provider added on 2026-07-31 is gone — text-only, it
could only guess from a filename. Product behavior: 03-SPEC-SHELL §9.

| File | Side | Owns |
|---|---|---|
| `src/ai/contract.ts` | both | The wire format: request/response types, error kinds, the safety lists (`ENUM_KEYS`, `CARRIER_KEYS`, `PROTECTED_KEYS`, `PARAM_FLOORS`, `MAX_ROUTE_AMOUNT`, `CARRIER_AMOUNT_MIN/MAX`), `MAX_UPLOAD_BYTES`, `INLINE_VIDEO_FPS`, the `LabHandle` and `PlanUndo` interfaces. Types and constants only. |
| `src/ai/client.ts` | browser | The panel's only road to the server: the pasted key (localStorage `syntech.geminiKey`, sent only in `x-gemini-key`), `AiError`, the upload and its cache (`syntech.geminiFiles`, reused until ~1h before Google's ~48h expiry). |
| `src/ai/capture.ts` | browser | One-shot capture on a button press: JPEG stills, frames sampled from a video URL through a hidden `<video>`, a short webm of the Lab canvas with its audio. Releases everything it made before returning. |
| `src/components/AiDirector.tsx` | browser | The panel: key form, the three role tabs, Apply/Undo, the art-direction handoff. |
| `src/components/ChainLab.tsx` | browser | Implements `LabHandle` for the panel: frame pair, source frames, output clip, signal summary, chain state, `applyPlan` / `revertPlan`, `startClipAudio`. |
| `ai-provider.ts` | server | Key resolution (header → `GEMINI_API_KEY` for loopback clients only → none), one client per key, Google errors → `AiErrorKind`, `generateJson`, Files API upload + wait. `GEMINI_BASE_URL` is a test hook (the mock), never set in real use. |
| `ai-roles.ts` | server | Per role: system prompt, response JSON schema built per request (parameter-key enums from the chain actually sent, plus a loose schema for one retry), the parts builder (every media item labelled; inline video at `INLINE_VIDEO_FPS`), and the validator that clamps and filters every answer. |
| `server.ts` | server | The endpoints, the host guard, upload streaming to a temp file (stale ones swept at boot). |

Endpoints: `GET /api/gemini/status`, `POST /api/gemini/key`,
`/api/gemini/upload`, `/api/gemini/art-director`, `/api/gemini/agent`,
`/api/gemini/optimizer`. Every failure is `{ error, message }`; any other
`/api` path is a 404 in that shape (the old `/chat`, `/analyze-video`,
`/optimize`, `/analyze` are gone).

Key: pasted in the panel (normal way), or `GEMINI_API_KEY` in `.env.local`
(see `.env.example`) — used only for requests from this machine (loopback),
so a LAN client must paste its own. `/api` answers only on a `localhost` or
IP-literal `Host` (DNS rebinding). The key is never logged, never in a URL.

## The engine service layer (currently stubs — the core porting prerequisite)

| File | Status | Must become |
|---|---|---|
| `src/engine/nodes.ts` | `DummyNode` passthroughs | Real 1:1 `EngineNode` port of each effect (Phases 4–8) |
| `src/engine/AudioEngine.ts` | inert stub | WebAudio FFT: bass/loud/treble 0..1, beat pulse, BPM estimate; mic mode + audio-file mode with transport (play/pause/seek/loop) |
| `src/engine/VideoAnalyzer.ts` | inert stub | Per-frame motion (frame differencing) and brightness 0..1 on a small downsampled buffer |
| `src/engine/params.ts` (ParamBus) | partial | Base values + modulation routing: `final = clamp(base + signal × amount × range)`; snapshot/serialize/restore already sketched |
| `src/engine/PersonMask.ts` | inert stub | Shared MediaPipe SelfieSegmentation service producing a mask canvas; lazy-loaded, one instance for the whole chain |

`ChainLab.tsx` already calls all of these correctly every frame
(`engine.beforeFrame`) — implementing the services lights up the existing UI
(signal meters, BPM readout, `~` mod-routing chips, SEG status).

## Known gaps and traps (verified by inspection)

1. **Effect HTMLs load CDNs at runtime**: three.js r128 (blob_tracker),
   MediaPipe SelfieSegmentation (blob_reveal, bokeh, anamorphic_lab), Google
   Fonts. Dev/prod need network; vendoring locally is a polish-phase task.
2. **Master export vendor files are missing**: `ChainLab.runMasterExport`
   loads `/effects/vendor/mp4-muxer.min.js` and
   `/effects/vendor/syntech-export.js`, which do not exist yet. The "Master
   MP4" button fails until the export phase implements them.
3. **Leftover one-off codemod scripts** in the repo root (`fix_*.cjs`,
   `replace_*.cjs`, `close_div.cjs`, `revert_borders.cjs`,
   `update_vfxcanvas.cjs`, `fix_colors.js`, `recover_git.py`) are dead weight —
   delete in Phase 0.
4. **EffectHost props are placeholders**: `onTelemetry/onParams/onSendReady`
   exist but nothing is wired; the bridge (03-SPEC-SHELL §5) gives them
   meaning.
5. **iframe permissions**: `allow="camera; microphone"` is already set on the
   effect iframe — keep it.
6. The old `public/effects/blob_tracker/index.html` was replaced by the
   operator's current official build (2026-07-17). The five HTMLs now in the
   repo are the authoritative versions.

## Naming

`ModuleId` = `'blob_tracker' | 'analog' | 'blob_reveal' | 'bokeh' |
'anamorphic_lab'` (`src/types.ts`). These ids key the registry, the node
factory, presets, and localStorage. Display names live in
`EFFECT_META` (NodalComposition.tsx) and `App.tsx` modules state.
