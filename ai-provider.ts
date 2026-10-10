/*
 * GEMINI 3.8 — the one AI provider behind /api/gemini/*.
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
  type Part,
  type File as GeminiFile,
} from '@google/genai';
import type { Request } from 'express';
import fs from 'fs';
import { GEMINI_MODEL_DEFAULT, GEMINI_KEY_HEADER, type AiErrorKind } from './src/ai/contract';

/* ── model ────────────────────────────────────────────────────── */

/* A function, not a const, and on purpose. server.ts loads .env.local/.env in
   its body, but ES imports are hoisted: this module is evaluated BEFORE that
   dotenv.config() call runs, so a top-level `const MODEL = process.env…`
   would never see a GEMINI_MODEL written in .env.local. Reading it on use
   always sees the loaded value. */
export function geminiModel(): string {
  return process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT;
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
export function classifyError(err: unknown): AiFailure {
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
      return failure('model_unavailable', `Model "${geminiModel()}" is not available for this key. Set GEMINI_MODEL in .env.local to a model your key can use.`);
    }
    if (code === 429) return failure('quota', quotaMessage(g));
    if (code === 413 || /payload|too large|exceeds the (maximum|limit)|request size/i.test(g.message)) {
      return failure('too_large', 'Too much media for one Gemini request. Use a shorter clip or fewer frames.');
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

/** True when Google refused the response SCHEMA itself (too many enum states,
 *  an unsupported keyword) rather than the media or the key — the one case
 *  worth a single retry with a looser schema. */
export function isSchemaRejection(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 400) return false;
  const g = readGoogleError(err);
  if (g.reasons.includes('API_KEY_INVALID')) return false;
  return /schema|too many states|constraint|enum/i.test(g.message);
}

/** When a role that HAS a loose schema should spend its one retry on it: a
 *  schema rejection (400), or a bare 500 INTERNAL — Google has been seen to
 *  answer an over-complex schema that way, and the same strict schema would
 *  fail again. Not 502/503/504: those are outages, not the schema. */
export function worthLooseRetry(err: unknown): boolean {
  return isSchemaRejection(err) || (err instanceof ApiError && err.status === 500);
}

/** Classify AND log, once. Every failing /api/gemini call goes through here,
 *  so a wrong key, a quota hit and a rejected model id each leave exactly one
 *  readable line in the server log — never the key, never a header. */
export function reportFailure(err: unknown): AiFailure {
  const f = classifyError(err);
  console.warn(`[gemini] ${f.kind}: ${f.message}`);
  return f;
}

/* ── calls ────────────────────────────────────────────────────── */

/** One models.get on the configured model: proves the key works AND the model
 *  is reachable with it, and spends no tokens. Throws on failure. */
export async function checkKey(apiKey: string): Promise<void> {
  await getClient(apiKey).models.get({ model: geminiModel(), config: { httpOptions: { timeout: 15_000 } } });
}

/* Generous: a whole music video plus model thinking is a long request, and
   this only bounds a hung connection. The SDK aborts the fetch on expiry. */
const GENERATE_TIMEOUT_MS = 240_000;

export interface GenerateJsonRequest {
  apiKey: string;
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
export async function generateJson<T>(req: GenerateJsonRequest): Promise<T> {
  const response = await getClient(req.apiKey).models.generateContent({
    model: geminiModel(),
    contents: [{ role: 'user', parts: req.parts }],
    config: {
      systemInstruction: req.systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: req.responseJsonSchema,
      ...(req.mediaResolution ? { mediaResolution: req.mediaResolution } : {}),
      ...(req.signal ? { abortSignal: req.signal } : {}),
      httpOptions: { timeout: GENERATE_TIMEOUT_MS },
    },
  });

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
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GeminiFailure('upstream', finish === 'MAX_TOKENS'
      ? 'Gemini’s answer was cut off before it finished. Try again.'
      : 'Gemini answered with malformed JSON. Try again.');
  }
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
