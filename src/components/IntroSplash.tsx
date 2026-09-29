import { useCallback, useEffect, useRef, useState } from 'react';

/*
 * The opening of the desktop app: the operator's own animation — the logo
 * turning into the pet, then the camera diving into its eye and cutting to
 * black — played on a black screen as the loading screen (2026-09-29).
 *
 * The video is the operator's file, untouched: public/assets/intro/ holds it
 * with only its silent audio track removed (same video packets, same frames).
 *
 * The app mounts UNDERNEATH while it plays, so by the time the video has cut to
 * black the shell is built, and fading this overlay out reveals it ready — the
 * dive into the eye lands inside the app. The counter runs 0 → 100% with the
 * video itself, so "loading" ends exactly when the animation does.
 *
 * Where it plays: always in the desktop app; in a browser only with ?intro in
 * the URL (to preview it). `npm run dev` reloads and the browser verify suites
 * are not held up 9 seconds each.
 */
const SRC = '/assets/intro/logo-to-pet.mp4';
/* The video is 9.13 s. If it cannot play, or stalls, the intro still ends —
   nobody is ever left in front of a black screen. */
const GIVE_UP_MS = 14000;
const FADE_MS = 700;

export function shouldPlayIntro(): boolean {
  if (typeof window === 'undefined') return false;
  return /\bElectron\//.test(navigator.userAgent) || new URLSearchParams(window.location.search).has('intro');
}

export default function IntroSplash({ onDone }: { onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [pct, setPct] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const finish = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const tick = () => {
      if (v.duration > 0) setPct(Math.min(100, Math.round((100 * v.currentTime) / v.duration)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const onEnded = () => { setPct(100); finish(); };
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', finish);
    v.play().catch(finish);
    const giveUp = window.setTimeout(finish, GIVE_UP_MS);
    // A click or any key skips it.
    window.addEventListener('keydown', finish);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(giveUp);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', finish);
      window.removeEventListener('keydown', finish);
    };
  }, [finish]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onDone, FADE_MS);
    return () => window.clearTimeout(t);
  }, [leaving, onDone]);

  return (
    <div
      data-testid="intro"
      onClick={finish}
      className="fixed inset-0 z-[1000] flex items-center justify-center cursor-default select-none"
      style={{
        background: 'var(--syn-ink-950)',
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      <video
        ref={videoRef}
        data-testid="intro-video"
        src={SRC}
        muted
        playsInline
        preload="auto"
        className="w-full h-full object-contain"
      />
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <div data-testid="intro-pct" className="font-mono text-[10px] tracking-[0.35em] text-neutral-500 tabular-nums">
          LOADING {String(pct).padStart(3, ' ')}%
        </div>
        <div className="w-40 h-px bg-neutral-800 overflow-hidden">
          <div className="h-full" style={{ width: `${pct}%`, background: 'var(--syn-accent)' }} />
        </div>
      </div>
    </div>
  );
}
