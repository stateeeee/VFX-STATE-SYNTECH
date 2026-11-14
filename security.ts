/*
 * SYNTECH-SECURITY — the server's hardening, in one place (server.ts wires it).
 *
 *   IS_BUILT        a bundle made by `npm run build` / `desktop:bundle` is ALWAYS
 *                   production, whatever NODE_ENV says (esbuild --define)
 *   headers         X-Content-Type-Options, Referrer-Policy, framing, COOP/CORP,
 *                   Permissions-Policy on every response; HSTS on HTTPS only;
 *                   the Content-Security-Policy when a built dist/ is served
 *   clientId        who a request counts against (socket address; req.ip only
 *                   when TRUST_PROXY says how many proxies to believe)
 *   crossSiteGuard  /api refuses a browser request made by another site
 *   RateLimiter     fixed one-minute window per client, bounded memory
 *   Slots           in-flight caps (global + per client), released on close
 *   ByteBudget      the bytes of role bodies in flight, summed, capped
 *   guardBody       a request body that stalls or trickles is cut (408)
 *   keyPlausible    a header key that cannot be a Gemini key never reaches Google
 *   limitedWarn     a log line any client can trigger is rate-limited
 *   envPositiveInt  a numeric setting from the environment, garbage refused
 *
 * No dependency: everything here is hand-written and in memory. Limits are per
 * server process (one process = one bucket), which is what a single-instance
 * deploy and the desktop app are. Real per-user quotas need accounts.
 */
import type { Express, NextFunction, Request, Response } from 'express';
import type { AiErrorKind } from './src/ai/contract';

/* ── built or dev ─────────────────────────────────────────────── */

/* `npm run build` and `npm run desktop:bundle` pass --define:__SYNTECH_BUILT__=true
   (a bare boolean: no quoting, so it survives Windows cmd.exe on CI). Under
   `tsx server.ts` nothing defines it and `typeof` is "undefined" (no
   ReferenceError). A built server never imports Vite and never serves the
   project tree, and never lends out the server's own GEMINI_API_KEY unless it
   runs inside the desktop app. */
declare const __SYNTECH_BUILT__: boolean | undefined;
export const IS_BUILT: boolean = typeof __SYNTECH_BUILT__ !== 'undefined' && __SYNTECH_BUILT__ === true;

/* ── refusals in the AiErrorResponse shape ────────────────────── */

export interface RefuseOptions {
  /** seconds, for 429 */
  retryAfter?: number;
  /** drop the connection after answering: the body was not read */
  close?: boolean;
}

export function refuse(res: Response, status: number, kind: AiErrorKind, message: string, opts: RefuseOptions = {}): void {
  if (res.headersSent) return;
  if (opts.retryAfter !== undefined) res.set('Retry-After', String(Math.max(1, Math.ceil(opts.retryAfter))));
  if (opts.close) res.set('Connection', 'close');
  res.status(status).json({ error: kind, message });
}

/* ── security headers ─────────────────────────────────────────── */

/* The CSP of the built app (standalone + desktop). Not in Vite dev: its HMR
   client and on-the-fly modules would fight it. Every directive is what the
   ten effects and the shell really need, proven in Chromium with zero
   violations (build-server report):
     script-src 'unsafe-inline'      the effects are single HTML files with
                                     inline <script> and <script type=importmap>
     script-src 'wasm-unsafe-eval'   MediaPipe (tasks-vision + selfie_segmentation)
                                     compiles its vendored .wasm
     blob: (script/worker/media/img) MediaPipe workers, recorded clips, frames
     data: (img/media/font/connect)  inline icons, generated audio, fonts
     frame-src 'self' blob:          the effect iframes (shell, Lab)
   Nothing is ever loaded from another origin: every library is vendored. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/* What the app uses (grep of src/ and public/effects): the webcam, the mic,
   fullscreen, autoplaying the source video. Everything else powerful is off,
   for this page and every frame in it. */
export const PERMISSIONS_POLICY = [
  'camera=(self)',
  'microphone=(self)',
  'fullscreen=(self)',
  'autoplay=(self)',
  'display-capture=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'hid=()',
  'midi=()',
  'accelerometer=()',
  'gyroscope=()',
  'magnetometer=()',
  'xr-spatial-tracking=()',
  'screen-wake-lock=()',
  'idle-detection=()',
  'browsing-topics=()',
].join(', ');

/** Every response, every mode. `csp()` says whether this server serves a built
 *  dist/ (decided in startServer, before the first request). */
export function securityHeaders(csp: () => boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': PERMISSIONS_POLICY,
    });
    if (csp()) res.set('Content-Security-Policy', CSP);
    /* req.secure is true only on a direct TLS socket, or behind a TLS proxy
       that TRUST_PROXY lets us believe (X-Forwarded-Proto). Never on http://. */
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  };
}

/* ── client identity ──────────────────────────────────────────── */

let proxyHops = 0;

/** TRUST_PROXY = a number of proxy hops ("1", "2"; at most 10), or a word
 *  meaning yes ("true", "yes", "on") = 1 hop. Unset / empty / 0 / false / no /
 *  off: the socket address is the client. ANYTHING ELSE ("-1", "2.5", a typo)
 *  is off too, with one warning — a typo must never fail open (with trust on,
 *  a client picks its own bucket by writing X-Forwarded-For). Returns what was
 *  set, for the boot log. It only changes who limits count against and
 *  req.secure: the server key never looks at req.ip. */
export function configureTrustProxy(app: Express): number {
  const raw = (process.env.TRUST_PROXY || '').trim().toLowerCase();
  let hops = 0;
  if (!raw || ['false', 'no', 'off'].includes(raw)) hops = 0;
  else if (['true', 'yes', 'on'].includes(raw)) hops = 1;
  else if (/^\d{1,6}$/.test(raw)) hops = Math.min(Number(raw), 10);
  else {
    console.warn(`[proxy] TRUST_PROXY="${shownValue(raw)}" is not a number of proxy hops (0, 1, 2…) or true/false: IGNORED, no proxy is trusted.`);
    hops = 0;
  }
  proxyHops = hops;
  if (hops) app.set('trust proxy', hops);
  return hops;
}

/** An operator's setting, quoted in a log line: printable, short. */
function shownValue(raw: string): string {
  return raw.replace(/[^\x20-\x7e]/g, '?').replace(/"/g, "'").slice(0, 40);
}

/** A positive whole number from the environment, or `def`. Unset / empty →
 *  `def` silently; anything else that is not 1…max → `def` and one warning. */
export function envPositiveInt(name: string, def: number, max = 100_000): number {
  const raw = (process.env[name] || '').trim();
  if (!raw) return def;
  if (/^\d{1,9}$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= max) return n;
  }
  console.warn(`[limits] ${name}="${shownValue(raw)}" is not a whole number from 1 to ${max}: using the default, ${def}.`);
  return def;
}

export const trustedProxyHops = (): number => proxyHops;

/** "1:2:3:4:5:6:7:8" → 8 groups of 4 hex digits; null when not IPv6. */
function expandIPv6(addr: string): string[] | null {
  const a = addr.split('%')[0].toLowerCase();
  if (!a.includes(':')) return null;
  const [head, tail] = a.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  if (a.includes('::')) {
    const fill = 8 - h.length - t.length;
    if (fill < 0) return null;
    return [...h, ...Array(fill).fill('0'), ...t].map((g) => g.padStart(4, '0'));
  }
  return h.length === 8 ? h.map((g) => g.padStart(4, '0')) : null;
}

/** The bucket a request counts against: an IPv4 address, or an IPv6 /64 (one
 *  subscriber line holds a whole /64; counting single v6 addresses would let
 *  one machine rotate through millions of them). */
export function clientId(req: Request): string {
  const raw = (proxyHops ? req.ip : req.socket?.remoteAddress) || 'unknown';
  const v4 = raw.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  const g = expandIPv6(raw);
  return g ? `${g.slice(0, 4).join(':')}::/64` : raw.slice(0, 64);
}

/* ── cross-site guard (/api) ──────────────────────────────────── */

/** The names this request may legitimately come from: its Host, and behind a
 *  trusted proxy the X-Forwarded-Host it says the browser used. */
function ownHosts(req: Request): string[] {
  const out = [(req.headers.host || '').trim().toLowerCase()];
  if (proxyHops) {
    const fwd = req.get('x-forwarded-host');
    if (fwd) out.push(fwd.split(',')[0].trim().toLowerCase());
  }
  return out.filter(Boolean);
}

function sameOrigin(origin: string, req: Request): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false; // "null" (sandboxed frame, file://) or garbage
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const defaultPort = u.protocol === 'https:' ? ':443' : ':80';
  const want = u.host.toLowerCase(); // URL drops the default port
  return ownHosts(req).some((h) => (h.endsWith(defaultPort) ? h.slice(0, -defaultPort.length) : h) === want);
}

/* What to do when the app's OWN page is refused: behind a reverse proxy the
   Host this server sees is the proxy's upstream name (nginx's default
   proxy_pass sends Host: 127.0.0.1:3000), so the browser's Origin
   (https://app.example.com) cannot match it. */
const PROXY_HINT = 'If this is the app\'s own page behind a reverse proxy, the proxy must pass the browser\'s host on (nginx: proxy_set_header Host $host;), or set TRUST_PROXY and have the proxy send X-Forwarded-Host.';

/** One log line per refused Origin host (up to 20), like the Host guard's:
 *  the operator behind a misconfigured proxy sees in the terminal why the
 *  panel is locked. Never more than 20 lines, whatever clients send. */
const refusedOrigins = new Set<string>();
const sanitizeHost = (h: string) => h.toLowerCase().replace(/[^a-z0-9.:_\-[\]]/g, '').slice(0, 100);

function logRefusedOrigin(origin: string, req: Request): void {
  let shown: string;
  try {
    shown = sanitizeHost(new URL(origin).host) || sanitizeHost(origin);
  } catch {
    shown = sanitizeHost(origin); // "null" (sandboxed frame, file://) or garbage
  }
  if (!shown || refusedOrigins.size >= 20 || refusedOrigins.has(shown)) return;
  refusedOrigins.add(shown);
  const host = sanitizeHost(req.headers.host || '') || '(none)';
  console.warn(`[origin] refused /api from a page on "${shown}" (this server was reached as "${host}"). ${PROXY_HINT}`);
}

/** A browser request made by ANOTHER site (Sec-Fetch-Site: cross-site, or an
 *  Origin that is not this server's) is refused before any work. The panel is
 *  same-origin; curl and other non-browser clients send no Origin. */
export function crossSiteGuard(req: Request, res: Response, next: NextFunction): void {
  const site = (req.get('sec-fetch-site') || '').toLowerCase();
  const origin = req.get('origin');
  const foreignOrigin = origin !== undefined && !sameOrigin(origin, req);
  if (site === 'cross-site' || foreignOrigin) {
    if (foreignOrigin) logRefusedOrigin(origin as string, req);
    refuse(res, 403, 'bad_request', `Cross-site request refused: this API answers only the app's own pages. ${PROXY_HINT}`, { close: true });
    return;
  }
  next();
}

/* ── rate limit ───────────────────────────────────────────────── */

/** Fixed one-minute window per client. The map is capped: when full, the
 *  oldest window goes — O(1): a Map iterates in insertion order and a renewed
 *  window is re-inserted at the end, so the first key is the oldest start
 *  (expired windows are the oldest of all; with 10 000 live clients the
 *  oldest one simply starts afresh).
 *
 *  Two honest limits of bucketing by address (clientId): everyone behind one
 *  IPv4 NAT (an office, a café, a mobile carrier's CGNAT) shares ONE bucket —
 *  one upload, two Gemini calls, 30 POSTs a minute between them; and an IPv6
 *  home line delegated a /56 owns 256 /64 buckets. Real per-user limits need
 *  accounts. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  constructor(readonly limit: number, readonly windowMs = 60_000, readonly maxClients = 10_000) {}

  /** null = allowed; otherwise the seconds until this client's window resets. */
  hit(id: string, now = Date.now()): number | null {
    let w = this.windows.get(id);
    if (!w || now - w.start >= this.windowMs) {
      if (w) this.windows.delete(id);
      else if (this.windows.size >= this.maxClients) this.evict();
      w = { start: now, count: 0 };
      this.windows.set(id, w);
    }
    w.count++;
    return w.count > this.limit ? (w.start + this.windowMs - now) / 1000 : null;
  }

  private evict(): void {
    const oldest = this.windows.keys().next();
    if (!oldest.done) this.windows.delete(oldest.value);
  }

  get size(): number { return this.windows.size; }
}

/* ── in-flight caps ───────────────────────────────────────────── */

export class Slots {
  inFlight = 0;
  private readonly byClient = new Map<string, number>();
  constructor(readonly name: string, readonly global: number, readonly perClient: number) {}

  /** A release function (idempotent), or why not: 'global' | 'client'. */
  acquire(id: string): (() => void) | 'global' | 'client' {
    if (this.inFlight >= this.global) return 'global';
    const mine = this.byClient.get(id) ?? 0;
    if (mine >= this.perClient) return 'client';
    this.inFlight++;
    this.byClient.set(id, mine + 1);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.inFlight--;
      const left = (this.byClient.get(id) ?? 1) - 1;
      if (left > 0) this.byClient.set(id, left);
      else this.byClient.delete(id);
    };
  }

  get clients(): number { return this.byClient.size; }
}

/** The bytes of request bodies in flight, summed and capped, so memory stays
 *  bounded whatever the count. A request is admitted while the sum stays
 *  within the budget — or when nothing else is in flight at all (a budget set
 *  below one body's size then still serves one request at a time). */
export class ByteBudget {
  used = 0;
  constructor(readonly name: string, readonly budget: number) {}

  /** A release function (idempotent), or null when over budget. */
  acquire(bytes: number): (() => void) | null {
    if (this.used > 0 && this.used + bytes > this.budget) return null;
    this.used += bytes;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.used -= bytes;
    };
  }
}

export interface SlotBudget {
  bytes: ByteBudget;
  /** What this request costs against the budget (decided from its headers). */
  cost: (req: Request) => number;
}

/** Takes a slot (and, with `budget`, its bytes) for this request or answers
 *  429 (body unread, connection closed). Both are released when the response
 *  finishes or the connection closes, whichever comes first — every path,
 *  once. */
export function holdSlot(slots: Slots, busyMessage: string, budget?: SlotBudget) {
  const busy = `${busyMessage} The server is busy with other requests right now: try again in a few seconds.`;
  return (req: Request, res: Response, next: NextFunction): void => {
    const got = slots.acquire(clientId(req));
    if (typeof got !== 'function') {
      const msg = got === 'client'
        ? `${busyMessage} This browser already has ${slots.perClient === 1 ? 'one' : slots.perClient} running: wait for ${slots.perClient === 1 ? 'it' : 'them'} to finish.`
        : busy;
      refuse(res, 429, 'quota', msg, { retryAfter: got === 'client' ? 10 : 15, close: true });
      return;
    }
    let bytes: (() => void) | null = null;
    if (budget) {
      bytes = budget.bytes.acquire(budget.cost(req));
      if (!bytes) {
        got();
        refuse(res, 429, 'quota', busy, { retryAfter: 15, close: true });
        return;
      }
    }
    const release = () => { got(); bytes?.(); };
    res.once('finish', release);
    res.once('close', release);
    next();
  };
}

/* ── request bodies that stall ────────────────────────────────── */

export interface BodyGuard {
  /** no byte for this long → cut */
  idleMs: number;
  /** the whole body must have arrived by then, counted from the request's
   *  arrival (0 = no total limit) */
  totalMs: number;
  /** after `graceMs` of reading, the body must average at least this many
   *  bytes/s since its reading started */
  minBytesPerSec?: number;
  graceMs?: number;
}

export interface GuardOptions {
  /** Answer the cut with a 408 here (when nothing was answered yet). ONLY on
   *  a route where everything that may write afterwards checks
   *  res.headersSent first — Express's own 404 (finalhandler) waits for the
   *  body to end and then writes unconditionally: it would throw. */
  res?: Response;
  /** The route reads the body only after its checks (a key proven with
   *  Google, a slot): until bodyFlowing(req) is called the idle and speed
   *  rules wait — the body is deliberately left unread — and only this cap
   *  applies (the checks must be done by then). */
  deferredMs?: number;
}

/** The body guards that wait for bodyFlowing(), per request. */
const flowStarters = new WeakMap<Request, () => void>();

/** The route is about to read the body: start its idle and speed clocks. */
export function bodyFlowing(req: Request): void {
  flowStarters.get(req)?.();
}

/* Node's own requestTimeout (300 s by default) is turned off in startServer:
   it would cut a legitimate 300 MB upload over a slow home uplink. This takes
   its place, per request: it watches the socket's byte counter (which only
   moves while somebody consumes the body), so a body that stops arriving, or
   trickles to hold a slot, loses its connection — with a 408 in the
   AiErrorResponse shape when nothing was answered yet. Headers are bounded by
   server.headersTimeout. Checked once a second, only while the body is
   incomplete. */
export function guardBody(req: Request, g: BodyGuard, opts: GuardOptions = {}): void {
  if (req.complete) return;
  const sock = req.socket;
  const arrived = Date.now();
  let flowing = !opts.deferredMs;
  let flowStart = arrived;
  const base = sock.bytesRead;
  let last = base;
  let lastMove = arrived;
  if (!flowing) {
    flowStarters.set(req, () => {
      if (flowing) return;
      flowing = true;
      flowStart = Date.now();
      /* bytes Node buffered while the checks ran (≤ one highWaterMark) count
         for the client, the time it waited does not */
      lastMove = flowStart;
      last = sock.bytesRead;
    });
  }
  const tick = setInterval(() => {
    if (req.complete || sock.destroyed) return stop();
    const now = Date.now();
    const read = sock.bytesRead;
    const age = now - arrived;
    let why: string | null = null;
    if (!flowing) {
      if (age >= (opts.deferredMs as number)) why = `checks not done after ${Math.round(age / 1000)} s`;
    } else {
      if (read !== last) { last = read; lastMove = now; }
      const reading = now - flowStart;
      if (now - lastMove >= g.idleMs) why = `no data for ${Math.round((now - lastMove) / 1000)} s`;
      else if (g.totalMs && age >= g.totalMs) why = `body not complete after ${Math.round(age / 1000)} s`;
      else if (g.minBytesPerSec && reading >= (g.graceMs ?? 0) && (read - base) < (g.minBytesPerSec * reading) / 1000) {
        why = `body arriving at ${Math.round((read - base) / Math.max(1, reading / 1000))} B/s, under ${g.minBytesPerSec} B/s`;
      }
    }
    if (why) cut(why);
  }, 1000);
  tick.unref();
  function stop() { clearInterval(tick); flowStarters.delete(req); }
  function cut(why: string) {
    stop();
    limitedWarn('limits:cut', `[limits] ${req.method} ${req.path.replace(/[^\x21-\x7e]/g, '?').slice(0, 80)}: connection cut (${why})`);
    /* The REQUEST is destroyed too, not only the socket: once a response has
       finished, Node no longer ties the request to its socket, so a socket
       closed after the 408 would leave whoever reads the body (the upload's
       temp file, the JSON parser) waiting forever. req.destroy() makes them
       see 'aborted' / 'close' and clean up (temp dir removed, fd closed). */
    const kill = () => { req.destroy(); sock.destroy(); };
    const res = opts.res;
    if (res && !res.headersSent && !res.writableEnded) {
      res.once('finish', kill);
      setTimeout(kill, 2_000).unref();
      refuse(res, 408, 'bad_request', 'The request body arrived too slowly, or stopped arriving: the connection was cut. Check the network and try again.', { close: true });
    } else {
      kill();
    }
  }
  req.once('end', stop);
  req.once('close', stop);
}

/* ── log lines a client can trigger ───────────────────────────── */

interface WarnWindow { start: number; shown: number; suppressed: number; flush: boolean }
const warnWindows = new Map<string, WarnWindow>();

/** console.warn, at most `burst` lines per `windowMs` per tag; the rest are
 *  counted and summed up in one line when the window closes. For every line
 *  an anonymous client can cause at will (a cut body, a failing request):
 *  nobody can flood the log. `tag` must be one of a FIXED set of strings
 *  (never client input), which keeps this map bounded. */
export function limitedWarn(tag: string, line: string, burst = 1, windowMs = 10_000): void {
  const now = Date.now();
  let w = warnWindows.get(tag);
  if (!w || now - w.start >= windowMs) {
    w = { start: now, shown: 0, suppressed: 0, flush: false };
    warnWindows.set(tag, w);
  }
  if (w.shown < burst) {
    w.shown++;
    console.warn(line);
    return;
  }
  w.suppressed++;
  if (!w.flush) {
    w.flush = true;
    const win = w;
    setTimeout(() => {
      console.warn(`[log] ${win.suppressed} more "${tag}" line${win.suppressed === 1 ? '' : 's'} suppressed in ${Math.round(windowMs / 1000)} s`);
    }, Math.max(0, win.start + windowMs - now)).unref();
  }
}

/* ── header keys ──────────────────────────────────────────────── */

/* A Gemini API key, every format Google has issued that we know of: the classic
   "AIza" + 35 characters (39), and the newer, longer ones made of letters,
   digits, "_", "-" and ".". Anything else cannot be a key: it is refused
   before the body is read and never sent to Google. `minLength` is lowered
   only while the loopback GEMINI_BASE_URL test hook is active (the verify
   suites' mock keys, 'MOCKKEY' / 'BADKEY', are 6–7 characters). */
const KEY_RE = /^[A-Za-z0-9_.\-]+$/;
export function keyPlausible(key: string, minLength = 20): boolean {
  return key.length >= minLength && key.length <= 256 && KEY_RE.test(key);
}
