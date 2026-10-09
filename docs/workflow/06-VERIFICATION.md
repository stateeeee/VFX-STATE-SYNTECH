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

- Server: Express on port 3000 (or `PORT`) with Vite middleware; effects at
  `/effects/<id>/index.html`. A second server next to the operator's (a test
  run, a parallel session) takes its own port —
  `PORT=31xx DISABLE_HMR=true npm run dev` — and is stopped by that port only
  (`fuser -k 31xx/tcp`).
- No key is fine for everything that is not AI: the Gemini 3.8 panel just
  stays STANDBY with its three modes locked (there are no offline AI answers
  any more). That must never block non-AI verification. The AI flow itself is
  verified against the local mock (§3, "Gemini 3.8 suite"), never with a real
  key in the sandbox.

## 3. Browser verification (headless, in this environment)

Chromium is pre-installed for Playwright. In the Claude Code remote
environment do NOT run `playwright install`; launch with
`executablePath: '/opt/pw-browsers/chromium'` if the pinned
`@playwright/test` cannot find it. Write one-off scripts to the scratchpad,
not the repo (only commit tests if a phase says so).

Useful checks (the shell already ships `data-testid`s — keep them working):

- `nav-home`, `nav-save`, `nav-projects`, `nav-ailab` (the **Lab** button;
  the testid keeps its old name), `nav-gemini-<mode>` — left nav
- `effect-card-<id>` — right sidebar cards
- `nodal-add`, `nodal-add-<id>`, `nodal-input`, `nodal-output`,
  `nodal-node-<id>`, `port-*`, `nodal-svg` — node graph
- `chain-canvas`, `chain-fps`, `chain-res`, `toggle-<id>`,
  `param-<node>-<key>`, `mod-src-*`, `mod-amt-*`, `audio-*` (incl.
  `audio-clip`, the source video's own soundtrack), `signal-*` — Lab
- `source-file`, `chain-file`, `hero-video`, `hero-image` (a still photo on
  Home) — source loading
- Gemini 3.8 panel: `ai-status` (STANDBY / ACTIVE pill), `ai-key-input`,
  `ai-key-submit`, `ai-key-error`, `ai-key-forget`, `ai-pick-<mode>`,
  `ai-open-lab`; Art Director `ai-ad-intent`, `ai-ad-run`, `ai-ad-result`,
  `ai-ad-stale`, `ai-ad-proposal-<i>` (`data-in-use` on the chosen one),
  `ai-ad-apply-<i>`, `ai-ad-direction(-next/-clear)`; Agent
  `ai-agent-intent`, `ai-agent-run`, `ai-agent-note`, `ai-agent-export`,
  `ai-agent-error`, `ai-agent-direction(-clear)` (the text span),
  `ai-agent-result`, `ai-agent-stale`, `ai-agent-rows` (applied rows; an
  adjusted note is `[data-adjusted]` on its row), `ai-agent-undo`; Optimizer
  `ai-opt-run`, `ai-opt-note`, `ai-opt-export`, `ai-opt-error`,
  `ai-opt-direction(-clear)`, `ai-opt-agent-line`, `ai-opt-result`,
  `ai-opt-stale`, `ai-opt-issue-<i>`, `ai-opt-fix-rows-<i>`,
  `ai-opt-fix-<i>`, `ai-opt-fix-undo-<i>`, `ai-opt-not-applied-<i>`,
  `ai-opt-fix-all`, `ai-opt-undo`

Feed deterministic media in headless runs: launch Chromium with
`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` for
webcam/mic flows, and set file inputs directly with `setInputFiles` (generate
a short test MP4 with ffmpeg into the scratchpad if none exists).

Pixel-level assertion for engine work: read the `chain-canvas` pixels
(`preserveDrawingBuffer` is enabled) and assert non-black variance / expected
statistics rather than exact pixels.

### Gemini 3.8 suite (no real key, no network)

```bash
node tools/verify/verify-gemini.cjs                # ~3.5 min under SwiftShader; exit 0 = all PASS
PORT=3100 node tools/verify/verify-gemini.cjs      # its own server next to a dev server
```

- Self-contained: it starts `tools/verify/mock-gemini.cjs` (a local stand-in
  for generativelanguage.googleapis.com: key check, generateContent, the
  resumable Files upload; `MOCKKEY` is accepted, anything else gets Google's
  real `API_KEY_INVALID` body), then its OWN app server with
  `GEMINI_BASE_URL` pointed at the mock and no server key, generates its
  media with ffmpeg, and drives the real UI in Chromium. Its port (`PORT`,
  default 3000) must be free — it refuses to start otherwise; Playwright must
  resolve, as for the other suites.
- Eleven steps: (1) boot STANDBY + locked rail + renamed copy; (2) bad key
  rejected and not stored, a curly-quote key refused in the browser; (3) good
  key → ACTIVE, survives a reload, `ai-pick-*` work; (4) photo → Art
  Director → Use this chain → art direction, the card "In use" and the panel
  on the Agent tab (Direction line; the Art Director's "Agent →"), then the
  Optimizer on the photo with audio off (no false audio FAIL, exposure
  judged against the source, 12 fps clip, "the chain" in Sends); (5) video:
  the photo's read flagged as another source's, the video uploaded once,
  then reused; (6) Use this chain on the video → Agent with audio OFF: auto
  Clip audio + its note, cached `fileUri` + OUTPUT clip + direction sent,
  plan on the ParamBus (locked keys in `dropped`; floor raise and depth cap
  in `adjusted`, on their applied rows, never under "Not applied"), per-key
  Undo that keeps a later edit, then the Optimizer says the run was undone;
  (7) Optimizer clip + checks + plan + direction, numbered issue cards with
  their own refusals, fix rows listed before Apply (with the capped route's
  note), then the shared last-in-first-out undo: the Agent's Undo waits
  ("Undo the Optimizer's fixes first") until the fix is undone, then
  restores the whole bus to before its run; after the Lab is closed and
  reopened both results read "Earlier run — on a Lab that has closed" with
  their actions off; (8) a clip with no audio track: the no-soundtrack note,
  the picture only (2 JPEGs, no output clip), truthful Sends and context
  lines, the Optimizer's "(silent)" clip; (9) key rejected mid-session →
  relocked; (10) the HTTP contract (`/status`, 400 `no_media` — also for an
  uploaded source with no frame from the Lab —, 401 `no_key`, the Host
  guard: a `.local` name in, any other name 403 with a message naming
  `ALLOWED_HOSTS`, old endpoints 404…); (11) the key never reaches a log, a
  URL, or Google from the browser.
- It asserts what actually reached "Google" (the mock records every request
  body), not only what the panel shows.
- The mock proves the plumbing, not Gemini's judgement: what only the
  operator's real key can show is listed under Phase 11 in 05-ROADMAP.md.
- Manual runs: `node tools/verify/mock-gemini.cjs [port]`, then start the app
  with `GEMINI_BASE_URL=http://127.0.0.1:<port>` (test hook only — never in
  real use).

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
- Lab arm/disarm keeps composition state; wiring still drag-operable
  (Phase 2+).
- With no key: Gemini 3.8 panel STANDBY, rail modes locked, nothing else
  affected. After any AI change: `verify-gemini.cjs` passes (Phase 11+).
- `npm run lint` clean; no new console errors on the dashboard.
