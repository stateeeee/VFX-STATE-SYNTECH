# Gemini 360° Aesthetic Analysis Kit — how to run it

> Purpose: get a rigorous, **independent** aesthetic critique of every part of VFX Syntech
> from **Gemini (Pro, latest)** in Google AI Studio. Claude Code built these files; Gemini
> gives the second expert opinion. Bring the sharpest points back to Claude for the restyle.
>
> These files are **inputs for Gemini** — each is a self-contained analysis assignment. You
> upload them (plus screenshots and/or the repo) and Gemini produces the analysis.

---

## Model & settings
- **Model:** Gemini **Pro, latest** (e.g. "Gemini 3 Pro" / newest "…-pro" preview available).
  Use the Pro tier, not Flash — this is deep reasoning + long context.
- **Temperature:** ~**0.6** (analytical but not robotic). For file `06-SYNTHESIS` bump to ~0.8
  (more creative synthesis).
- **Thinking / reasoning:** ON / high if the toggle is available.
- **Output length:** max / long.
- **System instruction (paste this once in the AI Studio "System instructions" box):**
  > You are a principal product designer and art director specializing in premium, dark-mode
  > creative-pro software (video/audio tools, node editors, pro dashboards). You give precise,
  > opinionated, implementable critique — exact colors, type, spacing, motion — never vague
  > praise. You reason about hierarchy, contrast, accessibility, brand, and craft. When you
  > recommend, give concrete values and name the trade-offs.

---

## What to upload alongside these files
Give Gemini the best evidence you can (in order of value):
1. **Screenshots of the running app** — from `npm run dev`. Capture: home graph, hero overlay,
   Nodal Composition, all 4 Gemini-panel tabs, AI Lab, an open effect, Effects Library,
   night AND day mode. This is the most important input — Gemini analyzes what it can see.
2. **`00-CONTEXT.md`** (next file) — tells Gemini what the app is and its current design system.
3. Optionally the **GitHub repo** (AI Studio can ingest it) or key files
   (`src/index.css`, `src/App.tsx`, the components).
4. Optionally your **reference image** and your target direction (from
   `../03-AESTHETIC-DIRECTIONS.md`) if you want Gemini to critique *toward* a chosen goal.

> No screenshots yet? Gemini can still analyze from `00-CONTEXT.md` + the code, but screenshots
> make the critique far more concrete. If you can only do one thing, take screenshots.

---

## Load order (important)
Upload in this sequence, each as its own turn so Gemini builds context progressively:

1. **`00-CONTEXT.md`** — FIRST, always. The shared brief: what the app is + its current design
   system + the rules of engagement. Every later file assumes Gemini has read this.
2. Then the five analysis assignments — **any order**, but this is the natural flow:
   1. `01-ANALYSIS-color-and-typography.md`
   2. `02-ANALYSIS-layout-and-space.md`
   3. `03-ANALYSIS-components-and-states.md`
   4. `04-ANALYSIS-motion-and-texture.md`
   5. `05-ANALYSIS-brand-and-identity.md`
3. **`06-SYNTHESIS-and-premium-roadmap.md`** — LAST. It asks Gemini to fold all five analyses
   into one prioritized, premium-elevation roadmap. Run it only after the five are done, in the
   same conversation, so it can reference them.

**Two ways to run it:**
- **One long conversation (recommended):** paste system instruction → upload `00-CONTEXT.md` +
  screenshots → then send each analysis file as the next message → finish with `06-SYNTHESIS`.
  Gemini accumulates everything and the synthesis is coherent.
- **Separate chats (if context gets heavy):** run each analysis in its own chat (each re-uploads
  `00-CONTEXT.md` + screenshots), then paste all five outputs into a final chat with
  `06-SYNTHESIS`.

---

## What you'll get
- Five focused critiques (color/type, layout/space, components/states, motion/texture,
  brand/identity), each with concrete, prioritized, implementable recommendations.
- One synthesis: a ranked "make it premium" roadmap with quick wins vs. deeper moves.

## Then what
Bring Gemini's strongest, most concrete points to Claude Code and drop them into
`../02-DESIGN-BRIEF.md` (or just paste them in the kickoff). Two AI art directors > one; Claude
implements, Gemini pressure-tests.
