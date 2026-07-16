# 04 — ANALYSIS: Motion, Texture & Depth

> Assignment for Gemini. You have read `00-CONTEXT.md`. Analyze **motion, texture, depth, and
> "atmosphere" only**. Standard response format. This dimension is where "premium" is most often
> won or lost, and where this app currently under-delivers on its own promise.

## Scope
- **Existing motion:** hero wordmark gradient shimmer (gold→violet, 6s); accent glow keyframes
  (`pulse-glow`, `gold-glow-*`); the canvas **constellation** (force-directed physics, a
  "heartbeat" core pulse on a 160-frame cycle, traveling signal pulses along filaments,
  audio-reactive node sizing, mouse repel/link-drag); animated dashed **node-flow** connectors
  in the SVG editor; `eq-bar` equalizer bounce; emerald "live" pulse; `transition-colors
  duration-300` theme fades.
- **Texture/depth:** `space-vignette` is defined but **flat** (just a bg color). Panels use
  `shadow-md/lg` inconsistently. No grain, no real vignette, no parallax, no depth-of-field.
- **Unused capability:** `motion` (Framer Motion) is installed but essentially unused — no
  entrance, hover, gesture, or layout animation.

## Questions to answer (be specific — give durations, easings, values)
1. **Motion principles:** define this app's motion personality in one line, then a small set of
   rules (default duration, easing curves, stagger, "what animates and what must not"). A pro
   tool must feel *responsive*, not decorative-slow — set the budget.
2. **Entrances & transitions:** where should Framer Motion be added for a premium first
   impression (panel mount, tab switch, modal, hero load, effect open/close)? Give exact
   spring/tween specs and stagger. Where should motion be *forbidden* (to keep it pro, not toy)?
3. **Depth & atmosphere (priority):** `space-vignette` is flat. Deliver the "deep space" promise.
   Options to spec: radial vignette, animated **nebula**, parallax **starfield**, film **grain**,
   depth-of-field between layers, glass blur. Recommend a concrete stack (layers, opacities,
   blur radii, grain method — SVG/CSS/canvas) that stays performant (this app already runs a
   canvas + WebGL). Give the CSS/technique.
4. **The constellation:** it's the signature. How to make it feel more premium/cinematic without
   losing performance — depth haze, bloom, focus falloff, calmer vs. more dramatic pulse,
   improved HUD label pills? Give specifics, and note the perf ceiling (it's canvas-2D at 60fps).
5. **Glow & elevation language:** unify the inconsistent `shadow-*`/glow usage into one system:
   define resting shadow, hover lift, and accent-glow specs per elevation level. Exact values.
6. **Hover/feedback micro-motion:** premium specs for button/card/slider/node hover and press
   (transform, shadow, glow, timing). Keep it snappy (≤150ms) — argue the timings.
7. **Reactive motion:** the app is audio/video-reactive. How should the UI (not just the canvas)
   express liveness tastefully — meters, the "live" dot, subtle accent breathing on active nodes
   — without becoming a rave? Set limits.
8. **Reduced motion:** specify the `prefers-reduced-motion` fallback for every animation above.
9. **Performance guardrails:** which effects are safe (GPU-friendly: transform/opacity, canvas)
   vs. costly (large blur, box-shadow animation, layout thrash)? Give a do/avoid list.

## Deliverable
- A **motion spec table** (element/event → property → duration → easing → notes).
- A **depth/atmosphere layer stack** to replace flat `space-vignette` (concrete + performant).
- A unified **elevation + glow** spec (resting/hover/active per level).
- `prefers-reduced-motion` fallbacks.
- The prioritized Recommendations table (Change → Why → Spec → Effort → Impact).

Constraint: 60fps target alongside an existing canvas/WebGL workload; prefer transform/opacity and
GPU-cheap techniques; Framer Motion + CSS + canvas are all available.
