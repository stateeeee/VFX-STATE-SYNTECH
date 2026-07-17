# STATE — Live Progress Tracker

> Read this first every session. Update it (checkboxes + log + next step) in
> the same commit as the work, every session, per 07-SESSION-PROTOCOL.md.

## Current phase

**Phase 0 — Baseline & housekeeping** (not started)

## Next step

Run Phase 0 of `05-ROADMAP.md`: install, lint, launch, verify all five
effects open inside the shell, delete the dead root scripts listed in the
phase, log findings here.

## Phase board

- [ ] Phase 0 — Baseline & housekeeping
- [ ] Phase 1 — Single-effect mode + settings save (bridge v1)
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

### 2026-07-17 — Workflow created (setup session)

- Analyzed repo + the 5 uploaded effect HTMLs; wrote CLAUDE.md and
  docs/workflow/01–08 + STATE.md.
- Committed the 5 official effect HTMLs to `public/effects/<id>/index.html`
  (blob_tracker replaced with the operator's current build; analog,
  blob_reveal, bokeh, anamorphic_lab added).
- No feature code written; engine stubs untouched. Verification: none run
  (docs-only session) — Phase 0 does the first full baseline check.
