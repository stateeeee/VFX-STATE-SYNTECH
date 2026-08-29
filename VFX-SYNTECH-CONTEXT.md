# VFX SYNTECH — Complete Project Context (single-file briefing)

> **Come usare questo file (per State).**
> Questo è il briefing completo dell'app in un solo `.md`. Caricalo nella
> *Knowledge* di un Progetto Claude (o incollalo all'inizio di una chat) e
> Claude avrà lo stesso contesto che avrebbe leggendo il repo GitHub, senza
> doverlo collegare. Contiene: cos'è l'app, com'è fatta, tutti i file che
> contano, le interfacce di codice reali, lo stato del lavoro, le regole da
> rispettare e le trappole già misurate. È scritto in inglese perché il
> codice e i documenti del repo sono in inglese, e perché Claude lavora meglio
> quando il briefing parla la stessa lingua del codice. Le domande gliele puoi
> fare in italiano: l'ultima sezione contiene i prompt pronti.
>
> Aggiornalo quando l'app cambia in modo sostanziale (nuova fase, nuovo
> effetto, nuova estetica). Ultima sincronizzazione col repo: **2026-08-29**,
> commit `d952687`, branch `main` / `claude/markdown-app-documentation-wqkrdd`.
> Repo: `https://github.com/stateeeee/VFX-STATE-SYNTECH`

---

## 0. TL;DR — read this first

VFX SYNTECH is a **browser-based, audio- and video-reactive VFX studio for
videomakers**, built by a professional music-video director who goes by
**State**. It applies a curated set of high-end effects to video files, images
and webcam input — faster and more intuitively than After Effects or
TouchDesigner.

It is **not a prototype**. As of this writing:

- All 10 roadmap phases are complete except **one hardware-dependent item**
  (a ≥30fps@720p performance pass that must be measured on a real GPU).
- The five effects exist twice: as **five standalone HTML apps** (ground
  truth, opened in an iframe) and as **five real 1:1 WebGL2 engine nodes**
  (so they can be chained together on one video in real time).
- Chain export to MP4 works (WebCodecs + mp4-muxer, vendored).
- The whole app runs **100% offline** — no CDN, no API key required.
- The visual chrome is a generated artwork ("the cage") that masks the UI into
  organic openings.

The single most important cultural fact about this project: **the operator is
a director, not a programmer.** He judges the work by looking at it. Verified
behaviour beats clean code; "close enough" on a visual detail is a failure.

---

## 1. Product vision

### What it is

A browser VFX studio. The founder knows After Effects and TouchDesigner by
heart and built this from that experience. Those tools are paid, hard to learn
and slow: days are lost just discovering which effects exist. VFX SYNTECH
inverts that — a **curated set of the most beautiful, hardest-to-build
effects**, usable in minutes, with results that match or beat the big tools.

The interface metaphor is a **"second brain"**: on launch the hero area shows
an animated brain graph — VFX SYNTECH at the centre firing neural connections
out to every effect in the app.

### The 4 pillars (every decision is judged against these)

1. **Beautiful.** The product must look stunning and professional. People only
   pay for — and share on social — tools that look premium. Visual polish is a
   feature, not a nice-to-have.
2. **Functional.** Intuitive and easy. A user must get a *better* result than
   in After Effects or TouchDesigner in *less* time. If a flow needs a manual,
   it is wrong.
3. **Professional.** A curated selection (5 now, growing towards ~20) of the
   most beautiful and technically hard effects. They are **audio reactive and
   video reactive**: the founder shoots music videos and wants effects that
   fuse with the song — when the rhythm rises, the effect changes. Effects must
   feel *composed with* the music like a beat under a vocal, never pasted on top.
4. **Web app.** Runs in the browser. Zero install, zero disk space, and easy
   for companies to integrate compared to a desktop app.

### Quality bar

> Would a professional director demo this to a record label on a projector?

Motion must be smooth (60fps target, adaptive resolution when not), typography
and spacing must match the existing design system, and reactive behaviour must
feel **musical, not jittery**.

### Explicit non-goals for v1

No user accounts. No server-side persistence. No collaborative editing. No
mobile layout (desktop browser is the target). No new effects beyond the five
until the roadmap says so.

---

## 2. Stack and commands

| Layer | Choice |
|---|---|
| Shell | React 19 + TypeScript + Vite 6 |
| Styling | Tailwind v4 via `@tailwindcss/vite`, design tokens in `src/index.css` |
| Icons / motion | `lucide-react`, `motion`, `react-resizable-panels`, `react-markdown` |
| Server | Express 4 on port 3000, run with `tsx` (`server.ts`) |
| AI | Pluggable: Groq **or** Gemini **or** offline fallbacks (`ai-provider.ts`) |
| Engine | Hand-written WebGL2 (`src/engine/SynEngine.ts`), no framework |
| 3D | `three` r0.128 (used by the blob_tracker port and its standalone HTML) |
| Persistence | `localStorage` only (v1 decision) |

```bash
npm install          # first time only
npm run dev          # tsx server.ts → http://localhost:3000 (Express + Vite middleware)
npm run lint         # tsc --noEmit — MUST stay clean before every commit
npm run build        # vite build + esbuild server bundle → dist/
npm start            # node dist/server.cjs (production)
```

`tsconfig.json`: ES2022, `jsx: react-jsx`, `moduleResolution: bundler`,
`noEmit: true`, path alias `@/* → ./*`. There is **no test runner and no
ESLint** — `npm run lint` is a TypeScript type-check, and verification is done
by running the app (see §12).

**Vite host note (load-bearing).** `vite.config.ts` sets `server.host:
'127.0.0.1'` deliberately. Vite does a DNS lookup for the literal string
`"localhost"` at startup; on the operator's Mac `/etc/hosts` has lost its
`127.0.0.1 localhost` line and that lookup throws `ENOTFOUND`, killing the dev
server before it listens. An IP literal skips that path. Express still binds
`0.0.0.0`, so `http://localhost:3000` works in the browser. Do not "simplify"
this back to `localhost`.

---

## 3. Repo map

```
server.ts                      Express: 5 AI endpoints + serves /effects statically + Vite middleware
ai-provider.ts                 Groq | Gemini | none. One generate() the endpoints call.
vite.config.ts                 React + Tailwind plugins, host 127.0.0.1 (see above)
index.html                     Vite entry; vendored font <link>s
CLAUDE.md                      Project instructions auto-loaded by Claude Code
CODEX_WORKFLOW.md              ★ The operator's binding rules for ANY visual work
ANALISI.md / DESIGN_ANALYSIS.md / IMPLEMENTATION_PLAN.md
                               Artifacts of the restyle process (STEP 1/2/3 of CODEX_WORKFLOW)

src/
  main.tsx                     React root
  App.tsx                      (1021 ln) The shell: cage layout, nav, composition state,
                               save/projects, effect cards, hero, panels
  index.css                    (458 ln) Design tokens (--syn-*), gel material, logo, hero type
  types.ts                     ModuleId union + ModuleConfig
  effects-registry.ts          ModuleId → iframe src
  bridge/types.ts              ParamSchema, EffectTelemetry, ShellMessage

  components/
    VfxCanvas.tsx              (1098 ln) The animated "brain graph" hero (canvas 2D),
                               hub click = open effect, hub drag = chain two effects
    NodalComposition.tsx       (503 ln) Node graph panel: INPUT → effects → OUTPUT, drag wiring
    ChainLab.tsx               (873 ln) AI Lab surface: SynEngine rack, signals, presets, export
    EffectHost.tsx             (94 ln)  Full-screen iframe host + postMessage bridge (shell side)
    AiDirector.tsx             (529 ln) AI panel: Art Director / Agent / Optimizer
    AudioMeter.tsx             (218 ln) Stereo playback level meter in the left rail

  engine/
    SynEngine.ts               (364 ln) ★ The shared WebGL2 render graph
    nodes.ts                   (67 ln)  NODE_FACTORY: ModuleId → EngineNode (all five are real)
    nodes/analog.ts            (491 ln) 1:1 port — 29 params
    nodes/bokeh.ts             (1137 ln) 1:1 port — 38 params
    nodes/anamorphic_lab.ts    (907 ln) 1:1 port — 29 params
    nodes/blob_reveal.ts       (328 ln) 1:1 port — 12 params
    nodes/blob_tracker.ts      (1464 ln) 1:1 port — 57 params (the hardest)
    params.ts                  (96 ln)  ParamBus: base + modulation routing
    AudioEngine.ts             (195 ln) WebAudio FFT → bass/loud/treble/beat/bpm + file transport
    VideoAnalyzer.ts           (71 ln)  Downsampled frame differencing → motion/bright
    PersonMask.ts              (128 ln) Shared MediaPipe SelfieSegmentation service

  cage/
    cage.ts                    (79 ln)  cageBox()/cagePlane() — pin a panel into an artwork opening
    holes.generated.ts         (143 ln) ★ GENERATED geometry — never hand-edit

  lib/gelTexture.ts            (121 ln) Runtime-painted "gel" material tile (canvas → data URL)

public/
  effects/<id>/index.html      ★★ THE FIVE STANDALONE EFFECTS — GROUND TRUTH
  effects/vendor/              three.min.js, mediapipe (selfie_segmentation, face_mesh, pose,
                               tasks-vision), mp4-muxer.min.js, syntech-export.js, woff2 fonts
  assets/logo.png|webp         Brand mark
  assets/cage.webp             ★ GENERATED chrome artwork (370 KB, keyed)
  assets/covers/<id>.webp      Effect card art (night)
  assets/covers/day/<id>.webp  Same art, black plate keyed out at build time

tools/
  frame/build-frame.cjs        ★ The ONLY writer of cage.webp + holes.generated.ts
  frame/build-day-covers.cjs   Keys the black plate out of the 5 covers for day mode
  frame/preview-frame.cjs, check-zones.cjs, holes.json, graph-preview-patch.py
  gen/gen-effect-covers.cjs
  verify/verify-*.js|.cjs      ~30 Playwright/static verification suites, one per phase/layer

docs/
  workflow/STATE.md            ★★ (1817 ln) LIVE progress tracker — read first, update always
  workflow/01-VISION.md … 08-PROMPTS.md   The binding specs (see §12)
  workflow/HANDOFF.md          Post-revert handoff: operator's rules, measured facts, traps
  workflow/HANDOFF-CAGE.md     Full context of the cage redesign (§6 = what was built)
  design/frame|textures|covers-src        Operator-supplied source art
```

---

## 4. The shell (App.tsx) — how the app behaves

### 4.1 Layout

The window is one full-screen composition. **The chrome is an artwork image
("the cage") laid on top of everything**, and every panel is positioned into
one of its organic openings. Layering, bottom to top:

```
0  the bed              black in BOTH themes
1  day backdrops        one warm-ivory (#fbfaf7) plane per opening that hosts a panel (day mode only)
2  raw-video corner     bottom-right A/B reference plane
5  the panels           positioned into their openings via cageBox()
9  the cage             ONE <img src="/assets/cage.webp">, no blend mode, no filter, no animation
```

Sections, by opening:

- **Top bar** (`HOLES.topbar`, split by a bridge of material into `slotL` /
  `slotR`): status dot + day/night toggle left; the "VFX Syntech / Created by
  State" wordmark at the right end of the left slot; SESSION timer + analogue
  clock right.
- **Left rail** (`HOLES.railTop`): logo, then nav — **Home, Save, Projects,
  AI Lab** — a divider, then the three AI modes: **Art Dir, Agent, Optimizer**.
- **Meter** (`HOLES.meter`): a separate small opening under the rail holding
  the two-column stereo `AudioMeter`.
- **Hero** (`HOLES.hero`): on launch the brain graph (`VfxCanvas`) with the
  giant "VFX / Syntech" gel wordmark and the strapline *"AI-Powered.
  Node-Based. Limitless."*. When a source video is loaded it plays here
  instead. An open effect (iframe) or the armed AI Lab takes this space.
- **Nodes** (`HOLES.nodes`): the `NodalComposition` graph panel.
- **Gemini** (`HOLES.gemini`): the `AiDirector` panel.
- **Sidebar** (`HOLES.sidebar`): the effects library — a search box plus five
  80px cards with cover art.

Panels sit inside `react-resizable-panels` groups (`autoSaveId`
`syntech-main-horiz-v2`, `syntech-main-vert`, `syntech-bottom-horiz`) but the
cage openings are fixed shapes, so the right column is effectively fixed-width
now.

### 4.2 The three modes

| Mode | Surface | Renderer |
|---|---|---|
| **Home / dashboard** | brain graph or hero video | canvas 2D |
| **Single-effect** | `EffectHost` iframe filling the hero | the standalone HTML itself |
| **AI Lab (armed)** | `ChainLab` canvas filling the hero | SynEngine + one node per effect |

Rules (binding, from `03-SPEC-SHELL.md`):

- Clicking an effect card (or its hub on the brain graph) opens **that effect's
  standalone HTML full-hero**. **One effect at a time** — composing several
  simultaneously is exclusively an AI Lab capability.
- **Home** returns to the brain graph. Unsaved parameter changes in the effect
  are lost, **by design** — no "are you sure" dialogs. Save exists for that.
- **AI Lab is a mode toggle**: click → turns violet (`--syn-accent`) and
  **stays lit until manually toggled off**. While armed it stays mounted (just
  hidden) under an open effect so the composition survives navigation.

### 4.3 Save semantics

- **Save while an effect is open** = persist that effect's parameter settings
  through the bridge to `syntech.effectSettings.<moduleId>`; the nav label
  flashes "Saved" for 1.8s. No video export here — export lives inside each
  effect's own UI, and chain export is the AI Lab's Master MP4.
- **Save elsewhere** = a session snapshot `{activeModule, isDayMode, savedAt}`
  to `syntech.session`.
- **Projects** opens a modal listing saved chain presets from
  `syntech.chainPresets`; clicking one arms the AI Lab with it loaded.

### 4.4 localStorage keys (the entire persistence layer)

| Key | Written by | Shape |
|---|---|---|
| `syntech.session` | nav Save (dashboard) | `{activeModule, isDayMode, savedAt}` |
| `syntech.composition.v3` | App (on every change) | `{nodes: ModuleId[], wires: WireMap}` |
| `syntech.composition.v2` | *legacy* | `{id, enabled}[]` — migrated to v3 on read |
| `syntech.chainPresets` | ChainLab | `ChainPreset[]` (order, enabled, bools, ParamBus state) |
| `syntech.effectSettings.<id>` | EffectHost via bridge | `{[paramKey]: value}` |
| `syntech-main-horiz-v2` etc. | react-resizable-panels | panel sizes |

### 4.5 Composition state and the wiring model

`App.tsx` owns `comp = { nodes: ModuleId[], wires: WireMap }` where
`WireMap = Record<string, string>` maps `'IN' | ModuleId → ModuleId | 'OUT'`,
one wire per port.

```ts
// Nodes on the complete IN→OUT path, in wiring order. Anything else ghosts.
const walkChain = (nodes: ModuleId[], wires: WireMap): ModuleId[] => { … }
```

- `graphChain = walkChain(...)` is **the chain** — what the AI Lab renders and
  what the brain graph highlights. **Chain order IS wiring order.**
- A node not on the complete INPUT→OUTPUT path renders at ~50% opacity, is
  excluded from processing, and its controls are inert ("**ghosting rule**").
- `+ Add Node` inserts an effect before OUTPUT. The menu is **strictly
  alphabetical**: ANALOG, ANAMORPHIC LAB, BLOB REVEAL, BLOB TRACKER, BOKEH.
- `✕` deletes a node and **heals** the graph (its neighbours are wired together).
- Ports: INPUT has **out only**, OUTPUT has **in only**, effects have both.
  Connecting is press-drag-release between ports; grabbing a connected port
  picks the wire up — release in the void to disconnect, on another port to
  rewire.
- The brain graph's hub-drag and the ChainLab rack both write back into the
  same state, so all three surfaces stay in sync.

### 4.6 The shared source

`compSource: {url, name} | null` is an object URL **owned by the shell** and
revoked when replaced. The same URL drives the hero `<video>`, the INPUT node
label, the AudioMeter tap and the SynEngine source. Picking a video inside the
AI Lab lifts the file back up so the dashboard follows.

### 4.7 data-testid inventory (keep these working — the verify suites use them)

```
nav-home · nav-save · nav-projects · nav-ailab · nav-gemini-{art_director|agent|optimizer}
effect-card-<id> · effect-search · effect-search-clear · effect-search-empty
nodal-add · nodal-add-menu · nodal-add-<id> · nodal-input · nodal-output · nodal-svg
nodal-node-<id> · nodal-state-<id> · nodal-chain-count · port-{in|out}-<node> · wire-<from>
chain-canvas · chain-fps · chain-res · chain-master · chain-export-msg · chain-file
toggle-<id> · param-<node>-<key> · mod-src-<node>-<key> · mod-amt-<node>-<key> · mod-val-…
audio-toggle · audio-file · audio-file-btn · audio-playpause · audio-seek · audio-track-name
audio-{bass|loud|treble|beat} · audio-bpm · signal-{motion|bright} · seg-status
ai-prompt · ai-optimize · ai-msg · preset-name · preset-save · preset-load-<name> · preset-del-<name>
source-file · hero-video · projects-modal
cage-frame · cage-backdrop · cage-video
```

---

## 5. Two rendering worlds (the central architectural fact)

|  | Single-effect mode | AI Lab (chain) |
|---|---|---|
| Surface | `EffectHost.tsx` iframe | `ChainLab.tsx` canvas |
| Renderer | the standalone HTML itself | SynEngine + one `EngineNode` per effect |
| Fidelity | **ground truth** | must be a **1:1 port** of ground truth |
| Why | the HTMLs are finished, polished apps | two iframes cannot share a video frame; chaining needs one GL context |

Browser iframes cannot pipe pixels to each other at speed. Anything that must
compose effects **in series** lives in SynEngine. This is why every effect
exists twice, and why "just use the iframe" is not an option for chaining.

### The shell ⇄ effect bridge (the ONLY permitted edit to the effect HTMLs)

Each of the five HTMLs carries one delimited, additive block before `</body>`:

```html
<!-- SYNTECH-BRIDGE-START (shell integration; standalone-safe) -->
<script> /* postMessage bridge */ </script>
<!-- SYNTECH-BRIDGE-END -->
```

Protocol — `window.postMessage({ type, payload })`:

| Direction | type | payload | Behaviour |
|---|---|---|---|
| effect → shell | `syn:ready` | `{ id }` | fired on load; shell then applies saved settings |
| shell → effect | `syn:apply-settings` | `{ [paramKey]: value }` | effect applies to its own controls |
| shell → effect | `syn:get-settings` | — | effect replies with `syn:settings` |
| effect → shell | `syn:settings` | `{ [paramKey]: value }` | snapshot of current UI values |

Rules: the bridge reads/writes the effect's **existing** controls by their
existing DOM ids; it must not duplicate state or alter visuals; opened
standalone (no parent) it stays silent. Shell side lives in `EffectHost.tsx`
with a 1.5s timeout on `requestSave()`.

---

## 6. The five effects

The five files in `public/effects/<id>/index.html` are the **official builds
delivered by the operator (2026-07-17)**. They are ground truth: for any
question about how an effect looks or behaves, the HTML wins over any doc.
Each is a fully standalone single-file app with its own dark UI, video-file
input, webcam mode, MediaRecorder export and hotkeys, and each still works
when opened directly as a file.

`ModuleId = 'blob_tracker' | 'analog' | 'blob_reveal' | 'bokeh' |
'anamorphic_lab'`. **These ids are load-bearing** across the registry, the node
factory, presets, cover filenames and localStorage keys. Never rename them.

### `analog` — ANALOG STATE — Video Synthesizer (~130 KB, 2634 lines)
- **Tech**: raw WebGL fragment shaders, no libraries. The simplest.
- **Controls**: `sl-modDepth`, `sl-reactSens`, `sl-sortPasses`, `sl-sortThresh`;
  buttons `btn-play`, `btn-loop`, `btn-mirror`, `btn-react`, `btn-sort`,
  `btn-webcam`; CRT / sync / pixel-sort mode family.
- **Reactive**: AudioContext drives modulation (`reactSens`, `modDepth`).
- **Port**: `AnalogNode`, **29 params**.

### `bokeh` — BOKEH STATE — Cinematic Depth of Field (~183 KB, 3852 lines)
- **Tech**: WebGL shader pipeline + 2D canvases + MediaPipe SelfieSegmentation
  (person/background separation for depth).
- **Controls**: `sl-bokehRadius`, `sl-anamRatio`, `sl-anamSqueeze`,
  `sl-anamBarrel`, `sl-anamVignette`, `sl-distortExplosive`,
  `sl-distortFalloff`, `sl-distortSqueeze`, `sl-distortSwirl`.
- **Reactive**: video-driven (no AudioContext in this build).
- **Port**: `BokehNode`, **38 params**.

### `anamorphic_lab` — Anamorphic Lab v5 (~155 KB, 3197 lines)
- **Tech**: WebGL shaders + 2D canvases + MediaPipe SelfieSegmentation.
- **Controls**: a full cinema-lens rig — `s-fStop`, `s-bokeh`, `s-bokehMM`,
  `s-ratio`, `s-squeeze`, `s-barrel`, `s-ovalFineTune`, `s-riccardoBlur`;
  flare group (`s-flareAmt/Color/Length/Height`); grade group (`s-exposure`,
  `s-contrast`, `s-lift`, `s-rolloff`, `s-sat`, `s-temp`, `s-lutMix`);
  texture group (`s-grain`, `s-halation`, `s-vignette`, `s-ca`); camera sims
  (`cam-exp-sl`, `cam-iso-sl`, `cam-wb-sl`, `cam-zoom-sl`).
- **Reactive**: AudioContext present.
- **Port**: `AnamorphicLabNode`, **29 params**.

### `blob_reveal` — BLOB REVEAL — Rotoscope Engine (~89 KB, 1763 lines)
- **Tech**: pure Canvas 2D + MediaPipe SelfieSegmentation. Negative-mask /
  rotoscope reveal of the subject.
- **Controls**: `sl-thr`, `sl-lum`, `sl-segn`, `sl-feather`, `sl-erode`,
  `sl-dil`, `sl-minarea`, `sl-maxblobs`, `sl-bgap`, `sl-bsens`, `sl-opacity`,
  `sl-audioexp`.
- **Reactive**: AudioContext (`sl-audioexp` = audio-driven expansion,
  `sl-bsens` = beat sensitivity).
- **Port**: `BlobRevealNode`, **12 params** — 2D logic renders offscreen and is
  uploaded to the node's GL texture per frame; the mask comes from the shared
  PersonMask service.

### `blob_tracker` — BLOB STATE TRACKER (~367 KB, 6876 lines — the largest)
- **Tech**: **three.js r128** + multiple 2D canvases + MediaPipe (selfie
  segmentation, face mesh, pose, tasks-vision). Contour tracking, optical flow,
  connection lines/graph visuals over tracked blobs.
- **Controls**: tracking (`sThr`, `sMin`, `sScale`, `ct-expand-sl`,
  `ct-smooth-sl`), optical flow (`flow-scale-sl`, `flow-trail-sl`), dynamics
  (`sDisp`, `sTurb`, `sWave`, `sDamp`, `sDmx`, `sFixedMax`), look (`sBri`,
  `sCon`, `sBgOp`, `sFxOp`, `sConnGlow`, `sConnOp`, `sConnSat`, `sLW`, `sGlx`,
  `sCamZ`), audio-reactive gains (`ar-bass-gain`, `ar-mid-gain`, `ar-hi-gain`,
  `ar-onset-sens`), video-reactive (`vr-mot-sens`, `vr-cut-thr`, `vr-smooth`,
  `vr-srate`), camera sims (`cam-*-sl`).
- **Reactive**: the heaviest — dedicated audio-reactive **and** video-reactive
  control groups.
- **Port**: `BlobTrackerNode`, **57 params**. three.js renders offscreen and the
  result is uploaded as the node texture: **1:1 means identical output, not
  identical plumbing.**

### What "1:1 port" means (binding operator decision)

Every parameter in the HTML exists in the node's `ParamSchema` with the same
range, default and behaviour; every visual detail matches; audio/video reactive
behaviours are reproduced through AudioEngine / VideoAnalyzer / ParamBus with
the same *perceived* response. Stochastic elements (particles, jitter seeds)
may differ per-frame — judge the behaviour, not per-pixel identity. Parity is
proven by the protocol in §12.4 before a port is marked done.

---

## 7. The engine

### 7.1 SynEngine — the shared render graph

One WebGL2 context, one canvas. The source video is uploaded **once per frame**
and flows through the enabled nodes in series via ping-pong framebuffers; the
last output is blitted to the screen.

```ts
export interface NodeRenderContext {
  gl: WebGL2RenderingContext;
  inputTex: WebGLTexture;      // texture produced by the previous node (or the source)
  width: number; height: number;
  time: number; frame: number;
  drawQuad: () => void;        // draws the bound program over the full viewport
  source: TexImageSource | null;      // for nodes doing CPU pixel analysis
  personMask: TexImageSource | null;  // segmentation confidence mask, when available
  personMaskVersion: number;          // bumps on a fresh segmentation result
}

export interface EngineNode {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  readonly params: ParamSchema[];
  setParam(key: string, value: unknown): void;
  getParam(key: string): unknown;
  init(gl: WebGL2RenderingContext): void;
  resize(width: number, height: number): void;
  render(ctx: NodeRenderContext): WebGLTexture;   // returns its output texture
  dispose(gl: WebGL2RenderingContext): void;
}
```

Exported helpers every node uses: `compileProgram(gl, vs, fs)`, `QUAD_VS`,
`createTarget(gl, w, h) → Target {fbo, tex, w, h}`, `destroyTarget`.

Engine surface:

- `loadVideoFile(file)`, `loadVideoUrl(url)` (URL owner is responsible for
  revoking), `startWebcam()`, `stopSource()`, `addNode(node)`,
  `swapNodes(i, j)`, `start()`, `stop()`, `renderFrame(now)`, `dispose()`.
- `beforeFrame?(now)` — runs at the top of every frame; **ChainLab hooks audio
  analysis, video analysis, mask upkeep and param modulation here.**
- `onFps?(fps)`, `onResScale?(scale)`, `personMaskSource`, `personMaskVersion`.
- **Adaptive internal resolution**: `RES_STEPS = [1, 0.75, 0.5]`, re-evaluated
  at most every 1500ms; steps down under 45fps, back up over 57fps. Display
  size never changes. Disabled and forced to 1 during offline export.
- The context is created with `preserveDrawingBuffer: true` so frames stay
  readable for pixel verification and export.
- A full-viewport **single oversized triangle** is used instead of a quad.

### 7.2 ParamBus — the manual/auto control matrix

Bases live in the bus (sliders edit them); a routed signal is layered on top at
the start of every frame and pushed into the node with `setParam`:

```
final = clamp(base + signal × amount × paramRange)
```

```ts
export type ModSource = 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright';
export interface ModSettings { source: ModSource; amount: number } // -1..1
export interface ParamBusState { [key: string]: { base: number; mod: ModSettings | null } }
// key format: `${node.id}.${param.key}`
```

`snapshot(chain)` seeds bases from the nodes (existing entries win) and
pre-wires any param's `defaultRoute`. `apply(chain, signals)` runs per frame.
`serialize()` / `restore(data, chain)` round-trip presets.

### 7.3 ParamSchema (the contract every node and the AI operate on)

```ts
export interface ParamSchema {
  key: string;
  label: string;
  type: 'number' | 'boolean';
  value: number | boolean;
  min?: number; max?: number; step?: number;
  aiHint?: string;           // written FOR the AI panels — describes what it controls
  reactive?: boolean;        // true where the original effect reacts
  defaultRoute?: { source: ModSource; amount: number };  // pre-wired modulation
}
```

### 7.4 AudioEngine

Two exclusive inputs: **microphone** or a **loaded audio file** (audible).
`AnalyserNode`, `fftSize = 2048`, `smoothingTimeConstant = 0.5`.

- `bass` = 20–250 Hz ×1.25, `loud` = 20–12k ×1.6, `treble` = 4k–12k ×2.2, all
  clamped 0..1 and asymmetrically smoothed (attack 0.4, release 0.12).
- `beat` — a pulse fired on bass-energy onset (flux > 0.1, bass > 0.15,
  240ms refractory), decaying ×0.88 per frame.
- `bpm` — median inter-beat gap over the last 16 intervals, folded into
  60–200, `null` until ≥4 intervals.
- `transport: FileTransport | null` — `{name, loop, currentTime, playing,
  duration}`, mirrors the underlying `<audio>`; `togglePlay/setLoop/seek/stop`.

### 7.5 VideoAnalyzer

Downsamples the engine source to a 32×18 offscreen canvas at ~15 Hz:
`motion` = mean absolute per-pixel luma difference between frames, `bright` =
mean luma. Both 0..1 and smoothed; no source decays them to 0.

### 7.6 PersonMask

Lazy shared MediaPipe SelfieSegmentation service — nothing loads until a node
with `segEnabled` calls `enable()`. States `off → loading → ready`, failures
fall back to `off` with a 5s cooldown so per-frame calls don't hammer. Ticks at
~15 Hz, draws into `maskCanvas`, consumed via `engine.personMaskSource`.
Loaded from the **vendored** copy at
`/effects/vendor/mediapipe/selfie_segmentation`, not a CDN.

### 7.7 ChainLab — the AI Lab surface

- Builds the rack as `[...activeChain, ...RACK_ORDER.filter(not active)]`, so
  wired effects run in wiring order and the rest sit bypassed at the tail
  (`RACK_ORDER = ['blob_tracker','blob_reveal','bokeh','analog','anamorphic_lab']`).
- Per-node UI: enable toggle, reorder, per-param slider, a `~` modulation chip
  (source + amount) and the live modulated readout.
- Signals column: `bass / loud / treble / beat` from AudioEngine, `motion /
  bright` from VideoAnalyzer, BPM readout, SEG status.
- Badges **FPS** and **RES%** (RES% amber below 100 = adaptive-res engaged).
- **Master MP4**: `runMasterExport()` loads `/effects/vendor/mp4-muxer.min.js`
  and `/effects/vendor/syntech-export.js` and calls
  `SyntechExport.exportMasterQuality({...})` — a WebCodecs frame-stepping
  exporter driving `engine.renderFrame(clock)` deterministically with
  adaptive-res forced off. Requires WebCodecs.
- **Chain presets** in `syntech.chainPresets`:
  `{name, savedAt, order, enabled, bools, bus}`.
- An **AI Optimize** box posts the active node's params to
  `/api/gemini/optimize` and applies the returned preset to the bases.

---

## 8. The AI layer

### 8.1 Provider selection (`ai-provider.ts`)

Three states, decided purely by which key is in `.env.local`:

| Key present | Provider | Default models |
|---|---|---|
| `GROQ_API_KEY` | Groq (OpenAI wire format, one `fetch`) | `llama-3.3-70b-versatile` for both tiers |
| `GEMINI_API_KEY` | Gemini (`@google/genai`, lazily constructed) | `gemini-3.5-flash` / `gemini-3.1-pro-preview` |
| neither | **none** | `generate()` throws immediately |

`generate({tier, systemInstruction, contents, temperature, json})` returns
`{text, provider, model}`. **Throwing IS the fallback path**: every endpoint
catches and answers from its own offline archive, so *no key is ever required
for anything that is not AI*. `generate()` logs the real failure **once**, on
the server only, as `[ai:groq] groq 401: …` — this line is the difference
between a five-second fix and an afternoon. The server prints one honest
provider line at boot (`describeProvider()`).

Models are overridable by env (`GROQ_MODEL_FAST/PRO`, `GEMINI_MODEL_FAST/PRO`)
so a rejected model id is a `.env` edit, not a code change.

### 8.2 Endpoints (`server.ts`)

| Endpoint | Used by | Purpose | Offline fallback |
|---|---|---|---|
| `POST /api/gemini/chat` | AiDirector | Conversational "Vault Oracle"; may emit `PRESET:{…}` which the shell extracts and can apply | per-module canned preset + text |
| `POST /api/gemini/agent` | AiDirector | Returns `{enable: [...], disable: [...]}` to rewire the composition | `{}` + message |
| `POST /api/gemini/analyze-video` | AiDirector | Brief analysis of the loaded clip | canned line |
| `POST /api/gemini/optimize` | ChainLab | Returns a strict JSON param preset for the active module | per-module canned preset |
| `POST /api/gemini/analyze` | AiDirector | 2-sentence art-director critique (<45 words) | per-module canned critique |

The prompts pass each parameter's `min`, `max` and `hint` and instruct the
model that **every returned value must lie inside that parameter's own range**,
and that params hinted `(on/off switch)` accept only 0 or 1. This is why
`aiHint` on every `ParamSchema` matters.

**Naming note**: the endpoints are still called `/api/gemini/*` for
compatibility, but the code behind them names no provider.

### 8.3 Serving

Dev: `/effects` is served statically **before** the Vite middleware (Vite
blocks public assets requested as `<script src>`), then Vite runs in
middleware mode as an SPA. Prod: `dist/` static + SPA fallback.

---

## 9. The cage — the visual chrome

The operator's artwork **is** the app's chrome. It divides the sections; there
is no gel slab and no coloured LEDs between them any more.

- `public/assets/cage.webp` (the keyed frame, 370 KB) and
  `src/cage/holes.generated.ts` (the geometry) are both **generated by
  `tools/frame/build-frame.cjs`**, which is their only writer. The geometry is
  measured on the artwork by flood-fill and expressed in **fractions of the
  viewport**, so every section tracks the window's stretch with **no
  JavaScript and no resize listener**.
- **Never hand-edit either file, and never nudge a rectangle "by eye."** If
  something is off, fix the generator and regenerate:
  `NODE_PATH=/opt/node22/lib/node_modules node tools/frame/build-frame.cjs`
- `cageBox(hole, inset = 5, zIndex = 5)` pins a panel into an opening (the
  inset gives a hair of clearance so a 16px panel radius can't poke out from
  under the material). `cagePlane(hole, zIndex)` places a plane **behind** the
  cage with no inset — its edges must rest on the region's outermost pixel.
- `CAGE_BED = #000000` in **both** themes. `CAGE_SURFACE = #fbfaf7` (warm
  ivory) goes behind every panel-hosting opening **in day mode only**; empty
  openings stay black.
- The cage image carries **no blend mode, no filter, no animation** — that is
  the frame-cost contract, and it is why the frame costs nothing per frame.
  `will-change: transform` rasterises it once (see the BPM trap in §11).
- Openings: `topbar` (`slotL`/`slotR`), `rail`, `railTop`, `meter`, `hero`,
  `sidebar`, `nodes`, `gemini`, plus `boxes` (all panel-hosting openings) and
  `videoBoxes[0]` = the bottom-right raw-video A/B corner.
- Day-mode covers are keyed at **build time** by
  `tools/frame/build-day-covers.cjs` into `public/assets/covers/day/`: the art
  was made for a black plate, which on ivory would read as five black
  rectangles. Zero runtime cost.

---

## 10. Design system

All UI styling reads from the tokens in `src/index.css`. **Violet `#8b5cf6` is
the accent.** No hardcoded off-palette colours anywhere.

```css
--syn-accent: #8b5cf6;      --syn-accent-rgb: 139, 92, 246;   /* + 50…950 ramp */
--syn-violet: #8b5cf6;
--syn-bg: transparent;      /* the space between sections */
--syn-ink-950/900/850: #000000;   /* sidebar / hero / panels — FULLY OPAQUE black */
--syn-ink-800: #1a1a1a;     --syn-ink-700: #2e2e2e;
--syn-line: rgba(139,92,246,0.10);
--syn-text: #f4f2ee;
--syn-hero-canvas: opaque;  /* VfxCanvas fills; set transparent and it CLEARS instead */
--syn-font-sans: "Inter";  --syn-font-display: "Space Grotesk";  --syn-font-mono: "JetBrains Mono";
```

Tailwind v4 `@theme` re-exports these as `gold-*` (historical name — the ramp
is violet now), `violet-400` and `ink-*` utilities. Fonts are **vendored**
locally as woff2, not loaded from Google Fonts.

Signature visual pieces: the `hero-gradient` shimmer shared by the top-bar
wordmark and the hero title; `hero-gel-text` (the runtime-painted gel material
from `lib/gelTexture.ts` with inflated 3D, big sizes only); `.syn-logo` (the
mark takes its colour from the same violet→gold ramp via a masked gradient
layer under a `luminosity` blend — **never inverted**); the two-column
Premiere-style `AudioMeter` (green → amber → red, peak-hold decay 0.35/s,
tapping the hero video through a gain-0 node so the analyser sees real samples
while playback stays silent).

Per-effect node accent colours (`EFFECT_META` in `NodalComposition.tsx`):
blob_tracker `#e0913f`, blob_reveal `#c65b9c`, anamorphic_lab `#5bb0c4`,
analog `#6ea8e0`, bokeh `#9b6fd0`. INPUT `#57bf8a`, OUTPUT `#8b5cf6`.

---

## 11. Project state, open items, and measured traps

### Done

Phases 0–9 complete (2026-07-20): baseline, bridge v1, AI-Lab armed mode +
drag wiring, engine services, and all five 1:1 ports (blob_tracker last and
hardest), plus Master MP4 export. Phase 10 (assets & polish) done except one
item: definitive logo, functional search box, **CDN deps fully vendored
(proven 100% offline)**, colour/day-mode audit, and the five effect-card covers
(cut from the operator's own screenshots, 2026-07-29). On top of the roadmap,
a multi-round visual pass and then **the cage**, implemented 2026-07-31 after
twelve preview rounds.

### Open

1. **The operator's judgement of the real app.** The cage previews were
   composites; the implementation is the thing that runs. If something is off,
   fix it in `tools/frame/` and regenerate — no number is touched by hand.
2. **Groq with a real key.** The path is implemented and verified up to the
   sandbox's network boundary, which blocks `api.groq.com`. First real response
   is the operator's to see: `GROQ_API_KEY` in `.env.local`, and the boot line
   must say `AI provider: groq`. A fallback means the cause is in the server
   log as `[ai:groq] …`.
3. **The ≥30fps@720p performance pass — still open, and now it matters more**,
   because the cage adds a full-screen image with alpha on top of everything.
   Must be measured on a real GPU: AI Lab → 5-effect chain → 720p clip → read
   the **FPS** and **RES%** badges. Acceptance: `fps ≥ 30` **and** `RES% < 100`
   (amber). *The operator asked explicitly to be reminded of this.*
4. **Scaffold leftovers from AI Studio**, cosmetic but visible: the browser tab
   still says `My Google AI Studio App` (`index.html` `<title>`), `README.md` is
   still the AI Studio boilerplate with a Google banner, `package.json` is named
   `react-example`, and `metadata.json` has empty name/description. None of this
   affects behaviour; all of it shows to anyone the operator demos to.
5. **The verify suites don't run as-is**: they are CommonJS with a `.js`
   extension inside a `"type": "module"` package, so `node tools/verify/x.js`
   dies on *require is not defined*. Some also carry an unreplaced
   `__SCRATCH__` placeholder plus fixtures (`beat120.wav`, `test.webm`) that
   must be generated first. The real fix is renaming them all to `.cjs` and
   updating `06-VERIFICATION.md`. The newer `verify-ui-cage.cjs` runs as-is.

### Measured traps (facts, not opinions — these cost days once)

- **AudioEngine's BPM estimate is a canary for frame cost.** It reads spectral
  flux *between* frames, so anything expensive over the hero canvas reads as a
  faster tempo. Measured against a 120 BPM source: 189 with a full-screen blur,
  171 with four blended layers, 138 with one, 124 with none. The cage itself
  cost the canary (189) until it got its own compositing layer; with
  `will-change: transform` it came back to 129.
- **An `inset` shadow on the hero shell costs frames** (124 → 138). On every
  other panel it costs nothing.
- **Under SwiftShader (headless sandbox) the estimate is noisy**: three runs
  with no overlay gave 120 / 144 / 129. Never attribute a regression to a
  change without measuring the baseline at the same time. WebGL chains run at
  1–2fps there, so real performance is **not** measurable in a sandbox.
- **`position: fixed` creates a stacking context in Chrome** — children's
  z-index resolves *inside* the wrapper.
- **`visibility: hidden` on an `<svg>` carrying only `<defs>`** inherits into
  mask content: the mask goes to zero luminance and everything referencing it
  disappears. Use a 0×0 svg, not `visibility`.
- **`clip-path` does not change the element's box** but **does clip hit
  testing** in Chrome.
- Effect HTMLs used to load three.js / MediaPipe / Google Fonts from CDNs;
  these are now **vendored under `public/effects/vendor/`** and the app is
  proven to work fully offline. Keep it that way.
- `allow="camera; microphone"` on the effect iframe is required — keep it.
- Always restart `npm run dev` after editing sources before taking screenshots.

---

## 12. How work is done on this project

### 12.1 The documents (in `docs/workflow/`)

| File | Role |
|---|---|
| `STATE.md` | **Live tracker: current phase, next step, decisions, full log. Read first, update in the same commit as the work.** |
| `01-VISION.md` | Product vision & the 4 pillars |
| `02-ARCHITECTURE.md` | Technical map & known gaps |
| `03-SPEC-SHELL.md` | **Binding** functional spec of the shell (where code differs, the spec wins) |
| `04-SPEC-EFFECTS.md` | Effect inventory & porting rules |
| `05-ROADMAP.md` | Phases 0–10 with acceptance criteria |
| `06-VERIFICATION.md` | Verification & the 1:1 parity protocol |
| `07-SESSION-PROTOCOL.md` | How sessions start, run and end |
| `08-PROMPTS.md` | Copy-paste prompts for the operator |
| `HANDOFF.md` / `HANDOFF-CAGE.md` | Post-revert and cage handoffs |

**Ground truth order**: the effect HTMLs > specs 03/04 > current code > any
other default.

### 12.2 Hard rules (from `CLAUDE.md`)

1. The five `public/effects/*/index.html` files are ground truth. **Never
   rewrite them.** Only the additive, delimited bridge snippet is allowed.
2. **AI Lab ports must be 1:1** — every parameter, every visual detail,
   verified with the parity protocol. No "close enough".
3. `ModuleId` values are load-bearing. **Never rename them.**
4. All styling reads from the `--syn-*` tokens. Violet `#8b5cf6` is the accent.
   No hardcoded off-palette colours.
5. `npm run lint` must be clean before every commit.
6. **Do not add dependencies** unless a phase explicitly calls for it.
7. Persistence is `localStorage` for v1. No backend state.
8. Update `docs/workflow/STATE.md` in the same commit as the work it
   describes, then push.
9. Claude sessions work on their own `claude/…` branch; the operator merges to
   `main` between sessions. Never push to a different branch without asking.

### 12.3 The operator's rules for ANY visual work (`CODEX_WORKFLOW.md`)

1. **RESTYLE, not redesign.** Never touch React/TS logic, state, routing,
   canvas, shaders, WebGL, audio, APIs, event handling, keyboard shortcuts,
   file structure or architecture. Only CSS, Tailwind, tokens, spacing,
   typography, borders, radii, gradients, shadows, glow, overlays, blur,
   opacity, decorative SVG, masks and non-functional transitions. *If a visual
   improvement requires changing functionality, do not implement it.*
2. **Mandatory process**: analysis → image comparison → plan → **wait for
   approval** → implement **one section per commit**. He has said "go" once,
   for a plan he had already approved; **by default he expects you to stop and
   wait.**
3. **Aesthetic priorities, in order**: 1 material, 2 lighting, 3 depth,
   4 shapes, 5 texture, 6 colour. *Texture is almost the last thing.* Never
   just tile a texture everywhere; every decorative element must improve
   readability.
4. **Think like an Art Director, not a programmer.**
5. The sections stay **opaque black** — he chose this explicitly when asked
   about translucency.
6. The visual reference is never to be copied literally: extract its design
   language (depth, materials, surface continuity, thicknesses, organic
   language, lighting, hierarchy) — not its colours.

> The one failed session in this project's history was not a technical
> failure: five different aesthetic directions were produced without the
> operator approving one, and it ended in a full revert. Every verification was
> green at each step. Green checks are not what measures success here.

### 12.4 Verification

Nothing is "done" on code inspection alone. Static gate: `npm run lint`. Then
run the app and observe behaviour, and record what was verified (and how) in
`STATE.md`.

- Browser checks are Playwright scripts (Chromium pre-installed in the remote
  environment at `/opt/pw-browsers/chromium`; never run `playwright install`).
  Feed deterministic media: `--use-fake-ui-for-media-stream
  --use-fake-device-for-media-stream` for webcam/mic, `setInputFiles` for file
  inputs.
- Pixel assertions on `chain-canvas` should test **variance / statistics**, not
  exact pixels (`preserveDrawingBuffer` is on).
- **Parity protocol for a 1:1 port**: (1) param table diff — the node's
  `ParamSchema` must cover 100% of the HTML's controls, any consolidation
  justified in STATE.md; (2) same-input side-by-side captures at defaults, at
  each param's min and max, and one combined "hero look"; (3) compare structure,
  colour response and motion character (histogram/SSIM as an aid); (4)
  reactivity check with a real or synthesized beat track; (5) chain sanity
  ≥30fps at 720p with no GL errors; (6) evidence summarised in the STATE.md log.
- **Regression sweep** at the end of every phase: five effects still open and
  run standalone-silent; Save → Home → reopen restores settings; AI Lab
  arm/disarm keeps composition state; lint clean; no new console errors.

### 12.5 Session shape

Start: read `CLAUDE.md` and `STATE.md` → identify the current phase → read that
phase in `05-ROADMAP.md` and the specs it references → post a short plan →
start. If STATE.md contradicts the repo, **stop and reconcile first**.

During: current phase only; out-of-scope bugs get fixed if trivial, otherwise
logged under "Open items". Ask the operator only for product decisions the spec
doesn't cover, changes to the specs themselves, destructive actions, or
accepting a parity deviation.

End: verify → update STATE.md (checkboxes, a dated log entry with deviations,
and a **"Next step"** a blind next session can execute) → commit and push to
the session branch → reply to the operator in plain language (Italian welcome),
no jargon dumps.

**Failure honesty**: if verification fails or something is half-done, say so
plainly in both the reply and STATE.md ("Phase N: attempted, blocked by X").
Never mark unverified work as done — the next session depends on STATE.md
being true.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Operator / State** | The founder. A professional music-video director, not a programmer. |
| **The shell** | The React app around the effects (`App.tsx` and components). |
| **Single-effect mode** | One standalone effect HTML open full-hero in an iframe. |
| **AI Lab** | The armed SynEngine mode where several effects run on one video. |
| **The rack** | ChainLab's per-node control column. |
| **1:1 port** | An `EngineNode` reproducing a standalone effect exactly. |
| **Ghosting** | A node not wired on both sides: ~50% opacity, out of the chain. |
| **The cage** | The generated artwork chrome and its openings. |
| **Signals** | `bass, loud, treble, beat, motion, bright` — the modulation sources. |
| **Route / mod** | A signal wired onto a parameter via the ParamBus. |
| **Parity run** | The 6-step protocol proving a port matches its HTML. |
| **The canary** | The BPM readout, used as a frame-cost measurement. |

---

## 14. Prompt di partenza (per State — copia e incolla)

Con questo file caricato nel Progetto, puoi chiedere:

**Domanda / analisi (nessuna modifica al codice)**
```
Hai il contesto completo di VFX SYNTECH nel file VFX-SYNTECH-CONTEXT.md.
Rispondi solo dal contesto: <la tua domanda>. Se qualcosa non è nel file,
dimmi che serve guardare il repo e quale file esattamente.
```

**Idea di prodotto / nuova funzione**
```
Contesto: VFX-SYNTECH-CONTEXT.md. Valuta questa idea contro i 4 pilastri e
i non-goal della v1: <idea>. Dimmi se entra nella roadmap, dove, cosa
tocca (file e stato), e cosa rischia di rompere.
```

**Lavoro visivo (attenzione: il processo è vincolante)**
```
Contesto: VFX-SYNTECH-CONTEXT.md, sezione 12.3. Sono in STEP 2 di
CODEX_WORKFLOW: ecco lo screenshot attuale e la mia reference. Fai il
confronto e proponi un piano. NON scrivere codice, fermati e aspetta.
```

**Nuovo effetto da portare nell'engine**
```
Contesto: VFX-SYNTECH-CONTEXT.md. Voglio aggiungere un sesto effetto:
<descrizione>. Progetta l'EngineNode: ParamSchema completo con aiHint e
defaultRoute, pipeline di render, cosa serve da PersonMask/AudioEngine, e
il piano di parity. Rispetta le interfacce nella sezione 7.
```

**Debug**
```
Contesto: VFX-SYNTECH-CONTEXT.md, sezione 11 (trappole misurate).
Sintomo: <cosa vedo>. Dammi le ipotesi in ordine di probabilità e come
verificare ciascuna, partendo da quelle già documentate.
```
