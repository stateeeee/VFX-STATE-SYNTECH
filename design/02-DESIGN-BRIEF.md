# 02 — Design Brief (fill this in)

> This is the **most valuable file** you can hand me. Five minutes here saves an hour of
> back-and-forth and prevents me from guessing. Replace the `〔…〕` placeholders. You don't
> have to answer everything — the first two sections alone are enough to start. Anything you
> leave blank, I'll take from your chosen direction in `03-AESTHETIC-DIRECTIONS.md`, or make a
> tasteful call and flag it.

How to fill: keep answers short and concrete. "More cinematic" is weak; "deeper blacks,
thin 1px hairlines, one warm accent, no rainbow node colors" is strong.

---

## A. The one-line north star  ★ (required)
> Finish this sentence in one line. It becomes the tie-breaker for every micro-decision.

**"When someone opens VFX Syntech, within 2 seconds it should feel like 〔e.g. a $5k
mastering-grade video suite / a luxury modular synth / a spaceship mission console / Teenage
Engineering hardware / a Blade-Runner terminal〕."**

Three adjectives, ranked: 1) 〔…〕 2) 〔…〕 3) 〔…〕

Products whose *feel* you envy (UI, not features): 〔e.g. Linear, Arc, Raycast, Ableton, DaVinci
Resolve, Figma, Vercel dashboard, Framer, Spline, a specific game HUD…〕

Explicitly **NOT** this: 〔e.g. "not neon-gamer RGB", "not flat corporate SaaS", "not skeuomorphic"〕

---

## B. Direction & palette  ★ (required)
**Chosen direction from `03-AESTHETIC-DIRECTIONS.md`:** 〔D1 / D2 / D3 / D4 / D5 / D6 / "blend D_ + D_" / "custom below"〕

If custom (or overriding the direction), give me the core palette. Hex is best; "a warm gold"
also works.
- Primary accent: 〔#______ / description〕
- Secondary accent (AI/Gemini): 〔#______ / description〕
- Should the app keep **two** accents (brand + AI), collapse to **one**, or go **mono + single accent**? 〔…〕
- Dark surface stack (I recommend NOT pure black — see audit §3.1). Base → raised → card:
  〔#______ → #______ → #______ / "you pick"〕
- Keep a **day/light mode**? 〔yes / no / "night-only for now"〕. If yes, light base: 〔#______〕
- The **6 node colors** (blob_tracker/blob_reveal/anamorphic/analog/bokeh/in/out): keep the
  rainbow, or harmonize into the brand? 〔keep / harmonize to metals / harmonize to jewel tones
  / single-accent tints / you pick〕

---

## C. Typography
- Keep the current pairing (Space Grotesk display / Inter UI / JetBrains Mono labels)? 〔keep / change〕
- If change, what vibe: 〔geometric-grotesque / humanist / editorial-serif accents / industrial-mono-heavy / …〕.
  Specific fonts if you have them: 〔…〕
- Feeling about the tiny 7–8px mono labels: 〔love them, keep tiny / lift to ~10px for legibility / you pick〕
- Overall letter-spacing feel: 〔keep the wide technical tracking / tighten / mixed〕

---

## D. Shape, surface & depth language
- Corner radius feeling: 〔sharp 0–4px "instrument" / current soft 16px (2xl) / pill-round / mixed by element〕
- Borders: 〔hairline 1px / heavier framed / borderless (rely on tone) / glowing accent edges〕
- Surface treatment: 〔flat matte / subtle gradients / glass/blur / gel-gloss / paper-grain / metallic〕
- Depth: how much? 〔crisp & flat / soft shadows / dramatic glows / true "deep-space" vignette+grain〕
- Density: 〔keep it dense/pro / breathe more / adaptive〕

---

## E. Motion & life
- Motion budget: 〔minimal & fast / tasteful entrances+hovers / rich, animated, "alive"〕
- Keep the constellation brain graph as the hero? 〔yes, love it / yes but calmer / yes but MORE dramatic / replace with 〔…〕〕
- The hero gradient shimmer (gold→violet): 〔keep / restyle to new palette / remove〕
- OK to add Framer-Motion entrance/hover animation (it's installed, unused)? 〔yes / sparingly / no〕

---

## F. Screen-by-screen intent (optional but powerful)
For any screen you care about, one line on what should change. Skip the rest.
- **Top bar:** 〔…〕
- **Left sidebar / nav:** 〔…〕
- **Hero brain graph:** 〔…〕
- **Nodal Composition ("AI Lab Nodes"):** 〔…〕
- **Gemini Pro panel:** 〔…〕
- **AI Lab / SynEngine (full screen):** 〔…〕
- **Effects Library (right cards — currently bare):** 〔…〕

---

## G. Wordmark & brand bits
- Keep "VFX Syntech" + "Created by State" + "AI-Powered. Node-Based. Limitless."? 〔keep all / change: 〔…〕〕
- Keep the diamond **VS** logo mark? 〔keep / refine / redesign / describe: 〔…〕〕
- Any brand assets to respect (existing logo, colors, font licenses)? 〔…〕

---

## H. Hard constraints & guardrails  ★ (read the defaults)
Defaults I will follow unless you say otherwise:
- ✅ **Visual pass only** — I will NOT change functionality, state, routing, API calls, or the
  `data-testid` attributes (tests/automation depend on them).
- ✅ Keep **both** themes working (unless you set night-only in B).
- ✅ Keep everything **responsive**; fix the top-bar overlap while I'm there.
- ✅ Prefer **token-first** edits so the look stays swappable.
- ✅ Do NOT restyle the iframe effects (`public/effects/*`) unless you ask (see audit §9).

Override any of the above here: 〔…〕
Anything I must absolutely NOT touch: 〔…〕
Deadline / scope for the first pass: 〔"just the shell tonight" / "everything" / …〕

---

## I. Reference image (if you're generating one)
- Attached? 〔yes / no〕
- Treat it as: 〔pure mood board / "match this closely" / "just the color palette" / "just the panel style"〕
- What specifically to take from it: 〔…〕  · What to ignore: 〔…〕
- (See `04-REFERENCE-IMAGE-GUIDE.md` for how to generate one that actually helps.)

---

### Quick-start (if you only have 60 seconds)
Fill **A** (north star + 3 adjectives) and **B** (pick a direction letter). That alone lets me
produce a strong first pass; we refine from screenshots.
