# 03 — Aesthetic Directions (pick one, or blend)

> Six **complete, ready-to-implement** premium directions. Each is a *full* design language:
> palette (exact hex), surface stack (fixing the "pure black" problem from the audit),
> typography, shape, texture, motion, and how it treats the six node colors. Each maps
> cleanly onto the existing `--syn-*` token block, so choosing one = I paste its palette into
> `src/index.css` and restyle from there.
>
> **How to choose:** skim the "one-liner" of each, then read the 1–2 that pull you. Tell me
> `"D3"`, or `"D2 palette but D5 motion"`, or `"D4 but keep the gold accent"`. All six keep
> the app's DNA (node-based, cinematic, AI-forward); they differ in *taste*.

Legend for each card: **Base → Raised → Card** are the dark surface stack (base = app bg,
raised = panels, card = elevated). All include a proper elevation ladder (the audit's #1 fix).

---

## D1 — "Obsidian Refined"  ·  *evolve what's there, don't reinvent*
**One-liner:** the current obsidian-gold, but *correctly* premium — real elevation, one
disciplined gold, node colors harmonized to warm metals.

- **Accent (gold):** `#e6b24a` · hover `#f0c766` · deep `#7a5a1e`
- **Secondary (AI):** keep violet but muted → `#9a7be0`
- **Surface stack:** Base `#0a0a0b` → Raised `#141416` → Card `#1c1c1f` (finally distinct!)
- **Text:** `#f4f2ee` / muted `#9a978f` / faint `#6a6862`
- **Hairline:** `rgba(230,178,74,0.12)`
- **Node colors → warm-metal harmony:** tracker `#e6b24a` (gold), reveal `#c98a5a` (copper),
  anamorphic `#b8b0a0` (platinum), analog `#8a94a8` (steel), bokeh `#a98cc8` (muted amethyst),
  in `#6fae86` (patina), out `#e6b24a` (gold)
- **Type:** unchanged (Space Grotesk / Inter / JetBrains Mono); lift micro-labels to 9px.
- **Shape:** keep `rounded-2xl`; hairline 1px borders; soft shadows + faint gold rim on active.
- **Texture:** deliver `space-vignette` for real — radial darken to edges + 3% film grain.
- **Motion:** keep constellation + shimmer; add subtle panel entrance fade/slide.
- **Best if:** you like the current identity and want it to simply feel *expensive and finished*.
- **Effort:** ★☆☆ (lowest risk, fastest).

---

## D2 — "Liquid Chrome / Aurora"  ·  *cool, futuristic, iridescent-but-tasteful*
**One-liner:** deep blue-black glass with a cool chrome-to-aurora accent; premium fintech-meets-VFX.

- **Accent:** electric aurora `#5eead4` (teal) ↔ `#7c9cff` (periwinkle) gradient; solid accent `#6ee7d6`
- **Secondary (AI):** `#b78cff` (soft violet) — pairs with teal for the AI panel
- **Surface stack:** Base `#070a0f` → Raised `#0e1420` → Card `#151d2c` (cool blue-black)
- **Text:** `#eaf0f7` / muted `#8b97a8` / faint `#5a6473`
- **Hairline:** `rgba(120,160,255,0.14)`
- **Node colors → cool jewel spectrum:** tracker `#6ee7d6`, reveal `#f472b6`, anamorphic `#38bdf8`,
  analog `#818cf8`, bokeh `#c084fc`, in `#34d399`, out `#6ee7d6`
- **Type:** display → keep Space Grotesk (or swap to **Sora**/**Geist** for a cooler edge);
  mono → JetBrains Mono; slightly tighter tracking.
- **Shape:** `rounded-xl`; **glass**: `backdrop-blur` panels with 1px light-top inner border.
- **Texture:** subtle aurora glow behind the hero; frosted panels; faint noise.
- **Motion:** flowing gradient auroras (slow), spring hovers, animated glass sheen.
- **Best if:** you want "futuristic + cool" and are willing to move off gold.
- **Effort:** ★★☆ (glass + palette shift, but token-driven).

---

## D3 — "Liquid Obsidian" (Apple-glass / visionOS)  ·  *dark glass, depth, restraint*
**One-liner:** near-black with layered frosted-glass panels, one confident accent, generous depth
and light — the most "expensive tech product" of the set.

- **Accent:** warm champagne `#e8c88a` OR cool ice `#a9c7ff` — pick one; **single accent** system.
- **Secondary (AI):** a lighter tint of the same accent (not a second hue) → cohesion.
- **Surface stack (translucent):** Base `#08080a` → Raised `rgba(30,30,36,0.55)` (glass) →
  Card `rgba(44,44,52,0.6)` (glass), all over a faint moving nebula so blur has something to bend.
- **Text:** `#f5f5f7` / muted `#a1a1aa` / faint `#6b6b73`
- **Hairline:** top-lit `rgba(255,255,255,0.10)` inner + `rgba(0,0,0,0.4)` outer (real glass edge)
- **Node colors → monochrome + accent:** all nodes are graphite `#8b8b93` when idle and glow the
  single accent when active (kills the rainbow entirely — very high-end).
- **Type:** Inter/**Geist** UI, keep JetBrains Mono for telemetry; big soft Space Grotesk hero.
- **Shape:** `rounded-2xl`/`3xl`, thick soft shadows, bright specular top edge.
- **Texture:** layered blur, depth-of-field between layers, soft vignette, subtle grain.
- **Motion:** parallax between glass layers, spring entrances, light that shifts with content.
- **Best if:** you want the flagship "Apple keynote" look and clean minimalism over information density.
- **Effort:** ★★★ (glass depth is the most craft-heavy, highest payoff).

---

## D4 — "Mission Control / Cinema Grade"  ·  *pro film-suite HUD, dense, authoritative*
**One-liner:** DaVinci-Resolve-meets-spacecraft: charcoal panels, precise hairlines, amber+cyan
instrumentation, data-dense and unmistakably *professional*.

- **Accent (primary):** instrument amber `#ffb454` · secondary readout cyan `#41d0e0`
- **AI accent:** cyan `#41d0e0` (so AI = the "cool" data channel, brand = warm amber)
- **Surface stack:** Base `#0c0d0f` → Raised `#16181c` → Card `#1e2126` (true charcoal, slight blue)
- **Text:** `#e8eaed` / muted `#9aa0a6` / faint `#5f6368`
- **Hairline:** `rgba(255,255,255,0.08)` + amber `rgba(255,180,84,0.25)` on active frames
- **Node colors → signal-coded (intentional):** keep distinct hues but normalize to one
  saturation/luminance band so they read as a *designed* signal legend, each with a small
  swatch+label in a legend key. tracker `#ff9f45`, reveal `#e05b9c`, anamorphic `#41d0e0`,
  analog `#5a9ff0`, bokeh `#b06ce0`, in `#3ddc84`, out `#ffb454`.
- **Type:** mono-forward — **JetBrains Mono** does more work; display in a condensed grotesque
  (**Barlow Condensed**, already used in the effect iframes → unifies shell + effects!).
- **Shape:** sharper `rounded-md` (4–6px), framed panels, visible measurement ticks/scales.
- **Texture:** flat matte, crisp; optional faint scanline on the stage/canvas only.
- **Motion:** snappy, functional; live meters, blinking record dots, sweeping scan lines.
- **Best if:** you want it to look like a *serious tool* pros would pay for; embraces density.
- **Effort:** ★★☆ (mostly palette + type + tightening radii; unifies with the iframes).

---

## D5 — "Neo-Brutalist Studio"  ·  *bold, graphic, confident, memorable*
**One-liner:** high-contrast, big type, flat blocks of color, thick frames — a design-forward
"creative studio" look that photographs well and feels art-directed.

- **Accent:** acid gold `#ffd23f` + one hot pop `#ff5c5c` (used sparingly for primary actions)
- **AI accent:** electric violet `#8b5cf6`
- **Surface stack:** Base `#0d0d0d` → Raised `#181818` → Card `#212121`; OR invert to a bright
  bone `#f2efe6` day-first variant with black frames.
- **Text:** `#f5f2ea` / muted `#a8a49a`
- **Hairline → frames:** 1.5–2px solid borders, occasional 3px accent frame; hard offset shadows.
- **Node colors → bold flat blocks:** keep them saturated and *own* it; each node is a solid
  color chip with black label — the rainbow becomes a feature, not a bug.
- **Type:** oversized **Space Grotesk** headlines, tight; labels in mono, some in bold caps.
- **Shape:** mixed radii, some sharp; big touch targets; visible grid.
- **Texture:** flat, graphic, poster-like; maybe a halftone/grain accent.
- **Motion:** punchy, snappy transforms; hover = hard shift + shadow.
- **Best if:** you want the app to look *distinctive and brand-y*, not like every dark SaaS tool.
- **Effort:** ★★☆ (a real point of view; needs taste but not much plumbing).

---

## D6 — "Deep Space Luxe" (Nebula)  ·  *the tagline made literal — awe + premium*
**One-liner:** the "deep-space obsidian" promise fully delivered — a living nebula backdrop,
starfield depth, jewel-gold constellation; cinematic wonder with luxury restraint.

- **Accent:** star-gold `#f0c96b` with a cosmic violet companion `#9b6bff`
- **AI accent:** the cosmic violet `#9b6bff`
- **Surface stack (over nebula):** Base = animated nebula (deep indigo `#070512` → black),
  Raised `rgba(18,16,30,0.6)` glass, Card `rgba(28,24,44,0.65)` glass
- **Text:** `#f3f0ff` / muted `#a49dbd`
- **Hairline:** `rgba(240,201,107,0.16)`
- **Node colors → constellation jewels:** tuned gem tones on the violet/gold axis — tracker
  `#f0c96b`, reveal `#e07bb8`, anamorphic `#6bd6e0`, analog `#7b9bff`, bokeh `#b98cff`,
  in `#5fe0a8`, out `#f0c96b`; each with a soft star-glow.
- **Type:** elegant — Space Grotesk display, Inter UI, JetBrains Mono telemetry; airy tracking.
- **Shape:** soft `rounded-2xl` glass; luminous accent edges.
- **Texture:** **the star of the show** — real radial nebula, parallax starfield, faint grain,
  the constellation graph floating in actual depth (finally fulfilling `space-vignette`).
- **Motion:** slow-drifting nebula, twinkling stars, the existing heartbeat pulse amplified.
- **Best if:** you want *wonder* + luxury and love the constellation concept as the soul of the app.
- **Effort:** ★★★ (the animated backdrop is the craft; the rest is palette).

---

## Quick comparison

| | Vibe | Accent | Surfaces | Node colors | Off-brand risk | Effort |
|--|------|--------|----------|-------------|----------------|--------|
| **D1** Obsidian Refined | current, finished | gold | matte greys | warm metals | none | ★☆☆ |
| **D2** Liquid Chrome/Aurora | cool futuristic | teal/violet | blue-glass | cool jewels | leaves gold | ★★☆ |
| **D3** Liquid Obsidian | Apple-glass luxe | single champagne/ice | dark glass | mono+accent | leaves rainbow | ★★★ |
| **D4** Mission Control | pro film HUD | amber+cyan | charcoal | signal legend | none (unifies iframes) | ★★☆ |
| **D5** Neo-Brutalist | bold studio | acid gold+pop | flat blocks | bold & owned | loud | ★★☆ |
| **D6** Deep Space Luxe | cosmic wonder | gold+violet | nebula glass | constellation jewels | none | ★★★ |

**My pick if you want the biggest "premium jump" for the effort:** **D1** for a safe, fast,
unmistakable upgrade; **D3** or **D6** if you're ready for a flagship, screenshot-worthy identity.
**D4** if "looks like a serious pro tool" matters most (bonus: it unifies the shell with the
effect iframes). Tell me the letter and I'll turn it into tokens + a restyle.
