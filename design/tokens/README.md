# Ready-to-paste token palettes

`PALETTES.css` contains **six complete `:root { --syn-* }` blocks** — one per aesthetic
direction (D1–D6 from `../03-AESTHETIC-DIRECTIONS.md`). Each is a **drop-in replacement** for
the token block currently in `src/index.css`.

## How to apply one (2 minutes)
1. Pick a direction (D1 = safest evolve, D3/D6 = flagship, D4 = pro-HUD).
2. Copy that block from `PALETTES.css`.
3. Paste it over the existing `:root { --syn-* }` block in `src/index.css` (keep the
   `@theme { … }` block below it, and keep the `--syn-font-*` lines unless the direction's
   comment says to change fonts).
4. Add the **new tokens** to `@theme` so they become Tailwind utilities (they extend, they
   don't replace):
   ```css
   @theme {
     /* …existing gold-*, ink-*, violet-400, fonts… */
     --color-ink-950: var(--syn-ink-950);   /* already mapped */
     /* new: expose text tiers + node colors if you want them as classes */
     --color-node-tracker:    var(--syn-node-tracker);
     --color-node-reveal:     var(--syn-node-reveal);
     --color-node-anamorphic: var(--syn-node-anamorphic);
     --color-node-analog:     var(--syn-node-analog);
     --color-node-bokeh:      var(--syn-node-bokeh);
     --color-node-input:      var(--syn-node-input);
     --color-node-output:     var(--syn-node-output);
   }
   ```
5. Point `EFFECT_META` (in `src/components/NodalComposition.tsx`) at the tokens instead of the
   hardcoded hex, so the node colors follow the palette:
   ```ts
   const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
   // e.g. color: cssVar('--syn-node-tracker')
   ```
   (or just replace the literal hex with the direction's values from `PALETTES.css`).
6. Run `npm run dev` — the DOM **and** the canvas constellation re-skin together.

## What each block fixes vs. today (audit §10)
- **Elevation ladder:** `--syn-ink-950/900/850/800/700` are now distinct tones, not all
  `#000000` → real depth in dark mode.
- **Text tiers:** `--syn-text-muted` / `--syn-text-faint` → stop scattering `neutral-400/500`.
- **Tokenized node colors:** `--syn-node-*` → the "rainbow" is now controllable in one place.
- **Surface language:** `--syn-glass / --syn-hairline / --syn-glow / --syn-radius` → one
  consistent panel/glow/radius system.

## Still hardcoded (do these during the restyle, not here)
- **Day-mode** colors live as literals across components (`#fcfbf9`, `#7b51b7`, …). Introduce a
  day scope (`:root[data-theme="day"] { --syn-* }` or the existing `isDayMode` branch pointed at
  vars) — `PALETTES.css` covers the **night** palette; I'll generate the matching day palette
  per direction when we implement (it's a mechanical mirror: lift surfaces to creams, drop text
  to near-black, keep the same accent).

## Glass directions (D3, D6) need a backdrop
D3 and D6 use translucent panels. Translucency only reads as "glass" if there's something
behind it to blur — so pair them with the nebula/vignette backdrop from
`../gemini/04-ANALYSIS-motion-and-texture.md`. On a flat black bg, glass just looks grey.

## These are starting points, not final
Colors here are hand-tuned but not perfected. Expect one refinement pass on the real app
(and/or via Gemini's `01-ANALYSIS-color-and-typography.md` recommendations). The ramps
(50→950) are believable but a color tool can smooth them if you want pixel-perfect steps.
