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

/* Source patches, in the 736² artwork's own coordinates. */
const VEIN: Rect[] = [
  // Bead vein, picked by measurement: a sliding window scored for small-scale edge
  // energy (beads are busy) against saturation (beads are pale grey-blue), rejecting
  // any window holding the artwork's black field. Deliberately TIGHT windows — the
  // larger ones tried first swept in green and magenta membrane, and the ridge came
  // out mottled where the reference is silver-blue.
  { x: 160, y: 192, w: 60, h: 112 },
  { x: 64, y: 224, w: 112, h: 60 },
  { x: 128, y: 64, w: 60, h: 112 },
  { x: 400, y: 432, w: 112, h: 60 },
  { x: 144, y: 256, w: 112, h: 60 },
  { x: 64, y: 112, w: 112, h: 60 },
  { x: 512, y: 480, w: 112, h: 60 },
  { x: 224, y: 272, w: 112, h: 60 },
  { x: 112, y: 176, w: 60, h: 112 },
  { x: 560, y: 448, w: 60, h: 112 },
  { x: 304, y: 272, w: 60, h: 112 },
  { x: 208, y: 192, w: 60, h: 112 },
];

/** single clusters of the piece's LARGEST beads, for the sparse big cabochons */
const CABOCHON: Rect[] = [
  { x: 166, y: 292, w: 44, h: 44 },
  { x: 152, y: 330, w: 44, h: 44 },
  { x: 250, y: 250, w: 44, h: 44 },
  { x: 196, y: 238, w: 40, h: 40 },
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
  { thick = 30, thickSlim = 13, slimBelow = 140, thickFrame = 34, seed = 0x51a7e3 }: StoneOptions = {},
): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = vw; cv.height = vh;
  const cx = cv.getContext('2d')!;

  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  const tmp = document.createElement('canvas');
  const tc = tmp.getContext('2d')!;

  /**
   * One piece of vein, laid on the ridge.
   *
   * `band` and `zoom` are SEPARATE, and that separation is the whole point. The
   * first montage tied them together — the patch was scaled so its height became
   * the ridge width — which meant a 96px-tall window was squashed 3× to fit a 34px
   * ridge, and every bead in the piece came out at 3–6px. The material read as
   * gravel. Here the patch is drawn at its own scale (`zoom` ≈ 1 keeps the piece's
   * real bead size, 12–18px) and it is the ALPHA that is squeezed to `band`: an
   * ellipse as wide as the stamp but only as tall as the ridge. Big beads, narrow
   * ridge, which is what the reference has.
   */
  const stamp = (src: Rect, px: number, py: number, ang: number, band: number, zoom: number, alpha = 1) => {
    const w = Math.max(8, Math.round(src.w * zoom));
    const h = Math.max(8, Math.round(src.h * zoom));
    // Horizontal flips only. A vertical flip turns the piece's baked lighting
    // upside down, so specular crowns end up underneath the beads and the ridge
    // stops reading as one lit object — the single worst lighting error of the
    // previous pass.
    const flipX = rnd() < 0.5;
    tmp.width = w; tmp.height = h;
    tc.clearRect(0, 0, w, h);
    tc.save();
    tc.translate(flipX ? w : 0, 0);
    tc.scale(flipX ? -1 : 1, 1);
    tc.drawImage(img, src.x, src.y, src.w, src.h, 0, 0, w, h);
    tc.restore();

    tc.globalCompositeOperation = 'destination-in';
    tc.save();
    tc.translate(w / 2, h / 2);
    tc.scale(w / 2, Math.max(4, Math.min(h / 2, band * 0.62)));
    const fade = tc.createRadialGradient(0, 0, 0, 0, 0, 1);
    // opaque in the middle so the newest stamp wins outright; a wide feather over
    // many overlapping stamps averages the beads into pastel mush
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(0.55, 'rgba(0,0,0,1)');
    fade.addColorStop(0.84, 'rgba(0,0,0,0.72)');
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

  /** the dark bed the beads sit in: without it they float instead of nesting */
  const grout = (px: number, py: number, ang: number, band: number) => {
    cx.save();
    cx.translate(px, py);
    cx.rotate(ang);
    cx.scale(band * 1.1, band * 0.66);
    const g = cx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(5,9,20,0.92)');
    g.addColorStop(0.6, 'rgba(5,9,20,0.78)');
    g.addColorStop(1, 'rgba(5,9,20,0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(0, 0, 1, 0, Math.PI * 2); cx.fill();
    cx.restore();
  };

  /* Where the rock ended up, so the light key can be applied over ALL of it at the
     end — shading each ridge as it is painted would leave the next ridge's beads
     unlit wherever they overlap. */
  const lit: Array<[number, number, number]> = [];

  const ridge = (r: Rect, radius: number, band: number, gemChance: number, biasPx: number) => {
    const pts = outline(r, radius, band * 0.62);

    // 1. the bed, laid first along the whole ridge
    pts.forEach(([px, py, ang], t) => {
      const wave = Math.sin(t * 0.21) * band * 0.12 + Math.sin(t * 0.079 + 1.3) * band * 0.1;
      const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
      const off = wave - biasPx;
      grout(px + nx * off, py + ny * off, ang, band * 1.15);
    });

    // 2. the beads. The zoom is held for a RUN of stamps, not rerolled per stamp:
    //    the reference varies bead size in zones along the ridge, and rerolling
    //    every stamp just averages back to one size.
    let zoom = 0.9, zoneLeft = 0;
    pts.forEach(([px, py, ang], t) => {
      if (zoneLeft <= 0) {
        zoom = [0.62, 0.9, 1.32][Math.floor(rnd() * 3)];
        zoneLeft = 5 + Math.floor(rnd() * 9);
      }
      zoneLeft--;

      const wave = Math.sin(t * 0.21) * band * 0.12 + Math.sin(t * 0.079 + 1.3) * band * 0.1;
      /* Biased OUTWARD by an ABSOLUTE number of pixels: what the bias has to clear
         is half the layout gap between two sections, which has nothing to do with
         how fat the beads are. As a fraction of the ridge it under-shot, both
         facing ridges sat astride their edges, and together they ate ~100px —
         swallowing "Add Node" and the GEMINI PRO header. */
      const off = wave - biasPx + (rnd() - 0.5) * band * 0.5;
      const nx = Math.cos(ang + Math.PI / 2), ny = Math.sin(ang + Math.PI / 2);
      // swell carries the slow zone-scale swelling; the random term breaks the
      // straight filed edge that a purely periodic band comes out with
      const swell = (0.72 + Math.pow(Math.abs(Math.sin(t * 0.11 + 0.7)), 0.7) * 0.5) * (0.78 + rnd() * 0.45);

      // rotation stays tiny: the light is baked into the piece, so turning a stamp
      // turns its key light with it
      stamp(pick(VEIN), px + nx * off, py + ny * off, ang + (rnd() - 0.5) * 0.16,
        band * swell, zoom * (0.92 + rnd() * 0.20));
      lit.push([px + nx * off, py + ny * off, band * swell]);

      // a sparse big cabochon nested into the ridge
      if (rnd() < 0.09) {
        stamp(pick(CABOCHON), px + nx * (off + (rnd() - 0.5) * band * 0.3), py + ny * (off + (rnd() - 0.5) * band * 0.3),
          (rnd() - 0.5) * 0.2, band * 0.9, 0.85 + rnd() * 0.5);
      }

      // loose clusters thrown clear of the ridge: the reference has beads sitting
      // on their own out on the black, and they are most of what sells it as rock
      if (rnd() < 0.2) {
        const far = off + (rnd() < 0.25 ? 1 : -1) * band * (0.25 + rnd() * 0.5);
        const along = (rnd() - 0.5) * band;
        stamp(pick(CABOCHON),
          px + nx * far + Math.cos(ang) * along,
          py + ny * far + Math.sin(ang) * along,
          (rnd() - 0.5) * 0.3, band * (0.3 + rnd() * 0.3), 0.6 + rnd() * 0.4, 0.92);
      }

      if (rnd() < gemChance) {
        // rare and large, set into the ridge like a cabochon in a bezel — the
        // reference carries maybe half a dozen on the whole screen
        stamp(pick(GEMS), px + nx * (off + (rnd() - 0.5) * band * 0.25), py + ny * (off + (rnd() - 0.5) * band * 0.25),
          rnd() * Math.PI * 2, band * 0.85, 0.62 + rnd() * 0.28);
      }
    });
  };

  // 1. the outer bezel, leaning outward so it spills off screen rather than over
  //    the top bar's text
  const inset = 16;
  ridge({ x: inset, y: inset, w: vw - inset * 2, h: vh - inset * 2 }, thickFrame * 0.9, thickFrame, 0.004, 14);

  // 2. a ridge around every section, thinner on the slim ones (a bite that is
  //    texture on the hero is a third of a 48px top bar)
  for (const h of holes) {
    const slim = Math.min(h.w, h.h) < slimBelow;
    // half the 28px layout gap, so the ridge fills it and leans only ~12px in
    ridge(h, slim ? 16 : 26, slim ? thickSlim : thick, slim ? 0.0008 : 0.0028, slim ? 16 : 18);
  }

  /* 2b. THE JUNCTION POOLS. Where three sections meet, the reference swells into a
     knot two or three times the width of a plain run — those knots are the
     composition's anchors, and without them every division reads at the same
     weight. A junction is found geometrically: a corner of one section that sits
     within a gap's width of a corner of another. */
  const corners4 = (r: Rect): Array<[number, number]> =>
    [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as Array<[number, number]>;
  const seenPool: Array<[number, number]> = [];
  // Only between BROAD sections. A pool at a corner of the 78px icon rail is wider
  // than the rail itself and lands straight on its labels.
  const broad = holes.filter((h) => Math.min(h.w, h.h) >= slimBelow);
  for (let i = 0; i < broad.length; i++) {
    for (let j = i + 1; j < broad.length; j++) {
      for (const [ax, ay] of corners4(broad[i])) {
        for (const [bx, by] of corners4(broad[j])) {
          if (Math.hypot(ax - bx, ay - by) > thick * 2.2) continue;
          const px = (ax + bx) / 2, py = (ay + by) / 2;
          if (seenPool.some(([sx, sy]) => Math.hypot(sx - px, sy - py) < thick)) continue;
          seenPool.push([px, py]);
          for (let k = 0; k < 6; k++) {
            const a = rnd() * Math.PI * 2, d = rnd() * thick * 0.68;
            const cxp = px + Math.cos(a) * d, cyp = py + Math.sin(a) * d;
            stamp(pick(k % 3 === 0 ? CABOCHON : VEIN), cxp, cyp, (rnd() - 0.5) * 0.16,
              thick * (0.85 + rnd() * 0.5), 0.8 + rnd() * 0.6);
            lit.push([cxp, cyp, thick * 1.05]);
          }
        }
      }
    }
  }

  /* 2c. THE OUTER SEAM. The piece has a fine, almost continuous line of micro
     beads running along its own outer edge; in the reference that seam runs right
     on the screen's edge and is what makes the bezel read as a made object rather
     than as a border. Fine grain, tight spacing, no swell. */
  {
    const seam = 15;
    for (const [px, py, ang] of outline({ x: 6, y: 6, w: vw - 12, h: vh - 12 }, 26, seam * 0.55)) {
      stamp(pick(VEIN), px, py, ang + (rnd() - 0.5) * 0.12, seam, 0.42 + rnd() * 0.16, 0.85);
      lit.push([px, py, seam]);
    }
  }

  /* 3. FORM SHADING — one light key, from above, over the whole rock.
     A cast shadow was tried first and is a no-op here: the panels are pure #000, so
     black-on-black shows nothing. What gives a ridge volume against black is its
     own form shading — the crown catching the key, the underside falling away.
     Painted `source-atop`, so it only touches pixels the rock already occupies and
     never darkens a panel; painted LAST, so every bead gets the same key whatever
     order the ridges were laid in; and painted per PLACEMENT, because a single
     tiled gradient across the viewport draws a hard seam straight through the UI
     wherever its tiles meet (tried it — a bright rule across the whole screen). */
  cx.save();
  cx.globalCompositeOperation = 'source-atop';
  for (const [px, py, band] of lit) {
    const g = cx.createLinearGradient(0, py - band * 0.85, 0, py + band * 0.85);
    // low per-placement values ON PURPOSE: placements overlap about three deep, so
    // whatever is set here lands roughly tripled. At 0.17 white the ridge went milky
    // and lost the piece's colour entirely.
    g.addColorStop(0, 'rgba(255,255,255,0.055)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.015)');
    g.addColorStop(0.52, 'rgba(0,0,0,0)');
    g.addColorStop(0.8, 'rgba(0,0,0,0.1)');
    g.addColorStop(1, 'rgba(0,0,0,0.2)');
    cx.fillStyle = g;
    cx.beginPath();
    cx.ellipse(px, py, band * 1.5, band * 0.95, 0, 0, Math.PI * 2);
    cx.fill();
  }
  cx.restore();

  // 4. the brass rivets, one per outer corner, as the slab has
  const c = thickFrame * 0.62;
  const corners: Array<[number, number]> = [[c, c], [vw - c, c], [c, vh - c], [vw - c, vh - c]];
  corners.forEach(([px, py]) => stamp(RIVETS[0], px, py, rnd() * Math.PI * 2, thickFrame * 0.5, 0.9));

  return cv;
}
