# HANDOFF — "the cage": re-adapting the UI to the operator's artwork

> Written 2026-07-31 to hand this work to a fresh session. Read it together with
> `STATE.md` and `CODEX_WORKFLOW.md`. **Everything below is at PREVIEW stage: not
> one line of app code has been changed yet, and that is deliberate.**

## 1. Where this stands, in one paragraph

The operator delivered an artwork — a bubble/nebula **cage** with irregular
openings — and asked that the app be re-adapted to live inside it, keeping every
feature, with the coloured "LED" gel between the sections gone. Over ten rounds of
preview they refined it down to the state in
`docs/design/frame/preview-approved-day.webp` and `preview-approved-night.webp`.
Each round was a composite: the running app, its sections positioned into the
cage's openings, with the keyed cage laid over the screenshot. **The app itself was
never modified** — the only code touched was a temporary patch to `VfxCanvas.tsx`
for photographing the graph, reverted every time (`git status` is clean).

**The operator has not yet said "vai".** The last message was another round of
corrections, all applied and delivered. Do not start implementing until they
approve — `CODEX_WORKFLOW.md` is explicit, and the 2026-07-28 revert happened
precisely because someone implemented before a direction was approved.

## 2. The accumulated spec

Every direction the operator gave, with how it was resolved. This is the
specification to build against.

### The cage
1. **The artwork is the chrome.** It divides the sections; the coloured gel slab
   between them is gone. The artwork itself is **never** retouched — *"la cornice
   non deve essere toccata"*.
2. **It stretches to fill any window, no black bands** (their answer to the aspect
   question). Its own ratio is 1.679:1; sections are positioned in **fractions of
   the viewport**, so they track the stretch with no JS.
3. **A hairline contour follows the perimeter of every opening**, so the cage does
   not dissolve against a light background. It must be **soft, not jagged** —
   see trap §4.1.
4. **Colour grade on the cage**: exposure +8%, contrast +12% (pivot mid-grey),
   **vibrance** +30% — vibrance, not saturation: the gain is weighted by
   `(1 - saturation)`, so pale blues and greys lift while the loaded reds and golds
   barely move and never clip. Baked into the keyed PNG by `build-frame.cjs`.

### Which opening holds what
5. Top slot → top bar. It is **split in two by a bridge of material**: left group
   (`SYSTEM ONLINE` + theme toggle) and the wordmark on the left, `SESSION` + clock
   on the right.
6. Tall left slot → the icon rail. The **small opening under it** → the audio meter,
   which leaves the rail's flow and is **centred in that opening** (measured: pair
   centre 104.5 vs opening centre 105.6).
7. Big rounded opening → hero. Right opening → systems column. Two bottom openings
   → node panel and Gemini panel.
8. **Bottom-right corner → the raw-video reference.** The clip plays there without
   effects, as a permanent A/B against the processed hero. One plane behind the
   cage; the cage itself masks it into the corner's shapes. **Empty = the theme's
   surface, never a placeholder image.**

### Day / night
9. **Night is the classic look**: every surface black. The bed behind the cage is
   black too, so nothing outlines the sections.
10. **Day**: the bed stays **black**, and each opening that hosts a panel gets its
    own **warm ivory** (`#fbfaf7`) backdrop behind the cage. That way the panel's
    surface fills its whole organic hole (no black rim around each section — the
    operator rejected that) while **empty openings stay black**, as at night.
11. **Exception**: the low strip of the bottom-right corner (the video area) **does**
    light up by day. The two shapes above it stay black.
12. Day mode also needs: the hero's `bg-gradient-to-br` scrim **off** (see trap §4.2),
    the hero strapline darkened, and the effect covers **keyed** (black → transparent)
    so they don't read as five black rectangles on a light card.

### The brain graph
13. Moved **right** (centre at 0.60 of the width).
14. **Unselected clusters: violet only**, eight shades from deep to pale, each node
    with its own opacity — *"tutte diverse, ma simili"*.
15. **The selected cluster: gold AND violet mixed**, several tones of each.
16. **White is reserved** for the core and the selected module. Already shipped and
    guarded by `verify-graph-highlight.js`.

### Panels
17. Effect names in the **same grey as the left rail's labels** — read the computed
    colour off the rail, do not guess it.
18. The systems list **scrolls** and **fades at both ends** into the cage, so a
    sixth effect dissolves under the material instead of being cut by a black line.
19. Gemini's `STANDBY` badge goes **grey**, like the node panel's. (There is a real
    bug there to fix: `bg-[#8b5cf6]/80/70` in `AiDirector.tsx:79` is a malformed
    class.) Both panels keep the green `ACTIVE`.
20. `LIVE STREAMING` → **`SYSTEM ONLINE`**. "created by state" **centred under** the
    wordmark (keep the block's `items-center`; do not force `flex-end`).
21. The Gemini card must **size to its content** (`h-full` off, tighter padding), or
    it clips `SELECT A MODULE`.
22. The rail's spacing tightens once the meter leaves it — otherwise AI LAB and
    GEMINI PRO collide. The divider **above GEMINI PRO stays**; only the one below
    OPTIMIZER goes, along with the dB dashes and the AUDIO caption.

## 3. The geometry, and how it was measured

Nothing here was eyeballed. `tools/frame/build-frame.cjs`:

1. **Flood-fills the artwork's dark regions** → the openings. The outer rim
   flood-fills as one region touching all four edges; it is keyed too, but a
   **14px RIM** near the image border is kept so the cage keeps its dark outline.
   (Before that, the bottom-right corner could never be lit — it was opaque black
   material, not an opening. See trap §4.4.)
2. **Blurs that mask (3px) and reads the ramp** — alpha follows `1 - m`, and the
   contour is painted where the ramp crosses the middle. Antialiased, follows the
   organic curve.
3. **Fits a rectangle to each opening**: start at the bounding box, pull in only the
   edges that sit on material, **ignoring the corners** (the middle 84% of each edge
   is tested) because panels have their own 16px radius. The max-area inscribed
   rectangle was tried first and is the wrong objective — on a rounded opening it
   trades ~200px of width for a few px of height.
4. **Largest inscribed circle** where a circle is what's wanted.

Output: `tools/frame/holes.json` — `topbar`, `slotL/R`, `rail`, `railTop`, `meter`,
`hero`, `sidebar`, `nodes`, `gemini`, `boxes` (bounding boxes, for the day
backdrops), `videoBoxes`, `paletteCircle`. All fractions of the viewport.

## 4. Traps — every one of these cost real time

**4.1 A binary mask makes a jagged contour.** Eroding whole pixels and painting the
ring left a stair-stepped, razor-sharp line. Blur the mask and read the ramp instead.

**4.2 The hero's scrim is invisible on black and brutal on white.**
`bg-gradient-to-br from-black/70` (App.tsx) is what made the hero read as a grey
rectangle with hard edges in day mode. Off by day — and then the strapline, which
relies on it, must darken.

**4.3 A light bed against cream panels draws a halo.** Every part of an opening the
panel doesn't cover shows the bed. Bed and panel must be the same colour, or the
opening must get its own backdrop.

**4.4 Not every black area is an opening.** The artwork's outer rim is opaque black
material that flood-fills as one huge region. Any backdrop behind it is invisible.

**4.5 A rect that ends inside an opening shows as a straight cut** through the art.
Backdrop planes must end on material, where the cage hides them.

**4.6 Reporting must never gate output.** A `console.log` loop crashed three times
on a newly added key — and it ran **before** the writes, so `holes.json` and the
keyed PNG silently kept old contents while the change looked applied. Two rounds of
"the mask isn't working" were this. `build-frame.cjs` now prints defensively.

**4.7 The preview script reads the mask from disk.** For three rounds the generator
computed erosion and contour and never wrote the file. Symptom: measurable — zero
line pixels in an image where 32,703 had just been drawn. **Measure, don't squint.**

**4.8 Toggling day mode re-renders React** and throws away injected inline styles.
In the preview, toggle **before** positioning. In the implementation this vanishes,
because positions will be CSS.

**4.9 A collapsed flex box looks like a divider.** The sweep that removed the rail's
hairlines deleted the audio meter, whose `flex-1` box had collapsed to zero height.
Move an element out of the flow before filtering by size.

## 5. Open questions

- **Approval to implement.** Nothing else is blocking.
- The bottom-right corner's exact split (which sub-shapes light by day) was set by
  measurement against their red/blue annotations; re-check after the first build.
- Day-mode effect covers read pale on ivory — they are art made for black. If day
  mode becomes a mode they actually use, consider dedicated covers.

## 6. Implementation plan (not started)

One commit per area, per `CODEX_WORKFLOW.md`, pausing for review between areas:

1. **The cage** — artwork as a single layer, gel slab and LEDs removed, surface
   tokens to black. The frame-cost contract holds: one image, no blend modes, no
   filters, no animation.
2. **Geometry** — sections positioned from `holes.json` (generated, not hand-typed).
3. **Contents** — the adaptations in §2 (top bar split, meter, list fade, Gemini
   sizing, rail rhythm, labels).
4. **Themes** — day/night per §9–12.
5. **Graph** — §13–15, folding in `tools/frame/graph-preview-patch.py`.

### Verification — read this before running the suites

**`tools/verify/verify-ui-gel-pass.js` must be rewritten.** It asserts the gel slab
that this work removes — 41 assertions that would go red *by design*, not by
regression. Replace it with a geometric contract: every section inside its opening,
no spill, the cage a single unblended unfiltered layer, the contour present, and
the day/night bed rules of §9–11.

Keep green: `verify-phase10-covers.js` (16), `verify-graph-highlight.js` (7),
`verify-phase10-search.js` (6), `verify-phase10-brand.js` (13), phase 2 (26),
phase 3 (14, the BPM canary — the frame must not cost frames).

## 7. Running the tooling

```bash
npm run dev                                                    # :3000
NODE_PATH=/opt/node22/lib/node_modules node tools/frame/build-frame.cjs
python3 tools/frame/graph-preview-patch.py                     # graph look only
NODE_PATH=/opt/node22/lib/node_modules node tools/frame/preview-frame.cjs
git checkout src/components/VfxCanvas.tsx                      # ALWAYS
NODE_PATH=/opt/node22/lib/node_modules node tools/frame/check-zones.cjs
```

Outputs land in `tools/frame/out/` (gitignored). `check-zones.cjs` measures the
three zones the operator called out — the expected values are black, black, ivory.

Sources: `docs/design/frame/cage.webp` is their artwork, untouched;
`app-before.webp` is the app as it was; `holes-map.webp` shows the detected
openings; the two `preview-approved-*.webp` are the state they last saw.
