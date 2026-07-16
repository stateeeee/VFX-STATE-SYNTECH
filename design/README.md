# VFX Syntech — Design Kit (master index)

> Prepared by Claude Code so the **premium aesthetic restyle** is fast, precise, and something
> we can *agree on before building*. Read this first. Everything lives in `design/`.
>
> Nothing in the app's own code was changed to make this kit — it's all preparation, plus one
> live preview tool. The restyle itself happens on your signal.

---

## 0. Start here — the two things to open first
1. **`skin-studio.html`** — double-click it. A **live preview of your real app** re-skinned
   across all 6 directions × night/day, with the exact tokens shown. This is the *"photo of how
   it will be"*, the *"multiple versions"*, and the fastest way to point at what you want.
2. **`08-ALIGNMENT-WORKFLOW.md`** — the protocol for *how we agree on the result* and both know,
   in advance, exactly what will be built (the thing you were really asking about).

---

## 1. The answer to your core questions

**"What's the best way to get exactly the aesthetic I want — if not the AI-photo method?"**
An AI photo is *inspiration, not specification* — it can't give exact hex/spacing/fonts and
invents fake UI. The methods that produce an **exact** result, best first:
1. **Figma → token extraction** (you already have Figma; see `07-PLUGINS-AND-CONNECTORS.md`):
   design/grab the target in Figma, I read the exact variables — pixel-exact, zero guessing.
2. **Pick a ready direction + brief** (token-first): choose in the Skin Studio, I apply the
   ready tokens from `tokens/PALETTES.css`, refine on real screenshots. ~90% there, near-zero effort.
3. **Real-screenshot loop**: I skin the real app, screenshot it, you annotate, I adjust — converges exactly.
The optimal recipe combines them: image/Figma for *mood* → a token direction for *exactness* →
real-screenshot loop for *convergence*.

**"How do we agree / both know what to do and what the result will be?"**
Via a short **visual loop + a signed Design Contract** — see `08-ALIGNMENT-WORKFLOW.md` and the
`DESIGN-CONTRACT.md` template. We converge visually (Skin Studio + reference apps), then lock the
exact spec *before* I code, with an explicit "definition of done".

---

## 2. What this app is (one paragraph)
**VFX Syntech** ("Created by State") — a browser-based, AI-assisted, **node-based**,
audio/video-reactive VFX compositor. React 19 + TypeScript + Vite 6 + Tailwind v4, Express +
Gemini backend. Current look = **"deep-space obsidian"**: matte black, obsidian-**gold** accent
(`#e0b451`) + **violet** AI accent (`#a882ff`), tiny uppercase JetBrains Mono labels, big Space
Grotesk headlines, an animated node-constellation "brain graph". Full teardown in `01-DESIGN-AUDIT.md`.

---

## 3. Everything in this kit

### A. Restyle kit — attach with the repo to **Claude Code** (me)
| # | File | What it is | Who acts |
|---|------|-----------|----------|
| ★ | `skin-studio.html` | **Live preview** of the app in all 6 directions × night/day + tokens | **You** (open it) |
| 1 | `01-DESIGN-AUDIT.md` | Full 360° teardown of the current look (my ground truth) | read only |
| 2 | `02-DESIGN-BRIEF.md` | Fill-in template for the target aesthetic | **You** (5 min) |
| 3 | `03-AESTHETIC-DIRECTIONS.md` | 6 ready premium directions (full specs) | **You** (pick) |
| 4 | `04-REFERENCE-IMAGE-GUIDE.md` | How to use an AI image / real screenshot well | You (optional) |
| 5 | `05-IMPLEMENTATION-PLAYBOOK.md` | The exact procedure I follow + guardrails | read only |
| 6 | `06-COMPONENT-STYLE-MAP.md` | File-by-file map of where each visual element lives | read only |
| 7 | `07-PLUGINS-AND-CONNECTORS.md` | Figma/higgsfield/screenshots — what's actually available | You (choose) |
| 8 | `08-ALIGNMENT-WORKFLOW.md` | How we agree + the reference-apps gallery | **You + me** |
| — | `DESIGN-CONTRACT.md` | The exact spec we both sign off before I code | **You + me** |
| — | `tokens/PALETTES.css` | 6 ready-to-paste `--syn-*` token blocks (+ `tokens/README.md`) | I paste |
| — | `reference/` | Real screenshots: current "before" + Skin Studio "after" (+ how-to) | evidence |

### B. Gemini analysis kit — attach to **Google AI Studio** (Gemini Pro latest)
Folder `gemini/`. Independent 360° aesthetic critique, one file per dimension. Load order &
settings in `gemini/README.md` (short version: `00-CONTEXT.md` first → five `ANALYSIS` files →
`06-SYNTHESIS` last; add the `reference/` screenshots as evidence).

### C. Handoff
`HANDOFF.md` — paste as the first message of the **new chat** with the finished app, to add
functionality on top of a premium base with zero ramp-up.

---

## 4. The workflow (what happens tomorrow)
1. **Diverge:** open `skin-studio.html`, click through D1–D6 × night/day; skim the reference-apps
   gallery in `08-ALIGNMENT-WORKFLOW.md §2`.
2. **Converge:** pick one direction (or a blend); fill the top of `02-DESIGN-BRIEF.md`.
3. **Lock:** I fill `DESIGN-CONTRACT.md` from your pick; you write **APPROVED**. Now we both know
   exactly what's being built and what "done" means.
4. **Build:** I restyle token-first per `05-IMPLEMENTATION-PLAYBOOK.md`, screenshotting each screen.
5. **Verify:** you react to real screenshots (like `reference/`); 1–2 rounds; locked.
6. **(Parallel)** feed `gemini/*` to Gemini Pro for a second-opinion critique; bring the sharp bits back.
7. **Later:** the "add functionality + more polish" pass (new chat via `HANDOFF.md`).

---

## 5. KICKOFF-PROMPT (paste in the top bar, with the repo attached)
```
You are restyling VFX Syntech to a premium aesthetic. VISUAL/CSS pass only — do not change
functionality, routing, state, or data-testid attributes.

Read design/01-DESIGN-AUDIT.md, design/05-IMPLEMENTATION-PLAYBOOK.md, design/06-COMPONENT-STYLE-MAP.md.
Target: [ direction from design/03-AESTHETIC-DIRECTIONS.md, e.g. "D3 Liquid Obsidian" ] + my
filled design/02-DESIGN-BRIEF.md (attached). First fill design/DESIGN-CONTRACT.md from this and
show it to me for APPROVAL before coding.

Then work token-first: paste the chosen block from design/tokens/PALETTES.css over the --syn-*
block in src/index.css, tokenize stray hardcoded colors, restyle components in the playbook order.
Run `npm run dev`, screenshot each surface (home graph, AI Lab, night + day) to verify against the
contract before moving on. Keep both themes + responsiveness working. Commit in logical steps.
```

---

## 6. Status
Preparation only. The app's source is unchanged. The restyle happens on your signal, with these
files loaded and a Design Contract approved.
