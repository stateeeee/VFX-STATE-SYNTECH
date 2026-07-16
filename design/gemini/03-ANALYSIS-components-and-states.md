# 03 — ANALYSIS: Components, Controls & States

> Assignment for Gemini. You have read `00-CONTEXT.md`. Analyze the **component library and its
> interaction states only** (buttons, inputs, cards, nodes, chips, sliders, tabs, modals, and
> their hover/active/focus/disabled/loading/empty states). Standard response format.

## Scope — component inventory to critique
- **Nav items** (sidebar): icon-over-caption; active = color-only (no indicator).
- **Buttons:** primary (`bg-gold-500 text-black`, e.g. Master MP4), secondary (bordered ghost),
  the violet AI buttons (`Apply All Suggestions`, `Send`).
- **Inputs:** search box (static placeholder), chat input, AI-optimizer prompt, preset-name
  field, range **sliders** (`accent-[var(--syn-accent)]`), checkboxes.
- **Chips/badges:** Active/Standby, audio-modulation `~` route chips (amber), FPS/RES readouts,
  status pills.
- **Cards:** the 5 **Effects Library cards** (name-only — lowest fidelity), AI-Lab **node cards**
  (per-param sliders + up/down/power), Nodal-editor **SVG nodes** (accent bar + ACTIVE/BYPASS +
  ports + remove ✕).
- **Tabs:** Gemini panel (Home/Art Director/Agent/Optimizer).
- **Chat bubbles:** model vs. user variants + markdown.
- **Modal:** Projects (backdrop-blur).
- **Meters:** audio bass/loud/treble bars, beat dot, motion/bright signal bars.

## Questions to answer (be specific)
1. **State system:** define a consistent treatment for **hover / active / focus-visible /
   disabled / loading** across all interactive elements (exact: bg, border, glow, transform,
   duration/easing). Today active is often color-only — propose indicator bars/pills/underlines.
2. **Buttons:** define a proper button hierarchy (primary / secondary / ghost / danger / icon)
   with exact specs for each in both themes. Is `bg-gold-500 text-black` the right primary, or
   should primary be more restrained with gold reserved for accents?
3. **Effects Library cards (priority):** design the premium version. What should each card show
   (name, category/accent, status, a live/preview thumbnail, drag affordance)? Give exact
   dimensions, internal layout, hover behavior, and the active/selected treatment. This is the
   single most "unfinished" component — make it a showcase.
4. **Sliders & pro controls:** the app is full of range sliders and the `~` audio-mod chips.
   Recommend a premium slider spec (track, fill, thumb, value readout, reactive/modulated
   variant) and how to show a parameter that's being audio-modulated (currently an amber chip).
5. **Node visual language:** unify the two node representations (SVG nodes in the editor vs.
   node cards in the AI Lab) into one coherent "node" look. Specs for idle/active/bypassed/
   selected, ports, and connectors.
6. **Empty / loading / error states:** critique the current ones ("NO SIGNAL", "Empty
   composition", spinner + cycling phrases, mic-denied banner). Make them feel intentional and
   on-brand. Give copy + visual specs.
7. **Chips & badges:** define one badge system (size, radius, color roles for live/active/
   standby/warning/reactive) to replace the current mix.
8. **Tabs & chat:** premium spec for the Gemini panel tabs and chat bubbles (alignment, density,
   avatars/icons, markdown styling `.markdown-body`).
9. **Focus & keyboard:** what focus-visible ring and keyboard affordances does a pro tool need?
   Give the ring spec that works on both dark and cream.

## Deliverable
- A compact **component state matrix** (component × state → exact treatment).
- A detailed **Effects Library card** spec (the priority), with dimensions and hover/active.
- A **slider** spec and a **badge** spec.
- The prioritized Recommendations table (Change → Why → Spec → Effort → Impact), flagging which
  are pure-CSS vs. which imply small markup changes.

Constraint: Tailwind v4; must not require removing `data-testid`s or restructuring logic.
