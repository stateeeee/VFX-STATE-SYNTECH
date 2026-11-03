# 03 — SHELL FUNCTIONAL SPEC

This is the operator's (founder's) exact intended behavior. Where the current
code differs, THIS SPEC WINS. Anything not covered here: keep current behavior.

## 1. Layout (already in place — do not restructure)

- **Top bar**: status left, "VFX Syntech / Created by State" wordmark centered,
  session clock right.
  Next to the day/night toggle: the hero fullscreen button (YouTube-style
  corner icons); in fullscreen a matching exit button sits bottom-right of the
  hero, Esc also exits.
- **Node graph** (NodalComposition): click selects an effect node, Delete /
  Backspace removes it, Esc / click elsewhere deselects, double-click opens the
  Lab, the ✕ still removes.
- **Left sidebar**: nav = Home (its icon IS the app logo — no separate logo
  above it, 2026-10-10), Save, Projects,
  Lab; below the divider, the GEMINI 3.8 label and the three Gemini modes
  (Art Dir, Agent, Optimizer) — locked until a key is active (§9).
- **Center hero**: on launch, the animated brain graph (`VfxCanvas`) — the
  app's "second brain": VFX SYNTECH core firing neural connections to every
  effect. The graph IS the app (operator, 2026-10-22): the core sits in the middle and
  **every** effect in `modules` (all 10, A → Z) is a hub on an ellipse around it, with
  its own satellite cluster; nodes, clusters and labels shrink as the hub count grows
  so the whole constellation always fits. This space is where the video/effect appears while working.
  Dragging one hub onto another links them into the chain (bright persistent
  links are drawn); the graph shows **no chain overlay/HUD** (no "CHAIN … Open
  Lab / Clear" bar — operator request 2026-10-11). Open the Lab from the left
  bar; clear/edit the chain in the node graph panel.
- **Below the hero**: the node graph panel (`NodalComposition`) — this IS the
  Lab's wiring surface — plus the Gemini 3.8 panel (`AiDirector`, §9) beside
  it.
- **Right sidebar**: the effects library (10 cards since 2026-10-22; artwork images arrive
  later).

## 2. Single-effect mode

- Clicking an effect card on the right (or its hub on the brain graph) opens
  that effect's standalone HTML **in the hero space** (iframe via
  `EffectHost`). It fills the section; the shell chrome stays around it.
- **One effect at a time.** Applying multiple effects simultaneously is
  exclusively a Lab capability.
- **Home** returns to the brain graph view. Unsaved parameter changes in the
  effect are lost — this is intended, no blocking "are you sure" dialogs.
- Re-opening an effect restores its **saved** settings (see §4), not the
  abandoned ones.

## 3. Lab activation model

- The Lab nav button (testid still `nav-ailab`, label **Lab**) toggles the Lab:
  click → the Lab takes the hero opening and the button turns violet
  (`--syn-accent`); click again → the Lab is hidden. The button is lit only
  while the Lab is on screen.
- **Home leaves the Lab too** (and any open effect, and the Gemini mode);
  opening an effect from the library also covers it. In every case the Lab is
  only **hidden, never unmounted**: once opened it stays mounted for the
  session, so its chain, every node's settings, source, audio — and the
  Gemini panel's handle on it — survive. Hidden means laid out but invisible
  (`invisible`, z-index −1, no pointer events), **never `display:none`**:
  with `display:none` Chromium froze the effect iframes and a plain evaluate
  on the page took 663 s.
- **The media follow the visibility.** On hide the INPUT video and a playing
  Track are parked (paused) and come back playing on show (only what was
  playing); Clip audio is the video's own sound, so it goes silent with it.
  The webcam and the mic are switched off on hide and stay off on show. A
  running Master export or a Gemini capture already in flight plays the media
  for its window. The effects' own render loops keep running underneath
  (SynLab has no pause yet — a later `setPaused` is proposed).

### 3.1 LAB v2 — a chain of the real effects (operator decision 2026-10-28)

Every Lab node **is** the standalone effect page (`/effects/<id>/index.html`,
`labFrameSrc(id)` in `src/effects-registry.ts`) in a same-origin iframe, with
its whole interface — top bar, frame, every panel section — identical to
opening it alone. All ten effects are available as nodes. The chain is
INPUT → effect 1 → … → OUTPUT: each hop is the previous node's
`SynLab.captureStream()` fed to the next node's `SynLab.setVideoStream()`
(an external source, never treated as a webcam: no mirror). See §5.2 for the
effect side.

- **Stage** (`lab-stage`): one iframe per wired node (`lab-frame-<id>`), all
  stacked in the same rect; the selected tab is on top and takes the pointer,
  the others keep rendering underneath. Iframes keep a stable DOM order
  (moving one would reload it), so re-ordering in the node graph only
  re-plumbs the streams. A node whose SynLab link does not come up is
  bypassed, and after 15 s the status line says "<EFFECT>: Lab link not
  available" (`chain-link-missing`). The plumbing (`replumb`) compares stream
  identities only and runs on every event plus a short poll.
- **LAB strip**: tabs `INPUT · <effect 1> · … · OUTPUT` (`lab-tab-input`,
  `lab-tab-<id>` with `data-link` = loading / ready / missing,
  `lab-tab-output`). INPUT shows the source (`lab-layer-input`:
  `lab-input-video` / `lab-input-photo` / `lab-input-cam`); OUTPUT shows the
  last node's stream (`lab-layer-output`, `lab-output-video`). The commands:
  Video / Photo (`chain-file`), Webcam (`lab-webcam`), Mic (`audio-toggle`),
  Track (`audio-file-btn` / `audio-file`, with `audio-playpause`,
  `audio-seek`, `audio-track-name`), Clip (`audio-clip`), Preset (popover:
  `preset-toggle`, `preset-pop`, `preset-name`, `preset-save`,
  `preset-load-<name>`, `preset-del-<name>`), Master MP4 (`chain-master`,
  `chain-export-msg`). Status: `chain-fps` (OUTPUT fps), `chain-input`,
  `chain-audio`, `chain-route`, `chain-link-<id>`, `chain-note`,
  `chain-error`, the meters `audio-bass/loud/treble/bpm`. An empty chain shows
  "Add effects with + Add Node in the node graph" (`chain-empty`).
- **INPUT** is shell-owned: a video file → the video track of the element's
  `captureStream()`; a photo → a canvas redrawn every 100 ms (long side
  ≤ 1920); the webcam → its `getUserMedia` stream, not mirrored (stopping it
  falls back to the loaded file). No source → `setVideoStream(null)`. When a
  clip ends with loop off (Chromium ends the captured tracks) Play, a seek or
  the poll re-captures it.
- **Transport** (`lab-transport`, Blob Reveal's bar): ▶ / ▮▮ (`lab-play`),
  time (`lab-time`), scrub (`lab-scrub`), ⟳ LOOP (`lab-loop`); shown for a
  video INPUT. Pause also pauses a playing Track.
- **Audio**: `AudioEngine` stays the Lab's audio owner (clip / Track / mic,
  meter tap, BPM). A video INPUT **turns Clip on by itself** (unless Track or
  Mic is on): the operator hears the clip at once. Clip taps the INPUT
  `<video>` and unmutes it (Chromium 128 captures a muted element as
  silence — the 0.11.0 `startClip` fix); the sound plays once, from the
  element, and the effects get `AudioEngine.getOutputStream()` through every
  node's `SynLab.setAudioStream()` (their own analysers, never to the
  speakers). The sidebar meter reads `AudioEngine.meterTap()` as before.
- **Saved settings**: a node coming up gets `applySettings` of its saved
  standalone settings (`syntech.effectSettings.<id>`) unless a preset is
  being loaded. QUADTREE / TIME MACHINE restore a standalone session video
  ~600 ms after load: if a node reports `state().external === false` within
  4 s of its link, it is re-fed the Lab stream once; a source the operator
  picks inside the effect later is respected.
- **Presets v2** (`src/lab/presets.ts`): `{ v: 2, name, chain, settings:
  { <id>: SynLab.getSettings() }, savedAt }` — the exact standalone save
  format per node. Old v1 presets (SynEngine params) load their chain order
  only and say "old preset: chain loaded — effect settings not restored".
- **Master export** (`src/lab/record.ts`): realtime — rewind, play once to
  the end, record the OUTPUT through a fixed-size canvas plus the Lab audio
  (a dropped Clip is re-tapped first). 1920 px wide when the chain output is
  ≥ 1600 px, otherwise native size; the message names both. A photo or the
  webcam records a fixed 10 s take. MP4 (H.264 + AAC) when the browser can
  record it, otherwise WebM (Electron 32 / Chromium 128 cannot record MP4
  with audio, so the desktop file is WebM whenever there is sound). STOP
  cancels.
- **Gemini `LabHandle`** on top of SynLab: keys `<ModuleId>.<SynLab key>`,
  hint = the panel section, `locked` = adapter-locked or §9.13's lists,
  `options` for enums; `applyPlan` applies floors, snaps to the step, records
  the undo values, reports routes as skipped, and refuses during an export.
  OUTPUT stills come from the OUTPUT `<video>`.
- **Order and bypass live in the node graph only**. More than five effect
  nodes lay out in two columns.
- Projects → a saved chain opens the Lab and loads that preset, whether the
  Lab was never opened, is hidden, or is on screen.
- `?labdebug` exposes `window.__synLabDebug` (tests only).

## 4. Save semantics (operator decision: settings/presets only)

- **Save, in single-effect mode** = persist that effect's current parameter
  settings (localStorage key `syntech.effectSettings.<moduleId>`), via the
  bridge (§5). A brief "Saved" flash on the nav button confirms it. No video
  export here — exporting stays inside each effect's own UI, and chain export
  belongs to the Lab's Master MP4 (later phase).
- **Save, elsewhere** = current behavior (session snapshot) plus, when the
  Lab is armed, saving the chain preset flow already in ChainLab.
- **Projects** lists saved chain presets (existing behavior; keep).

## 5. Shell ⇄ effect bridge (permitted edit #1 to effect HTMLs)

The ten standalone HTMLs are ground truth and must keep working when opened
directly as plain files. To support settings save/restore, each HTML gets one
clearly delimited, additive script block appended before `</body>`:

```
<!-- SYNTECH-BRIDGE-START (shell integration; standalone-safe) -->
<script> /* postMessage bridge */ </script>
<!-- SYNTECH-BRIDGE-END -->
```

Contract (window.postMessage, both directions, `{ type, payload }`):

| Direction | type | payload | Behavior |
|---|---|---|---|
| shell → effect | `syn:get-settings` | — | Effect replies with `syn:settings` |
| effect → shell | `syn:settings` | `{ [paramKey]: value }` | Snapshot of current UI parameter values |
| shell → effect | `syn:apply-settings` | `{ [paramKey]: value }` | Effect applies values to its controls (and re-renders) |
| effect → shell | `syn:ready` | `{ id }` | Fired on load; shell then applies saved settings if any |

Rules:
- The bridge reads/writes the effect's existing controls (sliders, toggles) by
  their existing DOM ids — it must not duplicate state or alter visuals.
- If the effect is opened standalone (no parent), the bridge stays silent.
- `EffectHost` gains the shell side: on `syn:ready` apply
  `syntech.effectSettings.<id>`; on nav Save send `syn:get-settings` and
  persist the reply.

### 5.1 Shared chrome (operator request 2026-10-11 — second permitted edit)

*"Gli effetti devono avere tutti l'estetica UI non simile, ma identica"* — the
top bar, the video frame and the right panel of every effect are **Bokeh's**,
pixel for pixel. Bokeh (`public/effects/bokeh/index.html`) is the reference
look; its chrome CSS is copied verbatim into
`public/effects/shared/syn-chrome.css`, and `shared/syn-chrome.js` keeps each
section line (`.sec-mark`) lit in sync with its title. The other four effects
link both inside a delimited `SYNTECH-UNIFORM` block (plus a per-effect
`<style id="syntech-uniform">` that only neutralises leftovers of their old
chrome). Contract every effect follows:

- **Top bar**: name · one separator · `INPUT` pill · `ENGINE` pill ·
  **work timer** `DD:HH:MM:SS` (in place of the old video timecode) · `FPS`.
  Anything else moves into Info. FPS is the real render rate while a source is
  active and **0 with no source** (like Bokeh).
- **Work timers** (operator request 2026-10-11, second round): two separate
  timers. The app's `SESSION` timer (top bar of the shell) starts when the app
  opens; each effect has its own (`public/effects/shared/syn-extras.js`) that
  starts when the effect opens. Both count only while the app window is
  visible **and** focused (focus inside an effect iframe counts) — using other
  apps pauses them; an effect's timer also pauses while the effect is not on
  screen. They live in `sessionStorage` (`syntech.timer.app`,
  `syntech.timer.fx.<ModuleId>`): leaving and reopening an effect, or reloading,
  keeps the value; closing the app (the tab) resets them.
- **Sources**: exactly Bokeh's — `IMAGE · VIDEO · WEBCAM`, in this order, in
  the drop overlay and in Source. The external-camera source (`#src-camera`)
  and the `Camera` section that served it (`#sec-cam-ctrl`) are hidden by
  `shared/syn-chrome.css` (kept in the DOM: the effects' JS binds to them).
- **Timeline**: Blob Reveal's transport bar (▶ PLAY / ▮▮ PAUSE · time · scrub
  track · duration · ⟳ LOOP) under the video in all five. Blob Reveal keeps
  its own `#transport` with its own visibility rule (it appears with the first
  video and stays); the other four get the same bar from
  `shared/syn-extras.js`, shown only while a video **file** is the source
  (Blob Tracker's C camera shortcut is disabled with the source; its old
  ■ ▶ `#tl-bar` is hidden). Play/loop go through each effect's own functions,
  so its Source-section LEDs stay in sync.
- **Frame**: centred `#canvas-wrap` (area − 24 px) with `#frame-outline`, the
  amber corner brackets and Bokeh's drop overlay (name, sources, SOURCE). 16:9
  like Bokeh; blob reveal keeps following the source aspect (16:9 when empty).
- **Panel**: 296 px on the right at every size (no responsive stacking — the
  app shows effects in a ~722×396 frame); every section closed at load except
  **Info** (last, open, Bokeh's 2-column grid + "<NAME> — by STATE").
- **Day theme** (operator request 2026-10-28): the shell's day/night toggle
  reaches every effect iframe (the single-effect `EffectHost` and every Lab
  node). The `<iframe>` carries `data-syn-theme="day" | "night"`, kept in sync,
  and the shell posts `{type:'syn:theme', payload:{mode}}` on load and on
  every change. Inside the effect, `shared/syn-chrome.js` (Bokeh, which has no
  syn-chrome: `shared/syn-extras.js`) reads `frameElement.dataset.synTheme` at
  boot, observes it and listens for `syn:theme`, and sets
  `html[data-syn-theme]` plus `html[data-syn-fx=<ModuleId>]`. The day rules
  live in `shared/syn-chrome.css` under `html[data-syn-theme="day"]` (and the
  transport / timer rules in `syn-extras.js`): the black of the chrome — top
  bar, panel, sections, frame surround, transport, drop overlay, buttons —
  turns white / light with dark text, on all ten effects. The picture itself
  is never recoloured; night is exactly the old look. An effect opened alone
  (no frame, no message) stays night.
- Changing the look means changing Bokeh **and** `shared/syn-chrome.css`
  together. Verified with the computed-style audit described in STATE.md
  (2026-10-11 evening).

### 5.2 The Lab link — `SYNTECH-LAB` (operator decision 2026-10-28 — third permitted edit)

*"Ogni nodo del LAB sia l'effetto vero … serve un ingresso 'stream esterno' negli
effetti tramite bridge additivo e delimitato, senza farlo trattare come webcam:
niente specchio."* Every effect HTML carries one more delimited block, right
after `SYNTECH-BRIDGE-END`:

```
<!-- SYNTECH-LAB-START (Lab chain adapter; standalone-safe) -->
<script src="../shared/syn-lab.js"></script>
<script> SynLab.register({ …this effect's adapter… }) </script>
<!-- SYNTECH-LAB-END -->
```

plus one line in its `SYNTECH-BRIDGE` block exposing the bridge's own
`collect` / `apply` as `window.__synBridge` (so Lab presets use the exact
standalone save format). Where an existing function had to learn about the
external source (e.g. skip the webcam mirror), the hook is a few lines marked
`/* SYNTECH-LAB */`. The API (`window.SynLab`, read synchronously by the shell,
same origin) is specified in 02-ARCHITECTURE "One rendering world". Rules:

- Nothing changes until the shell calls SynLab: opened alone, or as a single
  effect in the shell, the effect behaves exactly as before.
- `setVideoStream(stream)` = a video source that is not the webcam: no mirror,
  the INPUT pill reads `LAB`, the effect's own timeline stays hidden (the Lab
  has the transport). `null` = no source, as at boot. The effect never stops
  the shell's tracks. Picking a file / webcam in the effect's own Source
  section still works and wins.
- `setAudioStream(stream)` = the Lab's music into the effect's own analyser,
  reactivity on as its audio control would turn it on, never to the speakers.
- `params()` lists the look controls of the panel (never Source / Export /
  Info / Camera), grouped by panel section; `setParam` fires the same events a
  user gesture does.

## 6. Node graph spec (INPUT → effects → OUTPUT)

- **Nodes**: INPUT (the loaded source video, with audio — or a still photo,
  §9.11), one node per added effect, OUTPUT (the final composited video).
- **Ports ("holes")**: every effect node has one port on its **left (in)** and
  one on its **right (out)**. INPUT has only a **right** port. OUTPUT has only
  a **left** port.
- **Add Node** (top-left of the panel) opens the effect list in **alphabetical
  order** — all ten since LAB v2 (2026-10-28): ANALOG, ANAMORPHIC, BLOB REVEAL,
  BLOB TRACKER, BOKEH, INVISIBLE, PAINTING, POINTCLOUD, QUADTREE, TIME MACHINE. Selecting
  one inserts its node between INPUT and OUTPUT.
- **Connecting**: press on a port, **drag** a wire to another node's port,
  release on the port → connected. (Current click-to-toggle ports must be
  upgraded to this drag interaction; the brain graph's hub-drag in `VfxCanvas`
  already proves the pattern.)
- **Disconnecting**: the inverse gesture — grab the wire at the port and drag
  it back to where it started, then release.
- **Ghosting rule**: an effect node NOT connected on **both** sides
  (input-side path and output-side path) renders at ~50% opacity, is excluded
  from processing, and its controls are inert until reconnected.
- **Chain order** = wiring order (INPUT → A → B → OUTPUT applies A then B).
  With N connected effects the video renders with all of them simultaneously
  in real time.
- Removing a node (✕) deletes it from the graph entirely.

## 7. Right sidebar (effects library)

- Cards show effect names now; each will get a cover image (assets phase).
  Alphabetical or curated order — keep current order until the assets phase,
  then match the artwork set.
- Clicking a card = single-effect mode (§2). Search box becomes functional in
  a later polish phase (filter by name); non-blocking until then.

## 8. Explicit non-goals for v1

- No user accounts, no server-side persistence, no collaborative editing.
- No mobile layout work (desktop browser is the target).
- ~~No new effects beyond the original five in the Lab~~ — superseded 2026-10-28 (LAB v2):
  all ten effects (the five originals plus INVISIBLE, TIME MACHINE, QUADTREE, POINTCLOUD,
  PAINTING) are Lab nodes, chainable from the node graph, the brain-graph hub drag,
  saved compositions and Gemini "Open in Lab" (`isLabModule` = `MODULE_IDS`, all ten).

## 9. Gemini 3.8 panel (Art Director · Agent · Optimizer)

The panel beside the node graph (`AiDirector`). One model:
`gemini-3.8-flash` (the server's `GEMINI_MODEL` may override it; the panel
names whichever model the server runs). Gemini always receives real pixels
and/or audio — never just a filename. The wire format shared by panel and
server is `src/ai/contract.ts`. Panel chrome is English; everything Gemini
writes back (reads, proposals, summaries, findings) is in Italian.

### 9.1 Key: STANDBY → ACTIVE

- Header pill (`ai-status`): grey **STANDBY** (no key, checking, or
  rejected) → green **ACTIVE** only once a key has been validated.
- Until ACTIVE the panel body is the key form: a password field with
  show/hide (`ai-key-input`), **Connect** (`ai-key-submit`), and a link to
  the free key page (aistudio.google.com/apikey).
- Connect sends the typed key to OUR server (`POST /api/gemini/key`, header
  `x-gemini-key`), which validates it with one `models.get` — no tokens
  spent. Only a key Google accepts is stored (localStorage
  `syntech.geminiKey`); a rejected key stays in the field for correction and
  is never stored. The reason sits beside the label (`ai-key-error`): key
  rejected, model not available for this key, quota, server not reachable…
  A key with characters a header cannot carry (curly quote, non-ASCII space)
  is caught before sending ("copy it again").
- On every load the shell re-checks: `GET /api/gemini/status` (model, and
  whether a server key is usable by THIS browser), then validates the stored
  key, else the server key; with neither it stays STANDBY.
- The key travels only browser → our server, in that header: never in a URL,
  never in a log line, never from the browser to Google.
- ACTIVE card: "Gemini 3.8 is active", the three roles again as buttons
  (`ai-pick-<mode>`, same switch as the rail — always reachable, even when the
  rail's lower buttons sit under the meter on a short window), where the key
  lives ("key from this browser" / "key from server .env") and **Forget key**
  (`ai-key-forget`, browser key only).
- A role call that comes back `invalid_key` or `no_key` (key revoked
  mid-session) drops the panel back to STANDBY and locks the rail again.

### 9.2 Rail gating

- The three mode buttons under GEMINI 3.8 (`nav-gemini-art_director`,
  `nav-gemini-agent`, `nav-gemini-optimizer`) are disabled until ACTIVE:
  dimmed, not-allowed cursor, tooltip "Paste your Gemini key in the Gemini
  3.8 panel to unlock". Leaving ACTIVE closes whatever mode was open.
- Once unlocked, a click toggles that mode; the panel header shows its name.

### 9.3 Server key fallback (this machine only)

- `GEMINI_API_KEY` in `.env.local` (or `.env`) lets this machine skip the
  paste. A pasted key always wins over it.
- It is used only for a browser on this machine talking to the server
  directly: a loopback socket (127.0.0.0/8, ::1), no relay header
  (`Forwarded`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Real-IP`) and a
  `Host` of `localhost`, `*.localhost` or a loopback address. A phone or
  laptop on the LAN opening `http://<ip>:3000`, a `.local` name, a name from
  `ALLOWED_HOSTS`, or anyone coming through a reverse proxy or tunnel on this
  machine gets `serverKey: false` from `/status` and must paste its own key —
  nobody else spends the operator's quota.
- `/api` answers only when the `Host` is `localhost`, `*.localhost`, an IP
  literal, a `*.local` mDNS name (the Mac's Bonjour name, from the iPad) or a
  name listed in `ALLOWED_HOSTS` (comma-separated; `.example.com` /
  `*.example.com` for a domain and its subdomains; `*` turns the check off) —
  the DNS-rebinding guard. Anything else gets 403 `bad_request` whose message
  names the fix ("add <name> to ALLOWED_HOSTS … or open the app by IP address,
  or at http://localhost:PORT"); the key form shows that message, and the
  server logs one `[host] refused …` line per refused name. In dev the same
  rule is Vite's `allowedHosts`, so the page and its API open on the same
  names.

### 9.4 The three roles (the operator's definitions)

- **Art Director** — the creative mind. Watches the source (a video with its
  music, a photo, or the webcam) and proposes which effects fit. Works
  everywhere: Home, an open effect, the Lab — always on the INPUT node's
  source (or the Lab's webcam).
- **Agent** — the operator. Source and effects are already chosen; it sets
  the parameters AND the audio routing so video, music and effect play
  together, and applies them. **Lab only.**
- **Optimizer** — the Agent's controller. Looks at the RESULT (a short output
  clip with its music, plus frames) and reports errors and improvements, each
  with a fix that can be applied. **Lab only.**

### 9.5 What each role sends (captured on demand)

Nothing samples in the background: frames, clips and signal windows are
captured on the button press, once, downscaled, and everything the capture
created is released before the request goes. Each tab shows a "Sends: …"
line saying exactly what will leave the machine (and, when a whole clip is
uploaded, that Google keeps it ~48h and a free key may use it to improve
Google's products).

| Role | Sends |
|---|---|
| Art Director | **Video ≤ 300 MB** (`MAX_UPLOAD_BYTES`) in an uploadable container: the whole file, uploaded once (`/api/gemini/upload` → Files API) and referenced by `fileUri` — Gemini sees the motion AND hears the music; reused from the upload cache (localStorage `syntech.geminiFiles`) while Google keeps it (~48h). **Larger, or MKV**: 12 sampled frames, no audio (the panel says so). **Photo**: 1 JPEG ≤ 1024 px. **Webcam** (Lab): 4 frames over ~2 s. In the Lab also 2 s of live signals and the current chain. Optional direction text (`ai-ad-intent`). |
| Agent | The source video whole (cached upload, or uploaded now when ≤ 300 MB; above that it is not sent and the panel says the song is missing); a SOURCE/OUTPUT frame pair; a **4 s OUTPUT clip with the music** when audio is on; 3 s of live signals; the chain table (enabled effects in render order; every parameter's range, base, route and flags; fps, resolution scale, source kind, audio mode, person-mask state); the art direction (§9.7) when chosen; optional intent (`ai-agent-intent`). In the iframe Lab the chain table lists, per node, every control `SynLab.params()` reports (key `<ModuleId>.<control key>`, label, panel section, type, range / step or the enum's options, current value, locked) — no routes. |
| Optimizer | A 4 s OUTPUT clip (with the music when audio is on, silent otherwise); a SOURCE/OUTPUT frame pair; 2 s of live signals; the chain table; the Lab's deterministic checks (performance, music — reactive effects with audio on or waiting for it, still source, person mask, output exposure — the output's mean luma against the source frame's, so an already dark night or club source is the footage, not a fault: "almost black" only when the output is ≤ 0.04 AND under half the source's, "blown out" by the mirrored rule); the Agent's last plan when that run is still in effect on this Lab, for this chain order (§9.8); the art direction when chosen; optional intent (`ai-opt-intent`, "What should it check? (optional)", next to Check output — when given it says what to look at and wins over the generic checks). |

Inline clips go with `videoMetadata.fps = 12` (`INLINE_VIDEO_FPS`) so a
flash can be checked against a kick; an uploaded source is sampled at 1 fps
(0.5 fps past 10 minutes). The chain table is read before any recording, so
the recording's own load never shows up as a performance problem.

### 9.6 What comes back

- **Art Director** (`ai-ad-run` → `ai-ad-result`): a read — subject,
  setting, mood, palette, motion, and music (energy, tempo feel, timestamped
  moments; null when nothing can be heard) — and 1–3 proposals, each a title,
  a chain of 1–3 effects in render order, why, and audioIdea. The server
  makes every chain renderable: valid ids (any of the ten), no repeats, at
  most three. In the iframe Lab any order renders; the prompt says which
  orders make sense (effects that must find a person before the ones that
  destroy its shape). Each proposal has **Use this chain**
  (`ai-ad-apply-<i>`, §9.7).
- **Agent** (`ai-agent-run` → `ai-agent-result`): a plan — summary and ≤ 12
  control values (no routes since LAB v2: an effect moves with the music
  through its own reactive controls, which are ordinary parameters) — already
  validated by the server, plus what it
  refused (`dropped`) and what it kept but changed (`adjusted`: a base raised
  to its floor or clamped to its range, a route depth capped). **Applied at
  once.** The card lists every change "from → to" (`ai-agent-rows`), each
  adjusted one with its note on the row itself ("Mod Depth: 0.4 → 0.1 ·
  Gemini asked 0, raised to its floor 0.1"), and a "Not applied" list (server
  refusals + anything the Lab skipped), in plain words — an applied change is
  never listed as not applied. A plan the Lab refused whole (a Master export)
  leaves the previous card and its Undo in place, with an error line.
- **Optimizer** (`ai-opt-run` "Check output" → `ai-opt-result`): verdict
  ok / improve / broken, a summary, ≤ 6 issues (error / warning / tip, with
  finding, evidence and clip timestamp, and a fix = a validated plan, or none
  when no parameter can fix it). Failed checks show in amber. Issue cards are
  numbered ("2 · tip", `ai-opt-issue-<i>`) the way the server's "fix N" lines
  are, and each card holds its own refusals (`ai-opt-not-applied-<i>`). Each
  fix lists its rows before it is applied ("Would change:",
  `ai-opt-fix-rows-<i>`, with its adjusted notes) and after ("Changed:").
  **Apply fix** per issue (`ai-opt-fix-<i>`, then a small Undo next to
  "Applied", `ai-opt-fix-undo-<i>`) or **Apply all** (`ai-opt-fix-all`).
- There is **one Lab per session** (§3: once opened it stays mounted), so its
  handle never changes: hiding and showing the Lab (Home, an opened effect, the
  Lab toggle) does not make an Agent or Optimizer result stale — it stays
  live, its Undo / Apply fix keep working on the same Lab. The Art Director's
  read of another source than the one loaded now stays readable but dimmed,
  opens with "Read of <name>, not the current source — run Analyze again for
  this one." (`ai-ad-stale`), and its actions are off; the tab scrolls back to
  its action row when the source changes. The Agent / Optimizer stale path
  ("Earlier run — on a Lab that has closed", `ai-agent-stale`, `ai-opt-stale`)
  stays in the panel as defensive code for a handle that changes, which the
  shell no longer does.

### 9.7 Art Director → Agent handoff

- **Use this chain** wires the proposal's chain in the node graph, opens the
  Lab, keeps the proposal as the **art direction** (title, chain, why,
  audioIdea, music read) in the panel's state for the session, marks its card
  "In use" (check icon, full violet border, `data-in-use` on
  `ai-ad-proposal-<i>`) and switches the panel to the **Agent** tab — the
  director's pipeline: creative mind, then operator. Clearing or replacing
  the direction removes the mark.
- All three tabs show one line "Direction: <title>" with a small × that
  clears it (`ai-ad-direction`, `ai-agent-direction`, `ai-opt-direction`,
  each with `-clear`; the Art Director's also has an "Agent →" link,
  `ai-ad-direction-next`). Agent and Optimizer send it with every run. The
  server prompts treat it as the brief: the
  Agent turns its audioIdea into the effects' reactive controls and its why into values; the Optimizer
  flags a result that does not deliver it. A typed intent still wins where
  the two disagree. If the Lab chain changed since, the idea applies to the
  effects actually there.

### 9.8 Apply / Undo (per-key revert)

- The Lab applies a plan through `LabHandle.applyPlan`, which enforces the
  safety lists (§9.13) again and records the previous base / switch / route
  of every key it touches (`PlanUndo`).
- **Undo** = `revertPlan` of that run's record: it puts back exactly those
  keys — never the operator's other edits, never chain order or enabled.
- **One undo stack per Lab, shared by the Agent and the Optimizer**, last in
  first out: every applied Agent run and every applied fix is pushed on it.
  A tab's Undo works only while its own newest entry is on top; otherwise it
  is off and says what comes first ("Undo the Optimizer's fixes first",
  "Undo the Agent's run first", "Undo fix 2 first"), so an undo can never
  bring back a value another undo already took away. Agent Undo
  (`ai-agent-undo`) reverts its run — or, once that is undone, offers the
  earlier run still in effect ("Undo the 09:47 run"). Optimizer Undo
  (`ai-opt-undo`) reverts the fixes on top of the stack, newest first.
- The Optimizer judges the newest Agent run still on the stack for this Lab,
  and only while the chain order is the one that run was made for; otherwise
  it says "The Agent's last run was undone: judges the Lab as it is" / "The
  Agent's last run was on another chain: judges the Lab as it is" (or "No
  Agent run yet…", `ai-opt-agent-line`) and sends `lastAgent: null`.
- A run is bound to the Lab handle it started on. Since the Lab is mounted
  once for the session, hiding it mid-run (Home, an opened effect, the Lab
  toggle) does **not** stop the run: its captures hold the render loop (and
  the clip / Track, §3) live until each one settles, the plan is applied to
  the hidden Lab, and its Undo is there when the Lab is back. The "The Lab
  changed — run again" stop and the disabled Undo / Apply fix on another Lab
  (the stale result, §9.6) remain only as defensive code for a handle that
  changes. A webcam or
  mic switched off by the hide (§3) is gone for the rest of the run: a later
  capture finds no webcam picture.
- A Master export makes the Lab refuse grabs, plans and reverts. The panel
  learns of it from those refusals only (a ready Lab giving no frame, a
  refused apply or undo): it stops before any upload or request ("A Master
  export is running — run again after it", `ai-agent-export` /
  `ai-opt-export`), turns Run / Check output / Apply / Undo off, and polls
  with a tiny grab until the export is over. The server also answers an
  Agent or Optimizer request with no frame from the Lab with 400 `no_media`,
  even when the whole source is already uploaded, so Gemini is never paid to
  tune blind.

### 9.9 Audio: one rule, and auto Clip audio

- A video INPUT turns Clip audio on by itself (§3.1); a photo or the webcam starts with audio off.
- One rule everywhere (prompts, Optimizer checks): an effect's music
  reaction while audio is off is **waiting for music**, not an error (the
  `music` check). A still photo is flagged only for what it really cannot do
  (the `still_source` check: motion-driven effects on a still).
- When Agent **Run** or Optimizer **Check output** fires on a VIDEO source
  with audio off, the panel first calls `lab.startClipAudio()` — inside the
  click, before any await, so the browser lets the AudioContext start — and
  says so in one line: "Clip audio switched on so Gemini can hear the music"
  (`ai-agent-note` / `ai-opt-note`). If the clip has no audio track, the run
  goes on without and says so: "This clip has no soundtrack: Gemini gets the
  picture only. Start Track or Mic for music." The panel remembers that per
  clip (it does not try again), and every line stops promising sound: Sends
  reads "video only — it has no soundtrack" instead of "(video + audio)", the
  Agent sends no output clip (it records one only with music on), the
  Optimizer's is "4s output clip (silent)", and the context line reads "this
  clip has no soundtrack — the effects' music reactions wait for Track or Mic".
- It is the same switch as the Lab's **Clip** button (`audio-clip`): the
  source video's own soundtrack drives the analysers. Clip is disabled for a
  photo or the webcam (Track or Mic instead).

### 9.10 Lab-only roles: Open in Lab

- Outside the Lab, the Agent and Optimizer tabs say they work in the Lab on
  the INPUT node's source and offer **Open in Lab** (`ai-open-lab`), enabled
  once a clip or photo is loaded (the webcam is started from inside the Lab).
- From an open standalone effect, Open in Lab carries that effect over as a
  one-node chain. The clip and settings loaded INSIDE the effect stay in the
  effect, and the panel says so.

### 9.11 Photo source

- The INPUT node (`source-file`) and the Lab's source button take a video or
  a still photo (`video/*,image/*`).
- On Home the photo fills the hero (`hero-image`). In the Lab the INPUT
  redraws it on a canvas (long side ≤ 1920) whose stream feeds the chain; every effect renders on it.
- A photo has no sound: the sidebar meter stays idle, the INPUT node's
  waveform is flat, Clip is disabled — music comes from Track or Mic. A Master
  export of a photo is a fixed 10 s take.

### 9.12 Endpoints

| Method + path | Does | Answers |
|---|---|---|
| `GET /api/gemini/status` | model + whether this client may use a server key (no key needed) | `StatusResponse` |
| `POST /api/gemini/key` | validates the header key (or the server key) with one `models.get` | `KeyResponse` (200 either way) |
| `POST /api/gemini/upload` | raw file bytes → Files API, waits until Google has processed it | `UploadResponse` |
| `POST /api/gemini/art-director` | watch the source, propose chains | `ArtDirectorResult` |
| `POST /api/gemini/agent` | values for the effects' own controls in the Lab chain | `AgentResult` |
| `POST /api/gemini/optimizer` | judge the Lab's OUTPUT, propose fixes | `OptimizerResult` |

Every failure is `{ error, message }` (`AiErrorResponse`) with a 4xx/5xx
status; `error` is one of `no_key`, `invalid_key`, `model_unavailable`,
`quota`, `too_large`, `no_media`, `bad_request`, `upstream`, `network`,
`server_error`. Any other `/api` path is a 404 in the same shape (the old
`/chat`, `/analyze-video`, `/optimize`, `/analyze` are gone). A role whose strict response schema
Google rejects is retried once with a loose schema (the server logs which
branch ran): a 400 naming the schema, a **bare 400 INVALID_ARGUMENT**
("Request contains an invalid argument." with no reason — the cause of the
Optimizer's `bad_request` after Art Director + Agent in 0.11.0: its schema had
268 enum values), or a bare 500. The schemas are flat, and a key list is sent
as an enum only while it has ≤ 60 entries (`ENUM_KEY_LIMIT`). Limits: JSON
bodies 40 MB; uploads 500 MB on the server (the panel already stops at
300 MB and falls back to frames).

### 9.13 Safety lists (server validator AND the Lab)

Defined once in `src/ai/contract.ts`; enforced by the server's validator
(`validatePlan`, ai-roles.ts) on the Agent's plan and on every Optimizer fix,
and again by the Lab's `applyPlan`. Every refusal or adjustment is reported
back. Since LAB v2 a key is `<ModuleId>.<SynLabParam.key>`
(`PARAM_KEY_PATTERN`) and there are **no signal routes**: an effect reacts to
the music through its own reactive controls, which are ordinary parameters.

- **Unknown** keys (not a control of this chain) are dropped.
- **Locked** controls are never touched: anything the effect's adapter marks
  `locked` (e.g. a webcam mirror), any control in a `LOCKED_GROUPS` section
  (Source, Preset, Performance Pad, Export, Record, Shortcuts, Info — the
  sections whose controls drive other controls, which a per-key Undo could
  not put back), and any key or label matching `LOCKED_CONTROL_PATTERN`
  (an A/B compare split, fullscreen).
- **Values**: numbers clamped to their range and snapped to their step,
  booleans 0/1, enums the option index (an option label from Gemini is
  mapped to its index).
- **Floors** (`PARAM_FLOORS`): `analog` / `quadtree` / `time_machine`
  Reactive › Mod Depth (`sl-modDepth`) never below 0.1 (it scales the
  effect's whole music response); a lower value is raised to the floor.
- **Plan size**: at most 12 parameter changes; a route Gemini still sends is
  refused ("signal routes no longer exist"), and the plan carries
  `routes: []`.
- The old SynEngine lists (`ENUM_KEYS`, `CARRIER_KEYS`, `PROTECTED_KEYS`,
  `MAX_ROUTE_AMOUNT`, `CARRIER_AMOUNT_*`) stay exported as `@deprecated`
  only so legacy code compiles; nothing reads them.
