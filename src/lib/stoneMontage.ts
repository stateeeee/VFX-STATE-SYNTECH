/* ═══════════════════════════════════════════════════════════════════════════
   THE ALIEN STONE — the operator's artwork REWORKED into the bezel that
   delimits the sections (operator, 2026-07-27: "queste rocce colorate che
   delimitano le sezioni è una rielaborazione della texture. la texture ti serve
   per prendere dei pezzi e tu li devi montare come nella reference").

   So this is not the artwork shown through a hole — it is a montage. Pieces are
   cut from the beaded, crusted veins of the source piece and stamped along the
   outline of every section, rotated to follow the edge, so each division reads as
   a continuous ridge of clustered blue-and-white beads with red gem cabochons set
   into it and brass rivets at the outer corners. That is what the reference is
   made of, and it is why the earlier stretch-the-whole-photo pass could never
   match it: stretching lands whatever the artwork happens to hold at that spot —
   often a smooth membrane — while the reference is beaded crust EVERYWHERE.

   Two things worth keeping:

   1. The stamps carry their own soft alpha, so the ridge's silhouette comes from
      the beads themselves. There is no erosion mask any more: the previous pass
      shaped the edge with feTurbulence, which gave a wavy line, where the
      reference has clusters that spill and thin out. Real clusters beat noise.

   2. Everything is painted ONCE into a canvas, keyed on the section geometry.
      Per-frame cost is then whatever it costs to composite a static bitmap; see
      the note in GelCrust.tsx about why that matters to the beat detector.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Rect { x: number; y: number; w: number; h: number }

/* Source patches, in the 736² artwork's own coordinates. Picked off a coordinate
   grid of the piece (tools note: docs/design/textures/README.md) — every one of
   these is a stretch of the crusted bead vein, chosen for a different bead size
   and colour so the montage never reads as one repeated tile. */
const CRUST: Rect[] = [
  // Picked by measurement, not by eye: a sliding window over the piece scored for
  // small-scale edge energy (beads are busy) against saturation (beads are pale
  // and grey-blue), rejecting anything with the artwork's black field in it. These
  // are the top-scoring, non-overlapping windows — every one is dense bead vein.
  // The first attempt was hand-picked off a coordinate grid and landed mostly on
  // smooth membrane, which montaged into pastel mush.
  // the blue/teal veins are listed twice: an even pick across all of them came out
  // mauve-grey, where the reference ridge reads blue
  { x: 160, y: 192, w: 60, h: 112 },
  { x: 160, y: 192, w: 60, h: 112 },
  { x: 64, y: 224, w: 112, h: 60 },
  { x: 64, y: 224, w: 112, h: 60 },
  { x: 128, y: 64, w: 60, h: 112 },
  { x: 128, y: 64, w: 60, h: 112 },
  { x: 144, y: 256, w: 112, h: 60 },
  { x: 144, y: 256, w: 112, h: 60 },
  { x: 64, y: 112, w: 112, h: 60 },
  { x: 560, y: 448, w: 60, h: 112 },
  { x: 304, y: 272, w: 60, h: 112 },
  { x: 208, y: 192, w: 60, h: 112 },
  { x: 400, y: 432, w: 112, h: 60 },
  { x: 512, y: 480, w: 112, h: 60 },
  { x: 224, y: 272, w: 112, h: 60 },
];

/** red gem cabochons set into the ridge at intervals, as in the reference */
const GEMS: Rect[] = [
  { x: 278, y: 283, w: 42, h: 42 },
  { x: 520, y: 492, w: 40, h: 40 },
  { x: 196, y: 484, w: 40, h: 40 },
  { x: 556, y: 374, w: 40, h: 40 },
];

/** the brass rivets at the four corners of the slab */
const RIVETS: Rect[] = [
  { x: 644, y: 654, w: 24, h: 24 },
];

export interface StoneOptions {
  /** ridge thickness on a broad section */
  thick?: number;
  /** ridge thickness on a slim one (top bar, icon rail) — see GelCrust */
  thickSlim?: number;
  /** short side below which a section counts as slim */
  slimBelow?: number;
  /** outer bezel thickness */
  thickFrame?: number;
  /** deterministic: the same layout always montages identically */
  seed?: number;
}

/** points along a rounded-rect outline, with the tangent angle at each */
function outline(r: Rect, radius: number, step: number): Array<[number, number, number]> {
  const rad = Math.max(0, Math.min(radius, Math.min(r.w, r.h) / 2));
  const x0 = r.x + rad, x1 = r.x + r.w - rad;
  const y0 = r.y + rad, y1 = r.y + r.h - rad;
  const pts: Array<[number, number, number]> = [];

  const line = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const ang = Math.atan2(by - ay, bx - ax);
    for (let d = 0; d < len; d += step) pts.push([ax + (bx - ax) * (d / len), ay + (by - ay) * (d / len), ang]);
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const len = Math.abs(a1 - a0) * rad;
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, a + Math.PI / 2]);
    }
  };

  line(x0, r.y, x1, r.y);
  arc(x1, y0, -Math.PI / 2, 0);
  line(r.x + r.w, y0, r.x + r.w, y1);
  arc(x1, y1, 0, Math.PI / 2);
  line(x1, r.y + r.h, x0, r.y + r.h);
  arc(x0, y1, Math.PI / 2, Math.PI);
  line(r.x, y1, r.x, y0);
  arc(x0, y0, Math.PI, Math.PI * 1.5);
  return pts;
}

/**
 * Montage the bezel for one screen.
 *
 * @param img    the decoded artwork
 * @param vw/vh  viewport
 * @param holes  the sections, in viewport coordinates — a ridge is laid along each
 * @returns a canvas the size of the viewport, transparent except for the stone
 */
export function paintStone(
  img: CanvasImageSource,
  vw: number,
  vh: number,
  holes: Rect[],
  { thick = 30, thickSlim = 15, slimBelow = 140, thickFrame = 34, seed = 0x51a7e3 }: StoneOptions = {},
): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = vw; cv.height = vh;
  const cx = cv.getContext('2d')!;

  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  // one scratch canvas, reused: a stamp is the patch drawn into it and then
  // feathered to an ellipse, so the beads fade out instead of ending on a seam
  const tmp = document.createElement('canvas');
  const tc = tmp.getContext('2d')!;

  const stamp = (src: Rect, px: number, py: number, ang: number, thickness: number, alpha = 1) => {
    const scale = (thickness / src.h) * (1.02 + rnd() * 0.35);
    const w = Math.max(8, Math.round(src.w * scale));
    const h = Math.max(8, Math.round(src.h * scale));
    const flipX = rnd() < 0.5, flipY = rnd() < 0.5;
    tmp.width = w; tmp.height = h;
    tc.clearRect(0, 0, w, h);
    tc.save();
    // random flips so a repeated patch never reads as a repeat
    tc.translate(flipX ? w : 0, flipY ? h : 0);
    tc.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    tc.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, w, h);
    tc.restore();

    /* Feather ONLY the last fifth. Beads are a high-contrast material — lit crowns
       against near-black pits — and a wide feather over many overlapping stamps
       averages all of that into pastel mush (tried it; it looked like wet paper).
       Keep the middle fully opaque so the newest stamp wins outright. */
    tc.globalCompositeOperation = 'destination-in';
    tc.save();
    tc.translate(w / 2, h / 2);
    tc.scale(w / 2, h / 2);
    const fade = tc.createRadialGradient(0, 0, 0, 0, 0, 1);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.6, 'rgba(0,0,0,1)');
    fade.addColorStop(0.85, 'rgba(0,0,0,0.78)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    tc.fillStyle = fade;
    tc.fillRect(-1, -1, 2, 2);
    tc.restore();
    tc.globalCompositeOperation = 'source-over';

    cx.save();
    cx.translate(px, py);
    cx.rotate(ang);
    cx.globalAlpha = alpha;
    cx.drawImage(tmp, -w / 2, -h / 2);
    cx.restore();
  };

  /** lay a ridge of beads along a rounded-rect outline */
  const ridge = (r: Rect, radius: number, thickness: number, gemChance: number, biasPx: number) => {
    // ~0.62 of a patch length between stamps: enough overlap to hide every seam,
    // little enough that each stamp still shows its own beads
    const step = thickness * 0.62;
    const pts = outline(r, radius, step);
    pts.forEach(([px, py, ang], t) => {
      const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);

      /* Two slow waves plus jitter. Without the waves the ridge comes out as a
         band of even thickness with two near-straight sides — which is what the
         first montage did, and it read as a printed strip. The reference ridge
         swells and thins over 10–30 stamps at a time, so the silhouette has to
         carry a low-frequency term, not just per-stamp noise. */
      const wave = Math.sin(t * 0.21) * thickness * 0.12 + Math.sin(t * 0.079 + 1.3) * thickness * 0.1;
      /* Biased OUTWARD by an ABSOLUTE number of pixels, not a fraction of the
         ridge's own thickness: what the bias has to clear is half the layout gap
         between two sections, which has nothing to do with how fat the beads are.
         As a fraction it under-shot, both facing ridges sat astride their edges,
         and the two together ate ~100px — swallowing "Add Node" and the GEMINI PRO
         header. The reference spills about 10px onto each panel and no more. */
      const off = wave - biasPx + (rnd() - 0.5) * thickness * 0.26;
      // the ridge straddles the edge, spilling over the section — that spill is
      // what covers the panel's straight edge and makes a plain rectangle read as
      // an irregular hole
      // wide swing: the reference ridge runs from a thin neck to a fat bulge and
      // back, where an even thickness reads as knitted rope
      const swell = 0.7 + Math.pow(Math.abs(Math.sin(t * 0.11 + 0.7)), 0.7) * 0.3;
      stamp(pick(CRUST), px + nx * off, py + ny * off, ang + (rnd() - 0.5) * 0.55, thickness * swell);

      // loose clusters thrown clear of the ridge: the reference has beads sitting
      // on their own out on the black, and they are most of what sells it as rock
      // rather than as a border
      if (rnd() < 0.2) {
        // mostly thrown outward, into the gap; a quarter of them land on the panel,
        // which is what stops the edge reading as a drawn line
        const far = off + (rnd() < 0.25 ? 1 : -1) * thickness * (0.25 + rnd() * 0.5);
        const along = (rnd() - 0.5) * thickness;
        stamp(pick(CRUST),
          px + nx * far + Math.cos(ang) * along,
          py + ny * far + Math.sin(ang) * along,
          rnd() * Math.PI * 2, thickness * (0.22 + rnd() * 0.3), 0.92);
      }

      if (rnd() < gemChance) {
        stamp(pick(GEMS), px + nx * (off + (rnd() - 0.5) * thickness * 0.3), py + ny * (off + (rnd() - 0.5) * thickness * 0.3),
          rnd() * Math.PI * 2, thickness * (0.42 + rnd() * 0.22));
      }
    });
  };

  // 1. the outer bezel, hugging the viewport
  // leaning hard outward, so the bezel spills off screen instead of over the top
  // bar's text
  const inset = 16;
  ridge({ x: inset, y: inset, w: vw - inset * 2, h: vh - inset * 2 }, thickFrame * 0.9, thickFrame, 0.004, 10);

  // 2. a ridge around every section, thinner on the slim ones (a bite that is
  //    texture on the hero is a third of a 48px top bar)
  for (const h of holes) {
    const slim = Math.min(h.w, h.h) < slimBelow;
    // half the 28px layout gap, so the ridge fills it and leans only ~12px in
    ridge(h, slim ? 16 : 26, slim ? thickSlim : thick, slim ? 0.0015 : 0.005, slim ? 12 : 15);
  }

  // 3. the brass rivets, one per outer corner, as the slab has
  const c = thickFrame * 0.62;
  const corners: Array<[number, number]> = [[c, c], [vw - c, c], [c, vh - c], [vw - c, vh - c]];
  corners.forEach(([px, py]) => stamp(RIVETS[0], px, py, rnd() * Math.PI * 2, thickFrame * 0.5));

  return cv;
}
