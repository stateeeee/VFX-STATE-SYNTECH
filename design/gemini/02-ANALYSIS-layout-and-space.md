# 02 — ANALYSIS: Layout, Space & Composition

> Assignment for Gemini. You have read `00-CONTEXT.md`. Analyze **layout, spatial system, and
> composition only**. Use the standard response format. Reference screens by name.

## Scope
The frame and how content is arranged within it:
- **Shell:** full-screen floating cards on matte black, `p-4 gap-4`, `rounded-2xl` panels.
- **Top bar** (h-12): 3 zones; center wordmark absolutely positioned (overlap risk on narrow
  widths).
- **Left sidebar** (78px): logo + primary nav + a "GEMINI PRO" subsection.
- **Main split:** 74% left/center vs. 26% right; left/center = 62% hero over 38% bottom row
  (Nodal Composition + Gemini panel); right = Effects Library.
- **AI Lab** full-screen: toolbar + stage + dense right control rail.
- Radii used ad hoc (`md/lg/xl/2xl`); panel padding varies (`p-3/3.5/4/5`); no documented
  spacing or radius scale.

## Questions to answer (be specific)
1. **Spacing system:** propose an explicit spacing scale (e.g. 4-based: 4/8/12/16/24/32) and say
   where the current `p-3/3.5/4/5` and `gap-4` should map. Where is the app too tight? too loose?
2. **Radius system:** define a radius scale and assign it (cards vs. chips vs. inputs vs. buttons
   vs. the outer panels). Is `rounded-2xl` everywhere the right call, or should hierarchy vary
   radius? Give exact px.
3. **Proportion:** are the 74/26 and 62/38 splits well-judged for this workflow? Should the hero
   get more room? Is 78px enough for the sidebar (its captions feel cramped)? Give target values.
4. **Top bar:** redesign the 3-zone layout so the center wordmark can't collide (flex/grid, not
   absolute). What global actions *should* live in the top bar for a pro tool (export, share,
   render status, account) and where? Sketch the zone allocation.
5. **Density & rhythm:** the app is information-dense (esp. AI Lab + Gemini panel). Recommend a
   grouping/rhythm strategy (section headers, dividers, whitespace) to make density feel
   *designed* rather than crowded. Where should it breathe?
6. **Alignment & grid:** is there a consistent baseline/module grid? Propose one (column/gutter,
   baseline) that the panels and micro-labels can snap to.
7. **The Effects Library card grid:** the right panel is a vertical list of bare cards. Propose
   the ideal card size/aspect, grid vs. list, and spacing for a premium "browse effects" feel.
8. **Responsive:** how should this scale down (laptop 1280, tight 1024)? Which panels collapse,
   stack, or become drawers? Give breakpoints and behavior.
9. **Focal hierarchy:** on first load, where does the eye go, and where *should* it go? Recommend
   composition changes (size, contrast, placement) to guide attention to the hero + primary CTA.

## Deliverable
- A **spacing scale** + a **radius scale**, each mapped to current usages.
- A **top-bar zone diagram** (ASCII is fine) with the collision fixed and pro actions placed.
- Recommended split ratios + sidebar width, with reasoning.
- The prioritized Recommendations table (Change → Why → Spec → Effort → Impact).

Constraint: expressible in Tailwind utilities; keep `react-resizable-panels` splits functional.
