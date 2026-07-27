import { useLayoutEffect, useRef, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   THE CRUST — the operator's gel artwork DIVIDING the sections, not sitting
   behind them (operator direction, 2026-07-27: "vorrei che la texture non fosse
   sotto alle sezioni ma che le dividesse").

   The artwork used to be a full-bleed backdrop with the panels laid on top as
   rounded rectangles, so every division between sections was a machined 16px
   straight line. Here the same artwork is drawn ON TOP of the panels instead,
   masked down to the skeleton between them: the frame plus every gap, with the
   section rectangles punched out as holes whose edges are pushed around by
   fractal noise. What is left reads as irregular rock, and the sections read as
   holes eroded through it.

   Three things worth keeping:

   1. ONE layer for the whole screen. Per-panel masks would mean one filter
      raster per panel and a texture that restarts at every border; the material
      has to be continuous to read as a single slab, so it is one SVG whose image
      is stretched exactly like the old backdrop was.

   2. The noise pushes the holes BOTH ways — a few px into the section, a few px
      out into the gap — which is what makes the rock look eaten rather than
      merely wavy. That only works because the sections drop their hairline
      border in night mode: with a border, every outward bulge would frame a
      rectangle floating inside an irregular hole and the illusion would die.
      What bounds the inward bite is the sections' own padding, so `erode` stays
      well under it.

   3. It is painted as STRIPS covering only the skeleton (~32% of the viewport),
      never as one full-viewport sheet, and nothing here animates. This serves the
      frame-cost contract: an overlay above the hero's canvas has to be blended
      over it every frame, and AudioEngine's beat detector reads spectral flux
      BETWEEN frames, so anything expensive up here reads back as a faster tempo.
      With strips, no crust layer overlaps the canvas at all — by construction.

      Honest note on the evidence: this was NOT measured as a fix, because the
      sandbox cannot resolve it. Phase 3's BPM estimate under SwiftShader is far
      too noisy — three runs with NO crust at all gave 120 / 144 / 129, and the
      crust (as one sheet or as strips) lands in the same band. Treat the strips
      as cheap insurance, and the ≥30fps pass on a real GPU as the real check.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Two erosion strengths, because one does not fit both. A ±5px bite out of the
   hero is texture; the same bite out of a 48px top bar is a third of the bar, and
   its text starts colliding with the rock. So sections are sorted by their short
   side: the broad ones get the full chew, the slim ones (top bar, icon rail) get a
   gentle one. Each group is its own <g filter>, so this costs no extra passes.
   `inset` is small and `erode` is large, so the edge lands on both sides of the
   section boundary — see note 2 at the top of this file. */
const BROAD = { minSide: 140, inset: 5, erode: 16 };
const SLIM = { minSide: 0, inset: 2, erode: 8 };
/** corner radius of a hole — generous, so the noise has round stock to chew on */
const HOLE_RADIUS = 22;
/** the artwork is bled out past the viewport so its own black field falls off
 *  screen and its crusted border lands just inside the frame (measured: the
 *  field is 8.42% left/right, 7.61/7.47% top/bottom of the source image) */
const BLEED = 0.095;
/** how far inside a section the crust can still reach (inset + erode/2, rounded up).
 *  The strips are laid out to cover exactly this much and no more. */
const REACH = 16;

interface Hole { x: number; y: number; w: number; h: number }

/**
 * The viewport minus the sections' untouched interiors, cut into as few
 * rectangles as possible: a scanline over every distinct row boundary, keeping
 * the x-intervals no section spans, then merging rows that line up.
 *
 * This is what keeps the crust off the hero's canvas — see note 3 above.
 */
function skeletonStrips(vw: number, vh: number, holes: Hole[]): Hole[] {
  const cores = holes
    .map((h) => ({ x: h.x + REACH, y: h.y + REACH, w: h.w - REACH * 2, h: h.h - REACH * 2 }))
    .filter((h) => h.w > 0 && h.h > 0);

  const rows = [...new Set([0, vh, ...cores.flatMap((c) => [c.y, c.y + c.h])])]
    .filter((y) => y >= 0 && y <= vh)
    .sort((a, b) => a - b);

  const out: Hole[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const y0 = rows[i], y1 = rows[i + 1];
    if (y1 - y0 < 0.5) continue;
    const spans = cores
      .filter((c) => c.y <= y0 + 0.5 && c.y + c.h >= y1 - 0.5)
      .map((c) => [c.x, c.x + c.w] as const)
      .sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of spans) {
      if (a > x) out.push({ x, y: y0, w: a - x, h: y1 - y0 });
      x = Math.max(x, b);
    }
    if (x < vw) out.push({ x, y: y0, w: vw - x, h: y1 - y0 });
  }

  // merge strips stacked directly on top of each other with the same x-extent
  const merged: Hole[] = [];
  for (const s of out) {
    const prev = merged.find((m) => m.x === s.x && m.w === s.w && Math.abs(m.y + m.h - s.y) < 0.5);
    if (prev) prev.h += s.h; else merged.push({ ...s });
  }
  return merged;
}

/**
 * @param layoutKey changes whenever the SET of sections on screen changes, which
 *   re-runs the measurement pass and re-attaches the observers. Size changes
 *   (dragging a resize handle, resizing the window) are picked up by the
 *   ResizeObserver without touching this.
 */
export default function GelCrust({ layoutKey }: { layoutKey: string }) {
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [holes, setHoles] = useState<Hole[]>([]);
  // last measurement, serialised: the observers fire on every layout pass, and
  // re-rendering the SVG re-runs the displacement filter, so only real changes
  // are allowed through
  const sig = useRef('');

  useLayoutEffect(() => {
    let raf = 0;

    const measure = () => {
      raf = 0;
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-crust]'));
      const next = els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const w = window.innerWidth, h = window.innerHeight;
      const key = `${w}x${h}|${next.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join(';')}`;
      if (key === sig.current) return;
      sig.current = key;
      setVp({ w, h });
      setHoles(next);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };

    measure();
    const ro = new ResizeObserver(schedule);
    ro.observe(document.documentElement);
    document.querySelectorAll('[data-crust]').forEach((el) => ro.observe(el));
    window.addEventListener('resize', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [layoutKey]);

  if (!vp.w || !vp.h || holes.length === 0) return null;

  const bx = -BLEED * vp.w, by = -BLEED * vp.h;
  const bw = vp.w * (1 + 2 * BLEED), bh = vp.h * (1 + 2 * BLEED);
  const strips = skeletonStrips(vp.w, vp.h, holes);

  /* Every strip carries the SAME artwork and the SAME mask, both authored in page
     coordinates (`viewBox` = the strip's own page rect), so the material and the
     noise run continuously across strip boundaries — the seams are invisible
     because there is nothing to seam. The defs live once, in the first element. */
  const paint = (
    <image
      href="/assets/bg-texture.jpg"
      x={bx}
      y={by}
      width={bw}
      height={bh}
      preserveAspectRatio="none"
      mask="url(#syn-crust-mask)"
    />
  );

  return (
    <>
    <svg
      className="syn-gel-crust syn-gel-crust-defs"
      data-testid="bg-layer"
      aria-hidden
      width="0"
      height="0"
    >
      <defs>
        {[BROAD, SLIM].map((g, gi) => (
          /* low frequency = long lumps rather than a fuzzy edge; the octaves add
             the fine chipping on top of them */
          <filter key={gi} id={`syn-crust-erode-${gi}`} x="-8%" y="-8%" width="116%" height="116%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="3" seed={11 + gi * 5} result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale={g.erode} xChannelSelector="R" yChannelSelector="G" />
          </filter>
        ))}
        <mask id="syn-crust-mask" maskUnits="userSpaceOnUse" x="0" y="0" width={vp.w} height={vp.h}>
          {/* white = the artwork shows; the holes below punch the sections out */}
          <rect x="0" y="0" width={vp.w} height={vp.h} fill="#fff" />
          {[BROAD, SLIM].map((g, gi) => (
            <g key={gi} filter={`url(#syn-crust-erode-${gi})`}>
              {holes
                .filter((h) => (Math.min(h.w, h.h) >= BROAD.minSide) === (gi === 0))
                .map((h, i) => (
                  <rect
                    key={i}
                    x={h.x + g.inset}
                    y={h.y + g.inset}
                    width={Math.max(0, h.w - g.inset * 2)}
                    height={Math.max(0, h.h - g.inset * 2)}
                    rx={HOLE_RADIUS}
                    fill="#000"
                  />
                ))}
            </g>
          ))}
        </mask>
      </defs>
    </svg>
    {strips.map((s, i) => (
      <svg
        key={i}
        className="syn-gel-crust"
        aria-hidden
        data-testid={i === 0 ? 'bg-relief' : undefined}
        style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
        viewBox={`${s.x} ${s.y} ${s.w} ${s.h}`}
        preserveAspectRatio="none"
      >
        {paint}
      </svg>
    ))}
    </>
  );
}
