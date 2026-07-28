import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { paintStone, Rect, Section } from '../lib/stoneMontage';
import { PANEL_CLIPS } from '../lib/panelClips';

/* ═══════════════════════════════════════════════════════════════════════════
   THE STONE — the 3D rock that divides the sections, laid OVER them.

   Operator, 2026-07-27: "i pannelli sono buchi erosi, non rettangoli appoggiati
   sopra adesso, io vorrei che i pannelli fossero come prima, ma che la forma
   gliela dia la roccia come se fosse sopra ai pannelli e li coprisse dando questo
   aspetto visto che non è regolare, non devono essere i pannelli con forme non
   regolari."

   That is the whole design, and it is the opposite of the pass before it:

   - The SECTIONS STAY RECTANGULAR. Nothing deforms them, nothing masks them.
     They are the same panels as always.
   - The ROCK sits on top and covers their edges. Because the rock's own
     silhouette is irregular — clusters of beads that spill and thin out — the
     panels LOOK irregular without being irregular.

   So the erosion mask that used to shape the holes (feTurbulence +
   feDisplacementMap) is gone: it made the panels wavy, which is exactly what was
   wrong. The irregularity now comes from the montage itself (stoneMontage.ts),
   which cuts pieces out of the operator's artwork and stamps them along every
   division, as the reference is built.

   What this component owns is only the geometry: where the sections are, and how
   to get the painted rock on screen cheaply.

   1. Sections announce themselves with `data-crust`. Their rects are measured
      live and re-measured by a ResizeObserver, so the rock follows panel drags
      and window resizes.

   2. The rock is painted ONCE into an offscreen canvas per geometry, handed to
      the page as a Blob URL, and shown through STRIPS that cover only the
      divisions — never one full-viewport sheet. An overlay above the hero's
      canvas has to be blended over it every frame, and AudioEngine's beat
      detector reads spectral flux BETWEEN frames, so anything expensive up here
      reads back as a faster tempo. With strips, no rock layer touches the middle
      of the hero at all. (Honest note: the sandbox cannot resolve the difference
      — phase 3's BPM under SwiftShader gave 120/144/129 across three runs with NO
      overlay at all — so treat this as cheap insurance, not a measured win.)
   ═══════════════════════════════════════════════════════════════════════════ */

/** how far the rock reaches past a section's edge; the strips must cover it */
const REACH = 46;

/**
 * The viewport minus the sections' untouched middles, cut into as few rectangles
 * as possible: a scanline over every distinct row boundary, keeping the
 * x-intervals no section spans, then merging rows that line up.
 */
function skeletonStrips(vw: number, vh: number, holes: Section[]): Rect[] {
  const cores = holes
    .map(({ rect: h }) => ({ x: h.x + REACH, y: h.y + REACH, w: h.w - REACH * 2, h: h.h - REACH * 2 }))
    .filter((h) => h.w > 0 && h.h > 0);

  const rows = [...new Set([0, vh, ...cores.flatMap((c) => [c.y, c.y + c.h])])]
    .filter((y) => y >= 0 && y <= vh)
    .sort((a, b) => a - b);

  const out: Rect[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const y = rows[i], y1 = rows[i + 1];
    if (y1 - y < 0.5) continue;
    const spans = cores
      .filter((c) => c.y <= y + 0.5 && c.y + c.h >= y1 - 0.5)
      .map((c) => [c.x, c.x + c.w] as const)
      .sort((a, b) => a[0] - b[0]);
    let x = 0;
    for (const [a, b] of spans) {
      if (a > x) out.push({ x, y, w: a - x, h: y1 - y });
      x = Math.max(x, b);
    }
    if (x < vw) out.push({ x, y, w: vw - x, h: y1 - y });
  }

  const merged: Rect[] = [];
  for (const s of out) {
    const prev = merged.find((m) => m.x === s.x && m.w === s.w && Math.abs(m.y + m.h - s.y) < 0.5);
    if (prev) prev.h += s.h; else merged.push({ ...s });
  }
  return merged;
}

/**
 * @param layoutKey changes whenever the SET of sections on screen changes, which
 *   re-runs the measurement pass and re-attaches the observers.
 */
export default function GelCrust({ layoutKey }: { layoutKey: string }) {
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const [holes, setHoles] = useState<Section[]>([]);
  const [art, setArt] = useState<CanvasImageSource | null>(null);
  const [stone, setStone] = useState<string>('');
  // last measurement, serialised: the observers fire on every layout pass, and
  // re-painting the montage is not free, so only real changes get through
  const sig = useRef('');

  // the artwork, decoded once — the montage cuts its pieces out of this
  useEffect(() => {
    let live = true;
    const im = new Image();
    im.src = '/assets/bg-texture.jpg';
    im.decode().then(() => { if (live) setArt(im); }).catch(() => { /* leave the rock unpainted */ });
    return () => { live = false; };
  }, []);

  useLayoutEffect(() => {
    let raf = 0;
    const measure = () => {
      raf = 0;
      const els = Array.from(document.querySelectorAll<HTMLElement>('[data-crust]'));
      const next: Section[] = els.map((el) => {
        const r = el.getBoundingClientRect();
        const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
        // a section clipped to one of the operator's traced curves hands the rock
        // that same curve, in viewport pixels, so ridge and clip edge coincide
        const clip = el.dataset.clip ? PANEL_CLIPS[el.dataset.clip] : undefined;
        const pts = clip?.poly.map(([nx, ny]) => [rect.x + nx * rect.w, rect.y + ny * rect.h] as [number, number]);
        return { rect, pts };
      });
      const w = window.innerWidth, h = window.innerHeight;
      const key = `${w}x${h}|${next.map(({ rect: r }) => `${r.x},${r.y},${r.w},${r.h}`).join(';')}`;
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

  // montage the rock for this geometry, and hand it over as a Blob URL —
  // toDataURL on a viewport-sized canvas is megabytes of base64 for nothing
  useEffect(() => {
    if (!art || !vp.w || !vp.h || holes.length === 0) return;
    let url = '';
    const cv = paintStone(art, vp.w, vp.h, holes);
    cv.toBlob((blob) => {
      if (!blob) return;
      url = URL.createObjectURL(blob);
      setStone(url);
    }, 'image/png');
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [art, vp.w, vp.h, holes]);

  if (!stone || !vp.w) return null;

  /* Every strip shows the SAME montage, offset to its own place on screen, so the
     rock runs continuously across strip boundaries — there is nothing to seam. */
  return (
    <div className="syn-gel-crust-root" data-testid="bg-layer" aria-hidden>
      {skeletonStrips(vp.w, vp.h, holes).map((s, i) => (
        <div
          key={i}
          className="syn-gel-crust"
          data-testid={i === 0 ? 'bg-relief' : undefined}
          style={{
            left: s.x,
            top: s.y,
            width: s.w,
            height: s.h,
            backgroundImage: `url(${stone})`,
            backgroundPosition: `${-s.x}px ${-s.y}px`,
          }}
        />
      ))}
    </div>
  );
}
