# 08 — Alignment Workflow (how we agree on the result *before* building)

> Your real question wasn't "how do you restyle" — it was **"how do we both end up with the
> same picture in our heads, and know in advance what the result will be?"** This file is that
> protocol. It turns taste (fuzzy, in your head) into a **contract** (exact, shared) through a
> short visual loop, so neither of us is guessing.

---

## The core idea: converge visually, then lock a contract

Taste can't be transmitted in words alone. So we don't try. We **look at things together**
and narrow down, then write the agreement down as exact tokens. Three artifacts already exist
to make each step concrete:

| Step | Artifact | What it does |
|------|----------|--------------|
| See options | `design/skin-studio.html` | live preview of YOUR app in all 6 directions × night/day |
| Reference real apps | §2 below | curated list of premium apps to point at ("this, not that") |
| Lock the deal | `design/DESIGN-CONTRACT.md` | the exact tokens + rules we both sign off before I code |

---

## The 5-step loop

### Step 1 — Diverge (look widely, 10 min)
- Open **`design/skin-studio.html`** (double-click it — it runs offline). Click through D1–D6,
  toggle night/day, open **Tokens**. This is *"a photo of how it will be"* — except it's your
  real layout, live, in every option.
- Skim the **similar-apps gallery** (§2). Note which real products make you think *"yes, like
  that"*.
- (Optional) generate/collect mood images (see `04-REFERENCE-IMAGE-GUIDE.md`) or a Figma frame
  (see `07-PLUGINS-AND-CONNECTORS.md`).
- **Output:** a shortlist — e.g. *"D3 or D6, and I like how Linear does its sidebar."*

### Step 2 — Converge (narrow to one, 5 min)
- Pick **one** direction (or a blend: *"D6 surfaces + D4's sharper density"*).
- Fill the top of **`design/02-DESIGN-BRIEF.md`** (north star + 3 adjectives + the direction).
- **Output:** one direction + a one-line north star. This is enough to commit.

### Step 3 — Lock the contract (I write it, you approve — 5 min)
- I turn your choice into **`design/DESIGN-CONTRACT.md`**: the exact palette, type scale,
  spacing/radius, motion, and the per-screen intent — plus the guardrails. Concrete values, no
  adjectives.
- You read it and say **"approved"** or mark changes. *This is the moment we both know exactly
  what will be built and what "done" means.* Nothing is ambiguous after this.

### Step 4 — Build against the contract (me)
- I implement token-first, screenshotting each surface, checking every screen against the
  contract. I don't improvise outside it; if I hit something the contract didn't cover, I ask.

### Step 5 — Verify on real pixels (both)
- I show **real screenshots** of the running app (like the ones already in `design/reference/`),
  night + day, side-by-side with the contract.
- You react on real pixels: *"darker here, this glows, tighten that."* I adjust. 1–2 rounds and
  it's locked. Because we agreed the contract up front, this is fine-tuning, not re-litigating.

**Why this works:** the AI-image "replicate the photo" method skips Step 3 — so we'd *think* we
agreed but discover mismatches only after building. The contract makes the agreement explicit
*before* the expensive part, and the live previews make it visual instead of verbal.

---

## 2. Similar apps to point at (the reference gallery)

Look at these real products and tell me what to borrow. I've noted the *specific* thing each
does well for a tool like yours. (You look at them; I translate the feel into tokens.)

**Dark, premium, creative-pro / node tools**
- **DaVinci Resolve / Fusion** — the gold standard for a *dense pro video suite*: charcoal
  panels, precise controls, node graph. Borrow: authority, control density, node clarity. (→ D4)
- **Ableton Live / Bitwig** — instrument-panel calm, purposeful color-coding of tracks/devices.
  Borrow: the "designed signal legend" idea for your node colors. (→ D4/D1)
- **TouchDesigner / Cables.gl / Nodes.io** — real-time node canvases. Borrow: how live/reactive
  state is shown without becoming noisy.
- **Spline / Rive / Framer** — modern creative tools with soft depth and tasteful motion.
  Borrow: entrance motion, glass, hover life. (→ D3/D6)

**"Expensive software product" UI**
- **Linear** — the reference for restrained premium: perfect spacing, one accent, crisp type,
  subtle depth. Borrow: discipline, the elevation ladder, the sidebar active-state. (→ D1/D3)
- **Vercel / Raycast** — near-black + one accent, sharp mono touches. Borrow: contrast control,
  keyboard-first polish. (→ D1/D4)
- **Arc browser / visionOS** — glass, depth, light. Borrow: the "liquid obsidian" glass feel. (→ D3)
- **Superhuman / Cron (Notion Calendar)** — dark elegance + speed. Borrow: how motion stays fast.

**Cinematic / atmospheric**
- **A good game HUD** (e.g. sci-fi UIs: Destiny, Cyberpunk menus) — Borrow: the "deep space
  console" wonder, HUD readouts. (→ D6)
- **Awwwards dark portfolios** — Borrow: hero drama, gradient/type moments. (→ D5/D6)

> How to use this: open 3–4 of these, and in the brief (or just tell me) say
> *"the sidebar like Linear, the depth like Arc, the node legend like Ableton, the hero drama
> like a game HUD."* That sentence + a direction = a target I can hit exactly.

---

## 3. What each of your questions maps to
- *"Mi mostri app simili?"* → §2 gallery (you look, I translate).
- *"Mi crei una foto di come sarà?"* → `skin-studio.html` (live, real, better than a photo) +
  real screenshots in `design/reference/`.
- *"Mi fai più versioni?"* → the 6 directions in the Skin Studio; then 1–2 real variants on the
  app in Step 5.
- *"Come ci accordiamo / sappiamo entrambi cosa fare e il risultato?"* → the **Design Contract**
  (Step 3) — the signed, exact spec + the "definition of done".

---

## 4. Definition of done (so "finished" isn't subjective)
The restyle is done when, in **both** themes, on **every** screen:
1. It matches the approved `DESIGN-CONTRACT.md` tokens (palette, type, spacing, radius, motion).
2. The audit's 10 weaknesses (`01-DESIGN-AUDIT.md` §10) that the contract chose to fix are fixed.
3. Real screenshots match the contract's per-screen intent.
4. `npm run lint` is clean; both themes + responsiveness work; no `data-testid` changed.
5. You look at it and it hits the **north star** from the brief.

That checklist is the shared "we're done" — agreed in advance, verified at the end.
