import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowLeft, ArrowDown, ArrowUp, AudioLines, Camera, Diamond, Film, Link2, Mic, Music, Pause, Play as PlayIcon, Power, Repeat, Save, Trash2 } from 'lucide-react';
import { SynEngine, EngineNode, SourceKind } from '../engine/SynEngine';
import { NODE_FACTORY } from '../engine/nodes';
import { AudioEngine, AudioMode, FileTransport } from '../engine/AudioEngine';
import { VideoAnalyzer } from '../engine/VideoAnalyzer';
import { PersonMask, PersonMaskState } from '../engine/PersonMask';
import { ParamBus, MOD_SOURCES, ModSource, ParamBusState } from '../engine/params';
import { ModuleId } from '../types';
import { ParamSchema } from '../bridge/types';
import {
  AgentPlan, ChainState, LabHandle, MediaPart, ParamDesc, PlanUndo, SignalSummary, Stat,
  CARRIER_AMOUNT_MAX, CARRIER_AMOUNT_MIN, CARRIER_KEYS, ENUM_KEYS, MAX_ROUTE_AMOUNT, MOD_SOURCE_IDS,
  PARAM_FLOORS, PROTECTED_KEYS,
} from '../ai/contract';
import { elementToJpeg, recordClip } from '../ai/capture';

export interface ChainLabProps {
  isDayMode: boolean;
  onBack: () => void;
  /**
   * The wired chain owned by the shell (node graph wiring order). The rack
   * mirrors it live: listed effects run in this order, the rest sit
   * bypassed at the tail. Rack edits flow back up via onChainChange.
   */
  chain?: ModuleId[];
  /** rack toggles / reorders lift the new enabled order back to the shell */
  onChainChange?: (chain: ModuleId[]) => void;
  /** name of a saved chain preset to load on mount (Projects nav) */
  initialPreset?: string;
  /**
   * Source shared with the dashboard's Nodal Composition — a video or a
   * still photo (kind defaults to video). When set, the lab loads this
   * exact source; picking a new file here lifts it back up through
   * onSourcePicked so the dashboard preview + INPUT node follow.
   */
  initialSource?: { url: string; name: string; kind?: 'video' | 'image' } | null;
  onSourcePicked?: (file: File) => void;
}

// default rack order: trackers first, lens/grade passes last
const RACK_ORDER: ModuleId[] = ['blob_tracker', 'blob_reveal', 'bokeh', 'analog', 'anamorphic_lab'];

/** a saved chain: rack order + enabled set + bases/routes + boolean params */
interface ChainPreset {
  name: string;
  savedAt: number;
  order: ModuleId[];
  enabled: ModuleId[];
  bools: Record<string, number>;
  bus: ParamBusState;
}

const PRESETS_KEY = 'syntech.chainPresets';

const readPresets = (): ChainPreset[] => {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
};

/* ── what the Gemini panel reads through the LabHandle ─────────── */

/** a person mask is wanted when any enabled node asks for one — the same
 *  test drives the lazy PersonMask load in beforeFrame */
const wantsPersonMask = (engine: SynEngine): boolean =>
  engine.chain.some((n) => n.enabled && Number(n.getParam('segEnabled')) >= 0.5);

/** where a still sits in the source, for its label */
const frameAt = (engine: SynEngine): string => {
  if (engine.kind === 'webcam') return '(live webcam)';
  if (engine.kind === 'image') return '(still photo)';
  const v = engine.video;
  return v ? `at ${v.currentTime.toFixed(1)}s` : '';
};

/* grabSourceFrames pacing: a video is read around its playhead (never
   seeked — playback is not disturbed), a webcam across a short window */
const VIDEO_FRAME_GAP_MS = 500;
const WEBCAM_SPAN_MS = 2000;
const MAX_LIVE_FRAMES = 16;
/** a grab waiting on the next drawn frame takes the canvas as is after this
 *  (a hidden tab pauses rAF, so that frame may never come) */
const GRAB_FALLBACK_MS = 300;
/** how long a pair grab waits for a source that momentarily has no frame */
const GRAB_WAIT_MS = 1500;
const HINT_MAX = 160;

const wait = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms); });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const statOf = (xs: number[]): Stat => xs.length
  ? { mean: round3(xs.reduce((a, b) => a + b, 0) / xs.length), peak: round3(Math.max(...xs)) }
  : { mean: 0, peak: 0 };
/** a param's range as the AI is told it (chainState) and held to (applyPlan) */
const rangeOf = (p: ParamSchema) => ({ min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 1 });
/** snap to the slider's step grid anchored at min (an <input type=range> does the same) */
const snapTo = (v: number, min: number, max: number, step: number) => {
  if (!(step > 0)) return clamp(v, min, max);
  const dec = (String(step).split('.')[1] ?? '').length;
  return clamp(Number((min + Math.round((v - min) / step) * step).toFixed(Math.min(8, dec + 2))), min, max);
};
/** 'nodeId.param' → that node and its schema (bypassed nodes included) */
const findParam = (engine: SynEngine, key: string): { node: EngineNode; p: ParamSchema } | null => {
  const dot = key.indexOf('.');
  const node = dot > 0 ? engine.chain.find((n) => n.id === key.slice(0, dot)) : undefined;
  const p = node?.params.find((x) => x.key === key.slice(dot + 1));
  return node && p ? { node, p } : null;
};

/**
 * LAB — the native SynEngine surface (PLAN.md phase 5):
 * one WebGL context, all five effects composed in series on the same
 * frame. This is the capability the iframe architecture cannot provide.
 *
 * The ref is a LabHandle (src/ai/contract.ts): the Gemini panel's Agent
 * and Optimizer read the live chain, the source and the signals through
 * it, and write their plans back through the same ParamBus the sliders
 * use (PLAN §4.4) — the AI is one more hand on the rack, not a side door.
 */
const ChainLab = forwardRef<LabHandle, ChainLabProps>(function ChainLab(
  { isDayMode, onBack, chain: chainProp, onChainChange, initialPreset, initialSource, onSourcePicked },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<SynEngine | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const videoAnRef = useRef<VideoAnalyzer | null>(null);
  const maskRef = useRef<PersonMask | null>(null);
  const busRef = useRef<ParamBus | null>(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  if (!videoAnRef.current) videoAnRef.current = new VideoAnalyzer();
  if (!maskRef.current) maskRef.current = new PersonMask();
  if (!busRef.current) busRef.current = new ParamBus();
  // the handle below is built once, so whatever it reaches for must be a
  // ref: the latest chain callback, the export latch, the source's name
  const onChainChangeRef = useRef(onChainChange);
  onChainChangeRef.current = onChainChange;
  const exportingRef = useRef(false);
  const sourceNameRef = useRef('');
  /* frame grabs waiting for the next drawn frame — beforeFrame hands them
     to a microtask, which runs as soon as that frame is on the canvas */
  const afterRenderRef = useRef<(() => void)[]>([]);
  // object URL of a file picked in a standalone (non-embedded) lab: ours to
  // revoke; the counter tells an overtaken pick from the current one
  const ownUrlRef = useRef<string | null>(null);
  const pickSeqRef = useRef(0);
  const [segState, setSegState] = useState<PersonMaskState>('off');
  const [fps, setFps] = useState(0);
  const [resPct, setResPct] = useState(100);
  const [sourceKind, setSourceKind] = useState<SourceKind>('none');
  const [error, setError] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>('off');
  const [transport, setTransport] = useState<FileTransport | null>(null);
  const [signals, setSignals] = useState({ bass: 0, loud: 0, treble: 0, beat: 0, motion: 0, bright: 0, bpm: null as number | null });
  const [presets, setPresets] = useState<ChainPreset[]>(readPresets);
  const [presetName, setPresetName] = useState('');
  // bump to re-read node state after any mutation (params live in the nodes)
  const [, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);

  useEffect(() => {
    if (!canvasRef.current) return;
    let engine: SynEngine;
    try {
      engine = new SynEngine(canvasRef.current);
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const active = chainProp ?? [];
    const rack = [...active, ...RACK_ORDER.filter((id) => !active.includes(id))];
    rack.forEach((id) => {
      const node = NODE_FACTORY[id]();
      node.enabled = active.includes(id);
      engine.addNode(node);
    });
    // manual/auto control matrix (PLAN §4.4): bases live in the bus, audio
    // and video signal offsets are layered on top at the start of every frame
    busRef.current!.snapshot(engine.chain);
    // opened from the Projects nav: restore the requested saved chain and
    // lift its enabled order back up so the node-graph wiring follows
    if (initialPreset) {
      const p = readPresets().find((x) => x.name === initialPreset);
      if (p) {
        applyPresetTo(engine, p);
        onChainChange?.(engine.chain.filter((n) => n.enabled).map((n) => n.id as ModuleId));
      }
    }
    engine.beforeFrame = (now) => {
      // grabs queued for this frame: a microtask queued here runs once this
      // rAF tick has returned, i.e. with this frame drawn and still in the
      // (preserved) drawing buffer and the source on the frame it was made from
      const waiting = afterRenderRef.current;
      if (waiting.length) {
        const q = waiting.splice(0);
        const w = engine.canvas.width;
        const h = engine.canvas.height;
        queueMicrotask(() => {
          // the adaptive resolution resized (= cleared) the canvas after the
          // draw: the next frame is the first clean one
          if (engine.canvas.width !== w || engine.canvas.height !== h) afterRenderRef.current.push(...q);
          else q.forEach((grab) => grab());
        });
      }
      const lv = audioRef.current!.tick(now);
      const va = videoAnRef.current!;
      va.tick(engine.source);
      // person mask: lazy-loads the first time an enabled node asks for it
      // (a still photo is segmented too — bokeh / blob_reveal need the mask)
      const mask = maskRef.current!;
      const wantsMask = wantsPersonMask(engine);
      if (wantsMask) mask.enable();
      if (wantsMask && mask.state === 'ready') mask.tick(engine.source, now);
      engine.personMaskSource = wantsMask && mask.ready ? mask.maskCanvas : null;
      engine.personMaskVersion = mask.version;
      busRef.current!.apply(engine.chain, {
        bass: lv.bass, loud: lv.loud, treble: lv.treble, beat: lv.beat,
        motion: va.motion, bright: va.bright,
      });
    };
    engine.onFps = setFps;
    engine.onResScale = (s) => setResPct(Math.round(s * 100));
    engine.start();
    engineRef.current = engine;
    // dev-only tap for the parity/verification protocol (06-VERIFICATION):
    // lets headless runs pin the resolution and drive the source deterministically;
    // `lab` is the same LabHandle the Gemini panel holds
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
      (window as unknown as Record<string, unknown>).__SYN = {
        engine, audio: audioRef.current, bus: busRef.current, mask: maskRef.current, lab: labRef.current,
      };
    }
    return () => {
      audioRef.current?.stop();
      maskRef.current?.dispose();
      engine.dispose();
      engineRef.current = null;
      // the next engine (React StrictMode re-runs this effect in dev) starts
      // empty: let the shared-source effect load the source into it again
      loadedUrlRef.current = null;
      afterRenderRef.current = [];
      if (ownUrlRef.current) {
        URL.revokeObjectURL(ownUrlRef.current);
        ownUrlRef.current = null;
      }
    };
  }, []);

  // Live rack ⇄ wiring sync (Phase 2): when the shell's wired chain changes,
  // reorder the engine chain to [chain..., bypassed rest] and set enabled
  // flags to match. Rack edits go the other way through emitChain().
  const chainKey = (chainProp ?? []).join('|');
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const active = chainProp ?? [];
    const order = [...active, ...engine.chain.map((n) => n.id as ModuleId).filter((id) => !active.includes(id))];
    engine.chain.sort((a, b) => order.indexOf(a.id as ModuleId) - order.indexOf(b.id as ModuleId));
    engine.chain.forEach((n) => { n.enabled = active.includes(n.id as ModuleId); });
    bump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  const emitChain = () => {
    const engine = engineRef.current;
    if (!engine) return;
    onChainChangeRef.current?.(engine.chain.filter((n) => n.enabled).map((n) => n.id as ModuleId));
  };

  /* ── clip audio follows the source ──
     The Clip input taps the source video's own soundtrack. When the source
     changes, that tap would go on analysing an element that no longer plays
     (AudioEngine.tick also notices and drops it — this is the clean path):
     it is stopped before the swap, and picked back up on the new source if
     that is a video too — the operator asked for "the clip's music", not for
     one particular file's.
     The "pick it back up" intent lives in a ref, not in each load's own
     closure: with two quick picks the second release finds the mode already
     off, and only the load that wins (the last one) may act on it. It is
     cleared by the re-tap itself and by any explicit audio choice. */
  const pendingRetapRef = useRef(false);

  const releaseClip = (): void => {
    const audio = audioRef.current!;
    if (audio.mode !== 'clip') return;
    audio.stop();
    setAudioOn(false);
    setAudioMode('off');
    pendingRetapRef.current = true;
  };

  /** Clip audio on for this video, with the UI following — the Clip button,
   *  a re-tap and the Gemini panel's startClipAudio all go through here.
   *  AudioEngine.startClip makes (or resumes) the AudioContext before its
   *  first await, so a caller inside a click keeps the gesture. */
  const startClipOn = async (video: HTMLVideoElement): Promise<void> => {
    await audioRef.current!.startClip(video);
    setAudioOn(true);
    setAudioMode('clip');
    setError(null);
  };

  /** run by the load that now owns the source (never an overtaken one) */
  const retapClip = async () => {
    if (!pendingRetapRef.current) return;
    pendingRetapRef.current = false; // a photo / webcam has no soundtrack: the intent ends here too
    const engine = engineRef.current;
    const audio = audioRef.current!;
    // the operator may have picked Mic / Track while the new source loaded
    // (that choice also cleared the flag — this is the belt to its braces)
    if (!engine || engine.kind !== 'video' || !engine.video || audio.mode !== 'off') return;
    try {
      await startClipOn(engine.video);
    } catch (e) {
      setError('Clip audio: ' + (e as Error).message);
    }
  };

  // Shared source: load the dashboard's chosen video or photo (single load
  // path — the Source button lifts its pick up to the shell, which flows back here).
  const loadedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    const url = initialSource?.url;
    if (!engine || !url || loadedUrlRef.current === url) return;
    loadedUrlRef.current = url;
    sourceNameRef.current = initialSource?.name ?? '';
    releaseClip();
    // a newer pick (or a dispose) took over while this one loaded: the
    // engine already dropped this element — leave the UI and the clip
    // re-tap to the load that owns the source now
    const current = () => engineRef.current === engine && loadedUrlRef.current === url;
    (initialSource?.kind === 'image' ? engine.loadImageUrl(url) : engine.loadVideoUrl(url))
      .then(() => {
        if (!current()) return;
        setSourceKind(engine.kind);
        setError(null);
        void retapClip();
      })
      .catch((e) => { if (current()) setError((e as Error).message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource?.url]);

  // low-rate UI mirror of the live signals (meters + modulated readouts)
  useEffect(() => {
    const id = setInterval(() => {
      const lv = audioRef.current!.levels;
      const va = videoAnRef.current!;
      setSignals({ bass: lv.bass, loud: lv.loud, treble: lv.treble, beat: lv.beat, bpm: lv.bpm, motion: va.motion, bright: va.bright });
      setSegState(maskRef.current!.state);
      setTransport(audioRef.current!.transport);
      setAudioOn(audioRef.current!.active);
      setAudioMode(audioRef.current!.mode);
    }, 150);
    return () => clearInterval(id);
  }, []);

  const toggleAudio = async () => {
    const audio = audioRef.current!;
    pendingRetapRef.current = false; // an explicit audio choice outranks a pending clip re-tap
    if (audio.mode === 'mic') {
      audio.stop(); // zeroes its levels; the signals mirror picks that up
      setAudioOn(false);
      setAudioMode('off');
      return;
    }
    try {
      await audio.startMic();
      setAudioOn(true);
      setAudioMode('mic');
      setError(null);
    } catch (e) {
      setError('Audio in: ' + (e as Error).message);
    }
  };

  // §10: reactivity from a loaded music track, not just the mic
  const loadAudioFile = async (file: File | null) => {
    if (!file) return;
    pendingRetapRef.current = false;
    try {
      await audioRef.current!.startFile(file);
      setAudioOn(true);
      setAudioMode('file');
      setError(null);
    } catch (e) {
      setError('Audio file: ' + (e as Error).message);
    }
  };

  // D7: in a music video the music is IN the clip — analyse (and hear) the
  // source video's own soundtrack. The element stays muted; AudioEngine
  // makes it audible through its analyser, so there is no double audio.
  const toggleClipAudio = async () => {
    const audio = audioRef.current!;
    pendingRetapRef.current = false;
    if (audio.mode === 'clip') {
      audio.stop();
      setAudioOn(false);
      setAudioMode('off');
      return;
    }
    const video = engineRef.current?.kind === 'video' ? engineRef.current.video : null;
    if (!video) return;
    try {
      await startClipOn(video);
    } catch (e) {
      setError('Clip audio: ' + (e as Error).message);
    }
  };

  /* ── chain presets (decision #9: localStorage is enough for v1) ── */

  const writePresets = (next: ChainPreset[]) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };

  /** the whole rack as a preset */
  const captureChain = (engine: SynEngine, name: string): ChainPreset => {
    const bools: Record<string, number> = {};
    engine.chain.forEach((n) => n.params.forEach((p) => {
      if (p.type === 'boolean') bools[`${n.id}.${p.key}`] = Number(n.getParam(p.key));
    }));
    return {
      name,
      savedAt: Date.now(),
      order: engine.chain.map((n) => n.id as ModuleId),
      enabled: engine.chain.filter((n) => n.enabled).map((n) => n.id as ModuleId),
      bools,
      bus: busRef.current!.serialize(),
    };
  };

  const savePreset = () => {
    const engine = engineRef.current;
    const name = presetName.trim();
    if (!engine || !name) return;
    writePresets([...presets.filter((p) => p.name !== name), captureChain(engine, name)]);
    setPresetName('');
  };

  const applyPresetTo = (engine: SynEngine, preset: ChainPreset) => {
    const byId = new Map(engine.chain.map((n) => [n.id, n]));
    const ordered: EngineNode[] = [];
    preset.order.forEach((id) => {
      const n = byId.get(id);
      if (n) { ordered.push(n); byId.delete(id); }
    });
    byId.forEach((n) => ordered.push(n)); // nodes unknown to the preset keep their spot at the tail
    engine.chain = ordered;
    engine.chain.forEach((n) => { n.enabled = preset.enabled.includes(n.id as ModuleId); });
    Object.entries(preset.bools ?? {}).forEach(([k, v]) => {
      const dot = k.indexOf('.');
      engine.chain.find((n) => n.id === k.slice(0, dot))?.setParam(k.slice(dot + 1), v);
    });
    busRef.current!.restore(preset.bus, engine.chain);
    // SYNTECH-BODY: a preset saved before blob_tracker had DETECT reopens in LUMA (the classic look it was
    // saved with) — same rule as the standalone's bridge restore; new sessions start in MOTION
    const bt = engine.chain.find((n) => n.id === 'blob_tracker');
    if (bt && preset.bus && !('blob_tracker.detect' in preset.bus)) busRef.current!.setBase(bt, 'detect', 0);
  };

  const loadPreset = (preset: ChainPreset) => {
    if (!engineRef.current) return;
    applyPresetTo(engineRef.current, preset);
    bump();
    emitChain();
  };

  const deletePreset = (name: string) => writePresets(presets.filter((p) => p.name !== name));

  /* ── the LabHandle (src/ai/contract.ts) ──────────────────────────
     The Gemini panel's Agent and Optimizer work through this, never on the
     engine directly. Built once: every method reads refs (and helpers that
     only read refs), so the same object stays valid for the Lab's life and
     can sit on window.__SYN in DEV. Capture is one-shot, on a button press,
     downscaled (D10) — nothing here samples in the background. */
  const labRef = useRef<LabHandle | null>(null);
  if (!labRef.current) {
    labRef.current = {
      whenReady: (timeoutMs = 8000) => new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const poll = () => {
          const engine = engineRef.current;
          if (engine && engine.kind !== 'none' && engine.isReady()) return resolve(true);
          if (performance.now() - t0 >= timeoutMs) return resolve(false);
          window.setTimeout(poll, 100);
        };
        poll();
      }),

      sourceKind: () => engineRef.current?.kind ?? 'none',

      // SOURCE and OUTPUT of the same frame: both stills are drawn in the
      // microtask right after a render (see beforeFrame) — elementToJpeg
      // draws synchronously, before its first await
      grabPair: (maxSide = 768) => new Promise((resolve) => {
        const none = { source: null, output: null };
        if (!engineRef.current?.source || exportingRef.current) return resolve(none);
        const deadline = performance.now() + GRAB_WAIT_MS;
        let done = false;
        let timer = 0;
        // one try per drawn frame (or per fallback tick), whichever comes first
        const attempt = () => {
          if (done) return;
          window.clearTimeout(timer);
          afterRenderRef.current = afterRenderRef.current.filter((f) => f !== attempt);
          const e = engineRef.current;
          const src = e?.source;
          if (!e || !src || exportingRef.current) { done = true; return resolve(none); }
          if (!e.isReady()) {
            // a looping video re-seeking to 0 has no frame for a moment: next one
            if (performance.now() < deadline) return arm();
            done = true;
            return resolve(none);
          }
          done = true;
          const at = frameAt(e);
          const source = elementToJpeg(src, maxSide, `SOURCE frame ${at}`);
          const output = elementToJpeg(e.canvas, maxSide, `OUTPUT frame ${at}`);
          void Promise.all([source, output]).then(([s, o]) => resolve({ source: s, output: o }));
        };
        const arm = () => {
          afterRenderRef.current.push(attempt);
          timer = window.setTimeout(attempt, GRAB_FALLBACK_MS);
        };
        arm();
      }),

      grabSourceFrames: async (n, maxSide = 768) => {
        const out: MediaPart[] = [];
        const engine = engineRef.current;
        const count = clamp(Math.floor(Number(n)) || 0, 0, MAX_LIVE_FRAMES);
        const el = engine?.source;
        if (!engine || !el || !count || exportingRef.current || !engine.isReady()) return out;
        if (engine.kind === 'image') {
          const part = await elementToJpeg(el, maxSide, 'SOURCE photo');
          return part ? [part] : out;
        }
        const webcam = engine.kind === 'webcam';
        const gap = webcam ? (count > 1 ? WEBCAM_SPAN_MS / (count - 1) : 0) : VIDEO_FRAME_GAP_MS;
        let lastT = -1;
        for (let i = 0; i < count; i++) {
          if (i > 0) await wait(gap);
          // the source was swapped (or an export began) mid-capture: keep what we have
          if (engineRef.current !== engine || engine.source !== el || exportingRef.current) break;
          let part: MediaPart | null;
          if (webcam) {
            part = await elementToJpeg(el, maxSide, `SOURCE webcam frame ${i + 1}/${count} (+${((i * gap) / 1000).toFixed(1)}s)`);
          } else {
            const t = (el as HTMLVideoElement).currentTime;
            if (Math.abs(t - lastT) < 0.04) continue; // a paused/stalled video: the same frame says nothing new
            lastT = t;
            part = await elementToJpeg(el, maxSide, `SOURCE frame at ${t.toFixed(1)}s`);
          }
          if (part) out.push(part);
        }
        return out;
      },

      recordOutputClip: async (sec) => {
        const engine = engineRef.current;
        if (!engine || exportingRef.current || !engine.isReady()) return null;
        const audio = audioRef.current!;
        const stream = audio.getOutputStream();
        const s = Number.isFinite(sec) && sec > 0 ? sec : 4;
        const what = !stream ? ' (no audio)' : audio.mode === 'mic' ? ' with mic audio' : ' with music';
        return recordClip(engine.canvas, stream, s, `OUTPUT clip ${s}s${what}`);
      },

      signalSummary: (sec) => new Promise<SignalSummary>((resolve) => {
        const windowSec = clamp(Number.isFinite(sec) ? sec : 0, 0, 30);
        const audio = audioRef.current!;
        const va = videoAnRef.current!;
        const xs = { bass: [] as number[], treble: [] as number[], loud: [] as number[], motion: [] as number[], bright: [] as number[] };
        // onsets: diff AudioEngine's monotonic counter — it sees every frame,
        // where rising edges of the decaying pulse sampled at 10Hz would
        // merge hits closer than a sample apart
        const count0 = audio.beatCount;
        const sample = () => {
          const lv = audio.levels;
          xs.bass.push(lv.bass);
          xs.treble.push(lv.treble);
          xs.loud.push(lv.loud);
          xs.motion.push(va.motion);
          xs.bright.push(va.bright);
        };
        const finish = () => {
          const counted = audio.beatCount - count0;
          const tp = audio.transport;
          const clipVideo = audio.mode === 'clip' ? engineRef.current?.video ?? null : null;
          resolve({
            windowSec,
            audio: {
              active: audio.active,
              mode: audio.mode,
              bpm: audio.active ? audio.levels.bpm : null,
              bass: statOf(xs.bass), treble: statOf(xs.treble), loud: statOf(xs.loud),
              beats: audio.active ? Math.max(0, counted) : 0,
              track: tp
                ? { name: tp.name, currentTime: round3(tp.currentTime), duration: round3(tp.duration) }
                : clipVideo
                  ? {
                      name: sourceNameRef.current || 'source clip',
                      currentTime: round3(clipVideo.currentTime),
                      duration: isFinite(clipVideo.duration) ? round3(clipVideo.duration) : 0,
                    }
                  : null,
            },
            video: { motion: statOf(xs.motion), bright: statOf(xs.bright) },
          });
        };
        sample();
        if (windowSec <= 0) return finish();
        const id = window.setInterval(sample, 100);
        window.setTimeout(() => { window.clearInterval(id); sample(); finish(); }, windowSec * 1000);
      }),

      chainState: (): ChainState => {
        const engine = engineRef.current;
        const audio = audioRef.current!;
        if (!engine) {
          return {
            order: [], params: [], fps: 0, resScale: 1, sourceKind: 'none',
            audioActive: audio.active, audioMode: audio.mode, maskState: null,
          };
        }
        const bus = busRef.current!;
        const enabled = engine.chain.filter((n) => n.enabled);
        const params: ParamDesc[] = [];
        enabled.forEach((node) => node.params.forEach((p) => {
          const key = `${node.id}.${p.key}`;
          const type: ParamDesc['type'] = p.type === 'boolean' ? 'boolean' : ENUM_KEYS.includes(key) ? 'enum' : 'number';
          const mod = type === 'number' ? bus.getMod(node, p.key) : null;
          const hint = (p.aiHint ?? '').trim();
          const r = type === 'boolean' ? { min: 0, max: 1, step: 1 } : rangeOf(p);
          params.push({
            key,
            label: p.label,
            type,
            min: r.min,
            max: r.max,
            step: r.step,
            value: type === 'boolean' ? (Number(node.getParam(p.key)) >= 0.5 ? 1 : 0) : bus.getBase(node, p.key),
            hint: hint.length > HINT_MAX ? `${hint.slice(0, HINT_MAX - 1).trimEnd()}…` : hint,
            reactive: type === 'number' && !!p.reactive,
            route: mod ? { source: mod.source, amount: mod.amount } : null,
            carrier: CARRIER_KEYS.includes(key),
            locked: PROTECTED_KEYS.includes(key),
          });
        }));
        return {
          order: enabled.map((n) => n.id as ModuleId),
          params,
          fps: engine.fps,
          resScale: engine.resScale,
          sourceKind: engine.kind,
          audioActive: audio.active,
          audioMode: audio.mode,
          maskState: wantsPersonMask(engine) ? maskRef.current!.state : null,
        };
      },

      // The server already validated the plan against chainState(); the
      // safety lists are enforced again here (defence in depth) because a
      // plan can be applied later than it was made (Optimizer fixes).
      // Numbers go to the BUS base — node.setParam would be overwritten by
      // ParamBus.apply on the very next frame.
      // Every key it changes is first written down as it was (PlanUndo), so
      // Undo can put back exactly those keys and nothing the operator did
      // around them — not their other edits, not order, not bypass.
      applyPlan: (plan: AgentPlan) => {
        const engine = engineRef.current;
        const skipped: string[] = [];
        if (!engine) return { applied: 0, skipped: ['the Lab engine is not running'], undo: null };
        // a plan landing mid-encode would show as a jump in the exported file
        if (exportingRef.current) return { applied: 0, skipped: ['a Master export is running'], undo: null };
        const bus = busRef.current!;
        let applied = 0;
        // first-seen previous state per key: a key listed twice still
        // undoes to what it was before the plan, not to its first edit
        const undo = new Map<string, PlanUndo['entries'][number]>();
        const entryOf = (key: string) => {
          let u = undo.get(key);
          if (!u) { u = { key }; undo.set(key, u); }
          return u;
        };

        for (const e of Array.isArray(plan?.params) ? plan.params : []) {
          const key = e?.key;
          const value = e?.value;
          const hit = typeof key === 'string' ? findParam(engine, key) : null;
          if (!hit) { skipped.push(`${String(key)}: not a parameter of this chain`); continue; }
          if (PROTECTED_KEYS.includes(key)) { skipped.push(`${key}: protected`); continue; }
          if (CARRIER_KEYS.includes(key)) { skipped.push(`${key}: carrier — only its route amount can change`); continue; }
          const v = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
          if (!Number.isFinite(v)) { skipped.push(`${key}: value is not a number`); continue; }
          const { node, p } = hit;
          const u = entryOf(key);
          if (p.type === 'boolean') {
            if (u.bool === undefined) u.bool = Number(node.getParam(p.key)) >= 0.5 ? 1 : 0;
            node.setParam(p.key, v >= 0.5 ? 1 : 0); // booleans are not on the bus
          } else {
            if (u.base === undefined) u.base = bus.getBase(node, p.key);
            const { min, max, step } = rangeOf(p);
            // a floor keeps a param that scales the whole music response off 0
            const floor = PARAM_FLOORS[key];
            const snapped = ENUM_KEYS.includes(key)
              ? clamp(Math.round(v), Math.ceil(min), Math.floor(max))
              : snapTo(v, min, max, step);
            bus.setBase(node, p.key, floor !== undefined ? clamp(Math.max(snapped, floor), min, max) : snapped);
          }
          applied++;
        }

        for (const e of Array.isArray(plan?.routes) ? plan.routes : []) {
          const key = e?.key;
          const source = e?.source;
          const amount = e?.amount;
          const hit = typeof key === 'string' ? findParam(engine, key) : null;
          if (!hit) { skipped.push(`${String(key)}: not a parameter of this chain`); continue; }
          const { node, p } = hit;
          if (PROTECTED_KEYS.includes(key)) { skipped.push(`${key}: protected`); continue; }
          if (ENUM_KEYS.includes(key)) { skipped.push(`${key}: enum parameters are never routed`); continue; }
          if (p.type !== 'number' || !p.reactive) { skipped.push(`${key}: not routable`); continue; }
          const isSource = (MOD_SOURCE_IDS as readonly string[]).includes(source);
          if (!isSource && source !== 'off') { skipped.push(`${key}: unknown signal "${String(source)}"`); continue; }
          const cur = bus.getMod(node, p.key);
          let next: { source: ModSource; amount: number } | null;
          if (CARRIER_KEYS.includes(key)) {
            // a carrier's route IS the effect's music response: only its depth moves
            const fixed = cur?.source ?? p.defaultRoute?.source;
            if (source === 'off') { skipped.push(`${key}: carrier route cannot be switched off`); continue; }
            if (fixed && source !== fixed) { skipped.push(`${key}: carrier route stays on ${fixed}`); continue; }
            const a = Number(amount);
            if (!Number.isFinite(a)) { skipped.push(`${key}: amount is not a number`); continue; }
            next = { source: source as ModSource, amount: clamp(a, CARRIER_AMOUNT_MIN, CARRIER_AMOUNT_MAX) };
          } else if (source === 'off') {
            next = null;
          } else {
            const a = Number(amount);
            if (!Number.isFinite(a)) { skipped.push(`${key}: amount is not a number`); continue; }
            next = { source: source as ModSource, amount: clamp(a, -MAX_ROUTE_AMOUNT, MAX_ROUTE_AMOUNT) };
          }
          const u = entryOf(key);
          if (u.route === undefined) u.route = cur ? { source: cur.source, amount: cur.amount } : null;
          bus.setMod(node, p.key, next);
          applied++;
        }

        bump();
        return { applied, skipped, undo: undo.size ? { entries: [...undo.values()] } : null };
      },

      // Undo of one plan: only the keys it recorded, straight onto the bus /
      // the switch / the route — no safety lists (these are the operator's
      // own earlier values), no order or bypass, no emitChain
      revertPlan: (undo: PlanUndo) => {
        const engine = engineRef.current;
        if (!engine || exportingRef.current || !Array.isArray(undo?.entries)) return { reverted: 0 };
        const bus = busRef.current!;
        let reverted = 0;
        for (const u of undo.entries) {
          const hit = typeof u?.key === 'string' ? findParam(engine, u.key) : null;
          if (!hit || PROTECTED_KEYS.includes(u.key)) continue; // a plan never touches a locked key
          const { node, p } = hit;
          let did = false;
          if (p.type === 'boolean') {
            if (typeof u.bool === 'number' && Number.isFinite(u.bool)) {
              node.setParam(p.key, u.bool >= 0.5 ? 1 : 0);
              did = true;
            }
          } else {
            if (typeof u.base === 'number' && Number.isFinite(u.base)) {
              bus.setBase(node, p.key, u.base);
              did = true;
            }
            if (u.route === null) {
              bus.setMod(node, p.key, null);
              did = true;
            } else if (
              u.route && (MOD_SOURCE_IDS as readonly string[]).includes(u.route.source) && Number.isFinite(u.route.amount)
            ) {
              bus.setMod(node, p.key, { source: u.route.source as ModSource, amount: u.route.amount });
              did = true;
            }
          }
          if (did) reverted++;
        }
        bump();
        return { reverted };
      },

      // Agent / Optimizer on a music video: they must hear the music, and
      // the Lab's default is audio off. Called from inside the panel's click
      // (startClipOn creates the AudioContext before its first await, so the
      // gesture still counts). True when audio is on now — whatever input.
      startClipAudio: async () => {
        try {
          const audio = audioRef.current!;
          if (audio.active) return true;
          const engine = engineRef.current;
          const video = engine?.kind === 'video' ? engine.video : null;
          // an audio switch mid-encode would change the exported modulation
          if (!video || exportingRef.current) return false;
          pendingRetapRef.current = false;
          await startClipOn(video);
          return true;
        } catch {
          return false; // no audio track / cannot tap: the caller goes on without
        }
      },
    };
  }
  useImperativeHandle(ref, () => labRef.current!, []);

  const loadSourceFile = async (file: File | null) => {
    if (!file) return;
    // when embedded in the dashboard, hand the pick to the shell; it becomes
    // the shared source and flows back through initialSource (single path)
    if (onSourcePicked) {
      onSourcePicked(file);
      return;
    }
    const engine = engineRef.current;
    if (!engine) return;
    const url = URL.createObjectURL(file);
    const seq = ++pickSeqRef.current;
    try {
      releaseClip();
      if (file.type.startsWith('image/')) await engine.loadImageUrl(url);
      else await engine.loadVideoUrl(url);
      if (seq !== pickSeqRef.current) { // a later pick overtook this one: it owns the source
        URL.revokeObjectURL(url);
        return;
      }
      // the engine never revokes a caller's URL: the previous pick is ours
      if (ownUrlRef.current) URL.revokeObjectURL(ownUrlRef.current);
      ownUrlRef.current = url;
      sourceNameRef.current = file.name;
      setSourceKind(engine.kind);
      setError(null);
      void retapClip();
    } catch (e) {
      URL.revokeObjectURL(url);
      if (seq === pickSeqRef.current) setError((e as Error).message);
    }
  };

  const toggleWebcam = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.kind === 'webcam') {
      engine.stopSource();
      setSourceKind('none');
      return;
    }
    try {
      releaseClip();
      pendingRetapRef.current = false; // the webcam has no soundtrack to follow
      await engine.startWebcam();
      sourceNameRef.current = 'webcam';
      // read back, not assumed: a start overtaken by another load leaves that one
      setSourceKind(engine.kind);
      setError(null);
    } catch (e) {
      setError('Webcam: ' + (e as Error).message);
    }
  };

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  // Master Quality export of the WHOLE CHAIN: the shared engine
  // (vendor/syntech-export.js) steps the source video frame by frame while
  // SynEngine renders deterministically with a synthetic clock.
  const runMasterExport = async () => {
    const engine = engineRef.current;
    if (!engine || exporting) return;
    // a photo or the webcam has no timeline to step through
    const video = engine.kind === 'video' ? engine.video : null;
    if (!video) {
      setExportMsg('✗ Master export needs a video source');
      return;
    }
    if (!isFinite(video.duration) || !video.duration) {
      setExportMsg('✗ the video has no readable duration yet');
      return;
    }
    setExporting(true);
    exportingRef.current = true; // the Gemini handle refuses grabs meanwhile
    setExportMsg('preparing…');
    try {
      const loadScript = (src: string) =>
        new Promise<void>((res, rej) => {
          if (document.querySelector(`script[src="${src}"]`)) return res();
          const el = document.createElement('script');
          el.src = src;
          el.onload = () => res();
          el.onerror = () => rej(new Error('failed to load ' + src));
          document.head.appendChild(el);
        });
      await loadScript('/effects/vendor/mp4-muxer.min.js');
      await loadScript('/effects/vendor/syntech-export.js');
      const SyntechExport = (window as any).SyntechExport;
      if (!SyntechExport?.isSupported()) throw new Error('WebCodecs not available in this browser');

      engine.stop();
      video.pause();
      // master export always renders at native resolution (§6.4)
      const prevAdaptive = engine.adaptiveRes;
      engine.adaptiveRes = false;
      engine.setResScale(1);
      const t0 = video.currentTime;
      let clock = performance.now();
      try {
        const res = await SyntechExport.exportMasterQuality({
          video,
          fps: 30,
          getFrame: async () => {
            clock += 1000 / 30;
            engine.renderFrame(clock);
            return engine.canvas;
          },
          filename: 'vfx_chain_' + Date.now() + '.mp4',
          onProgress: (done: number, total: number, phase: string) =>
            setExportMsg(`MASTER ${phase.toUpperCase()} ${done}/${total}`),
        });
        setExportMsg(`✓ ${res.filename} (${res.codec}${res.audio ? ' + audio' : ''})`);
      } finally {
        await new Promise<void>((r) => {
          const on = () => { video.removeEventListener('seeked', on); r(); };
          video.addEventListener('seeked', on);
          setTimeout(r, 1500);
          video.currentTime = t0;
        });
        void video.play().catch(() => {});
        engine.adaptiveRes = prevAdaptive;
        engine.start();
      }
    } catch (e) {
      setExportMsg('✗ ' + (e as Error).message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const chain = engineRef.current?.chain ?? [];

  const nodeCard = (node: EngineNode, idx: number) => (
    <div
      key={node.id}
      className={`border rounded p-3 space-y-2 transition-colors ${
        node.enabled
          ? isDayMode ? 'border-violet-500/50 bg-white' : 'border-violet-500/40 bg-[#0c0c0c]'
          : isDayMode ? 'border-neutral-200 bg-neutral-50 opacity-60' : 'border-white/10 bg-black/40 opacity-60'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-[10px] font-extrabold tracking-widest">
          <span className="text-violet-500">{String(idx + 1).padStart(2, '0')}</span>
          <span className={isDayMode ? 'text-neutral-900' : 'text-white'}>{node.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="Move up the chain"
            onClick={() => { engineRef.current?.swapNodes(idx, idx - 1); bump(); emitChain(); }}
            disabled={idx === 0}
            className="p-1 rounded border border-violet-500/20 text-violet-500 hover:bg-violet-500/10 disabled:opacity-30 cursor-pointer"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            title="Move down the chain"
            onClick={() => { engineRef.current?.swapNodes(idx, idx + 1); bump(); emitChain(); }}
            disabled={idx === chain.length - 1}
            className="p-1 rounded border border-violet-500/20 text-violet-500 hover:bg-violet-500/10 disabled:opacity-30 cursor-pointer"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <button
            title={node.enabled ? 'Bypass this node' : 'Enable this node'}
            data-testid={`toggle-${node.id}`}
            onClick={() => { node.enabled = !node.enabled; bump(); emitChain(); }}
            className={`p-1 rounded border cursor-pointer ${
              node.enabled ? 'border-violet-500 bg-violet-500 text-black' : 'border-violet-500/30 text-neutral-500'
            }`}
          >
            <Power className="w-3 h-3" />
          </button>
        </div>
      </div>

      {node.enabled && (
        <div className="space-y-1.5">
          {node.params.map((p) =>
            p.type === 'boolean' ? (
              <label key={p.key} className={`flex items-center justify-between font-mono text-[9px] uppercase tracking-wider cursor-pointer ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
                {p.label}
                <input
                  type="checkbox"
                  data-testid={`param-${node.id}-${p.key}`}
                  checked={Number(node.getParam(p.key)) >= 0.5}
                  onChange={(e) => { node.setParam(p.key, e.target.checked ? 1 : 0); bump(); }}
                  className="accent-[var(--syn-accent)]"
                />
              </label>
            ) : (() => {
              const bus = busRef.current!;
              const base = bus.getBase(node, p.key);
              const mod = bus.getMod(node, p.key);
              const dec = (p.step ?? 1) < 1 ? 2 : 0;
              // cycle the route: off → bass → loud → treble → beat → motion → bright → off
              const cycleMod = () => {
                const order: (ModSource | null)[] = [null, ...MOD_SOURCES];
                const next = order[(order.indexOf(mod?.source ?? null) + 1) % order.length];
                bus.setMod(node, p.key, next ? { source: next, amount: mod?.amount ?? 0.5 } : null);
                bump();
              };
              return (
                <div key={p.key} className="space-y-0.5">
                  <div className={`flex justify-between items-center font-mono text-[9px] uppercase tracking-wider ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>
                    <span>{p.label}</span>
                    <span className="flex items-center gap-1.5">
                      {p.reactive && (
                        <button
                          type="button"
                          title="Audio modulation source (PLAN §4.4: base + audio × amount)"
                          data-testid={`mod-src-${node.id}-${p.key}`}
                          onClick={cycleMod}
                          className={`px-1 rounded border text-[8px] font-bold cursor-pointer ${
                            mod ? 'border-amber-400 bg-amber-400/20 text-amber-400' : 'border-violet-500/25 text-neutral-500 hover:text-violet-500'
                          }`}
                        >
                          {mod ? mod.source.toUpperCase() : '~'}
                        </button>
                      )}
                      <span className="text-violet-500 font-bold">{base.toFixed(dec)}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    data-testid={`param-${node.id}-${p.key}`}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    value={base}
                    onChange={(e) => { bus.setBase(node, p.key, parseFloat(e.target.value)); bump(); }}
                    className="w-full h-1 accent-[var(--syn-accent)] cursor-pointer"
                  />
                  {mod && (
                    <div className="flex items-center gap-1.5">
                      <span className={`font-mono text-[8px] uppercase ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>AMT</span>
                      <input
                        type="range"
                        data-testid={`mod-amt-${node.id}-${p.key}`}
                        min={-1}
                        max={1}
                        step={0.05}
                        value={mod.amount}
                        onChange={(e) => { bus.setMod(node, p.key, { source: mod.source, amount: parseFloat(e.target.value) }); bump(); }}
                        className="flex-1 h-1 accent-amber-400 cursor-pointer"
                      />
                      <span data-testid={`mod-val-${node.id}-${p.key}`} className="font-mono text-[8px] text-amber-400 w-9 text-right">
                        {Number(node.getParam(p.key)).toFixed(dec)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-[600px]">
      {/* toolbar */}
      <div className={`flex items-center justify-between gap-3 px-4 md:px-6 py-3 border-b transition-colors duration-300 ${isDayMode ? 'border-violet-500/15 bg-[#f7f5f0]' : 'border-violet-500/20 bg-black'}`}>
        <button
          type="button"
          onClick={onBack}
          className={`flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.2em] uppercase px-3 py-2 rounded border transition-colors cursor-pointer ${isDayMode ? 'border-violet-500/40 text-violet-700 hover:bg-violet-500/10' : 'border-violet-500/30 text-violet-500 hover:bg-violet-500/10'}`}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to console
        </button>
        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest">
          <span className={`flex items-center gap-1.5 font-extrabold ${isDayMode ? 'text-neutral-900' : 'text-white'}`}>
            <Link2 className="w-3 h-3 text-violet-500" />
            LAB <span className="text-violet-500">// SYNENGINE</span>
          </span>
          <span className={isDayMode ? 'text-neutral-600' : 'text-neutral-400'}>
            FPS <b className="text-violet-500" data-testid="chain-fps">{fps}</b>
          </span>
          <span
            title="Adaptive internal render resolution (§6): steps down when the frame rate falls under budget"
            className={isDayMode ? 'text-neutral-600' : 'text-neutral-400'}
          >
            RES <b className={resPct < 100 ? 'text-amber-400' : 'text-violet-500'} data-testid="chain-res">{resPct}%</b>
          </span>
          <button
            type="button"
            data-testid="chain-master"
            onClick={runMasterExport}
            disabled={exporting}
            title={sourceKind === 'video' ? 'Render the whole chain to MP4 at native resolution' : 'Master export needs a video source'}
            className="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-widest uppercase px-3 py-1.5 rounded bg-violet-500 text-black hover:bg-violet-400 disabled:opacity-40 cursor-pointer"
          >
            <Diamond className="w-3 h-3" /> Master MP4
          </button>
          {exportMsg && (
            <span data-testid="chain-export-msg" className="text-[9px] text-violet-500 normal-case tracking-normal max-w-56 truncate">{exportMsg}</span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col lg:flex-row min-h-0">
        {/* stage */}
        <div className="flex-1 bg-black flex items-center justify-center p-3 min-h-[320px] relative">
          <canvas ref={canvasRef} data-testid="chain-canvas" className="max-w-full max-h-full border border-violet-500/20" />
          {sourceKind === 'none' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
              <div className="font-mono text-[11px] tracking-[0.3em] text-violet-500 font-bold">NO SIGNAL</div>
              <div className="font-mono text-[9px] tracking-widest text-neutral-500 uppercase">Load a video or photo, or start the webcam →</div>
            </div>
          )}
        </div>

        {/* control rail */}
        <div className={`w-full lg:w-72 shrink-0 border-t lg:border-t-0 lg:border-l p-4 space-y-4 overflow-y-auto scrollbar-thin transition-colors ${isDayMode ? 'border-violet-500/15 bg-[#faf9f5]' : 'border-violet-500/15 bg-[#080808]'}`}>
          <div className="space-y-2">
            <div className="font-mono text-[9px] font-extrabold tracking-widest text-violet-500 uppercase border-b border-violet-500/15 pb-1">Source</div>
            <div className="flex gap-2">
              <button
                onClick={() => fileRef.current?.click()}
                title="Load a video or a photo"
                className="flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border border-violet-500/30 text-violet-500 hover:bg-violet-500/10 cursor-pointer"
              >
                <Film className="w-3 h-3" /> Video / Photo
              </button>
              <button
                onClick={toggleWebcam}
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase px-2 py-2 rounded border cursor-pointer ${sourceKind === 'webcam' ? 'border-violet-500 bg-violet-500 text-black' : 'border-violet-500/30 text-violet-500 hover:bg-violet-500/10'}`}
              >
                <Camera className="w-3 h-3" /> {sourceKind === 'webcam' ? 'Stop' : 'Webcam'}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="video/*,image/*"
              data-testid="chain-file"
              className="hidden"
              onChange={(e) => loadSourceFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <button
                onClick={toggleAudio}
                data-testid="audio-toggle"
                title="React to the microphone"
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase whitespace-nowrap px-2 py-2 rounded border cursor-pointer ${
                  audioMode === 'mic' ? 'border-amber-400 bg-amber-400/15 text-amber-400' : 'border-violet-500/30 text-violet-500 hover:bg-violet-500/10'
                }`}
              >
                <Mic className="w-3 h-3" /> {audioMode === 'mic' ? 'Live' : 'Mic'}
              </button>
              <button
                onClick={() => audioFileRef.current?.click()}
                data-testid="audio-file-btn"
                title="React to a music track"
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase whitespace-nowrap px-2 py-2 rounded border cursor-pointer ${
                  transport ? 'border-amber-400 bg-amber-400/15 text-amber-400' : 'border-violet-500/30 text-violet-500 hover:bg-violet-500/10'
                }`}
              >
                <Music className="w-3 h-3" /> Track
              </button>
              <button
                onClick={toggleClipAudio}
                data-testid="audio-clip"
                disabled={sourceKind !== 'video'}
                title={sourceKind === 'video' ? "React to the source video's own soundtrack" : 'Needs a video source'}
                className={`flex-1 flex items-center justify-center gap-1.5 font-mono text-[9px] font-bold tracking-wider uppercase whitespace-nowrap px-2 py-2 rounded border cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                  audioMode === 'clip' ? 'border-amber-400 bg-amber-400/15 text-amber-400' : 'border-violet-500/30 text-violet-500 hover:bg-violet-500/10'
                }`}
              >
                <AudioLines className="w-3 h-3" /> Clip
              </button>
            </div>
            <input
              ref={audioFileRef}
              type="file"
              accept="audio/*"
              data-testid="audio-file"
              className="hidden"
              onChange={(e) => loadAudioFile(e.target.files?.[0] ?? null)}
            />
            {transport && (
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => audioRef.current!.togglePlay()}
                    data-testid="audio-playpause"
                    className="p-1 rounded border border-amber-400/40 text-amber-400 hover:bg-amber-400/10 cursor-pointer"
                  >
                    {transport.playing ? <Pause className="w-3 h-3" /> : <PlayIcon className="w-3 h-3" />}
                  </button>
                  <span data-testid="audio-track-name" className={`flex-1 truncate font-mono text-[8px] ${isDayMode ? 'text-neutral-600' : 'text-neutral-400'}`}>{transport.name}</span>
                  <button
                    onClick={() => audioRef.current!.setLoop(!transport.loop)}
                    title="Loop"
                    className={`p-1 rounded border cursor-pointer ${transport.loop ? 'border-amber-400 text-amber-400' : 'border-violet-500/25 text-neutral-500'}`}
                  >
                    <Repeat className="w-3 h-3" />
                  </button>
                </div>
                <input
                  type="range"
                  data-testid="audio-seek"
                  min={0}
                  max={transport.duration || 0}
                  step={0.1}
                  value={transport.currentTime}
                  onChange={(e) => audioRef.current!.seek(parseFloat(e.target.value))}
                  className="w-full h-1 accent-amber-400 cursor-pointer"
                />
              </div>
            )}
            {audioOn && (
              <div className="space-y-1">
                {(['bass', 'loud', 'treble'] as const).map((band) => (
                  <div key={band} className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                    <span className={`w-9 ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>{band}</span>
                    <div className={`flex-1 h-1 rounded overflow-hidden ${isDayMode ? 'bg-neutral-200' : 'bg-white/10'}`}>
                      <div className="h-full bg-amber-400 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(signals[band] * 100))}%` }} />
                    </div>
                    <span data-testid={`audio-${band}`} className="w-6 text-right text-amber-400">{Math.round(signals[band] * 100)}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                  <span className={isDayMode ? 'text-neutral-500' : 'text-neutral-500'}>beat</span>
                  <span
                    className="w-2 h-2 rounded-full bg-amber-400"
                    style={{ opacity: 0.15 + signals.beat * 0.85 }}
                  />
                  <span className={`ml-auto ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>
                    BPM <b className="text-amber-400" data-testid="audio-bpm">{signals.bpm ?? '--'}</b>
                  </span>
                </div>
              </div>
            )}
            {sourceKind !== 'none' && (
              <div className="space-y-1">
                {(['motion', 'bright'] as const).map((band) => (
                  <div key={band} className="flex items-center gap-1.5 font-mono text-[8px] uppercase">
                    <span className={`w-9 ${isDayMode ? 'text-neutral-500' : 'text-neutral-500'}`}>{band}</span>
                    <div className={`flex-1 h-1 rounded overflow-hidden ${isDayMode ? 'bg-neutral-200' : 'bg-white/10'}`}>
                      <div className="h-full bg-violet-500 transition-[width] duration-100" style={{ width: `${Math.min(100, Math.round(signals[band] * 100))}%` }} />
                    </div>
                    <span data-testid={`signal-${band}`} className="w-6 text-right text-violet-500">{Math.round(signals[band] * 100)}</span>
                  </div>
                ))}
              </div>
            )}
            {(audioOn || sourceKind !== 'none') && (
              <p className={`font-mono text-[8px] leading-relaxed ${isDayMode ? 'text-neutral-500' : 'text-neutral-600'}`}>
                Route any signal onto a reactive parameter with the <b className="text-amber-400">~</b> chip next to its value.
              </p>
            )}
            {segState !== 'off' && (
              <div data-testid="seg-status" className={`font-mono text-[8px] uppercase tracking-widest ${
                segState === 'ready' ? 'text-violet-500' : segState === 'loading' ? 'text-amber-400' : 'text-red-400'
              }`}>
                SEG: {segState === 'ready' ? 'READY' : segState === 'loading' ? 'LOADING MODEL…' : 'UNAVAILABLE'}
              </div>
            )}
            {error && <div className="font-mono text-[9px] text-red-400">{error}</div>}
          </div>

          {/* chain presets: full rack state in localStorage (decision #9) */}
          <div className="space-y-2">
            <div className="font-mono text-[9px] font-extrabold tracking-widest text-violet-500 uppercase border-b border-violet-500/15 pb-1">Presets</div>
            <div className="flex gap-1.5">
              <input
                type="text"
                data-testid="preset-name"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
                placeholder="preset name"
                className={`flex-1 min-w-0 font-mono text-[9px] px-2 py-1.5 rounded border bg-transparent outline-none ${
                  isDayMode ? 'border-neutral-300 text-neutral-800 placeholder-neutral-400' : 'border-violet-500/25 text-white placeholder-neutral-600'
                }`}
              />
              <button
                onClick={savePreset}
                data-testid="preset-save"
                disabled={!presetName.trim()}
                className="flex items-center gap-1 font-mono text-[9px] font-bold uppercase px-2 py-1.5 rounded border border-violet-500/30 text-violet-500 hover:bg-violet-500/10 disabled:opacity-30 cursor-pointer"
              >
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
            {presets.length === 0 && (
              <p className={`font-mono text-[8px] ${isDayMode ? 'text-neutral-400' : 'text-neutral-600'}`}>
                No saved chains yet — the whole rack (order, bypass, params, routes) is stored.
              </p>
            )}
            {presets.map((p) => (
              <div key={p.name} className={`flex items-center gap-1.5 font-mono text-[9px] px-2 py-1.5 rounded border ${isDayMode ? 'border-neutral-200 bg-white' : 'border-white/10 bg-black/40'}`}>
                <span className={`flex-1 truncate ${isDayMode ? 'text-neutral-800' : 'text-white'}`}>{p.name}</span>
                <button
                  onClick={() => loadPreset(p)}
                  data-testid={`preset-load-${p.name}`}
                  className="px-1.5 py-0.5 rounded bg-violet-500 text-black font-bold uppercase text-[8px] hover:bg-violet-400 cursor-pointer"
                >
                  Load
                </button>
                <button
                  onClick={() => deletePreset(p.name)}
                  data-testid={`preset-del-${p.name}`}
                  title="Delete preset"
                  className="p-1 rounded border border-violet-500/20 text-neutral-500 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between font-mono text-[9px] font-extrabold tracking-widest text-violet-500 uppercase border-b border-violet-500/15 pb-1">
              <span>Signal chain</span>
              <span className={isDayMode ? 'text-neutral-500' : 'text-neutral-500'}>SOURCE → {chain.filter((n) => n.enabled).map((n) => n.id.toUpperCase()).join(' → ') || 'OUT'} → OUT</span>
            </div>
            {chain.map((n, i) => nodeCard(n, i))}
          </div>

          <p className={`font-mono text-[8px] leading-relaxed ${isDayMode ? 'text-neutral-500' : 'text-neutral-600'}`}>
            Native SynEngine nodes — one WebGL context, effects composed in series on the same frame.
            The full standalone effects remain available from the library while porting continues.
          </p>
        </div>
      </div>
    </div>
  );
});

export default ChainLab;
