# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phase 2 — AI Lab UX (armed mode + drag wiring)** (not started)

## Next step

Run Phase 2 of `05-ROADMAP.md` per 03-SPEC-SHELL §3/§6: make the AI Lab nav
a persistent violet toggle; upgrade `NodalComposition` ports to drag-wire
connect/disconnect with side enforcement (INPUT right-only, OUTPUT
left-only); ghost nodes not connected on both sides (~50% opacity, out of
chain); Add Node menu strictly alphabetical; chain order derives from
wiring and stays in sync with the ChainLab rack.

## Phase board

- [x] Phase 0 — Baseline & housekeeping
- [x] Phase 1 — Single-effect mode + settings save (bridge v1)
- [ ] Phase 2 — AI Lab UX (armed mode + drag wiring)
- [ ] Phase 3 — Engine services (AudioEngine, VideoAnalyzer, ParamBus, PersonMask)
- [ ] Phase 4 — 1:1 port: analog
- [ ] Phase 5 — 1:1 port: bokeh
- [ ] Phase 6 — 1:1 port: anamorphic_lab
- [ ] Phase 7 — 1:1 port: blob_reveal
- [ ] Phase 8 — 1:1 port: blob_tracker
- [ ] Phase 9 — Chain export (Master MP4)
- [ ] Phase 10 — Assets & polish

## Open items

- Operator will deliver 6 images (logo + 5 effect covers) → Phase 10,
  prompt D in 08-PROMPTS.md. Not delivered yet.
- `ChainLab` "Master MP4" button references `/effects/vendor/*` files that do
  not exist until Phase 9 — expected to fail until then.
- Effects load CDNs (three.js, MediaPipe, fonts) — network required at
  runtime until Phase 10 vendors them.
- Claude remote sandbox only: `cdn.jsdelivr.net` and `cdnjs.cloudflare.com`
  are blocked by the environment's network policy (fonts.googleapis.com is
  reachable by tools but not by the un-proxied headless browser). Workaround
  used for verification (reuse in Phases 4–8): download the same packages
  from npm (`three@0.128.0`, `@mediapipe/*`) into the scratchpad and serve
  them via Playwright route interception — see the Phase 0 log. Not a
  problem on the operator's machine, where CDNs load normally.

## Decisions record (operator-confirmed)

| # | Decision | Date |
|---|---|---|
| 1 | AI Lab chaining via SynEngine native ports; iframes stay for single-effect mode | 2026-07-17 |
| 2 | Ports must be **1:1 full fidelity** (operator chose over "core look") | 2026-07-17 |
| 3 | Save in single-effect mode = **settings/preset only**, no video export | 2026-07-17 |
| 4 | Workflow docs in English; operator communication in Italian | 2026-07-17 |
| 5 | The 5 uploaded HTMLs (2026-07-17) are the official effect builds; old `blob_tracker` replaced | 2026-07-17 |
| 6 | Add Node menu alphabetical: ANALOG, ANAMORPHIC LAB, BLOB REVEAL, BLOB TRACKER, BOKEH | 2026-07-17 |
| 7 | Port order locked: analog → bokeh → anamorphic_lab → blob_reveal → blob_tracker | 2026-07-17 |

## Log

### 2026-07-17 — Phase 1 complete (bridge v1: settings save/restore)

- Appended the delimited `SYNTECH-BRIDGE` block (03-SPEC-SHELL §5) to all
  five effect HTMLs — additive only, before `</body>`, silent when the page
  has no parent (standalone). Contract implemented: `syn:ready` on load,
  `syn:get-settings` → `syn:settings`, `syn:apply-settings`.
- Per-effect capture/apply:
  - **analog / blob_tracker**: their own preset serializers live inside
    IIFEs (unreachable), so the bridge mirrors them 1:1 through reachable
    top-level globals — sliders + knobs (`syncKnob`) + LED/seg buttons +
    XY pad (`PAD` / `setPad`, `padX/padY`); blob_tracker also colors and
    custom text. Field lists copied from `PRESET_*` in the HTML.
  - **anamorphic_lab**: all range sliders + the six `tog-*` toggles.
  - **blob_reveal**: sliders + `btn-seg` / `btn-model` toggles.
  - **bokeh**: sliders + knobs (`setKnob`) + `#style-sel` group + letterbox/
    breathing/shape-pad toggles (style applied before `btn-bshape` because
    the shape pad stashes the prior style as its restore point).
- Shell: `EffectHost` (forwardRef) applies `syntech.effectSettings.<id>` on
  `syn:ready` and exposes `requestSave()`; nav **Save** in single-effect
  mode persists the effect's settings + "Saved" flash (03-SPEC-SHELL §4),
  session-snapshot behavior unchanged elsewhere. No Home confirmations.
- **Deliberately not saved** (runtime/device state, not settings):
  `cam-device-sel` pickers, mic/webcam/record/fullscreen buttons,
  play/pause/loop transport, bokeh shape-pad x/y position (its on/off IS
  saved), and the effects' own video-blob session systems.
- Payload note: `syn:settings` payload is a per-effect structured object
  (`{sliders:{id:v}, knobs:{...}, ...}`) rather than a flat key map — the
  shell treats it as opaque; shape documented here for Phases 4–8.
- Verified per 06-VERIFICATION: lint clean; headless Playwright
  (`verify-phase1.js`), **21/21 PASS** — per effect: tweak slider (+1
  toggle where curated) → Save (flash observed, localStorage key written) →
  Home → reopen → values restored exactly; zero shell page errors; each
  HTML opened standalone (direct top-level URL) with zero non-font console
  errors and zero `syn:*` messages (bridge silent). Regression: all five
  effects still open and boot in single-effect mode.

### 2026-07-17 — Phase 0 complete (baseline & housekeeping)

- Merged the workflow branch into `main`; session ran on
  `claude/fable-5-merge-roadmap-phase-uzbso9` rebased on that `main`.
- Deleted the 20 dead root scripts listed in the phase (close_div.cjs,
  fix_*.cjs/js, recover_git.py, remove/replace/revert_*.cjs,
  update_vfxcanvas.cjs) — grep confirmed nothing references them.
- Found & fixed an in-scope gap: the right-sidebar effect cards had **no
  click handler**, violating 03-SPEC-SHELL §7 ("Clicking a card =
  single-effect mode"). Added `onClick={handleModuleOpen(id)}` +
  `cursor-pointer` to the card div in `src/App.tsx` — only code change.
- Verified per 06-VERIFICATION.md: `npm install` + `npm run lint` clean,
  `npm run dev` serves :3000, all five effect URLs return 200. Headless
  Playwright suite (scratchpad `verify-phase0.js`), 27/27 checks PASS:
  home brain graph renders; each of the 5 effects opens full-hero **both**
  from its sidebar card and from its brain-graph hub (hub positions computed
  from `VfxCanvas` hubsConfig, real mouse click); inside every effect:
  canvas present, a slider tweaked via input event, and a generated 3s test
  video (canvas+MediaRecorder webm) loaded — DOM `<video>` reaches
  readyState 4 and plays (blob_tracker, blob_reveal, anamorphic_lab);
  analog/bokeh keep the video off-DOM, verified via drop-overlay hidden +
  filename label. Screenshots confirm blob_tracker tracking the test clip
  (FPS 37) and analog's SORT–FEEDBACK–CRT pipeline rendering.
- Console errors: **only** Google Fonts `ERR_CONNECTION_RESET`, a
  sandbox-only limitation (no direct internet for the headless browser).
  Blocked CDN libs (three.js, MediaPipe) were served from local npm mirrors
  via route interception — see Open items for the reusable workaround.
- Deviation from a strict read of the phase: "internal UI works" was
  verified headless (video load + slider + screenshots), not by a human;
  fonts could not be loaded in-sandbox (cosmetic only).

### 2026-07-17 — Workflow created (setup session)

- Analyzed repo + the 5 uploaded effect HTMLs; wrote CLAUDE.md and
  docs/workflow/01–08 + STATE.md.
- Committed the 5 official effect HTMLs to `public/effects/<id>/index.html`
  (blob_tracker replaced with the operator's current build; analog,
  blob_reveal, bokeh, anamorphic_lab added).
- No feature code written; engine stubs untouched. Verification: none run
  (docs-only session) — Phase 0 does the first full baseline check.
