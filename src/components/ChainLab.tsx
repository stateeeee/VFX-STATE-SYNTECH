import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Pause, Play as PlayIcon, Repeat, Trash2, Upload } from 'lucide-react';
import { AudioEngine, AudioMode, FileTransport } from '../engine/AudioEngine';
import { VideoAnalyzer } from '../engine/VideoAnalyzer';
import { ModuleId } from '../types';
import {
  AgentPlan, ChainState, LabHandle, MediaPart, ParamDesc, PlanUndo, SignalSummary, SourceKindT, Stat,
  LOCKED_CONTROL_PATTERN, LOCKED_GROUPS, PARAM_FLOORS,
} from '../ai/contract';
import { elementToJpeg } from '../ai/capture';
import { labFrameSrc } from '../effects-registry';
import { EFFECT_META } from './NodalComposition';
import { SynLabApi, SynLabParam, readEffectSettings, synLabOf } from '../lab/synlab';
import { ChainPresetV2, StoredPreset, isV2, presetChain, readPresets, writePresets } from '../lab/presets';
import { MasterRecorder, recordVideoClip } from '../lab/record';
// the opened-effect look (LAB strip, stage, transport, status line), scoped under .syn-fxlab
import './chainLab.css';

export interface ChainLabProps {
  isDayMode: boolean;
  /**
   * The shell keeps the Lab mounted once opened and only hides it (Home, an
   * opened effect, the Lab toggle): false = hidden. While hidden the INPUT is
   * parked (video + track paused, webcam / mic released — see parkMedia) so the
   * chain idles, unless a Master export or a Gemini capture holds it live.
   */
  visible?: boolean;
  /** The wired chain owned by the shell (node graph wiring order): one Lab node per id, in this order. */
  chain?: ModuleId[];
  /** a preset load lifts its chain back up to the shell (the node graph follows) */
  onChainChange?: (chain: ModuleId[]) => void;
  /** a saved chain preset to load (Projects nav): applied on mount, and whenever `seq` changes */
  presetRequest?: { name: string; seq: number } | null;
  /**
   * Source shared with the dashboard's Nodal Composition — a video or a still
   * photo. The Lab's INPUT plays exactly this source; picking a new file here
   * lifts it back up through onSourcePicked so the dashboard follows.
   */
  initialSource?: { url: string; name: string; kind?: 'video' | 'image' } | null;
  onSourcePicked?: (file: File) => void;
  /** filled with the Lab's AudioEngine, so the sidebar level meter can read it */
  audioEngineRef?: React.MutableRefObject<AudioEngine | null>;
}

/* ═══════════════════════════════════════════════════════════════════════
   LAB v2 — a chain of the REAL effects (operator decision 2026-10-28,
   "option 1"). Every node is the standalone effect (public/effects/<id>) in a
   same-origin iframe with its whole interface; the shell only plumbs streams:

       INPUT ──stream──▶ node 1 ──captureStream──▶ node 2 ──▶ … ──▶ OUTPUT

   through each effect's window.SynLab (public/effects/shared/syn-lab.js):
   setVideoStream (an external source — not the webcam path, no mirror),
   captureStream (its output canvas), setAudioStream (the Lab's audio, for its
   own reactivity). All iframes sit in the same rect; the selected tab is on
   top, the others keep rendering underneath (never display:none). An iframe
   is made when its node is wired and kept across re-orders (only the streams
   are re-plumbed); it goes when the node leaves the chain.

   The INPUT is shell-owned: a <video> (file), a canvas (photo) or the webcam
   stream. AudioEngine stays the Lab's audio owner (clip / track / mic, the
   sidebar meter's tap, BPM). The ref is the Gemini LabHandle, built on SynLab.
   ═══════════════════════════════════════════════════════════════════════ */

/** an iframe whose effect never registers SynLab is reported (and bypassed) after this */
const LINK_TIMEOUT_MS = 15000;
/** frame budget of a Lab node that feeds what is on screen (or the Master / a Gemini capture):
 *  SynLab.setFrameBudget(LAB_FPS). The Master records the OUTPUT at 30 fps (record.ts
 *  captureStream(30)), so 30 never starves an export. Nodes nobody watches get 0 (paused). */
const LAB_FPS = 30;
/** after a node's link comes up, an effect that drops the Lab stream by itself in this window is re-fed */
const RESTORE_GUARD_MS = 4000;
/** photo INPUT: redraw cadence, so its captured track keeps delivering frames */
const PHOTO_REDRAW_MS = 100;
const PHOTO_MAX_SIDE = 1920;
/** Master export of a photo / webcam INPUT (no timeline): a fixed take */
const STILL_TAKE_SEC = 10;
const MASTER_WIDTH = 1920;

const VIDEO_FRAME_GAP_MS = 500;
const WEBCAM_SPAN_MS = 2000;
const MAX_LIVE_FRAMES = 16;
const GRAB_WAIT_MS = 1500;
/** First frame after a hold raised paused budgets: every paused hop has to render once (shader / model
 *  warm-up included) before the OUTPUT shows anything. A grab that gives up early reads to the Gemini
 *  panel as "a Master export is running", so this is generous; an export still stops it at once. */
const FIRST_FRAME_WAIT_MS = 10000;
/** awaitFreshOutput: extra wait for at least one fresh OUTPUT frame on a very slow renderer */
const FRESH_FALLBACK_MS = 3000;
/** LabHandle.measureFps window */
const FPS_WINDOW_MS = 1100;
const HINT_MAX = 160;

const wait = (ms: number) => new Promise<void>((r) => { window.setTimeout(r, ms); });
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const statOf = (xs: number[]): Stat => xs.length
  ? { mean: round3(xs.reduce((a, b) => a + b, 0) / xs.length), peak: round3(Math.max(...xs)) }
  : { mean: 0, peak: 0 };
/** snap to a slider's step grid anchored at min (an <input type=range> does the same) */
const snapTo = (v: number, min: number, max: number, step: number) => {
  if (!(step > 0)) return clamp(v, min, max);
  const dec = (String(step).split('.')[1] ?? '').length;
  return clamp(Number((min + Math.round((v - min) / step) * step).toFixed(Math.min(8, dec + 2))), min, max);
};
const fmtTC = (s: number) => {
  if (!s || !isFinite(s)) return '00:00';
  const p = (n: number) => String(Math.floor(n)).padStart(2, '0');
  return `${p(s / 60)}:${p(s % 60)}`;
};
const LOCKED_RE = new RegExp(LOCKED_CONTROL_PATTERN, 'i');
/** never the AI's: declared locked by the effect, a locked section, or an A/B / mirror / fullscreen control */
const isLockedParam = (p: SynLabParam) =>
  !!p.locked || LOCKED_GROUPS.includes((p.group ?? '').trim().toLowerCase()) || LOCKED_RE.test(p.key) || LOCKED_RE.test(p.label ?? '');
const fxName = (id: ModuleId) => EFFECT_META[id]?.name ?? id.toUpperCase();

/** one Lab node: its iframe and what the shell last plumbed into it */
interface NodeRec {
  id: ModuleId;
  iframe: HTMLIFrameElement | null;
  /** the iframe's window at its last load — a new one means a reload: start over */
  win: Window | null;
  loadedAt: number;
  api: SynLabApi | null;
  inited: boolean;
  /** when its SynLab was first seen ready (see the restore guard in pollLinks) */
  readyAt: number;
  /** the restore guard already re-fed it once */
  refed: boolean;
  /** last stream handed to setVideoStream / setAudioStream (undefined = never) */
  video: MediaStream | null | undefined;
  audio: MediaStream | null | undefined;
  out: MediaStream | null;
  /** last SynLab.setFrameBudget sent to this node's link (null = native; undefined = never sent) */
  budget: number | null | undefined;
}
type LinkState = 'loading' | 'ready' | 'missing';
type Tab = 'input' | 'output' | ModuleId;

interface TransportView { playing: boolean; t: number; dur: number; loop: boolean }

type RvfcVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (h: number) => void };
type CaptureVideo = HTMLVideoElement & { captureStream?: () => MediaStream };

const ChainLab = forwardRef<LabHandle, ChainLabProps>(function ChainLab(
  { isDayMode, visible = true, chain: chainProp, onChainChange, presetRequest, initialSource, onSourcePicked, audioEngineRef },
  ref,
) {
  const audioRef = useRef<AudioEngine | null>(null);
  const videoAnRef = useRef<VideoAnalyzer | null>(null);
  if (!audioRef.current) audioRef.current = new AudioEngine();
  if (audioEngineRef) audioEngineRef.current = audioRef.current;
  if (!videoAnRef.current) videoAnRef.current = new VideoAnalyzer();

  const chain = chainProp ?? [];
  const chainRef = useRef<ModuleId[]>(chain);
  chainRef.current = chain;
  const chainKey = chain.join('|');
  const onChainChangeRef = useRef(onChainChange);
  onChainChangeRef.current = onChainChange;
  const isDayRef = useRef(isDayMode);
  isDayRef.current = isDayMode;

  const fileRef = useRef<HTMLInputElement | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);

  /* ── INPUT elements (all shell-owned) ── */
  const inputVideoRef = useRef<HTMLVideoElement | null>(null);   // a video file; the element Clip audio taps
  const camVideoRef = useRef<HTMLVideoElement | null>(null);     // the webcam, shown clean on the INPUT tab
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null); // a photo, redrawn so its track keeps going
  const photoImgRef = useRef<HTMLImageElement | null>(null);
  const photoTimerRef = useRef(0);
  const camStreamRef = useRef<MediaStream | null>(null);
  const inputStreamRef = useRef<MediaStream | null>(null);
  const outputVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const kindRef = useRef<SourceKindT>('none');
  const [kind, setKind] = useState<SourceKindT>('none');
  const sourceNameRef = useRef('');
  const [sourceName, setSourceName] = useState('');
  /** the file source last loaded (the webcam falls back to it when stopped) */
  const fileSourceRef = useRef<{ url: string; name: string; kind: 'video' | 'image' } | null>(null);
  const loadSeqRef = useRef(0);
  const loopRef = useRef(true);
  const ownUrlRef = useRef<string | null>(null);

  /* ── nodes ── */
  const nodesRef = useRef(new Map<ModuleId, NodeRec>());
  // iframes in a STABLE DOM order (moving an iframe in the DOM reloads it): new nodes append,
  // a node leaving the chain is removed, a re-order only re-plumbs
  const [frameIds, setFrameIds] = useState<ModuleId[]>(() => chain.slice());
  const [links, setLinks] = useState<Partial<Record<ModuleId, LinkState>>>({});
  const pendingSettingsRef = useRef(new Map<ModuleId, unknown>());
  const [tab, setTab] = useState<Tab>(() => chain[0] ?? 'input');
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;

  const [fps, setFps] = useState(0);
  const fpsRef = useRef(0);
  /** frames presented by the OUTPUT <video> since mount (monotonic; the fps meter's rVFC counts them) */
  const outFramesRef = useRef(0);
  /** outFramesRef when a node last went from paused (0) to rendering: what is on the OUTPUT before
   *  that is stale (see awaitFreshOutput) */
  const raisedAtFrameRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const [audioMode, setAudioMode] = useState<AudioMode>('off');
  const [track, setTrack] = useState<FileTransport | null>(null);
  const [tp, setTp] = useState<TransportView>({ playing: false, t: 0, dur: 0, loop: true });
  const [signals, setSignals] = useState({ bass: 0, loud: 0, treble: 0, beat: 0, bpm: null as number | null });
  const [presets, setPresets] = useState<StoredPreset[]>(readPresets);
  const [presetName, setPresetName] = useState('');
  const [presetOpen, setPresetOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const exportingRef = useRef(false);
  const exportStopRef = useRef(false);
  /** > 1 while a Master export renders the effects in an enlarged (scaled-down) frame */
  const [exportScale, setExportScale] = useState(1);
  const audioLogRef = useRef<string[]>([]);
  const lastExportRef = useRef<{ name: string; size: number; type: string; width: number; height: number; audio: boolean; url: string } | null>(null);

  const nameSource = (name: string) => {
    sourceNameRef.current = name;
    setSourceName(name);
  };
  const setKindBoth = (k: SourceKindT) => {
    kindRef.current = k;
    setKind(k);
  };

  /* ═══ PLUMBING ════════════════════════════════════════════════════════
     INPUT → node1.setVideoStream; node(i).captureStream → node(i+1); the last
     node's stream → the OUTPUT <video>. Idempotent (identity checks), so it
     runs on every event that may change a hop AND on a slow poll (an effect
     may swap its output canvas, a track may end). A node with no Lab link (yet)
     is bypassed: its upstream goes on to the next one. */
  const labAudioStream = (): MediaStream | null => {
    const a = audioRef.current!;
    return a.active ? a.getOutputStream() : null;
  };
  const replumb = () => {
    let up: MediaStream | null = inputStreamRef.current;
    const audioS = labAudioStream();
    for (const id of chainRef.current) {
      const rec = nodesRef.current.get(id);
      const api = rec?.api;
      if (!rec || !api) continue;
      try {
        if (rec.video !== up) { api.setVideoStream(up); rec.video = up; }
        if (rec.audio !== audioS) { api.setAudioStream(audioS); rec.audio = audioS; }
        const out = api.captureStream();
        rec.out = out;
        if (out && out.getVideoTracks().length) up = out;
      } catch {
        /* a torn-down frame: the poll will see it */
      }
    }
    outputStreamRef.current = up;
    const ov = outputVideoRef.current;
    if (ov && ov.srcObject !== up) {
      ov.srcObject = up;
      if (up) void ov.play().catch(() => {});
    }
    applyBudgets();
  };

  /** first contact with a node's SynLab: its saved panel (or the preset's), then plumb */
  const initNode = (rec: NodeRec, api: SynLabApi) => {
    rec.api = api;
    rec.inited = true;
    rec.readyAt = performance.now();
    rec.refed = false;
    rec.video = undefined;
    rec.audio = undefined;
    rec.budget = undefined;
    const pending = pendingSettingsRef.current;
    const s = pending.has(rec.id) ? pending.get(rec.id) : readEffectSettings(rec.id);
    pending.delete(rec.id);
    if (s != null) {
      try { api.applySettings(s); } catch { /* the effect keeps its defaults */ }
    }
  };

  /** the link poll: picks up SynLab.ready, notices reloads / missing adapters, re-plumbs */
  const pollLinks = () => {
    const now = performance.now();
    let changed = false;
    const next: Partial<Record<ModuleId, LinkState>> = {};
    nodesRef.current.forEach((rec) => {
      let win: Window | null = null;
      try { win = rec.iframe?.contentWindow ?? null; } catch { win = null; }
      if (win !== rec.win && rec.loadedAt) {
        // navigated or reloaded underneath us: everything we plumbed is gone
        rec.win = win;
        rec.api = null;
        rec.inited = false;
        rec.video = rec.audio = undefined;
        changed = true;
      }
      if (!rec.api) {
        const api = rec.loadedAt ? synLabOf(rec.iframe) : null;
        if (api) {
          initNode(rec, api);
          changed = true;
        }
      }
      // Restore guard: QUADTREE / TIME MACHINE reload a standalone-saved session video ~600 ms after
      // boot (tryRestore), which replaces the Lab stream as if the operator had picked it. Within the
      // first seconds after the link comes up, a node that lost the external source gets it back once
      // more; later, a source picked inside the effect by the operator is respected.
      if (rec.api && rec.video && !rec.refed && now - rec.readyAt < RESTORE_GUARD_MS) {
        let external = true;
        try { external = rec.api.state().external; } catch { external = true; }
        if (!external) { rec.video = undefined; rec.refed = true; changed = true; }
      }
      next[rec.id] = rec.api ? 'ready' : rec.loadedAt && now - rec.loadedAt > LINK_TIMEOUT_MS ? 'missing' : 'loading';
    });
    setLinks((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of keys) if (prev[k as ModuleId] !== next[k as ModuleId]) return next;
      return prev;
    });
    if (changed) replumb();
  };

  const postTheme = (iframe: HTMLIFrameElement | null) => {
    try { iframe?.contentWindow?.postMessage({ type: 'syn:theme', payload: { mode: isDayRef.current ? 'day' : 'night' } }, '*'); } catch { /* not loaded */ }
  };

  // one stable ref callback per node id (a new function each render would detach/attach every time)
  const frameRefCbs = useRef(new Map<ModuleId, (el: HTMLIFrameElement | null) => void>());
  const frameRefOf = (id: ModuleId) => {
    let cb = frameRefCbs.current.get(id);
    if (!cb) {
      cb = (el: HTMLIFrameElement | null) => {
        const map = nodesRef.current;
        if (el) {
          const rec = map.get(id);
          if (rec && rec.iframe === el) return;
          map.set(id, { id, iframe: el, win: null, loadedAt: 0, api: null, inited: false, readyAt: 0, refed: false, video: undefined, audio: undefined, out: null, budget: undefined });
        } else {
          map.delete(id);
        }
      };
      frameRefCbs.current.set(id, cb);
    }
    return cb;
  };
  const onFrameLoad = (id: ModuleId, el: HTMLIFrameElement) => {
    const rec = nodesRef.current.get(id);
    if (!rec || rec.iframe !== el) return;
    rec.loadedAt = performance.now();
    try { rec.win = el.contentWindow; } catch { rec.win = null; }
    rec.api = null;
    rec.inited = false;
    rec.video = rec.audio = undefined;
    postTheme(el);
    pollLinks();
  };

  // the wired chain changed: mount new nodes (append), drop the ones that left, re-plumb
  useEffect(() => {
    setFrameIds((prev) => {
      const kept = prev.filter((id) => chain.includes(id));
      const added = chain.filter((id) => !kept.includes(id));
      return added.length || kept.length !== prev.length ? [...kept, ...added] : prev;
    });
    setTab((t) => (t === 'input' || t === 'output' || chain.includes(t) ? t : chain[0] ?? 'output'));
    replumb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  // link poll + plumbing watchdog (identity checks only: cheap)
  useEffect(() => {
    const t = window.setInterval(pollLinks, 400);
    const onMsg = (ev: MessageEvent) => {
      if (ev.data && typeof ev.data === 'object' && ev.data.type === 'syn:lab-ready') pollLinks();
    };
    window.addEventListener('message', onMsg);
    return () => { window.clearInterval(t); window.removeEventListener('message', onMsg); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { replumb(); }); // after every commit (new iframes, new elements): idempotent

  // contract §2: every Lab iframe follows the shell's day / night (attribute in JSX + this message)
  useEffect(() => {
    nodesRef.current.forEach((rec) => postTheme(rec.iframe));
  }, [isDayMode]);

  /* ═══ INPUT ═══════════════════════════════════════════════════════════ */

  /** the element that shows the INPUT (grabs, the analyser) */
  const inputElement = (): HTMLVideoElement | HTMLCanvasElement | null => {
    const k = kindRef.current;
    if (k === 'video') return inputVideoRef.current;
    if (k === 'webcam') return camVideoRef.current;
    if (k === 'image') return photoCanvasRef.current;
    return null;
  };
  const inputHasFrame = (): boolean => {
    const el = inputElement();
    if (!el) return false;
    if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
    return el.width > 0 && el.height > 0 && !!photoImgRef.current;
  };
  const frameAt = (): string => {
    const k = kindRef.current;
    if (k === 'webcam') return '(live webcam)';
    if (k === 'image') return '(still photo)';
    const v = inputVideoRef.current;
    return v ? `at ${v.currentTime.toFixed(1)}s` : '';
  };

  /** swap the INPUT stream (the old one's capture tracks are ours: stopped; the webcam's are not) */
  const setInputStream = (s: MediaStream | null) => {
    const old = inputStreamRef.current;
    if (old === s) return;
    inputStreamRef.current = s;
    if (old) old.getTracks().forEach((t) => { if (!camStreamRef.current?.getTracks().includes(t)) t.stop(); });
    replumb();
  };

  const captureVideoInput = (v: HTMLVideoElement): MediaStream | null => {
    const cap = (v as CaptureVideo).captureStream;
    if (typeof cap !== 'function') return null;
    try {
      const cs = cap.call(v);
      // only the picture travels down the chain: the sound is the Lab's audio (clip / track / mic)
      cs.getAudioTracks().forEach((t) => t.stop());
      const vt = cs.getVideoTracks();
      return vt.length ? new MediaStream(vt) : null;
    } catch {
      return null;
    }
  };

  const stopPhoto = () => {
    window.clearInterval(photoTimerRef.current);
    photoTimerRef.current = 0;
    photoImgRef.current = null;
  };
  const stopCam = () => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    const cv = camVideoRef.current;
    if (cv) cv.srcObject = null;
  };
  const parkFileVideo = () => {
    const v = inputVideoRef.current;
    if (v && !v.paused) v.pause();
  };

  /* clip audio follows the source: stopped before a swap (AudioEngine also
     notices a src change); a new video turns it on again by itself.
     `clipWantedRef` = the Clip is the chosen input for this video: when the
     video reaches its end with loop off, Chromium ENDS the element's captured
     tracks (AudioEngine drops to off); Play / a seek back picks it up again. */
  const clipWantedRef = useRef(false);
  const releaseClip = () => {
    const audio = audioRef.current!;
    if (audio.mode !== 'clip') return;
    audio.stop();
    setAudioOn(false);
    setAudioMode('off');
  };
  /** Clip audio on for the INPUT video — the Clip button, the auto-start and the Gemini panel all go
   *  through here. AudioEngine.startClip unmutes the element (Chromium 128 captures a muted element as
   *  silence) and keeps its analyser off the speakers: the sound is heard once, from the element. */
  const startClipOn = async (video: HTMLVideoElement): Promise<void> => {
    await audioRef.current!.startClip(video);
    clipWantedRef.current = true;
    setAudioOn(true);
    setAudioMode('clip');
    setError(null);
    replumb(); // the effects get the Lab audio
  };
  /** a video just became the INPUT: its sound is heard (and drives the meter + the effects)
   *  unless the operator is on Track or Mic */
  const autoClip = async () => {
    const audio = audioRef.current!;
    const v = inputVideoRef.current;
    if (kindRef.current !== 'video' || !v || audio.mode === 'mic' || audio.mode === 'file' || audio.mode === 'clip') return;
    try {
      await startClipOn(v);
      setNote(null);
    } catch (e) {
      setNote((e as Error).message); // e.g. "This clip has no audio track"
    }
  };

  const waitMedia = (v: HTMLVideoElement, ms: number) => new Promise<boolean>((resolve) => {
    if (v.readyState >= 2) return resolve(true);
    let timer = 0;
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      v.removeEventListener('loadeddata', on);
      v.removeEventListener('error', off);
      resolve(ok);
    };
    const on = () => done(true);
    const off = () => done(false);
    v.addEventListener('loadeddata', on);
    v.addEventListener('error', off);
    timer = window.setTimeout(() => done(false), ms);
  });

  const loadVideo = async (url: string, name: string): Promise<boolean> => {
    const v = inputVideoRef.current;
    if (!v) return false;
    const seq = ++loadSeqRef.current;
    releaseClip();
    stopCam();
    stopPhoto();
    setInputStream(null);
    v.muted = true; // AudioEngine.startClip unmutes it while Clip is the input
    v.loop = loopRef.current;
    v.src = url;
    v.load();
    const ok = await waitMedia(v, 20000);
    if (seq !== loadSeqRef.current) return false; // a later pick owns the INPUT
    if (!ok) {
      setError(`could not play ${name || 'this video'}`);
      return false;
    }
    fileSourceRef.current = { url, name, kind: 'video' };
    nameSource(name);
    setKindBoth('video');
    setError(null);
    await v.play().catch(() => {});
    if (seq !== loadSeqRef.current) return false;
    setInputStream(captureVideoInput(v));
    syncLoop(); // loaded while the Lab is hidden: parked like the rest
    void autoClip();
    return true;
  };

  const loadPhoto = async (url: string, name: string): Promise<boolean> => {
    const seq = ++loadSeqRef.current;
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch {
      if (seq === loadSeqRef.current) setError(`could not read ${name || 'this photo'}`);
      return false;
    }
    if (seq !== loadSeqRef.current) return false;
    const c = photoCanvasRef.current;
    if (!c) return false;
    releaseClip();
    stopCam();
    stopPhoto();
    parkFileVideo();
    const k = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.max(2, Math.round((img.naturalWidth * k) / 2) * 2);
    c.height = Math.max(2, Math.round((img.naturalHeight * k) / 2) * 2);
    const g = c.getContext('2d');
    const draw = () => {
      if (!g) return;
      g.fillStyle = '#000'; // a transparent PNG flattens over black, like the effects' own clear
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
    };
    draw();
    photoImgRef.current = img;
    photoTimerRef.current = window.setInterval(draw, PHOTO_REDRAW_MS);
    fileSourceRef.current = { url, name, kind: 'image' };
    nameSource(name);
    setKindBoth('image');
    setError(null);
    setInputStream(c.captureStream());
    return true;
  };

  const loadFileSource = (src: { url: string; name: string; kind: 'video' | 'image' }) =>
    src.kind === 'image' ? loadPhoto(src.url, src.name) : loadVideo(src.url, src.name);

  /* A video that reached its end (loop off) has ENDED captured tracks: the chain
     would stay frozen and the Clip silent after Play. On every (re)start the INPUT
     stream is re-captured if it died, and a Clip that was on comes back. */
  const clipRevivingRef = useRef(false);
  const reviveInput = () => {
    const v = inputVideoRef.current;
    if (!v || kindRef.current !== 'video' || !v.src || v.readyState < 2) return;
    const s = inputStreamRef.current;
    // null = deliberately no stream (a load in progress); only a DEAD stream is re-captured
    if (s && s.getVideoTracks().every((t) => t.readyState === 'ended')) setInputStream(captureVideoInput(v));
    const audio = audioRef.current!;
    if (clipWantedRef.current && audio.mode === 'off' && !v.paused && !clipRevivingRef.current) {
      clipRevivingRef.current = true;
      void audio.startClip(v).then(() => { mirror(); replumb(); }).catch(() => {}).finally(() => { clipRevivingRef.current = false; });
    }
  };
  useEffect(() => {
    const v = inputVideoRef.current;
    if (!v) return;
    v.addEventListener('playing', reviveInput);
    v.addEventListener('seeked', reviveInput);
    return () => { v.removeEventListener('playing', reviveInput); v.removeEventListener('seeked', reviveInput); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the dashboard's shared source (single load path: the Lab's own button lifts its pick to the shell)
  const loadedUrlRef = useRef<string | null>(null);
  useEffect(() => {
    const url = initialSource?.url;
    if (!url || loadedUrlRef.current === url) return;
    loadedUrlRef.current = url;
    void loadFileSource({ url, name: initialSource?.name ?? '', kind: initialSource?.kind === 'image' ? 'image' : 'video' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource?.url]);

  const loadSourceFile = async (file: File | null) => {
    if (!file) return;
    if (onSourcePicked) { // embedded: the shell owns the shared source; it flows back through initialSource
      onSourcePicked(file);
      return;
    }
    const url = URL.createObjectURL(file);
    const isImage = file.type ? file.type.startsWith('image/') : /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
    const ok = await loadFileSource({ url, name: file.name, kind: isImage ? 'image' : 'video' });
    if (!ok) { URL.revokeObjectURL(url); return; }
    if (ownUrlRef.current) URL.revokeObjectURL(ownUrlRef.current);
    ownUrlRef.current = url;
  };

  const startWebcam = async () => {
    const seq = ++loadSeqRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    if (seq !== loadSeqRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
    releaseClip();
    stopPhoto();
    parkFileVideo();
    stopCam();
    camStreamRef.current = stream;
    const cv = camVideoRef.current;
    if (cv) {
      cv.srcObject = stream;
      void cv.play().catch(() => {});
    }
    nameSource('webcam');
    setKindBoth('webcam');
    setError(null);
    setInputStream(new MediaStream(stream.getVideoTracks()));
    syncLoop(); // the Lab was hidden while the camera started: released again
  };
  /** webcam off: back to the file source if there is one, else no source */
  const stopWebcam = () => {
    ++loadSeqRef.current;
    stopCam();
    setInputStream(null);
    setKindBoth('none');
    nameSource('');
    const f = fileSourceRef.current;
    if (f) void loadFileSource(f);
  };
  const toggleWebcam = async () => {
    if (kindRef.current === 'webcam') { stopWebcam(); return; }
    try {
      await startWebcam();
    } catch (e) {
      setError('Webcam: ' + (e as Error).message);
    }
  };

  /* ═══ VISIBILITY: hidden → the chain idles ════════════════════════════
     Hidden (Home / an opened effect / Lab toggled off) the INPUT video and a
     playing Track are paused (and remembered), the webcam and the mic are
     released; shown again, only what was playing resumes. A Master export or a
     Gemini capture in flight (`holdRef`) keeps everything live until it ends.
     The effects' render loops follow the frame budget (applyBudgets). The
     signal loop (AudioEngine / VideoAnalyzer ticks) runs only while live. */
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const holdRef = useRef(0);
  const parkedVideoRef = useRef(false);
  const parkedTrackRef = useRef(false);
  const liveRef = useRef(false);
  const rafRef = useRef(0);

  /* ═══ FRAME BUDGET: only the nodes that feed the screen render ════════
     Every node is a same-origin iframe: all their render loops share the
     shell's main thread. So (SynLab.setFrameBudget, 03 §3.1):
       a Master export or a Gemini capture hold  → every node at LAB_FPS
       Lab hidden                               → every node paused (0)
       OUTPUT tab (or the last node's tab)      → every node at LAB_FPS
       effect tab k                             → nodes 0..k at LAB_FPS, the rest 0
       INPUT tab                                → every node 0 (INPUT shows the source only)
     When exactly ONE node renders and nothing holds the Lab (no export, no
     capture) it runs native (null): a single effect keeps its v0.12.0
     smoothness. Identity-checked per node, so it is called freely: from
     replumb (every commit, the polls), syncLoop (visibility, hold, export).
     A node raised from 0 marks the OUTPUT stale (raisedAtFrameRef) until
     fresh frames went through the chain (awaitFreshOutput). */
  const applyBudgets = () => {
    const ids = chainRef.current;
    const t = tabRef.current;
    let upto: number; // nodes with chain index <= upto render
    const held = holdRef.current > 0 || exportingRef.current;
    if (held) upto = ids.length - 1;
    else if (!visibleRef.current || t === 'input') upto = -1;
    else if (t === 'output') upto = ids.length - 1;
    else {
      const k = ids.indexOf(t);
      upto = k >= 0 ? k : ids.length - 1; // a tab that just left the chain: keep everything live
    }
    const rendering = Math.min(upto + 1, ids.length);
    const run: number | null = !held && rendering === 1 ? null : LAB_FPS;
    nodesRef.current.forEach((rec) => {
      const api = rec.api;
      if (!api || typeof api.setFrameBudget !== 'function') return;
      const i = ids.indexOf(rec.id);
      const want = i >= 0 && i <= upto ? run : 0;
      if (rec.budget === want) return;
      try {
        api.setFrameBudget(want);
        if (rec.budget === 0 && want !== 0) raisedAtFrameRef.current = outFramesRef.current;
        rec.budget = want;
      } catch { /* a torn-down frame: the poll will see it */ }
    });
  };

  const signalTick = (now: number) => {
    audioRef.current!.tick(now);
    const k = kindRef.current;
    const va = videoAnRef.current!;
    va.tick(k === 'image' ? photoImgRef.current : k === 'video' ? inputVideoRef.current : k === 'webcam' ? camVideoRef.current : null);
    rafRef.current = requestAnimationFrame(signalTick);
  };
  const parkMedia = () => {
    const audio = audioRef.current!;
    if (kindRef.current === 'webcam') stopWebcam(); // camera released; back to the loaded file, if any
    if (audio.mode === 'mic') {
      audio.stop();
      setAudioOn(false);
      setAudioMode('off');
      replumb();
    }
    const v = inputVideoRef.current;
    if (kindRef.current === 'video' && v && !v.paused) {
      v.pause();
      parkedVideoRef.current = true;
    }
    if (audio.pauseFile()) parkedTrackRef.current = true;
  };
  const unparkMedia = () => {
    const v = inputVideoRef.current;
    if (parkedVideoRef.current && v && kindRef.current === 'video' && v.paused) void v.play().catch(() => {});
    parkedVideoRef.current = false;
    if (parkedTrackRef.current) {
      parkedTrackRef.current = false;
      audioRef.current!.resumeFile();
    }
  };
  const syncLoop = () => {
    applyBudgets();
    const live = visibleRef.current || holdRef.current > 0 || exportingRef.current;
    if (live === liveRef.current) {
      if (!live) parkMedia(); // a source loaded while hidden: park it too
      return;
    }
    liveRef.current = live;
    if (live) {
      unparkMedia();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(signalTick);
    } else {
      cancelAnimationFrame(rafRef.current);
      parkMedia();
    }
  };
  /** run a capture with the chain guaranteed live (released when it settles) */
  const withLiveLoop = <T,>(run: () => Promise<T>): Promise<T> => {
    holdRef.current++;
    syncLoop();
    return run().finally(() => {
      holdRef.current = Math.max(0, holdRef.current - 1);
      syncLoop();
    });
  };
  useEffect(() => {
    syncLoop();
    if (visible) publishTaps();
    else setPresetOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // unmount (the shell never unmounts the Lab, but StrictMode / HMR do)
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    liveRef.current = false;
    audioRef.current?.stop();
    stopCam();
    stopPhoto();
    inputStreamRef.current?.getTracks().forEach((t) => t.stop());
    inputStreamRef.current = null;
    loadedUrlRef.current = null;
    if (ownUrlRef.current) { URL.revokeObjectURL(ownUrlRef.current); ownUrlRef.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ═══ TRANSPORT (video INPUT): play / pause / scrub / loop ═════════════
     Pausing the INPUT freezes the chain (no new frames: every effect holds its
     last input frame) and the music: Clip audio is this element's own sound,
     a playing Track is paused with it and resumed by Play. */
  const transportPausedTrackRef = useRef(false);
  const togglePlay = () => {
    const v = inputVideoRef.current;
    if (!v || kindRef.current !== 'video') return;
    const audio = audioRef.current!;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch(() => {});
      if (transportPausedTrackRef.current) { transportPausedTrackRef.current = false; audio.resumeFile(); }
    } else {
      v.pause();
      if (audio.pauseFile()) transportPausedTrackRef.current = true;
    }
    mirror();
  };
  const scrub = (t: number) => {
    const v = inputVideoRef.current;
    if (!v || !isFinite(t)) return;
    v.currentTime = clamp(t, 0, isFinite(v.duration) ? v.duration : t);
    mirror();
  };
  const toggleLoop = () => {
    const v = inputVideoRef.current;
    loopRef.current = !loopRef.current;
    if (v) v.loop = loopRef.current;
    mirror();
  };

  /* ═══ UI mirror (meters, transport, audio state, output fps) ═══════════ */
  const mirror = () => {
    const audio = audioRef.current!;
    const lv = audio.levels;
    setSignals((s) => (s.bass === lv.bass && s.loud === lv.loud && s.treble === lv.treble && s.beat === lv.beat && s.bpm === lv.bpm
      ? s : { bass: lv.bass, loud: lv.loud, treble: lv.treble, beat: lv.beat, bpm: lv.bpm }));
    setTrack(audio.transport ? { ...audio.transport } : null);
    setAudioOn(audio.active);
    setAudioMode(audio.mode);
    const v = inputVideoRef.current;
    if (v) {
      const next = { playing: !v.paused && !v.ended, t: v.currentTime, dur: isFinite(v.duration) ? v.duration : 0, loop: v.loop };
      setTp((p) => (p.playing === next.playing && p.t === next.t && p.dur === next.dur && p.loop === next.loop ? p : next));
    }
  };
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!visibleRef.current && !exportingRef.current) return;
      mirror();
      reviveInput(); // a capture that ended under us (end of clip, a stall at the loop point)
      replumb(); // Lab audio switched on / off, an output canvas swapped…
    }, 150);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OUTPUT fps: frames presented by the OUTPUT <video> (the last node's captureStream), per second
  useEffect(() => {
    const ov = outputVideoRef.current as RvfcVideo | null;
    if (!ov || typeof ov.requestVideoFrameCallback !== 'function') return;
    let frames = 0;
    let alive = true;
    let pending = 0; // the one outstanding callback: never two, or every frame counts twice
    const onFrame = () => {
      pending = 0;
      if (!alive) return;
      frames++;
      outFramesRef.current++;
      pending = ov.requestVideoFrameCallback!(onFrame);
    };
    pending = ov.requestVideoFrameCallback(onFrame);
    /* a fresh srcObject may drop the pending callback: re-arm on every new stream,
       cancelling the old one first in case it survived */
    const rearm = () => {
      if (pending) ov.cancelVideoFrameCallback?.(pending);
      pending = ov.requestVideoFrameCallback!(onFrame);
    };
    ov.addEventListener('loadedmetadata', rearm);
    const t = window.setInterval(() => {
      fpsRef.current = frames;
      setFps(frames);
      frames = 0;
    }, 1000);
    return () => { alive = false; window.clearInterval(t); ov.removeEventListener('loadedmetadata', rearm); };
  }, []);

  /* ═══ AUDIO buttons ═══════════════════════════════════════════════════ */
  const toggleMic = async () => {
    const audio = audioRef.current!;
    if (audio.mode === 'mic') {
      audio.stop();
      mirror();
      replumb();
      return;
    }
    try {
      await audio.startMic();
      clipWantedRef.current = false;
      setError(null);
      mirror();
      replumb();
      syncLoop(); // hidden while the permission prompt was up: released again
    } catch (e) {
      setError('Audio in: ' + (e as Error).message);
    }
  };
  const loadAudioFile = async (file: File | null) => {
    if (!file) return;
    try {
      await audioRef.current!.startFile(file);
      clipWantedRef.current = false;
      setError(null);
      mirror();
      replumb();
      syncLoop();
    } catch (e) {
      setError('Audio file: ' + (e as Error).message);
    }
  };
  const toggleClipAudio = async () => {
    const audio = audioRef.current!;
    if (audio.mode === 'clip') {
      clipWantedRef.current = false;
      audio.stop(); // re-mutes the element: silent, the meter and the effects go quiet
      mirror();
      replumb();
      return;
    }
    const v = kindRef.current === 'video' ? inputVideoRef.current : null;
    if (!v) return;
    try {
      await startClipOn(v);
    } catch (e) {
      setError('Clip audio: ' + (e as Error).message);
    }
  };

  /* ═══ PRESETS (v2: chain + every node's own panel snapshot) ═══════════ */
  const savePreset = () => {
    const name = presetName.trim();
    if (!name) return;
    const settings: ChainPresetV2['settings'] = {};
    chainRef.current.forEach((id) => {
      const api = nodesRef.current.get(id)?.api;
      let s: unknown = null;
      try { s = api ? api.getSettings() : pendingSettingsRef.current.get(id) ?? readEffectSettings(id); } catch { s = null; }
      if (s != null) settings[id] = s;
    });
    const p: ChainPresetV2 = { v: 2, name, chain: chainRef.current.slice(), settings, savedAt: Date.now() };
    const next = [...presets.filter((x) => x.name !== name), p];
    setPresets(next);
    writePresets(next);
    setPresetName('');
    setNote(`preset "${name}" saved (${p.chain.length} effects)`);
  };
  const loadPreset = (p: StoredPreset) => {
    const list = presetChain(p);
    const pending = pendingSettingsRef.current;
    pending.clear();
    if (isV2(p)) {
      list.forEach((id) => { if (p.settings && p.settings[id] != null) pending.set(id, p.settings[id]); });
      setNote(`preset "${p.name}" loaded`);
    } else {
      setNote(`old preset "${p.name}": chain loaded — effect settings not restored`);
    }
    onChainChangeRef.current?.(list);
    // nodes already up get their snapshot now; the others when their SynLab is ready (initNode)
    list.forEach((id) => {
      const api = nodesRef.current.get(id)?.api;
      if (api && pending.has(id)) {
        try { api.applySettings(pending.get(id)); } catch { /* keeps its panel */ }
        pending.delete(id);
      }
    });
  };
  const deletePreset = (name: string) => {
    const next = presets.filter((p) => p.name !== name);
    setPresets(next);
    writePresets(next);
  };
  const presetSeqRef = useRef<number | null>(null);
  useEffect(() => {
    if (!presetRequest || presetSeqRef.current === presetRequest.seq) return;
    presetSeqRef.current = presetRequest.seq;
    const p = readPresets().find((x) => x.name === presetRequest.name);
    if (p) loadPreset(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetRequest?.seq]);

  /* ═══ MASTER export (realtime) ════════════════════════════════════════
     The chain's OUTPUT is recorded as it plays: a video INPUT is rewound and
     played once to the end; a photo / the webcam gives a fixed 10 s take. The
     effects are first given an enlarged frame (a 1920-px-class canvas, scaled
     back down on screen — never off screen) when that makes them render
     bigger; the file is 1920 wide when the effect's own canvas is ≥ 1600 px,
     else it keeps the canvas's native size (no fake upscale). MP4 (H.264 +
     AAC) when MediaRecorder can, else WebM. STOP cancels. */
  const lastNodeCanvas = (): HTMLCanvasElement | null => {
    for (let i = chainRef.current.length - 1; i >= 0; i--) {
      const api = nodesRef.current.get(chainRef.current[i])?.api;
      if (api) { try { return api.outputCanvas(); } catch { return null; } }
    }
    return null;
  };
  const runMaster = async () => {
    if (exportingRef.current) { exportStopRef.current = true; return; }
    const ov = outputVideoRef.current;
    const k = kindRef.current;
    if (!ov || k === 'none' || !outputStreamRef.current) { setExportMsg('✗ Master export needs a source (video, photo or webcam)'); return; }
    const v = inputVideoRef.current!;
    if (k === 'video' && (!isFinite(v.duration) || !v.duration)) { setExportMsg('✗ the video has no readable duration yet'); return; }
    exportingRef.current = true;
    exportStopRef.current = false;
    setExporting(true);
    syncLoop();
    const prevLoop = v.loop;
    const wasPaused = v.paused && !v.ended;
    let rec: MasterRecorder | null = null;
    let progress = 0;
    try {
      setExportMsg('MASTER: sizing the effects…');
      // 1. give the effects a bigger frame when that makes them render bigger
      const c0 = lastNodeCanvas();
      const w0 = c0?.width ?? ov.videoWidth;
      if (w0 && w0 < 1600) {
        const f = clamp(MASTER_WIDTH / w0, 1, 3);
        setExportScale(f);
        await wait(1500);
        replumb();
        const w1 = lastNodeCanvas()?.width ?? 0;
        if (!(w1 > w0 * 1.1)) setExportScale(1); // the effect renders at its source's size: no point
        await wait(300);
        replumb();
      }
      // 2. from the top
      if (k === 'video') {
        v.loop = false;
        v.pause();
        await new Promise<void>((r) => {
          const on = () => { v.removeEventListener('seeked', on); r(); };
          v.addEventListener('seeked', on);
          window.setTimeout(r, 2000);
          v.currentTime = 0;
        });
        await wait(250);
      }
      if (exportStopRef.current) throw new Error('stopped');
      // a Clip the operator wants but that dropped (the clip had reached its end): back on for the take
      if (k === 'video' && clipWantedRef.current && audioRef.current!.mode === 'off') {
        await startClipOn(v).catch(() => {});
      }
      await awaitFreshOutput(); // the budgets were raised by the export: the take starts on fresh frames
      if (exportStopRef.current) throw new Error('stopped');
      const ow = ov.videoWidth;
      const native = `${ow}×${ov.videoHeight}`;
      const width = ow >= 1600 ? MASTER_WIDTH : Math.max(2, Math.round(ow / 2) * 2);
      rec = new MasterRecorder(ov, labAudioStream(), width);
      const total = k === 'video' ? v.duration : STILL_TAKE_SEC;
      rec.start();
      const t0 = performance.now();
      if (k === 'video') await v.play().catch(() => {});
      await new Promise<void>((resolve) => {
        const tick = window.setInterval(() => {
          const t = k === 'video' ? v.currentTime : (performance.now() - t0) / 1000;
          progress = clamp(t / total, 0, 1);
          setExportMsg(`● REC ${rec!.width}×${rec!.height} ${t.toFixed(1)}s / ${total.toFixed(1)}s (${Math.round(progress * 100)}%) — click to stop`);
          const done = k === 'video' ? v.ended || (v.paused && t >= total - 0.05) : t >= total;
          if (done || exportStopRef.current) { window.clearInterval(tick); resolve(); }
        }, 200);
      });
      const keep = !exportStopRef.current;
      const res = await rec.finish(keep);
      rec = null;
      if (!keep) { setExportMsg('✗ Master export stopped — nothing saved'); return; }
      if (!res) throw new Error('the recorder produced no data');
      const base = (sourceNameRef.current || 'lab').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'lab';
      const name = `${base}_lab.${res.ext}`;
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      lastExportRef.current = { name, size: res.blob.size, type: res.mime, width: res.width, height: res.height, audio: res.audio, url };
      if (!debugOn) window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      const codec = res.ext === 'mp4' ? 'H.264' : 'WebM';
      setExportMsg(`✓ ${name} · ${res.width}×${res.height} (chain output ${native}) · ${codec}${res.audio ? ' + audio' : ' (no audio: Lab audio was off)'} · ${(res.blob.size / 1048576).toFixed(1)} MB`);
    } catch (e) {
      setExportMsg(exportStopRef.current ? '✗ Master export stopped — nothing saved' : '✗ ' + (e as Error).message);
    } finally {
      if (rec) await rec.finish(false).catch(() => null);
      setExportScale(1);
      if (k === 'video') {
        v.loop = prevLoop;
        if (wasPaused) v.pause();
        else void v.play().catch(() => {});
      }
      exportingRef.current = false;
      exportStopRef.current = false;
      setExporting(false);
      syncLoop(); // finished while the Lab is hidden: it parks now
      window.setTimeout(replumb, 400);
    }
  };

  /* ═══ the Gemini LabHandle (src/ai/contract.ts) on top of SynLab ═══════
     Params are each node's own panel controls (SynLab.params), keyed
     `<ModuleId>.<control key>`; there are no ParamBus routes. Built once:
     every method reads refs only, so the object stays valid for the Lab's life. */
  const readyApi = (id: ModuleId): SynLabApi | null => nodesRef.current.get(id)?.api ?? null;
  const splitKey = (key: string): { id: ModuleId; pkey: string } | null => {
    const dot = key.indexOf('.');
    if (dot <= 0) return null;
    const id = key.slice(0, dot) as ModuleId;
    return chainRef.current.includes(id) ? { id, pkey: key.slice(dot + 1) } : null;
  };
  const toDesc = (id: ModuleId, p: SynLabParam): ParamDesc => {
    const hint = (p.group ?? '').trim();
    const d: ParamDesc = {
      key: `${id}.${p.key}`,
      label: p.label,
      type: p.type,
      min: p.type === 'boolean' ? 0 : p.min,
      max: p.type === 'boolean' ? 1 : p.max,
      step: p.type === 'boolean' ? 1 : p.step,
      value: p.type === 'boolean' ? (p.value >= 0.5 ? 1 : 0) : p.value,
      hint: hint.length > HINT_MAX ? `${hint.slice(0, HINT_MAX - 1).trimEnd()}…` : hint,
      reactive: false,
      route: null,
      carrier: false,
      locked: isLockedParam(p),
    };
    if (p.type === 'enum' && Array.isArray(p.options)) d.options = p.options.slice();
    return d;
  };
  const allNodesSettled = () => {
    const now = performance.now();
    return chainRef.current.every((id) => {
      const rec = nodesRef.current.get(id);
      return !!rec && (!!rec.api || (rec.loadedAt > 0 && now - rec.loadedAt > LINK_TIMEOUT_MS));
    });
  };
  const outputHasFrame = () => {
    const ov = outputVideoRef.current;
    return !!ov && ov.readyState >= 2 && ov.videoWidth > 0;
  };
  /** After a frame-budget raise (a capture / export on a Lab showing an earlier tab, or hidden) the
   *  OUTPUT <video> still holds a frame from before: wait until chain.length + 1 frames were presented
   *  since the raise (each hop adds a frame of latency). Bounded by `timeoutMs`; past it, when not even
   *  ONE new frame arrived (software GL renders at ~1 fps), up to FRESH_FALLBACK_MS more for that one. */
  const awaitFreshOutput = async (timeoutMs = GRAB_WAIT_MS) => {
    const need = raisedAtFrameRef.current + chainRef.current.length + 1;
    const t0 = performance.now();
    while (outFramesRef.current < need && performance.now() - t0 < timeoutMs) await wait(30);
    while (outFramesRef.current <= raisedAtFrameRef.current && performance.now() - t0 < timeoutMs + FRESH_FALLBACK_MS) await wait(50);
  };

  const labRef = useRef<LabHandle | null>(null);
  if (!labRef.current) {
    labRef.current = {
      whenReady: (timeoutMs = 8000) => new Promise<boolean>((resolve) => {
        const t0 = performance.now();
        const poll = () => {
          if (kindRef.current !== 'none' && inputHasFrame() && allNodesSettled() && outputHasFrame()) return resolve(true);
          if (performance.now() - t0 >= timeoutMs) return resolve(false);
          window.setTimeout(poll, 100);
        };
        poll();
      }),

      sourceKind: () => kindRef.current,

      // SOURCE = the INPUT element; OUTPUT = the OUTPUT <video> (the last node's captureStream —
      // read there, not from a WebGL canvas that may not keep its drawing buffer)
      grabPair: (maxSide = 768) => withLiveLoop(async () => {
        const none = { source: null, output: null };
        if (exportingRef.current || kindRef.current === 'none') return none;
        const deadline = performance.now() + FIRST_FRAME_WAIT_MS;
        while (!(inputHasFrame() && outputHasFrame())) {
          if (performance.now() > deadline || exportingRef.current) return none;
          await wait(60);
        }
        await awaitFreshOutput(); // the budgets were just raised: never a frame from before
        /* the wait can outlast a source hiccup (a seek / loop restart drops readyState): both again,
           on the same generous deadline — an empty pair reads to the panel as "an export is running" */
        while (!(inputHasFrame() && outputHasFrame())) {
          if (performance.now() > deadline || exportingRef.current) return none;
          await wait(60);
        }
        if (exportingRef.current) return none;
        const src = inputElement();
        const ov = outputVideoRef.current;
        if (!src || !ov) return none;
        const at = frameAt();
        const [s, o] = await Promise.all([
          elementToJpeg(src, maxSide, `SOURCE frame ${at}`),
          elementToJpeg(ov, maxSide, `OUTPUT frame ${at}`),
        ]);
        return { source: s, output: o };
      }),

      grabSourceFrames: (n, maxSide = 768) => withLiveLoop(async () => {
        const out: MediaPart[] = [];
        const count = clamp(Math.floor(Number(n)) || 0, 0, MAX_LIVE_FRAMES);
        const k = kindRef.current;
        const el = inputElement();
        if (!el || !count || exportingRef.current || !inputHasFrame()) return out;
        if (k === 'image') {
          const part = await elementToJpeg(el, maxSide, 'SOURCE photo');
          return part ? [part] : out;
        }
        const webcam = k === 'webcam';
        const gap = webcam ? (count > 1 ? WEBCAM_SPAN_MS / (count - 1) : 0) : VIDEO_FRAME_GAP_MS;
        let lastT = -1;
        for (let i = 0; i < count; i++) {
          if (i > 0) await wait(gap);
          if (kindRef.current !== k || inputElement() !== el || exportingRef.current) break;
          let part: MediaPart | null;
          if (webcam) {
            part = await elementToJpeg(el, maxSide, `SOURCE webcam frame ${i + 1}/${count} (+${((i * gap) / 1000).toFixed(1)}s)`);
          } else {
            const t = (el as HTMLVideoElement).currentTime;
            if (Math.abs(t - lastT) < 0.04) continue; // a paused video: the same frame says nothing new
            lastT = t;
            part = await elementToJpeg(el, maxSide, `SOURCE frame at ${t.toFixed(1)}s`);
          }
          if (part) out.push(part);
        }
        return out;
      }),

      recordOutputClip: async (sec) => {
        const ov = outputVideoRef.current;
        if (!ov || exportingRef.current || kindRef.current === 'none') return null;
        const audio = audioRef.current!;
        const stream = labAudioStream();
        const s = Number.isFinite(sec) && sec > 0 ? sec : 4;
        const what = !stream ? ' (no audio)' : audio.mode === 'mic' ? ' with mic audio' : ' with music';
        return withLiveLoop(async () => {
          /* the hold raised the budgets: a paused chain (an earlier tab, hidden) may not have put a
             single frame on the OUTPUT yet — wait for one, then for fresh ones */
          const deadline = performance.now() + FIRST_FRAME_WAIT_MS;
          while (!outputHasFrame()) {
            if (performance.now() > deadline || exportingRef.current) return null;
            await wait(60);
          }
          await awaitFreshOutput();
          if (exportingRef.current) return null;
          return recordVideoClip(ov, stream, s, `OUTPUT clip ${s}s${what}`);
        });
      },

      signalSummary: (sec) => withLiveLoop(() => new Promise<SignalSummary>((resolve) => {
        const windowSec = clamp(Number.isFinite(sec) ? sec : 0, 0, 30);
        const audio = audioRef.current!;
        const va = videoAnRef.current!;
        const xs = { bass: [] as number[], treble: [] as number[], loud: [] as number[], motion: [] as number[], bright: [] as number[] };
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
          const tpv = audio.transport;
          const clipVideo = audio.mode === 'clip' ? inputVideoRef.current : null;
          resolve({
            windowSec,
            audio: {
              active: audio.active,
              mode: audio.mode,
              bpm: audio.active ? audio.levels.bpm : null,
              bass: statOf(xs.bass), treble: statOf(xs.treble), loud: statOf(xs.loud),
              beats: audio.active ? Math.max(0, audio.beatCount - count0) : 0,
              track: tpv
                ? { name: tpv.name, currentTime: round3(tpv.currentTime), duration: round3(tpv.duration) }
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

      // the OUTPUT's real rate: under a hold (every node renders, capped at LAB_FPS), after fresh frames
      measureFps: (windowMs = FPS_WINDOW_MS) => withLiveLoop(async () => {
        if (exportingRef.current || !outputHasFrame()) return fpsRef.current;
        await awaitFreshOutput();
        const f0 = outFramesRef.current;
        const t0 = performance.now();
        await wait(clamp(windowMs, 300, 5000));
        return Math.round(((outFramesRef.current - f0) * 10000) / (performance.now() - t0)) / 10;
      }),

      chainState: (): ChainState => {
        const audio = audioRef.current!;
        const params: ParamDesc[] = [];
        chainRef.current.forEach((id) => {
          const api = readyApi(id);
          if (!api) return;
          let list: SynLabParam[] = [];
          try { list = api.params() ?? []; } catch { list = []; }
          list.forEach((p) => { if (p && typeof p.key === 'string') params.push(toDesc(id, p)); });
        });
        return {
          order: chainRef.current.slice(),
          params,
          fps: fpsRef.current,
          fpsCap: LAB_FPS,
          resScale: 1,
          sourceKind: kindRef.current,
          audioActive: audio.active,
          audioMode: audio.mode,
          maskState: null,
        };
      },

      // Defence in depth: the server already validated the plan, the Lab checks again (a fix may be
      // applied later than it was made). Every key is first written down as it was (PlanUndo).
      applyPlan: (plan: AgentPlan) => {
        const skipped: string[] = [];
        if (exportingRef.current) return { applied: 0, skipped: ['a Master export is running'], undo: null };
        let applied = 0;
        const undo = new Map<string, PlanUndo['entries'][number]>();
        const cache = new Map<ModuleId, SynLabParam[]>();
        const paramsOf = (id: ModuleId, api: SynLabApi) => {
          let l = cache.get(id);
          if (!l) { try { l = api.params() ?? []; } catch { l = []; } cache.set(id, l); }
          return l;
        };
        for (const e of Array.isArray(plan?.params) ? plan.params : []) {
          const key = e?.key;
          const where = typeof key === 'string' ? splitKey(key) : null;
          const api = where ? readyApi(where.id) : null;
          const p = where && api ? paramsOf(where.id, api).find((x) => x.key === where.pkey) : undefined;
          if (!where || !api || !p) { skipped.push(`${String(key)}: not a parameter of this chain`); continue; }
          if (isLockedParam(p)) { skipped.push(`${key}: locked`); continue; }
          const raw = typeof e.value === 'boolean' ? (e.value ? 1 : 0) : Number(e.value);
          if (!Number.isFinite(raw)) { skipped.push(`${key}: value is not a number`); continue; }
          let v: number;
          if (p.type === 'boolean') v = raw >= 0.5 ? 1 : 0;
          else if (p.type === 'enum') v = clamp(Math.round(raw), Math.ceil(p.min), Math.floor(p.max));
          else {
            v = snapTo(raw, p.min, p.max, p.step);
            const floor = PARAM_FLOORS[key];
            if (floor !== undefined) v = clamp(Math.max(v, floor), p.min, p.max);
          }
          let ok = false;
          try { ok = api.setParam(p.key, v); } catch { ok = false; }
          if (!ok) { skipped.push(`${key}: the effect did not take the value`); continue; }
          if (!undo.has(key)) {
            undo.set(key, p.type === 'boolean' ? { key, bool: p.value >= 0.5 ? 1 : 0 } : { key, base: p.value });
          }
          applied++;
        }
        for (const r of Array.isArray(plan?.routes) ? plan.routes : []) {
          skipped.push(`${String(r?.key)}: signal routes do not exist in the Lab — each effect reacts through its own controls`);
        }
        return { applied, skipped, undo: undo.size ? { entries: [...undo.values()] } : null };
      },

      revertPlan: (u: PlanUndo) => {
        if (exportingRef.current || !Array.isArray(u?.entries)) return { reverted: 0 };
        let reverted = 0;
        /* newest first: a control that resets its siblings is undone before them */
        for (const e of [...u.entries].reverse()) {
          const where = typeof e?.key === 'string' ? splitKey(e.key) : null;
          const api = where ? readyApi(where.id) : null;
          if (!where || !api) continue;
          const v = typeof e.bool === 'number' ? e.bool : typeof e.base === 'number' ? e.base : NaN;
          if (!Number.isFinite(v)) continue;
          let ok = false;
          try { ok = api.setParam(where.pkey, v); } catch { ok = false; }
          if (ok) reverted++;
        }
        return { reverted };
      },

      // Agent / Optimizer on a music video: they must hear the music. True when audio is on now.
      startClipAudio: async () => {
        try {
          const audio = audioRef.current!;
          if (audio.active) return true;
          const v = kindRef.current === 'video' ? inputVideoRef.current : null;
          if (!v || exportingRef.current) return false;
          await startClipOn(v);
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  useImperativeHandle(ref, () => labRef.current!, []);

  /* dev / verification taps: `__SYN` in DEV (as before: the same LabHandle the Gemini panel
     holds), `__synLabDebug` only with ?labdebug in the URL (any build, the packaged app too) */
  const debugOn = typeof location !== 'undefined' && new URLSearchParams(location.search).has('labdebug');
  const publishTaps = () => {
    const w = window as unknown as Record<string, unknown>;
    if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
      w.__SYN = { lab: labRef.current, audio: audioRef.current };
    }
    if (debugOn) {
      // verification only: who switched the Lab audio off, and when (the last 20 calls)
      const a = audioRef.current! as AudioEngine & { __logged?: boolean };
      if (!a.__logged) {
        a.__logged = true;
        const stop = a.stop.bind(a);
        a.stop = () => {
          const v = inputVideoRef.current;
          audioLogRef.current.push(`${(performance.now() / 1000).toFixed(1)}s mode=${a.mode} t=${v?.currentTime.toFixed(2)} paused=${v?.paused} ${(new Error().stack ?? '').split('\n').slice(2, 5).map((l) => l.trim()).join(' < ')}`);
          if (audioLogRef.current.length > 20) audioLogRef.current.shift();
          stop();
        };
      }
      w.__synLabDebug = {
        audioLog: () => audioLogRef.current.slice(),
        lab: labRef.current,
        audio: audioRef.current,
        chain: () => chainRef.current.slice(),
        api: (id: ModuleId) => nodesRef.current.get(id)?.api ?? null,
        links: () => Object.fromEntries([...nodesRef.current.values()].map((r) => [r.id, r.api ? 'ready' : r.loadedAt ? 'loading' : 'mounting'])),
        hopStreams: () => chainRef.current.map((id) => ({ id, stream: nodesRef.current.get(id)?.out ?? null })),
        inputStream: () => inputStreamRef.current,
        outputStream: () => outputStreamRef.current,
        inputVideo: () => inputVideoRef.current,
        lastExport: () => lastExportRef.current,
      };
    }
  };
  useEffect(() => { publishTaps(); }); // cheap; keeps the taps on the live refs

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

  /* ═══ render ══════════════════════════════════════════════════════════ */
  const inputLabel = kind === 'none' ? 'NONE' : (kind === 'webcam' ? 'WEBCAM' : sourceName || kind).toUpperCase();
  const audioLabel = audioMode === 'off' ? 'OFF' : audioMode === 'file' ? 'TRACK' : audioMode.toUpperCase();
  const pct = (v: number) => `${Math.min(100, Math.round(v * 100))}%`;
  const layerCls = (t: Tab) => `fxl-layer${tab === t ? ' top' : ''}`;
  const linkOf = (id: ModuleId): LinkState => links[id] ?? 'loading';
  const theme = isDayMode ? 'day' : 'night';
  const layersStyle: React.CSSProperties | undefined = exportScale > 1
    ? { width: `${exportScale * 100}%`, height: `${exportScale * 100}%`, transform: `scale(${1 / exportScale})`, transformOrigin: '0 0' }
    : undefined;
  const missing = chain.filter((id) => linkOf(id) === 'missing');

  /** the OUTPUT is paused by the frame budget (an earlier tab is on top): the pill says so instead of 0 */
  const tabIndex = tab === 'input' || tab === 'output' ? -1 : chain.indexOf(tab);
  const outputIdle = !exporting && (tab === 'input' || (tabIndex >= 0 && tabIndex < chain.length - 1));

  return (
    <div className="syn-fxlab" data-testid="chain-lab" data-theme={theme}>
      {/* ── the LAB strip: logo · tabs · commands · pills ── */}
      <div className="fxl-labbar">
        <div className="fxl-logo">LAB</div>
        <div className="fxl-tabs" role="tablist" aria-label="Lab chain">
          <button type="button" role="tab" aria-selected={tab === 'input'} data-testid="lab-tab-input" className={`fxl-tab${tab === 'input' ? ' on' : ''}`} onClick={() => setTab('input')}>
            Input
          </button>
          {chain.map((id, i) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              data-testid={`lab-tab-${id}`}
              data-link={linkOf(id)}
              className={`fxl-tab fx${tab === id ? ' on' : ''}`}
              onClick={() => setTab(id)}
              title={linkOf(id) === 'missing' ? `${fxName(id)}: Lab link not available — bypassed` : `${i + 1}. ${fxName(id)}`}
            >
              <span className="fxl-tab-sep">›</span>
              <i className="fxl-tab-dot" style={{ background: EFFECT_META[id]?.color }} />
              {fxName(id)}
              {linkOf(id) !== 'ready' && <span className={`fxl-tab-state ${linkOf(id)}`}>{linkOf(id) === 'missing' ? '!' : '…'}</span>}
            </button>
          ))}
          <button type="button" role="tab" aria-selected={tab === 'output'} data-testid="lab-tab-output" className={`fxl-tab${tab === 'output' ? ' on' : ''}`} onClick={() => setTab('output')}>
            <span className="fxl-tab-sep">›</span>Output
          </button>
        </div>
        <div className="fxl-sep" />
        <div className="fxl-cmds">
          <button type="button" className="fxl-btn" onClick={() => fileRef.current?.click()} title="Load a video or a photo as the INPUT">
            Video / Photo
          </button>
          <button
            type="button"
            className={`fxl-btn${kind === 'webcam' ? ' on' : ''}`}
            data-testid="lab-webcam"
            onClick={toggleWebcam}
            title={kind === 'webcam' ? 'Stop the webcam' : 'Use the webcam as the INPUT'}
          >
            <span className="fxl-led" /> {kind === 'webcam' ? 'Stop cam' : 'Webcam'}
          </button>
          <input ref={fileRef} type="file" accept="video/*,image/*" data-testid="chain-file" className="hidden" onChange={(e) => { void loadSourceFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <span className="fxl-gap" />
          {/* the active audio buttons also carry `border-amber-400`: verify-gemini.cjs reads it as "on" */}
          <button type="button" onClick={toggleMic} data-testid="audio-toggle" title="React to the microphone" className={`fxl-btn${audioMode === 'mic' ? ' on border-amber-400' : ''}`}>
            <span className="fxl-led" /> {audioMode === 'mic' ? 'Live' : 'Mic'}
          </button>
          <button type="button" onClick={() => audioFileRef.current?.click()} data-testid="audio-file-btn" title="React to a music track" className={`fxl-btn${audioMode === 'file' ? ' on border-amber-400' : ''}`}>
            <span className="fxl-led" /> Track
          </button>
          <button
            type="button"
            onClick={toggleClipAudio}
            data-testid="audio-clip"
            disabled={kind !== 'video'}
            title={kind === 'video' ? (audioMode === 'clip' ? "Turn the video's own sound off" : "Hear the video's own sound (it drives the meter and the effects)") : 'Needs a video INPUT'}
            className={`fxl-btn${audioMode === 'clip' ? ' on border-amber-400' : ''}`}
          >
            <span className="fxl-led" /> Clip
          </button>
          <input ref={audioFileRef} type="file" accept="audio/*" data-testid="audio-file" className="hidden" onChange={(e) => { void loadAudioFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <span className="fxl-gap" />
          <div className="fxl-pop-wrap" ref={presetWrapRef}>
            <button type="button" className={`fxl-btn${presetOpen ? ' on' : ''}`} data-testid="preset-toggle" onClick={() => setPresetOpen((o) => !o)} title="Save or load a chain preset">
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
                  <p className="fxl-pop-note">No saved chains yet — the chain order and every effect's panel settings are stored.</p>
                ) : (
                  <div className="fxl-pop-list">
                    {presets.map((p) => (
                      <div key={p.name} className="fxl-pop-item">
                        <span title={isV2(p) ? p.name : `${p.name} (old preset: chain order only)`}>{p.name}{isV2(p) ? '' : ' ·v1'}</span>
                        <button type="button" className="fxl-btn" onClick={() => { loadPreset(p); setPresetOpen(false); }} data-testid={`preset-load-${p.name}`}>
                          Load
                        </button>
                        <button type="button" className="fxl-btn" onClick={() => deletePreset(p.name)} data-testid={`preset-del-${p.name}`} title="Delete preset">
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
            onClick={runMaster}
            disabled={kind === 'none' && !exporting}
            title={exporting ? 'Stop the export (nothing is saved)'
              : kind === 'video' ? 'Record the chain output from the start of the video to its end (realtime), with the Lab audio'
              : kind === 'none' ? 'Master export needs a source'
              : `Record ${STILL_TAKE_SEC} s of the chain output (realtime), with the Lab audio`}
            className={`fxl-btn primary${exporting ? ' on' : ''}`}
          >
            {exporting ? '■ Stop' : '◆ Master MP4'}
          </button>
          {exportMsg && (
            <span data-testid="chain-export-msg" className={`fxl-msg${exportMsg.startsWith('✗') ? ' err' : ''}`} title={exportMsg}>
              {exportMsg}
            </span>
          )}
        </div>
        <div className="fxl-pills">
          <div className={`fxl-pill${kind !== 'none' ? ' live' : ''}`} data-testid="chain-input" title={sourceName || undefined}>
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
          <div className="fxl-fps" title={outputIdle ? 'The chain OUTPUT is paused while an earlier tab is shown (only the nodes up to the selected one render)' : 'Frames per second of the chain OUTPUT'}>
            <span>FPS <b data-testid="chain-fps">{outputIdle ? '–' : fps}</b></span>
          </div>
        </div>
      </div>

      {/* ── the stage: INPUT, every node's iframe and OUTPUT, all in the same rect ── */}
      <div className="fxl-stage" data-testid="lab-stage">
        <div className="fxl-layers" style={layersStyle}>
          <div className={`${layerCls('input')} fxl-media`} data-testid="lab-layer-input">
            <video ref={(el) => { inputVideoRef.current = el; if (el && !el.dataset.init) { el.dataset.init = '1'; el.muted = true; } }} data-testid="lab-input-video" playsInline preload="auto" className={kind === 'video' ? '' : 'fxl-gone'} />
            <canvas ref={photoCanvasRef} data-testid="lab-input-photo" className={kind === 'image' ? '' : 'fxl-gone'} />
            <video ref={(el) => { camVideoRef.current = el; if (el) el.muted = true; }} data-testid="lab-input-cam" playsInline className={kind === 'webcam' ? '' : 'fxl-gone'} />
            {kind === 'none' && (
              <div className="fxl-nosignal">
                <Upload className="fxl-nosignal-icon w-7 h-7" strokeWidth={1.4} />
                <div className="fxl-nosignal-title">NO SIGNAL</div>
                <div className="fxl-nosignal-sub">VIDEO — IMAGE — WEBCAM</div>
                <button type="button" className="fxl-btn" onClick={() => fileRef.current?.click()}>Source</button>
              </div>
            )}
          </div>
          {frameIds.map((id) => (
            <iframe
              key={id}
              ref={frameRefOf(id)}
              src={labFrameSrc(id)}
              title={`${fxName(id)} (Lab node)`}
              data-testid={`lab-frame-${id}`}
              data-syn-theme={theme}
              className={`${layerCls(id)} fxl-frame`}
              allow="camera; microphone; autoplay; fullscreen"
              onLoad={(e) => onFrameLoad(id, e.currentTarget)}
            />
          ))}
          <div className={`${layerCls('output')} fxl-media`} data-testid="lab-layer-output">
            <video ref={(el) => { outputVideoRef.current = el; if (el) el.muted = true; }} data-testid="lab-output-video" playsInline autoPlay />
            {kind === 'none' && <div className="fxl-empty-out">NO OUTPUT — load a source</div>}
          </div>
          {chain.length === 0 && (tab === 'output' || tab === 'input') && (
            <div className="fxl-hint" data-testid="chain-empty">
              No effects in the chain — add them with <b>+ Add Node</b> in the node graph and wire INPUT → … → OUTPUT.
            </div>
          )}
        </div>
      </div>

      {/* ── transport (video INPUT): BLOB REVEAL's bar ── */}
      {kind === 'video' && (
        <div className="fxl-transport" data-testid="lab-transport">
          <button type="button" data-testid="lab-play" className={`fxl-tl-pause${tp.playing ? '' : ' paused'}`} onClick={togglePlay} title={tp.playing ? 'Pause the INPUT (the whole chain and the sound)' : 'Play'}>
            {tp.playing ? '▮▮ PAUSE' : '▶ PLAY'}
          </button>
          <span className="fxl-tl-cur" data-testid="lab-time">{fmtTC(tp.t)}</span>
          <input
            type="range"
            className="fxl-tl-track"
            data-testid="lab-scrub"
            min={0}
            max={tp.dur || 0}
            step={0.01}
            value={Math.min(tp.t, tp.dur || 0)}
            style={{ '--p': `${tp.dur ? (tp.t / tp.dur) * 100 : 0}%` } as React.CSSProperties}
            onChange={(e) => scrub(parseFloat(e.target.value))}
            aria-label="Scrub the INPUT video"
          />
          <span className="fxl-tl-dur">{fmtTC(tp.dur)}</span>
          <button type="button" data-testid="lab-loop" className={`fxl-tl-loop${tp.loop ? ' on' : ''}`} onClick={toggleLoop} title="Loop">⟳ LOOP</button>
        </div>
      )}

      {/* ── status line: route + link states · track · audio meters · errors ── */}
      <div className="fxl-strip">
        <span className="fxl-route" data-testid="chain-route">
          SOURCE →{' '}
          {chain.map((id) => (
            <React.Fragment key={id}>
              <b className={`fxl-link ${linkOf(id)}`} data-testid={`chain-link-${id}`}>{fxName(id)}{linkOf(id) === 'loading' ? ' …' : linkOf(id) === 'missing' ? ' ✕' : ''}</b>{' → '}
            </React.Fragment>
          ))}
          OUT
        </span>
        {track && (
          <span className="fxl-group">
            <button type="button" className="fxl-icon-btn on" onClick={() => { audioRef.current!.togglePlay(); mirror(); }} data-testid="audio-playpause" title={track.playing ? 'Pause the track' : 'Play the track'}>
              {track.playing ? <Pause /> : <PlayIcon />}
            </button>
            <span data-testid="audio-track-name" className="fxl-track-name" title={track.name}>{track.name}</span>
            <input type="range" className="fxl-mini" data-testid="audio-seek" min={0} max={track.duration || 0} step={0.1} value={track.currentTime} onChange={(e) => audioRef.current!.seek(parseFloat(e.target.value))} />
            <button type="button" className={`fxl-icon-btn${track.loop ? ' on' : ''}`} onClick={() => { audioRef.current!.setLoop(!track.loop); mirror(); }} title="Loop the track">
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
            <span>BPM <b data-testid="audio-bpm" className="fxl-bpm">{signals.bpm ?? '--'}</b></span>
          </span>
        )}
        {missing.length > 0 && (
          <span className="fxl-err" data-testid="chain-link-missing">
            {missing.map((id) => `${fxName(id)}: Lab link not available`).join(' · ')}
          </span>
        )}
        {note && <span className="fxl-note" data-testid="chain-note">{note}</span>}
        {error && <span className="fxl-err" data-testid="chain-error">{error}</span>}
      </div>
    </div>
  );
});

export default ChainLab;
