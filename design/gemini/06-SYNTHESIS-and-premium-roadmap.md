# 06 — SYNTHESIS: The Premium-Elevation Roadmap

> Assignment for Gemini. Run this **LAST**, after the five analyses (01–05) exist in this
> conversation (or paste their outputs above this prompt). Raise temperature to ~0.8. Your job:
> fold everything into **one prioritized, decisive plan** to take VFX Syntech from "good indie
> app" to "genuinely premium / flagship". Be an art director making calls, not a menu of options.

## What to produce

### 1. The single design thesis (2–3 sentences)
State the *one* aesthetic direction you'd commit VFX Syntech to, and why it fits a node-based,
AI-driven, audio/video-reactive VFX tool. Give it a name. This is the north star everything else
serves. (You may reference the owner's candidate directions in `../03-AESTHETIC-DIRECTIONS.md`
— D1 Obsidian Refined, D2 Liquid Chrome, D3 Liquid Obsidian glass, D4 Mission Control, D5
Neo-Brutalist, D6 Deep Space Luxe — endorse one, blend, or propose your own.)

### 2. The design system, decided (not optional)
Lock the foundations, with exact values:
- **Color:** the `--syn-*` night + day palette (surface elevation ladder, accent(s), text tiers,
  the resolved node-color decision, semantic colors).
- **Type:** the scale (steps · font · px · weight · line-height · tracking · usage).
- **Space & radius:** the scales, mapped.
- **Elevation, glow & motion:** the unified specs.
Present as compact reference tables — a real "design tokens" spec someone can implement directly.

### 3. Prioritized roadmap (the heart of this file)
One master table, ranked by **impact-for-effort**, merging the best recommendations from 01–05:

| Rank | Change | Dimension | Why it reads "premium" | Concrete spec | Effort (S/M/L) | Impact |
|------|--------|-----------|------------------------|---------------|----------------|--------|

Then group into three waves:
- **Wave 1 — Quick wins (hours):** highest impact, lowest effort. The token/elevation/type
  foundation + the top-bar fix + tokenizing day mode. What ships first.
- **Wave 2 — The craft pass (a day):** component states, the Effects Library cards, motion/depth
  (the `space-vignette` payoff), node-color harmonization.
- **Wave 3 — Signature & polish:** the brand signatures, cross-surface unification, the flagship
  "screenshot" moments.

### 4. The "10% that delivers 50%"
Name the **3 changes** that, alone, would most move the premium needle — the ones to do even if
nothing else gets done. Justify each in one line.

### 5. Traps to avoid
3–5 specific ways a restyle of *this* app could go wrong (e.g. over-glowing into gamer-RGB,
killing the information density pros need, breaking the token/canvas link, illegible micro-labels,
motion that fights a pro workflow). Guardrails.

### 6. Definition of done
A short checklist that says "this now looks premium": what must be true across both themes and
every screen for the owner to call it flagship.

## Constraints
- Everything must be implementable in the React + Tailwind-v4 + `--syn-*` token system.
- Must not require breaking functionality or the `data-testid` test hooks.
- Respect that the owner will implement via Claude Code; write the roadmap as a brief Claude can
  execute step by step.

Be decisive. The owner wants a plan they can act on tomorrow, not a survey.
