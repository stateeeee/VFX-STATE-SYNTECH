# 01 — Design Audit (current state, 360°)

> This is the **ground truth** of how VFX Syntech looks *today*. It is written so that a
> fresh Claude/Gemini session can understand the entire visual system without re-scanning
> the repo. Everything here was read directly from the code on the `claude/loving-curie-evn1k5`
> branch. When a restyle happens, this file is the "before" — keep it; it's the diff baseline.

---

## 1. Identity & positioning

- **Name / wordmark:** `VFX Syntech`, with "Syntech" in gold. Byline: **"Created by State"**.
- **Hero tagline:** *"AI-Powered. Node-Based. Limitless."*
- **Product:** a browser-based, AI-assisted, **node-based**, audio/video-reactive VFX
  compositor. You load a source video (or webcam/mic), route it through a chain of effect
  nodes, tune parameters (manually or via Gemini), and export a master MP4.
- **Current mood keywords (as coded):** *"deep-space obsidian navy with warm gold + violet
  accents"*, "premium", "high-tech", "cinematic", "sci-fi", "elegant", "vault/constellation".
- **Emotional target:** a pro tool that feels like a luxury synth / mission-control console.

---

## 2. Tech that constrains (and enables) the design

| Concern | Reality | Design implication |
|--------|---------|--------------------|
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite`, config-less, using `@theme` + CSS vars in `src/index.css` | Re-skin = edit CSS vars + utility classes. No `tailwind.config.js` to hunt. |
| Token source | `:root { --syn-* }` in `src/index.css` | **Single source of truth.** Tailwind colors (`gold-*`, `ink-*`, `violet-400`) are aliases of these vars via `@theme`. |
| Canvas graph | `VfxCanvas.tsx` reads tokens with `getComputedStyle(document.documentElement)` every 60 frames | The animated brain graph **re-skins for free** when you change `--syn-accent` etc. Very powerful. |
| Icons | `lucide-react` | Swappable, consistent stroke icons. Stroke width & size are the main levers. |
| Motion | `motion` (Framer Motion successor) is installed but **barely used**; most animation is CSS keyframes + canvas | Big opportunity: real spring/gesture motion is available and unused. |
| Panels | `react-resizable-panels` | Draggable splits; resize handles are a styleable detail. |
| Fonts | Google Fonts `@import` in `index.css`: Space Grotesk, JetBrains Mono, Inter | Changing the type system = change this import + the 3 font vars. |
| Effects | `public/effects/*` standalone HTML/WebGL apps in **iframes** + native `SynEngine` chain | The iframes have their **own** CSS worlds (see §9). Restyling the shell does NOT restyle them. |

**Legacy cruft to be aware of:** `fix_colors.js` / `fix_colors.cjs` at repo root are one-off
migration scripts (they string-replace classes in `AiDirector.tsx`). They are not part of the
build and can be ignored/deleted; don't treat them as design sources.

---

## 3. Color system (the exact palette)

### 3.1 Night mode (default) — from `src/index.css`
| Token | Hex / value | Role |
|-------|-------------|------|
| `--syn-accent` | `#e0b451` | **Primary accent — "obsidian gold".** Exposed as `gold-500`. |
| `--syn-accent-50…950` | `#fefcf3 → #2a1f0e` | Full gold ramp (`gold-50…gold-950`). |
| `--syn-violet` | `#a882ff` | **Secondary accent — AI/Gemini.** Exposed as `violet-400`. |
| `--syn-bg` | `#0e0e0e` | App canvas / the gaps between panels (matte black). |
| `--syn-ink-950` | `#000000` | Top bar & left sidebar. |
| `--syn-ink-900` | `#000000` | Deep panels (hero, AI Director, Nodal). |
| `--syn-ink-850` | `#000000` | "Panel" (used on effect cards). |
| `--syn-ink-800` | `#1a1a1a` | Elevated / cards / node fill in SVG. |
| `--syn-ink-700` | `#2e2e2e` | Node fill / borders. |
| `--syn-line` | `rgba(224,180,81,.10)` | Hairline border. |
| `--syn-text` | `#f4f2ee` | Body text (warm off-white). |

> ⚠️ **Elevation problem:** `ink-950`, `ink-900`, `ink-850` are **all pure `#000000`.** In
> dark mode there is therefore *no* surface elevation hierarchy — panels are separated only
> by hairline borders and shadows, not by tone. Premium dark UIs usually use a subtle raised
> grey stack (e.g. `#0b0b0d → #141418 → #1c1c22`). This is the single biggest "cheap vs.
> premium" lever in the whole app.

### 3.2 Day mode — hardcoded in components (NOT tokenized)
Cream palette applied via literal Tailwind arbitrary values: app `#fcfbf9`, top bar/sidebar
`#f7f5f0`, panels `#fbfaf7` / `#faf9f5`, cards `white`, borders `neutral-200`, text
`neutral-900/600/500`, day-mode AI accent `#7b51b7` (a violet). **These literals are scattered
across every component** and are the main thing standing between you and a one-block re-skin.

### 3.3 The "signal" palette — per-node accent colors (`NodalComposition.tsx` `EFFECT_META`)
| Node | Hex | Hue |
|------|-----|-----|
| `blob_tracker` | `#e0913f` | amber-orange |
| `blob_reveal` | `#c65b9c` | magenta-pink |
| `anamorphic_lab` | `#5bb0c4` | cyan |
| `analog` | `#6ea8e0` | steel blue |
| `bokeh` | `#9b6fd0` | violet |
| INPUT node | `#57bf8a` | emerald-green |
| OUTPUT node | `#e0b451` | gold |

> ⚠️ **Third palette problem:** these six hues are a *third* color language that does **not**
> derive from the gold/violet system or from tokens — they're hardcoded in `EFFECT_META`.
> They look like a generic node-editor rainbow. A premium pass should either (a) harmonize
> them into the brand (tinted metals / jewel tones tuned to the accent) or (b) formalize them
> as an intentional, named "signal spectrum" with consistent saturation/luminance.

### 3.4 Semantic colors
- Live/active: `emerald-400/500` (the pulsing "live streaming" dot, "Active" chips).
- Warning/error: `red-400/950`, mic-denied banner.
- Audio-reactive: `amber-400` (meters, modulation chips in the AI Lab).

---

## 4. Typography

| Slot | Family | Var / class | Usage |
|------|--------|-------------|-------|
| Display | **Space Grotesk** | `--syn-font-display`, `font-display` | Wordmark, hero H1 (`text-5xl/6xl`, `tracking-tighter`). |
| UI / sans | **Inter** | `--syn-font-sans`, `font-sans` | Body copy, buttons, general UI. |
| Mono | **JetBrains Mono** | `--syn-font-mono`, `font-mono` | **Everything technical:** labels, HUD, metrics, node text, chips, timers. |

**Signature type traits (this is the app's fingerprint):**
- Micro-labels: `text-[7px]…[11px]`, `uppercase`, `tracking-[0.1em]…[0.3em]`, `font-mono`.
  These wide-tracked tiny caps are *everywhere* and define the "instrument panel" feel.
- Headlines: very large Space Grotesk, negative tracking, tight leading (`leading-[0.92]`).
- Numeric readouts: mono, often bold, sometimes gold.

> ⚠️ **Legibility risk:** a lot of real information sits at 7–8px. It reads as "premium
> telemetry" but is near the edge of legibility. A redesign should define a proper **type
> scale** (e.g. 4–5 steps) instead of ad-hoc pixel values, and lift the smallest labels to
> ~9–10px with tracking doing the "technical" work.

---

## 5. Layout map (the frame)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ APP SHELL  (h-screen, p-4, gap-4, flex-col)   night: #0e0e0e / day: #fcfbf9 │
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ TOP BAR  h-12  rounded-2xl                                             │ │
│ │  [● live streaming | ☾/☀ toggle]    VFX Syntech / Created by State     │ │
│ │                                       [SESSION t | ◷ clock | 14:22]     │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ ┌────┐ ┌──────────────────────────────────────────┐ ┌────────────────────┐ │
│ │NAV │ │ HERO  (62%)                               │ │ EFFECTS LIBRARY 26%│ │
│ │78px│ │  brain graph  OR  AI Lab  OR  effect      │ │  [🔍 Search…]      │ │
│ │ ◇VS│ │  overlay: "VFX / SYNTECH" + tagline       │ │  ┌──────────────┐  │ │
│ │Home│ │                                           │ │  │ BLOB TRACKER │  │ │
│ │Save│ ├──────────────────────────────────────────┤ │  ├──────────────┤  │ │
│ │Proj│ │ NODAL COMP (55%)     │ GEMINI PRO (45%)   │ │  │ ANALOG       │  │ │
│ │ AI │ │ "AI Lab Nodes"       │ Home/ArtDir/Agent/ │ │  │ BLOB REVEAL  │  │ │
│ │────│ │ input→fx→output SVG  │ Optimizer tabs     │ │  │ BOKEH        │  │ │
│ │GEM │ │                      │ (violet accent)    │ │  │ ANAMORPH LAB │  │ │
│ │Art │ │  (38% bottom row)    │                    │ │  └──────────────┘  │ │
│ │Agnt│ └──────────────────────────────────────────┘ └────────────────────┘ │
│ │Optm│                                                                       │
│ └────┘                                                                       │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Shell:** full-screen, `p-4 gap-4`, `overflow-hidden`. Panels are `rounded-2xl` with
  `border` + `shadow-md/lg`. The whole thing is a "floating cards on matte black" layout.
- **Top bar** (`App.tsx` header): `h-12`, three zones. Left cluster width-locked `w-56`
  (live dot + day/night). **Center wordmark is `absolute left-1/2`** (can overlap the side
  clusters on narrow widths — a real bug at ~<900px). Right cluster `w-56` (session timer +
  animated analog clock SVG + digital time).
- **Left sidebar** (`nav`): `w-[78px]`, `rounded-2xl`. Diamond **"VS"** mark (gold, rotated
  45°, glow). Primary nav: **Home / Save / Projects / AI Lab** (icon + 8.5px caption).
  Divider. **"GEMINI PRO"** section: **Art Dir / Agent / Optimizer**. Active item = gold.
- **Main** = horizontal `PanelGroup`:
  - **Left+center (74%)** = vertical `PanelGroup`:
    - **Hero (62%)**: shows the brain graph (`VfxCanvas`) by default, OR the AI Lab
      (`ChainLab`), OR an effect (`EffectHost`). On home, an overlay renders the big
      **"VFX / SYNTECH"** wordmark (animated gradient) + tagline + a `from-black/70` scrim.
    - **Bottom (38%)** = horizontal `PanelGroup`: **NodalComposition (55%)** +
      **AiDirector (45%)**.
  - **Right sidebar (26%, min 16 / max 40)**: **"Effects Library"** — a search box
    (`Search systems…`, non-functional placeholder) + 5 effect cards.
- **Resize handles:** thin bars that turn **gold** on hover.
- **Radii in play:** `rounded-md / lg / xl / 2xl` used ad hoc — no documented radius scale.
- **Spacing:** `gap-4` at shell level; panel padding varies (`p-3` / `p-3.5` / `p-4` / `p-5`).

---

## 6. Component-by-component aesthetic notes

### 6.1 Top bar (`App.tsx`)
Minimal, elegant. Emerald pulse dot + `live streaming` micro-caps. Center wordmark uses
`font-display` 15px with gold "Syntech" + 7.5px byline. Right side has a hand-drawn **analog
clock** (SVG, live hands) next to a digital clock — a charming detail. **Weak spots:** the
absolute-centered wordmark; the left/right clusters are visually unbalanced; no global actions
(no export/share/account) live here yet.

### 6.2 Left sidebar (`App.tsx`)
Diamond VS logo is the strongest brand moment. Nav is clean icon-over-caption. **Weak spots:**
78px is narrow for the caption text; active state is only color (no pill/indicator bar); the
"GEMINI PRO" subsection competes visually with primary nav (two icon stacks of similar weight).

### 6.3 Hero brain graph (`VfxCanvas.tsx`)
The showpiece: a canvas-2D **force-directed constellation** — 1 core ("VFX SYNTECH"), 5 module
hubs, 14–20 satellites each, rogue floating stars, a faint grid, a **heartbeat** core pulse
(160-frame cycle) that fires signal pulses down the filaments, audio-reactive node sizes,
mouse repel/link-drag, gold + **purple** + amber sparkles, HUD pill labels. It's genuinely
beautiful and fully token-driven. **Weak spots:** on pure `#000` it can feel flat (no depth
haze/vignette); label pills are plain; the "STANDBY" state text is dev-y.

### 6.4 Nodal Composition (`NodalComposition.tsx`)
An SVG node editor: INPUT → effect nodes → OUTPUT (Main Comp), bezier connectors with an
animated **dashed flow**, per-node accent colors, detach/reattach **ports**, an "Add Node"
menu, remove ✕, a mini waveform on INPUT. Header: `AI Lab Nodes` in gold micro-caps. **Weak
spots:** the six node hues clash with the gold/violet brand (§3.3); node cards are functional
but flat; empty state is nice.

### 6.5 Gemini Pro panel (`AiDirector.tsx`)
Right-bottom panel, **violet** accent (`violet-400` night / `#7b51b7` day). Four states: Home
(capabilities/examples), Art Director (chat + scene analysis + suggestions + "Apply All"),
Agent (autonomous graph edits chat), Optimizer (video analysis). Chat bubbles, markdown,
loading shimmer text ("Accessing vault index…"). **Weak spots:** dense; the violet vs. gold
split is not visually reconciled with the rest; lots of 10px mono.

### 6.6 AI Lab / SynEngine (`ChainLab.tsx`)
Full-screen takeover: `AI LAB // SYNENGINE` toolbar (Back, FPS, RES%, **Master MP4** export),
a black **stage canvas**, and a right **control rail** (Source: Video/Webcam/Mic/Track;
audio meters bass/loud/treble + beat + BPM; motion/bright signals; **AI Optimizer** prompt;
**Presets** save/load; **Signal chain** node cards with per-param sliders + audio-modulation
`~` routing chips). Gold accent throughout. This is the deepest, most "pro-tool" screen.
**Weak spots:** very information-dense; sliders/chips are default-ish; could use grouping and
a clearer visual rhythm.

### 6.7 Effects Library (right sidebar, in `App.tsx`)
**Lowest-fidelity area.** Each of the 5 effects is an 80px card showing only its **name**
centered — no thumbnail, preview, description, status, or drag affordance. The search box is a
static placeholder. This is the biggest "unfinished" tell in the shell and a prime target for
a premium treatment (live mini-preview, hover scrub, category tags, drag-to-graph).

### 6.8 Effect host (`EffectHost.tsx`)
A thin iframe wrapper: `← BACK TO GRAPH`, centered effect name, the embedded effect. Minimal.

### 6.9 Projects modal (`App.tsx`)
Backdrop-blur modal listing saved chains, gold-accented, `[CLOSE]` in mono. Clean, consistent.

---

## 7. Motion & texture inventory

- **Hero wordmark:** animated gradient shimmer gold→amber→violet (`hero-gradient`, 6s linear).
- **Glows:** `pulse-glow`, `gold-glow-text`, `gold-glow-border` (accent-tinted text/box shadows).
- **Constellation:** physics, heartbeat, traveling pulses, audio vibration (canvas).
- **Nodal flow:** dashed `node-flow` stroke animation on connectors.
- **EQ bars:** `eq-bar` bounce (declared; used for waveform/GPU meter accents).
- **Live dots:** emerald `animate-pulse`.
- **Loading:** `RefreshCw animate-spin`, cycling phrase text.
- **Transitions:** `transition-colors duration-300` for theme switches.

> ⚠️ **`space-vignette` is a promise not kept:** it's defined as *just* `background: var(--syn-bg)`
> — flat. The "deep-space" feel would come alive with an actual radial vignette / nebula / grain.
> `motion` (Framer) is installed but essentially unused — real entrance/hover/gesture animation
> is available and would instantly read as "premium".

---

## 8. Iconography
`lucide-react`, stroke ~1.5–2, sizes 3–4 (12–18px). Consistent and clean. Key icons: Layers,
Play, RefreshCw, Sun/Moon, Search, Cpu, Home, Save, Folder, Sparkle (AI), Bot, Lightbulb,
Settings, Plus, X, ArrowLeft/Up/Down, Camera, Film, Mic, Music, Diamond, Link2, Power.

---

## 9. The iframe effects are a separate design world (important)
`public/effects/blob_tracker/index.html` (and siblings) are self-contained apps with their
**own** CSS: **iridescent** animated borders/glows that cycle gold→blue→violet→pink, a
**Barlow Condensed + JetBrains Mono** type pairing, and glossy "gel/glass" panels
(`gel-breathe`, `fluid-shimmer`, smoke blobs). This is a **richer, more RGB-iridescent**
aesthetic than the shell's restrained obsidian-gold. When you restyle, decide deliberately:
**unify** the iframes to the shell language, or keep them as intentionally "hotter" immersive
effect worlds. Right now the mismatch is accidental, not designed.

---

## 10. Honest weaknesses = your premium opportunity list
1. **No dark-mode elevation** (all panels pure black) → add a raised-grey surface stack.
2. **Three uncoordinated palettes** (shell gold/violet, node rainbow, iframe iridescent) →
   unify or formalize.
3. **Day-mode colors hardcoded everywhere** (`#fcfbf9`, `#7b51b7`, …) → tokenize so a re-skin
   is one block.
4. **`space-vignette` flat** → deliver the deep-space depth (radial light, grain, nebula).
5. **Effects Library cards are bare** → the clearest "premium" win (previews, tags, drag).
6. **No documented type/space/radius scale** → define one; lift 7–8px labels to ~9–10px.
7. **Framer Motion unused** → add tasteful entrance/hover/gesture motion.
8. **Active-state affordances are color-only** → add indicator bars/pills.
9. **Top-bar center wordmark can collide** on narrow widths → make it flow, not absolute.
10. **Glow/shadow language inconsistent** → define one elevation+glow system and apply it.

These ten are the raw material for `02-DESIGN-BRIEF.md`, `03-AESTHETIC-DIRECTIONS.md`, and the
Gemini analysis — a restyle that resolves them will read as a genuine tier jump, not a recolor.
