/* THE CAGE — the operator's artwork as the app's chrome.
 *
 * The artwork divides the sections; there is no gel slab and no coloured LEDs
 * between them any more. It stretches to fill any window (no black bands), and
 * because every section is positioned in FRACTIONS of the viewport, they track
 * that stretch with no JavaScript and no resize listener.
 *
 * The geometry is generated — see holes.generated.ts. Nothing here is typed by
 * hand, and no rectangle may be nudged "by eye": rebuild it from the artwork.
 *
 * Layering, bottom to top:
 *   0  the bed              black in BOTH themes
 *   1  the day backdrops    one warm-ivory plane per opening that hosts a panel
 *   2  the raw-video corner the A/B reference, bottom right
 *   5  the panels           positioned into their openings
 *   9  the cage             ONE image, on top, masking everything into the
 *                           organic holes. No blend mode, no filter, no
 *                           animation — that is the frame-cost contract.
 */
import type { CSSProperties } from 'react';
import { HOLES, type Hole } from './holes.generated';

export { HOLES };
export type { Hole };

/** Warm ivory. In day mode every panel opening gets this behind the cage, so the
 *  panel's surface fills its whole organic hole instead of leaving a black rim
 *  (which the operator rejected). Empty openings keep the black bed. */
export const CAGE_SURFACE = '#fbfaf7';

/** The bed is black in BOTH themes. A light bed against cream panels drew a halo
 *  in every part of an opening the panel did not cover. */
export const CAGE_BED = '#000000';

const pct = (v: number) => `${(v * 100).toFixed(4)}%`;

/**
 * Pin an element into one of the cage's openings.
 *
 * `inset` pulls the box in by a few px on every side: the panels carry their own
 * 16px radius, and the openings are organic, so a hair of clearance keeps a
 * corner from poking out from under the material.
 */
export function cageBox(r: Hole, inset = 5, zIndex = 5): CSSProperties {
  return {
    position: 'fixed',
    margin: 0,
    zIndex,
    left: `calc(${pct(r.x)} + ${inset}px)`,
    top: `calc(${pct(r.y)} + ${inset}px)`,
    width: `calc(${pct(r.w)} - ${inset * 2}px)`,
    height: `calc(${pct(r.h)} - ${inset * 2}px)`,
  };
}

/**
 * A plane sitting BEHIND the cage, ending on material where the frame hides it.
 * Used for the day backdrops and the raw-video corner. No inset: these are the
 * openings' own bounding boxes, and each of their edges rests on the region's
 * outermost pixel — pull them in and the edge lands inside the hole, where it
 * reads as a straight cut through the artwork.
 */
export function cagePlane(r: Hole, zIndex: number): CSSProperties {
  return {
    position: 'fixed',
    zIndex,
    left: pct(r.x),
    top: pct(r.y),
    width: pct(r.w),
    height: pct(r.h),
    pointerEvents: 'none',
  };
}

/** The openings that host a panel: by day each one gets its own ivory backdrop. */
export const DAY_BACKDROPS: Hole[] = Object.values(HOLES.boxes);

/** The bottom-right corner opening — the raw-video reference. Lit whole by day. */
export const VIDEO_BOX: Hole = HOLES.videoBoxes[0];
