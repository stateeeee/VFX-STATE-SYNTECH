/*
 * CLIENT — the Gemini panel's only road to the server.
 *
 * Every /api/gemini/* call from the shell goes through here, so three rules
 * hold in one place:
 *
 *   1. The pasted key lives in localStorage (GEMINI_KEY_STORAGE, CLAUDE.md
 *      rule 7) and travels ONLY to our own server, in GEMINI_KEY_HEADER —
 *      never in a URL, never in a log line, never to Google from the browser.
 *      With no key stored the header is simply left off and the server falls
 *      back to its own GEMINI_API_KEY, if it has one.
 *   2. A failure is always an AiError {kind, message}: the server's
 *      AiErrorResponse when it answered, 'network' when it could not be
 *      reached. The panel maps the kind to its copy and never has to look at
 *      HTTP statuses.
 *   3. A whole source video is uploaded at most once per key and per file:
 *      the Files API keeps uploads ~48h, so the answer is cached
 *      (GEMINI_FILES_STORAGE) and reused until an hour before it expires.
 */

import {
  GEMINI_FILES_STORAGE,
  GEMINI_KEY_HEADER,
  GEMINI_KEY_STORAGE,
  type AiErrorKind,
  type AiErrorResponse,
  type KeyResponse,
  type UploadCacheEntry,
  type UploadResponse,
} from './contract';

/** Every failure the panel sees. `message` is the server's own wording when
 *  it answered (human-readable, safe to show), else a short local one. */
export class AiError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
  }
}

const AI_ERROR_KINDS: readonly AiErrorKind[] = [
  'no_key', 'invalid_key', 'model_unavailable', 'quota', 'too_large',
  'no_media', 'bad_request', 'upstream', 'network', 'server_error',
];
const isAiErrorKind = (v: unknown): v is AiErrorKind =>
  typeof v === 'string' && (AI_ERROR_KINDS as readonly string[]).includes(v);

/* ── the key ─────────────────────────────────────────────────── */

/* All three swallow storage errors: a private window or blocked site data
   must leave the panel locked, not crash the shell. */
export function getStoredKey(): string | null {
  try {
    const k = localStorage.getItem(GEMINI_KEY_STORAGE);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

export function storeKey(key: string): void {
  try { localStorage.setItem(GEMINI_KEY_STORAGE, key.trim()); } catch { /* private mode */ }
}

export function forgetKey(): void {
  try { localStorage.removeItem(GEMINI_KEY_STORAGE); } catch { /* private mode */ }
}

/**
 * A short, one-way tag for a key (first 12 hex of its SHA-256): it names the
 * key in the upload cache without storing the key a second time. SubtleCrypto
 * only exists in secure contexts (localhost / https); opened over a LAN
 * address the page falls back to FNV-1a, which is plenty for a cache tag.
 */
export async function keyFingerprint(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
    }
  } catch { /* fall through to the plain hash */ }
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}

/** A key is printable ASCII, no spaces. Anything else (a curly quote or a
 *  non-breaking space picked up when copying from chat or a doc) cannot even
 *  travel in an HTTP header: fetch throws, and the panel would wrongly say
 *  the server is unreachable. */
export const KEY_CHARS = /^[\x21-\x7e]+$/;
export const isKeyText = (key: string): boolean => KEY_CHARS.test(key);

/* ── requests ────────────────────────────────────────────────── */

/** Headers for one call. `key` undefined = whatever is stored; null = none
 *  (ask the server to use its own key). */
function withKey(headers: Record<string, string>, key?: string | null): Record<string, string> {
  const k = key === undefined ? getStoredKey() : key;
  return k ? { ...headers, [GEMINI_KEY_HEADER]: k } : headers;
}

/** Reads a non-2xx answer into an AiError. The server always speaks
 *  AiErrorResponse; anything else (a proxy page, a crash) is classified by
 *  its status so the panel still gets a kind it knows. */
async function failureOf(res: Response): Promise<AiError> {
  let body: Partial<AiErrorResponse> | null = null;
  try { body = (await res.json()) as Partial<AiErrorResponse>; } catch { /* not JSON */ }
  if (body && isAiErrorKind(body.error)) {
    return new AiError(body.error, typeof body.message === 'string' && body.message ? body.message : body.error);
  }
  const kind: AiErrorKind = res.status === 413 ? 'too_large'
    : res.status === 429 ? 'quota'
      : res.status >= 500 ? 'server_error'
        : 'bad_request';
  return new AiError(kind, `Server answered ${res.status}`);
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new AiError('network', 'Server not reachable');
  }
  if (!res.ok) throw await failureOf(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new AiError('server_error', 'The server sent an unreadable answer');
  }
}

/** GET an /api/gemini endpoint (the stored key rides along when there is one). */
export function aiGet<T>(path: string, opts: { signal?: AbortSignal } = {}): Promise<T> {
  return send<T>(path, { method: 'GET', headers: withKey({ Accept: 'application/json' }), signal: opts.signal });
}

/** POST JSON to an /api/gemini endpoint, adding the stored key's header. */
export function aiPost<T>(path: string, body?: unknown, opts: { signal?: AbortSignal; key?: string | null } = {}): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    headers: withKey({ 'Content-Type': 'application/json', Accept: 'application/json' }, opts.key),
    body: JSON.stringify(body ?? {}),
    signal: opts.signal,
  });
}

/**
 * One models.get on the server, no tokens spent. `key` undefined validates
 * the stored key; a string validates THAT key without storing it (the shell
 * stores it only once Google said yes); null validates the server's own key.
 * "This key does not work" comes back as {active:false}, not as a throw —
 * only a server that cannot be reached throws.
 */
export function validateKey(key?: string | null): Promise<KeyResponse> {
  return aiPost<KeyResponse>('/api/gemini/key', {}, { key });
}

/* ── upload, with the GEMINI_FILES_STORAGE cache ─────────────── */

/** a cached upload is dropped this long before Google deletes the file */
const EXPIRY_MARGIN_MS = 60 * 60 * 1000;
/** when Google did not say, assume its documented ~48h retention */
const DEFAULT_LIFETIME_MS = 48 * 60 * 60 * 1000;

type UploadCache = Record<string, UploadCacheEntry>;

const usableUntil = (e: UploadCacheEntry): number => {
  const end = e.expiresAt ? Date.parse(e.expiresAt) : Date.parse(e.cachedAt) + DEFAULT_LIFETIME_MS;
  return Number.isFinite(end) ? end - EXPIRY_MARGIN_MS : 0;
};

function readCache(): UploadCache {
  try {
    const raw = JSON.parse(localStorage.getItem(GEMINI_FILES_STORAGE) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as UploadCache) : {};
  } catch {
    return {};
  }
}

/** writes the cache back, pruning everything that has expired meanwhile */
function writeCache(cache: UploadCache): void {
  const now = Date.now();
  const kept: UploadCache = {};
  for (const [k, e] of Object.entries(cache)) {
    if (e && typeof e.fileUri === 'string' && usableUntil(e) > now) kept[k] = e;
  }
  try { localStorage.setItem(GEMINI_FILES_STORAGE, JSON.stringify(kept)); } catch { /* private mode / full */ }
}

export interface UploadMeta { name: string; size: number; lastModified: number; mime: string }

/* Gemini's documented video types are mp4, mpeg, mov, avi, x-flv, mpg, webm,
   wmv and 3gpp. Browsers (and File.type) name some of the same containers
   differently, and the Files API takes any type at upload only to refuse it
   at generate time — so the type is put right BEFORE the upload. Matroska is
   not on the list at all: an .mkv source is read as sampled frames instead. */
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  webm: 'video/webm', mov: 'video/quicktime', qt: 'video/quicktime', avi: 'video/avi',
  m4v: 'video/mp4', mp4: 'video/mp4', mpg: 'video/mpg', mpeg: 'video/mpeg', '3gp': 'video/3gpp',
  wmv: 'video/wmv', flv: 'video/x-flv',
};
const VIDEO_MIME_ALIASES: Record<string, string> = {
  'video/x-msvideo': 'video/avi', 'video/msvideo': 'video/avi', 'video/vnd.avi': 'video/avi',
  'video/x-ms-wmv': 'video/wmv', 'video/x-m4v': 'video/mp4',
};
const isMatroska = (name: string, mime: string): boolean =>
  /\.mkv$/i.test(name) || /^video\/(x-)?matroska$/i.test(mime);

/**
 * The type a source video is uploaded as, or null when Gemini cannot take
 * the container whole (Matroska): the caller then samples frames. An empty
 * File.type (some platforms, some containers) is guessed from the name.
 */
export function uploadVideoMime(name: string, mime: string): string | null {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  if (isMatroska(name, m)) return null;
  if (m) return VIDEO_MIME_ALIASES[m] ?? m;
  return VIDEO_MIME_BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'video/mp4';
}

/** the cache key: which key uploaded it (a file belongs to the key's
 *  project — another key cannot read it) and which file it was */
async function cacheKeyOf(meta: UploadMeta): Promise<string> {
  const k = getStoredKey();
  const fp = k ? await keyFingerprint(k) : 'server';
  return `${fp}|${meta.name}|${meta.size}|${meta.lastModified}`;
}

/**
 * Drops every cached upload pointing at `fileUri`. Google can delete a file
 * before our expiry estimate (or the key changed projects): the server then
 * answers bad_request "no longer available on Google", and the next run must
 * upload again instead of re-sending the dead URI.
 */
export function forgetUpload(fileUri: string): void {
  const cache = readCache();
  let changed = false;
  for (const [k, e] of Object.entries(cache)) {
    if (e?.fileUri === fileUri) { delete cache[k]; changed = true; }
  }
  if (changed) writeCache(cache);
}

/** True for the server's "that uploaded file is gone" refusal (ai-provider.ts
 *  maps Google's 403 on a file to bad_request with this wording). */
export const isExpiredUpload = (e: unknown): boolean =>
  e instanceof AiError && e.kind === 'bad_request' && /no longer available/i.test(e.message);

/** True when a cached upload must never be sent again: Google deleted it, or
 *  it refuses to read its type ("Unsupported MIME type …"). Either way the
 *  caller forgets it, so the next run uploads again (or samples frames)
 *  instead of re-sending a URI that fails the same way until it expires. */
export const isUnusableUpload = (e: unknown): boolean =>
  isExpiredUpload(e) || (e instanceof AiError && e.kind === 'bad_request' && /unsupported|mime/i.test(e.message));

/** An upload already made for this exact file and key, still usable — or null. */
export async function cachedUpload(meta: UploadMeta): Promise<UploadResponse | null> {
  const hit = readCache()[await cacheKeyOf(meta)];
  return hit && usableUntil(hit) > Date.now() ? hit : null;
}

/**
 * Sends a whole source file to Gemini's Files API through our server (raw
 * body, no base64) and resolves once Google has finished processing it.
 * `onProgress` hears 'cached' (nothing sent), 'uploading', then 'done'.
 */
export async function uploadSource(
  blob: Blob,
  meta: UploadMeta,
  onProgress?: (stage: 'cached' | 'uploading' | 'done') => void,
): Promise<UploadResponse> {
  const ck = await cacheKeyOf(meta);
  const cache = readCache();
  const hit = cache[ck];
  if (hit && usableUntil(hit) > Date.now()) {
    onProgress?.('cached');
    return hit;
  }
  onProgress?.('uploading');
  // the File itself is the body: the browser streams it from disk, no copy
  const mime = uploadVideoMime(meta.name, meta.mime || blob.type) ?? (meta.mime || blob.type || 'application/octet-stream');
  const res = await send<UploadResponse>('/api/gemini/upload', {
    method: 'POST',
    headers: withKey({
      'Content-Type': mime,
      'x-file-name': encodeURIComponent(meta.name || 'source'),
      Accept: 'application/json',
    }),
    body: blob,
  });
  writeCache({ ...readCache(), [ck]: { ...res, cachedAt: new Date().toISOString() } });
  onProgress?.('done');
  return res;
}
