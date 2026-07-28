import { PANEL_CLIPS } from '../lib/panelClips';

/* ═══════════════════════════════════════════════════════════════════════════
   The SVG <clipPath> definitions the panels reference.

   `clipPathUnits="objectBoundingBox"` is the whole reason this needs no JS: the
   paths are stored in 0..1 units of the element's own box, so each container
   keeps the operator's traced curvature at any size, through every panel drag and
   window resize, with nothing to recompute.

   Two consequences worth knowing:

   1. `clip-path` does NOT change an element's box. Layout, `getBoundingClientRect`
      and every ResizeObserver see exactly what they saw before, so the hero's
      WebGL/2D canvas keeps sizing itself the same way and never renders to a
      surface the mask has cut away — the isolation the video-engine phase asks
      for is a property of clip-path itself, not something to engineer.
   2. Chrome clips HIT TESTING to the same path. Clicks outside the curve fall
      through to what is beneath, which is what makes the cosmic field behind the
      UI un-clickable while the modules stay live.
   ═══════════════════════════════════════════════════════════════════════════ */
export default function PanelClips() {
  return (
    <svg className="syn-clip-defs" aria-hidden width="0" height="0" focusable="false">
      <defs>
        {Object.entries(PANEL_CLIPS).map(([id, clip]) => (
          <clipPath key={id} id={`syn-clip-${id}`} clipPathUnits="objectBoundingBox">
            <path d={clip.d} />
          </clipPath>
        ))}
      </defs>
    </svg>
  );
}
