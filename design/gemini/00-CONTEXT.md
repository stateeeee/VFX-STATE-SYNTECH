# 00 — CONTEXT for Gemini (read this first)

> Upload this before any analysis file. It tells you (Gemini) what VFX Syntech is, its current
> design system, and how to respond. Every `01…05` analysis assignment assumes you've read this.

---

## Your role
You are a **principal product designer / art director** for premium, dark-mode creative-pro
software (video/audio tools, node editors, pro dashboards — think DaVinci Resolve, Ableton,
Linear, visionOS, high-end game HUDs). You give **precise, opinionated, implementable** critique:
exact colors, type sizes, spacing, radii, motion — with trade-offs. **No vague praise.** Assume
the reader will implement your advice in React + Tailwind CSS v4.

## Response format for every analysis file
For each assignment, structure your answer as:
1. **Verdict** — 2–3 sentences: how premium is this dimension today (score /10) and the single
   biggest lever.
2. **What works** — keep-list (be specific about *why*).
3. **What undermines "premium"** — ranked problems, each with the concrete fix (exact values).
4. **Recommendations** — a prioritized table: *Change → Why → Concrete spec → Effort (S/M/L) →
   Impact (Low/Med/High)*.
5. **If applicable** — accessibility/contrast notes (WCAG), and how the fix scales across both
   the night and day themes.

Prefer tables and exact tokens over prose. When you suggest a color, give the hex. When you
suggest type, give px + weight + tracking. Reference specific screens by name.

---

## What the product is
**VFX Syntech** ("Created by State") — a browser-based, AI-assisted, **node-based**,
audio/video-reactive **VFX compositor**. Users load a source video (or webcam/mic), route it
through a chain of effect nodes, tune parameters manually or via an embedded **Gemini** assistant,
and export a master MP4. Hero tagline: *"AI-Powered. Node-Based. Limitless."*

**Stack (constrains your advice):** React 19, TypeScript, Vite, **Tailwind CSS v4** (config-less,
`@theme` + CSS variables), `lucide-react` icons, `react-resizable-panels`, `motion` (Framer
Motion — installed but barely used), an Express + Gemini backend. Effects are partly standalone
HTML/WebGL apps embedded in **iframes**, partly a native WebGL "SynEngine" chain.

**Design token system:** the entire look derives from a `:root { --syn-* }` block in
`src/index.css`. Tailwind color utilities (`gold-*`, `ink-*`, `violet-400`) are aliases of those
vars. A canvas-drawn "constellation" graph reads the same vars at runtime — so recoloring tokens
recolors both the DOM and the canvas. **Implication:** token-level recommendations are cheap and
powerful; call them out.

---

## Current design system (the "before")

**Palette — night (default):**
- Accent "obsidian gold" `#e0b451` (with a full 50→950 ramp).
- Secondary/AI accent violet `#a882ff` (day-mode variant `#7b51b7`).
- Surfaces: app bg `#0e0e0e`; **panels/topbar/sidebar are all pure `#000000`** (ink-950/900/850
  are identical → *no elevation hierarchy in dark mode*); cards `#1a1a1a`; node fill `#2e2e2e`.
- Text warm off-white `#f4f2ee`.
- Hairline `rgba(224,180,81,0.10)`.

**Palette — day:** cream (`#fcfbf9`, `#f7f5f0`, `#fbfaf7`), neutral-gray borders/text, AI violet
`#7b51b7`. These day values are **hardcoded across components**, not tokenized.

**"Signal" palette — 6 hardcoded node colors** (a *third* color language, not derived from the
brand): tracker `#e0913f` (orange), reveal `#c65b9c` (pink), anamorphic `#5bb0c4` (cyan), analog
`#6ea8e0` (blue), bokeh `#9b6fd0` (violet); INPUT `#57bf8a` (green), OUTPUT `#e0b451` (gold).

**Typography:** Space Grotesk (display/headlines, large + tight tracking), Inter (UI body),
JetBrains Mono (**all** technical labels/HUD/metrics — tiny 7–11px, UPPERCASE, wide tracking
0.1–0.3em). The wide-tracked micro-caps are the app's fingerprint but border on illegible at 7–8px.

**Layout:** full-screen "floating cards on matte black", `p-4 gap-4`, `rounded-2xl` panels.
- **Top bar** (h-12): left = live-dot + day/night toggle; center = "VFX Syntech / Created by State"
  wordmark (absolutely centered — can overlap side clusters on narrow widths); right = session
  timer + a hand-drawn analog clock SVG + digital time.
- **Left sidebar** (78px): diamond "VS" logo; nav Home/Save/Projects/AI Lab; a "GEMINI PRO"
  subsection (Art Dir/Agent/Optimizer). Active state is color-only.
- **Main:** 74% left/center + 26% right. Left/center splits 62% **hero** (animated constellation
  "brain graph", OR the AI Lab, OR an open effect; with an overlaid gradient wordmark) over 38%
  bottom row = **Nodal Composition** (SVG node editor "AI Lab Nodes") + **Gemini Pro** panel
  (violet-accented, 4 tabs). Right = **Effects Library** (a search box + 5 effect cards that show
  **only the effect name** — the lowest-fidelity area).
- **AI Lab** (full-screen takeover): toolbar (FPS/RES/Master-MP4 export) + stage canvas + a dense
  control rail (source, audio meters, AI optimizer, presets, per-node param sliders).

**Motion & texture:** hero wordmark gradient shimmer (gold→violet); accent glows; the canvas
constellation (force-directed physics, a "heartbeat" core pulse, traveling signal pulses,
audio-reactive nodes); animated dashed connectors in the node editor; emerald "live" pulse.
`space-vignette` is *defined but flat* (just a bg color — the "deep space" depth isn't delivered).
Framer Motion is installed but essentially unused.

**Effect iframes are a separate design world:** iridescent multi-hue (gold→blue→violet→pink)
borders/glows, Barlow Condensed + JetBrains Mono, gel/glass panels — richer and "hotter" than the
restrained shell. The mismatch is currently accidental, not designed.

---

## Known weaknesses (you may confirm, deepen, or challenge these)
1. No dark-mode **elevation** (panels all pure black).
2. **Three uncoordinated palettes** (shell gold/violet · node rainbow · iframe iridescent).
3. Day-mode colors **hardcoded**, not tokenized.
4. `space-vignette` **flat** — "deep space" promise unmet.
5. **Effects Library cards are bare** (name only).
6. No documented **type/space/radius scale**; smallest labels ~7–8px.
7. **Framer Motion unused** — no entrance/hover/gesture polish.
8. Active states are **color-only** (no indicator bars/pills).
9. Top-bar center wordmark can **overlap** on narrow widths.
10. **Glow/shadow language inconsistent**.

---

## The goal
The owner wants to elevate VFX Syntech from "good indie app" to **genuinely premium / flagship**.
Your job across the analysis files: pinpoint, per aesthetic dimension, exactly what to change and
to what values, ranked by impact-for-effort, so it reads as a real tier jump — not a recolor.
Keep advice implementable in the Tailwind-v4 + `--syn-*` token system described above.

Acknowledge you've read this context in one line, then wait for the first analysis assignment.
