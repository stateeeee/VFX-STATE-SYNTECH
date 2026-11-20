/** Google's Gemini spark, as an outline (path: simple-icons "googlegemini", CC0),
 *  same weight as the lucide icons next to it. The stroke is a LED: Google's four
 *  Gemini colours (--syn-gemini-* tokens, index.css) in a conic gradient that
 *  turns clockwise for ever, so every point of the outline runs
 *  green → yellow → red → blue → green (operator, 2026-11-19). The outline is a
 *  CSS mask over a conic gradient (SVG has no conic gradient); the turn is the
 *  `.syn-gemini-mark` animation in index.css, which stops under
 *  prefers-reduced-motion. */
const SPARK =
  'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81';

const MASK = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='${SPARK}' transform='translate(1.5 1.5) scale(0.875)' fill='none' stroke='black' stroke-width='1.83' stroke-linejoin='round' stroke-linecap='round'/></svg>`,
)}")`;

export default function GeminiMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`syn-gemini-mark shrink-0 ${className ?? ''}`}
      style={{ WebkitMaskImage: MASK, maskImage: MASK }}
    />
  );
}
