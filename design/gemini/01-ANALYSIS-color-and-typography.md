# 01 — ANALYSIS: Color & Typography

> Assignment for Gemini. You have read `00-CONTEXT.md`. Analyze **color and typography only**
> (layout, components, motion, brand are covered separately). Use the response format from the
> context file (Verdict → Works → Undermines → Recommendations table → a11y). Be exact.

## Scope
Everything about hue, tone, contrast, and type in VFX Syntech:
- The **night palette**: obsidian gold `#e0b451`, violet `#a882ff`, and the pure-black surface
  stack (`#0e0e0e` bg; ink-950/900/850 all `#000000`; card `#1a1a1a`; node fill `#2e2e2e`).
- The **day palette** (cream, hardcoded, AI violet `#7b51b7`).
- The **6 node "signal" colors** (orange/pink/cyan/blue/violet + green in / gold out).
- **Type system**: Space Grotesk (display), Inter (UI), JetBrains Mono (tiny uppercase labels,
  7–11px, tracking 0.1–0.3em).

## Questions to answer (be specific, give values)
1. **Elevation:** propose an exact dark surface **ladder** to replace all-`#000000`
   (base → raised → card → node), with hex and the reasoning (perceived depth, OLED vs. LCD,
   glow legibility). How many steps, what luminance deltas?
2. **Accent discipline:** is a two-accent system (brand gold + AI violet) helping or muddying?
   Recommend: keep both / fold to one / mono+single-accent. Give the exact accent + hover +
   deep-shadow variants, and a rule for *when* each accent may appear.
3. **The node rainbow:** the 6 node colors are a third, unbranded palette. Give a concrete
   remedy — harmonized metals, jewel tones on the brand axis, mono+glow, or a *deliberately*
   normalized "signal legend" (same S/L band). Provide the 6 replacement hex under your choice.
4. **Contrast & a11y:** audit the tiny mono labels (currently `text-neutral-400/500` on near-black
   and on cream). Which combinations fail WCAG AA for their size? Give passing token values for
   `--syn-text`, `--syn-text-muted`, `--syn-text-faint` in **both** themes.
5. **Type scale:** replace the ad-hoc px values with a real scale. Propose 4–5 steps
   (display / title / body / label / micro) with px, weight, line-height, letter-spacing, and
   which font each uses. Should the smallest label move from ~7–8px to ~9–10px? Argue it.
6. **Type pairing:** is Space Grotesk + Inter + JetBrains Mono the right premium trio for this
   product, or would a swap (e.g. Geist/Sora display, condensed grotesque) read more high-end?
   If you'd change, name specific fonts and where each applies.
7. **Warm vs. cool:** the app is warm (gold) but several node hues + violet are cool. Is the
   temperature coherent? Recommend a temperature strategy.

## Deliverable
- A **ready-to-paste `--syn-*` palette block** (night + day) reflecting your recommendations,
  with a one-line comment per token.
- A **type scale table** (step · font · px · weight · line-height · tracking · usage).
- The prioritized Recommendations table (Change → Why → Spec → Effort → Impact).
- WCAG pass/fail notes for the key text-on-surface combinations.

Constraint: values must slot into a Tailwind-v4 `:root { --syn-* }` + `@theme` system.
