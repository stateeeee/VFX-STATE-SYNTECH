import React, { useEffect, useRef, useState } from 'react';

/* Stereo playback level meter for the left sidebar (Premiere-style): green at the
 * bottom, amber through the middle, red at the top when the clip is running hot.
 * TWO columns side by side — left channel and right channel — centred in the rail,
 * and the pair fills whatever height is left under the GEMINI PRO block, with the
 * "Audio" caption sitting UNDER the columns.
 *
 * It taps the shell's hero <video> through WebAudio. The element ships muted (so
 * it can autoplay), and a muted element feeds silence to an analyser, so we
 * unmute it and route it through a gain of 0 instead: the analyser sees the real
 * samples while playback stays as silent as before. Restored on unmount.
 */

const MIN_TRACK_PX = 48;     // never smaller than this, whatever the window height
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
  const [levels, setLevels] = useState<[number, number]>([0, 0]); // 0..1 of the scale, per channel
  const [peaks, setPeaks] = useState<[number, number]>([0, 0]);   // 0..1, decaying peak hold
  const [live, setLive] = useState(false);   // a tap is attached and running
  const [trackPx, setTrackPx] = useState(MIN_TRACK_PX);
  const rafRef = useRef<number | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

  /* The columns are stretched by the flex column above them, so their height is a
     layout result, not a constant: measure it and let the fill / ticks / peak use
     real pixels as before. */
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const read = () => setTrackPx(Math.max(MIN_TRACK_PX, el.clientHeight || MIN_TRACK_PX));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!sourceKey || !el) { setLive(false); setLevels([0, 0]); setPeaks([0, 0]); return; }

    let analysers: AnalyserNode[] = [];
    let upmix: GainNode | null = null;
    let splitter: ChannelSplitterNode | null = null;
    let merger: ChannelMergerNode | null = null;
    let gain: GainNode | null = null;
    let cancelled = false;
    const wasMuted = el.muted;

    try {
      sharedCtx = sharedCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = sharedCtx;
      let tap = taps.get(el);
      if (!tap) { tap = ctx.createMediaElementSource(el); taps.set(el, tap); }

      /* A ChannelSplitter is `discrete`, so a MONO clip would hand the second
         column pure silence. Up-mix through a `speakers` node first: that
         duplicates a mono channel into L and R, which is what a hardware meter
         shows for a mono source. */
      upmix = ctx.createGain();
      upmix.channelCount = 2;
      upmix.channelCountMode = 'explicit';
      upmix.channelInterpretation = 'speakers';

      splitter = ctx.createChannelSplitter(2);
      merger = ctx.createChannelMerger(2);
      gain = ctx.createGain();
      gain.gain.value = 0; // keep playback silent, as it was while muted

      analysers = [0, 1].map(() => {
        const a = ctx.createAnalyser();
        a.fftSize = 1024;
        a.smoothingTimeConstant = 0.6;
        return a;
      });

      tap.connect(upmix);
      upmix.connect(splitter);
      analysers.forEach((a, ch) => {
        splitter!.connect(a, ch);
        a.connect(merger!, 0, ch);
      });
      merger.connect(gain);
      gain.connect(ctx.destination);
      el.muted = false;    // a muted element analyses as silence
      void ctx.resume();   // no-op when already running
      setLive(true);
    } catch {
      // no audio track, no device, or autoplay policy — leave the meter idle
      setLive(false);
      return;
    }

    const bufs = analysers.map((a) => new Float32Array(a.fftSize));
    let last = performance.now();
    const held: [number, number] = [0, 0];

    const tick = () => {
      if (cancelled || analysers.length === 0) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;

      const next: [number, number] = [0, 0];
      analysers.forEach((a, ch) => {
        const buf = bufs[ch];
        a.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        next[ch] = rms > 0 ? dbToUnit(20 * Math.log10(rms)) : 0;
        held[ch] = Math.max(next[ch], held[ch] - PEAK_FALL * dt);
      });

      setLevels(next);
      setPeaks([held[0], held[1]]);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      // leave the cached tap in place (it cannot be recreated) but drop our chain
      try {
        analysers.forEach((a) => a.disconnect());
        upmix?.disconnect(); splitter?.disconnect(); merger?.disconnect(); gain?.disconnect();
      } catch { /* already gone */ }
      el.muted = wasMuted;
      setLive(false);
      setLevels([0, 0]);
      setPeaks([0, 0]);
    };
  }, [sourceKey, videoRef]);

  const top = Math.max(levels[0], levels[1]);
  const hot = top >= dbToUnit(DB_HOT);

  return (
    <div
      className="flex flex-col items-center gap-1.5 w-full flex-1 min-h-0"
      data-testid="audio-meter"
    >
      {/* the pair of columns — centred in the rail, filling the space that is left */}
      <div className="flex-1 min-h-0 flex items-stretch justify-center gap-[5px]">
        {([0, 1] as const).map((ch) => {
          const fillPx = Math.round(levels[ch] * trackPx);
          const peakPx = Math.round(peaks[ch] * trackPx);
          return (
            <div
              key={ch}
              ref={ch === 0 ? trackRef : undefined}
              className={`relative w-2.5 h-full rounded-full overflow-hidden border ${
                isDayMode ? 'border-neutral-300 bg-neutral-200' : 'border-ink-700/60 bg-white/[0.06]'
              } ${hot ? 'shadow-[0_0_10px_rgba(239,68,68,0.45)]' : ''}`}
              data-testid={ch === 0 ? 'audio-meter-track' : 'audio-meter-track-r'}
              title={live ? `Playback level — ${ch === 0 ? 'left' : 'right'}` : 'Load a video to see its level'}
            >
              {/* scale ticks at roughly -6 / -12 / -24 dB */}
              {[DB_HOT, -12, -24].map((db) => (
                <span
                  key={db}
                  className={`absolute left-0 right-0 h-px ${isDayMode ? 'bg-black/15' : 'bg-white/15'}`}
                  style={{ bottom: Math.round(dbToUnit(db) * trackPx) }}
                />
              ))}

              {/* the level: green low → amber → red top, pinned to the full track so
                  the colours stay put as the fill moves */}
              <div
                className="absolute left-0 right-0 bottom-0 transition-[height] duration-75"
                data-testid={ch === 0 ? 'audio-meter-fill' : 'audio-meter-fill-r'}
                style={{
                  height: fillPx,
                  backgroundImage: 'linear-gradient(to top, #22c55e 0%, #22c55e 45%, #f59e0b 78%, #ef4444 100%)',
                  backgroundSize: `100% ${trackPx}px`,
                  backgroundPosition: 'bottom',
                  backgroundRepeat: 'no-repeat',
                }}
              />

              {/* peak hold */}
              {peakPx > 1 && (
                <span
                  className="absolute left-0 right-0 h-[2px] bg-white/85"
                  data-testid={ch === 0 ? 'audio-meter-peak' : 'audio-meter-peak-r'}
                  style={{ bottom: Math.min(trackPx - 2, peakPx) }}
                />
              )}
            </div>
          );
        })}
      </div>

      <span
        className={`shrink-0 text-[6.5px] font-mono tracking-wider ${
          live ? (hot ? 'text-red-400' : isDayMode ? 'text-neutral-500' : 'text-neutral-400') : 'text-neutral-600'
        }`}
        data-testid="audio-meter-readout"
      >
        {live ? (top > 0 ? `${Math.round(DB_FLOOR + top * -DB_FLOOR)}` : '-∞') : '––'}
      </span>

      {/* caption UNDER the columns, not above */}
      <span
        className={`shrink-0 text-[7px] uppercase tracking-[0.2em] font-bold ${
          hot ? 'text-red-400' : isDayMode ? 'text-neutral-400' : 'text-neutral-500'
        }`}
      >
        Audio
      </span>
    </div>
  );
}
