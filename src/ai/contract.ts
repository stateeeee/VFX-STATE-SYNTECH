/*
 * GEMINI 3.8 — the contract between the browser panel and the server.
 *
 * One file, imported by both sides (src/ for the panel, ai-*.ts at the repo
 * root for the server), so the wire format cannot drift. Types and plain
 * constants only: nothing here touches the DOM or Node.
 *
 * The three roles, as the operator defined them:
 *   ART DIRECTOR — the creative mind. Watches the source (video with its
 *                  music, photo, or webcam) and proposes which effects fit.
 *   AGENT        — the operator. Source and effect are already chosen; it sets
 *                  the parameters and the audio routing so video, music and
 *                  effect play together, and applies them.
 *   OPTIMIZER    — the Agent's controller. Looks at the RESULT (a short output
 *                  clip with its music, plus frames) and reports errors and
 *                  improvements, each with a fix that can be applied.
 *
 * Gemini always receives real pixels and/or audio — never just a filename.
 */

import type { ModuleId } from '../types';

/* ── model, key, storage ─────────────────────────────────────── */

/** Default model id; the server lets GEMINI_MODEL override it. */
export const GEMINI_MODEL_DEFAULT = 'gemini-3.8-flash';
/** Header carrying the browser-held key from the panel to OUR server only. */
export const GEMINI_KEY_HEADER = 'x-gemini-key';
/** localStorage key holding the pasted key (CLAUDE.md rule 7: no backend state). */
export const GEMINI_KEY_STORAGE = 'syntech.geminiKey';
/** localStorage key caching uploaded source files (see UploadCacheEntry). */
export const GEMINI_FILES_STORAGE = 'syntech.geminiFiles';

/** Source videos up to this size are uploaded whole (Gemini sees motion AND
 *  hears the music). Above it, the Art Director falls back to sampled frames. */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

export const MODULE_IDS: readonly ModuleId[] = ['blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab'];

/** Mirrors ParamBus MOD_SOURCES (src/engine/params.ts:14) — keep in sync. */
export type ModSourceT = 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright';
export const MOD_SOURCE_IDS: readonly ModSourceT[] = ['bass', 'treble', 'loud', 'beat', 'motion', 'bright'];

/* ── parameter safety lists (enforced by the server validator AND the Lab) ── */

/** Integer-coded categorical params: snapped to integers, never routed. */
export const ENUM_KEYS: readonly string[] = [
  'analog.sortDir',
  'blob_tracker.blobShape', 'blob_tracker.connStyle', 'blob_tracker.textMode', 'blob_tracker.ctMode',
  'blob_tracker.trackerColorIdx', 'blob_tracker.connColorIdx', 'blob_tracker.vfxColorIdx',
  'bokeh.bokehStyle', 'bokeh.distortMode', 'bokeh.bgfxStyle', 'bokeh.psAngle',
];

/** Base-0 params whose built-in route IS the effect's audio response. The AI
 *  may tune the route's amount (0.05..1) but never its base, its source, or
 *  switch the route off — that would kill the effect's reaction to music. */
export const CARRIER_KEYS: readonly string[] = [
  'analog.reactBass', 'analog.reactMid', 'analog.reactHigh',
  'blob_reveal.beatReact',
  'blob_tracker.connGlow', 'blob_tracker.rippleForce',
];

/** Params the AI must never touch: A/B split, a no-op LUT, a perf knob,
 *  bokeh's person mask (off = the whole node becomes a pass-through), and
 *  analog's reactivity gate (off zeroes all three carriers, analog.ts:372-376). */
export const PROTECTED_KEYS: readonly string[] = [
  'anamorphic_lab.compare', 'anamorphic_lab.lutMix', 'blob_reveal.segN', 'bokeh.segEnabled',
  'analog.reactEnabled',
];

/** Lowest base the AI may set on a param that scales an effect's whole music
 *  response — at 0 the carriers still run but move nothing. */
export const PARAM_FLOORS: Readonly<Record<string, number>> = {
  'analog.modDepth': 0.1,
};

/** Route depth is amount × the param's FULL range (params.ts:58-59), so the
 *  AI is capped here on ordinary params. 0.6 is the deepest factory route
 *  (blob_tracker.panelTurb), so the AI can always restore a default. */
export const MAX_ROUTE_AMOUNT = 0.6;
/** The band a carrier's amount may be retuned within (same source only). */
export const CARRIER_AMOUNT_MIN = 0.05;
export const CARRIER_AMOUNT_MAX = 1;

/** Sampling rate asked of Gemini for short INLINE clips (the Optimizer's and
 *  the Agent's output clips). Its default is 1 fps — four stills for a 4s
 *  clip, useless for judging whether hits land on the beat. Max allowed is 24. */
export const INLINE_VIDEO_FPS = 12;

/* ── errors ─────────────────────────────────────────────────── */

export type AiErrorKind =
  | 'no_key'            // no key in the browser and none on the server
  | 'invalid_key'       // Google: 400 API_KEY_INVALID / 403 PERMISSION_DENIED
  | 'model_unavailable' // Google: 404 for the configured model id
  | 'quota'             // Google: 429 RESOURCE_EXHAUSTED (per-day, per-minute or token limit)
  | 'too_large'         // payload / upload over our or Google's limit
  | 'no_media'          // a role was called without pixels or audio
  | 'bad_request'       // other 400 from Google (media type, schema…)
  | 'upstream'          // Google 5xx / timeout
  | 'network'           // browser could not reach our server
  | 'server_error';     // anything else on our side

/** Every /api/gemini/* failure has this shape (HTTP status may be 4xx/5xx). */
export interface AiErrorResponse { error: AiErrorKind; message: string }

/* ── media ──────────────────────────────────────────────────── */

/** One inline media item. `data` is RAW base64 (no `data:` prefix). */
export interface MediaPart {
  mimeType: string;          // image/jpeg, video/webm, audio/wav …
  data: string;
  /** What this is, told to Gemini right before the item, e.g.
   *  "SOURCE frame at 12.0s", "OUTPUT frame at 12.0s", "OUTPUT clip 4s with music". */
  label: string;
}

export type SourceKindT = 'none' | 'video' | 'image' | 'webcam';

/** What the panel knows about the active source. */
export interface SourceRef {
  kind: SourceKindT;
  name?: string;
  /** Set when the whole video was uploaded through /api/gemini/upload. */
  fileUri?: string;
  fileMimeType?: string;
  durationSec?: number;
}

/** POST /api/gemini/upload — raw body (the file bytes), headers:
 *  Content-Type (the file's mime), x-file-name (URI-encoded), x-gemini-key. */
export interface UploadResponse {
  fileUri: string;
  mimeType: string;
  name: string;              // Google file resource name, files/xxxx
  expiresAt: string | null;  // ISO time; Google keeps uploads ~48h
}

/** One entry of the GEMINI_FILES_STORAGE cache, keyed by `${keyFp}|${name}|${size}|${lastModified}`. */
export interface UploadCacheEntry extends UploadResponse { cachedAt: string }

/* ── live signals, summarised over a short window ───────────── */

export interface Stat { mean: number; peak: number }

export interface SignalSummary {
  windowSec: number;
  audio: {
    active: boolean;
    mode: 'off' | 'mic' | 'file' | 'clip';
    bpm: number | null;
    bass: Stat; treble: Stat; loud: Stat;
    beats: number;              // onsets counted in the window
    track: { name: string; currentTime: number; duration: number } | null;
  };
  video: { motion: Stat; bright: Stat };
}

/* ── the Lab chain as the AI sees it ────────────────────────── */

export interface RouteT { source: ModSourceT; amount: number }

export interface ParamDesc {
  key: string;               // 'nodeId.param'
  label: string;
  type: 'number' | 'boolean' | 'enum';
  min: number; max: number; step: number;
  value: number;             // current BASE (booleans 0/1)
  hint: string;
  reactive: boolean;         // may carry a route
  route: RouteT | null;      // current route
  carrier: boolean;          // in CARRIER_KEYS
  locked: boolean;           // in PROTECTED_KEYS
}

export type AudioModeT = 'off' | 'mic' | 'file' | 'clip';

export interface ChainState {
  order: ModuleId[];         // enabled effects, render order
  params: ParamDesc[];       // ENABLED nodes only
  fps: number;
  resScale: number;
  sourceKind: SourceKindT;
  audioActive: boolean;
  audioMode: AudioModeT;
  maskState: string | null;  // PersonMask state, if any node uses it
}

/** The Art Director proposal the director chose with "Use this chain" — the
 *  creative brief the Agent executes and the Optimizer checks against. */
export interface ArtDirection {
  title: string;
  chain: ModuleId[];
  why: string;
  audioIdea: string;
  music: ArtDirectorResult['read']['music'];
}

/* ── role: ART DIRECTOR ─────────────────────────────────────── */

export interface ArtDirectorRequest {
  intent?: string;           // optional direction from the operator
  source: SourceRef;
  media: MediaPart[];        // photo / webcam frames / sampled video frames (when no fileUri)
  signals?: SignalSummary;   // when the Lab is live
  currentChain?: ModuleId[];
}

export interface ArtDirectorResult {
  read: {
    subject: string;         // who/what is on screen
    setting: string;
    mood: string;
    palette: string[];       // 3-5 colour words
    motion: string;          // camera + subject movement
    music: { energy: string; tempoFeel: string; moments: { at: string; label: string }[] } | null;
  };
  proposals: {
    title: string;
    chain: ModuleId[];       // 1-3 effects, render order
    why: string;
    audioIdea: string;       // how it should move with the music
  }[];
}

/* ── role: AGENT ────────────────────────────────────────────── */

export interface AgentPlan {
  summary: string;
  params: { key: string; value: number }[];
  routes: { key: string; source: ModSourceT | 'off'; amount: number }[];
}

export interface AgentRequest {
  intent?: string;
  direction?: ArtDirection | null;
  /** fileUri set when the source video is uploaded (Gemini hears the song and
   *  sees the motion of the whole clip). */
  source: SourceRef;
  /** SOURCE/OUTPUT frame pair + an OUTPUT clip with the music when audio is on. */
  media: MediaPart[];
  signals: SignalSummary;
  chain: ChainState;
}

export interface AgentResult {
  plan: AgentPlan;           // already validated + clamped by the server
  dropped: string[];         // what the validator refused, and why
  /** What it kept but changed (a base raised to its floor, a route depth
   *  capped), one line each — shown on the applied rows, not as refusals. */
  adjusted?: string[];
}

/* ── role: OPTIMIZER ────────────────────────────────────────── */

/** Deterministic checks the Lab computes before asking Gemini. */
export interface CheckResult { id: string; ok: boolean; detail: string }

export interface OptimizerRequest {
  intent?: string;
  direction?: ArtDirection | null;
  /** null when there is no Agent run, or it was undone. */
  lastAgent: { intent: string; plan: AgentPlan; at: string } | null;
  media: MediaPart[];        // OUTPUT clip (webm, with music when audio is on) + frame pairs
  signals: SignalSummary;
  chain: ChainState;
  checks: CheckResult[];
}

export interface OptimizerIssue {
  severity: 'error' | 'warning' | 'tip';
  finding: string;
  evidence: string;
  fix: AgentPlan | null;     // validated like the Agent's plan
}

export interface OptimizerResult {
  verdict: 'ok' | 'improve' | 'broken';
  summary: string;
  issues: OptimizerIssue[];
  dropped: string[];
  adjusted?: string[];       // 'fix N · …', same meaning as AgentResult.adjusted
}

/* ── key status ─────────────────────────────────────────────── */

/** GET /api/gemini/status — no key needed. */
export interface StatusResponse { serverKey: boolean; model: string }

/** POST /api/gemini/key — validates the header key (or the server key when the
 *  header is absent) with one models.get call; no tokens spent. */
export type KeyResponse =
  | { active: true; model: string; source: 'browser' | 'server' }
  | { active: false; error: AiErrorKind; message: string };

/* ── the Lab's handle, used by the Gemini panel ─────────────── */

export interface LabHandle {
  /** Resolves true once the engine is built and the source has a frame. */
  whenReady(timeoutMs?: number): Promise<boolean>;
  sourceKind(): SourceKindT;
  /** Frame-aligned SOURCE + OUTPUT JPEGs (long side ≤ maxSide). */
  grabPair(maxSide?: number): Promise<{ source: MediaPart | null; output: MediaPart | null }>;
  /** n SOURCE frames: webcam over ~2s, video around the playhead, image once. */
  grabSourceFrames(n: number, maxSide?: number): Promise<MediaPart[]>;
  /** A short OUTPUT clip (video/webm) with the active music, or null. */
  recordOutputClip(sec: number): Promise<MediaPart | null>;
  /** Samples the live signals at ~10Hz for `sec` seconds. */
  signalSummary(sec: number): Promise<SignalSummary>;
  chainState(): ChainState;
  /** Applies a validated plan through the ParamBus; returns what it did and
   *  the previous value of every key it touched. Refused (applied 0) while a
   *  Master export runs. */
  applyPlan(plan: AgentPlan): { applied: number; skipped: string[]; undo: PlanUndo | null };
  /** Puts back exactly the keys a plan touched — never the operator's other
   *  edits, never chain order or enabled. Refused while a Master export runs. */
  revertPlan(undo: PlanUndo): { reverted: number };
  /** Switches on the Clip audio (the source video's own soundtrack) when the
   *  source is a video and no audio is on. Resolves true when audio is now on. */
  startClipAudio(): Promise<boolean>;
}

/** The previous state of each key a plan touched (see LabHandle.applyPlan). */
export interface PlanUndo {
  entries: {
    key: string;                       // 'nodeId.param'
    base?: number;                     // previous ParamBus base (numbers, enums)
    bool?: number;                     // previous switch value (booleans)
    route?: RouteT | null;             // previous route, when the plan set one
  }[];
}
