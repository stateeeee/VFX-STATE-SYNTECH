# 05 — ROADMAP

Phases are ordered by dependency and value. **One phase per work session** is
the default pace; a session may finish early but must never start a phase it
cannot verify. Each phase ends with: acceptance criteria met, verification run
(06-VERIFICATION.md), `STATE.md` updated, commit pushed.

---

## Phase 0 — Baseline & housekeeping

**Goal**: clean, verified starting point.

- [ ] `npm install`, `npm run lint` clean, `npm run dev` serves on :3000.
- [ ] All five effects open full-hero from the right sidebar and from the
      brain graph hubs; each one's internal UI works (load video, tweak
      sliders). They are served from `public/effects/<id>/index.html`.
- [ ] Delete dead root scripts: `close_div.cjs`, `fix_ai_director.cjs`,
      `fix_ai_director_colors.cjs`, `fix_app_nodal.cjs`, `fix_colors.js`,
      `fix_graph_remove.cjs`, `fix_graph_title.cjs`, `fix_hero_gradient.cjs`,
      `fix_nodal_comp.cjs`, `fix_vfx_colors.cjs`, `recover_git.py`,
      `remove_vfx_border.cjs`, `replace_chainlab_gold.cjs`,
      `replace_css_vars.cjs`, `replace_gold.cjs`, `replace_gold_comp.cjs`,
      `replace_gold_eff.cjs`, `replace_vfx_gold.cjs`, `revert_borders.cjs`,
      `update_vfxcanvas.cjs`.
- [ ] Note any effect that errors in console (CDN reachability etc.) in
      STATE.md.

**Accept when**: five effects demonstrably run inside the shell; lint clean;
repo root clean.

## Phase 1 — Single-effect mode + settings save (bridge v1)

**Goal**: the §2/§4/§5 behavior of 03-SPEC-SHELL.

- [ ] Append the delimited bridge block to each of the five HTMLs
      (additive only; standalone still works when opened directly).
- [ ] Shell side in `EffectHost`: on `syn:ready` apply saved settings from
      `syntech.effectSettings.<id>`; expose a save trigger.
- [ ] Nav **Save** while an effect is open saves that effect's settings
      (flash feedback). Home → reopen restores them.
- [ ] No confirmation dialogs on Home (intended data loss).

**Accept when**: for every effect — tweak params, Save, Home, reopen →
settings restored; opened standalone (file/direct URL) → zero console errors
from the bridge.

## Phase 2 — AI Lab UX (armed mode + drag wiring)

**Goal**: §3/§6 of 03-SPEC-SHELL.

- [ ] AI Lab nav = persistent violet toggle (armed state survives navigation;
      only manual click disarms).
- [ ] Node graph: drag-wire connect between ports (press hole → drag → release
      on target hole), inverse gesture disconnects; port sides enforced
      (INPUT right-only, OUTPUT left-only, effects both).
- [ ] Ghosting: node not connected on both sides → ~50% opacity + excluded
      from chain.
- [ ] Add Node menu strictly alphabetical: ANALOG, ANAMORPHIC LAB, BLOB
      REVEAL, BLOB TRACKER, BOKEH.
- [ ] Chain order derives from wiring; ChainLab rack reflects the same state
      both ways (existing shared composition state).

**Accept when**: a user can build INPUT → analog → blob_tracker → OUTPUT purely
by dragging, see both nodes ACTIVE, detach one wire and see the node ghost and
drop out of the chain readout.

## Phase 3 — Engine services (reactivity backbone)

**Goal**: replace the four stubs so ChainLab's existing UI becomes real.
Prerequisite for every port phase.

- [ ] `AudioEngine`: mic + audio-file modes; FFT → `bass/loud/treble` (0..1,
      smoothed), `beat` pulse, BPM estimate; `FileTransport`
      play/pause/seek/loop wired to the existing controls.
- [ ] `VideoAnalyzer`: downsampled frame differencing → `motion`; average
      luma → `bright` (0..1, smoothed).
- [ ] `ParamBus`: real snapshot/apply — `final = clamp(base + signal × amount
      × paramRange)` each frame for routed params; serialize/restore already
      shaped by presets.
- [ ] `PersonMask`: shared MediaPipe SelfieSegmentation service (lazy-load,
      states off/loading/ready, mask canvas output) consumed via
      `engine.personMaskSource`.

**Accept when**: with a music file loaded, meters + BPM move; routing `bass`
onto any dummy-node param visibly modulates its readout; SEG reaches READY on
demand.

## Phases 4–8 — 1:1 effect ports into SynEngine (one phase each)

Order (locked, easiest → hardest): **4 = analog, 5 = bokeh,
6 = anamorphic_lab, 7 = blob_reveal, 8 = blob_tracker.**

Template for every port phase:

- [ ] Read the effect HTML end-to-end; extract the full param table (id,
      label, range, default) and the render pipeline.
- [ ] Implement `EngineNode` in `src/engine/nodes/<id>.ts` (new folder;
      factory in `nodes.ts` swaps DummyNode → real node). All params in
      `ParamSchema` with `reactive: true` where the original reacts;
      `aiHint` written for Gemini.
- [ ] Reactivity via ParamBus routes reproducing the original's audio/video
      response (the original's dedicated reactive controls map to default
      routes).
- [ ] Segmentation-dependent effects consume the shared PersonMask.
- [ ] `blob_tracker` only: three.js (npm dep allowed) rendering offscreen,
      uploaded as node texture — identical output over identical plumbing.
- [ ] **Parity run** per 06-VERIFICATION.md §4 (side-by-side, param sweep,
      screenshot evidence) — attach results to STATE.md log.

**Accept when**: parity checklist passes for that effect; chain of all
previously ported effects still runs ≥30fps at 720p on the dev machine.

## Phase 9 — Chain export (Master MP4)

- [ ] Implement `/effects/vendor/mp4-muxer.min.js` (vendored dependency) and
      `/effects/vendor/syntech-export.js` (WebCodecs frame-stepping exporter
      matching the existing `SyntechExport.exportMasterQuality` call
      signature in ChainLab).
- [ ] Deterministic offline render path (engine already exposes
      `renderFrame(clock)`, adaptive-res already forced off).

**Accept when**: a 10s 1080p video with a 2-effect chain exports to a playable
MP4 with correct duration.

## Phase 10 — Assets & polish

- [ ] Integrate the 6 operator-supplied images (logo top-left; 5 effect card
      covers on the right sidebar) when delivered.
- [ ] Functional search box (filter effects by name).
- [ ] Vendor CDN dependencies locally (three.js, MediaPipe models, fonts)
      for offline resilience.
- [ ] Performance pass: chain of 5 at 720p ≥30fps or graceful adaptive-res.
- [ ] Sweep for stray non-token colors; day-mode audit.

---

## Later (do not start unless the operator asks)

Webcam as INPUT node in AI Lab is already supported by SynEngine — surface it
in the node UI. Image (still) input. New effects beyond the five (target ~20).
Payments/licensing. Deploy pipeline hardening (AI Studio / Cloud Run).
