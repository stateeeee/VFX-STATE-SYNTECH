# 06 — VERIFICATION

No phase is "done" on code inspection alone. Verify by running the app and
observing behavior. Record what was verified (and how) in STATE.md.

## 1. Static gates (every session, before commit)

```bash
npm run lint        # tsc --noEmit — must be clean
```

## 2. Run the app

```bash
npm install         # first time
npm run dev         # http://localhost:3000
```

- Server: Express on port 3000 with Vite middleware; effects at
  `/effects/<id>/index.html`.
- `GEMINI_API_KEY` unset is fine — AI endpoints return offline fallbacks; that
  must never block non-AI verification.

## 3. Browser verification (headless, in this environment)

Chromium is pre-installed for Playwright. In the Claude Code remote
environment do NOT run `playwright install`; launch with
`executablePath: '/opt/pw-browsers/chromium'` if the pinned
`@playwright/test` cannot find it. Write one-off scripts to the scratchpad,
not the repo (only commit tests if a phase says so).

Useful checks (the shell already ships `data-testid`s — keep them working):

- `nav-home`, `nav-save`, `nav-projects`, `nav-ailab` — left nav
- `effect-card-<id>` — right sidebar cards
- `nodal-add`, `nodal-add-<id>`, `nodal-input`, `nodal-output`,
  `nodal-node-<id>`, `port-*`, `nodal-svg` — node graph
- `chain-canvas`, `chain-fps`, `chain-res`, `toggle-<id>`,
  `param-<node>-<key>`, `mod-src-*`, `mod-amt-*`, `audio-*`, `signal-*` —
  AI Lab
- `source-file`, `chain-file`, `hero-video` — source loading

Feed deterministic media in headless runs: launch Chromium with
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` for
webcam/mic flows, and set file inputs directly with `setInputFiles` (generate
a short test MP4 with ffmpeg into the scratchpad if none exists).

Pixel-level assertion for engine work: read the `chain-canvas` pixels
(`preserveDrawingBuffer` is enabled) and assert non-black variance / expected
statistics rather than exact pixels.

## 4. Parity protocol for 1:1 ports (Phases 4–8) — binding

For the effect being ported, prove equivalence between the standalone HTML
(ground truth) and the SynEngine node:

1. **Param table diff** — enumerate every control in the HTML (id, label,
   range, default). The node's `ParamSchema` must cover 100% of them. Any
   intentional consolidation must be listed and justified in STATE.md.
2. **Same-input side-by-side** — load the same test clip in both. For at
   least: (a) defaults, (b) each param at min and max (sweep one at a time,
   others at defaults), (c) one "hero look" combining several params —
   capture screenshots of both at the same video timestamp.
3. **Compare** — visual match on structure, color response, and motion
   character. Automated aid: downscale both captures and compare histograms /
   SSIM-style diff; investigate anything visibly divergent. three.js/canvas
   randomness (particles, jitter seeds) may differ per-frame — judge the
   *behavior*, not per-pixel identity, for stochastic elements.
4. **Reactivity check** — play a music track (or synthesized beat file)
   through AudioEngine; confirm the node's reactive params move with the same
   character as the original's audio-reactive behavior (e.g. bass hits →
   displacement spikes). Same for motion/brightness where the original is
   video-reactive.
5. **Chain sanity** — the new node composed with all previously ported nodes
   renders ≥30fps at 720p and produces no GL errors.
6. **Evidence** — save captures under the scratchpad, summarize results (and
   any accepted deltas) in the STATE.md log entry for the phase.

## 5. Regression sweep (end of every phase)

- Five effects still open and run in single-effect mode (bridge silent
  standalone).
- Save → Home → reopen restores settings (Phase 1+).
- AI Lab arm/disarm keeps composition state; wiring still drag-operable
  (Phase 2+).
- `npm run lint` clean; no new console errors on the dashboard.
