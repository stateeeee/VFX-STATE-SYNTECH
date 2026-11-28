/* LED phase sync (operator 2026-11-28, docs/workflow/13-EXPORT-PANEL.md §4).
   Every LED-like animation (fxl-led-c in chainLab.css, syn-led-c in
   public/effects/shared/syn-chrome.css) has a 6 s period; this pins each one
   to the wall clock, so the shell and every effect iframe (Date.now() is
   shared) show the same colour at the same instant, however late the node was
   mounted. The same logic lives in public/effects/shared/syn-chrome.js. */
const NAMES = ['fxl-led-c', 'syn-led-c'];
const PERIOD = 6000;

function align(a: Animation): void {
  const an = (a as CSSAnimation).animationName;
  if (!an || NAMES.indexOf(an) < 0) return;
  /* timeline time of the last wall-clock multiple of the period; independent of
     frame lag (document.timeline.currentTime is the frame's timestamp, which
     can trail the wall clock by whole frames when the page is busy) */
  const now = Date.now();
  const want = now - performance.timeOrigin - (now % PERIOD);
  const cur = a.startTime as number | null;
  if (cur != null && Math.abs(((cur - want) % PERIOD + PERIOD * 1.5) % PERIOD - PERIOD / 2) < 5) return;
  a.startTime = want;
}

function sweep(): void {
  try { document.getAnimations().forEach(align); } catch { /* old engine */ }
}

export function startLedSync(): void {
  if (typeof document === 'undefined') return;
  sweep();
  document.addEventListener('animationstart', (e) => {
    if (NAMES.indexOf((e as AnimationEvent).animationName) >= 0) sweep();
  }, true);
  window.addEventListener('load', sweep);
  window.setInterval(sweep, 5000); // keeps the phase honest across tab throttling / clock drift
}
