/* Gel material texture for the background slab.
 *
 * Paints a seamless tile of the gel's surface ONCE on a canvas and returns it as a
 * data URL. The tile is TRANSPARENT with white crowns and black undersides, so
 * ordinary alpha compositing lightens and darkens the colour ramp beneath it and
 * the bubbles read as inflated, glossy 3D volumes: the swollen material of the
 * logo, at a density that still reads through a ~16px gap.
 *
 * Two decisions worth keeping:
 *
 * 1. A TILE, not one big field. The sections cover most of the slab and only the
 *    gaps between them show it, so the texture has to be dense; thousands of DOM or
 *    SVG beads would be wasteful, while a 640px tile is cheap and its repeat is
 *    invisible through narrow gaps. Beads that touch an edge are redrawn on the
 *    opposite side, so the tile wraps seamlessly.
 *
 * 2. ONE tile carrying EVERYTHING (swell, bubbles, gloss), and NO blend mode. Each
 *    blended layer stacked over the sliding ramp has to be re-composited every
 *    frame because what is beneath it moves; four of them — and even one, on a
 *    machine without a GPU — cost enough frames to skew AudioEngine's BPM estimate,
 *    since beat detection reads spectral flux BETWEEN frames. Baking the lot into a
 *    single alpha tile keeps the whole slab on the plain compositing path.
 */

export interface GelMaterialOptions {
  /** tile edge in px (also the CSS background-size) */
  size?: number;
  /** bubbles per tile — density is what makes it read in a narrow gap */
  count?: number;
  /** deterministic, so the material is identical on every reload */
  seed?: number;
  /** scales the beads' dark undersides. 1 is right over a large surface; the text
   *  variant needs less, because at letter scale one bead's shadow can cover a
   *  whole stroke and crush the brand violet (a mid-dark hue) toward black. */
  shade?: number;
}

export function gelMaterialTile({ size = 640, count = 300, seed = 0x5f3a7c1d, shade = 1 }: GelMaterialOptions = {}): string {
  if (typeof document === 'undefined') return '';
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const cx = cv.getContext('2d');
  if (!cx) return '';

  // transparent base: only the bubble lighting is painted, so the tile composites
  // over the ramp without needing a blend mode
  cx.clearRect(0, 0, size, size);

  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);

  /** run a draw op for the tile plus its wrapped copies, so the edges match */
  const wrapped = (x: number, y: number, reach: number, draw: (x: number, y: number) => void) => {
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        if (dx !== 0 && Math.abs(x + dx - size / 2) > size / 2 + reach) continue;
        if (dy !== 0 && Math.abs(y + dy - size / 2) > size / 2 + reach) continue;
        draw(x + dx, y + dy);
      }
    }
  };

  /** one bubble: shaded underside, lit crown, wet rim */
  const dome = (x: number, y: number, r: number, strength: number) => {
    const sh = cx.createRadialGradient(x + r * 0.24, y + r * 0.28, r * 0.05, x + r * 0.24, y + r * 0.28, r * 1.08);
    sh.addColorStop(0, `rgba(0,0,0,${0.58 * strength * shade})`);
    sh.addColorStop(0.55, `rgba(0,0,0,${0.26 * strength * shade})`);
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = sh;
    cx.beginPath(); cx.arc(x, y, r * 1.12, 0, Math.PI * 2); cx.fill();

    // the crown is a tight specular rather than a broad wash: a wide white haze
    // would bleach the ramp's colour instead of glazing it
    const hi = cx.createRadialGradient(x - r * 0.3, y - r * 0.34, r * 0.03, x - r * 0.3, y - r * 0.34, r * 0.9);
    hi.addColorStop(0, `rgba(255,255,255,${0.92 * strength})`);
    hi.addColorStop(0.2, `rgba(255,255,255,${0.34 * strength})`);
    hi.addColorStop(0.55, `rgba(255,255,255,${0.05 * strength})`);
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    cx.fillStyle = hi;
    cx.beginPath(); cx.arc(x, y, r, 0, Math.PI * 2); cx.fill();

    cx.strokeStyle = `rgba(255,255,255,${0.4 * strength})`;
    cx.lineWidth = Math.max(0.6, r * 0.07);
    cx.beginPath(); cx.arc(x, y, r * 0.94, 0, Math.PI * 2); cx.stroke();
  };

  // 1. macro swell — a few broad soft domes give the poured, inflated body
  for (let i = 0; i < Math.round(count * 0.12); i++) {
    const r = size * (0.08 + rnd() * 0.14);
    wrapped(rnd() * size, rnd() * size, r * 1.2, (px, py) => dome(px, py, r, 0.3 + rnd() * 0.2));
  }

  // 2. the bubbles — dense fine grain with a scatter of bigger beads
  for (let i = 0; i < count; i++) {
    const r = 2 + Math.pow(rnd(), 2.4) * 26;
    wrapped(rnd() * size, rnd() * size, r * 1.2, (px, py) => dome(px, py, r, 0.5 + rnd() * 0.5));
  }

  // 3. wet gloss — long soft smears across the material
  for (let i = 0; i < 4; i++) {
    const len = size * (0.5 + rnd() * 0.5);
    const th = size * (0.02 + rnd() * 0.03);
    const ang = rnd() * 0.5 - 0.25 + 0.35; // shallow diagonals
    wrapped(rnd() * size, rnd() * size, len, (px, py) => {
      cx.save();
      cx.translate(px, py);
      cx.rotate(ang);
      cx.scale(len, th);
      const g = cx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.10)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      cx.fillStyle = g;
      cx.beginPath(); cx.arc(0, 0, 1, 0, Math.PI * 2); cx.fill();
      cx.restore();
    });
  }

  return cv.toDataURL('image/png');
}
