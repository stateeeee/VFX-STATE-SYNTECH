import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AudioEngine, AudioMode } from '../engine/AudioEngine';
import { VideoAnalyzer } from '../engine/VideoAnalyzer';
import { ModuleId } from '../types';
import {
  AgentPlan, BeatGrid, ChainState, Cue, CueTimeline, LabHandle, MediaPart, ParamDesc, PlanUndo, SignalSummary, SourceKindT, Stat,
  LOCKED_CONTROL_PATTERN, LOCKED_GROUPS, MAX_CUES, PARAM_FLOORS,
} from '../ai/contract';
import { elementToJpeg } from '../ai/capture';
import { labFrameSrc } from '../effects-registry';
import { EFFECT_META } from './NodalComposition';
import { SynLabApi, SynLabParam, labPanelSrc, readEffectSettings, synLabOf } from '../lab/synlab';
import { ChainPresetV2, StoredPreset, isV2, presetChain, readPresets, writePresets } from '../lab/presets';
import { MasterRecorder, recordVideoClip } from '../lab/record';
import { analyzeBeatGrid, withDuration } from '../lab/beatgrid';
import { CUE_EPS, CueSegment, activeCueIndex, barLines, buildSegments, fmtCueTime, sanitizeGrid, stateAtIndex } from '../lab/cues';
// the opened-effect look (top bar, framed stage, transport, the right column of blocks), scoped under .syn-fxlab
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
   LAB v3 (operator design 2026-11-19) — the Lab looks and works like an
   OPENED EFFECT, with several effects chained. Every node is still the
   standalone effect (public/effects/<id>) in a same-origin iframe (LAB v2,
   "option 1"); the shell only plumbs streams:

       INPUT ──stream──▶ node 1 ──captureStream──▶ node 2 ──▶ … ──▶ OUTPUT

   through each effect's window.SynLab (public/effects/shared/syn-lab.js):
   setVideoStream (an external source — not the webcam path, no mirror),
   captureStream (its output canvas), setAudioStream (the Lab's audio, for its
   own reactivity), setLayout('panel') (the effect shows ONLY its panel; its
   canvas keeps rendering out of view at the stage's size).

   Screen: the effects' top bar (logo = the chain's names A→Z · INPUT ·
   ENGINE · timer · FPS); the stage = the chain OUTPUT in the effects' frame
   (no source: their drop overlay), the transport + Gemini cue lane under it;
   the right column (296 px, one scroll) = SOURCE · one block per node (A→Z,
   collapsed; open = that effect's real panel) · LABORATORY (presets, reset,
   Master export). Alphabetical is display only: the processing order is the
   node graph's. A collapsed block is a zero-height clip around its iframe —
   never display:none (Chromium freezes those iframes) — so every node keeps
   rendering and feeding the chain, collapsed or scrolled away.

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
/** a node's iframe viewport is taller than its panel and grows in steps (its wrapper clips it to the
 *  panel's height): opening a section of the effect's panel then does not resize the effect's window
 *  (PAINTING re-allocates its engine on every window resize) */
const PANEL_VIEWPORT_MIN = 2400;
const PANEL_VIEWPORT_STEP = 800;
/** the offscreen canvas area of a node never goes below this (its effect keeps a real render size) */
const AREA_MIN_W = 320;
const AREA_MIN_H = 180;
/** the stage's frame inset (the effects' #canvas-wrap: area − 24 px) */
const FRAME_PAD = 24;
/** the Lab's own work timer (the effects' top-bar timer, 03 §5.1): sessionStorage key */
const LAB_TIMER_KEY = 'syntech.timer.fx.lab';

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
/** a control's value as a plan's undo / a cue's baseline records it (booleans as switches 0/1) */
const valueOf = (p: SynLabParam) => (p.type === 'boolean' ? (p.value >= 0.5 ? 1 : 0) : p.value);
const undoEntryOf = (key: string, p: SynLabParam): PlanUndo['entries'][number] =>
  p.type === 'boolean' ? { key, bool: valueOf(p) } : { key, base: p.value };

/* ── CUE TIMELINE (contract "CUES"; the engine is in the component) ── */
/** a cue label longer than this is cut (the lane and the tooltip are tiny) */
const CUE_LABEL_MAX = 24;
/** with requestVideoFrameCallback, no frame callback for this long while the INPUT plays (a hidden Lab
 *  during a Master export, a background tab) → a rAF / timeupdate stand-in follows the clock instead */
const CUE_STALL_MS = 400;
/** the engine's debug log (?labdebug): the last N cue applications */
const CUE_LOG_MAX = 60;
/** what the tooltip says about one cued control */
interface CueParamInfo { fx: string; label: string; type: SynLabParam['type']; step: number; options?: string[] }
/** one installed timeline */
interface CueRun {
  /** the INPUT video (object URL) it was written for: any other source removes it */
  src: string;
  timeline: CueTimeline;
  /** each cued key's value before the install (the state before the first cue; the undo) */
  baseline: Map<string, number>;
  ids: Set<ModuleId>;
  info: Map<string, CueParamInfo>;
  /** what the engine last wrote per key (starts as the baseline: what the effects hold) */
  written: Map<string, number>;
  /** the cue index last applied (-1 = before the first cue, -2 = nothing applied yet) */
  index: number;
  /** re-apply even when the index did not change (a node reloaded, CUE AUTO back on) */
  dirty: boolean;
  /** CUE AUTO */
  enabled: boolean;
  lastT: number;
  writes: number;
}
interface CueMarkView { at: number; label: string; hot: boolean; lines: string[] }
interface CueView { count: number; enabled: boolean; marks: CueMarkView[]; segments: CueSegment[]; grid: BeatGrid | null; duration: number }
/** a tooltip line's value: ON / OFF, the option's name, or the number on its step's decimals */
const fmtCueValue = (info: CueParamInfo | undefined, v: number) => {
  if (!info) return String(round3(v));
  if (info.type === 'boolean') return v >= 0.5 ? 'ON' : 'OFF';
  if (info.type === 'enum') return info.options?.[Math.round(v)] ?? String(v);
  const dec = info.step > 0 ? Math.min(3, (String(info.step).split('.')[1] ?? '').length) : 2;
  return v.toFixed(dec);
};

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
  /** last SynLab.setLayout sent ('panel WxH'; '' = never) */
  layout: string;
}
type LinkState = 'loading' | 'ready' | 'missing';
/** a block of the right column: SOURCE, LABORATORY or a node */
type BlockId = 'source' | 'laboratory' | ModuleId;

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
  const camVideoRef = useRef<HTMLVideoElement | null>(null);     // the webcam (its stream feeds node 1)
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
  const [links, setLinks] = useState<Partial<Record<ModuleId, LinkState>>>({});
  const pendingSettingsRef = useRef(new Map<ModuleId, unknown>());
  /** each node's panel as it booted, before any saved / preset settings: what RESET puts back */
  const defaultsRef = useRef(new Map<ModuleId, unknown>());
  /** the right column: which blocks are open (SOURCE and LABORATORY open, every node collapsed) */
  const [openBlocks, setOpenBlocks] = useState<ReadonlySet<BlockId>>(() => new Set<BlockId>(['source', 'laboratory']));
  const openBlocksRef = useRef(openBlocks);
  openBlocksRef.current = openBlocks;
  /** each node's panel height (px) as its SynLab reports it */
  const [panelH, setPanelH] = useState<Partial<Record<ModuleId, number>>>({});
  const columnRef = useRef<HTMLDivElement | null>(null);
  /** the stage's size: the frame fits in it, and every node's offscreen canvas area takes it */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });
  const stageBoxRef = useRef(stageBox);
  stageBoxRef.current = stageBox;
  /** the OUTPUT picture's aspect (w / h; 0 = none yet): the frame follows it */
  const [outAspect, setOutAspect] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  /** the Lab's work timer, seconds */
  const [workSec, setWorkSec] = useState(0);

  const [fps, setFps] = useState(0);
  const fpsRef = useRef(0);
  /** frames presented by the OUTPUT <video> since mount (monotonic; the fps meter's rVFC counts them) */
  const outFramesRef = useRef(0);
  /** outFramesRef when a node last went from paused (0) to rendering: what is on the OUTPUT before
   *  that is stale (see awaitFreshOutput) */
  const raisedAtFrameRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode>('off');
  const [tp, setTp] = useState<TransportView>({ playing: false, t: 0, dur: 0, loop: true });
  const [presets, setPresets] = useState<StoredPreset[]>(readPresets);
  const [presetName, setPresetName] = useState('');
  /** LABORATORY: what opens under SAVE (the name field) or OPEN (the saved chains) */
  const [labPane, setLabPane] = useState<'save' | 'open' | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const exportingRef = useRef(false);
  const exportStopRef = useRef(false);
  /** > 1 while a Master export gives every node's (offscreen) canvas area an enlarged size */
  const [exportScale, setExportScale] = useState(1);
  const exportScaleRef = useRef(1);
  exportScaleRef.current = exportScale;
  const audioLogRef = useRef<string[]>([]);
  const lastExportRef = useRef<{ name: string; size: number; type: string; width: number; height: number; audio: boolean; url: string } | null>(null);
  /* the cue timeline (the CUE TIMELINE section) and the INPUT's beat grid */
  const cueRef = useRef<CueRun | null>(null);
  const [cueView, setCueView] = useState<CueView | null>(null);
  /** the cue index the engine last applied (the lane highlights its diamond) */
  const [cueIdx, setCueIdx] = useState(-1);
  /** the hovered diamond: its index and its centre x in the transport's box */
  const [cueTip, setCueTip] = useState<{ i: number; x: number } | null>(null);
  /** one beat-grid analysis per INPUT video (keyed by its URL; concurrent calls share the promise) */
  const gridCacheRef = useRef<{ url: string; ctrl: AbortController; promise: Promise<BeatGrid | null>; value: BeatGrid | null } | null>(null);
  /** the analysed grid of the INPUT on screen: its bar lines are drawn on the track */
  const [gridView, setGridView] = useState<BeatGrid | null>(null);

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
    applyLayouts();
    applyBudgets();
  };

  /* ═══ LAYOUT: every node shows its PANEL only (SynLab.setLayout) ══════
     Its canvas area leaves the iframe's viewport but keeps a real size: the
     stage's (what the operator sees), times the Master's enlargement while an
     export runs. Identity-checked per node (cheap: called from replumb). */
  const areaSize = () => {
    const b = stageBoxRef.current;
    const f = exportScaleRef.current;
    return {
      width: Math.round(Math.max(AREA_MIN_W, b.w) * f),
      height: Math.round(Math.max(AREA_MIN_H, b.h) * f),
    };
  };
  const applyLayouts = () => {
    const size = areaSize();
    const key = `panel ${size.width}x${size.height}`;
    nodesRef.current.forEach((rec) => {
      const api = rec.api;
      if (!api || typeof api.setLayout !== 'function' || rec.layout === key) return;
      try {
        api.setLayout('panel', size);
        rec.layout = key;
      } catch { /* a torn-down frame: the poll will see it */ }
    });
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
    rec.layout = '';
    // the panel as the effect booted: RESET puts it back (taken once per node, before any saved settings)
    if (!defaultsRef.current.has(rec.id)) {
      try {
        const d = api.getSettings();
        if (d != null) defaultsRef.current.set(rec.id, d);
      } catch { /* no bridge: RESET skips this node */ }
    }
    const pending = pendingSettingsRef.current;
    const s = pending.has(rec.id) ? pending.get(rec.id) : readEffectSettings(rec.id);
    pending.delete(rec.id);
    if (s != null) {
      try { api.applySettings(s); } catch { /* the effect keeps its defaults */ }
    }
    cueNodeReady(rec.id); // a reloaded node came back with its saved panel: the cue state goes on again
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
      if (rec.api) notePanelHeight(rec.id, readPanelHeight(rec.api)); // the message may have been missed
    });
    setLinks((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const k of keys) if (prev[k as ModuleId] !== next[k as ModuleId]) return next;
      return prev;
    });
    if (changed) replumb();
  };

  /** a node's panel height (its SynLab, in panel mode; 0 = unknown) */
  const readPanelHeight = (api: SynLabApi): number => {
    try { return typeof api.panelHeight === 'function' ? api.panelHeight() || 0 : 0; } catch { return 0; }
  };
  const notePanelHeight = (id: ModuleId, h: number) => {
    if (!(h > 0)) return;
    setPanelH((prev) => (prev[id] === h ? prev : { ...prev, [id]: h }));
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
          map.set(id, { id, iframe: el, win: null, loadedAt: 0, api: null, inited: false, readyAt: 0, refed: false, video: undefined, audio: undefined, out: null, budget: undefined, layout: '' });
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
    rec.layout = '';
    postTheme(el);
    pollLinks();
  };

  /* the wired chain changed: the blocks follow (A→Z, so a re-order moves no iframe — moving one in the
     DOM would reload it; a new node's block is inserted, a node that left goes with its iframe), re-plumb */
  useEffect(() => {
    defaultsRef.current.forEach((_v, id) => { if (!chain.includes(id)) defaultsRef.current.delete(id); });
    const run = cueRef.current;
    const gone = run ? [...run.ids].filter((id) => !chain.includes(id)) : [];
    if (gone.length) dropCues(`${gone.map(fxName).join(', ')} left the chain`);
    replumb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey]);

  // link poll + plumbing watchdog (identity checks only: cheap)
  useEffect(() => {
    const t = window.setInterval(pollLinks, 400);
    const onMsg = (ev: MessageEvent) => {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'syn:lab-ready') pollLinks();
      else if (ev.data.type === 'syn:lab-panel') {
        // a node's panel changed height (a section opened / closed): its block follows
        nodesRef.current.forEach((rec) => {
          let win: Window | null = null;
          try { win = rec.iframe?.contentWindow ?? null; } catch { win = null; }
          if (win && ev.source === win) notePanelHeight(rec.id, Number(ev.data.payload?.h) || 0);
        });
      }
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
    setAudioMode('off');
  };
  /** Clip audio on for the INPUT video — the Clip button, the auto-start and the Gemini panel all go
   *  through here. AudioEngine.startClip unmutes the element (Chromium 128 captures a muted element as
   *  silence) and keeps its analyser off the speakers: the sound is heard once, from the element. */
  const startClipOn = async (video: HTMLVideoElement): Promise<void> => {
    await audioRef.current!.startClip(video);
    clipWantedRef.current = true;
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
    cueSourceChange(url);
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
    cueSourceChange(null);
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
    cueSourceChange(null);
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

  /* ═══ FRAME BUDGET: the nodes render only when someone watches ═══════
     Every node is a same-origin iframe: all their render loops share the
     shell's main thread. The stage always shows the OUTPUT (LAB v3: no tabs),
     so (SynLab.setFrameBudget, 03 §3.1):
       a Master export or a Gemini capture hold  → every node at LAB_FPS
       Lab hidden                               → every node paused (0)
       Lab visible                              → every node at LAB_FPS
     When exactly ONE node renders and nothing holds the Lab (no export, no
     capture) it runs native (null): a single effect keeps its v0.12.0
     smoothness. Identity-checked per node, so it is called freely: from
     replumb (every commit, the polls), syncLoop (visibility, hold, export).
     A node raised from 0 marks the OUTPUT stale (raisedAtFrameRef) until
     fresh frames went through the chain (awaitFreshOutput). */
  const applyBudgets = () => {
    const ids = chainRef.current;
    const held = holdRef.current > 0 || exportingRef.current;
    const live = held || visibleRef.current;
    const run: number | null = !held && ids.length === 1 ? null : LAB_FPS;
    nodesRef.current.forEach((rec) => {
      const api = rec.api;
      if (!api || typeof api.setFrameBudget !== 'function') return;
      const want = live && ids.includes(rec.id) ? run : 0;
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
  /** TRACK: off → pick a music file (it loops, it drives the meter and the effects); on → off */
  const toggleTrack = () => {
    const audio = audioRef.current!;
    if (audio.mode === 'file') {
      audio.stop();
      mirror();
      replumb();
      return;
    }
    audioFileRef.current?.click();
  };
  /** the chain's file picker, narrowed to images / videos (the drop overlay's SOURCE takes both) */
  const pickSource = (accept: string) => {
    const el = fileRef.current;
    if (!el) return;
    el.accept = accept;
    el.click();
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
    setLabPane(null);
    setNote(`"${name}" saved to Projects (${p.chain.length} effects)`);
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
    cueResync(); // a running timeline keeps driving its own controls over the loaded panels
  };
  /** RESET: every node of the chain back to its panel as it booted (before any saved settings / preset).
   *  A cue timeline would put its values back at its next cue: it goes too. */
  const resetChain = () => {
    if (exportingRef.current) { setNote('reset: a Master export is running'); return; }
    const done: string[] = [];
    const skipped: string[] = [];
    if (cueRef.current) dropCues();
    chainRef.current.forEach((id) => {
      pendingSettingsRef.current.delete(id);
      const api = nodesRef.current.get(id)?.api ?? null;
      const d = defaultsRef.current.get(id);
      if (!api || d == null) { skipped.push(fxName(id)); return; }
      try { api.applySettings(d); done.push(fxName(id)); } catch { skipped.push(fxName(id)); }
    });
    setNote(done.length
      ? `reset: ${done.join(', ')} back to the initial values${skipped.length ? ` · not ready: ${skipped.join(', ')}` : ''}`
      : chainRef.current.length ? `reset: no effect ready yet (${skipped.join(', ')})` : 'reset: the chain is empty');
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
        cueSync(); // the take starts with the cue state at 0 (the engine then follows the playback)
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
  /** After a frame-budget raise (a capture / export on a hidden Lab) the
   *  OUTPUT <video> still holds a frame from before: wait until chain.length + 1 frames were presented
   *  since the raise (each hop adds a frame of latency). Bounded by `timeoutMs`; past it, when not even
   *  ONE new frame arrived (software GL renders at ~1 fps), up to FRESH_FALLBACK_MS more for that one. */
  const awaitFreshOutput = async (timeoutMs = GRAB_WAIT_MS) => {
    const need = raisedAtFrameRef.current + chainRef.current.length + 1;
    const t0 = performance.now();
    while (outFramesRef.current < need && performance.now() - t0 < timeoutMs) await wait(30);
    while (outFramesRef.current <= raisedAtFrameRef.current && performance.now() - t0 < timeoutMs + FRESH_FALLBACK_MS) await wait(50);
  };

  /** each node's params() read once per call (a DOM scan inside the effect) */
  const paramsCache = () => {
    const cache = new Map<ModuleId, SynLabParam[]>();
    return (id: ModuleId, api: SynLabApi): SynLabParam[] => {
      let l = cache.get(id);
      if (!l) { try { l = api.params() ?? []; } catch { l = []; } cache.set(id, l); }
      return l;
    };
  };
  type ParamCheck = { ok: true; key: string; id: ModuleId; p: SynLabParam; api: SynLabApi; v: number } | { ok: false; why: string };
  /** One `{ key, value }` checked against the live chain exactly as a plan's (applyPlan and setCues share
   *  it): a control of a node of this chain, not locked; booleans 0/1, enums an option index, numbers
   *  clamped and snapped to the slider's step, then raised to their floor (PARAM_FLOORS). */
  const checkParam = (e: { key?: unknown; value?: unknown } | null | undefined, paramsOf: ReturnType<typeof paramsCache>): ParamCheck => {
    const key = e?.key;
    const where = typeof key === 'string' ? splitKey(key) : null;
    const api = where ? readyApi(where.id) : null;
    const p = where && api ? paramsOf(where.id, api).find((x) => x.key === where.pkey) : undefined;
    if (!where || !api || !p) return { ok: false, why: `${String(key)}: not a parameter of this chain` };
    if (isLockedParam(p)) return { ok: false, why: `${key}: locked` };
    const value = e?.value;
    const raw = typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
    if (!Number.isFinite(raw)) return { ok: false, why: `${key}: value is not a number` };
    let v: number;
    if (p.type === 'boolean') v = raw >= 0.5 ? 1 : 0;
    else if (p.type === 'enum') v = clamp(Math.round(raw), Math.ceil(p.min), Math.floor(p.max));
    else {
      v = snapTo(raw, p.min, p.max, p.step);
      const floor = PARAM_FLOORS[key as string];
      if (floor !== undefined) v = clamp(Math.max(v, floor), p.min, p.max);
    }
    return { ok: true, key: key as string, id: where.id, p, api, v };
  };

  /* ═══ CUE TIMELINE — the Agent's beat-synced cues (contract "CUES") ════
     setCues installs a timeline bound to the INPUT video it was written for.
     While it is installed and CUE AUTO is on, the ENGINE follows that video's
     clock frame by frame — requestVideoFrameCallback on the INPUT <video>
     (rAF where there is none) — and whenever the active cue changes (playback,
     a seek back, the loop wrapping, a scrub, the Master's rewind) it writes the
     state at that time (the baseline overlaid with every cue at <= t) through
     SynLab.setParam: only the keys whose value differs from what it last
     wrote. Per frame, when nothing changes: one binary search over <= 24 cues.
     It follows the SOURCE clock, so a cue lands with the sound (the Clip audio
     is the INPUT element's own). It never touches the frame budgets: a paused
     node simply takes the value. While no frame callback arrives although the
     INPUT plays (a hidden Lab during a Master export, a background tab), a rAF
     / timeupdate stand-in follows the clock instead. Another INPUT, a node
     leaving the chain, the Undo or the unmount remove the timeline. */
  const cueLoopRef = useRef({ handle: 0, mode: '' as '' | 'rvfc' | 'raf', standIn: 0, lastFrameAt: 0, frameDur: 1 / 30, lastMedia: -1, lastPresented: -1 });
  const cueAliveRef = useRef(true);
  const cueLogRef = useRef<{ at: number; t: number; index: number; wrote: [string, number][] }[]>([]);
  const cueTipRef = useRef<HTMLDivElement | null>(null);
  const transportRef = useRef<HTMLDivElement | null>(null);

  /** one engine step at the INPUT time `t` (default: its currentTime) */
  const cueTick = (t?: number) => {
    const run = cueRef.current;
    if (!run || !run.enabled || !cueAliveRef.current) return;
    const v = inputVideoRef.current;
    if (!v || kindRef.current !== 'video' || fileSourceRef.current?.url !== run.src || v.readyState < 1) return;
    const time = t ?? v.currentTime;
    if (!Number.isFinite(time)) return;
    const idx = activeCueIndex(time, run.timeline.cues);
    if (idx === run.index && !run.dirty) return; // the per-frame case: nothing changed
    const moved = idx !== run.index;
    run.index = idx;
    run.dirty = false;
    run.lastT = time;
    const wrote: [string, number][] = [];
    stateAtIndex(idx, run.baseline, run.timeline.cues).forEach((val, key) => {
      if (run.written.get(key) === val) return;
      const where = splitKey(key);
      const api = where ? readyApi(where.id) : null;
      if (!where || !api) return; // its node is not up right now: written when it is (cueNodeReady)
      let ok = false;
      try { ok = api.setParam(where.pkey, val); } catch { ok = false; }
      if (ok) { run.written.set(key, val); wrote.push([key, val]); }
    });
    run.writes += wrote.length;
    if (debugOn) {
      cueLogRef.current.push({ at: Math.round(performance.now()), t: round3(time), index: idx, wrote });
      if (cueLogRef.current.length > CUE_LOG_MAX) cueLogRef.current.shift();
    }
    if (moved) setCueIdx(idx);
  };

  const onCueFrame: VideoFrameRequestCallback = (_now, meta) => {
    const L = cueLoopRef.current;
    L.handle = 0;
    if (!cueAliveRef.current || !cueRef.current?.enabled) { L.mode = ''; return; }
    L.lastFrameAt = performance.now();
    let t: number | undefined;
    if (meta && Number.isFinite(meta.mediaTime)) {
      /* the frame on screen spans [mediaTime, mediaTime + one frame): a cue whose time falls inside it is
         on from this frame (a seek to the cue's exact time agrees). The frame length is learnt from
         consecutive frames. */
      if (meta.presentedFrames === L.lastPresented + 1 && meta.mediaTime > L.lastMedia) {
        const d = meta.mediaTime - L.lastMedia;
        if (d > 1 / 240 && d < 1 / 10) L.frameDur = L.frameDur * 0.8 + d * 0.2;
      }
      L.lastMedia = meta.mediaTime;
      L.lastPresented = meta.presentedFrames;
      t = meta.mediaTime + L.frameDur * 0.98;
    }
    cueTick(t);
    cueArm();
  };
  const onCueRaf = () => {
    const L = cueLoopRef.current;
    L.handle = 0;
    if (!cueAliveRef.current || !cueRef.current?.enabled) { L.mode = ''; return; }
    cueTick();
    cueArm();
  };
  /** the stand-in while frame callbacks stall: follows currentTime on rAF until they come back */
  const onCueStandIn = () => {
    const L = cueLoopRef.current;
    L.standIn = 0;
    const v = inputVideoRef.current;
    if (!cueAliveRef.current || !cueRef.current?.enabled || !v || v.paused) return;
    if (performance.now() - L.lastFrameAt < CUE_STALL_MS) return; // frame callbacks are back
    cueTick();
    L.standIn = requestAnimationFrame(onCueStandIn);
  };
  const cueArm = () => {
    const L = cueLoopRef.current;
    const v = inputVideoRef.current;
    if (L.handle || !v || !cueAliveRef.current || !cueRef.current?.enabled) return;
    if (typeof v.requestVideoFrameCallback === 'function') {
      L.mode = 'rvfc';
      L.handle = v.requestVideoFrameCallback(onCueFrame);
    } else {
      L.mode = 'raf';
      L.handle = requestAnimationFrame(onCueRaf);
    }
  };
  const cueDisarm = () => {
    const L = cueLoopRef.current;
    const v = inputVideoRef.current;
    if (L.handle) {
      if (L.mode === 'rvfc') { try { v?.cancelVideoFrameCallback(L.handle); } catch { /* gone */ } }
      else cancelAnimationFrame(L.handle);
    }
    if (L.standIn) cancelAnimationFrame(L.standIn);
    L.handle = 0;
    L.standIn = 0;
    L.mode = '';
  };
  /** the timeline goes (Undo, another INPUT, an effect left the chain, a replacement); the values stay */
  const dropCues = (reason?: string) => {
    if (!cueRef.current) return;
    cueRef.current = null;
    cueDisarm();
    setCueView(null);
    setCueIdx(-1);
    setCueTip(null);
    if (reason) {
      console.warn(`[Lab] cue timeline removed: ${reason}`);
      setNote(`cue timeline removed — ${reason}`);
    }
  };
  /** write the state at the current time again: every key (`ids` omitted) or the keys of those nodes */
  const cueResync = (ids?: ModuleId[]) => {
    const run = cueRef.current;
    if (!run) return;
    if (!ids) run.written.clear();
    else run.written.forEach((_v, key) => { if (ids.some((id) => key.startsWith(`${id}.`))) run.written.delete(key); });
    run.dirty = true;
    cueTick();
  };
  const cueNodeReady = (id: ModuleId) => { if (cueRef.current?.ids.has(id)) cueResync([id]); };
  /** the Master's rewind: the state at the INPUT's current time, now */
  const cueSync = () => {
    const run = cueRef.current;
    if (!run) return;
    run.dirty = true;
    cueTick();
  };
  /** keys something else just wrote (a plan, an undo): the engine writes them again at its next change */
  const cueForget = (keys: Iterable<string>) => {
    const run = cueRef.current;
    if (run) for (const k of keys) run.written.delete(k);
  };
  /** a new INPUT: a timeline written for another video goes, and so does that video's beat grid */
  const cueSourceChange = (url: string | null) => {
    if (cueRef.current && cueRef.current.src !== url) dropCues('the INPUT changed');
    const c = gridCacheRef.current;
    if (c && c.url !== url) {
      c.ctrl.abort();
      gridCacheRef.current = null;
      setGridView(null);
    }
  };
  const cueTeardown = () => {
    cueAliveRef.current = false;
    cueDisarm();
    gridCacheRef.current?.ctrl.abort();
    gridCacheRef.current = null;
  };
  // INPUT clock events: a seek (paused or not), a new src (it may drop the pending frame callback),
  // and timeupdate as the last resort while frame callbacks stall
  useEffect(() => {
    cueAliveRef.current = true;
    const v = inputVideoRef.current;
    if (!v) return;
    const onSeeked = () => cueTick();
    const onLoaded = () => { if (cueRef.current?.enabled) { cueDisarm(); cueArm(); cueSync(); } };
    const onTime = () => {
      const L = cueLoopRef.current;
      if (!cueRef.current?.enabled || L.mode !== 'rvfc' || v.paused) return;
      if (performance.now() - L.lastFrameAt < CUE_STALL_MS) return;
      cueTick();
      if (!L.standIn) L.standIn = requestAnimationFrame(onCueStandIn);
    };
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadeddata', onLoaded);
    v.addEventListener('timeupdate', onTime);
    return () => {
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadeddata', onLoaded);
      v.removeEventListener('timeupdate', onTime);
      cueTeardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** the lane / tooltip / chip picture of an installed timeline */
  const cueViewOf = (run: CueRun, duration: number): CueView => {
    const cues = run.timeline.cues;
    const segments = buildSegments(cues, duration, run.timeline.grid);
    const hotAt = (i: number) => segments.find((s) => i >= s.first && i <= s.last)?.hot ?? false;
    return {
      count: cues.length,
      enabled: run.enabled,
      grid: run.timeline.grid,
      duration,
      segments,
      marks: cues.map((c, i) => ({
        at: c.at,
        label: c.label,
        hot: hotAt(i),
        lines: c.params.map((p) => {
          const info = run.info.get(p.key);
          return `${info?.fx ?? p.key} · ${info?.label ?? ''} ${fmtCueValue(info, p.value)}`.replace(/\s+/g, ' ').trim();
        }),
      })),
    };
  };
  const cueTimelineCopy = (tl: CueTimeline): CueTimeline => ({
    cues: tl.cues.map((c) => ({ at: c.at, label: c.label, params: c.params.map((p) => ({ key: p.key, value: p.value })) })),
    grid: tl.grid ? { ...tl.grid, sections: tl.grid.sections.map((x) => ({ ...x })) } : null,
  });
  /** an installed timeline as an undo record (PlanUndo.prevCues): enough to reinstall it as it is now */
  const cueSnapshot = (run: CueRun): NonNullable<PlanUndo['prevCues']> => ({
    timeline: cueTimelineCopy(run.timeline),
    baseline: [...run.baseline].map(([key, value]) => ({ key, value })),
    enabled: run.enabled,
    source: run.src,
  });
  /** the lane's length: the INPUT video's duration, else the grid's, else just past the last cue */
  const cueLaneDur = (tl: CueTimeline) => {
    const v = inputVideoRef.current;
    if (v && Number.isFinite(v.duration) && v.duration > 0) return v.duration;
    return tl.grid?.duration || (tl.cues.length ? tl.cues[tl.cues.length - 1].at + 1 : 1);
  };
  /** Installs `timeline` (already validated) with this `baseline`, replacing whatever was installed,
   *  and writes the state at the current time. null when one of its controls is not in the chain now. */
  const installCues = (src: string, timeline: CueTimeline, baseline: Map<string, number>, enabled: boolean, written = new Map<string, number>()): CueRun | null => {
    const paramsOf = paramsCache();
    const info = new Map<string, CueParamInfo>();
    const ids = new Set<ModuleId>();
    for (const key of baseline.keys()) {
      const where = splitKey(key);
      const api = where ? readyApi(where.id) : null;
      const p = where && api ? paramsOf(where.id, api).find((x) => x.key === where.pkey) : undefined;
      if (!where || !p) return null;
      info.set(key, { fx: fxName(where.id), label: p.label, type: p.type, step: p.step, options: p.options });
      ids.add(where.id);
    }
    const run: CueRun = {
      src, timeline, baseline, ids, info,
      written, // what the effects are known to hold (empty: every key gets the state at the current time)
      index: -2, dirty: true, enabled, lastT: NaN, writes: 0,
    };
    dropCues();
    cueRef.current = run;
    setCueView(cueViewOf(run, cueLaneDur(timeline)));
    if (enabled) { cueTick(); cueArm(); }
    return run;
  };
  /** Puts back a timeline an undo recorded (PlanUndo.prevCues) — on the same INPUT video only. */
  const reinstallCues = (snap: PlanUndo['prevCues']): boolean => {
    if (!snap || !Array.isArray(snap.timeline?.cues) || !snap.timeline.cues.length) return false;
    const src = fileSourceRef.current;
    if (kindRef.current !== 'video' || !src || src.url !== snap.source) return false;
    const baseline = new Map((snap.baseline ?? []).map((b) => [b.key, b.value] as [string, number]));
    const run = installCues(src.url, cueTimelineCopy(snap.timeline), baseline, snap.enabled !== false);
    if (!run) console.warn('[Lab] could not put the earlier cue timeline back: one of its effects is not in the chain');
    return !!run;
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
          /* the hold raised the budgets: a paused chain (the Lab hidden) may not have put a
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
        const paramsOf = paramsCache();
        for (const e of Array.isArray(plan?.params) ? plan.params : []) {
          const c = checkParam(e, paramsOf);
          if (c.ok === false) { skipped.push(c.why); continue; }
          let ok = false;
          try { ok = c.api.setParam(c.p.key, c.v); } catch { ok = false; }
          if (!ok) { skipped.push(`${c.key}: the effect did not take the value`); continue; }
          if (!undo.has(c.key)) undo.set(c.key, undoEntryOf(c.key, c.p));
          applied++;
        }
        for (const r of Array.isArray(plan?.routes) ? plan.routes : []) {
          skipped.push(`${String(r?.key)}: signal routes do not exist in the Lab — each effect reacts through its own controls`);
        }
        if (!undo.size) return { applied, skipped, undo: null };
        /* A key the installed timeline drives would be overwritten at its next cue: the new value is folded
           in — it becomes that key's value for the whole timeline (its baseline; the cues stop changing it;
           a cue left empty goes). The undo carries the timeline as it was, so reverting puts it back. */
        const run = cueRef.current;
        const folded = run ? [...undo.keys()].filter((k) => run.baseline.has(k)) : [];
        if (run && folded.length) {
          const before = cueSnapshot(run);
          const now = new Map<string, number>();
          const paramsAfter = paramsCache();
          for (const k of folded) {
            const where = splitKey(k);
            const api = where ? readyApi(where.id) : null;
            const p = where && api ? paramsAfter(where.id, api).find((x) => x.key === where.pkey) : undefined;
            if (p) now.set(k, valueOf(p));
          }
          for (const [k, v] of now) { run.baseline.set(k, v); run.written.set(k, v); }
          run.timeline = {
            ...run.timeline,
            cues: run.timeline.cues
              .map((c) => ({ ...c, params: c.params.filter((x) => !now.has(x.key)) }))
              .filter((c) => c.params.length),
          };
          if (!run.timeline.cues.length) dropCues();
          else {
            run.index = -2;
            run.dirty = true;
            setCueView(cueViewOf(run, cueLaneDur(run.timeline)));
          }
          return { applied, skipped, undo: { cues: true, prevCues: before, entries: [...undo.values()] } };
        }
        return { applied, skipped, undo: { entries: [...undo.values()] } };
      },

      revertPlan: (u: PlanUndo) => {
        if (exportingRef.current || !Array.isArray(u?.entries)) return { reverted: 0 };
        let reverted = 0;
        // a timeline's undo: the timeline it installed goes first, then the values, then the one it replaced
        if (u.cues === true && cueRef.current) { dropCues(); reverted++; }
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
        cueForget(u.entries.map((e) => e?.key).filter((k): k is string => typeof k === 'string'));
        if (u.prevCues && reinstallCues(u.prevCues)) reverted++;
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

      // the INPUT video's soundtrack, analysed once per video (concurrent calls share the promise)
      beatGrid: () => {
        const src = fileSourceRef.current;
        if (kindRef.current !== 'video' || !src || src.kind !== 'video') return Promise.resolve(null);
        const c = gridCacheRef.current;
        if (c && c.url === src.url) return c.promise;
        c?.ctrl.abort();
        const url = src.url;
        const ctrl = new AbortController();
        const entry = { url, ctrl, promise: Promise.resolve<BeatGrid | null>(null), value: null as BeatGrid | null };
        entry.promise = analyzeBeatGrid(url, ctrl.signal).then((g) => {
          if (!g || ctrl.signal.aborted) return null;
          const v = inputVideoRef.current;
          const fitted = v && fileSourceRef.current?.url === url && Number.isFinite(v.duration) && v.duration > 0 ? withDuration(g, v.duration) : g;
          entry.value = fitted;
          if (gridCacheRef.current === entry) setGridView(fitted); // its bar lines go on the track
          return fitted;
        }, () => null);
        gridCacheRef.current = entry;
        return entry.promise;
      },

      /* A timeline replaces the one installed before; an empty one only removes it. Every cue param is
         checked like a plan's; the undo = the baseline (each cued key's value now) + the replaced
         timeline (prevCues), so reverting gives back exactly the state before. */
      setCues: (timeline: CueTimeline) => {
        if (exportingRef.current) return { installed: 0, skipped: ['a Master export is running'], undo: null };
        const v = inputVideoRef.current;
        const src = fileSourceRef.current;
        if (kindRef.current !== 'video' || !v || !src || src.kind !== 'video') {
          return { installed: 0, skipped: ['cues play on a video INPUT: there is none'], undo: null };
        }
        const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : Infinity;
        const skipped: string[] = [];
        const paramsOf = paramsCache();
        const seen = new Map<string, { id: ModuleId; p: SynLabParam }>();
        let list: Cue[] = [];
        for (const c of Array.isArray(timeline?.cues) ? timeline.cues : []) {
          const at = Number(c?.at);
          const label = (typeof c?.label === 'string' ? c.label.trim() : '').slice(0, CUE_LABEL_MAX) || 'CUE';
          const tag = `cue ${Number.isFinite(at) ? fmtCueTime(at) : '?'} (${label})`;
          if (!Number.isFinite(at) || at < -0.05) { skipped.push(`${tag}: no valid time`); continue; }
          if (at >= dur) { skipped.push(`${tag}: after the end of the video`); continue; }
          const params = new Map<string, number>(); // one value per key: the last one wins
          for (const e of Array.isArray(c?.params) ? c.params : []) {
            const r = checkParam(e, paramsOf);
            if (r.ok === false) { skipped.push(`${tag} · ${r.why}`); continue; }
            params.set(r.key, r.v);
            if (!seen.has(r.key)) seen.set(r.key, { id: r.id, p: r.p });
          }
          if (!params.size) { skipped.push(`${tag}: no valid control — dropped`); continue; }
          list.push({ at: Math.max(0, at), label, params: [...params].map(([key, value]) => ({ key, value })) });
        }
        // sorted (stable), one cue per time (a later one at the same time adds to / overrides it), capped
        list.sort((a, b) => a.at - b.at);
        list = list.reduce<Cue[]>((acc, c) => {
          const prev = acc[acc.length - 1];
          if (prev && c.at - prev.at < CUE_EPS) {
            const m = new Map(prev.params.map((p) => [p.key, p.value] as [string, number]));
            c.params.forEach((p) => m.set(p.key, p.value));
            prev.params = [...m].map(([key, value]) => ({ key, value }));
          } else acc.push(c);
          return acc;
        }, []);
        if (list.length > MAX_CUES) {
          list.slice(MAX_CUES).forEach((c) => skipped.push(`cue ${fmtCueTime(c.at)} (${c.label}): over the ${MAX_CUES}-cue limit`));
          list = list.slice(0, MAX_CUES);
        }
        const old = cueRef.current;
        const prevCues = old ? cueSnapshot(old) : null;
        if (!list.length) {
          // no cue: the run has a fixed look — the timeline installed before goes (its values stay)
          if (!old) return { installed: 0, skipped, undo: null };
          dropCues();
          return { installed: 0, skipped, undo: { cues: true, prevCues, entries: [] } };
        }
        // the baseline: what every key the timeline touches holds right now
        const baseline = new Map<string, number>();
        const entries: PlanUndo['entries'] = [];
        list.forEach((c) => c.params.forEach(({ key }) => {
          if (baseline.has(key)) return;
          const { p } = seen.get(key)!;
          baseline.set(key, valueOf(p));
          entries.push(undoEntryOf(key, p));
        }));
        const fileGrid = gridCacheRef.current?.url === src.url ? gridCacheRef.current.value : null;
        // the effects hold the baseline now: only the differences are written (the state at the current time)
        const run = installCues(src.url, { cues: list, grid: sanitizeGrid(timeline?.grid) ?? fileGrid }, baseline, true, new Map(baseline));
        if (!run) return { installed: 0, skipped: [...skipped, 'the timeline could not be installed'], undo: null };
        return { installed: list.length, skipped, undo: { cues: true, prevCues, entries } };
      },

      cues: () => (cueRef.current ? cueTimelineCopy(cueRef.current.timeline) : null),

      // CUE AUTO: off holds the values where they are; back on writes the state at the current time
      setCuesEnabled: (on: boolean) => {
        const run = cueRef.current;
        const want = !!on;
        if (!run || run.enabled === want) return;
        run.enabled = want;
        if (want) {
          cueResync(); // every key: the operator may have moved some by hand meanwhile
          cueArm();
        } else {
          cueDisarm();
        }
        setCueView((cv) => (cv ? { ...cv, enabled: want } : cv));
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
        /** the right column: open a node's block and scroll to it; which blocks are open */
        openBlock: (id: ModuleId) => focusNodeRef.current(id),
        openBlocks: () => [...openBlocksRef.current],
        /** every node's SynLab layout + reported panel height */
        layouts: () => Object.fromEntries([...nodesRef.current.values()].map((r) => {
          let l: unknown = null;
          try { l = r.api?.layout?.() ?? null; } catch { l = null; }
          return [r.id, { layout: l, panelHeight: r.api ? readPanelHeight(r.api) : 0 }];
        })),
        /** the cue engine: the index it last applied, at what INPUT time, how it follows the clock, its log */
        cueEngine: () => {
          const run = cueRef.current;
          const L = cueLoopRef.current;
          return {
            installed: !!run,
            enabled: run?.enabled ?? false,
            index: run ? run.index : null,
            lastT: run ? run.lastT : null,
            writes: run?.writes ?? 0,
            armed: !!L.handle,
            mode: L.mode,
            standIn: !!L.standIn,
            written: run ? Object.fromEntries(run.written) : null,
            log: cueLogRef.current.slice(),
          };
        },
      };
    }
  };
  useEffect(() => { publishTaps(); }); // cheap; keeps the taps on the live refs

  /* the stage's size: the frame fits in it and every node's canvas area takes it (applyLayouts) */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setStageBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // the OUTPUT picture's aspect: the frame follows it
  useEffect(() => {
    const ov = outputVideoRef.current;
    if (!ov) return;
    const on = () => setOutAspect(ov.videoWidth > 0 && ov.videoHeight > 0 ? ov.videoWidth / ov.videoHeight : 0);
    ov.addEventListener('loadedmetadata', on);
    ov.addEventListener('resize', on);
    return () => { ov.removeEventListener('loadedmetadata', on); ov.removeEventListener('resize', on); };
  }, []);
  /* the Lab's work timer (the effects' top-bar timer, 03 §5.1): counts while the Lab is on screen and the
     app window is visible and focused (focus inside a node's iframe counts); kept for the tab's session */
  useEffect(() => {
    let sec = 0;
    try { sec = Number(sessionStorage.getItem(LAB_TIMER_KEY)) || 0; } catch { sec = 0; }
    setWorkSec(sec);
    const t = window.setInterval(() => {
      if (!visibleRef.current || document.visibilityState !== 'visible' || !document.hasFocus()) return;
      sec++;
      setWorkSec(sec);
      try { sessionStorage.setItem(LAB_TIMER_KEY, String(sec)); } catch { /* private mode */ }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  /** open / close a block of the right column (several may be open: the column scrolls as one) */
  const toggleBlock = (b: BlockId) => setOpenBlocks((prev) => {
    const next = new Set(prev);
    if (next.has(b)) next.delete(b); else next.add(b);
    return next;
  });
  /** a node's block, opened and scrolled into view (the column is the only scroller that moves) */
  const focusNode = (id: ModuleId) => {
    setOpenBlocks((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
    window.setTimeout(() => {
      const col = columnRef.current;
      const blk = col?.querySelector<HTMLElement>(`[data-testid="lab-block-${id}"]`);
      if (col && blk) col.scrollTo({ top: Math.max(0, blk.offsetTop - 4), behavior: 'smooth' });
    }, 60);
  };
  const focusNodeRef = useRef(focusNode);
  focusNodeRef.current = focusNode;

  /* drag & drop of a video / photo on the stage: the chain's INPUT */
  const onStageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => /^(video|image)\//.test(x.type) || /\.(mp4|webm|mov|m4v|mkv|jpe?g|png|webp|gif|bmp|avif)$/i.test(x.name));
    if (f) void loadSourceFile(f);
  };

  /* ═══ render ══════════════════════════════════════════════════════════ */
  const inputLabel = kind === 'none' ? 'NONE' : (kind === 'webcam' ? 'WEBCAM' : sourceName || kind).toUpperCase();
  const linkOf = (id: ModuleId): LinkState => links[id] ?? 'loading';
  const theme = isDayMode ? 'day' : 'night';
  const missing = chain.filter((id) => linkOf(id) === 'missing');
  /** DISPLAY order of the blocks and the title: A→Z by name (the processing order is the node graph's) */
  const sorted = useMemo(() => [...chain].sort((a, b) => fxName(a).localeCompare(fxName(b))), [chainKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = sorted.length ? sorted.map(fxName).join(' · ') : 'LAB';
  const engine = exporting ? 'REC' : chain.length === 0 ? 'IDLE' : chain.some((id) => linkOf(id) === 'loading') ? 'LOADING' : 'READY';
  const p2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
  const timecode = `${p2(workSec / 86400)}:${p2((workSec % 86400) / 3600)}:${p2((workSec % 3600) / 60)}:${p2(workSec % 60)}`;

  /* the frame: the OUTPUT's aspect (16:9 with no picture yet), fitted in the stage − 24 px like the effects' */
  const inAspect = (() => {
    const el = kind === 'video' ? inputVideoRef.current : kind === 'webcam' ? camVideoRef.current : null;
    if (el && el.videoWidth > 0 && el.videoHeight > 0) return el.videoWidth / el.videoHeight;
    const c = photoCanvasRef.current;
    return kind === 'image' && c && c.width > 0 && c.height > 0 ? c.width / c.height : 0;
  })();
  const aspect = kind === 'none' ? 16 / 9 : outAspect || inAspect || 16 / 9;
  const aw = Math.max(16, stageBox.w - FRAME_PAD);
  const ah = Math.max(16, stageBox.h - FRAME_PAD);
  const frame = aw / ah > aspect ? { w: Math.round(ah * aspect), h: ah } : { w: aw, h: Math.round(aw / aspect) };

  /* the cue lane: bar lines of the beat grid (the timeline's, else the analysed one), the section blocks,
     a diamond per cue — all placed in % of the scrub track's travel (the rail is inset by the thumb's half) */
  const laneGrid = cueView?.grid ?? gridView;
  const laneDur = tp.dur > 0 ? tp.dur : cueView?.duration ?? laneGrid?.duration ?? 0;
  const bars = useMemo(() => barLines(laneGrid, laneDur), [laneGrid, laneDur]);
  const laneOn = kind === 'video' && laneDur > 0 && (!!cueView || bars.length > 0);
  const lanePct = (t: number) => `${clamp(t / laneDur, 0, 1) * 100}%`;
  const showCueTip = (i: number, el: HTMLElement) => {
    const tr = transportRef.current;
    if (!tr) return;
    const a = el.getBoundingClientRect();
    setCueTip({ i, x: a.left + a.width / 2 - tr.getBoundingClientRect().left });
  };
  const tipMark = cueTip && cueView ? cueView.marks[cueTip.i] ?? null : null;
  // the tooltip is centred on its diamond, kept inside the transport
  useLayoutEffect(() => {
    const tip = cueTipRef.current;
    const tr = transportRef.current;
    if (!tip || !tr || !cueTip) return;
    const w = tip.offsetWidth;
    tip.style.left = `${clamp(cueTip.x - w / 2, 6, Math.max(6, tr.clientWidth - w - 6))}px`;
    tip.style.visibility = 'visible';
  }, [cueTip, tipMark]);

  /** a block's header: name, chevron, the LED outline (black + amber in both themes) */
  const blockHead = (b: BlockId, label: string, extra?: { link?: LinkState; title?: string }) => {
    const open = openBlocks.has(b);
    return (
      <button
        type="button"
        className={`fxl-blk-head${open ? ' open' : ''}`}
        data-testid={`lab-block-head-${b}`}
        data-link={extra?.link}
        aria-expanded={open}
        title={extra?.title}
        onClick={() => toggleBlock(b)}
      >
        <span className="fxl-blk-name">{label}</span>
        {extra?.link && extra.link !== 'ready' && <span className={`fxl-blk-state ${extra.link}`}>{extra.link === 'missing' ? 'NO LINK' : '…'}</span>}
        <span className="fxl-blk-chev" aria-hidden>▼</span>
      </button>
    );
  };
  const exportTitle = exporting ? 'Stop the export (nothing is saved)'
    : kind === 'video' ? 'Record the chain output from the start of the video to its end (realtime), with the Lab audio'
    : kind === 'none' ? 'The export needs a source'
    : `Record ${STILL_TAKE_SEC} s of the chain output (realtime), with the Lab audio`;

  return (
    <div className="syn-fxlab" data-testid="chain-lab" data-theme={theme}>
      {/* ── the effects' top bar: the chain's names · INPUT · ENGINE · timer · FPS ── */}
      <div className="fxl-topbar">
        <div className="fxl-logo" data-testid="lab-title" title={chain.length ? `Processing order: ${chain.map(fxName).join(' → ')}` : undefined}>{title}</div>
        <div className="fxl-sep" />
        <div className={`fxl-pill${kind !== 'none' ? ' live' : ''}`} data-testid="chain-input" title={sourceName || undefined}>
          <span className="fxl-dot" />
          <span className="fxl-pill-pre">INPUT</span>
          <span className="fxl-pill-val">{inputLabel}</span>
        </div>
        <div className={`fxl-pill ${exporting ? 'rec' : 'engine'}`} data-testid="lab-engine">
          <span className="fxl-dot" />
          <span className="fxl-pill-pre">ENGINE</span>
          <span className="fxl-pill-val">{engine}</span>
        </div>
        <div className="fxl-timecode" data-testid="lab-timecode" title="Time spent in the Lab (this session)">{timecode}</div>
        <div className="fxl-fps" title="Frames per second of the chain OUTPUT (0 with no source, like the effects)">
          FPS <b data-testid="chain-fps">{kind === 'none' ? 0 : fps}</b>
        </div>
      </div>

      <div className="fxl-main">
        {/* ── left: the chain OUTPUT in the effects' frame, the transport under it ── */}
        <div className="fxl-area">
          <div
            ref={stageRef}
            className="fxl-stage"
            data-testid="lab-stage"
            onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onStageDrop}
          >
            <div className="fxl-wrap" style={{ width: frame.w, height: frame.h }}>
              <div className="fxl-frame-outline" />
              {/* INPUT elements: laid out under the OUTPUT (they feed node 1, the analyser, Gemini) */}
              <div className="fxl-layer fxl-media" data-testid="lab-layer-input">
                <video ref={(el) => { inputVideoRef.current = el; if (el && !el.dataset.init) { el.dataset.init = '1'; el.muted = true; } }} data-testid="lab-input-video" playsInline preload="auto" className={kind === 'video' ? '' : 'fxl-gone'} />
                <canvas ref={photoCanvasRef} data-testid="lab-input-photo" className={kind === 'image' ? '' : 'fxl-gone'} />
                <video ref={(el) => { camVideoRef.current = el; if (el) el.muted = true; }} data-testid="lab-input-cam" playsInline className={kind === 'webcam' ? '' : 'fxl-gone'} />
              </div>
              <div className="fxl-layer fxl-media top" data-testid="lab-layer-output">
                <video ref={(el) => { outputVideoRef.current = el; if (el) el.muted = true; }} data-testid="lab-output-video" playsInline autoPlay />
              </div>
              {kind === 'none' && (
                /* the effects' drop overlay: drop a file anywhere on the stage, or click */
                <div className={`fxl-drop${dragOver ? ' drag-over' : ''}`} data-testid="lab-drop" onClick={() => pickSource('video/*,image/*')}>
                  <div className="fxl-drop-ico" aria-hidden>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                  </div>
                  <div className="fxl-drop-title">LAB</div>
                  <div className="fxl-drop-sub">IMAGE — VIDEO — WEBCAM</div>
                  <button type="button" className="fxl-drop-btn" data-testid="lab-drop-source" onClick={(e) => { e.stopPropagation(); pickSource('video/*,image/*'); }}>SOURCE</button>
                </div>
              )}
              {chain.length === 0 && (
                <div className="fxl-hint" data-testid="chain-empty">
                  No effects in the chain — add them with <b>+ Add Node</b> in the node graph and wire INPUT → … → OUTPUT.
                </div>
              )}
            </div>
            {(missing.length > 0 || note || error) && (
              <div className="fxl-status">
                {missing.length > 0 && (
                  <span className="fxl-err" data-testid="chain-link-missing">
                    {missing.map((id) => `${fxName(id)}: Lab link not available`).join(' · ')}
                  </span>
                )}
                {note && <span className="fxl-note" data-testid="chain-note">{note}</span>}
                {error && <span className="fxl-err" data-testid="chain-error">{error}</span>}
              </div>
            )}
          </div>

          {/* ── transport (video INPUT): the effects' timeline + the Gemini cue lane ── */}
          {kind === 'video' && (
            <div className={`fxl-transport${cueView ? ' has-cues' : ''}`} data-testid="lab-transport" ref={transportRef}>
              <button type="button" data-testid="lab-play" className={`fxl-tl-btn${tp.playing ? '' : ' lit'}`} onClick={togglePlay} title={tp.playing ? 'Pause the INPUT (the whole chain and the sound)' : 'Play'}>
                {tp.playing ? '▮▮ PAUSE' : '▶ PLAY'}
              </button>
              <span className="fxl-tl-cur" data-testid="lab-time">{fmtTC(tp.t)}</span>
              <div className="fxl-tl-wrap">
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
                {laneOn && (
                  <div className="fxl-cue-rail">
                    {bars.map((t) => <i key={t} className="fxl-cue-bar" data-testid="cue-bar" style={{ left: lanePct(t) }} />)}
                    {cueView && (
                      <div className="fxl-cue-lane" data-testid="cue-lane">
                        {cueView.segments.map((g) => (
                          <span
                            key={`${g.first}-${g.start}`}
                            className={`fxl-cue-sec${g.hot ? ' hot' : ''}`}
                            style={{
                              left: `calc(${lanePct(g.start)} + 1px)`,
                              width: `calc(${clamp((g.end - g.start) / laneDur, 0, 1) * 100}% - 2px)`,
                              '--cue-mix': `${Math.round(18 + 26 * (g.energy ?? 0.4))}%`,
                            } as React.CSSProperties}
                            title={`${g.label} · ${fmtCueTime(g.start)}–${fmtCueTime(g.end)}`}
                          >
                            {g.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {cueView?.marks.map((m, i) => (
                      <button
                        key={`${i}-${m.at}`}
                        type="button"
                        className={`fxl-cue-mark${m.hot ? ' hot' : ''}${i === cueIdx ? ' on' : ''}`}
                        data-testid={`cue-mark-${i}`}
                        style={{ left: lanePct(m.at) }}
                        aria-label={`${fmtCueTime(m.at)} · ${m.label} — go to this cue`}
                        onMouseEnter={(e) => showCueTip(i, e.currentTarget)}
                        onMouseLeave={() => setCueTip(null)}
                        onFocus={(e) => showCueTip(i, e.currentTarget)}
                        onBlur={() => setCueTip(null)}
                        onClick={() => scrub(m.at)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <span className="fxl-tl-dur">{fmtTC(tp.dur)}</span>
              {cueView && (
                <button
                  type="button"
                  className={`fxl-cue-chip${cueView.enabled ? ' on' : ''}`}
                  data-testid="cue-auto"
                  data-on={cueView.enabled ? '1' : '0'}
                  aria-pressed={cueView.enabled}
                  onClick={() => labRef.current?.setCuesEnabled(!cueView.enabled)}
                  title={cueView.enabled
                    ? `The ${cueView.count} cues play with the video — click to hold the controls where they are`
                    : 'Cue automation is off: the controls hold their values — click to play the cues again'}
                >
                  <span className="fxl-cue-chip-dot" />CUE AUTO · {cueView.count}
                </button>
              )}
              {/* LOOP = PAUSE's normal look; on/off is only its text colour (operator) */}
              <button type="button" data-testid="lab-loop" className={`fxl-tl-btn fxl-tl-loop${tp.loop ? ' on' : ''}`} onClick={toggleLoop} title={tp.loop ? 'Loop on — click to play once' : 'Loop off — click to loop'}>⟳ LOOP</button>
              {tipMark && (
                <div ref={cueTipRef} className={`fxl-cue-tip${tipMark.hot ? ' hot' : ''}`} data-testid="cue-tip" role="tooltip" key={cueTip!.i}>
                  <div className="fxl-cue-tip-head">{fmtCueTime(tipMark.at)} · {tipMark.label}</div>
                  {tipMark.lines.map((l, j) => <div key={j}>{l}</div>)}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── right: one column, one scroll — SOURCE · the nodes A→Z · LABORATORY ── */}
        <div className="fxl-col" ref={columnRef} data-testid="lab-column">
          <input ref={fileRef} type="file" accept="video/*,image/*" data-testid="chain-file" className="fxl-file" onChange={(e) => { void loadSourceFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <input ref={audioFileRef} type="file" accept="audio/*" data-testid="audio-file" className="fxl-file" onChange={(e) => { void loadAudioFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />

          <section className={`fxl-blk${openBlocks.has('source') ? ' open' : ''}`} data-testid="lab-block-source">
            {blockHead('source', 'SOURCE', { title: 'The chain\'s source: it feeds the whole chain' })}
            <div className="fxl-blk-clip" style={{ height: openBlocks.has('source') ? 'auto' : 0 }}>
              <div className="fxl-blk-body">
                <div className="fxl-seg-row">
                  <button type="button" className={`fxl-seg${kind === 'image' ? ' on' : ''}`} data-testid="lab-src-image" onClick={() => pickSource('image/*')} title="Load a photo as the chain's source">IMAGE</button>
                  <button type="button" className={`fxl-seg${kind === 'video' ? ' on' : ''}`} data-testid="lab-src-video" onClick={() => pickSource('video/*')} title="Load a video as the chain's source">VIDEO</button>
                  <button type="button" className={`fxl-seg${kind === 'webcam' ? ' on' : ''}`} data-testid="lab-webcam" onClick={toggleWebcam} title={kind === 'webcam' ? 'Stop the webcam' : 'Use the webcam as the chain\'s source'}>WEBCAM</button>
                </div>
                <div className="fxl-seg-row">
                  <button
                    type="button"
                    className={`fxl-seg${audioMode === 'clip' ? ' on' : ''}`}
                    data-testid="audio-clip"
                    onClick={toggleClipAudio}
                    disabled={kind !== 'video'}
                    title={kind === 'video' ? (audioMode === 'clip' ? "Turn the video's own sound off" : "Hear the video's own sound (it drives the meter and the effects)") : 'Needs a video source'}
                  >
                    CLIP
                  </button>
                  <button type="button" className={`fxl-seg${audioMode === 'mic' ? ' on' : ''}`} data-testid="audio-toggle" onClick={toggleMic} title={audioMode === 'mic' ? 'Stop the microphone' : 'React to the microphone'}>MIC</button>
                  <button type="button" className={`fxl-seg${audioMode === 'file' ? ' on' : ''}`} data-testid="audio-file-btn" onClick={toggleTrack} title={audioMode === 'file' ? 'Stop the music track' : 'React to a music track'}>TRACK</button>
                </div>
              </div>
            </div>
          </section>

          {sorted.map((id) => {
            const open = openBlocks.has(id);
            const h = panelH[id] ?? 0;
            const viewport = Math.max(PANEL_VIEWPORT_MIN, Math.ceil((h + PANEL_VIEWPORT_STEP / 2) / PANEL_VIEWPORT_STEP) * PANEL_VIEWPORT_STEP);
            return (
              <section key={id} className={`fxl-blk fx${open ? ' open' : ''}`} data-testid={`lab-block-${id}`}>
                {blockHead(id, fxName(id), {
                  link: linkOf(id),
                  title: linkOf(id) === 'missing' ? `${fxName(id)}: Lab link not available — bypassed` : `${fxName(id)} — node ${chain.indexOf(id) + 1} of ${chain.length} in the chain`,
                })}
                {/* collapsed = a zero-height clip: the iframe stays laid out and keeps rendering (never display:none) */}
                <div className="fxl-blk-clip" style={{ height: open ? (h > 0 ? h : 120) : 0 }}>
                  {open && h === 0 && <div className="fxl-blk-wait">LOADING…</div>}
                  <iframe
                    ref={frameRefOf(id)}
                    src={labPanelSrc(labFrameSrc(id))}
                    title={`${fxName(id)} (Lab node)`}
                    data-testid={`lab-frame-${id}`}
                    data-syn-theme={theme}
                    className="fxl-frame"
                    style={{ height: viewport }}
                    allow="camera; microphone; autoplay; fullscreen"
                    onLoad={(e) => onFrameLoad(id, e.currentTarget)}
                  />
                </div>
              </section>
            );
          })}

          <section className={`fxl-blk${openBlocks.has('laboratory') ? ' open' : ''}`} data-testid="lab-block-laboratory">
            {blockHead('laboratory', 'LABORATORY')}
            <div className="fxl-blk-clip" style={{ height: openBlocks.has('laboratory') ? 'auto' : 0 }}>
              <div className="fxl-blk-body">
                {/* four buttons, no captions (operator); a name field / the saved chains open under their button */}
                <button
                  type="button"
                  className={`fxl-seg fxl-lab-btn${labPane === 'save' ? ' on' : ''}`}
                  data-testid="lab-save-chain"
                  aria-expanded={labPane === 'save'}
                  onClick={() => setLabPane((v) => (v === 'save' ? null : 'save'))}
                  disabled={chain.length === 0}
                  title="Save the chain and every effect's settings — it is listed in Projects"
                >
                  SAVE VFX CHAIN TO PROJECTS
                </button>
                {labPane === 'save' && (
                  <div className="fxl-seg-row">
                    <input
                      type="text"
                      className="fxl-input"
                      data-testid="preset-name"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setLabPane(null); }}
                      placeholder="name"
                      aria-label="Name of the chain"
                      autoFocus
                    />
                    <button type="button" className="fxl-seg fxl-seg-fit" onClick={savePreset} data-testid="preset-save" disabled={!presetName.trim() || chain.length === 0} title="Save">SAVE</button>
                  </div>
                )}
                <button
                  type="button"
                  className={`fxl-seg fxl-lab-btn${labPane === 'open' ? ' on' : ''}`}
                  data-testid="lab-open-chain"
                  aria-expanded={labPane === 'open'}
                  onClick={() => { setPresets(readPresets()); setLabPane((v) => (v === 'open' ? null : 'open')); }}
                  title="Load a chain saved in Projects"
                >
                  OPEN VFX CHAIN FROM PROJECTS
                </button>
                {labPane === 'open' && (presets.length === 0 ? (
                  <p className="fxl-lab-note" data-testid="preset-none">No saved chains yet.</p>
                ) : (
                  <div className="fxl-preset-list" data-testid="preset-list">
                    {presets.map((p) => (
                      <div key={p.name} className="fxl-preset-item">
                        <button type="button" className="fxl-seg fxl-preset-load" onClick={() => { loadPreset(p); setLabPane(null); }} data-testid={`preset-load-${p.name}`} title={isV2(p) ? `Load "${p.name}" (${presetChain(p).length} effects)` : `${p.name} (old preset: chain order only)`}>
                          {p.name}{isV2(p) ? '' : ' ·v1'}
                        </button>
                        <button type="button" className="fxl-seg fxl-seg-fit" onClick={() => deletePreset(p.name)} data-testid={`preset-del-${p.name}`} title="Delete" aria-label={`Delete ${p.name}`}>
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
                <button type="button" className="fxl-seg fxl-lab-btn" data-testid="lab-reset" onClick={resetChain} disabled={chain.length === 0 || exporting} title="Every effect of the chain back to its initial values">
                  RESET VFX CHAIN
                </button>
                <button
                  type="button"
                  data-testid="chain-master"
                  onClick={runMaster}
                  disabled={kind === 'none' && !exporting}
                  title={exportTitle}
                  className={`fxl-seg fxl-lab-btn fxl-export${exporting ? ' on rec' : ''}`}
                >
                  {exporting ? '■ STOP EXPORT' : 'EXPORT VFX CHAIN'}
                </button>
                {exportMsg && (
                  <p data-testid="chain-export-msg" className={`fxl-lab-msg${exportMsg.startsWith('✗') ? ' err' : ''}`} title={exportMsg}>
                    {exportMsg}
                  </p>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});

export default ChainLab;
