import React, { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Bot,
  Lightbulb,
  Settings,
  RefreshCw,
  Eye,
  EyeOff,
  Undo2,
  ChevronRight,
  Cpu,
  X,
} from 'lucide-react';
import type { ModuleId } from '../types';
import { EFFECT_META } from './NodalComposition';
import {
  GEMINI_MODEL_DEFAULT,
  MAX_UPLOAD_BYTES,
  MODULE_IDS,
  type AgentPlan,
  type AgentRequest,
  type AgentResult,
  type AiErrorKind,
  type ArtDirection,
  type ArtDirectorRequest,
  type ArtDirectorResult,
  type ChainState,
  type CheckResult,
  type LabHandle,
  type MediaPart,
  type OptimizerRequest,
  type OptimizerResult,
  type ParamDesc,
  type PlanUndo,
  type SignalSummary,
  type SourceRef,
  type UploadResponse,
} from '../ai/contract';
import {
  AiError,
  aiPost,
  cachedUpload,
  forgetUpload,
  isKeyText,
  isUnusableUpload,
  uploadSource,
  uploadVideoMime,
  type UploadMeta,
} from '../ai/client';
import { elementToJpeg, sampleVideoFrames } from '../ai/capture';

/* ═══════════════════════════════════════════════════════════════
   GEMINI 3.8 — the panel (src/ai/contract.ts is the wire format).

   Locked until a key is active: the body is then the key form. Once
   active, a role is picked in the left rail (or on the ACTIVE card):

     ART DIRECTOR  watches the source (the whole clip with its music when
                   it can be uploaded, else frames; a photo; the Lab's
                   webcam) and proposes effect chains. "Use this chain"
                   wires it, opens the Lab, and keeps the proposal as the
                   ART DIRECTION the Agent and the Optimizer work to.
     AGENT         Lab only. Hears and sees the source (the uploaded clip,
                   with its song), a SOURCE/OUTPUT frame pair, 4s of OUTPUT
                   with the music when audio is on, and 3s of live signals;
                   then sets parameters AND audio routes. Applied at once;
                   Undo puts back only the keys the plan touched.
     OPTIMIZER     Lab only. Records 4s of OUTPUT with the music, runs the
                   deterministic checks, and asks Gemini to judge the
                   result — each issue may carry a fix (an AgentPlan).

   Audio is OFF by default in the Lab, even for a music video: the Agent
   and the Optimizer switch the clip's own soundtrack on at Run (inside the
   click, so the browser lets the AudioContext start) and say so.

   A run is bound to the Lab handle it started on: if the Lab is closed or
   reopened meanwhile, the run stops ("The Lab changed — run again"), and
   Undo / Apply fix stay off on any other Lab.

   Capture happens only on a button press, once, downscaled (D10). The
   three tabs stay mounted and are only hidden, so a result survives a
   trip to another mode (D11). Gemini's prose arrives in Italian; the
   chrome around it stays English, like the rest of the app (D9).
   ═══════════════════════════════════════════════════════════════ */

export type GeminiMode = 'art_director' | 'agent' | 'optimizer';
export type GeminiStatus = 'checking' | 'standby' | 'active' | 'invalid';
type Surface = 'home' | 'lab' | 'effect';

/** The shell's INPUT source, as the picked File described it. */
export interface CompSource {
  url: string;
  name: string;
  kind: 'video' | 'image';
  mime: string;
  size: number;
  lastModified: number;
  /** the picked File itself — disk-backed, so it is uploaded as is (streamed),
   *  never read back from the object URL into a second in-memory copy */
  file: File;
}

/** What the Optimizer is told about the Agent's last move — and the Lab it
 *  was applied to (a reopened Lab starts from its own values). */
interface LastAgentRun { intent: string; plan: AgentPlan; at: string; lab: LabHandle }

interface AiDirectorProps {
  isDayMode?: boolean;
  activeGeminiMode: GeminiMode | null;
  /** key validation state (App owns it): only 'active' unlocks the roles */
  status: GeminiStatus;
  /** why the last validation failed, as an AiErrorKind */
  error: string | null;
  /** where the active key lives */
  source: 'browser' | 'server' | null;
  /** validate (and, if Google accepts it, store) a pasted key */
  onSubmitKey: (key: string) => Promise<boolean>;
  onForgetKey: () => void;
  /** a role call failed in a way the shell must hear (invalid_key, no_key) */
  onAiError: (kind: AiErrorKind) => void;
  surface: Surface;
  openEffectId: ModuleId | null;
  labRef: React.RefObject<LabHandle | null>;
  compSource: CompSource | null;
  /** the wired chain, in order */
  graphChain: ModuleId[];
  /** Art Director proposal → wire it + open the Lab */
  onUseChain: (chain: ModuleId[]) => void;
  /** "Open in Lab" (carries an open standalone effect over as the chain) */
  onOpenLab: () => void;
  /** the ACTIVE card's role buttons — the same switch as the left rail */
  onPickMode: (mode: GeminiMode) => void;
  /** the model the server runs (/api/gemini/status; GEMINI_MODEL may override) */
  model?: string;
}

/* ── copy ────────────────────────────────────────────────────── */

const KIND_TEXT: Record<AiErrorKind, string> = {
  no_key: 'No key yet: paste one to connect',
  invalid_key: 'Key rejected by Google',
  model_unavailable: `${GEMINI_MODEL_DEFAULT} is not available for this key`,
  quota: 'Free quota reached — try again later',
  too_large: 'Too large to send to Gemini',
  no_media: 'Nothing to show Gemini yet',
  bad_request: 'Gemini refused the request',
  upstream: 'Gemini is not answering — try again',
  network: 'Server not reachable',
  server_error: 'Server error — see the server log',
};
/** the copy for an error kind, naming the model the server really runs */
const kindText = (kind: AiErrorKind, model: string): string =>
  kind === 'model_unavailable' ? `${model} is not available for this key` : KIND_TEXT[kind];
const keyErrorText = (kind: string | null, model: string): string | null =>
  kind ? (kind in KIND_TEXT ? kindText(kind as AiErrorKind, model) : 'Key check failed') : null;

const MODE_TITLE: Record<GeminiMode, string> = { art_director: 'Art Director', agent: 'Agent', optimizer: 'Optimizer' };
const MODE_ICON: Record<GeminiMode, typeof Bot> = { art_director: Lightbulb, agent: Bot, optimizer: Settings };
const MODES: readonly GeminiMode[] = ['art_director', 'agent', 'optimizer'];

const LAB_CHANGED = 'The Lab changed — run again';
const CLIP_ON_NOTE = 'Clip audio switched on so Gemini can hear the music';
const KEY_CHARS_TEXT = 'The key contains invalid characters — copy it again';
const RETENTION_TEXT = 'Google keeps uploaded clips ~48h; on a free key it may use what you send to improve its products.';

const effectName = (id: string) => (EFFECT_META as Record<string, { name: string } | undefined>)[id]?.name ?? id;
const chainLabel = (chain: string[]) => (chain.length ? chain.map(effectName).join(' → ') : 'empty chain');
const MB = 1024 * 1024;
const fmtMB = (bytes: number) => `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
const fmtNum = (v: number) => {
  const a = Math.abs(v);
  return String(Number(v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2)));
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const AUDIO_SOURCES = ['bass', 'treble', 'loud', 'beat'];
/** what a recording made now carries, in the words the Lab labels it with */
const audioWords = (mode: ChainState['audioMode']) => (mode === 'mic' ? 'with mic audio' : 'with music');

/** How a video source reaches Gemini whole: the upload's meta, or null when
 *  it can only be read as frames (too large, or a container Gemini refuses). */
function uploadMetaOf(src: CompSource | null): UploadMeta | null {
  if (!src || src.kind !== 'video' || src.size > MAX_UPLOAD_BYTES) return null;
  const mime = uploadVideoMime(src.name, src.mime);
  return mime ? { name: src.name, size: src.size, lastModified: src.lastModified, mime } : null;
}
/** why a video goes as frames only (call only when uploadMetaOf is null) */
const framesOnlyWhy = (src: CompSource) =>
  src.size > MAX_UPLOAD_BYTES ? 'clip too large to upload' : 'this video format cannot be uploaded whole';

/** The upload Gemini reads the source from: the cached one, or a new one.
 *  The picked File is the body (streamed from disk, no copy). */
async function uploadOnce(src: CompSource, meta: UploadMeta, step: (l: string) => void): Promise<UploadResponse> {
  const hit = await cachedUpload(meta);
  if (hit) return hit;
  step(`Uploading clip ${fmtMB(src.size)} (once, reused for ~48h)…`);
  return uploadSource(src.file, meta);
}

/* ── shared look (the panel's existing class strings, D12) ───── */

const ink = (day?: boolean) => ({
  card: `p-3 rounded-xl border ${day ? 'bg-white border-[#8b5cf6]/20' : 'bg-[#8b5cf6]/10 border-[#8b5cf6]/40'} flex flex-col gap-2`,
  label: `font-mono text-[9px] uppercase tracking-widest ${day ? 'text-neutral-500' : 'text-neutral-400'}`,
  head: 'font-mono text-[10px] font-bold tracking-widest uppercase text-[#8b5cf6]',
  text: `font-mono text-[10px] leading-relaxed ${day ? 'text-neutral-700' : 'text-neutral-300'}`,
  sub: `font-mono text-[9px] leading-snug ${day ? 'text-neutral-500' : 'text-neutral-400'}`,
  // the systems search box (App.tsx) — the app's one input style
  box: `w-full min-w-0 border rounded-lg p-2.5 flex items-center gap-2 ${day ? 'bg-[#fcfbf9] border-neutral-200' : 'bg-[#0e0e0e] border-ink-700/70'}`,
  input: `w-full min-w-0 bg-transparent outline-none text-[10px] font-mono ${day ? 'text-neutral-900 placeholder:text-neutral-500' : 'text-white placeholder:text-neutral-600'}`,
  // the panel's violet submit button
  primary: `px-3 py-2 shrink-0 bg-[#8b5cf6] text-white font-extrabold text-[10px] tracking-wider uppercase rounded-md flex items-center justify-center gap-1.5 transition-colors ${day ? 'hover:bg-[#8b5cf6]/90' : 'hover:bg-[#8b5cf6]/80'} cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed`,
  // the panel's outline button ("Apply All Suggestions")
  secondary: `px-2 py-1 bg-[#8b5cf6]/10 text-[#8b5cf6] border ${day ? 'border-[#8b5cf6]/40' : 'border-[#8b5cf6]/30'} hover:bg-[#8b5cf6]/20 font-extrabold text-[9px] tracking-wider uppercase rounded-md transition-colors flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`,
  link: `font-mono text-[9px] uppercase tracking-widest ${day ? 'text-neutral-500' : 'text-neutral-400'} hover:text-[#8b5cf6] cursor-pointer`,
  // amber: bright amber-400 by night; by day the deep stop index.css uses for
  // the hero gradient on cream (#a16207) — amber-400 is ~1.6:1 there
  amberInk: day ? 'text-[#a16207]' : 'text-amber-400',
  amber: `font-mono text-[9px] leading-snug ${day ? 'text-[#a16207]' : 'text-amber-400'}`,
  error: 'font-mono text-[9px] leading-snug text-red-400',
  // pills: the node panel's ACTIVE / STANDBY, plus the amber/red the Lab uses
  pillBase: 'inline-flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded',
  green: day ? 'bg-green-500/10 text-green-700 border border-green-500/30' : 'bg-green-500/10 text-green-400 border border-green-500/40',
  grey: day ? 'bg-neutral-500/10 text-neutral-600 border border-neutral-500/30' : 'bg-neutral-500/10 text-neutral-400 border border-neutral-500/40',
  amberPill: day ? 'bg-amber-400/15 text-[#a16207] border border-[#a16207]/40' : 'bg-amber-400/15 text-amber-400 border border-amber-400/40',
  redPill: 'bg-red-400/10 text-red-400 border border-red-400/40',
});
type Ink = ReturnType<typeof ink>;

/* ── one-shot helpers (button press only — D10) ──────────────── */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The photo could not be read'));
    img.src = src;
  });
}

/** A video URL's duration from its metadata alone — a detached element, so
 *  the hero (which AudioMeter taps) is never touched. */
function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    let done = false;
    const finish = (d?: number) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      v.onloadedmetadata = null;
      v.onerror = null;
      v.removeAttribute('src');
      v.load();
      resolve(d && Number.isFinite(d) ? Math.round(d * 10) / 10 : undefined);
    };
    const timer = window.setTimeout(() => finish(), 5000);
    v.onloadedmetadata = () => finish(v.duration);
    v.onerror = () => finish();
    v.src = url;
  });
}

/** Mean luma (0..1) of a JPEG MediaPart, read from a 16×16 downscale. */
async function meanLuma(part: MediaPart | null): Promise<number | null> {
  if (!part) return null;
  try {
    const img = await loadImage(`data:${part.mimeType};base64,${part.data}`);
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (255 * (d.length / 4));
  } catch {
    return null;
  }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/**
 * The Lab plays a video with no audio on (its default, even for a music
 * video): switch the clip's own soundtrack on, so Gemini hears the song.
 * MUST run inside the click, before the run's first await — only then does
 * the browser let the AudioContext start. Null when there is nothing to do;
 * the promise says whether audio is on now (false: the clip has none).
 */
function autoClipAudio(lab: LabHandle): Promise<boolean> | null {
  try {
    if (lab.sourceKind() !== 'video' || lab.chainState().audioActive) return null;
    return lab.startClipAudio().catch(() => false);
  } catch {
    return null;
  }
}

/** The Optimizer's deterministic checks, computed before Gemini is asked:
 *  facts the Lab knows for certain, so the model judges the look and not
 *  whether a frame rate is low. `chain` is read BEFORE the recording (which
 *  itself slows the engine). One rule for audio, everywhere: a route on an
 *  audio signal while audio is off is WAITING for music, not broken — only
 *  a motion/brightness route on a provably dead signal (a still photo) is
 *  flagged. Carriers (the effects' built-in music response, which the AI may
 *  never switch off) are not counted at all. */
function computeChecks(chain: ChainState, signals: SignalSummary, luma: number | null): CheckResult[] {
  const audioOn = chain.audioActive || signals.audio.active;
  const routed = chain.params.filter((p) => p.route && !p.carrier);
  const audioRoutes = routed.filter((p) => AUDIO_SOURCES.includes(p.route!.source));
  const videoRoutes = routed.filter((p) => p.route!.source === 'motion' || p.route!.source === 'bright');
  const still = chain.sourceKind === 'image';
  const fps = Math.round(chain.fps);
  const res = Math.round(chain.resScale * 100);
  const perfOk = chain.fps >= 30 && chain.resScale >= 1;
  return [
    {
      id: 'performance',
      ok: perfOk,
      detail: `${fps} fps at ${res}% render resolution${perfOk ? '' : chain.resScale < 1 ? ' — adaptive resolution is cutting detail' : ' — below 30 fps'}`,
    },
    {
      id: 'audio_routes',
      ok: true, // informational: audio off is the Lab's default, not an error
      detail: audioOn
        ? `music on (${signals.audio.mode}), ${plural(audioRoutes.length, 'audio route')}`
        : audioRoutes.length
          ? `${plural(audioRoutes.length, 'audio route')} waiting for music — audio is off; they move once ${chain.sourceKind === 'video' ? 'Clip, Track' : 'Track'} or Mic is on`
          : 'no music on, no audio routes',
    },
    {
      id: 'video_routes',
      ok: !(still && videoRoutes.length),
      detail: still
        ? videoRoutes.length
          ? `${plural(videoRoutes.length, 'motion/brightness route')} on a still photo — that signal never changes, they stay still`
          : 'still photo, no motion/brightness routes'
        : `${plural(videoRoutes.length, 'motion/brightness route')} on a ${chain.sourceKind === 'none' ? 'missing' : 'moving'} source`,
    },
    {
      id: 'person_mask',
      ok: chain.maskState === null || chain.maskState === 'ready',
      detail: chain.maskState === null ? 'no node uses the person mask' : `person mask is ${chain.maskState}`,
    },
    {
      id: 'output_exposure',
      ok: luma !== null && luma > 0.04 && luma < 0.92,
      detail: luma === null
        ? 'the output frame could not be read'
        : `output mean luma ${luma.toFixed(2)}${luma <= 0.04 ? ' — almost black' : luma >= 0.92 ? ' — blown out' : ''}`,
    },
  ];
}

interface ChangeRow { key: string; label: string; from: string; to: string }

/** "Analog · Tear" for 'analog.tearAmt', from the chain table it was made for */
const paramName = (key: string, desc: Map<string, ParamDesc>) => {
  const node = key.split('.')[0];
  const p = desc.get(key);
  return p || node in EFFECT_META ? `${effectName(node)} · ${p?.label ?? key.slice(node.length + 1)}` : key;
};
const descOf = (chain: ChainState | null) => new Map((chain?.params ?? []).map((p) => [p.key, p]));

/** What a plan changes, against the chain it was made for. */
function describePlan(before: ChainState | null, plan: AgentPlan): ChangeRow[] {
  const desc = descOf(before);
  const val = (key: string, v: number | undefined) => {
    if (v === undefined) return '?';
    return desc.get(key)?.type === 'boolean' ? (v >= 0.5 ? 'on' : 'off') : fmtNum(v);
  };
  const rows: ChangeRow[] = [];
  for (const p of plan.params ?? []) {
    rows.push({ key: p.key, label: paramName(p.key, desc), from: val(p.key, desc.get(p.key)?.value), to: val(p.key, p.value) });
  }
  for (const r of plan.routes ?? []) {
    const cur = desc.get(r.key)?.route ?? null;
    rows.push({
      key: `~${r.key}`,
      label: `${paramName(r.key, desc)} ~`,
      from: cur ? `${cur.source} ${fmtNum(cur.amount)}` : 'no route',
      to: r.source === 'off' ? 'off' : `${r.source} ${fmtNum(r.amount)}`,
    });
  }
  return rows;
}

/* The validator's / the Lab's refusal reasons, in the director's words:
   'carrier' and 'enum' are code words. The key stays in a tooltip. */
const REFUSAL_WORDS: [RegExp, string][] = [
  [/^protected\b.*$/i, 'locked — Gemini never touches it'],
  [/^carrier — .*$/i, "the effect's own music response: only how deep it moves can change"],
  [/^carrier route cannot be switched off$/i, "the effect's own music response cannot be switched off"],
  [/^carrier route stays on (\w+)$/i, "the effect's own music response stays on $1"],
  [/^enum parameters are never routed$/i, 'a mode switch cannot follow a signal'],
  [/^not routable$/i, 'cannot follow a signal'],
];
function plainRefusal(text: string, desc: Map<string, ParamDesc>): { text: string; key: string | null } {
  const m = /^((?:fix \d+ · )?)([A-Za-z_][\w]*\.[\w]+)(?::\s*(.*))?$/.exec(text);
  if (!m) return { text, key: null };
  const [, pre, key, raw = ''] = m;
  let reason = raw.trim();
  for (const [re, plain] of REFUSAL_WORDS) {
    if (re.test(reason)) { reason = reason.replace(re, plain); break; }
  }
  return { text: `${pre}${paramName(key, desc)}${reason ? `: ${reason}` : ''}`, key };
}

function NotApplied({ k, items, chain }: { k: Ink; items: string[]; chain: ChainState | null }) {
  if (!items.length) return null;
  const desc = descOf(chain);
  return (
    <div className="flex flex-col gap-0.5 opacity-70">
      <span className={k.label}>Not applied:</span>
      <ul className="flex flex-col gap-0.5">
        {items.map((d, i) => {
          const r = plainRefusal(d, desc);
          return <li key={i} title={r.key ?? undefined} className={k.sub}>{r.text}</li>;
        })}
      </ul>
    </div>
  );
}

/* ── busy state: one request per tab, with an elapsed counter ── */

function useBusy() {
  const [label, setLabel] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(0);
  const running = useRef(false);
  const busy = label !== null;
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setElapsed(Math.floor((performance.now() - t0.current) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [busy]);
  return {
    busy,
    label,
    elapsed,
    /** false when a request is already running in this tab */
    start(l: string): boolean {
      if (running.current) return false;
      running.current = true;
      t0.current = performance.now();
      setElapsed(0);
      setLabel(l);
      return true;
    },
    step: (l: string) => setLabel(l),
    stop() {
      running.current = false;
      setLabel(null);
    },
  };
}

function BusyLine({ label, elapsed }: { label: string | null; elapsed: number }) {
  if (label === null) return null;
  return (
    <span className="flex items-center gap-2 font-mono text-[10px] text-[#8b5cf6]/80">
      <RefreshCw className="w-3 h-3 animate-spin shrink-0" /> {label} <span className="opacity-70">{elapsed}s</span>
    </span>
  );
}

/** Brings `el` into view inside its own tab's scroll box, block 'nearest'.
 *  Not Element.scrollIntoView: that also scrolls every overflow-hidden
 *  ancestor, and the cage's openings are exactly that — the layout would
 *  shift. Only the panel's own scroller ([data-ai-scroll]) moves. */
function reveal(el: HTMLElement | null): void {
  const box = el?.closest<HTMLElement>('[data-ai-scroll]');
  if (!el || !box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.top < b.top) box.scrollTop -= b.top - r.top;
  else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
}
/** a ref revealed each time `dep` changes to something truthy */
function useReveal(dep: unknown, on: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (on && dep) reveal(ref.current);
  }, [dep]); // eslint-disable-line
  return ref;
}

/* ═══════════════════════════════════════════════════════════════ */

export default function AiDirector(props: AiDirectorProps) {
  const { isDayMode, activeGeminiMode, status, error, source, onSubmitKey, onForgetKey, onAiError, onPickMode } = props;
  const model = props.model || GEMINI_MODEL_DEFAULT;
  const k = ink(isDayMode);
  const active = status === 'active';
  const mode = active ? activeGeminiMode : null;
  const panelInk = isDayMode ? 'bg-[#fbfaf7]' : 'bg-ink-900';
  // the Agent's last run, kept here so the Optimizer can be told about it (D11)
  const [lastAgentRun, setLastAgentRun] = useState<LastAgentRun | null>(null);
  // the Art Director proposal chosen with "Use this chain": the brief the
  // Agent executes and the Optimizer judges against (the typed intent still
  // wins where they disagree)
  const [direction, setDirection] = useState<ArtDirection | null>(null);

  /** an error for the tab's inline line; tells the shell when the key died */
  const reportError = (e: unknown): string => {
    if (e instanceof AiError) {
      if (e.kind === 'invalid_key' || e.kind === 'no_key') onAiError(e.kind);
      return e.message && e.message !== e.kind ? e.message : kindText(e.kind, model);
    }
    return e instanceof Error && e.message ? e.message : 'Something went wrong';
  };

  const shared = { ...props, k, reportError, direction, onClearDirection: () => setDirection(null) };

  return (
    <div className={`flex-1 flex flex-col h-full w-full overflow-hidden ${panelInk}`}>
      {/* Header */}
      <div className={`px-4 py-3 border-b flex items-center justify-between shrink-0 ${isDayMode ? 'border-[#8b5cf6]/30 bg-white' : 'border-[#8b5cf6]/40 bg-ink-900'}`}>
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center shrink-0">
            {mode === 'art_director' ? <Lightbulb className="w-4 h-4 text-[#8b5cf6]" /> :
             mode === 'agent' ? <Bot className="w-4 h-4 text-[#8b5cf6]" /> :
             mode === 'optimizer' ? <Settings className="w-4 h-4 text-[#8b5cf6]" /> :
             <Sparkles className="w-4 h-4 text-[#8b5cf6]" />}
          </div>
          <h2 className="text-[11px] tracking-[0.22em] font-mono uppercase font-bold text-[#8b5cf6]">
            {mode ? MODE_TITLE[mode] : 'Gemini 3.8'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {/* The node panel's pills, day and night: green only when the key is
              really live; grey STANDBY for no key, checking, or rejected. */}
          {active ? (
            <span data-testid="ai-status" className={`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${k.green}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_#22c55e]" /> Active
            </span>
          ) : (
            <span data-testid="ai-status" className={`flex items-center gap-1 text-[8px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded ${k.grey}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isDayMode ? 'bg-neutral-500/70' : 'bg-neutral-400/80'}`} /> Standby
            </span>
          )}
        </div>
      </div>

      {!active && <KeyForm k={k} status={status} error={error} model={model} onSubmitKey={onSubmitKey} />}

      {active && !mode && (
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {/* sizes to its content, not h-full: the opening is shorter than the
              panel's natural height (the cage) */}
          <div className={k.card}>
            <p className={k.text}>
              <b className="text-[#8b5cf6]">Gemini 3.8 is active.</b> Pick a role here or in the left rail.
            </p>
            {/* the rail's three roles, again: on a short window the rail's
                lower buttons sit under the meter — this row is always reachable */}
            <div className="flex flex-wrap gap-1.5">
              {MODES.map((m) => {
                const Icon = MODE_ICON[m];
                return (
                  <button key={m} type="button" data-testid={`ai-pick-${m}`} onClick={() => onPickMode(m)} className={k.secondary}>
                    <Icon className="w-3 h-3" /> {MODE_TITLE[m]}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={k.sub}>{source === 'server' ? 'key from server .env' : 'key from this browser'}</span>
              {source !== 'server' && (
                <button type="button" data-testid="ai-key-forget" onClick={onForgetKey} className={k.link}>
                  Forget key
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* the three roles: always mounted, only hidden (D11) */}
      <ArtDirectorTab {...shared} visible={mode === 'art_director'} onChooseDirection={setDirection} />
      <AgentTab {...shared} visible={mode === 'agent'} onAgentRun={setLastAgentRun} />
      <OptimizerTab {...shared} visible={mode === 'optimizer'} lastAgentRun={lastAgentRun} />
    </div>
  );
}

type TabProps = AiDirectorProps & {
  k: Ink;
  reportError: (e: unknown) => string;
  visible: boolean;
  direction: ArtDirection | null;
  onClearDirection: () => void;
};

/** a tab's scroll box: the element reveal() moves */
const tabBox = (visible: boolean) => (visible ? 'flex-1 overflow-y-auto p-4 custom-scrollbar' : 'hidden');

/* ── the key form (any status but 'active') ──────────────────── */

function KeyForm({ k, status, error, model, onSubmitKey }: { k: Ink; status: GeminiStatus; error: string | null; model: string; onSubmitKey: (key: string) => Promise<boolean> }) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  // a key that cannot even travel in a header (a curly quote, a non-ASCII
  // space): caught here, before fetch throws and reads as 'Server not reachable'
  const [charsErr, setCharsErr] = useState(false);
  const checking = status === 'checking';
  const errText = charsErr ? KEY_CHARS_TEXT : keyErrorText(error, model);
  return (
    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
      <form
        className={k.card}
        onSubmit={(e) => {
          e.preventDefault();
          if (checking) return;
          const typed = value.trim();
          if (typed && !isKeyText(typed)) {
            setCharsErr(true);
            return;
          }
          setCharsErr(false);
          // the typed key stays in the field either way: a rejected one is
          // there to be corrected (it is never stored)
          void onSubmitKey(value).catch(() => {});
        }}
      >
        {/* the error sits beside the label, above the field: in the smallest
            opening (295x169) a line under the link would be scrolled away */}
        <div className="flex items-baseline justify-between gap-x-2 flex-wrap">
          <label htmlFor="ai-key-input" className={k.label}>API Key</label>
          {errText && (!checking || charsErr) && <span data-testid="ai-key-error" className={`${k.error} text-right`}>{errText}</span>}
        </div>
        <div className="flex gap-2">
          <div className={k.box}>
            <input
              id="ai-key-input"
              data-testid="ai-key-input"
              type={show ? 'text' : 'password'}
              value={value}
              onChange={(e) => { setValue(e.target.value); setCharsErr(false); }}
              placeholder="Paste your Gemini key"
              autoComplete="off"
              spellCheck={false}
              className={k.input}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Hide key' : 'Show key'}
              className="text-neutral-500 hover:text-[#8b5cf6] shrink-0 cursor-pointer"
            >
              {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button type="submit" data-testid="ai-key-submit" disabled={checking} className={k.primary}>
            {checking ? 'Checking…' : 'Connect'}
          </button>
        </div>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className={`${k.sub} hover:text-[#8b5cf6]`}
        >
          Free key: aistudio.google.com/apikey
        </a>
      </form>
    </div>
  );
}

/* ── "this role works in the Lab" ────────────────────────────── */

function NeedsLab({ k, what, openEffectId, hasSource, onOpenLab }: { k: Ink; what: string; openEffectId: ModuleId | null; hasSource: boolean; onOpenLab: () => void }) {
  const fx = openEffectId ? effectName(openEffectId) : null;
  return (
    <div className={k.card}>
      <p className={k.text}>
        The {what} works in the Lab, on the INPUT node's source.
        {fx ? ` ${fx} opens there as the chain — the clip and settings loaded inside ${fx} stay in the effect.` : ''}
      </p>
      {!hasSource && (
        <span className={k.amber}>Load a clip or photo on the INPUT node first — or open the Lab from the rail to use the webcam.</span>
      )}
      <button type="button" data-testid="ai-open-lab" onClick={onOpenLab} disabled={!hasSource} className={`${k.secondary} self-start`}>
        <ChevronRight className="w-3 h-3" /> Open in Lab
      </button>
    </div>
  );
}

/** "Direction: <title>" + a small × — the Art Director's chosen proposal */
function DirectionLine({ k, direction, onClear, testid }: { k: Ink; direction: ArtDirection | null; onClear: () => void; testid: string }) {
  if (!direction) return null;
  const title = direction.title || chainLabel(direction.chain);
  return (
    <div data-testid={testid} className="flex items-center gap-1.5 min-w-0">
      <span className={`${k.sub} truncate`} title={[direction.why, direction.audioIdea].filter(Boolean).join(' · ♪ ')}>
        Direction: <b className="text-[#8b5cf6]">{title}</b>
      </span>
      <button
        type="button"
        data-testid={`${testid}-clear`}
        onClick={onClear}
        aria-label="Clear the direction"
        title="Clear the direction"
        className="shrink-0 text-neutral-500 hover:text-[#8b5cf6] cursor-pointer"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/** whether this source's upload is already cached (re-read on `tick`) */
function useCachedUpload(meta: UploadMeta | null, tick: unknown): boolean {
  const [hit, setHit] = useState(false);
  const id = meta ? `${meta.name}|${meta.size}|${meta.lastModified}` : '';
  useEffect(() => {
    let alive = true;
    if (!meta) {
      setHit(false);
      return;
    }
    cachedUpload(meta).then((r) => { if (alive) setHit(!!r); }, () => { if (alive) setHit(false); });
    return () => { alive = false; };
  }, [id, tick]); // eslint-disable-line
  return hit;
}

/* ── ART DIRECTOR ────────────────────────────────────────────── */

function ArtDirectorTab({ k, visible, surface, labRef, compSource, graphChain, onUseChain, reportError, onChooseDirection }: TabProps & { onChooseDirection: (d: ArtDirection) => void }) {
  const [intent, setIntent] = useState('');
  const [result, setResult] = useState<ArtDirectorResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const b = useBusy();
  const busyRef = useReveal(b.busy, visible);
  const resultRef = useReveal(result, visible);

  const lab = surface === 'lab' ? labRef.current : null;
  const labKind = lab ? lab.sourceKind() : 'none';
  const webcam = labKind === 'webcam';
  const meta = compSource?.kind === 'video' ? uploadMetaOf(compSource) : null;
  const cached = useCachedUpload(meta, `${b.busy}|${visible}`);
  const hasSource = webcam || !!compSource || labKind !== 'none';

  /** the one line that says what leaves the machine (D10) */
  const what = webcam
    ? '4 webcam frames'
    : compSource?.kind === 'video'
      ? meta
        ? cached ? 'the uploaded clip (video + audio, already on Google)' : `clip ${fmtMB(compSource.size)} (video + audio)`
        : `12 frames (${framesOnlyWhy(compSource)}: frames only, no audio)`
      : compSource?.kind === 'image'
        ? '1 photo (≤1024px)'
        : labKind !== 'none' ? '4 source frames' : null;
  const sends = what && `Sends: ${what}${lab ? ' + 2s of live signals' : ''}`;

  const run = async () => {
    if (!hasSource || !b.start('Preparing…')) return;
    setErr(null);
    setNote(null);
    const req: ArtDirectorRequest = { intent: intent.trim() || undefined, source: { kind: 'none' }, media: [] };
    const l = surface === 'lab' ? labRef.current : null;
    // a run that reads the Lab stops if that Lab is closed or replaced meanwhile
    const guard = () => { if (l && labRef.current !== l) throw new Error(LAB_CHANGED); };
    try {
      const kind = l ? l.sourceKind() : 'none';
      if (l && kind === 'webcam') {
        b.step('Watching the webcam…');
        await l.whenReady();
        guard();
        req.source = { kind: 'webcam', name: 'webcam' };
        req.media = await l.grabSourceFrames(4, 768);
      } else if (compSource?.kind === 'video') {
        const src: SourceRef = { kind: 'video', name: compSource.name, durationSec: await probeDuration(compSource.url) };
        const m = uploadMetaOf(compSource);
        if (m) {
          // the whole clip: Gemini sees the motion AND hears the music
          const up = await uploadOnce(compSource, m, b.step);
          src.fileUri = up.fileUri;
          src.fileMimeType = up.mimeType;
        } else {
          b.step('Sampling frames…');
          setNote(`${framesOnlyWhy(compSource).replace(/^./, (c) => c.toUpperCase())}: frames only, no audio.`);
          req.media = await sampleVideoFrames(compSource.url, 12, 768, 'SOURCE frame');
        }
        req.source = src;
      } else if (compSource?.kind === 'image') {
        req.source = { kind: 'image', name: compSource.name };
        const part = await elementToJpeg(await loadImage(compSource.url), 1024, 'SOURCE photo');
        if (part) req.media = [part];
      } else if (l && kind !== 'none') {
        await l.whenReady();
        guard();
        req.source = { kind };
        req.media = await l.grabSourceFrames(4, 768);
      }
      guard();
      if (!req.media.length && !req.source.fileUri) throw new AiError('no_media', 'No picture could be read from the source.');
      if (l) {
        // in the Lab Gemini also hears what the analysers hear right now
        b.step('Listening to the Lab…');
        req.signals = await l.signalSummary(2);
        guard();
        req.currentChain = graphChain;
      }
      b.step('Gemini is watching…');
      const res = await aiPost<ArtDirectorResult>('/api/gemini/art-director', req);
      setResult(res);
    } catch (e) {
      // Google deleted the cached upload, or refuses its type: forget it, so
      // the next Analyze uploads again instead of re-sending a dead URI
      if (req.source.fileUri && isUnusableUpload(e)) forgetUpload(req.source.fileUri);
      setErr(reportError(e));
    } finally {
      b.stop();
    }
  };

  const read = result?.read;
  return (
    <div data-ai-scroll className={tabBox(visible)}>
      <div className="flex flex-col gap-2.5">
        {/* the action row first: in the smallest opening it must be on screen */}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <div className={k.box}>
            <input
              data-testid="ai-ad-intent"
              type="text"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="Direction (optional)"
              disabled={b.busy}
              className={k.input}
            />
          </div>
          <button type="submit" data-testid="ai-ad-run" disabled={b.busy || !hasSource} className={k.primary}>
            Analyze
          </button>
        </form>
        {b.busy && <div ref={busyRef}><BusyLine label={b.label} elapsed={b.elapsed} /></div>}
        {note && <span className={k.amber}>{note}</span>}
        {err && <span className={k.error}>{err}</span>}
        {sends ? (
          <div className="flex flex-col gap-0.5">
            <span className={k.sub}>{sends}</span>
            {meta && <span className={`${k.sub} opacity-70`}>{RETENTION_TEXT}</span>}
          </div>
        ) : (
          <span className={k.amber}>
            Load a clip or photo on the INPUT node{surface === 'lab' ? ', or start the webcam' : ' — or start the webcam in the Lab'}.
          </span>
        )}

        {result && read && (
          <div ref={resultRef} data-testid="ai-ad-result" className="flex flex-col gap-2">
            <div className={k.card}>
              <span className={k.head}>Read</span>
              {([['Subject', read.subject], ['Setting', read.setting], ['Mood', read.mood], ['Motion', read.motion]] as const).map(([l, v]) =>
                v ? (
                  <p key={l} className={k.text}><span className={k.label}>{l} </span>{v}</p>
                ) : null,
              )}
              {read.palette?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {read.palette.map((c, i) => (
                    <span key={i} className={`${k.pillBase} ${k.grey}`}>{c}</span>
                  ))}
                </div>
              )}
              {read.music && (
                <div className="flex flex-col gap-1">
                  <p className={k.text}>
                    <span className={k.label}>Music </span>{read.music.energy}{read.music.tempoFeel ? ` · ${read.music.tempoFeel}` : ''}
                  </p>
                  {read.music.moments?.length > 0 && (
                    <ul className="flex flex-col gap-0.5">
                      {read.music.moments.map((m, i) => (
                        <li key={i} className={k.sub}><b className={k.amberInk}>{m.at}</b> {m.label}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {result.proposals.map((p, i) => {
              const chain = p.chain.filter((id): id is ModuleId => (MODULE_IDS as readonly string[]).includes(id));
              return (
                <div key={i} className={k.card}>
                  <span className={k.head}>{p.title}</span>
                  <div className="flex flex-wrap items-center gap-1">
                    {chain.map((id, j) => (
                      <React.Fragment key={id}>
                        {j > 0 && <ChevronRight className="w-3 h-3 text-neutral-500" />}
                        <span className={`${k.pillBase} ${k.grey}`}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: EFFECT_META[id].color }} />
                          {EFFECT_META[id].name}
                        </span>
                      </React.Fragment>
                    ))}
                  </div>
                  <p className={k.text}>{p.why}</p>
                  {p.audioIdea && <p className={k.sub}><span className={k.amberInk}>♪ </span>{p.audioIdea}</p>}
                  <button
                    type="button"
                    data-testid={`ai-ad-apply-${i}`}
                    disabled={!chain.length}
                    onClick={() => {
                      // the proposal becomes the ART DIRECTION the Agent and
                      // the Optimizer receive — not just its module ids
                      onChooseDirection({ title: p.title, chain, why: p.why, audioIdea: p.audioIdea, music: read.music ?? null });
                      onUseChain(chain);
                    }}
                    className={`${k.secondary} self-start`}
                  >
                    <ChevronRight className="w-3 h-3" /> Use this chain
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── live Lab context, polled while a Lab tab is on screen ───── */

interface LabView { ctx: ChainState | null; handle: LabHandle | null }
const NO_LAB: LabView = { ctx: null, handle: null };

/** The Lab's chain state AND which Lab it is (the handle): a run's Undo and
 *  fixes are bound to the handle they were made on. */
function useLab(labRef: React.RefObject<LabHandle | null>, on: boolean): LabView {
  const [view, setView] = useState<LabView>(NO_LAB);
  useEffect(() => {
    if (!on) return;
    const read = () => {
      const handle = labRef.current;
      let ctx: ChainState | null = null;
      try { ctx = handle ? handle.chainState() : null; } catch { ctx = null; }
      setView({ ctx, handle });
    };
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, [on, labRef]);
  return on ? view : NO_LAB;
}

function ContextLine({ k, ctx, verb }: { k: Ink; ctx: ChainState | null; verb: string }) {
  if (!ctx) return <span className={k.sub}>Waiting for the Lab…</span>;
  const music = !ctx.audioActive ? 'music off' : ctx.audioMode === 'mic' ? 'mic on' : 'music on';
  return (
    <>
      <span className={k.sub}>
        {chainLabel(ctx.order)} · {ctx.sourceKind === 'none' ? 'no source' : ctx.sourceKind} · {music}
      </span>
      {!ctx.audioActive && (
        <span className={k.amber}>
          {ctx.sourceKind === 'video'
            ? `No music on: ${verb} switches on the clip's own audio (or start Track or Mic in the Lab).`
            : 'No music on: music routes wait for it — start Track or Mic in the Lab.'}
        </span>
      )}
    </>
  );
}

/** the output clip a Lab run records: with what audio (null: none recorded) */
function clipWords(ctx: ChainState | null, alwaysRecord: boolean): string | null {
  if (!ctx) return null;
  if (ctx.audioActive) return `4s output clip ${audioWords(ctx.audioMode)}`;
  // audio off on a video: Run switches the clip's own soundtrack on first
  if (ctx.sourceKind === 'video') return "4s output clip with the clip's music, if it has any";
  return alwaysRecord ? '4s output clip (silent)' : null;
}

/* ── AGENT ───────────────────────────────────────────────────── */

interface AgentOut {
  result: AgentResult;
  chain: ChainState;
  rows: ChangeRow[];
  applied: number;
  skipped: string[];
  /** the Lab the plan landed on, and what it changed there */
  lab: LabHandle;
  undo: PlanUndo | null;
}

function AgentTab({ k, visible, surface, labRef, compSource, openEffectId, onOpenLab, reportError, onAgentRun, direction, onClearDirection }: TabProps & { onAgentRun: (r: LastAgentRun | null) => void }) {
  const [intent, setIntent] = useState('');
  const [out, setOut] = useState<AgentOut | null>(null);
  const [undone, setUndone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const b = useBusy();
  const inLab = surface === 'lab';
  const { ctx, handle } = useLab(labRef, visible && inLab);
  const busyRef = useReveal(b.busy, visible);
  const resultRef = useReveal(out, visible);
  // the source video goes whole (motion + song) when the Lab plays it
  const videoSrc = ctx?.sourceKind === 'video' && compSource?.kind === 'video' ? compSource : null;
  const meta = uploadMetaOf(videoSrc);
  const cached = useCachedUpload(meta, `${b.busy}|${visible}`);
  const hasSource = !!compSource || (labRef.current?.sourceKind() ?? 'none') !== 'none';

  const run = async () => {
    const lab = labRef.current;
    if (!inLab || !lab || !b.start('Waiting for the Lab…')) return;
    setErr(null);
    setNote(null);
    // before ANY await: the click's gesture is what lets the audio start
    const clipOn = autoClipAudio(lab);
    const guard = () => { if (labRef.current !== lab) throw new Error(LAB_CHANGED); };
    let fileUri: string | undefined;
    try {
      if (clipOn) {
        const on = await clipOn;
        guard();
        if (on) {
          setNote(CLIP_ON_NOTE);
          await wait(800); // let the analysers fill before the signal window
          guard();
        }
      }
      const ready = await lab.whenReady();
      guard(); // a Lab closed meanwhile is 'changed', not 'no picture'
      if (!ready) throw new AiError('no_media', 'The Lab has no picture yet: load a source or start the webcam.');
      if (!lab.chainState().order.length) throw new AiError('bad_request', 'The Lab chain is empty: enable at least one effect.');

      // the whole source clip, with its song: the cached upload, or a new one
      const kind = lab.sourceKind();
      const source: SourceRef = { kind, name: kind === 'webcam' ? 'webcam' : compSource?.name };
      const video = kind === 'video' && compSource?.kind === 'video' ? compSource : null;
      const m = uploadMetaOf(video);
      if (video && m) {
        source.durationSec = await probeDuration(video.url);
        guard();
        try {
          const up = await uploadOnce(video, m, b.step);
          source.fileUri = fileUri = up.fileUri;
          source.fileMimeType = up.mimeType;
        } catch (e) {
          // Google will not take this file: the Agent still gets the frames,
          // the output clip and the meters — anything else is a real failure
          if (!(e instanceof AiError) || (e.kind !== 'too_large' && e.kind !== 'bad_request')) throw e;
          setNote(`The clip could not be uploaded (${reportError(e)}): Gemini gets the frames and the output clip, not the whole song.`);
        }
        guard();
      }

      // read BEFORE anything records: a recording slows the engine (fps,
      // adaptive resolution) — and right before capture, so the bases are fresh
      const chain = lab.chainState();
      b.step('Grabbing frames…');
      const pair = await lab.grabPair(768);
      guard();
      b.step(chain.audioActive ? `Recording 4s ${audioWords(chain.audioMode)}…` : 'Listening to the Lab…');
      // the signal window overlaps the recording: same music, same seconds
      const [signals, clip] = await Promise.all([
        lab.signalSummary(3),
        chain.audioActive ? lab.recordOutputClip(4) : Promise.resolve(null),
      ]);
      guard();
      const media = [pair.source, pair.output, clip].filter((x): x is MediaPart => !!x);
      const req: AgentRequest = {
        intent: intent.trim() || undefined,
        ...(direction ? { direction } : {}),
        source,
        media,
        signals,
        chain,
      };
      b.step('Gemini is setting the chain…');
      const result = await aiPost<AgentResult>('/api/gemini/agent', req);
      guard();
      // applied at once (D1); applyPlan writes down what each key was — that,
      // and only that, is the Undo
      const r = lab.applyPlan(result.plan);
      setUndone(false);
      setOut({ result, chain, rows: describePlan(chain, result.plan), applied: r.applied, skipped: r.skipped, lab, undo: r.undo });
      if (r.undo) onAgentRun({ intent: intent.trim(), plan: result.plan, at: new Date().toISOString(), lab });
    } catch (e) {
      if (fileUri && isUnusableUpload(e)) forgetUpload(fileUri);
      setErr(reportError(e));
    } finally {
      b.stop();
    }
  };

  const sameLab = !!out && handle === out.lab;
  const undo = () => {
    if (!out?.undo || undone) return;
    if (labRef.current !== out.lab) {
      setErr(LAB_CHANGED);
      return;
    }
    const { reverted } = out.lab.revertPlan(out.undo);
    if (!reverted) {
      setErr('Nothing was undone — a Master export may be running; try again after it');
      return;
    }
    setErr(null);
    setUndone(true);
    // the Optimizer must not judge a plan that is no longer there
    onAgentRun(null);
  };

  /** the one line that says what leaves the machine (D10) */
  const sends = (() => {
    if (!ctx) return null;
    const parts: string[] = [];
    if (videoSrc && meta) parts.push(cached ? 'the uploaded clip (video + audio, already on Google)' : `clip ${fmtMB(videoSrc.size)} (video + audio)`);
    parts.push('1 frame pair (source + output)');
    const clip = clipWords(ctx, false);
    if (clip) parts.push(clip);
    parts.push('3s of live signals');
    parts.push('the chain');
    if (direction) parts.push('the art direction');
    const tail = videoSrc && !meta ? ` — ${framesOnlyWhy(videoSrc)}, so not the whole song` : '';
    return `Sends: ${parts.join(' + ')}${tail}`;
  })();

  return (
    <div data-ai-scroll className={tabBox(visible)}>
      {visible && !inLab ? (
        <NeedsLab k={k} what="Agent" openEffectId={openEffectId} hasSource={hasSource} onOpenLab={onOpenLab} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* the action row first: in the smallest opening it must be on screen */}
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(); }}>
            <div className={k.box}>
              <input
                data-testid="ai-agent-intent"
                type="text"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="What should it do? (optional)"
                disabled={b.busy}
                className={k.input}
              />
            </div>
            <button type="submit" data-testid="ai-agent-run" disabled={b.busy || !inLab} className={k.primary}>
              Run
            </button>
          </form>
          {b.busy && <div ref={busyRef}><BusyLine label={b.label} elapsed={b.elapsed} /></div>}
          {note && <span data-testid="ai-agent-note" className={k.amber}>{note}</span>}
          {err && <span className={k.error}>{err}</span>}
          <DirectionLine k={k} direction={direction} onClear={onClearDirection} testid="ai-agent-direction" />
          <ContextLine k={k} ctx={ctx} verb="Run" />
          {sends && (
            <div className="flex flex-col gap-0.5">
              <span className={k.sub}>{sends}</span>
              {videoSrc && meta && <span className={`${k.sub} opacity-70`}>{RETENTION_TEXT}</span>}
            </div>
          )}

          {out && (
            <div ref={resultRef} data-testid="ai-agent-result" className={k.card}>
              <p className={k.text}>{out.result.plan.summary}</p>
              <span className={k.label}>
                {undone ? 'Undone' : `Applied ${out.applied} change${out.applied === 1 ? '' : 's'}`}
              </span>
              {out.rows.length > 0 && (
                <ul className="flex flex-col gap-0.5">
                  {out.rows.map((r) => (
                    <li key={r.key} title={r.key.replace(/^~/, '')} className={`${k.sub} ${undone ? 'line-through opacity-60' : ''}`}>
                      {r.label}: {r.from} <span className="text-[#8b5cf6]">→</span> <b>{r.to}</b>
                    </li>
                  ))}
                </ul>
              )}
              <NotApplied k={k} items={[...out.result.dropped, ...out.skipped]} chain={out.chain} />
              <button
                type="button"
                data-testid="ai-agent-undo"
                onClick={undo}
                disabled={b.busy || undone || !out.undo || !inLab || !sameLab}
                className={`${k.secondary} self-start`}
              >
                <Undo2 className="w-3 h-3" /> Undo
              </button>
              {inLab && !sameLab && !undone && out.undo && (
                <span className={k.sub}>Made on a Lab that has since closed: Undo is off.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── OPTIMIZER ───────────────────────────────────────────────── */

interface OptimizerOut {
  result: OptimizerResult;
  checks: CheckResult[];
  chain: ChainState;
  /** the Lab that was judged: its fixes apply there and nowhere else */
  lab: LabHandle;
}

function OptimizerTab({ k, visible, surface, labRef, compSource, openEffectId, onOpenLab, reportError, lastAgentRun, direction, onClearDirection }: TabProps & { lastAgentRun: LastAgentRun | null }) {
  const [out, setOut] = useState<OptimizerOut | null>(null);
  const [applied, setApplied] = useState<Record<number, true>>({});
  const [fixNotes, setFixNotes] = useState<string[]>([]);
  // what each applied fix changed, in the order applied: Undo reverts them
  // newest first, so a key two fixes touched lands back on its first value
  const [undos, setUndos] = useState<PlanUndo[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const b = useBusy();
  const inLab = surface === 'lab';
  const { ctx, handle } = useLab(labRef, visible && inLab);
  const busyRef = useReveal(b.busy, visible);
  const resultRef = useReveal(out, visible);
  const hasSource = !!compSource || (labRef.current?.sourceKind() ?? 'none') !== 'none';
  // an Agent run counts only on the Lab it was applied to
  const agentRun = lastAgentRun && handle && lastAgentRun.lab === handle ? lastAgentRun : null;

  const run = async () => {
    const lab = labRef.current;
    if (!inLab || !lab || !b.start('Waiting for the Lab…')) return;
    setErr(null);
    setNote(null);
    // before ANY await: the click's gesture is what lets the audio start
    const clipOn = autoClipAudio(lab);
    const guard = () => { if (labRef.current !== lab) throw new Error(LAB_CHANGED); };
    const last = lastAgentRun && lastAgentRun.lab === lab ? lastAgentRun : null;
    try {
      if (clipOn) {
        const on = await clipOn;
        guard();
        if (on) {
          setNote(CLIP_ON_NOTE);
          await wait(800); // let the analysers fill before the signal window
          guard();
        }
      }
      const ready = await lab.whenReady();
      guard(); // a Lab closed meanwhile is 'changed', not 'no picture'
      if (!ready) throw new AiError('no_media', 'The Lab has no picture yet: load a source or start the webcam.');
      // read BEFORE recording: the recording itself slows the engine, and the
      // performance check would blame the look for the panel's own load
      const chain = lab.chainState();
      if (!chain.order.length) throw new AiError('bad_request', 'The Lab chain is empty: enable at least one effect.');
      b.step(chain.audioActive ? `Recording 4s of output ${audioWords(chain.audioMode)}…` : 'Recording 4s of output…');
      // the signal window overlaps the recording: same music, same seconds
      const [clip, signals] = await Promise.all([lab.recordOutputClip(4), lab.signalSummary(2)]);
      guard();
      b.step('Grabbing frames…');
      const pair = await lab.grabPair(768);
      guard();
      const luma = await meanLuma(pair.output);
      guard();
      const checks = computeChecks(chain, signals, luma);
      const media = [clip, pair.source, pair.output].filter((x): x is MediaPart => !!x);
      const req: OptimizerRequest = {
        ...(direction ? { direction } : {}),
        lastAgent: last ? { intent: last.intent, plan: last.plan, at: last.at } : null,
        media,
        signals,
        chain,
        checks,
      };
      b.step('Gemini is judging the output…');
      const result = await aiPost<OptimizerResult>('/api/gemini/optimizer', req);
      guard();
      setOut({ result, checks, chain, lab });
      setApplied({});
      setFixNotes([]);
      setUndos([]);
    } catch (e) {
      setErr(reportError(e));
    } finally {
      b.stop();
    }
  };

  const sameLab = !!out && handle === out.lab;

  /** applies the given issues' fixes on the judged Lab, keeping each one's undo */
  const applyFixes = (idx: number[]) => {
    if (!out) return;
    if (labRef.current !== out.lab) {
      setErr(LAB_CHANGED);
      return;
    }
    const todo = idx.filter((i) => out.result.issues[i]?.fix && !applied[i]);
    if (!todo.length) return;
    const notes: string[] = [];
    const added: PlanUndo[] = [];
    const done: Record<number, true> = { ...applied };
    for (const i of todo) {
      const r = out.lab.applyPlan(out.result.issues[i].fix as AgentPlan);
      notes.push(...r.skipped.map((s) => `fix ${i + 1} · ${s}`));
      if (r.undo) added.push(r.undo);
      if (r.applied > 0) done[i] = true;
    }
    setErr(null);
    setApplied(done);
    setUndos((prev) => [...prev, ...added]);
    setFixNotes((prev) => [...prev, ...notes]);
  };

  const undo = () => {
    if (!out || !undos.length) return;
    if (labRef.current !== out.lab) {
      setErr(LAB_CHANGED);
      return;
    }
    let reverted = 0;
    for (let i = undos.length - 1; i >= 0; i--) reverted += out.lab.revertPlan(undos[i]).reverted;
    if (!reverted) {
      setErr('Nothing was undone — a Master export may be running; try again after it');
      return;
    }
    setErr(null);
    setUndos([]);
    setApplied({});
    setFixNotes([]);
  };

  /** the one line that says what leaves the machine (D10) */
  const sends = ctx
    ? `Sends: ${[
        clipWords(ctx, true),
        '1 frame pair',
        '2s of live signals',
        'the checks',
        ...(agentRun ? ["the Agent's last plan"] : []),
        ...(direction ? ['the art direction'] : []),
      ].join(' + ')}`
    : null;

  const fixable = out ? out.result.issues.map((x, i) => (x.fix ? i : -1)).filter((i) => i >= 0) : [];
  const verdictPill = out
    ? out.result.verdict === 'ok' ? k.green : out.result.verdict === 'improve' ? k.amberPill : k.redPill
    : '';
  const failed = out ? out.checks.filter((c) => !c.ok) : [];
  const severityText = (s: string) => (s === 'error' ? 'text-red-400' : s === 'warning' ? k.amberInk : 'text-[#8b5cf6]');

  return (
    <div data-ai-scroll className={tabBox(visible)}>
      {visible && !inLab ? (
        <NeedsLab k={k} what="Optimizer" openEffectId={openEffectId} hasSource={hasSource} onOpenLab={onOpenLab} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {/* the action row first: in the smallest opening it must be on screen */}
          <button type="button" data-testid="ai-opt-run" onClick={() => void run()} disabled={b.busy || !inLab} className={`${k.primary} self-start`}>
            <Cpu className="w-3.5 h-3.5" /> Check output
          </button>
          {b.busy && <div ref={busyRef}><BusyLine label={b.label} elapsed={b.elapsed} /></div>}
          {note && <span data-testid="ai-opt-note" className={k.amber}>{note}</span>}
          {err && <span className={k.error}>{err}</span>}
          <DirectionLine k={k} direction={direction} onClear={onClearDirection} testid="ai-opt-direction" />
          <ContextLine k={k} ctx={ctx} verb="Check output" />
          <span className={k.sub}>
            {agentRun
              ? `Checks the Agent's run of ${new Date(agentRun.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${agentRun.intent ? ` (“${agentRun.intent}”)` : ''}`
              : 'No Agent run yet: judges the Lab as it is'}
          </span>
          {sends && <span className={k.sub}>{sends}</span>}

          {out && (
            <div ref={resultRef} data-testid="ai-opt-result" className="flex flex-col gap-2">
              <div className={k.card}>
                <div className="flex items-center gap-2">
                  <span className={`${k.pillBase} ${verdictPill}`}>{out.result.verdict}</span>
                  <span className={k.label}>{out.checks.length - failed.length}/{out.checks.length} checks ok</span>
                </div>
                <p className={k.text}>{out.result.summary}</p>
                {failed.map((c) => (
                  <span key={c.id} className={k.amber}>{c.detail}</span>
                ))}
                {(fixable.length > 0 || undos.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {fixable.length > 0 && (
                      <button
                        type="button"
                        data-testid="ai-opt-fix-all"
                        onClick={() => applyFixes(fixable)}
                        disabled={b.busy || !inLab || !sameLab || fixable.every((i) => applied[i])}
                        className={k.secondary}
                      >
                        Apply all
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="ai-opt-undo"
                      onClick={undo}
                      disabled={b.busy || !undos.length || !inLab || !sameLab}
                      className={k.secondary}
                    >
                      <Undo2 className="w-3 h-3" /> Undo
                    </button>
                  </div>
                )}
                {inLab && !sameLab && (
                  <span className={k.sub}>Judged on a Lab that has since closed: fixes and Undo are off.</span>
                )}
              </div>

              {out.result.issues.map((x, i) => (
                <div key={i} className={k.card}>
                  <span className={`font-mono text-[9px] font-bold uppercase tracking-widest ${severityText(x.severity)}`}>{x.severity}</span>
                  <p className={k.text}>{x.finding}</p>
                  {x.evidence && <p className={k.sub}>{x.evidence}</p>}
                  {x.fix && (
                    <>
                      <p className={k.sub}><span className="text-[#8b5cf6]">fix: </span>{x.fix.summary}</p>
                      <button
                        type="button"
                        data-testid={`ai-opt-fix-${i}`}
                        onClick={() => applyFixes([i])}
                        disabled={b.busy || !inLab || !sameLab || !!applied[i]}
                        className={`${k.secondary} self-start`}
                      >
                        {applied[i] ? 'Applied' : 'Apply fix'}
                      </button>
                    </>
                  )}
                </div>
              ))}

              <NotApplied k={k} items={[...out.result.dropped, ...fixNotes]} chain={out.chain} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
