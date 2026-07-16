# VFX Syntech — Design Kit (master index)

> Prepared automatically by Claude Code to make the **premium aesthetic restyle** of the
> app fast, precise, and repeatable. Read this file first. Everything you need is inside
> `design/`.

This kit exists so that tomorrow, in a fresh session, you can attach the repository +
these files (+ optionally a reference image) and get **exactly** the aesthetic you want,
without me having to re-derive the whole app first (which wastes tokens and risks drift).

---

## 0. TL;DR — the answer to your three questions

**1. Did I use your "generate an AI image and copy it" method, or is there a better one?**
There is a better one, and this kit is built around it. Your image method is kept — but
**downgraded from "spec" to "mood board"** — because text-to-image models cannot render a
real, consistent UI (they invent fake labels, break layouts, garble text, and give no exact
hex/spacing). The app already has a **single source of truth for its look** (the `--syn-*`
token block in `src/index.css`). The high-fidelity path is **token-first**: you tell me the
target with an explicit brief and/or a ready-made palette, I rewrite the tokens and restyle
each component surgically, and we iterate against **real screenshots of the running app** —
not against an AI picture. Full reasoning in `04-REFERENCE-IMAGE-GUIDE.md`.

**2. File order** — see section "How to use this kit tomorrow" below.

**3. What to write in the top bar (the kickoff prompt)** — see `KICKOFF-PROMPT` below,
ready to paste.

---

## 2. What this app is (one paragraph, so the kit makes sense)

**VFX Syntech** ("Created by State") is a browser-based, AI-assisted, **node-based**,
audio/video-reactive VFX compositor. React 19 + TypeScript + Vite 6 + Tailwind CSS v4,
with an Express + Gemini backend. Its current look is **"deep-space obsidian"**: matte
black surfaces, an obsidian-**gold** accent (`#e0b451`) plus a **violet** AI accent
(`#a882ff`), tiny uppercase **JetBrains Mono** labels, large tight **Space Grotesk**
headlines, and an animated node-constellation "brain graph". The full teardown is in
`01-DESIGN-AUDIT.md`.

---

## 3. Files in this kit and the order to use them

### A. Restyle kit — attach these to **Claude Code** (me) tomorrow, with the repo
| # | File | What it is | Who fills it |
|---|------|-----------|--------------|
| 1 | `01-DESIGN-AUDIT.md` | Complete 360° teardown of the **current** look (tokens, layout, every component, honest weaknesses). My "ground truth" so I don't re-scan the repo. | (done — read only) |
| 2 | `02-DESIGN-BRIEF.md` | Fill-in template that captures the **target** aesthetic in precise terms. | **You** (5 min) |
| 3 | `03-AESTHETIC-DIRECTIONS.md` | A menu of **6 ready-made premium directions**, each a *complete* token set (hex, type, texture, motion). Pick one, or blend. | **You** (pick) |
| 4 | `04-REFERENCE-IMAGE-GUIDE.md` | How to generate + annotate the AI reference image so it *helps* instead of misleads, and its exact role/limits. | **You** (optional) |
| 5 | `05-IMPLEMENTATION-PLAYBOOK.md` | The exact procedure I will follow: token-first, component order, guardrails (don't break functionality/tests). | (me — read only) |
| 6 | `06-COMPONENT-STYLE-MAP.md` | File-by-file map of *where every visual element lives* so my edits are surgical. | (me — read only) |

### B. Gemini analysis kit — attach these to **Google AI Studio** (Gemini Pro latest)
Folder `design/gemini/`. Purpose: get a rigorous, independent **360° aesthetic analysis**
from Gemini, one file per aesthetic dimension. See `design/gemini/README.md` for the load
order and settings — but the short version is: upload `00-CONTEXT.md` **first**, then the
five `ANALYSIS` files (any order), then `06-SYNTHESIS` **last**.

### C. Handoff
| File | What it is |
|------|-----------|
| `HANDOFF.md` | Paste this as the first message of the **new chat** once the app is finished, so I resume with full context and zero ramp-up. |

---

## 4. How to use this kit tomorrow (the workflow)

**Step 1 — decide the target (10 min, no code).**
Open `03-AESTHETIC-DIRECTIONS.md`, pick the direction that excites you (or say "blend D2 + D5").
Then fill `02-DESIGN-BRIEF.md` — even just the first half is enough to start.
*(Optional)* generate a reference image following `04-REFERENCE-IMAGE-GUIDE.md`.

**Step 2 — kick me off.** Start a session with the repo attached, attach
`01-DESIGN-AUDIT.md`, your filled `02-DESIGN-BRIEF.md`, your chosen direction from
`03-AESTHETIC-DIRECTIONS.md`, `05-IMPLEMENTATION-PLAYBOOK.md`, `06-COMPONENT-STYLE-MAP.md`,
and (optional) the image. Paste the `KICKOFF-PROMPT` below.

**Step 3 — I work token-first.** I rewrite `src/index.css` `--syn-*`, tokenize the strays,
then restyle component-by-component in the playbook order, screenshotting as I go.

**Step 4 — (parallel) get Gemini's second opinion.** Feed `design/gemini/*` to Gemini Pro
for the independent 360° critique; bring anything sharp back to me.

**Step 5 — polish + features.** Once the base aesthetic lands, we add the missing
functionality (right-panel effects, node behaviours) on top of a look that's already premium.

---

## 5. KICKOFF-PROMPT (paste this in the top bar, with the repo attached)

```
You are restyling VFX Syntech to a premium aesthetic. This is a VISUAL/CSS pass only —
do not change app functionality, routing, state, or the data-testid attributes.

Read design/01-DESIGN-AUDIT.md (current look), design/05-IMPLEMENTATION-PLAYBOOK.md
(how to proceed) and design/06-COMPONENT-STYLE-MAP.md (where things live).

Target aesthetic: [ direction from design/03-AESTHETIC-DIRECTIONS.md, e.g. "D3 Liquid
Obsidian" ] + the choices in my filled design/02-DESIGN-BRIEF.md (attached). The attached
image is a MOOD BOARD, not a spec — match its feel, not its pixels.

Work token-first: rewrite the --syn-* block in src/index.css, tokenize any hardcoded
colors that block a clean re-skin, then restyle components in the playbook order. Run
`npm run dev` and screenshot each surface (home graph, AI Lab, night + day mode) to verify
against the brief before moving on. Keep everything responsive and both themes working.
Commit in logical steps.
```

Adjust the two `[ ]` slots and you're set.

---

## 6. One-line status

Everything in this kit is **preparation**. No app code was changed — this was a read-only
analysis pass plus the creation of `design/`. The restyle itself happens tomorrow, on your
signal, with these files loaded.
