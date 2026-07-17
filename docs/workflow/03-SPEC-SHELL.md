# 03 — SHELL FUNCTIONAL SPEC

This is the operator's (founder's) exact intended behavior. Where the current
code differs, THIS SPEC WINS. Anything not covered here: keep current behavior.

## 1. Layout (already in place — do not restructure)

- **Top bar**: status left, "VFX Syntech / Created by State" wordmark centered,
  session clock right.
- **Left sidebar**: temporary "VS" logo top; nav = Home, Save, Projects,
  AI Lab; below the divider, the three Gemini modes (Art Dir, Agent,
  Optimizer).
- **Center hero**: on launch, the animated brain graph (`VfxCanvas`) — the
  app's "second brain": VFX SYNTECH core firing neural connections to every
  effect. This space is where the video/effect appears while working.
- **Below the hero**: the node graph panel (`NodalComposition`) — this IS the
  AI Lab's wiring surface — plus the AI Director panel beside it.
- **Right sidebar**: the effects library (5 cards; artwork images arrive
  later).

## 2. Single-effect mode

- Clicking an effect card on the right (or its hub on the brain graph) opens
  that effect's standalone HTML **in the hero space** (iframe via
  `EffectHost`). It fills the section; the shell chrome stays around it.
- **One effect at a time.** Applying multiple effects simultaneously is
  exclusively an AI Lab capability.
- **Home** returns to the brain graph view. Unsaved parameter changes in the
  effect are lost — this is intended, no blocking "are you sure" dialogs.
- Re-opening an effect restores its **saved** settings (see §4), not the
  abandoned ones.

## 3. AI Lab activation model

- The AI Lab nav button is a **mode toggle**: click → turns violet
  (`--syn-accent`) and **stays lit until manually toggled off**. It can be
  armed at any time — while an effect is open, or from the empty dashboard.
- While armed, the composition runs live: the enabled node chain processes the
  INPUT source in real time on the SynEngine surface (`ChainLab`), and the
  node graph below reflects/edits the same state.
- Toggling AI Lab off returns to the normal dashboard; the composition state
  (nodes, wiring, params) is preserved for the next time it is armed.

## 4. Save semantics (operator decision: settings/presets only)

- **Save, in single-effect mode** = persist that effect's current parameter
  settings (localStorage key `syntech.effectSettings.<moduleId>`), via the
  bridge (§5). A brief "Saved" flash on the nav button confirms it. No video
  export here — exporting stays inside each effect's own UI, and chain export
  belongs to the AI Lab's Master MP4 (later phase).
- **Save, elsewhere** = current behavior (session snapshot) plus, when the AI
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

- **Nodes**: INPUT (the loaded source video, with audio), one node per added
  effect, OUTPUT (the final composited video).
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
