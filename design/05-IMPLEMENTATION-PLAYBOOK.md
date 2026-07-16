# 05 — Implementation Playbook (how Claude executes the restyle)

> This is the procedure I follow when you say "go". It's here so the restyle is predictable,
> safe (no broken features), and token-first (so the look stays swappable). If you're the one
> reading this: you don't need to do anything — it's my checklist. Attaching it just keeps me
> disciplined and saves tokens by not re-deriving the plan.

---

## 0. Golden rules (non-negotiable unless the brief overrides)
1. **Visual pass only.** No changes to functionality, state, routing, API calls, engine, or
   data flow. If a restyle *tempts* a structural change, I flag it and ask — I don't just do it.
2. **Never touch `data-testid` attributes**, element roles, or the DOM structure that tests /
   automation rely on. Restyle by changing **classes and tokens**, not by rewriting JSX trees.
3. **Both themes stay working** (night + day) unless the brief sets night-only.
4. **Responsive stays intact**; I fix the known top-bar overlap while I'm in there.
5. **Token-first.** Colors/spacing/radii go through `--syn-*` (and new tokens I add), not fresh
   hardcoded hex. I actively *remove* stray literals that block a clean re-skin.
6. **Don't restyle the iframe effects** (`public/effects/*`) unless asked (audit §9).
7. **Commit in logical, reviewable steps** with clear messages; screenshot before/after.

---

## 1. Phase 1 — Establish the token contract (the foundation)
1. Open `src/index.css`. Rewrite the `:root { --syn-* }` block to the chosen direction's
   palette (from `03-AESTHETIC-DIRECTIONS.md` or the brief). Specifically:
   - Set the **surface stack** so `--syn-ink-950 / -900 / -850 / -800 / -700` form a real
     elevation ladder (fixing audit #1 — no more all-`#000000`).
   - Set `--syn-accent` (+ ramp), `--syn-violet` (or fold to one accent per the brief).
   - Set `--syn-text` and add `--syn-text-muted`, `--syn-text-faint` (new, so I stop using
     ad-hoc `neutral-*`).
   - Add tokens the direction needs: `--syn-glass`, `--syn-glow`, `--syn-hairline`,
     `--syn-radius`, grain/vignette vars, etc.
2. **Tokenize day mode.** Introduce day-mode CSS vars (e.g. under a `:root[data-theme="day"]`
   or a `.day` scope) so the cream literals (`#fcfbf9`, `#f7f5f0`, `#7b51b7`, …) become tokens.
   *(If the app currently toggles theme via the `isDayMode` boolean + Tailwind conditionals,
   I keep that working but point both branches at tokens where practical — noting that a full
   move to a `data-theme` attribute is an option I'll propose, not silently do.)*
3. Extend `@theme` so any new tokens are usable as Tailwind utilities.
4. **Verify the free win:** because `VfxCanvas.tsx` reads `--syn-*` via `getComputedStyle`,
   the constellation graph re-skins automatically. Confirm it visually.
5. Commit: `design: retoken palette + elevation ladder (<direction>)`.

**At the end of Phase 1 the app is already substantially re-skinned** (everything that honors
tokens shifts at once). This is the highest-leverage step and why token-first wins.

---

## 2. Phase 2 — Global primitives
Before per-component work, set the shared language so components inherit it:
1. **Type scale:** define 4–5 steps (display / title / body / label / micro) as utility
   patterns or a small set of classes; lift the 7–8px labels to ~9–10px (audit §4). Swap fonts
   if the brief asks.
2. **Surface + elevation:** define the panel look once (radius, border/hairline, shadow, glass/
   blur if applicable, active-glow) and reuse. Kill inconsistent shadow usage (audit #10).
3. **Texture:** implement `space-vignette` for real if the direction calls for it (radial
   darken + grain, or nebula/aurora) — this is where "deep space" finally shows up.
4. **Motion baseline:** if enabled, add tasteful Framer-Motion entrance/hover (audit #7) as a
   couple of reusable wrappers; keep it subtle and fast.
5. Commit: `design: global primitives (type scale, surfaces, texture, motion)`.

---

## 3. Phase 3 — Component restyle, in this order
I go top-to-bottom by *visual impact*, screenshotting each before moving on. For each: apply
the surface/type/accent primitives, replace stray literals with tokens, add the direction's
signature detail, verify night + day.

1. **App shell + Top bar** (`App.tsx` header) — fix the absolute-centered wordmark (make it a
   proper 3-column flex/grid so it can't overlap); apply surface + accent; polish the live dot,
   clock, session readout. *First, because it frames everything.*
2. **Left sidebar** (`App.tsx` nav) — VS logo treatment, active-state indicator (bar/pill, not
   color-only, audit #8), separate "GEMINI PRO" section clearly.
3. **Hero brain graph** (`VfxCanvas.tsx`) — mostly free via tokens; add depth (vignette/haze),
   restyle HUD label pills, refine the standby state. Tune node/pulse colors if the direction
   changes the palette meaningfully.
4. **Hero overlay** (`App.tsx`) — wordmark gradient + tagline restyle to the new palette.
5. **Nodal Composition** (`NodalComposition.tsx`) — apply the direction's node-color decision
   (harmonize / mono+accent / owned-rainbow); restyle nodes, ports, connectors, add-menu.
6. **Gemini Pro panel** (`AiDirector.tsx`) — reconcile the AI accent with the new system
   (second hue, or tint of one accent); restyle chat bubbles, chips, tabs, inputs. Remove the
   `#7b51b7` literals → tokens.
7. **Effects Library** (`App.tsx` right sidebar) — **the biggest upgrade**: turn the bare
   name-only cards into premium cards (status, category/accent, hover, room for a preview/drag
   affordance). Make the search box look real (even if still non-functional — the brief says
   the right-panel behavior is unfinished, so I style, not wire).
8. **AI Lab / SynEngine** (`ChainLab.tsx`) — restyle toolbar, stage, control rail, sliders,
   meters, modulation `~` chips, preset rows, node cards. Densest screen — apply the type scale
   and grouping for rhythm.
9. **Effect host + Projects modal** (`EffectHost.tsx`, `App.tsx`) — bring to the new language.
10. Commit per component (or per logical group): `design: restyle <component> to <direction>`.

---

## 4. Phase 4 — Verify & converge
1. Run `npm run dev`; screenshot **every** surface in **both** themes:
   home graph, hero overlay, Nodal, Gemini (all 4 tabs), AI Lab, effect open, Projects modal,
   Effects Library, narrow-width top bar (overlap check).
2. Check contrast/legibility on the smallest labels; check focus states; check resize handles.
3. `npm run lint` (`tsc --noEmit`) stays clean — a visual pass must not introduce type errors.
4. Present screenshots against the brief's north star; note any deviations and why.
5. Offer 2–3 micro-variants where taste is subjective (e.g. accent warmth) on the *real* app.

---

## 5. Phase 5 — (later) the "even more premium" + features pass
Once the base lands and you're happy, the follow-up work (a separate session, per your plan):
- Wire the **Effects Library** (search, drag-to-graph, live previews).
- Program the **right-panel effects** and node behaviors that are currently placeholders.
- Add the missing functionality on top of a look that's already premium.
`HANDOFF.md` is written to bootstrap exactly that session.

---

## 6. Guardrail cheatsheet (what "restyle only" means, concretely)
| ✅ I will | ❌ I won't (without asking) |
|-----------|------------------------------|
| Change Tailwind classes, `--syn-*` tokens, CSS | Rename/move components, change props/state |
| Add tokens, a type scale, texture, subtle motion | Change routing, API calls, engine, exports |
| Fix the top-bar overlap (a layout bug) | Remove/rename `data-testid`s or restructure DOM trees |
| Restyle node/effect card visuals | Change what effects *do* or how the graph *works* |
| Introduce `data-theme` **as a proposal** | Silently rip out the `isDayMode` mechanism |
| Tokenize stray day-mode literals | Restyle `public/effects/*` iframes unless asked |
