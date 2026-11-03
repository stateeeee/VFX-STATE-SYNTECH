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
- **Desktop**: `desktop/main.ts` (Electron) runs the same `server.ts` inside
  the app on `127.0.0.1:47291` (fixed: localStorage is per-origin) and opens one
  window on it. Packaged by `electron-builder.yml`, built + tested for Windows
  and macOS by `.github/workflows/desktop.yml`. See `DESKTOP.md`.
- **Effects**: ten fully standalone single-file HTML apps in
  `public/effects/<id>/index.html`. Each has its own UI, video/webcam input,
  parameters, audio reactivity. They talk to the shell through three additive,
  delimited blocks: `SYNTECH-BRIDGE` (settings save/restore, 03 §5),
  `SYNTECH-UNIFORM` (the shared chrome + day theme, 03 §5.1) and `SYNTECH-LAB`
  (the Lab chain link `window.SynLab`, 03 §5.2).
- **Engine (legacy)**: `src/engine/SynEngine.ts` + `src/engine/nodes/*` — one
  WebGL2 context with 1:1 ports of the first five effects (Phases 4–9). Since
  LAB v2 (2026-10-28) the Lab no longer runs it; the code stays in the repo,
  unused, in case a future need for an offline frame-stepped render comes back.
  `AudioEngine` and `VideoAnalyzer` ARE still used by the Lab.

## One rendering world: the real effects (LAB v2, 2026-10-28)

| | Single-effect mode | Lab (chain) |
|---|---|---|
| Surface | `EffectHost.tsx`: one iframe | `ChainLab.tsx`: one iframe per wired node, stacked in the same rect |
| Renderer | The standalone HTML itself | The same standalone HTMLs, chained |
| Fidelity | Ground truth | Ground truth (it IS the effect, whole interface) |

Until 2026-10-27 the Lab was a second renderer (SynEngine) with 1:1 ports of
five effects, on the assumption that iframes cannot pipe pixels to each other.
They can: `canvas.captureStream()` in one same-origin iframe is a `MediaStream`
the next iframe plays as its video source. The operator chose this ("option 1")
so that all ten effects are in the Lab with their own complete panels.

**The chain.** `INPUT → effect 1 → … → effect N → OUTPUT`:
- INPUT is shell-owned: a `<video>` (file; its `captureStream()` video track),
  a canvas the photo is drawn to (captured), or the webcam stream.
- Each hop: `SynLab.captureStream()` of node i → `SynLab.setVideoStream()` of
  node i+1 — an **external stream** source, never the webcam path (no mirror).
- OUTPUT = node N's stream (shown clean in the OUTPUT tab, recorded by Master
  MP4, sampled by Gemini).
- Every node iframe stays rendered (stacked under the one being edited): a
  `display:none` / offscreen iframe is throttled by Chromium and would stall
  the chain.
- Audio: `AudioEngine` (clip / track / mic) plays the sound once, feeds the
  sidebar meter, and its output stream goes to every node's
  `SynLab.setAudioStream()` — each effect reacts with its own analyser; no
  effect plays it.
- Day/night: every effect iframe carries `data-syn-theme` and gets
  `syn:theme` messages (03 §5.1).

**`window.SynLab`** (generic half `public/effects/shared/syn-lab.js`, adapter
per effect in its `SYNTECH-LAB` block):

```ts
interface SynLabParam {
  key: string;          // DOM id, 'knob:<data-id>', or an adapter key ([A-Za-z0-9_:-])
  label: string; group: string;            // panel label, panel section title
  type: 'number' | 'boolean' | 'enum';
  min: number; max: number; step: number; value: number;  // enum = option index
  options?: string[]; locked?: boolean;
}
interface SynLabApi {
  version: 1; id: ModuleId; ready: boolean;
  setVideoStream(s: MediaStream | null): void;  // external source, no mirror, pill "LAB"
  setAudioStream(s: MediaStream | null): void;  // reactivity input, never to the speakers
  outputCanvas(): HTMLCanvasElement | null;     // final picture (composited if stacked)
  captureStream(): MediaStream | null;          // cached captureStream of outputCanvas
  params(): SynLabParam[];                      // the look controls (no Source/Export/Info)
  setParam(key: string, v: number): boolean;    // same events as a user gesture
  getSettings(): unknown; applySettings(s: unknown): void;  // = SYNTECH-BRIDGE collect/apply
  state(): { hasSource: boolean; external: boolean; fps: number };
}
```

Gemini's `LabHandle` (src/ai/contract.ts) is built on it: parameter keys are
`<ModuleId>.<SynLabParam.key>`; there are no ParamBus routes any more (each
effect's audio response is tuned through its own panel controls).

## State flow (already implemented in the shell)

- `App.tsx` owns the **composition state**: `compEffects: {id, enabled}[]`
  (persisted to localStorage `syntech.composition.v2`) and the shared source
  (`compSource`: a video or a still photo — an object URL owned by the shell,
  plus the picked File and its name/kind/mime/size, which the Gemini panel
  uses to decide upload vs frames).
- `NodalComposition.tsx` renders that state as INPUT → effect nodes → OUTPUT.
- `ChainLab.tsx` opens with the same wired chain and the same source; a chain
  preset (`syntech.chainPresets`, v2 = chain order + each node's
  `SynLab.getSettings()`) is listed by the Projects modal. Old v1 presets
  (SynEngine params) load their chain order only.
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
| `ai-provider.ts` | server | Key resolution (header → `GEMINI_API_KEY` only for a browser on this machine: loopback socket, no relay header, `Host` localhost / loopback → none), one client per key, Google errors → `AiErrorKind`, `generateJson`, Files API upload + wait. `GEMINI_BASE_URL` is a test hook (the mock), never set in real use. |
| `ai-roles.ts` | server | Per role: system prompt, response JSON schema built per request (parameter-key enums from the chain actually sent, plus a loose schema for one retry), the parts builder (every media item labelled; inline video at `INLINE_VIDEO_FPS`), and the validator that clamps and filters every answer. |
| `server.ts` | server | The endpoints, the host guard, upload streaming to a temp file (stale ones swept at boot). |

Endpoints: `GET /api/gemini/status`, `POST /api/gemini/key`,
`/api/gemini/upload`, `/api/gemini/art-director`, `/api/gemini/agent`,
`/api/gemini/optimizer`. Every failure is `{ error, message }`; any other
`/api` path is a 404 in that shape (the old `/chat`, `/analyze-video`,
`/optimize`, `/analyze` are gone).

Key: pasted in the panel (normal way), or `GEMINI_API_KEY` in `.env.local`
(see `.env.example`) — used only by a browser on this machine talking to the
server directly (loopback socket, no `Forwarded` / `X-Forwarded-*` /
`X-Real-IP` header, `Host` localhost / `*.localhost` / a loopback address),
so a LAN client, or anyone through a proxy or tunnel, must paste its own.
`/api` answers only on a `localhost` / `*.localhost`, IP-literal or `*.local`
`Host`, plus the names in `ALLOWED_HOSTS` (`*` disables the check) — the
DNS-rebinding guard; any other name gets a 403 whose message says what to
add. The key is never logged, never in a URL.

## The engine service layer (history)

Built for the SynEngine Lab (Phases 3–9). Since LAB v2 only `AudioEngine`
(the Lab's clip / track / mic, bands, beat, BPM, meter tap, output stream) and
`VideoAnalyzer` (motion / brightness on the INPUT, for Gemini's signals) are in
use; `SynEngine`, `nodes/*`, `ParamBus` and `PersonMask` are kept but unused.

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
'anamorphic_lab' | 'invisible' | 'time_machine' | 'quadtree' | 'pointcloud' |
'painting'` (`src/types.ts`). These ids key the registry, the node
factory, presets, and localStorage. Display names live in
`EFFECT_META` (NodalComposition.tsx) and `App.tsx` modules state.
