import React, { useEffect, useRef, useState } from 'react';

/* Single-channel playback level meter for the left sidebar (Premiere-style):
 * green at the bottom, amber through the middle, red at the top when the clip is
 * running hot. One column, not a stereo pair — the two channels are summed.
 *
 * It taps the shell's hero <video> through WebAudio. The element ships muted (so
 * it can autoplay), and a muted element feeds silence to an analyser, so we
 * unmute it and route it through a gain of 0 instead: the analyser sees the real
 * samples while playback stays as silent as before. Restored on unmount.
 */

const TRACK_PX = 96;         // bar height; the gradient is pinned to this, so the
                             // colours don't stretch as the level moves
const DB_FLOOR = -54;        // bottom of the scale
const DB_HOT = -6;           // above this the meter reads "hot"
const PEAK_FALL = 0.35;      // peak-hold decay per second

// one MediaElementAudioSourceNode per element, ever (a second one throws)
const taps = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
let sharedCtx: AudioContext | null = null;

const dbToUnit = (db: number) => Math.max(0, Math.min(1, (db - DB_FLOOR) / (0 - DB_FLOOR)));

interface AudioMeterProps {
  isDayMode: boolean;
  /** the shell's hero video element, when one is mounted */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** changes when a different clip is loaded — re-attaches the tap */
  sourceKey: string | null;
}

export default function AudioMeter({ isDayMode, videoRef, sourceKey }: AudioMeterProps) {
  const [level, setLevel] = useState(0);   // 0..1 of the scale
  const [peak, setPeak] = useState(0);     // 0..1, decaying peak hold
  const [live, setLive] = useState(false); // a tap is attached and running
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!sourceKey || !el) { setLive(false); setLevel(0); setPeak(0); return; }

    let analyser: AnalyserNode | null = null;
    let gain: GainNode | null = null;
    let cancelled = false;
    const wasMuted = el.muted;

    try {
      sharedCtx = sharedCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = sharedCtx;
      let tap = taps.get(el);
      if (!tap) { tap = ctx.createMediaElementSource(el); taps.set(el, tap); }
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      gain = ctx.createGain();
      gain.gain.value = 0; // keep playback silent, as it was while muted
      tap.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      el.muted = false;    // a muted element analyses as silence
      void ctx.resume();   // no-op when already running
      setLive(true);
    } catch {
      // no audio track, no device, or autoplay policy — leave the meter idle
      setLive(false);
      return;
    }

    const buf = new Float32Array(analyser.fftSize);
    let last = performance.now();
    let held = 0;

    const tick = () => {
      if (cancelled || !analyser) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;

      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      const unit = rms > 0 ? dbToUnit(20 * Math.log10(rms)) : 0;

      held = Math.max(unit, held - PEAK_FALL * dt);
      setLevel(unit);
      setPeak(held);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // leave the cached tap in place (it cannot be recreated) but drop our chain
      try { analyser?.disconnect(); gain?.disconnect(); } catch { /* already gone */ }
      el.muted = wasMuted;
      setLive(false);
      setLevel(0);
      setPeak(0);
    };
  }, [sourceKey, videoRef]);

  const hot = level >= dbToUnit(DB_HOT);
  const fillPx = Math.round(level * TRACK_PX);
  const peakPx = Math.round(peak * TRACK_PX);

  return (
    <div className="flex flex-col items-center gap-1.5 w-full shrink-0" data-testid="audio-meter">
      <span
        className={`text-[7px] uppercase tracking-[0.2em] font-bold ${
          hot ? 'text-red-400' : isDayMode ? 'text-neutral-400' : 'text-neutral-500'
        }`}
      >
        Audio
      </span>

      <div
        className={`relative w-2.5 rounded-full overflow-hidden border ${
          isDayMode ? 'border-neutral-300 bg-neutral-200' : 'border-ink-700/60 bg-white/[0.06]'
        } ${hot ? 'shadow-[0_0_10px_rgba(239,68,68,0.45)]' : ''}`}
        style={{ height: TRACK_PX }}
        title={live ? 'Playback level' : 'Load a video to see its level'}
      >
        {/* scale ticks at roughly -6 / -12 / -24 dB */}
        {[DB_HOT, -12, -24].map((db) => (
          <span
            key={db}
            className={`absolute left-0 right-0 h-px ${isDayMode ? 'bg-black/15' : 'bg-white/15'}`}
            style={{ bottom: Math.round(dbToUnit(db) * TRACK_PX) }}
          />
        ))}

        {/* the level: green low → amber → red top, pinned to the full track so the
            colours stay put as the fill moves */}
        <div
          className="absolute left-0 right-0 bottom-0 transition-[height] duration-75"
          data-testid="audio-meter-fill"
          style={{
            height: fillPx,
            backgroundImage: 'linear-gradient(to top, #22c55e 0%, #22c55e 45%, #f59e0b 78%, #ef4444 100%)',
            backgroundSize: `100% ${TRACK_PX}px`,
            backgroundPosition: 'bottom',
            backgroundRepeat: 'no-repeat',
          }}
        />

        {/* peak hold */}
        {peakPx > 1 && (
          <span
            className="absolute left-0 right-0 h-[2px] bg-white/85"
            data-testid="audio-meter-peak"
            style={{ bottom: Math.min(TRACK_PX - 2, peakPx) }}
          />
        )}
      </div>

      <span
        className={`text-[6.5px] font-mono tracking-wider ${
          live ? (hot ? 'text-red-400' : isDayMode ? 'text-neutral-500' : 'text-neutral-400') : 'text-neutral-600'
        }`}
        data-testid="audio-meter-readout"
      >
        {live ? (level > 0 ? `${Math.round(DB_FLOOR + level * -DB_FLOOR)}` : '-∞') : '––'}
      </span>
    </div>
  );
}
