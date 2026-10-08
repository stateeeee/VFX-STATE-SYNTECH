# 03 — SHELL FUNCTIONAL SPEC

This is the operator's (founder's) exact intended behavior. Where the current
code differs, THIS SPEC WINS. Anything not covered here: keep current behavior.

## 1. Layout (already in place — do not restructure)

- **Top bar**: status left, "VFX Syntech / Created by State" wordmark centered,
  session clock right.
- **Left sidebar**: temporary "VS" logo top; nav = Home, Save, Projects,
  Lab; below the divider, the GEMINI 3.8 label and the three Gemini modes
  (Art Dir, Agent, Optimizer) — locked until a key is active (§9).
- **Center hero**: on launch, the animated brain graph (`VfxCanvas`) — the
  app's "second brain": VFX SYNTECH core firing neural connections to every
  effect. This space is where the video/effect appears while working.
- **Below the hero**: the node graph panel (`NodalComposition`) — this IS the
  Lab's wiring surface — plus the Gemini 3.8 panel (`AiDirector`, §9) beside
  it.
- **Right sidebar**: the effects library (5 cards; artwork images arrive
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

- The Lab nav button (testid still `nav-ailab`) is a **mode toggle**: click →
  turns violet (`--syn-accent`) and **stays lit until manually toggled off**.
  It can be armed at any time — while an effect is open, or from the empty
  dashboard.
- While armed, the composition runs live: the enabled node chain processes the
  INPUT source in real time on the SynEngine surface (`ChainLab`), and the
  node graph below reflects/edits the same state.
- Toggling the Lab off returns to the normal dashboard; the composition state
  (nodes, wiring, params) is preserved for the next time it is armed.

## 4. Save semantics (operator decision: settings/presets only)

- **Save, in single-effect mode** = persist that effect's current parameter
  settings (localStorage key `syntech.effectSettings.<moduleId>`), via the
  bridge (§5). A brief "Saved" flash on the nav button confirms it. No video
  export here — exporting stays inside each effect's own UI, and chain export
  belongs to the Lab's Master MP4 (later phase).
- **Save, elsewhere** = current behavior (session snapshot) plus, when the
  Lab is armed, saving the chain preset flow already in ChainLab.
- **Projects** lists saved chain presets (existing behavior; keep).

## 5. Shell ⇄ effect bridge (the ONLY permitted edit to effect HTMLs)

The five standalone HTMLs are ground truth and must keep working when opened
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

## 6. Node graph spec (INPUT → effects → OUTPUT)

- **Nodes**: INPUT (the loaded source video, with audio — or a still photo,
  §9.11), one node per added effect, OUTPUT (the final composited video).
- **Ports ("holes")**: every effect node has one port on its **left (in)** and
  one on its **right (out)**. INPUT has only a **right** port. OUTPUT has only
  a **left** port.
- **Add Node** (top-left of the panel) opens the effect list in **alphabetical
  order**: ANALOG, ANAMORPHIC LAB, BLOB REVEAL, BLOB TRACKER, BOKEH. Selecting
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
- No new effects beyond the five until the roadmap says so.

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

### 9.3 Server key fallback (loopback only)

- `GEMINI_API_KEY` in `.env.local` (or `.env`) lets this machine skip the
  paste. A pasted key always wins over it.
- It is used only for requests whose socket is loopback (127.0.0.0/8, ::1).
  A phone or laptop on the LAN opening `http://<ip>:3000` gets
  `serverKey: false` from `/status` and must paste its own key — nobody on
  the network spends the operator's quota.
- `/api` answers only when the `Host` is `localhost` or an IP literal
  (DNS-rebinding guard); anything else gets 403.

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
| Agent | The source video whole (cached upload, or uploaded now when ≤ 300 MB; above that it is not sent and the panel says the song is missing); a SOURCE/OUTPUT frame pair; a **4 s OUTPUT clip with the music** when audio is on; 3 s of live signals; the chain table (enabled effects in render order; every parameter's range, base, route and flags; fps, resolution scale, source kind, audio mode, person-mask state); the art direction (§9.7) when chosen; optional intent (`ai-agent-intent`). |
| Optimizer | A 4 s OUTPUT clip (with the music when audio is on, silent otherwise); a SOURCE/OUTPUT frame pair; 2 s of live signals; the chain table; the Lab's deterministic checks (performance, audio routes, video routes, person mask, output exposure); the Agent's last plan when it ran on this Lab and was not undone; the art direction when chosen. |

Inline clips go with `videoMetadata.fps = 12` (`INLINE_VIDEO_FPS`) so a
flash can be checked against a kick; an uploaded source is sampled at 1 fps
(0.5 fps past 10 minutes). The chain table is read before any recording, so
the recording's own load never shows up as a performance problem.

### 9.6 What comes back

- **Art Director** (`ai-ad-run` → `ai-ad-result`): a read — subject,
  setting, mood, palette, motion, and music (energy, tempo feel, timestamped
  moments; null when nothing can be heard) — and 1–3 proposals, each a title,
  a chain of 1–3 effects in render order, why, and audioIdea. The server
  makes every chain renderable: valid ids, no repeats, at most one of
  `blob_tracker` / `blob_reveal` and that one first (both rebuild the frame
  from the raw source). Each proposal has **Use this chain**
  (`ai-ad-apply-<i>`, §9.7).
- **Agent** (`ai-agent-run` → `ai-agent-result`): a plan — summary, ≤ 12
  parameter bases, ≤ 6 routes — already validated by the server, plus what it
  refused. **Applied at once.** The card lists every change "from → to" and a
  "Not applied" list (server refusals + anything the Lab skipped), in plain
  words.
- **Optimizer** (`ai-opt-run` "Check output" → `ai-opt-result`): verdict
  ok / improve / broken, a summary, ≤ 6 issues (error / warning / tip, with
  finding, evidence and clip timestamp, and a fix = a validated plan, or none
  when no parameter can fix it). Failed checks show in amber. **Apply fix**
  per issue (`ai-opt-fix-<i>`) or **Apply all** (`ai-opt-fix-all`).

### 9.7 Art Director → Agent handoff

- **Use this chain** wires the proposal's chain in the node graph, opens the
  Lab, and keeps the proposal as the **art direction** (title, chain, why,
  audioIdea, music read) in the panel's state for the session.
- Agent and Optimizer show one line "Direction: <title>" with a small × that
  clears it (`ai-agent-direction`, `ai-opt-direction`, each with `-clear`),
  and send it with every run. The server prompts treat it as the brief: the
  Agent turns its audioIdea into routes and its why into bases; the Optimizer
  flags a result that does not deliver it. A typed intent still wins where
  the two disagree. If the Lab chain changed since, the idea applies to the
  effects actually there.

### 9.8 Apply / Undo (per-key revert)

- The Lab applies a plan through `LabHandle.applyPlan`, which enforces the
  safety lists (§9.13) again and records the previous base / switch / route
  of every key it touches (`PlanUndo`).
- **Undo** = `revertPlan` of that run's record: it puts back exactly those
  keys — never the operator's other edits, never chain order or enabled.
  Agent Undo (`ai-agent-undo`) also forgets the Agent's last run, so the
  Optimizer never judges an undone plan. Optimizer Undo (`ai-opt-undo`)
  reverts every fix applied from that result, newest first.
- A run is bound to the Lab it started on: if the Lab is closed or reopened
  mid-run, the run stops ("The Lab changed — run again"), and Undo / Apply
  fix stay disabled on any other Lab.
- Apply and Undo are both refused while a Master export runs (a change
  mid-encode would show as a jump in the file).

### 9.9 Audio: one rule, and auto Clip audio

- Audio off is the Lab's default, even for a music video.
- One rule everywhere (prompts, validator, Optimizer checks): a route on an
  audio signal (bass, treble, loud, beat) while audio is off is **waiting for
  music**, not an error. Only motion / bright routes on a provably dead
  signal (a still photo) are flagged. Carriers are never counted.
- When Agent **Run** or Optimizer **Check output** fires on a VIDEO source
  with audio off, the panel first calls `lab.startClipAudio()` — inside the
  click, before any await, so the browser lets the AudioContext start — and
  says so in one line: "Clip audio switched on so Gemini can hear the music"
  (`ai-agent-note` / `ai-opt-note`). If the clip has no audio, the run goes on
  without.
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
- On Home the photo fills the hero (`hero-image`). In the Lab SynEngine loads
  it as a still (flattened over black, long side ≤ 2560 px) and every effect
  renders on it.
- A photo has no sound: the sidebar meter stays idle, the INPUT node's
  waveform is flat, Clip is disabled — music comes from Track or Mic. Master
  MP4 export needs a video.

### 9.12 Endpoints

| Method + path | Does | Answers |
|---|---|---|
| `GET /api/gemini/status` | model + whether this client may use a server key (no key needed) | `StatusResponse` |
| `POST /api/gemini/key` | validates the header key (or the server key) with one `models.get` | `KeyResponse` (200 either way) |
| `POST /api/gemini/upload` | raw file bytes → Files API, waits until Google has processed it | `UploadResponse` |
| `POST /api/gemini/art-director` | watch the source, propose chains | `ArtDirectorResult` |
| `POST /api/gemini/agent` | params + routes for the Lab chain | `AgentResult` |
| `POST /api/gemini/optimizer` | judge the Lab's OUTPUT, propose fixes | `OptimizerResult` |

Every failure is `{ error, message }` (`AiErrorResponse`) with a 4xx/5xx
status; `error` is one of `no_key`, `invalid_key`, `model_unavailable`,
`quota`, `too_large`, `no_media`, `bad_request`, `upstream`, `network`,
`server_error`. Any other `/api` path is a 404 in the same shape (the old
`/chat`, `/analyze-video`, `/optimize`, `/analyze` are gone). Limits: JSON
bodies 40 MB; uploads 500 MB on the server (the panel already stops at
300 MB and falls back to frames).

### 9.13 Safety lists (server validator AND the Lab)

Defined once in `src/ai/contract.ts`; enforced by the server's validator on
the Agent's plan and on every Optimizer fix, and again by the Lab's
`applyPlan`. Every refusal or adjustment is reported back.

- **Enum** keys (`ENUM_KEYS`, e.g. `analog.sortDir`, `bokeh.bokehStyle`):
  snapped to integers inside their range, never routed.
- **Carrier** keys (`CARRIER_KEYS`: `analog.reactBass/Mid/High`,
  `blob_reveal.beatReact`, `blob_tracker.connGlow`,
  `blob_tracker.rippleForce`): their route IS the effect's music response.
  Base stays 0; only the route amount may change, within 0.05..1
  (`CARRIER_AMOUNT_MIN/MAX`), on the same source; never switched off.
- **Protected** keys (`PROTECTED_KEYS`): never touched —
  `anamorphic_lab.compare`, `anamorphic_lab.lutMix`, `blob_reveal.segN`,
  `bokeh.segEnabled`, `analog.reactEnabled`.
- **Floors** (`PARAM_FLOORS`): `analog.modDepth` never below 0.1 (it scales
  analog's whole music response); a lower base is raised to the floor, and
  the validator refuses a negative route on it.
- **Route cap**: ordinary route amounts within ±0.6 (`MAX_ROUTE_AMOUNT` — the
  deepest factory route, so a default can always be restored); only
  parameters marked reactive can be routed.
- **Plan size**: at most 12 parameter changes and 6 routes; unknown keys are
  dropped, numbers clamped and snapped to their step, switches 0/1.
