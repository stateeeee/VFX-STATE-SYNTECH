import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pause, Play as PlayIcon, Repeat, Trash2, Upload } from 'lucide-react';
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
// the opened-effect look (topbar, viewport brackets, metallic sections), scoped under .syn-fxlab
import './chainLab.css';

export interface ChainLabProps {
  isDayMode: boolean;
  /**
   * The shell keeps the Lab mounted once opened and only hides it (Home, an
   * opened effect, the Lab toggle): false = hidden. While hidden the render
   * loop is paused (unless a Master export or a Gemini capture needs it) and
   * the UI mirror stops; params, routes, source and audio choice all stay,
   * the media pause with the loop (the webcam and the mic switch off — see
   * parkMedia).
   */
  visible?: boolean;
  /**
   * The wired chain owned by the shell (node graph wiring order). The rack
   * mirrors it live: listed effects run in this order, the rest sit
   * bypassed at the tail. Rack edits flow back up via onChainChange.
   */
  chain?: ModuleId[];
  /** rack toggles / reorders lift the new enabled order back to the shell */
  onChainChange?: (chain: ModuleId[]) => void;
  /**
   * a saved chain preset to load (Projects nav): applied on mount, and again
   * whenever `seq` changes on a Lab that is already mounted
   */
  presetRequest?: { name: string; seq: number } | null;
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
  { isDayMode, visible = true, chain: chainProp, onChainChange, presetRequest, initialSource, onSourcePicked },
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
  // what the INPUT pill shows (sourceNameRef is what the Gemini handle reads)
  const [sourceName, setSourceName] = useState('');
  const nameSource = (name: string) => {
    sourceNameRef.current = name;
    setSourceName(name);
  };
  const [presetOpen, setPresetOpen] = useState(false);
  // open / closed per effect (node id) and per sub-section ('id::group'):
  // everything starts closed; kept across reorders, forgotten when the effect
  // leaves the chain (re-added, it comes back closed — see the chainKey effect)
  const [openFx, setOpenFx] = useState<Record<string, boolean>>({});
  const [openGrp, setOpenGrp] = useState<Record<string, boolean>>({});

  /* ── render loop vs visibility ──
     Hidden (Home / an opened effect / Lab toggled off) the loop is paused:
     nothing on screen needs it. Two things keep it running anyway: a Master
     export drives renderFrame itself (the loop must stay OFF then, it is the
     export's to restart), and a Gemini capture still in flight (an Agent run
     started in the Lab, then Home) needs live frames and live signals —
     `holdRef` counts those. Every change of any of the three goes through
     syncLoop. engine.start() is idempotent.
     The media follow the loop (parkMedia / unparkMedia): when it pauses, the
     source video and a playing Track are paused — and remembered, so only
     those resume when it runs again (Clip audio is the video's own sound: it
     goes silent and comes back with it, its mode untouched); the webcam and
     the mic are switched off for good (camera light / mic off while nobody
     looks — the operator presses them again). A photo needs nothing. Parking
     waits for the export / the last hold like the loop does. */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const holdRef = useRef(0);
  const parkedVideoRef = useRef<HTMLVideoElement | null>(null);
  const parkedTrackRef = useRef(false);
  const parkMedia = () => {
    const engine = engineRef.current;
    const audio = audioRef.current!;
    if (!engine) return;
    if (engine.kind === 'webcam') {
      engine.stopSource(); // same as the Webcam button's stop
      setSourceKind('none');
    }
    if (audio.mode === 'mic') {
      audio.stop(); // same as the Mic button's stop
      setAudioOn(false);
      setAudioMode('off');
    }
    const v = engine.kind === 'video' ? engine.video : null;
    if (v && !v.paused) {
      v.pause();
      parkedVideoRef.current = v;
    }
    if (audio.pauseFile()) parkedTrackRef.current = true;
  };
  const unparkMedia = () => {
    const engine = engineRef.current;
    const v = parkedVideoRef.current;
    parkedVideoRef.current = null;
    // only the element that was paused, and only if it is still the source
    if (v && engine && engine.video === v && v.paused) void v.play().catch(() => {});
    if (parkedTrackRef.current) {
      parkedTrackRef.current = false;
      audioRef.current!.resumeFile();
    }
  };
  const syncLoop = () => {
    const engine = engineRef.current;
    if (!engine || exportingRef.current) return;
    if (visibleRef.current || holdRef.current > 0) {
      engine.start();
      unparkMedia();
    } else {
      engine.stop();
      parkMedia();
    }
  };
  /** run a capture with the loop guaranteed on (released when it settles) */
  const withLiveLoop = <T,>(run: () => Promise<T>): Promise<T> => {
    holdRef.current++;
    syncLoop();
    return run().finally(() => {
      holdRef.current = Math.max(0, holdRef.current - 1);
      syncLoop();
    });
  };
  // dev-only tap for the parity/verification protocol (06-VERIFICATION):
  // lets headless runs pin the resolution and drive the source deterministically;
  // `lab` is the same LabHandle the Gemini panel holds. Re-published each time
  // the Lab is shown again (the suites reset it to spot "the Lab is up").
  const publishDevTap = () => {
    const engine = engineRef.current;
    if (!engine || !(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) return;
    (window as unknown as Record<string, unknown>).__SYN = {
      engine, audio: audioRef.current, bus: busRef.current, mask: maskRef.current, lab: labRef.current,
    };
  };

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
    rack.filter((id) => NODE_FACTORY[id]).forEach((id) => {
      const node = NODE_FACTORY[id]();
      node.enabled = active.includes(id);
      engine.addNode(node);
    });
    // manual/auto control matrix (PLAN §4.4): bases live in the bus, audio
    // and video signal offsets are layered on top at the start of every frame
    busRef.current!.snapshot(engine.chain);
    // opened from the Projects nav: restore the requested saved chain and
    // lift its enabled order back up so the node-graph wiring follows
    // (a later request on this mounted Lab is the presetRequest effect's)
    if (presetRequest) {
      presetSeqRef.current = presetRequest.seq;
      const p = readPresets().find((x) => x.name === presetRequest.name);
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
    engineRef.current = engine;
    syncLoop(); // a Lab mounted hidden does not render until shown
    publishDevTap();
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

  // shown / hidden by the shell: pause or resume the loop; the dev tap is
  // published again on every show
  useEffect(() => {
    syncLoop();
    if (visible) publishDevTap();
    else setPresetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Projects nav on a Lab that is already mounted: load the requested preset
  // (the seq changes on every request, so the same name can be asked twice)
  const presetSeqRef = useRef<number | null>(null);
  useEffect(() => {
    if (!presetRequest || !engineRef.current || presetSeqRef.current === presetRequest.seq) return;
    presetSeqRef.current = presetRequest.seq;
    const p = readPresets().find((x) => x.name === presetRequest.name);
    if (p) loadPreset(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRequest?.seq]);

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
    // an effect that left the chain forgets its open sections
    const gone = (k: string) => !active.includes(k.split('::')[0] as ModuleId);
    const prune = (m: Record<string, boolean>) =>
      Object.keys(m).some(gone) ? Object.fromEntries(Object.entries(m).filter(([k]) => !gone(k))) : m;
    setOpenFx(prune);
    setOpenGrp(prune);
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
    nameSource(initialSource?.name ?? '');
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
        syncLoop(); // loaded while the Lab is hidden: the new clip waits paused too
        void retapClip();
      })
      .catch((e) => { if (current()) setError((e as Error).message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource?.url]);

  // low-rate UI mirror of the live signals (meters + modulated readouts)
  useEffect(() => {
    const id = setInterval(() => {
      if (!visibleRef.current) return; // hidden: nothing on screen to mirror into
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
      syncLoop(); // the Lab was hidden while the permission prompt was up: mic off again
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
      syncLoop(); // hidden meanwhile: the track waits paused
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
      // (each capture that reads the OUTPUT or the signals holds the render
      // loop on, so a run started in the Lab still sees live frames if the
      // operator goes Home meanwhile — see withLiveLoop)
      grabPair: (maxSide = 768) => withLiveLoop(() => new Promise((resolve) => {
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
      })),

      // held like the others: on a hidden Lab the clip plays for the window
      grabSourceFrames: (n, maxSide = 768) => withLiveLoop(async () => {
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
      }),

      recordOutputClip: async (sec) => {
        const engine = engineRef.current;
        if (!engine || exportingRef.current || !engine.isReady()) return null;
        const audio = audioRef.current!;
        const stream = audio.getOutputStream();
        const s = Number.isFinite(sec) && sec > 0 ? sec : 4;
        const what = !stream ? ' (no audio)' : audio.mode === 'mic' ? ' with mic audio' : ' with music';
        return withLiveLoop(() => recordClip(engine.canvas, stream, s, `OUTPUT clip ${s}s${what}`));
      },

      signalSummary: (sec) => withLiveLoop(() => new Promise<SignalSummary>((resolve) => {
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
      })),

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
      nameSource(file.name);
      setSourceKind(engine.kind);
      setError(null);
      syncLoop(); // hidden meanwhile: the new clip waits paused
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
      nameSource('webcam');
      // read back, not assumed: a start overtaken by another load leaves that one
      setSourceKind(engine.kind);
      setError(null);
      syncLoop(); // the Lab was hidden while the camera started: camera off again
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
      }
    } catch (e) {
      setExportMsg('✗ ' + (e as Error).message);
    } finally {
      exportingRef.current = false;
      setExporting(false);
      // the live loop comes back only if the Lab is on screen (or a capture
      // holds it): an export finished while the operator was Home stays paused
      syncLoop();
    }
  };

  /* ── render: the Lab looks like an opened effect ─────────────────────
     topbar (logo · INPUT · AUDIO · FPS/RES) + one row of the shared commands
     over [viewport (fixed) | panel (the only thing that scrolls)]. The panel
     lists ONLY the wired chain, in its order: one collapsible section per
     effect (its name bar is sticky while open; clicking it closes it), and
     inside it the effect's controls in closed sub-sections by
     ParamSchema.group, like the standalone panel. Order and bypass live in
     the node graph. */

  // the wired chain, in render order — the only effects the panel lists
  const active = (engineRef.current?.chain ?? []).filter((n) => n.enabled);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const toggleFx = (id: string, head: HTMLElement) => {
    if (openFx[id]) {
      // closing from deep inside a long effect: bring its (now closed) bar
      // back to the top of the panel instead of leaving the view far below it
      const sec = head.closest('section');
      const panel = panelRef.current;
      if (sec && panel && sec.offsetTop < panel.scrollTop) panel.scrollTop = sec.offsetTop;
    }
    setOpenFx((m) => ({ ...m, [id]: !m[id] }));
  };
  const toggleGrp = (k: string) => setOpenGrp((m) => ({ ...m, [k]: !m[k] }));

  /** a node's params in sub-sections, in the order each group first appears;
   *  params without a group gather in 'Parameters' */
  const groupsOf = (node: EngineNode) => {
    const out: { name: string; params: ParamSchema[] }[] = [];
    node.params.forEach((p) => {
      const name = p.group?.trim() || 'Parameters';
      let g = out.find((x) => x.name === name);
      if (!g) {
        g = { name, params: [] };
        out.push(g);
      }
      g.params.push(p);
    });
    return out;
  };
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // the preset popover closes on a click anywhere else
  const presetWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!presetOpen) return;
    const away = (e: PointerEvent) => {
      if (presetWrapRef.current && !presetWrapRef.current.contains(e.target as Node)) setPresetOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [presetOpen]);

  /** one parameter: a switch, or a slider (+ the ~ route chip, + AMT when routed) */
  const control = (node: EngineNode, p: ParamSchema) => {
    if (p.type === 'boolean') {
      const on = Number(node.getParam(p.key)) >= 0.5;
      return (
        <label key={p.key} className={`fxl-switch${on ? ' on' : ''}`} title={p.aiHint}>
          <input
            type="checkbox"
            className="fxl-sr"
            data-testid={`param-${node.id}-${p.key}`}
            checked={on}
            onChange={(e) => { node.setParam(p.key, e.target.checked ? 1 : 0); bump(); }}
          />
          <span className="fxl-led" />
          <span className="fxl-switch-txt">{p.label}</span>
        </label>
      );
    }
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
      <div key={p.key} className="fxl-ctrl">
        <div className="fxl-row">
          <span className="fxl-lbl" title={p.aiHint}>{p.label}</span>
          <span className="fxl-track">
            <input
              type="range"
              className="fxl-slider"
              data-testid={`param-${node.id}-${p.key}`}
              min={p.min}
              max={p.max}
              step={p.step}
              value={base}
              onChange={(e) => { bus.setBase(node, p.key, parseFloat(e.target.value)); bump(); }}
            />
          </span>
          <span className="fxl-val">{base.toFixed(dec)}</span>
          {p.reactive ? (
            <button
              type="button"
              title="Modulation source: base + signal × amount (click to cycle)"
              data-testid={`mod-src-${node.id}-${p.key}`}
              onClick={cycleMod}
              className={`fxl-mod${mod ? ' on' : ''}`}
            >
              {mod ? mod.source.toUpperCase() : '~'}
            </button>
          ) : (
            <span className="fxl-mod-slot" />
          )}
        </div>
        {mod && (
          <div className="fxl-row">
            <span className="fxl-lbl fxl-amt">AMT</span>
            <span className="fxl-track">
              <input
                type="range"
                className="fxl-slider mod"
                data-testid={`mod-amt-${node.id}-${p.key}`}
                min={-1}
                max={1}
                step={0.05}
                value={mod.amount}
                onChange={(e) => { bus.setMod(node, p.key, { source: mod.source, amount: parseFloat(e.target.value) }); bump(); }}
              />
            </span>
            <span data-testid={`mod-val-${node.id}-${p.key}`} className="fxl-val mod">
              {Number(node.getParam(p.key)).toFixed(dec)}
            </span>
            <span className="fxl-mod-slot" />
          </div>
        )}
      </div>
    );
  };

  const inputLabel = sourceKind === 'none'
    ? 'NONE'
    : (sourceKind === 'webcam' ? 'WEBCAM' : sourceName || sourceKind).toUpperCase();
  const audioLabel = audioMode === 'off' ? 'OFF' : audioMode === 'file' ? 'TRACK' : audioMode.toUpperCase();
  const pct = (v: number) => `${Math.min(100, Math.round(v * 100))}%`;

  return (
    <div className="syn-fxlab" data-testid="chain-lab" data-theme={isDayMode ? 'day' : 'night'}>
      {/* #topbar */}
      <div className="fxl-topbar">
        <div className="fxl-logo">LAB</div>
        <div className="fxl-sep" />
        <div className={`fxl-pill${sourceKind !== 'none' ? ' live' : ''}`} data-testid="chain-input" title={sourceName || undefined}>
          <span className="fxl-dot" />
          <span className="fxl-pill-pre">INPUT</span>
          <span className="fxl-pill-val">{inputLabel}</span>
        </div>
        <div className={`fxl-pill${audioOn ? ' amber' : ''}`} data-testid="chain-audio">
          <span className="fxl-dot" />
          <span className="fxl-pill-pre">AUDIO</span>
          <span className="fxl-pill-val">{audioLabel}</span>
        </div>
        {exporting && (
          <div className="fxl-pill rec">
            <span className="fxl-dot" />
            <span className="fxl-pill-val">MASTER</span>
          </div>
        )}
        <div className="fxl-fps">
          <span>FPS <b data-testid="chain-fps">{fps}</b></span>
          <span title="Adaptive internal render resolution (§6): steps down when the frame rate falls under budget">
            RES <b className={resPct < 100 ? 'low' : ''} data-testid="chain-res">{resPct}%</b>
          </span>
        </div>
      </div>

      {/* the shared commands (source, audio, presets, master) */}
      <div className="fxl-cmds">
        <button type="button" className="fxl-btn" onClick={() => fileRef.current?.click()} title="Load a video or a photo">
          Video / Photo
        </button>
        <button
          type="button"
          className={`fxl-btn${sourceKind === 'webcam' ? ' on' : ''}`}
          onClick={toggleWebcam}
          title={sourceKind === 'webcam' ? 'Stop the webcam' : 'Use the webcam'}
        >
          <span className="fxl-led" /> {sourceKind === 'webcam' ? 'Stop cam' : 'Webcam'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,image/*"
          data-testid="chain-file"
          className="hidden"
          onChange={(e) => loadSourceFile(e.target.files?.[0] ?? null)}
        />
        <span className="fxl-gap" />
        {/* the active audio buttons also carry `border-amber-400`: verify-gemini.cjs reads it as "on" */}
        <button
          type="button"
          onClick={toggleAudio}
          data-testid="audio-toggle"
          title="React to the microphone"
          className={`fxl-btn${audioMode === 'mic' ? ' on border-amber-400' : ''}`}
        >
          <span className="fxl-led" /> {audioMode === 'mic' ? 'Live' : 'Mic'}
        </button>
        <button
          type="button"
          onClick={() => audioFileRef.current?.click()}
          data-testid="audio-file-btn"
          title="React to a music track"
          className={`fxl-btn${transport ? ' on border-amber-400' : ''}`}
        >
          <span className="fxl-led" /> Track
        </button>
        <button
          type="button"
          onClick={toggleClipAudio}
          data-testid="audio-clip"
          disabled={sourceKind !== 'video'}
          title={sourceKind === 'video' ? "React to the source video's own soundtrack" : 'Needs a video source'}
          className={`fxl-btn${audioMode === 'clip' ? ' on border-amber-400' : ''}`}
        >
          <span className="fxl-led" /> Clip
        </button>
        <input
          ref={audioFileRef}
          type="file"
          accept="audio/*"
          data-testid="audio-file"
          className="hidden"
          onChange={(e) => loadAudioFile(e.target.files?.[0] ?? null)}
        />
        <span className="fxl-gap" />
        {/* chain presets: the whole rack in localStorage (decision #9) */}
        <div className="fxl-pop-wrap" ref={presetWrapRef}>
          <button
            type="button"
            className={`fxl-btn${presetOpen ? ' on' : ''}`}
            data-testid="preset-toggle"
            onClick={() => setPresetOpen((o) => !o)}
            title="Save or load a chain preset"
          >
            Preset
          </button>
          {presetOpen && (
            <div className="fxl-pop" data-testid="preset-pop">
              <div className="fxl-pop-title">CHAIN PRESETS</div>
              <div className="fxl-pop-row">
                <input
                  type="text"
                  className="fxl-input"
                  data-testid="preset-name"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
                  placeholder="preset name"
                  autoFocus
                />
                <button type="button" className="fxl-btn" onClick={savePreset} data-testid="preset-save" disabled={!presetName.trim()}>
                  Save
                </button>
              </div>
              {presets.length === 0 ? (
                <p className="fxl-pop-note">No saved chains yet — the whole chain (order, params, routes) is stored.</p>
              ) : (
                <div className="fxl-pop-list">
                  {presets.map((p) => (
                    <div key={p.name} className="fxl-pop-item">
                      <span title={p.name}>{p.name}</span>
                      <button
                        type="button"
                        className="fxl-btn"
                        onClick={() => { loadPreset(p); setPresetOpen(false); }}
                        data-testid={`preset-load-${p.name}`}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="fxl-btn"
                        onClick={() => deletePreset(p.name)}
                        data-testid={`preset-del-${p.name}`}
                        title="Delete preset"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="chain-master"
          onClick={runMasterExport}
          disabled={exporting}
          title={sourceKind === 'video' ? 'Render the whole chain to MP4 at native resolution' : 'Master export needs a video source'}
          className="fxl-btn primary"
        >
          ◆ Master MP4
        </button>
        {exportMsg && (
          <span data-testid="chain-export-msg" className={`fxl-msg${exportMsg.startsWith('✗') ? ' err' : ''}`} title={exportMsg}>
            {exportMsg}
          </span>
        )}
      </div>

      <div className="fxl-main">
        {/* left: the one video, fixed — it never scrolls */}
        <div className="fxl-stage-col">
          <div className="fxl-stage">
            <div className="fxl-viewport">
              <canvas ref={canvasRef} data-testid="chain-canvas" className={sourceKind === 'webcam' ? 'fxl-mirror' : undefined} />
            </div>
            <div className="fxl-vignette" />
            <div className="fxl-brackets" />
            {sourceKind === 'none' && (
              <div className="fxl-nosignal">
                <Upload className="fxl-nosignal-icon w-7 h-7" strokeWidth={1.4} />
                <div className="fxl-nosignal-title">NO SIGNAL</div>
                <div className="fxl-nosignal-sub">VIDEO — IMAGE — WEBCAM</div>
                <button type="button" className="fxl-btn" onClick={() => fileRef.current?.click()}>Source</button>
              </div>
            )}
          </div>

          {/* status strip: route · track transport · signals · SEG · errors */}
          <div className="fxl-strip">
            <span className="fxl-route" data-testid="chain-route">
              SOURCE → {active.map((n, i) => <React.Fragment key={n.id}><b>{n.name.toUpperCase()}</b>{i < active.length - 1 ? ' → ' : ''}</React.Fragment>)}
              {active.length ? ' → ' : ''}OUT
            </span>
            {transport && (
              <span className="fxl-group">
                <button
                  type="button"
                  className="fxl-icon-btn on"
                  onClick={() => audioRef.current!.togglePlay()}
                  data-testid="audio-playpause"
                  title={transport.playing ? 'Pause the track' : 'Play the track'}
                >
                  {transport.playing ? <Pause /> : <PlayIcon />}
                </button>
                <span data-testid="audio-track-name" className="fxl-track-name" title={transport.name}>{transport.name}</span>
                <input
                  type="range"
                  className="fxl-slider mod"
                  style={{ width: 70 }}
                  data-testid="audio-seek"
                  min={0}
                  max={transport.duration || 0}
                  step={0.1}
                  value={transport.currentTime}
                  onChange={(e) => audioRef.current!.seek(parseFloat(e.target.value))}
                />
                <button
                  type="button"
                  className={`fxl-icon-btn${transport.loop ? ' on' : ''}`}
                  onClick={() => audioRef.current!.setLoop(!transport.loop)}
                  title="Loop"
                >
                  <Repeat />
                </button>
              </span>
            )}
            {audioOn && (
              <span className="fxl-group">
                {(['bass', 'loud', 'treble'] as const).map((band) => (
                  <span key={band} className="fxl-meter" title={band}>
                    {band.slice(0, 1)}
                    <span className="fxl-meter-bar"><i style={{ width: pct(signals[band]) }} /></span>
                    <b data-testid={`audio-${band}`}>{Math.round(signals[band] * 100)}</b>
                  </span>
                ))}
                <span className="fxl-beat" style={{ opacity: 0.15 + signals.beat * 0.85 }} title="beat" />
                <span>BPM <b data-testid="audio-bpm" style={{ color: 'var(--syn-fx-t4)', fontWeight: 400 }}>{signals.bpm ?? '--'}</b></span>
              </span>
            )}
            {sourceKind !== 'none' && (
              <span className="fxl-group">
                {(['motion', 'bright'] as const).map((band) => (
                  <span key={band} className="fxl-meter video" title={band}>
                    {band === 'motion' ? 'MOT' : 'BRI'}
                    <span className="fxl-meter-bar"><i style={{ width: pct(signals[band]) }} /></span>
                    <b data-testid={`signal-${band}`}>{Math.round(signals[band] * 100)}</b>
                  </span>
                ))}
              </span>
            )}
            {segState !== 'off' && (
              <span
                data-testid="seg-status"
                className={segState === 'ready' ? 'fxl-seg-ready' : segState === 'loading' ? 'fxl-seg-loading' : 'fxl-seg-error'}
              >
                SEG: {segState === 'ready' ? 'READY' : segState === 'loading' ? 'LOADING MODEL…' : 'UNAVAILABLE'}
              </span>
            )}
            {error && <span className="fxl-err" data-testid="chain-error">{error}</span>}
          </div>
        </div>

        {/* right: the effects of the wired chain — the only part that scrolls */}
        <div className="fxl-panel" ref={panelRef} data-testid="chain-panel">
          {active.length === 0 ? (
            <div className="fxl-empty" data-testid="chain-empty">
              No effects in the chain.<br />
              Add effects with <b>+ Add Node</b> in the node graph and wire them INPUT → … → OUTPUT.
            </div>
          ) : (
            active.map((node, i) => {
              const open = !!openFx[node.id];
              return (
                <section key={node.id} className={`fxl-fx${open ? ' open' : ''}`} data-testid={`fx-${node.id}`}>
                  <button
                    type="button"
                    className={`fxl-fx-head${open ? '' : ' collapsed'}`}
                    aria-expanded={open}
                    data-testid={`fx-head-${node.id}`}
                    title={open ? `Close ${node.name}` : `Open ${node.name}`}
                    onClick={(e) => toggleFx(node.id, e.currentTarget)}
                  >
                    <span className="fxl-fx-idx">{String(i + 1).padStart(2, '0')}</span>
                    <span className="fxl-fx-name">{node.name.toUpperCase()}</span>
                    <span className="fxl-chev">▼</span>
                  </button>
                  {open && groupsOf(node).map((g) => {
                    const k = `${node.id}::${g.name}`;
                    const gOpen = !!openGrp[k];
                    return (
                      <div key={g.name} className={`fxl-sec${gOpen ? ' open' : ''}`}>
                        <button
                          type="button"
                          className={`fxl-sec-head${gOpen ? '' : ' collapsed'}`}
                          aria-expanded={gOpen}
                          data-testid={`fx-sec-${node.id}-${slug(g.name)}`}
                          onClick={() => toggleGrp(k)}
                        >
                          <span className="fxl-sec-mark" />
                          <span className="fxl-sec-title">{g.name}</span>
                          <span className="fxl-chev">▼</span>
                        </button>
                        {gOpen && <div className="fxl-sec-body">{g.params.map((p) => control(node, p))}</div>}
                      </div>
                    );
                  })}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});

export default ChainLab;
