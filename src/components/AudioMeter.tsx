import React, { useEffect, useRef, useState } from 'react';

/* Stereo playback level meter for the left sidebar, read like a DAW / Premiere
 * meter: TWO columns (left, right), green → amber → red by zone, the CLIP light
 * on top. It fills the small opening under the rail in the cage.
 *
 * What it measures — sample PEAK in dBFS on a −60…0 scale, per channel:
 *   - instant attack, release 24 dB/s (the column falls back smoothly);
 *   - peak hold: a white line that stays 1.5 s on the highest value, then falls;
 *   - zones fixed on the scale: green up to −18 dBFS, amber to −6, red above;
 *   - CLIP: the cap of the column lights red for 2 s when a sample reaches
 *     full scale (|x| ≥ 0.999, i.e. ≈ 0 dBFS) — the signal is too loud.
 *
 * WHAT it measures is a MeterSource chosen by the shell: the Home clip, the
 * video file inside the open effect, or the Lab's audio (clip / file / mic).
 * See the factories below; App.tsx picks the one on screen.
 */

const MIN_TRACK_PX = 48;     // never smaller than this, whatever the window height
const DB_FLOOR = -60;        // bottom of the scale (dBFS)
const DB_AMBER = -18;        // green below, amber from here
const DB_RED = -6;           // red from here: the signal is running hot
const RELEASE_DB_S = 24;     // fall rate of the column
const HOLD_MS = 1500;        // peak-hold time before the line falls
const HOLD_FALL_DB_S = 20;   // fall rate of the peak-hold line
const CLIP_LINEAR = 0.999;   // a sample this high is full scale
const CLIP_MS = 2000;        // how long the CLIP light stays on
const CLIP_CAP_PX = 4;       // height of the CLIP light at the top of each column

const dbToUnit = (db: number) => Math.max(0, Math.min(1, (db - DB_FLOOR) / (0 - DB_FLOOR)));

/* ── sources ───────────────────────────────────────────────────────────── */

/** An audio node to meter, in its own context. close() undoes what open() did. */
export interface MeterTap {
  ctx: AudioContext;
  node: AudioNode;
  close: () => void;
}

/** What the meter listens to. A new key = a new source: the meter re-attaches. */
export interface MeterSource {
  key: string;
  open: () => MeterTap | null;
}

let sharedCtx: AudioContext | null = null;
function meterContext(): AudioContext {
  sharedCtx = sharedCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
  if (sharedCtx.state === 'suspended') void sharedCtx.resume();
  return sharedCtx;
}

// a stable id per element, so a re-mounted <video> with the same src is a new source
const elIds = new WeakMap<HTMLMediaElement, number>();
let nextElId = 1;
function elKey(el: HTMLMediaElement): string {
  let id = elIds.get(el);
  if (!id) { id = nextElId++; elIds.set(el, id); }
  return `${id}:${el.currentSrc || el.src}`;
}

// one MediaElementAudioSourceNode per element, ever (a second one throws)
const taps = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

/**
 * The Home clip. The hero <video> ships muted (so it can autoplay), and a muted
 * element feeds silence, so it is unmuted and taken into WebAudio, where the
 * meter's sink has a gain of 0: the meter sees the real samples while playback
 * stays as silent as before. Muting is restored on close.
 */
export function heroSource(el: HTMLVideoElement): MeterSource {
  return {
    key: `hero:${elKey(el)}`,
    open: () => {
      const ctx = meterContext();
      let tap = taps.get(el);
      if (!tap) { tap = ctx.createMediaElementSource(el); taps.set(el, tap); }
      const wasMuted = el.muted;
      el.muted = false;
      return { ctx, node: tap, close: () => { el.muted = wasMuted; } };
    },
  };
}

/**
 * A video playing somewhere we must not disturb — the file inside an open
 * effect, which the effect may already route through its own AudioContext
 * (so createMediaElementSource would throw there, or break the effect).
 * captureStream() copies the element's sound without touching its playback,
 * and still carries it when the effect's AUDIO switch has the monitor at 0.
 * In Chromium 128 (the desktop app's Electron 32) a muted element captures
 * as silence; every effect unmutes a loaded file.
 */
export function capturedSource(el: HTMLMediaElement, scope: string): MeterSource {
  return {
    key: `${scope}:${elKey(el)}`,
    open: () => {
      const capture = (el as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream;
      if (typeof capture !== 'function') return null;
      let ms: MediaStream;
      try { ms = capture.call(el); } catch { return null; }
      const ctx = meterContext();
      const inlet = ctx.createGain();
      const nodes: MediaStreamAudioSourceNode[] = [];
      const plugged = new Set<string>();
      // the audio track can arrive after the stream (metadata still loading);
      // 'addtrack' may also report one already listed — plugging it twice would sum it (+6 dB)
      const plug = (t: MediaStreamTrack) => {
        if (t.kind !== 'audio') { t.stop(); return; } // only the sound is wanted
        if (plugged.has(t.id)) return;
        plugged.add(t.id);
        const n = ctx.createMediaStreamSource(new MediaStream([t]));
        n.connect(inlet);
        nodes.push(n);
      };
      ms.getTracks().forEach(plug);
      const onAdd = (e: MediaStreamTrackEvent) => plug(e.track);
      ms.addEventListener('addtrack', onAdd);
      return {
        ctx,
        node: inlet,
        close: () => {
          ms.removeEventListener('addtrack', onAdd);
          nodes.forEach((n) => n.disconnect());
          // these tracks are OUR capture: stopping them ends the tap only
          ms.getTracks().forEach((t) => t.stop());
          inlet.disconnect();
        },
      };
    },
  };
}

/** The Lab's audio input (clip / file / mic): its analyser, in its own context. */
export function engineSource(tap: () => { ctx: AudioContext; node: AudioNode } | null): MeterSource | null {
  const t = tap();
  if (!t) return null;
  return { key: 'lab', open: () => ({ ...t, close: () => {} }) };
}

/* ── the meter ─────────────────────────────────────────────────────────── */

interface AudioMeterProps {
  isDayMode: boolean;
  /** what to meter; null = idle */
  source: MeterSource | null;
}

interface Reading {
  level: [number, number]; // 0..1 of the scale
  hold: [number, number];  // 0..1, peak-hold line
  clip: [boolean, boolean];
}
const SILENT: Reading = { level: [0, 0], hold: [0, 0], clip: [false, false] };

export default function AudioMeter({ isDayMode, source }: AudioMeterProps) {
  const [reading, setReading] = useState<Reading>(SILENT);
  const [live, setLive] = useState(false);   // a tap is attached and running
  const [trackPx, setTrackPx] = useState(MIN_TRACK_PX);
  const trackRef = useRef<HTMLDivElement | null>(null);

  /* The columns are stretched by the flex column above them, so their height is a
     layout result, not a constant: measure it and let the fill / ticks / peak use
     real pixels. */
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
    setReading(SILENT);
    if (!source) { setLive(false); return; }

    let tap: MeterTap | null = null;
    let upmix: GainNode | null = null;
    let splitter: ChannelSplitterNode | null = null;
    let merger: ChannelMergerNode | null = null;
    let sink: GainNode | null = null;
    let analysers: AnalyserNode[] = [];
    try {
      tap = source.open();
      if (!tap) { setLive(false); return; }
      const { ctx } = tap;

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
      sink = ctx.createGain();
      sink.gain.value = 0; // keeps the graph pulled; nothing reaches the speakers

      // 2048 samples ≈ 43 ms at 48 kHz: longer than a frame, so no peak falls between two reads
      analysers = [0, 1].map(() => {
        const a = ctx.createAnalyser();
        a.fftSize = 2048;
        return a;
      });
      tap.node.connect(upmix);
      upmix.connect(splitter);
      analysers.forEach((a, ch) => {
        splitter!.connect(a, ch);
        a.connect(merger!, 0, ch);
      });
      merger.connect(sink);
      sink.connect(ctx.destination);
      if (ctx.state === 'suspended') void ctx.resume();
      setLive(true);
    } catch {
      // no audio track, no device, or autoplay policy — leave the meter idle
      try {
        if (upmix) tap?.node.disconnect(upmix);
        analysers.forEach((a) => a.disconnect());
        splitter?.disconnect(); merger?.disconnect(); sink?.disconnect();
      } catch { /* not connected yet */ }
      try { tap?.close(); } catch { /* nothing to undo */ }
      setLive(false);
      return;
    }

    const bufs = analysers.map((a) => new Float32Array(a.fftSize));
    const shown: [number, number] = [DB_FLOOR, DB_FLOOR];   // column, dBFS
    const held: [number, number] = [DB_FLOOR, DB_FLOOR];    // peak-hold line, dBFS
    const heldAt: [number, number] = [0, 0];
    const clipUntil: [number, number] = [0, 0];
    let last = performance.now();
    let raf = 0;
    let lastSig = '';

    const tick = () => {
      const now = performance.now();
      // real elapsed time, unclamped: after a long frame the column has fallen as far as it would have
      const dt = (now - last) / 1000;
      last = now;
      analysers.forEach((a, ch) => {
        const buf = bufs[ch];
        a.getFloatTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]);
          if (v > peak) peak = v;
        }
        const db = peak > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(peak)) : DB_FLOOR;
        shown[ch] = db >= shown[ch] ? db : Math.max(db, shown[ch] - RELEASE_DB_S * dt);
        if (db >= held[ch]) { held[ch] = db; heldAt[ch] = now; }
        else if (now - heldAt[ch] > HOLD_MS) held[ch] = Math.max(shown[ch], held[ch] - HOLD_FALL_DB_S * dt);
        if (peak >= CLIP_LINEAR) clipUntil[ch] = now + CLIP_MS;
      });
      const next: Reading = {
        level: [dbToUnit(shown[0]), dbToUnit(shown[1])],
        hold: [dbToUnit(held[0]), dbToUnit(held[1])],
        clip: [now < clipUntil[0], now < clipUntil[1]],
      };
      // re-render only when something visible moved (silence or pause = no renders)
      const sig = [...next.level, ...next.hold].map((u) => Math.round(u * 1000)).join(',') + next.clip.join(',');
      if (sig !== lastSig) { lastSig = sig; setReading(next); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      try {
        tap?.node.disconnect(upmix!);
        analysers.forEach((a) => a.disconnect());
        upmix?.disconnect(); splitter?.disconnect(); merger?.disconnect(); sink?.disconnect();
      } catch { /* already gone */ }
      try { tap?.close(); } catch { /* element or iframe already gone */ }
      setLive(false);
      setReading(SILENT);
    };
  }, [source]);

  const hot = Math.max(reading.level[0], reading.level[1]) >= dbToUnit(DB_RED);
  const greenTop = dbToUnit(DB_AMBER) * 100;
  const amberTop = dbToUnit(DB_RED) * 100;

  return (
    <div
      className="flex flex-col items-center gap-1.5 w-full flex-1 min-h-0"
      data-testid="audio-meter"
      data-live={live ? 'true' : 'false'}
    >
      {/* the pair of columns — centred in the opening, filling the space that is left */}
      <div className="flex-1 min-h-0 flex items-stretch justify-center gap-[5px]">
        {([0, 1] as const).map((ch) => {
          const fillPx = Math.round(reading.level[ch] * trackPx);
          const holdPx = Math.round(reading.hold[ch] * trackPx);
          const clip = reading.clip[ch];
          return (
            <div
              key={ch}
              ref={ch === 0 ? trackRef : undefined}
              className={`relative w-2.5 h-full rounded-full overflow-hidden border ${
                isDayMode ? 'border-neutral-300 bg-neutral-200' : 'border-ink-700/60 bg-white/[0.06]'
              } ${hot || clip ? 'shadow-[0_0_10px_rgba(239,68,68,0.45)]' : ''}`}
              data-testid={ch === 0 ? 'audio-meter-track' : 'audio-meter-track-r'}
              data-clip={clip ? 'true' : 'false'}
              title={live ? `Peak level, ${ch === 0 ? 'left' : 'right'} — red at the top = clipping` : 'Load a video to see its level'}
            >
              {/* scale ticks: −6 (red), −18 (amber), −30 / −42 dBFS */}
              {[DB_RED, DB_AMBER, -30, -42].map((db) => (
                <span
                  key={db}
                  className={`absolute left-0 right-0 h-px ${isDayMode ? 'bg-black/15' : 'bg-white/15'}`}
                  style={{ bottom: Math.round(dbToUnit(db) * trackPx) }}
                />
              ))}

              {/* the level: each zone keeps its place on the scale, so the colour
                  says how loud it is — green, then amber, red near full scale */}
              <div
                className="absolute left-0 right-0 bottom-0"
                data-testid={ch === 0 ? 'audio-meter-fill' : 'audio-meter-fill-r'}
                style={{
                  height: fillPx,
                  backgroundImage: `linear-gradient(to top, #22c55e 0%, #22c55e ${greenTop}%, #f59e0b ${greenTop + 2}%, #f59e0b ${amberTop}%, #ef4444 ${amberTop + 2}%, #ef4444 100%)`,
                  backgroundSize: `100% ${trackPx}px`,
                  backgroundPosition: 'bottom',
                  backgroundRepeat: 'no-repeat',
                }}
              />

              {/* peak hold */}
              {holdPx > 1 && (
                <span
                  className="absolute left-0 right-0 h-[2px] bg-white/85"
                  data-testid={ch === 0 ? 'audio-meter-peak' : 'audio-meter-peak-r'}
                  style={{ bottom: Math.min(trackPx - 2, holdPx) }}
                />
              )}

              {/* CLIP light: the cap of the column */}
              <span
                className="absolute left-0 right-0 top-0"
                data-testid={ch === 0 ? 'audio-meter-clip' : 'audio-meter-clip-r'}
                style={{ height: CLIP_CAP_PX, background: clip ? '#ef4444' : 'transparent' }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
