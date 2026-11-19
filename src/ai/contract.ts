/*
 * GEMINI — the contract between the browser panel and the server.
 *
 * One file, imported by both sides (src/ for the panel, ai-*.ts at the repo
 * root for the server), so the wire format cannot drift. Types and plain
 * constants only: nothing here touches the DOM or Node.
 *
 * The three roles, as the operator defined them:
 *   ART DIRECTOR — the creative mind. Watches the source (video with its
 *                  music, photo, or webcam) and proposes which effects fit.
 *   AGENT        — the operator. Source and effect are already chosen; it sets
 *                  the effects' own panel controls (including their audio-
 *                  reaction controls) so video, music and effect play
 *                  together, and applies them.
 *   OPTIMIZER    — the Agent's controller. Looks at the RESULT (a short output
 *                  clip with its music, plus frames) and reports errors and
 *                  improvements, each with a fix that can be applied.
 *
 * Gemini always receives real pixels and/or audio — never just a filename.
 */

import type { ModuleId } from '../types';

/* ── model, key, storage ─────────────────────────────────────── */

/** Default model id (operator, 2026-11-18: "the best one, today Gemini 4
 *  Hydrogen"). The panel's model picker overrides it per request
 *  (GEMINI_MODEL_HEADER); with no pick, GEMINI_MODEL in .env.local does. */
export const GEMINI_MODEL_DEFAULT = 'gemini-4-hydrogen';
/** Header carrying the browser-held key from the panel to OUR server only. */
export const GEMINI_KEY_HEADER = 'x-gemini-key';
/** Header carrying the model the panel picked (MODEL_ID_PATTERN). */
export const GEMINI_MODEL_HEADER = 'x-gemini-model';
/** Header carrying the effort (thinking level) the panel picked (EffortT). */
export const GEMINI_EFFORT_HEADER = 'x-gemini-effort';
/** localStorage key holding the picked { model, effort } (GeminiChoice). */
export const GEMINI_CHOICE_STORAGE = 'syntech.geminiChoice';

/** A Gemini model id the server will forward: `gemini-…`, lowercase, no
 *  `models/` prefix. Source for a RegExp, anchored. */
export const MODEL_ID_PATTERN = '^gemini-[a-z0-9][a-z0-9.-]{0,63}$';

/** How hard the model thinks before it answers: Gemini's thinking level.
 *  'default' sends no thinking config (the model's own default). Every other
 *  value is sent as thinkingConfig.thinkingLevel = the value upper-cased —
 *  never silently replaced: a level the model refuses is an error the panel
 *  shows, so "Hydrogen · High" is always really Hydrogen thinking at HIGH. */
export type EffortT = 'default' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export const EFFORTS: readonly EffortT[] = ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'];
export const EFFORT_LABEL: Readonly<Record<EffortT, string>> = {
  default: 'Auto', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high',
};

/** What the panel stores and sends. */
export interface GeminiChoice { model: string; effort: EffortT }

/** Whether a model can be used at $0 with a free AI Studio key.
 *  'yes' / 'no' come from Google's published tiers (as of 2026-11-18);
 *  'unknown' is a model this build has never heard of (a newer release):
 *  it is still listed and usable — Google's answer decides. */
export type FreeTierT = 'yes' | 'no' | 'unknown';

/** What this build knows about a model, ahead of Google's list. */
export interface KnownModel {
  id: string;
  name: string;
  efforts: readonly EffortT[];   // what the picker offers, best first is NOT implied
  defaultEffort: EffortT;
  free: FreeTierT;
  /** one short line for the picker, Italian (the operator's language) */
  note: string;
}

/** The models this build knows, in the picker's order (best free first).
 *  Any other gemini-… model Google lists for the key is shown after these,
 *  with free 'unknown' and efforts ['default','low','medium','high']. */
export const KNOWN_MODELS: readonly KnownModel[] = [
  { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'high', free: 'yes',
    note: 'Il migliore gratis: vede video, foto e webcam e sente la musica.' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', efforts: ['minimal', 'low', 'medium', 'high'], defaultEffort: 'high', free: 'yes',
    note: 'Il modello di prima. Gratis, ottimo di riserva.' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', free: 'no',
    note: 'Solo a pagamento.' },
  { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', efforts: ['low', 'medium', 'high'], defaultEffort: 'high', free: 'no',
    note: 'Solo a pagamento.' },
];

/** Efforts offered for a model this build does not know. */
export const UNKNOWN_MODEL_EFFORTS: readonly EffortT[] = ['default', 'low', 'medium', 'high'];

/** One row of the model picker (GET /api/gemini/models). */
export interface ModelInfo {
  id: string;                  // MODEL_ID_PATTERN
  name: string;                // Google's displayName, else KnownModel.name, else the id
  description: string;         // Google's description ('' when unknown)
  inputTokenLimit: number | null;
  efforts: EffortT[];
  defaultEffort: EffortT;
  free: FreeTierT;
  note: string;                // KnownModel.note, '' for an unknown model
  known: boolean;              // in KNOWN_MODELS
  /** Google listed it for this key (false: from KNOWN_MODELS only, the list
   *  call failed or did not include it) */
  listed: boolean;
}

/** GET /api/gemini/models — needs a key (header or server). `source` is
 *  'google' when models.list answered, 'catalog' when it failed and the rows
 *  are KNOWN_MODELS alone (then `warning` says why). */
export interface ModelsResponse {
  models: ModelInfo[];
  recommended: string;         // the model a fresh panel picks
  source: 'google' | 'catalog';
  warning?: string;
}

/** Proof of what really answered, attached by the server to every role
 *  result: `model` is Google's own modelVersion from the response (falls back
 *  to the requested id only when Google omits it). */
export interface RunMeta {
  requested: string;           // the model id the server asked for
  model: string;               // what Google says answered (response.modelVersion)
  effort: EffortT;             // what was sent ('default' = no thinking config)
  thoughtsTokens: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  ms: number;                  // wall time of the Gemini call(s)
}
/** localStorage key holding the pasted key (CLAUDE.md rule 7: no backend state). */
export const GEMINI_KEY_STORAGE = 'syntech.geminiKey';
/** localStorage key caching uploaded source files (see UploadCacheEntry). */
export const GEMINI_FILES_STORAGE = 'syntech.geminiFiles';

/** Source videos up to this size are uploaded whole (Gemini sees motion AND
 *  hears the music). Above it, the Art Director falls back to sampled frames. */
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

/** Every effect can sit in a Lab chain (2026-10-28, operator decision "option 1": each Lab node IS the
 *  standalone effect in an iframe, fed by the previous node's output stream). */
export const MODULE_IDS: readonly ModuleId[] = [
  'blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab',
  'invisible', 'time_machine', 'quadtree', 'pointcloud', 'painting',
];

/* ── LAB v2: the iframe chain (2026-10-28) ───────────────────
   Every Lab node IS the standalone effect in an iframe (window.SynLab). A
   parameter key is `<ModuleId>.<SynLabParam.key>`, where the effect-side key
   is a control's DOM id, `knob:<data-id>` or an adapter key — charset
   [A-Za-z0-9_:-]. Values: numbers in [min,max] on the step grid, booleans
   0/1, enums the option index 0..n-1. There is no ParamBus any more: no
   signal routes. Each effect reacts to the Lab's music through its OWN
   analyser and its own reactive controls, which are ordinary parameters. */

/** One parameter key, `<ModuleId>.<effect key>` — source for a RegExp (no
 *  anchors), so the server and the panel parse keys the same way. */
export const PARAM_KEY_PATTERN = '[a-z_]+\\.[A-Za-z0-9_:-]{1,80}';

/** Panel sections (SynLabParam.group, sent as ParamDesc.hint) the AI never
 *  touches, compared case-insensitively. The Lab does not list Source /
 *  Export / Info controls at all; these are defence in depth, plus the
 *  sections whose controls write OTHER controls (a preset, a performance
 *  pad's XY and preset pads): a per-key Undo could not put those back. */
export const LOCKED_GROUPS: readonly string[] = [
  'source', 'preset', 'performance pad', 'export', 'export / rec', 'record', 'shortcuts', 'info',
];

/** A control whose key or label matches this is never the AI's: an A/B
 *  compare split (anamorphic_lab's "Compare A|B"), fullscreen. Source for a
 *  RegExp, flag 'i'. Not "mirror": blob_tracker's MIRROR PANELS / MIRROR BG
 *  and analog's feedback Mirror are looks — a webcam mirror is locked by the
 *  Lab's adapter (`locked: true`). */
export const LOCKED_CONTROL_PATTERN = '\\bcompare\\b|\\ba\\s*[|/]\\s*b\\b|fullscreen';

/** Lowest value the AI may set on a control that scales an effect's whole
 *  music response — at 0 the effect still "reacts" but moves nothing. Keys
 *  are the iframe Lab's (`<ModuleId>.<DOM id>`; Reactive › Mod Depth). */
export const PARAM_FLOORS: Readonly<Record<string, number>> = {
  'analog.sl-modDepth': 0.1,
  'quadtree.sl-modDepth': 0.1,
  'time_machine.sl-modDepth': 0.1,
};

/* ── LEGACY (SynEngine Lab, before 2026-10-28) ──────────────────
   Kept exported, unchanged, only so code written for the old Lab still
   compiles. The server no longer reads them and the iframe Lab must not
   use them: their keys are SynEngine param names that no longer exist. */

/** @deprecated SynEngine ParamBus MOD_SOURCES. The iframe Lab has no routes. */
export type ModSourceT = 'bass' | 'treble' | 'loud' | 'beat' | 'motion' | 'bright';
/** @deprecated see ModSourceT. */
export const MOD_SOURCE_IDS: readonly ModSourceT[] = ['bass', 'treble', 'loud', 'beat', 'motion', 'bright'];
/** @deprecated SynEngine enum params. Enums are now `ParamDesc.type === 'enum'`. */
export const ENUM_KEYS: readonly string[] = [
  'analog.sortDir',
  'blob_tracker.blobShape', 'blob_tracker.connStyle', 'blob_tracker.textMode', 'blob_tracker.ctMode',
  'blob_tracker.trackerColorIdx', 'blob_tracker.connColorIdx', 'blob_tracker.vfxColorIdx',
  'bokeh.bokehStyle', 'bokeh.distortMode', 'bokeh.bgfxStyle', 'bokeh.psAngle',
];
/** @deprecated SynEngine carrier routes. There are no routes any more. */
export const CARRIER_KEYS: readonly string[] = [
  'analog.reactBass', 'analog.reactMid', 'analog.reactHigh',
  'blob_reveal.beatReact',
  'blob_tracker.connGlow', 'blob_tracker.rippleForce',
];
/** @deprecated SynEngine protected params. The iframe Lab marks a control
 *  `locked` itself; the server adds LOCKED_GROUPS / LOCKED_CONTROL_PATTERN. */
export const PROTECTED_KEYS: readonly string[] = [
  'anamorphic_lab.compare', 'anamorphic_lab.lutMix', 'blob_reveal.segN', 'bokeh.segEnabled',
  'analog.reactEnabled',
];
/** @deprecated SynEngine route depth cap. */
export const MAX_ROUTE_AMOUNT = 0.6;
/** @deprecated SynEngine carrier amount band. */
export const CARRIER_AMOUNT_MIN = 0.05;
/** @deprecated SynEngine carrier amount band. */
export const CARRIER_AMOUNT_MAX = 1;

/** How much of the director's typed request reaches Gemini (the panel's
 *  field caps at it too). It was 600: a structured brief was cut in half. */
export const INTENT_MAX = 4000;

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

/** @deprecated SynEngine route. The iframe Lab sends `route: null` always. */
export interface RouteT { source: ModSourceT; amount: number }

/** One control of an effect in the Lab chain, as the AI sees it (built by
 *  the Lab from SynLab.params()). */
export interface ParamDesc {
  key: string;               // '<ModuleId>.<SynLabParam.key>' (PARAM_KEY_PATTERN)
  label: string;             // the visible label in the effect's panel
  type: 'number' | 'boolean' | 'enum';
  min: number; max: number; step: number;   // booleans 0/1/1; enums 0..n-1/1
  value: number;             // current value (booleans 0/1; enums = option index)
  hint: string;              // the panel section it lives in (SynLabParam.group)
  reactive: boolean;         // legacy: always false in the iframe Lab
  route: RouteT | null;      // legacy: always null in the iframe Lab
  carrier: boolean;          // legacy: always false in the iframe Lab
  locked: boolean;           // never touched by the AI (declared by the Lab's adapter)
  /** enum option labels in index order (value i means options[i]) */
  options?: string[];
}

export type AudioModeT = 'off' | 'mic' | 'file' | 'clip';

export interface ChainState {
  order: ModuleId[];         // enabled effects, render order
  params: ParamDesc[];       // ENABLED nodes only
  fps: number;
  /** the Lab's frame budget (LAB_FPS): a healthy chain reads about this, never more */
  fpsCap?: number;
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
  /** set by the server: which model / effort really answered */
  meta?: RunMeta;
}

/* ── CUES: the Agent's beat-synced timeline (2026-11-18) ──────
   The operator: load a clip with no effects, write "in base al beat e al
   video metti gli effetti" — the AI decides WHICH effects and WHEN. The Lab
   analyses the source video's own soundtrack in the browser (BPM, beat
   phase, energy sections: src/lab/beatgrid.ts); the Agent, which watches
   and hears the whole clip, writes cues — "at 0:32 set these controls" —
   that the server snaps to the beat grid and validates like a plan. The Lab
   plays them on the SOURCE video's timeline (Lab playback, scrubbing and the
   Master export), and one Undo removes the whole timeline. */

/** At most this many cues in one timeline. */
export const MAX_CUES = 24;

/** One stretch of the song found by the Lab's analysis (seconds). `energy`
 *  is relative to the loudest stretch of THIS song: 0..1. */
export interface SongSection { start: number; end: number; energy: number }

/** The source video's soundtrack, analysed in the browser. Constant tempo:
 *  beat k is at firstBeat + k * 60 / bpm (k may be negative to reach 0). */
export interface BeatGrid {
  bpm: number;
  firstBeat: number;      // seconds
  beatsPerBar: number;    // 4
  firstDownbeat: number;  // seconds: the first beat of a bar
  duration: number;       // seconds of the source
  sections: SongSection[];
  /** 0..1: how clearly the tempo stood out (low: the AI should trust its ears over the grid) */
  confidence: number;
}

/** One change on the timeline: at `at` the controls in `params` take these
 *  values (validated exactly like a plan's params). The state at time t is
 *  the value each cued control had before the timeline was installed,
 *  overlaid with every cue whose `at` <= t, in order. */
export interface Cue {
  at: number;             // seconds on the SOURCE video's timeline (on a beat when a grid is known)
  label: string;          // the moment in the director's words: "DROP", "STROFA 2", "HOOK"
  params: { key: string; value: number }[];
}

export interface CueTimeline {
  cues: Cue[];            // sorted by `at`, distinct times, each with >= 1 param
  grid: BeatGrid | null;
}

/* ── role: AGENT ────────────────────────────────────────────── */

export interface AgentPlan {
  summary: string;
  params: { key: string; value: number }[];
  /** Legacy (SynEngine signal routes): kept in the wire format, always []
   *  from the server — the iframe Lab has no routes. */
  routes: { key: string; source: ModSourceT | 'off'; amount: number }[];
  /** The beat-synced timeline (validated, snapped, sorted). Absent / [] when
   *  the Agent wrote none (a photo, the webcam, a static look). */
  cues?: Cue[];
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
  /** The source video's soundtrack analysed by the Lab (null: no video, no
   *  soundtrack, or the analysis failed). */
  beatGrid?: BeatGrid | null;
  /** True when the source has a timeline (a video): the Agent may write cues. */
  wantCues?: boolean;
  /** True when the panel can rebuild the chain the Agent asks for (the
   *  two-step flow, 03-SPEC §9.15). Absent/false: the chain is fixed and the
   *  schema does not even offer a `chain` field. */
  allowChain?: boolean;
  /** True on the automatic SECOND call, after the Lab rebuilt the chain the
   *  first call asked for: the chain is final, no further change. */
  chainChanged?: boolean;
}

export interface AgentResult {
  plan: AgentPlan;           // already validated + clamped by the server
  /** Set when the Agent needs a DIFFERENT chain (effects added, removed or
   *  reordered — 1..3 effects). The plan then holds nothing for effects not
   *  yet in the Lab: the panel wires this chain, waits for the Lab, and asks
   *  the Agent again with chainChanged: true. */
  chain?: ModuleId[] | null;
  dropped: string[];         // what the validator refused, and why
  /** What it kept but changed (a base raised to its floor, a route depth
   *  capped), one line each — shown on the applied rows, not as refusals. */
  adjusted?: string[];
  /** set by the server: which model / effort really answered */
  meta?: RunMeta;
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
  /** set by the server: which model / effort really answered */
  meta?: RunMeta;
}

/* ── key status ─────────────────────────────────────────────── */

/** GET /api/gemini/status — no key needed. `model` is the server's default
 *  (GEMINI_MODEL or GEMINI_MODEL_DEFAULT), used when the panel sends none. */
export interface StatusResponse { serverKey: boolean; model: string }

/** POST /api/gemini/key — validates the header key (or the server key when the
 *  header is absent) with one models.get call on the requested model
 *  (GEMINI_MODEL_HEADER, else the default); no tokens spent. */
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
  /** The OUTPUT's measured fps over ~1.1 s, with the chain held live (every node rendering at the
   *  Lab's cap) and after fresh frames — chainState().fps is the on-screen meter, 0 while the OUTPUT
   *  is paused by the frame budget (an earlier tab on top, Lab hidden). */
  measureFps(windowMs?: number): Promise<number>;
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
  /** Analyses the INPUT video's own soundtrack (decoded in the browser,
   *  cached per source). null for the webcam or a photo, a video with no
   *  soundtrack, or a failed decode. */
  beatGrid(): Promise<BeatGrid | null>;
  /** Installs a cue timeline (replacing the one installed before, which is
   *  NOT reverted: undo that first). Every cue param is checked like
   *  applyPlan's; the undo records the value each cued key had before, and
   *  carries cues: true. Refused (installed 0) while a Master export runs. */
  setCues(timeline: CueTimeline): { installed: number; skipped: string[]; undo: PlanUndo | null };
  /** The installed timeline, or null. */
  cues(): CueTimeline | null;
  /** CUE AUTO: plays (true) or holds (false) the installed timeline. */
  setCuesEnabled(on: boolean): void;
}

/** The previous state of each key a plan touched (see LabHandle.applyPlan). */
export interface PlanUndo {
  /** true for a cue timeline's undo: reverting it also removes the timeline */
  cues?: boolean;
  /** The timeline that was installed before (Lab-internal record): reverting
   *  reinstalls it after the entries are restored. null = there was none. */
  prevCues?: { timeline: CueTimeline; baseline: { key: string; value: number }[]; enabled: boolean; source: string } | null;
  entries: {
    key: string;                       // '<ModuleId>.<effect key>'
    base?: number;                     // previous value (numbers, enums)
    bool?: number;                     // previous switch value (booleans)
    route?: RouteT | null;             // legacy (SynEngine routes): unused by the iframe Lab
  }[];
}
