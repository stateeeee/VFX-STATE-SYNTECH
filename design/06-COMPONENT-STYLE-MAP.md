# 06 — Component Style Map (where every visual element lives)

> A surgical map: for each visual surface, the file, the key lines/anchors, the classes/tokens
> in play, and the stray literals to tokenize. With this I can restyle precisely without
> re-reading the whole repo — which is the point (saves tokens, avoids drift).

Repo is React + Tailwind v4. **Token source of truth:** `src/index.css` `:root { --syn-* }`
(aliased to Tailwind `gold-*`, `ink-*`, `violet-400` via `@theme`). The canvas graph reads the
same tokens through `getComputedStyle` — so recoloring tokens recolors the graph for free.

---

## Global

| Thing | File | Notes |
|------|------|------|
| **Design tokens** (colors, fonts, ramps) | `src/index.css` `:root` | The block to rewrite first. |
| **Tailwind theme aliases** | `src/index.css` `@theme` | Maps `--syn-*` → `gold-*`, `ink-*`, `violet-400`, fonts. Extend here for new tokens. |
| **Global animations** | `src/index.css` | `pulse-glow`, `gold-glow-text/-border`, `hero-gradient`, `gradient-shimmer`, `space-vignette` (flat — fix), `eq-bar`, `node-flow`, scrollbars. |
| **Fonts** | `src/index.css` top `@import` | Space Grotesk / JetBrains Mono / Inter from Google Fonts. |
| **Body base** | `src/index.css` `body` | `--syn-bg`, `--syn-text`, `--font-sans`. |
| **App shell wrapper** | `src/App.tsx` (root `div`) | `h-screen w-screen p-4 gap-4`; night `space-vignette`, day `bg-[#fcfbf9]` ← **stray literal**. |

---

## Top bar — `src/App.tsx` (`<header>`)
- Container: `h-12 rounded-2xl border ... shadow-md`; night `border-ink-700/60 bg-ink-950`,
  day `border-neutral-200 bg-[#f7f5f0]` ← **stray literals**.
- Left cluster (`w-56`): live dot `bg-emerald-400 animate-pulse` + `live streaming` micro-caps;
  day/night toggle button (`Sun`/`Moon`).
- **Center wordmark:** `absolute left-1/2 -translate-x-1/2` → **the overlap bug; convert to a
  3-column flex/grid.** `VFX Syntech` (`font-display` 15px, gold "Syntech") + "Created by State"
  (7.5px mono caps).
- Right cluster (`w-56`): `SESSION {timer}`, inline **analog clock SVG** (live hands), digital time.
- Tokenize: the two literal bg/borders; the `text-neutral-500` micro-caps.

---

## Left sidebar — `src/App.tsx` (`<nav>`)
- Container: `w-[78px] rounded-2xl border ...`; night `bg-ink-950`, day `bg-[#f7f5f0]` ← **stray**.
- **VS diamond logo:** `w-11 h-11 border-2 border-gold-500 rotate-45 ... bg-gold-500/5 shadow-[0_0_16px_rgba(224,180,81,0.2)]` with `-rotate-45` "VS" text.
- Primary nav array `navItems` (Home/Save/Projects/AI Lab): each `button` with icon in a
  `p-2 rounded-xl` chip; active = `text-gold-500` + `bg-gold-500/12` glow. **Active state is
  color-only → add an indicator bar/pill.**
- Divider: `w-8 h-px bg-ink-700`.
- "GEMINI PRO" label (`text-[7px]`) + Gemini nav (Art Dir/Agent/Optimizer), same pattern.
- Icons: `lucide-react` (HomeIcon, SaveIcon, FolderIcon, AiIcon=Sparkle, Lightbulb, Bot, Settings).

---

## Hero constellation graph — `src/components/VfxCanvas.tsx`
- Canvas-2D, fully token-driven via `readTokens()` (`--syn-accent`, `-700`, `-900`, `-950`,
  `--syn-ink-900`). Recolor tokens → graph recolors.
- Structural knobs (if you want to art-direct the graph): `hubsConfig` (5 hubs, angles/dist),
  satellite count `14 + rand(6)`, satellite color logic (`purple #b98ff0/#a882ff`, gold, dim),
  rogue stars (`numRogue = 15`), grid (`gridSize = 40`), heartbeat cycle (`160` frames),
  pulse speeds, HUD label pills (`roundRect`, fonts `var(--font-mono)`).
- Wrapper div: `border border-gold-800/40 bg-ink-900 rounded-md gold-glow-border`.
- Depth/vignette to *add* here for "deep space" (audit §7, directions D6).
- Chain HUD (bottom): `graph-chain-hud` — `CHAIN … Open Ai Lab / Clear`.
- Day-mode canvas colors are inline literals (e.g. `#fbfaf7`, `rgba(180,140,45,…)`) → these are
  in JS, adjust in-code per direction.

---

## Hero overlay wordmark — `src/App.tsx` (inside Hero panel, `isHome` branch)
- `absolute top-7 left-8`: `VFX` (white) + `SYNTECH` (`hero-gradient` animated) `font-display
  text-5xl/6xl tracking-tighter`; tagline "AI-Powered. Node-Based. Limitless." (`text-[11px]/[13px]`).
- Legibility scrim: `bg-gradient-to-br from-black/70 via-black/25 to-transparent`.
- `hero-gradient` colors live in `src/index.css` → restyle to new palette there.

---

## Nodal Composition — `src/components/NodalComposition.tsx`
- **`EFFECT_META`** (top of file): the 6 node hex colors + INPUT/OUTPUT colors ← **the "third
  palette"; the direction decides harmonize / mono / owned.**
- Panel: `rounded-2xl border`; header `AI Lab Nodes` (`text-gold-500` micro-caps) + "Add Node".
- SVG: grid `pattern#nodal-grid`; bezier connectors + animated `node-flow`; INPUT node (green,
  mini waveform), OUTPUT node (gold), effect nodes (rect + accent bar + ACTIVE/BYPASS), detach
  **Ports**, remove ✕. Node fill night `var(--syn-ink-800)` / day `#ffffff`.
- Add-node menu: `bg-ink-850 / bg-white` popover.

---

## Gemini Pro panel — `src/components/AiDirector.tsx`
- **Accent = violet:** `violet-400` (night) / `#7b51b7` (day) ← **stray literals everywhere in
  this file; tokenize to `--syn-violet` + a day var.**
- Header: icon (Lightbulb/Bot/Settings/Sparkles) + title (Art Director/Agent/Optimizer/Gemini
  Pro) + Active/Standby chip (`emerald`).
- Tabs/states: `AiHomeTab`, `ArtDirectorTab` (Scene Analysis + Suggestions + "Apply All
  Suggestions" + input), `AgentTab` (chat), `OptimizerTab` (Video Context Analyzer).
- Chat bubbles: model vs user variants; markdown via `react-markdown` (`.markdown-body`).
- Inputs/buttons: violet focus rings, `Send` button.

---

## AI Lab / SynEngine — `src/components/ChainLab.tsx`
- **Accent = gold** throughout.
- Toolbar: `Back to console`, `AI LAB // SYNENGINE`, `FPS`, `RES%`, **Master MP4** (`bg-gold-500
  text-black`), export msg.
- Stage: `bg-black` canvas `border-gold-500/20`; `NO SIGNAL` empty state.
- Control rail (`w-72`): **Source** (Video/Webcam/Mic/Track), audio meters (bass/loud/treble +
  beat + BPM, `amber-400`), motion/bright signals (`gold-500`), **AI Optimizer** prompt+Go,
  **Presets** (name+Save, load/delete rows), **Signal chain** node cards (`nodeCard`): per-node
  up/down/power, per-param sliders (`accent-[var(--syn-accent)]`), audio-mod `~` chips (`amber`).
- Day/night literals: `#f7f5f0`, `#faf9f5`, `#0c0c0c`, `#080808` ← tokenize.

---

## Effects Library (right sidebar) — `src/App.tsx` (right `Panel`)
- Container: `rounded-2xl border`; night `bg-ink-900`, day `bg-[#fbfaf7]` ← **stray**.
- Search box: static placeholder `Search systems…` (`Search` icon) — **style to look real;
  wiring is later (Phase 5).**
- Effect cards: `modules.map` → `h-20 p-2.5 rounded-lg border` showing **only `module.name`
  centered.** ← **lowest-fidelity area; biggest premium win** (add status/category/hover/preview/
  drag affordance). Active card = gold-tinted border/bg.

---

## Effect host + Projects modal
- `src/components/EffectHost.tsx`: iframe wrapper — `← BACK TO GRAPH`, centered name, `<iframe>`.
- `src/App.tsx` Projects modal (`projects-modal`): `backdrop-blur`, gold-accented card, `[CLOSE]`,
  saved-chain rows.

---

## Iframe effects (separate world — do NOT touch unless asked)
- `public/effects/blob_tracker/index.html` (+ siblings): own CSS — **iridescent** gold→blue→
  violet→pink borders/glows, **Barlow Condensed + JetBrains Mono**, gel/glass panels
  (`gel-breathe`, `fluid-shimmer`, smoke blobs). Audit §9. A conscious choice: unify to shell,
  or keep as "hotter" immersive worlds. Default: leave alone.

---

## Stray-literal hit list (tokenize these for a clean re-skin)
Search targets when I do the tokenizing sweep:
- `#fcfbf9`, `#f7f5f0`, `#fbfaf7`, `#faf9f5`, `#f5f4f0` — day surfaces (App, Nodal, ChainLab, AiDirector).
- `#7b51b7` — day-mode AI violet (AiDirector, everywhere).
- `#0c0c0c`, `#080808` — ChainLab dark surfaces.
- `EFFECT_META` hexes + `INPUT_COLOR`/`OUTPUT_COLOR` (NodalComposition) — the node palette.
- Inline `rgba(180,140,45,…)` / `#fbfaf7` day colors inside `VfxCanvas.tsx` (JS, per-direction).
- Ad-hoc `text-neutral-400/500/600` → replace with `--syn-text-muted/-faint` tokens.

Removing these in Phase 1–3 is what turns a future re-skin into a **one-block** swap.
