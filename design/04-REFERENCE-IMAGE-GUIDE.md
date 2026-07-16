# 04 — Reference Image Guide (your method, sharpened)

> You proposed: *"I'll generate an AI image of my app with a premium aesthetic, and Claude
> copies it."* This file answers, honestly: **is that the best method?** Short answer — it's
> a great source of *direction*, but a poor source of *truth*. Use it as a **mood board**, not
> a blueprint. Here's why, and how to make it genuinely useful.

---

## 1. Why "copy the AI image" is not the highest-fidelity path

A restyle needs **exact** values: hex codes, font sizes, spacing, radii, which element gets
which treatment. An AI-generated image cannot provide those reliably, because:

1. **It hallucinates the UI.** Text-to-image models invent fake labels, wrong button counts,
   impossible layouts, and garbled words. Your app has real, specific content ("Created by
   State", "AI Lab Nodes", the five effect names) — the model won't reproduce them faithfully.
2. **It's lossy to reverse-engineer.** From a raster picture I have to *guess* "is that
   #0f1218 or #101319? is that 12px or 14px? 8px radius or 10?" — every guess is drift.
3. **It won't respect your real structure.** The app is 74/26 panels, a 78px sidebar, a
   62/38 vertical split. An AI image will "improve" the layout into something that doesn't map
   to the components, and then "copying" it means fighting the real code.
4. **You already own the better lever.** VFX Syntech has a **single token block** (`--syn-*`)
   that drives both the CSS and the canvas. Feeding me exact tokens (via the brief + a chosen
   direction) is *lossless*; feeding me a picture is lossy. Why start from the lossy end?

**Analogy:** an AI image is a *photo of a room you like*. The brief + direction is the
*paint codes and furniture list*. I can build your room from the codes exactly; from the photo
I'm color-matching by eye.

---

## 2. The recommended method (token-first, image-assisted)

Ranked by how much fidelity each input gives me:

1. **Best:** a chosen direction from `03-AESTHETIC-DIRECTIONS.md` (already exact tokens) +
   a filled `02-DESIGN-BRIEF.md`. → I can nail it with **no image at all**.
2. **Great addition:** a **real screenshot** of the *running* app (from `npm run dev`) with
   your notes scribbled on it ("make this darker", "kill these colors", "this panel should
   glow"). This is 10× more useful than a generated image because it's *your actual UI*.
3. **Useful for mood:** an **AI-generated image** — for palette feel, texture, and "vibe",
   NOT for layout or exact values.
4. **Useful for taste:** links/screenshots of **real products** you admire (Linear, Resolve,
   a game HUD…). Real UIs > generated UIs, always.

So: keep generating the image if it helps *you* see the target — just hand it to me labeled
"mood board", and pair it with a direction + brief so I have exact values too.

---

## 3. If you generate an AI image anyway — do it well

### 3.1 Prompt recipe (paste into your image model, edit the 〔…〕)
```
A premium dark-mode desktop UI for a professional node-based video-effects compositor,
16:9, high detail, crisp. Layout: slim left icon sidebar; a large central canvas showing a
glowing node-graph / constellation; a bottom row split into a node editor and an AI assistant
panel; a right sidebar list of effect cards. Aesthetic: 〔D3 "liquid obsidian glass" — deep
near-black, layered frosted-glass panels, a single champagne-gold accent, soft depth, subtle
grain, tasteful glow〕. Typography feel: 〔large tight grotesque headline + tiny uppercase
monospace telemetry labels〕. Mood: cinematic, luxurious, restrained, expensive. Studio product
shot, even lighting, no text artifacts, no logos.
```
Tips: generate **3–4 variants**; render at **16:9** to match the app; ask for a **UI/product
shot**, not "concept art"; explicitly say *"no text artifacts"* to reduce garbled labels.

### 3.2 Then annotate it (this is the part that matters)
On top of the best variant, mark:
- ✅ **"Take this"** arrows → the 2–3 things you actually want (e.g. "this panel glass",
  "this accent", "this glow").
- ❌ **"Ignore this"** → anything the model invented that you *don't* want.
- 🎯 One note on **what feeling** it nails.

A messy annotated screenshot beats a pristine unannotated one every time.

### 3.3 Extract, don't trace
When you give it to me, I'll pull the **palette and texture feeling** from it and reconcile
them with your chosen direction's exact tokens — I won't try to reproduce its (fake) layout.
Say in the brief (section I) exactly how literally to take it.

---

## 4. Even better than an image: let me generate *real* previews

Because the app is token-driven, once you pick a direction I can:
1. Apply the tokens and run the **actual app**, then screenshot the **real** UI in the new skin.
2. Show you 2–3 real variants (e.g. "gold vs. champagne vs. ice accent") on your *actual*
   screens — not a hallucination.
3. You react to real pixels; we converge fast.

This "preview on the real app" loop is strictly better than iterating on generated art, and it's
only possible because your design system is centralized. So the ideal flow is: **direction +
brief → I skin the real app → we refine from real screenshots** — with your AI image only as
the initial spark.

---

## 5. Bottom line
- Your method: **kept, but as a mood board**, not a spec.
- The better method: **token-first** (direction + brief) → I skin the real app → refine from
  **real screenshots**.
- If you love making the images, make them — annotate them, pair them with a direction, and
  tell me how literally to read them (`02-DESIGN-BRIEF.md` §I).
- You do **not** need an image to get an excellent result. You need §A and §B of the brief.
