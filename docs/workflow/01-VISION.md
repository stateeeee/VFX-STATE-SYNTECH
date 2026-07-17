# 01 — VISION

## What VFX SYNTECH is

A browser-based VFX studio for videomakers. The founder is an established
director who knows After Effects and TouchDesigner by heart and built this app
from that experience. Those tools are paid, hard to learn, and have a slow
workflow: days are lost just discovering which effects exist and how to use
them. VFX SYNTECH inverts that: a curated set of the most beautiful,
hardest-to-build effects, usable in minutes, with results that match or beat
the big tools.

The interface metaphor is a **"second brain"**: on launch, the hero area shows
an animated brain graph — VFX SYNTECH at the center firing neural connections
out to every effect in the app.

## The 4 pillars (every decision is judged against these)

1. **Beautiful.** The product must look stunning and professional. People only
   pay for — and share on social — tools that look premium. Visual polish is a
   feature, not a nice-to-have.
2. **Functional.** Intuitive and easy. A user must get a *better* result than
   in After Effects or TouchDesigner in *less* time. If a flow needs a manual,
   it is wrong.
3. **Professional.** The effects are a curated selection (5 now, growing to
   ~20) of the most beautiful and technically hard effects. They are **audio
   reactive and video reactive**: the founder shoots music videos and wants
   effects that fuse with the song — when the rhythm rises, the effect changes.
   Effects must feel composed with the music like a beat under a vocal, never
   pasted on top.
4. **Web app.** Runs in the browser. Zero install, zero disk space, and easy
   for companies to integrate into their own systems compared to a desktop app.

## Product shape (operator's mental model)

- **Left sidebar**: all the commands (Home, Save, Projects, AI Lab, Gemini
  modes).
- **Right sidebar**: the effects library (the 5 effects; artwork covers coming).
- **Center hero**: the animated brain graph on launch; the video takes this
  space while working.
- **Single-effect mode**: click an effect on the right → that effect's full
  app opens in the hero space. One effect at a time on the video. Home returns
  to the brain graph; unsaved parameter changes are lost (by design — Save
  exists for that).
- **AI Lab**: the node section under the brain graph. Toggle it on (it turns
  violet and STAYS on until manually toggled off). INPUT and OUTPUT nodes are
  always there; "Add Node" inserts effects; wiring nodes by dragging between
  their connection holes runs multiple effects on the same video in real time.
  An effect disconnected from either side ghosts to ~50% opacity and stops
  processing.

## Known placeholders (do not "fix" prematurely)

- The top-left logo is temporary.
- The 5 effect cards on the right have no artwork yet. The operator will
  deliver 6 images (logo + one per effect); a roadmap phase integrates them.
  Until then, the plain text cards are acceptable.

## Quality bar

When in doubt: would a professional director demo this to a label on a
projector? Motion must be smooth (60fps target, adaptive resolution when not),
typography and spacing must match the existing design system, and reactive
behavior must feel musical, not jittery.
