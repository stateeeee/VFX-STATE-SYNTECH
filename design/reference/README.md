# Reference — real screenshots (the "before" baseline)

Real, rendered screenshots — the best possible reference material (a real screenshot beats an
AI-generated image every time; see `../04-REFERENCE-IMAGE-GUIDE.md`).

## Current app — the "before" (captured from `npm run dev`)
The actual UI today, so we have a truthful baseline to diff the restyle against, and so Gemini
(the analysis kit) has real pixels to critique.
- `01-home-night.png` — home: constellation graph + hero wordmark + node editor + Gemini panel + effects library
- `02-gemini-artdirector-night.png` — Gemini panel, Art Director tab
- `03-gemini-agent-night.png` — Gemini panel, Agent tab
- `04-ailab-night.png` — AI Lab / SynEngine full screen
- `05-projects-modal-night.png` — Projects modal
- `06-home-day.png` — home in **day** mode (the cream theme)
- `07-ailab-day.png` — AI Lab in day mode

## `after/` — the D1 restyle applied to the REAL app (first pass)
Screenshots of the actual app after the first token-first restyle to **D1 Obsidian Refined**
(elevation ladder, harmonized warm-metal nodes, top-bar overlap fixed, sidebar active indicator,
real `space-vignette`). Compare against `01-home-night.png` (before) to see the tier jump.
- `after/01-home-night.png` · `after/02-ailab-night.png` · `after/03-home-day.png`

## Skin Studio — the "after" options (rendered from `../skin-studio.html`)
The live preview, captured in several directions so you can compare without opening it:
- `skin-d1-obsidian-night.png` — D1 Obsidian Refined (the safe premium evolve)
- `skin-d4-mission-night.png` — D4 Mission Control (amber+cyan pro HUD)
- `skin-d6-deepspace-night.png` — D6 Deep Space Luxe (nebula glass)
- `skin-d3-liquidobsidian-night.png` — D3 Liquid Obsidian (Apple-glass)
- `skin-d1-obsidian-day.png` — D1 in day mode

> For the full interactive experience (all 6 × night/day + live tokens), open
> `../skin-studio.html` in a browser — it runs offline.

## Re-capturing (optional)
The two `capture-*.mjs` scripts regenerate these. They use the environment's preinstalled
Chromium via `playwright-core`. To run:
```bash
npm install -D playwright-core         # not a project dependency by default
NODE_ENV=development DISABLE_HMR=true npm run dev   # in one terminal
node design/reference/capture-current-app.mjs      # in another (needs the dev server up)
node design/reference/capture-skin-studio.mjs       # screenshots the offline skin-studio.html
```
`capture-current-app.mjs` drives the running app (clicks nav, toggles theme via localStorage);
`capture-skin-studio.mjs` opens the standalone preview and cycles directions. Paths inside the
scripts are absolute to this repo location — adjust if the repo moves.
