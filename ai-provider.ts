/*
 * GEMINI — the one AI provider behind /api/gemini/*.
 *
 * Gemini only, and only because it can SEE: the three roles (Art Director,
 * Agent, Optimizer — see src/ai/contract.ts) all send real pixels and audio,
 * and a text-only model would be guessing from a filename. That is why there
 * is no second, text-only provider any more.
 *
 * Where the key comes from, in order:
 *   1. the x-gemini-key header — the key the operator pasted in the panel. The
 *      browser keeps it in localStorage and sends it to OUR server only;
 *   2. GEMINI_API_KEY from .env.local / .env — optional, for a machine that
 *      should not need the paste. Used ONLY for requests from this machine
 *      (loopback, opened at localhost, not relayed by a proxy or tunnel): the
 *      server listens on 0.0.0.0, and a phone or laptop on the same Wi-Fi —
 *      or a visitor through a tunnel — must not spend the operator's quota
 *      without pasting a key;
 *   3. nothing — every role answers 401 `no_key` and the panel stays locked.
 *      Nothing that is not AI ever needs a key.
 *
 * The key is never logged, never echoed back, never put in a URL (the SDK
 * sends it as the x-goog-api-key header). Error messages that reach the
 * browser are ours, short and in English, and are scrubbed of anything that
 * looks like a key before they leave.
 */

import {
  GoogleGenAI,
  ApiError,
  FileState,
  type MediaResolution,
  type ThinkingLevel,
  type Part,
  type File as GeminiFile,
} from '@google/genai';
import type { Request } from 'express';
import fs from 'fs';
import {
  EFFORTS,
  EFFORT_LABEL,
  GEMINI_EFFORT_HEADER,
  GEMINI_KEY_HEADER,
  GEMINI_MODEL_DEFAULT,
  GEMINI_MODEL_HEADER,
  KNOWN_MODELS,
  byStrength,
  MODEL_ID_PATTERN,
  UNKNOWN_MODEL_EFFORTS,
  type AiErrorKind,
  type EffortT,
  type KnownModel,
  type ModelInfo,
  type ModelsResponse,
  type RunMeta,
} from './src/ai/contract';

/* ── model ────────────────────────────────────────────────────── */

/* A function, not a const, and on purpose. server.ts loads .env.local/.env in
   its body, but ES imports are hoisted: this module is evaluated BEFORE that
   dotenv.config() call runs, so a top-level `const MODEL = process.env…`
   would never see a GEMINI_MODEL written in .env.local. Reading it on use
   always sees the loaded value. */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
}

const MODEL_RE = new RegExp(MODEL_ID_PATTERN);

/** The model for this request: the panel's header, else the server default.
 *  A malformed id is a 400 before any Google call. */
export function resolveModel(req: Request): string {
  const raw = req.get(GEMINI_MODEL_HEADER);
  if (raw === undefined || !raw.trim()) return geminiModel();
  const id = raw.trim().toLowerCase().replace(/^models\//, '');
  if (!MODEL_RE.test(id)) throw new GeminiFailure('bad_request', 'The requested model id is not a valid Gemini model id (gemini-…).');
  return id;
}

/** What this build knows about a model id (see KNOWN_MODELS). */
export function modelProfile(id: string): { efforts: readonly EffortT[]; defaultEffort: EffortT; known: KnownModel | null } {
  const known = KNOWN_MODELS.find((m) => m.id === id) ?? null;
  if (known) return { efforts: known.efforts, defaultEffort: known.defaultEffort, known };
  if (/^gemini-2\./.test(id)) return { efforts: ['default'], defaultEffort: 'default', known: null };
  return { efforts: UNKNOWN_MODEL_EFFORTS, defaultEffort: 'default', known: null };
}

/** The effort for this request. Never substituted: a known model that does not
 *  offer the asked effort is a 400; an unknown model is left to Google. */
export function resolveEffort(req: Request, model: string): EffortT {
  const profile = modelProfile(model);
  const raw = req.get(GEMINI_EFFORT_HEADER);
  if (raw === undefined || !raw.trim()) return profile.defaultEffort;
  const effort = raw.trim().toLowerCase() as EffortT;
  if (!EFFORTS.includes(effort)) {
    throw new GeminiFailure('bad_request', `Unknown effort "${scrub(raw, 30)}". Pick one of: ${EFFORTS.join(', ')}.`);
  }
  if (profile.known && !profile.known.efforts.includes(effort)) {
    const offered = profile.known.efforts.map((e) => EFFORT_LABEL[e].toLowerCase()).join(', ');
    throw new GeminiFailure('bad_request', `${profile.known.name} does not offer effort "${EFFORT_LABEL[effort].toLowerCase()}". Pick one of: ${offered}.`);
  }
  return effort;
}

/* ── key + client ─────────────────────────────────────────────── */

/** True when the request comes from this machine. The socket's own address,
 *  never X-Forwarded-For (a header anyone can write); the whole 127/8 block
 *  and its IPv4-mapped IPv6 form are loopback, and so is ::1. */
export function isLoopback(req: Request): boolean {
  const addr = req.socket?.remoteAddress ?? '';
  return addr === '::1' || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(addr);
}

/** "Host: [::1]:3000" → "::1", "Studio-Mac.local.:3000" → "studio-mac.local";
 *  null when it is not a host at all. Shared with server.ts's Host guard. */
export function hostnameOf(hostHeader: string | undefined): string | null {
  const host = (hostHeader || '').trim().toLowerCase();
  if (!host) return null;
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 1 ? host.slice(1, end) : null;
  }
  const name = host.replace(/:\d*$/, '').replace(/\.$/, '');
  return name || null;
}

/* A loopback socket is not always a browser on this machine: a reverse proxy
   or a tunnel (nginx, cloudflared, ngrok, ssh -R) on this machine connects
   from 127.0.0.1 on behalf of anyone on the internet, once ALLOWED_HOSTS lets
   its name through. So the server key also needs the request to look direct:
   none of the headers a relay adds (anyone can write them, but writing one
   only takes the server key AWAY), and a Host that only this machine's own
   browser uses — localhost, *.localhost or a loopback address. */
const RELAY_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-real-ip'];
function isDirectLocal(req: Request): boolean {
  if (RELAY_HEADERS.some((h) => req.headers[h] !== undefined)) return false;
  const name = hostnameOf(req.headers.host);
  if (!name) return false;
  return name === 'localhost' || name.endsWith('.localhost')
    || name === '::1' || name === '0.0.0.0'
    || /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

/** The server's own key, for a request allowed to use it: a browser on this
 *  machine, talking to it directly. */
function serverKeyFor(req: Request): string | null {
  return isLoopback(req) && isDirectLocal(req) ? process.env.GEMINI_API_KEY?.trim() || null : null;
}

/** Whether THIS client may fall back on the server key (GET /status). A LAN
 *  client is told "no" even when the key is set — it must paste its own. */
export function serverKeyAvailable(req: Request): boolean {
  return serverKeyFor(req) !== null;
}

/** The key for this request: the panel's header, else the server's (loopback
 *  clients only), else null. */
export function resolveKey(req: Request): string | null {
  const fromHeader = req.get(GEMINI_KEY_HEADER)?.trim();
  if (fromHeader) return fromHeader;
  return serverKeyFor(req);
}

/* One client per key, built on first use. Always an explicit apiKey — the SDK
   would otherwise go looking in the environment on its own, and the browser's
   key and the server's key must never be confused. The cap only stops a long
   session of pasted-and-replaced keys from growing the map forever.

   GEMINI_BASE_URL is a TEST HOOK, nothing else: the verify suites point it at
   a local mock of generativelanguage.googleapis.com so the whole flow can run
   without a real key. Leave it unset in real use.

   No httpOptions.retryOptions, deliberately: with it the SDK's retry wrapper
   rethrows without ApiError.status, and classifyError below needs that status
   to tell a bad key from a quota from an outage. */
const clients = new Map<string, GoogleGenAI>();
const MAX_CLIENTS = 8;

export function getClient(apiKey: string): GoogleGenAI {
  let ai = clients.get(apiKey);
  if (!ai) {
    const baseUrl = process.env.GEMINI_BASE_URL;
    ai = new GoogleGenAI({
      apiKey,
      vertexai: false,
      ...(baseUrl ? { httpOptions: { baseUrl } } : {}),
    });
    if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value as string);
    clients.set(apiKey, ai);
  }
  return ai;
}

/* ── errors ───────────────────────────────────────────────────── */

/** What every failure is reduced to before it reaches the browser. */
export interface AiFailure { kind: AiErrorKind; message: string; status: number }

/** HTTP status our server answers with, per kind. The browser keys on the
 *  body's `error`, so these only need to be honest, not clever. */
const KIND_STATUS: Record<AiErrorKind, number> = {
  no_key: 401,
  invalid_key: 401,
  model_unavailable: 502,
  quota: 429,
  too_large: 413,
  no_media: 400,
  bad_request: 400,
  upstream: 502,
  network: 502,
  server_error: 500,
};

/** A failure we raise ourselves (empty answer, malformed JSON, a video Google
 *  could not process…), already classified. */
export class GeminiFailure extends Error {
  readonly kind: AiErrorKind;
  readonly status: number;
  constructor(kind: AiErrorKind, message: string, status = KIND_STATUS[kind]) {
    super(message);
    this.name = 'GeminiFailure';
    this.kind = kind;
    this.status = status;
  }
}

export function failure(kind: AiErrorKind, message: string): AiFailure {
  return { kind, message, status: KIND_STATUS[kind] };
}

/* Anything shaped like a Google API key goes, wherever it hides. Google's own
   messages never contain the key, but a message is cheap to scrub and a leaked
   key in a log or a screenshot is not. */
const KEY_SHAPE = /AIza[0-9A-Za-z_\-]{20,}/g;
function scrub(text: string, max = 240): string {
  const clean = text.replace(KEY_SHAPE, '[key]').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

interface GoogleErrorInfo {
  code: number;
  status: string;      // RESOURCE_EXHAUSTED, PERMISSION_DENIED…
  message: string;
  reasons: string[];   // details[].reason, e.g. API_KEY_INVALID
  retryDelay: string | null;
  /** details[].violations[].quotaId of a 429, e.g.
   *  GenerateRequestsPerDayPerProjectPerModel-FreeTier. */
  quotaIds: string[];
}

/* The SDK's ApiError carries Google's whole error body JSON-stringified in
   .message: {"error":{"code":400,"message":"…","status":"INVALID_ARGUMENT",
   "details":[{"reason":"API_KEY_INVALID",…}]}}. For a non-JSON body (a proxy's
   HTML page) it wraps the text the same way. Parse it; fall back to regexes if
   the shape ever changes. */
function readGoogleError(err: ApiError): GoogleErrorInfo {
  const info: GoogleErrorInfo = { code: err.status, status: '', message: '', reasons: [], retryDelay: null, quotaIds: [] };
  try {
    const body = JSON.parse(err.message);
    const e = body?.error ?? body;
    if (typeof e?.code === 'number') info.code = err.status || e.code;
    if (typeof e?.status === 'string') info.status = e.status;
    if (typeof e?.message === 'string') info.message = e.message;
    if (Array.isArray(e?.details)) {
      for (const d of e.details) {
        if (typeof d?.reason === 'string') info.reasons.push(d.reason);
        if (typeof d?.retryDelay === 'string') info.retryDelay = d.retryDelay;
        if (Array.isArray(d?.violations)) {
          for (const v of d.violations) if (typeof v?.quotaId === 'string') info.quotaIds.push(v.quotaId);
        }
      }
    }
  } catch {
    const raw = String(err.message || '');
    info.status = raw.match(/"status"\s*:\s*"([A-Z_]+)"/)?.[1] ?? '';
    info.message = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1] ?? raw;
    for (const m of raw.matchAll(/"reason"\s*:\s*"([A-Z_]+)"/g)) info.reasons.push(m[1]);
    info.retryDelay = raw.match(/"retryDelay"\s*:\s*"([^"]+)"/)?.[1] ?? null;
    for (const m of raw.matchAll(/"quotaId"\s*:\s*"([^"]+)"/g)) info.quotaIds.push(m[1]);
  }
  return info;
}

/** Google's RetryInfo delay ("27672s", "41.3s") as a human wait, or null. */
export function humanDelay(retryDelay: string | null): string | null {
  const sec = Number(String(retryDelay ?? '').trim().replace(/s$/i, ''));
  if (!Number.isFinite(sec) || sec <= 0) return null;
  if (sec < 60) return `${Math.max(1, Math.ceil(sec))} s`;
  if (sec < 3600) return `${Math.ceil(sec / 60)} min`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/* A 429 says WHICH quota ran out, in QuotaFailure.violations[].quotaId:
   …PerDay… is the daily request cap (it resets at midnight Pacific time —
   waiting a minute is pointless), …PerMinute… a rate limit, …Token… an
   input-token budget (a long video spends many). The tier comes from the
   quotaId too; a paid key's 429 is not a "free-tier limit". */
function quotaMessage(g: GoogleErrorInfo): string {
  const ids = g.quotaIds.join(' ');
  const about = `${ids} ${g.message}`;
  const tier = /FreeTier/i.test(ids) ? ' (free tier)' : '';
  const delay = humanDelay(g.retryDelay);
  if (/PerDay|per day|daily/i.test(about)) {
    return `Gemini's daily request limit for this key is used up${tier}. It resets at midnight Pacific time${delay ? ` (in about ${delay})` : ''}: try again then, or paste another key.`;
  }
  const wait = `Wait about ${delay ?? '1 min'} and try again`;
  if (/Token/i.test(ids)) {
    return `Gemini's per-minute token limit for this key was reached${tier}: a long video spends many tokens. ${wait}, or use a shorter clip.`;
  }
  if (/PerMinute|per minute/i.test(about)) {
    return `Gemini's per-minute request limit for this key was reached${tier}. ${wait}.`;
  }
  return `Gemini quota reached for this key${tier}. ${wait}.`;
}

/* Errors that mean "we never got a proper answer": the SDK's own timeout (an
   aborted fetch), DNS, resets. Node's fetch hides the real cause one level
   down, in err.cause. */
function isNetworkish(err: unknown): boolean {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return true;
  const text = `${e?.message ?? ''} ${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.cause?.message ?? ''}`;
  return /fetch failed|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|UND_ERR/i.test(text);
}

/** Reduces any thrown value to {kind, message, status}. The message is ours,
 *  in English, short, actionable — and never contains a key. */
export function classifyError(err: unknown, ctx?: { model: string; effort: EffortT }): AiFailure {
  const modelId = ctx?.model ?? geminiModel();
  if (err instanceof GeminiFailure) return { kind: err.kind, message: scrub(err.message), status: err.status };

  if (err instanceof ApiError) {
    const g = readGoogleError(err);
    const code = g.code;
    const said = scrub(g.message || g.status || `HTTP ${code}`);
    const keyRejected = g.reasons.includes('API_KEY_INVALID') || /API[_ ]key not valid|API_KEY_INVALID/i.test(g.message);

    if ((code === 400 && keyRejected) || code === 401) {
      return failure('invalid_key', 'Google rejected this API key. Paste a valid key from https://aistudio.google.com/apikey.');
    }
    if (code === 403) {
      /* A 403 about a FILE is not the key's fault: it is an uploaded source
         that expired (Google keeps uploads ~48h) or belongs to another key. */
      if (/\bfile\b/i.test(g.message)) {
        return failure('bad_request', 'The uploaded source is no longer available on Google (uploads expire after ~48h). Run again to re-upload it.');
      }
      return failure('invalid_key', `Google refused this key (permission denied): ${said}`);
    }
    if (code === 404) {
      return failure('model_unavailable', `Model "${modelId}" is not available for this key. Pick another model in the Gemini panel.`);
    }
    if (code === 429) {
      if (/limit:\s*0\b/i.test(g.message) || /limit:\s*0\b/i.test(err.message)) {
        return failure('quota', `"${modelId}" has no free quota for this key (paid only). Pick a free model — e.g. Gemini 4 Hydrogen — in the Gemini panel.`);
      }
      return failure('quota', quotaMessage(g));
    }
    if (code === 413 || /payload|too large|exceeds the (maximum|limit)|request size/i.test(g.message)) {
      return failure('too_large', 'Too much media for one Gemini request. Use a shorter clip or fewer frames.');
    }
    if (code === 400 && /thinking/i.test(g.message)) {
      return failure('bad_request', `"${modelId}" does not accept effort "${ctx?.effort ?? 'default'}". Pick another effort in the Gemini panel.`);
    }
    if (code === 400) return failure('bad_request', `Gemini refused the request: ${said}`);
    if (code === 408 || code >= 500) {
      return failure('upstream', `Gemini is unavailable right now (HTTP ${code}). Try again in a moment.`);
    }
    return failure('server_error', `Unexpected answer from Gemini (HTTP ${code}): ${said}`);
  }

  if (isNetworkish(err)) {
    return failure('upstream', 'Could not reach Gemini (timeout or network error). Try again in a moment.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  return failure('server_error', `Unexpected server error: ${scrub(msg)}`);
}

/** True when Google refused the response SCHEMA itself and SAID so (too
 *  many enum states, an unsupported keyword) rather than the media or the
 *  key. */
export function isSchemaRejection(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  const g = readGoogleError(err);
  if (g.reasons.includes('API_KEY_INVALID')) return false;
  return /schema|too many states|constraint|enum/i.test(g.message);
}

/* What a 400 about the request's OTHER parts names: the key, an uploaded
   file, the media, its size or type, the token budget. Such a 400 is not the
   schema's, and the same request with a looser schema would fail again. */
const NOT_THE_SCHEMA = /api[_ ]?key|\bfile|\buri\b|mime|media|video|image|audio|inline|payload|too large|exceeds|size|token|base64|content type|fps|safety|location|region|model/i;

/** A bare 400 INVALID_ARGUMENT — "Request contains an invalid argument." —
 *  that names nothing else. Google documents exactly this answer for a
 *  response schema it finds too complex (large enums, nested arrays with
 *  length limits, numeric bounds): the message does not say "schema". */
export function isBareInvalidArgument(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  const g = readGoogleError(err);
  if (g.reasons.length) return false; // API_KEY_INVALID & co. name their reason
  if (g.status && g.status !== 'INVALID_ARGUMENT') return false;
  if (NOT_THE_SCHEMA.test(g.message)) return false;
  return /invalid argument/i.test(g.message) || g.message.trim() === '';
}

/** Why a role that HAS a loose schema should spend its one retry on it —
 *  null when it should not. A schema rejection (a 400 naming the schema), a
 *  bare 400 INVALID_ARGUMENT (see isBareInvalidArgument), or a bare 500
 *  INTERNAL (Google has been seen to answer an over-complex schema that way).
 *  Not 502/503/504: those are outages, not the schema. The reason is what
 *  server.ts logs. */
export function looseRetryReason(err: unknown): string | null {
  if (isSchemaRejection(err)) return 'a 400 naming the schema';
  if (isBareInvalidArgument(err)) return 'a bare 400 INVALID_ARGUMENT';
  if (err instanceof ApiError && err.status === 500) return 'HTTP 500';
  return null;
}

export function worthLooseRetry(err: unknown): boolean {
  return looseRetryReason(err) !== null;
}

/** Classify AND log, once. Every failing /api/gemini call goes through here,
 *  so a wrong key, a quota hit and a rejected model id each leave exactly one
 *  readable line in the server log — never the key, never a header. */
export function reportFailure(err: unknown, ctx?: { model: string; effort: EffortT }): AiFailure {
  const f = classifyError(err, ctx);
  console.warn(`[gemini] ${f.kind}: ${f.message}`);
  return f;
}

/* ── calls ────────────────────────────────────────────────────── */

/** One models.get on `model`: proves the key works AND the model is
 *  reachable with it, and spends no tokens. Throws on failure. */
export async function checkKey(apiKey: string, model: string): Promise<void> {
  await getClient(apiKey).models.get({ model, config: { httpOptions: { timeout: 15_000 } } });
}

/* Generous: a whole music video plus model thinking is a long request, and
   this only bounds a hung connection. The SDK aborts the fetch on expiry. */
const GENERATE_TIMEOUT_MS = 240_000;

export interface GenerateJsonRequest {
  apiKey: string;
  /** The model id to ask (resolveModel) and the thinking level (resolveEffort). */
  model: string;
  effort: EffortT;
  systemInstruction: string;
  /** One user turn: media items and the text that frames them. */
  parts: Part[];
  /** Built per request (src/ai roles): Gemini answers in exactly this shape. */
  responseJsonSchema: unknown;
  mediaResolution?: MediaResolution;
  /** Aborts the call (server.ts ties it to the browser hanging up). Client
   *  side only: Google may still bill what it already processed. */
  signal?: AbortSignal;
}

/* Finish reasons that mean "Gemini will not answer about THIS media" — a
   deterministic refusal, so "try again" would be a lie. */
const DECLINED_FINISH = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);
const declined = (why: string) => new GeminiFailure('bad_request', `Gemini declined this media (${why}). Try other frames or another clip.`);

/** One Gemini call that must answer with a JSON object; returns it parsed.
 *  No temperature override — Google tunes Gemini 3 for its default. */
export async function generateJson<T>(req: GenerateJsonRequest): Promise<{ value: T; meta: RunMeta }> {
  const t0 = Date.now();
  let response;
  try {
    response = await getClient(req.apiKey).models.generateContent({
    model: req.model,
    contents: [{ role: 'user', parts: req.parts }],
    config: {
      systemInstruction: req.systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: req.responseJsonSchema,
      ...(req.mediaResolution ? { mediaResolution: req.mediaResolution } : {}),
      /* The SDK's ThinkingLevel enum has no XHIGH, but thinkingConfig is
         forwarded to the API as is: the string goes out untouched. */
      ...(req.effort !== 'default'
        ? { thinkingConfig: { thinkingLevel: req.effort.toUpperCase() as unknown as ThinkingLevel } }
        : {}),
      ...(req.signal ? { abortSignal: req.signal } : {}),
      httpOptions: { timeout: GENERATE_TIMEOUT_MS },
    },
    });
  } catch (err) {
    /* learn from the run: "limit: 0" = paid-only model on a free key */
    if (isNoFreeQuota(err)) noteLock(req.apiKey, req.model, true, true);
    throw err;
  }
  noteLock(req.apiKey, req.model, false, true);

  /* A safety stop on the prompt (blockReason) or on the answer (the
     candidate's finishReason) is a refusal of this media, not a glitch. */
  const blocked = response.promptFeedback?.blockReason;
  const finish = response.candidates?.[0]?.finishReason;
  if (blocked) throw declined(String(blocked));
  if (finish && DECLINED_FINISH.has(String(finish))) throw declined(String(finish));

  const text = response.text?.trim();
  if (!text) {
    /* No text and no refusal: Gemini stopped early. Worth a retry. */
    throw new GeminiFailure('upstream', `Gemini returned an empty answer${finish ? ` (${finish})` : ''}. Try again.`);
  }
  /* responseMimeType makes fences unlikely; strip them anyway. */
  const body = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const usage = response.usageMetadata;
  const meta: RunMeta = {
    requested: req.model,
    model: response.modelVersion || req.model,
    effort: req.effort,
    thoughtsTokens: usage?.thoughtsTokenCount ?? null,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
    ms: Date.now() - t0,
  };
  try {
    return { value: JSON.parse(body) as T, meta };
  } catch {
    throw new GeminiFailure('upstream', finish === 'MAX_TOKENS'
      ? 'Gemini’s answer was cut off before it finished. Try again.'
      : 'Gemini answered with malformed JSON. Try again.');
  }
}

/* ── the model list ──────────────────────────────────────────── */

const LIST_TIMEOUT_MS = 15_000;
const LIST_CACHE_MS = 10 * 60_000;
const LIST_CAP = 300;
const LIST_EXCLUDE = /embed|imagen|image|tts|live|native-audio|aqa|robotics|computer-use|veo|lyria|learnlm|gemma/i;
const listCache = new Map<string, { at: number; value: ModelsResponse }>();

const versionOf = (id: string): number => {
  const n = Number(id.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1]);
  return Number.isFinite(n) ? n : 0;
};

/* ── per-key model locks ─────────────────────────────────────────
   A model is "locked" for a key when Google says that key has no quota on it
   at all (429 "limit: 0" — paid only, the key has no billing). Known paid
   models are probed once per key with a 1-token call (never a free model: it
   would spend its daily free quota); a real run that gets "limit: 0" locks
   the model, a run that succeeds unlocks it. Definite answers are kept 6 h,
   "could not tell" answers ~2 min. Never logged, the key is only a Map key. */
const PROBE_TIMEOUT_MS = 10_000;
const LOCK_DEFINITE_MS = 6 * 3_600_000;
const LOCK_UNKNOWN_MS = 2 * 60_000;
const lockCache = new Map<string, Map<string, { at: number; locked: boolean; definite: boolean }>>();

/** Google's 429 for a model the key has no quota on (same test classifyError uses). */
function isNoFreeQuota(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 429) return false;
  const g = readGoogleError(err);
  return /limit:\s*0\b/i.test(g.message) || /limit:\s*0\b/i.test(err.message);
}

/** Records (key, model) as locked/unlocked; drops the key's list cache so the
 *  next GET /api/gemini/models shows it. */
export function noteLock(apiKey: string, model: string, locked: boolean, definite: boolean): void {
  let per = lockCache.get(apiKey);
  if (!per) {
    if (lockCache.size >= MAX_CLIENTS) lockCache.delete(lockCache.keys().next().value as string);
    per = new Map();
    lockCache.set(apiKey, per);
  }
  const prev = per.get(model);
  per.set(model, { at: Date.now(), locked, definite });
  if (!prev || prev.locked !== locked) listCache.delete(apiKey);
}

/** Test hook: forget everything cached for a key (or all keys). */
export function clearModelCaches(apiKey?: string): void {
  if (apiKey) { lockCache.delete(apiKey); listCache.delete(apiKey); } else { lockCache.clear(); listCache.clear(); }
}

/** One minimal generateContent on a paid-only model: true = locked, false =
 *  usable, null = could not tell. */
async function probeLocked(apiKey: string, model: string): Promise<boolean | null> {
  try {
    await getClient(apiKey).models.generateContent({
      model,
      contents: '1',
      config: { maxOutputTokens: 16, httpOptions: { timeout: PROBE_TIMEOUT_MS } },
    });
    return false;
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 429) return isNoFreeQuota(err);
      if (err.status === 403 || err.status === 404) return true;
      if (err.status >= 500 || err.status === 408) return null;
      return false; // 400 & co.: the model answered, the call was the problem
    }
    return null;
  }
}

/** This key's definite, unexpired lock answer for a model (no probe), else false. */
function knownLock(apiKey: string, id: string): boolean {
  const hit = lockCache.get(apiKey)?.get(id);
  return !!hit && hit.definite && hit.locked && Date.now() - hit.at < LOCK_DEFINITE_MS;
}

const probeFlight = new Map<string, Promise<boolean | null>>();

/** probeLocked, one call at a time per (key, model); bounded, removed when settled. */
function probeOnce(apiKey: string, model: string): Promise<boolean | null> {
  const k = `${apiKey}\u0000${model}`;
  const run = probeFlight.get(k);
  if (run) return run;
  if (probeFlight.size >= MAX_CLIENTS * 16) probeFlight.delete(probeFlight.keys().next().value as string);
  const p = probeLocked(apiKey, model).finally(() => { if (probeFlight.get(k) === p) probeFlight.delete(k); });
  probeFlight.set(k, p);
  return p;
}

/** locked per row for this key: a cached answer inside its age (definite 6 h,
 *  "could not tell" 2 min), else a probe (known paid rows only). A probe that
 *  could not tell counts as NOT locked (shown usable, re-probed after 2 min);
 *  an expired answer is not a lock. */
async function lockedFor(apiKey: string, rows: ModelInfo[]): Promise<boolean[]> {
  return Promise.all(rows.map(async (r) => {
    const hit = lockCache.get(apiKey)?.get(r.id);
    if (hit && Date.now() - hit.at < (hit.definite ? LOCK_DEFINITE_MS : LOCK_UNKNOWN_MS)) return hit.locked;
    if (r.free !== 'no') return false;
    const res = await probeOnce(apiKey, r.id);
    let p = lockCache.get(apiKey);
    if (!p) {
      if (lockCache.size >= MAX_CLIENTS) lockCache.delete(lockCache.keys().next().value as string);
      p = new Map();
      lockCache.set(apiKey, p);
    }
    if (res === null) { p.set(r.id, { at: Date.now(), locked: false, definite: false }); return false; }
    p.set(r.id, { at: Date.now(), locked: res, definite: true });
    return res;
  }));
}

function rowFor(id: string, google?: { displayName?: string; description?: string; inputTokenLimit?: number }, apiKey?: string): ModelInfo {
  const p = modelProfile(id);
  const free = p.known?.free ?? 'unknown';
  return {
    id,
    name: google?.displayName || p.known?.name || id,
    description: google?.description || '',
    inputTokenLimit: google?.inputTokenLimit ?? null,
    efforts: [...p.efforts],
    defaultEffort: p.defaultEffort,
    free,
    note: p.known?.note ?? '',
    known: !!p.known,
    /* a lock is a fact about the KEY, never about the catalog: only a definite
       answer already learned for this key counts (no probe here) */
    locked: apiKey ? knownLock(apiKey, id) : false,
    listed: !!google,
  };
}

/** The model a fresh panel picks: the strongest one this build KNOWS and this
 *  key can use (a billing key → Neon, a free key → Hydrogen). A model unknown to
 *  the build is never auto-picked — its tier is not proven until a run — but
 *  it stays listed and selectable. */
const pickRecommended = (rows: ModelInfo[]): string =>
  (rows.find((r) => r.known && !r.locked) ?? rows.find((r) => !r.locked) ?? rows[0])?.id ?? GEMINI_MODEL_DEFAULT;

/** Re-applies this key's locks to rows (probing what is not cached). */
async function withLocks(apiKey: string, value: ModelsResponse): Promise<ModelsResponse> {
  const locks = await lockedFor(apiKey, value.models);
  const rows = value.models.map((r, i) => ({ ...r, locked: locks[i] }));
  return { ...value, models: rows, recommended: pickRecommended(rows) };
}

/** The gemini-… text models Google lists for this key (>= 2.5, no embedding,
 *  image, audio or live models), strongest first, each with its per-key lock.
 *  A wrong key throws; any other failure falls back on KNOWN_MODELS with a warning. */
const listFlight = new Map<string, Promise<ModelsResponse>>();

/** listModels, deduped: concurrent first calls for one key share one run (and
 *  so one set of probes). Bounded; removed when settled. */
export function listModels(apiKey: string): Promise<ModelsResponse> {
  const run = listFlight.get(apiKey);
  if (run) return run;
  if (listFlight.size >= MAX_CLIENTS) listFlight.delete(listFlight.keys().next().value as string);
  const p = listModelsRun(apiKey).finally(() => { if (listFlight.get(apiKey) === p) listFlight.delete(apiKey); });
  listFlight.set(apiKey, p);
  return p;
}

async function listModelsRun(apiKey: string): Promise<ModelsResponse> {
  const cached = listCache.get(apiKey);
  if (cached && Date.now() - cached.at < LIST_CACHE_MS) {
    if (cached.value.source !== 'google') return cached.value;
    /* the probe cache may have refreshed since: re-apply (cheap when cached) */
    const fresh = await withLocks(apiKey, cached.value);
    const again = listCache.get(apiKey);
    if (again) listCache.set(apiKey, { at: again.at, value: fresh });
    return fresh;
  }

  let value: ModelsResponse;
  try {
    const pager = await getClient(apiKey).models.list({ config: { pageSize: 100, httpOptions: { timeout: LIST_TIMEOUT_MS } } });
    const found = new Map<string, { displayName?: string; description?: string; inputTokenLimit?: number }>();
    let seen = 0;
    for await (const m of pager) {
      if (++seen > LIST_CAP) break;
      const id = (m.name ?? '').replace(/^models\//, '');
      if (!m.name?.startsWith('models/gemini-') || !MODEL_RE.test(id)) continue;
      if (!m.supportedActions?.includes('generateContent')) continue;
      if (LIST_EXCLUDE.test(id) || versionOf(id) < 2.5) continue;
      found.set(id, { displayName: m.displayName, description: m.description, inputTokenLimit: m.inputTokenLimit });
    }
    const rows = byStrength([...found.keys()].map((id) => rowFor(id, found.get(id), apiKey)));
    value = await withLocks(apiKey, { models: rows, recommended: GEMINI_MODEL_DEFAULT, source: 'google' });
  } catch (err) {
    const f = classifyError(err);
    if (f.kind === 'invalid_key') throw err;
    console.warn(`[gemini] model list unavailable (${f.kind}): ${f.message}`);
    const rows = byStrength(KNOWN_MODELS.map((k) => rowFor(k.id, undefined, apiKey)));
    const fallback: ModelsResponse = {
      models: rows,
      recommended: pickRecommended(rows),
      source: 'catalog',
      warning: `Could not read Google's model list (${f.kind}); showing the models this app knows.`,
    };
    /* remembered briefly (backdated so it expires after ~30 s): reopening the
       picker must not wait another 15 s timeout on every click */
    if (listCache.size >= MAX_CLIENTS) listCache.delete(listCache.keys().next().value as string);
    listCache.set(apiKey, { at: Date.now() - LIST_CACHE_MS + 30_000, value: fallback });
    return fallback;
  }
  if (listCache.size >= MAX_CLIENTS) listCache.delete(listCache.keys().next().value as string);
  listCache.set(apiKey, { at: Date.now(), value });
  return value;
}

/* ── uploads (Files API) ─────────────────────────────────────── */

const POLL_EVERY_MS = 2_000;
const PROCESSING_TIMEOUT_MS = 5 * 60_000;

const cancelledByBrowser = () => new GeminiFailure('server_error', 'Upload cancelled by the browser.');

/** Resolves/rejects with `p`, or rejects as soon as `signal` aborts — `p`
 *  itself keeps running (nothing here can stop it). */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(cancelledByBrowser());
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(cancelledByBrowser());
    signal.addEventListener('abort', stop, { once: true });
    p.then(
      (v) => { signal.removeEventListener('abort', stop); resolve(v); },
      (e) => { signal.removeEventListener('abort', stop); reject(e); },
    );
  });
}

/** Uploads a file already on disk to the Gemini Files API and waits until
 *  Google has processed it (videos take a while: ACTIVE is when it can be
 *  referenced by a role). Throws a classified failure otherwise.
 *
 *  Cancelling (`signal`, aborted when the browser hangs up): @google/genai
 *  2.10 files.upload IGNORES config.abortSignal — it never reaches the
 *  resumable-upload loop. So the upload is raced against the signal (the
 *  handler returns at once), the temp file is truncated (the SDK reads it
 *  chunk by chunk through an open handle, so the next 8 MB read comes up
 *  short and the transfer stops there), and whatever did reach Google is
 *  deleted best-effort. A file that FAILED processing, timed out or was
 *  otherwise abandoned is deleted too: nobody will ever get its URI. */
export async function uploadAndWait(
  apiKey: string,
  filePath: string,
  mimeType: string,
  displayName: string,
  signal?: AbortSignal,
): Promise<GeminiFile> {
  if (signal?.aborted) throw cancelledByBrowser();
  const ai = getClient(apiKey);
  const discard = (name: string | undefined) => {
    if (!name) return;
    ai.files.delete({ name, config: { httpOptions: { timeout: 30_000 } } }).catch(() => { /* best effort: Google expires it in ~48h anyway */ });
  };

  const upload = ai.files.upload({ file: filePath, config: { mimeType, displayName } });
  let file: GeminiFile;
  try {
    file = await untilAborted(upload, signal);
  } catch (err) {
    if (signal?.aborted) {
      fs.promises.truncate(filePath, 0).catch(() => { /* already gone */ });
      upload.then((f) => discard(f.name), () => { /* stopped short: nothing reached Google */ });
    }
    throw err;
  }

  try {
    const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
    while (file.state === FileState.PROCESSING) {
      if (Date.now() > deadline) {
        throw new GeminiFailure('upstream', 'Google is still processing the video after 5 minutes. Try again, or use a shorter clip.', 504);
      }
      await untilAborted(new Promise((r) => setTimeout(r, POLL_EVERY_MS)), signal);
      if (!file.name) break;
      file = await untilAborted(ai.files.get({ name: file.name, config: { httpOptions: { timeout: 30_000 } } }), signal);
    }
    if (file.state === FileState.FAILED) {
      const why = file.error?.message ? `: ${file.error.message}` : '';
      throw new GeminiFailure('bad_request', `Google could not process this file${why}. Try another format (MP4/MOV/WebM).`);
    }
    if (!file.uri) throw new GeminiFailure('upstream', 'Google accepted the upload but returned no file URI. Try again.');
    return file;
  } catch (err) {
    discard(file.name);
    throw err;
  }
}
