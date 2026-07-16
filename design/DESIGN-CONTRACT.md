# DESIGN CONTRACT — VFX Syntech restyle

> The single source of truth we **both** sign off before I write restyle code. It converts your
> chosen direction + brief into exact, non-negotiable values. Once you write **APPROVED** at the
> bottom, I build exactly this — no improvising outside it; anything it doesn't cover, I ask.
>
> Status: **DRAFT — not yet filled.** I (Claude) fill this in Step 3 of `08-ALIGNMENT-WORKFLOW.md`
> from your chosen direction; you approve or edit. The `〔…〕` slots below are placeholders showing
> the shape. (Example values shown are for D1 Obsidian Refined — I'll swap them for your pick.)

---

## 0. North star & scope
- **North star:** 〔one line from the brief, e.g. "feels like a mastering-grade video suite"〕
- **Direction:** 〔D_ name, or the blend〕
- **Themes in scope:** 〔night + day / night only〕
- **Scope of this pass:** 〔shell only / everything except iframes / …〕
- **Explicit non-goals:** 〔e.g. not touching effect iframes; not wiring the search〕

## 1. Color tokens (night) — drop into `src/index.css :root`
| Token | Value | Role |
|-------|-------|------|
| `--syn-accent` | `〔#e6b24a〕` | primary accent |
| `--syn-violet` (AI) | `〔#9a7be0〕` | AI accent (or "= tint of accent") |
| `--syn-bg` | `〔#0a0a0b〕` | app base |
| `--syn-ink-950 / 900 / 850 / 800 / 700` | `〔#0c0c0e / #121214 / #17171a / #1c1c20 / #26262b〕` | elevation ladder |
| `--syn-text / -muted / -faint` | `〔#f4f2ee / #9a978f / #6a6862〕` | text tiers |
| `--syn-line / -hairline / -glow` | `〔…〕` | edges + glow |
| `--syn-radius` | `〔16px〕` | base radius |
| node colors `--syn-node-*` | `〔tracker/reveal/anam/analog/bokeh/in/out hex〕` | node decision |

*(Ready-made blocks live in `design/tokens/PALETTES.css` — the approved one gets pasted verbatim.)*

## 2. Color tokens (day) — the cream mirror
| Token | Value |
|-------|-------|
| base / panel / card | `〔#fcfbf9 / #ffffff / #ffffff〕` |
| border / text / muted | `〔rgba(0,0,0,.10) / #171717 / #6b6b6b〕` |
| accent / AI accent (day) | `〔kept / #7b51b7 replacement〕` |

## 3. Typography
| Step | Font | Size / weight / tracking | Usage |
|------|------|--------------------------|-------|
| display | `〔Space Grotesk〕` | `〔…〕` | hero, wordmark |
| title | `〔…〕` | `〔…〕` | panel headers |
| body | `〔Inter〕` | `〔…〕` | copy, buttons |
| label | `〔JetBrains Mono〕` | `〔~9px, .12em, caps〕` | HUD/labels (lifted from 7–8px) |
| micro | `〔JetBrains Mono〕` | `〔…〕` | tiny telemetry |
- Font changes vs. today: 〔none / swap display to …〕

## 4. Space & radius
- Spacing scale: 〔4 / 8 / 12 / 16 / 24 / 32〕
- Radius scale + assignment: 〔panels __ · cards __ · chips __ · inputs __ · buttons __〕

## 5. Surface, elevation, glow, motion
- Panel look: 〔matte / glass+blur __px / border __ / shadow __ / active-glow __〕
- Backdrop: 〔flat / vignette / nebula / aurora〕 (glass directions require a backdrop)
- Motion budget: 〔minimal / tasteful entrances+hovers / rich〕; durations 〔≤150ms hovers, __ entrances〕
- Constellation graph: 〔keep as-is / calmer / more dramatic〕; hero gradient: 〔keep / restyle / remove〕

## 6. Per-screen intent
| Screen | What changes | Done when |
|--------|--------------|-----------|
| Top bar | 〔fix center wordmark overlap; …〕 | 〔no overlap at 1024px; …〕 |
| Sidebar | 〔active indicator bar; …〕 | 〔…〕 |
| Hero graph | 〔depth/vignette; …〕 | 〔…〕 |
| Nodal editor | 〔node-color decision applied; …〕 | 〔…〕 |
| Gemini panel | 〔AI accent reconciled; tokenize #7b51b7; …〕 | 〔…〕 |
| AI Lab | 〔density rhythm; …〕 | 〔…〕 |
| Effects Library | 〔premium cards (status/accent/hover); …〕 | 〔…〕 |

## 7. Guardrails (fixed)
- Visual pass only: no functionality/state/routing/engine/API changes.
- No `data-testid` or DOM-structure changes that break tests.
- Both themes + responsive stay working; `npm run lint` clean.
- Token-first; remove stray hardcoded colors; don't touch `public/effects/*` unless listed above.

## 8. Definition of done
Ref `08-ALIGNMENT-WORKFLOW.md` §4 — all 5 checks pass, real screenshots match this contract.

---

### Sign-off
- Prepared by: Claude Code — 〔date〕
- **APPROVED by State:** 〔type "APPROVED" + any edits here〕
