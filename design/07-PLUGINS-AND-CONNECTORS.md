# 07 — Plugins & Connectors for Design (what's actually available)

> You asked: *"capire come attraverso plug-in o connettori puoi modificare il design dell'app."*
> Here's the honest, grounded answer — based on what is **actually connected to your account**
> and this environment, not hypotheticals. Bottom line: the single most useful thing here is
> that **you already have Figma**, and Figma is a *far better* design "connector" than an
> AI-generated image, because it hands me **exact tokens**, not a picture to guess from.

---

## 1. How I "modify the design" — the mechanism (important to understand)

I don't need a plugin to restyle the app. I change the design by **editing code**: the
`--syn-*` token block in `src/index.css` and the Tailwind classes in the components (see
`06-COMPONENT-STYLE-MAP.md`). Plugins/connectors don't *do* the restyle — they **feed me a
better spec** or let me **verify the result**. So think of them in two buckets:

- **INPUT connectors** — give me an exact target (tokens, specs, mood): *Figma* (best),
  *higgsfield* (AI images/video, mood only).
- **VERIFICATION tools** — let me see the real result and iterate: *Playwright/Chromium*
  (real screenshots of the running app), *Artifacts* (hosted live HTML previews).

---

## 2. What you actually have right now (checked this session)

| Thing | Type | Status in this chat | Useful for design? |
|-------|------|---------------------|--------------------|
| **Figma** | claude.ai **plugin** | **enabled** | ★★★ the highest-fidelity design input available to you |
| **Figma** | MCP **connector** ("get design context / variables / screenshot") | in the registry, **not installed** yet | ★★★ same, exposes token-extraction tools once connected |
| **higgsfield** | MCP connector (AI image/video gen) | installed at org, **toggled OFF in this chat** | ★★ mood boards / reference frames only |
| **Playwright + Chromium** | built into this environment | available | ★★★ real "before/after" screenshots + visual QA loop |
| **Artifacts** | built-in (hosted HTML) | available | ★★ live, shareable design previews of a concept |
| skill-creator, xlsx, pptx, pdf, docx | claude.ai skills | enabled | ✗ not design-relevant here |

---

## 3. Figma — your best "connector" (and why it beats the AI-image method)

The Figma MCP exposes tools like **`get_variable_defs`** (exact design variables/tokens),
**`get_design_context`**, **`get_screenshot`**, **`get_metadata`**, and
**`create_design_system_rules`**. That means, if the target look lives in a Figma file, I can
pull **exact hex, spacing, radii, type, and component structure** — instead of eyeballing them
off a raster image. This is the *lossless* path the reference-image guide (`04`) is pointing at.

**Three ways to use Figma for this project, ranked:**

1. **Design (or grab) the target in Figma, then let me extract it.** Mock the premium version
   of a couple key screens in Figma — OR duplicate a high-end **Figma Community** UI template
   whose vibe you love — define its colors/type as **Figma variables**, then point me at the
   file. I run `get_variable_defs` + `get_design_context` and translate them straight into the
   `--syn-*` tokens. **Highest fidelity possible. No guessing.**
2. **Use Figma only for the palette/type.** Even without a full mockup, a Figma file with your
   chosen colors + type as variables gives me an exact token set to implement.
3. **Screenshot-from-Figma as a sharper mood board.** `get_screenshot` of a frame is still a
   cleaner reference than a hallucinated AI image (it's real, consistent UI).

**To enable it tomorrow:** in this chat's connector settings, connect/enable the **Figma** MCP
(the plugin is already on; the MCP tools need to be toggled on in-chat), have the target Figma
file open, and share the file/frame link. Then in your kickoff prompt add:
*"Pull the tokens from my Figma file <link> via the Figma tools and map them into `--syn-*`."*

> Reality check: this only helps if a Figma file with the target design (or at least its
> palette/type as variables) exists. If you don't want to touch Figma, the **token-first**
> method with the ready palettes in `design/tokens/` (next file) gets you 90% there with zero
> Figma work. Figma is the "perfectionist" upgrade, not a requirement.

---

## 4. higgsfield — AI image/video (mood only)

`higgsfield` is an AI **image/video generation** connector (installed at your org, but
currently toggled **off** in-chat). It can produce reference frames or motion studies — useful
for *mood/direction*, but it carries the exact same limitation as any generated image
(`04-REFERENCE-IMAGE-GUIDE.md`): great for feel, useless for exact values. If you enable it,
treat its output as a **mood board**, pair it with a token direction, and (nice bonus) it can
help you visualize the **motion** feel (nebula drift, glow) that a still image can't.

To use it: enable higgsfield in this chat's connector settings, then ask for reference frames
with a prompt like the recipe in `04` §3.1.

---

## 5. What I'll use with zero setup: real screenshots + live previews

- **Playwright/Chromium** is preinstalled here. I can run the app (`npm run dev`) and capture
  **real screenshots of your actual UI** — the genuine "before" baseline, and, after a restyle,
  the real "after". These real frames are the best possible input for the Gemini analysis kit
  and for our own iteration (better than any generated image). *(I'm attempting this tonight —
  see `design/reference/` if it succeeded.)*
- **Artifacts** — I can publish a self-contained HTML mockup of a proposed direction to a live
  URL you can open and react to, before touching the real code. Good for a fast "do you like
  this vibe?" check.

---

## 6. Recommended connector strategy (decision)

- **Do first, no tools needed:** token-first restyle using `design/tokens/` + your brief. This
  alone gets a premium result.
- **If you want maximum precision:** put the target palette/type (or a full mockup) in **Figma**
  as variables and let me extract them via the Figma connector → exact tokens, zero guessing.
- **For mood/motion inspiration only:** higgsfield or your own AI images — as mood boards.
- **Always, for verification:** I screenshot the **real running app** and we iterate on real
  pixels.

So: the "connector that changes the design" you were reaching for is **Figma** (token
extraction) — and you already have it. The AI-image connector (higgsfield) is the *weaker*
input. Everything still routes through the same lever: the `--syn-*` tokens.
