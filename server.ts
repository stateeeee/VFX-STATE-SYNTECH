import express, { type NextFunction, type Request, type Response } from "express";
import http from "http";
import path from "path";
import os from "os";
import fs from "fs";
import net from "net";
import dotenv from "dotenv";

/* .env.local first (the operator's own, git-ignored), then .env. The first
   file to define a variable wins; neither is required.
   SYNTECH-SECURITY (DSK-07): NOT inside the desktop app. Its main process has
   already loaded the one .env that belongs to it (the app's userData folder)
   before importing this module; a .env in whatever folder the app happened to
   be launched from must not configure it. (This line runs after every import
   below — ES imports are hoisted — which is why nothing reads process.env at
   import time: see geminiModel() in ai-provider.ts.) */
if (!process.env.SYNTECH_DESKTOP) dotenv.config({ path: [".env.local", ".env"], quiet: true });

/* GEMINI 3.8 — six endpoints under /api/gemini, all speaking the wire format of
   src/ai/contract.ts:

     GET  /status        is there a server key, which model          (no key needed)
     POST /key           validate the pasted key (one models.get)    → KeyResponse
     POST /upload        a whole source video → Gemini Files API     → UploadResponse
     POST /art-director  watch the source, propose effect chains     → ArtDirectorResult
     POST /agent         set the Lab chain's effect controls        → AgentResult
     POST /optimizer     judge the Lab's OUTPUT, propose fixes       → OptimizerResult

   Every failure is an AiErrorResponse {error, message} with a 4xx/5xx status.
   Only Host names that cannot be rebound by a web page (localhost, an IP
   literal, a *.local mDNS name) or that ALLOWED_HOSTS lists reach /api — see
   hostAllowed. The server's own GEMINI_API_KEY is used only by a browser on
   this machine, opened at localhost and not relayed by a proxy or a tunnel
   (ai-provider.ts resolveKey).
   There are no offline answers any more: without a key the panel simply stays
   locked, and nothing that is not AI ever needs one. The prompts, schemas and
   validators live in ai-roles.ts; the Gemini client, key handling and error
   classification in ai-provider.ts. */
import {
  admitKey,
  checkKey,
  failure,
  forgetKey,
  generateJson,
  geminiModel,
  GeminiFailure,
  headerKey,
  hostnameOf,
  looseRetryReason,
  reportFailure,
  resolveKey,
  serverKeyAvailable,
  serverKeyPolicy,
  testHookBaseUrl,
  uploadAndWait,
  validateKey,
  type AiFailure,
} from "./ai-provider";
import { agentJob, artDirectorJob, optimizerJob, type RoleJob } from "./ai-roles";
import { GEMINI_KEY_HEADER, type KeyResponse, type StatusResponse, type UploadResponse } from "./src/ai/contract";
import {
  bodyFlowing,
  ByteBudget,
  configureTrustProxy,
  crossSiteGuard,
  envPositiveInt,
  guardBody,
  holdSlot,
  IS_BUILT,
  keyPlausible,
  limitedWarn,
  RateLimiter,
  refuse,
  securityHeaders,
  Slots,
  clientId,
  type BodyGuard,
} from "./security";

const app = express();

/* ── SYNTECH-SECURITY: headers, proxies, slow bodies (security.ts) ── */

/* No "X-Powered-By: Express". Every response — page, effect, API, 404 — gets
   the security headers; the CSP only once startServer has chosen to serve a
   built dist/ (Vite dev would fight it). */
app.disable("x-powered-by");
let serveCsp = false;
app.use(securityHeaders(() => serveCsp));
const TRUST_PROXY_HOPS = configureTrustProxy(app);

/* Node's requestTimeout is off (startServer): these take its place (a cut
   answers 408 and closes). An upload may take long over a slow uplink, but it
   must keep moving: 60 s without a byte, or under 48 KB/s on average once it
   has been read for 30 s, cuts it (2 h at most). A role call's JSON (a few MB
   from the panel) must keep 32 KB/s once read for 10 s, never stall for 30 s
   and be complete within 5 min. On those routes the body is read only after
   the key is proven and a slot is held (keyProof, holdSlot): until then it is
   left unread and only BODY_CHECKS_MS applies. Any other body (/key, a stray
   POST) must arrive within 5 min and never stall for 30 s. */
const UPLOAD_BODY: BodyGuard = { idleMs: 60_000, totalMs: 2 * 60 * 60_000, minBytesPerSec: 48 * 1024, graceMs: 30_000 };
const ROLE_BODY: BodyGuard = { idleMs: 30_000, totalMs: 5 * 60_000, minBytesPerSec: 32 * 1024, graceMs: 10_000 };
const OTHER_BODY: BodyGuard = { idleMs: 30_000, totalMs: 5 * 60_000 };
/* The checks before the body (the key's one models.get has a 15 s timeout)
   must be done by then. */
const BODY_CHECKS_MS = 45_000;
const ROLE_PATHS = new Set(["/api/gemini/art-director", "/api/gemini/agent", "/api/gemini/optimizer"]);
const UPLOAD_PATH = "/api/gemini/upload";
/* Express routes case-insensitively and with or without a trailing slash:
   classify the same way, so /API/GEMINI/UPLOAD/ gets the upload's rules. */
const routeOf = (req: Request) => req.path.toLowerCase().replace(/\/+$/, "");
/* The 408 is answered only on the API routes whose every step checks
   res.headersSent before writing. Anywhere else the connection is just cut:
   Express's own 404 (finalhandler) waits for the body to end and then writes
   unconditionally — a 408 sent before it would make it throw and take the
   whole server down. */
app.use((req, res, next) => {
  if (!req.complete) {
    const route = routeOf(req);
    if (route === UPLOAD_PATH) guardBody(req, UPLOAD_BODY, { res, deferredMs: BODY_CHECKS_MS });
    else if (ROLE_PATHS.has(route)) guardBody(req, ROLE_BODY, { res, deferredMs: BODY_CHECKS_MS });
    else guardBody(req, OTHER_BODY, route === "/api/gemini/key" ? { res } : {});
  }
  next();
});

/* PORT from the environment (default 3000), so a second server — a test run,
   a parallel session — can live next to the operator's own. */
const PORT = (() => {
  const n = Number(process.env.PORT);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3000;
})();

const NO_KEY_MESSAGE = "No Gemini key: paste one in the Gemini 3.8 panel (free at https://aistudio.google.com/apikey).";

function sendFailure(res: Response, f: AiFailure) {
  if (res.headersSent) return;
  res.status(f.status).json({ error: f.kind, message: f.message });
}

/* DNS-rebinding guard. A web page on some evil.example can re-point its own
   name at 127.0.0.1 and then call this API "same-origin" — but its requests
   still carry Host: evil.example. /api is mounted before Vite (and in a
   production build nothing else checks the Host at all), so it gets its own
   check. Allowed:
     - localhost and *.localhost (browsers resolve them to this machine);
     - any IP literal (a rebinding attack needs a DNS name; the operator on a
       phone or another laptop can type an IP);
     - *.local — the Mac's own Bonjour/mDNS name (studio-mac.local from the
       iPad). Those names are answered on the LAN only, never by a DNS server
       a web page on the internet controls;
     - whatever ALLOWED_HOSTS lists (comma-separated, .env.local): exact names,
       or ".example.com" / "*.example.com" for a domain and all its
       subdomains — Vite's own allowedHosts rule. ALLOWED_HOSTS="*" turns the
       check off (a deploy behind a proxy that checks the Host itself).
       Letting a name in never lends it the server's key: a request through a
       proxy or tunnel must paste its own (ai-provider.ts serverKeyFor).
   The same rule is handed to Vite's dev host check below, so in dev the page
   and its API open on the same names. Runs before the body parser, so a
   refused request is never read. */
interface HostRule { any: boolean; names: string[] }

function readHostRule(raw = process.env.ALLOWED_HOSTS || ""): HostRule {
  const names: string[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim().toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, "") // a pasted URL: keep only its host
      .replace(/\/.*$/, "");
    if (!entry) continue;
    if (entry === "*") return { any: true, names: [] };
    const wildcard = entry.startsWith("*.") || entry.startsWith(".");
    const name = hostnameOf(entry.replace(/^\*?\./, ""));
    if (name) names.push(wildcard ? `.${name}` : name);
  }
  return { any: false, names: [...new Set(names)] };
}

const HOST_RULE = readHostRule();

function hostAllowed(hostHeader: string | undefined, rule: HostRule = HOST_RULE): boolean {
  if (rule.any) return true;
  const name = hostnameOf(hostHeader);
  if (!name) return false;
  if (net.isIP(name) !== 0) return true;
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  return rule.names.some((n) => (n.startsWith(".") ? name === n.slice(1) || name.endsWith(n) : name === n));
}

/** One log line per refused name (up to 20), so the operator who opened the
 *  app under a new name sees in the terminal what to add. */
const refusedHosts = new Set<string>();

app.use("/api", (req, res, next) => {
  if (hostAllowed(req.headers.host)) return next();
  const shown = (hostnameOf(req.headers.host) ?? "").replace(/[^a-z0-9.:_-]/g, "").slice(0, 100);
  if (shown && refusedHosts.size < 20 && !refusedHosts.has(shown)) {
    refusedHosts.add(shown);
    console.warn(`[host] refused /api on "${shown}" — to allow that name, add it to ALLOWED_HOSTS in .env.local and restart.`);
  }
  res.set("Connection", "close");
  const message = shown
    ? `This server's API does not answer on "${shown}" — only on localhost, an IP address or a .local name. To use this name, add ${shown} to ALLOWED_HOSTS (in .env.local or the server's environment) and restart the server; or open the app by IP address, or at http://localhost:${PORT} on the server's own machine.`
    : `This server's API needs a Host name: open the app by IP address, or at http://localhost:${PORT} on the server's own machine.`;
  sendFailure(res, { ...failure("bad_request", message), status: 403 });
});

/* ── SYNTECH-SECURITY: what /api checks before reading any body ──
   In this order: the Host guard (above), another site's request (403), the
   per-client rate limit (429), then per route a key (401) and an in-flight
   slot (429). A refusal answers at once and closes the connection, so a body
   nobody asked for is never read. Limits are far above what the panel does:
   it asks /status once per page load and makes one POST per click. */
app.use("/api", crossSiteGuard);

const GET_LIMIT = new RateLimiter(120);   // GET /status and friends, per client per minute
const POST_LIMIT = new RateLimiter(30);   // /key, /upload and the three roles, per client per minute
app.use("/api", (req, res, next) => {
  const limiter = req.method === "GET" || req.method === "HEAD" ? GET_LIMIT : POST_LIMIT;
  const wait = limiter.hit(clientId(req));
  if (wait === null) return next();
  refuse(res, 429, "quota",
    `Too many requests to this server (${limiter.limit} a minute). Wait ${Math.ceil(wait)} s and try again — this is the app server's own limit, not your Gemini quota.`,
    { retryAfter: wait, close: true });
});

const IMPLAUSIBLE_KEY = "This is not a Gemini API key (a key is 20+ letters, digits, '-', '_' or '.'). Paste the key from https://aistudio.google.com/apikey.";
/* A role call without a key still learns what is wrong with its body
   (400 no_media / bad_request, then 401 no_key) as long as the body is tiny:
   that costs nothing. Anything bigger — or of unknown length — without a key
   is refused unread. */
const KEYLESS_PROBE_BYTES = 16 * 1024;

/** Before the body: a header key that cannot be a key → invalid_key; no key
 *  at all → no_key (/key keeps its 200 KeyResponse contract). */
function keyGate(route: "role" | "upload" | "key") {
  return (req: Request, res: Response, next: NextFunction) => {
    const pasted = headerKey(req);
    /* The verify suites' mock keys ('MOCKKEY', 'BADKEY') are short: the length
       floor is lifted only while the loopback test hook is active. */
    if (pasted && !keyPlausible(pasted, testHookBaseUrl() ? 1 : 20)) {
      if (route === "key") {
        res.set("Connection", "close");
        const body: KeyResponse = { active: false, error: "invalid_key", message: IMPLAUSIBLE_KEY };
        res.json(body);
        return;
      }
      return refuse(res, 401, "invalid_key", IMPLAUSIBLE_KEY, { close: true });
    }
    if (resolveKey(req)) return next();
    if (route === "key") {
      res.set("Connection", "close");
      const body: KeyResponse = { active: false, error: "no_key", message: NO_KEY_MESSAGE };
      res.json(body);
      return;
    }
    const declared = req.get("content-length");
    if (route === "role" && declared !== undefined && /^\d+$/.test(declared) && Number(declared) <= KEYLESS_PROBE_BYTES) {
      res.locals.keyless = true;
      return next();
    }
    refuse(res, 401, "no_key", NO_KEY_MESSAGE, { close: true });
  };
}

/* SYNTECH-SECURITY (B1): a pasted key is proven with Google BEFORE the
   request may take a slot or send one body byte — a made-up key never holds
   anything. One models.get per key, cached by its hash (ai-provider.ts
   admitKey: valid 10 min, invalid 60 s, other failures not cached and refused
   as they are). The POST rate limit above bounds how many checks one client
   can cause. Keyless probes and the server's own key (dev, desktop) skip it.
   While Google is asked the body stays unread (no listener, stream paused);
   a client that hangs up meanwhile has taken nothing. */
function keyProof(req: Request, res: Response, next: NextFunction) {
  if (res.locals.keyless) return next();
  const pasted = headerKey(req);
  if (!pasted) return next();
  let gone = false;
  const hungUp = () => { gone = true; };
  res.once("close", hungUp);
  admitKey(pasted).then((f) => {
    res.off("close", hungUp);
    if (gone || res.headersSent || req.socket.destroyed) return;
    if (f) return refuse(res, f.status, f.kind, f.message, { close: true });
    next();
  }, () => {
    res.off("close", hungUp);
    refuse(res, 500, "server_error", "Unexpected server error. Try again.", { close: true });
  });
}

/* In flight at once, per server and per client (SRV-02/03): uploads write up
   to 500 MB to the temp folder each, a role call holds up to 40 MB of JSON in
   memory. The panel never runs two of the same kind from one browser, so the
   per-client caps (1 upload, 2 role calls) are fixed. The global caps are
   SYNTECH_MAX_UPLOADS (6) and SYNTECH_MAX_ROLE_CALLS (16); on top, the
   declared sizes of the role bodies in flight may add up to
   SYNTECH_ROLE_BYTES_MB (160 MB) — a body of unknown length (chunked) counts
   as the 40 MB maximum. .env.example says what each implies in RAM / disk. */
const ROLE_BODY_MAX = 40 * 1024 * 1024;
const UPLOAD_SLOTS = new Slots("upload", envPositiveInt("SYNTECH_MAX_UPLOADS", 6), 1);
const ROLE_SLOTS = new Slots("role", envPositiveInt("SYNTECH_MAX_ROLE_CALLS", 16), 2);
const ROLE_BYTES = new ByteBudget("role", envPositiveInt("SYNTECH_ROLE_BYTES_MB", 160) * 1024 * 1024);
const roleBodyCost = (req: Request) => {
  const declared = req.get("content-length");
  return declared !== undefined && /^\d{1,12}$/.test(declared) ? Math.min(Number(declared), ROLE_BODY_MAX) : ROLE_BODY_MAX;
};
const uploadSlot = holdSlot(UPLOAD_SLOTS, "Another upload is in progress.");
const roleSlotHeld = holdSlot(ROLE_SLOTS, "Too many Gemini requests in progress.", { bytes: ROLE_BYTES, cost: roleBodyCost });
const roleSlot = (req: Request, res: Response, next: NextFunction) =>
  (res.locals.keyless ? next() : roleSlotHeld(req, res, next));
/** Every check passed: the body may be read now (guardBody's clocks start). */
const flow = (req: Request, _res: Response, next: NextFunction) => { bodyFlowing(req); next(); };

/* Frames and a 4s clip arrive inline as base64; 40MB is far above what the
   panel sends. Parsed only on the role routes, only after the checks above
   (keyless probes: 16 KB). */
const roleJsonFull = express.json({ limit: "40mb" });
const roleJsonProbe = express.json({ limit: KEYLESS_PROBE_BYTES });
const roleJson = (req: Request, res: Response, next: NextFunction) =>
  (res.locals.keyless ? roleJsonProbe : roleJsonFull)(req, res, next);
const rolePipeline = [keyGate("role"), keyProof, roleSlot, flow, roleJson];

/** A real call that Google answered invalid_key: the pasted key's cached
 *  "valid" goes, so the next request relocks at once. */
function forgetIfRejected(req: Request, f: AiFailure): AiFailure {
  const pasted = headerKey(req);
  if (pasted && f.kind === "invalid_key") forgetKey(pasted);
  return f;
}

/* ── status + key ─────────────────────────────────────────────── */

/* serverKey is true only for a client that may USE it (this machine): a LAN
   client is told to paste its own key. */
app.get("/api/gemini/status", (req, res) => {
  const body: StatusResponse = { serverKey: serverKeyAvailable(req), model: geminiModel() };
  res.json(body);
});

/* Answers 200 with a KeyResponse either way: "this key does not work" is the
   successful outcome of a validation, not a server failure. A pasted key is
   always asked about afresh (validateKey: one models.get, or the one already
   running for it), and the verdict lands in the cache keyProof reads — the
   panel's "Connect" proves the key for the calls that follow. */
app.post("/api/gemini/key", keyGate("key"), express.json({ limit: "64kb" }), async (req, res) => {
  const fromHeader = !!req.get(GEMINI_KEY_HEADER)?.trim();
  const apiKey = resolveKey(req);
  let body: KeyResponse;
  if (!apiKey) {
    body = { active: false, error: "no_key", message: NO_KEY_MESSAGE };
  } else {
    let f: AiFailure | null = null;
    if (fromHeader) {
      f = await validateKey(apiKey);
    } else {
      try {
        await checkKey(apiKey);
      } catch (err) {
        f = reportFailure(err);
      }
    }
    body = f
      ? { active: false, error: f.kind, message: f.message }
      : { active: true, model: geminiModel(), source: fromHeader ? "browser" : "server" };
  }
  res.json(body);
});

/* ── upload ───────────────────────────────────────────────────── */

/* The browser sends the file's raw bytes (no multipart, no base64): we stream
   them to a temp file, hand that path to the Files API, and wait for Google to
   finish processing. 500MB is our hard ceiling; the panel already stops at
   MAX_UPLOAD_BYTES (300MB) and falls back to sampled frames above it. */
const UPLOAD_CAP_BYTES = 500 * 1024 * 1024;
const UPLOAD_MIME = /^(video|audio|image)\/[a-z0-9.+-]+$/;
/* Browsers name some containers with legacy x- types; Gemini's documented
   list uses the plain names. Send those, so the stored file's type is one
   Gemini reads when a role references it later. */
const MIME_ALIASES: Record<string, string> = {
  "video/x-msvideo": "video/avi",
  "video/msvideo": "video/avi",
  "video/x-ms-wmv": "video/wmv",
};

class TooLarge extends Error {}

/** Streams the request body into `filePath`, refusing past `cap` bytes.
 *  On refusal the rest of the body is drained and discarded (not
 *  destroyed), so the 413 can still reach the browser. */
function receiveToFile(req: Request, filePath: string, cap: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(filePath);
    let bytes = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      req.unpipe(out);
      out.destroy();
      req.resume();
      reject(err);
    };
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > cap) fail(new TooLarge());
    });
    /* The browser going away (reset, tab closed) is not "could not reach
       Gemini": say what happened, in the contract's words. */
    const interrupted = () => fail(new GeminiFailure("server_error", "Upload interrupted by the browser."));
    req.on("error", interrupted);
    req.on("close", () => { if (!req.complete) interrupted(); });
    out.on("error", fail);
    out.on("finish", () => {
      if (settled) return;
      settled = true;
      resolve(bytes);
    });
    req.pipe(out);
  });
}

app.post("/api/gemini/upload", keyGate("upload"), keyProof, uploadSlot, flow, async (req, res) => {
  let tmpDir: string | null = null;
  /* If the browser goes away at any point — mid-body or while Google works —
     give up on its behalf: the handler returns at once, the transfer to
     Google is cut at the next 8MB chunk and whatever already reached Google
     is deleted (best effort — the SDK itself ignores an abort signal on
     upload; see uploadAndWait). */
  const abort = new AbortController();
  res.on("close", () => { if (!res.writableFinished) abort.abort(); });
  try {
    const sent = (req.get("content-type") || "").split(";")[0].trim().toLowerCase();
    const mimeType = MIME_ALIASES[sent] ?? sent;
    if (!UPLOAD_MIME.test(mimeType)) {
      throw new GeminiFailure("bad_request", `Only video, audio or image files can be uploaded (got "${mimeType || "no type"}").`);
    }
    const apiKey = resolveKey(req);
    if (!apiKey) throw new GeminiFailure("no_key", NO_KEY_MESSAGE);
    const declared = Number(req.get("content-length") || 0);
    if (declared > UPLOAD_CAP_BYTES) throw new TooLarge();

    let displayName = "source";
    try {
      displayName = decodeURIComponent(req.get("x-file-name") || "source").replace(/[\r\n\t]/g, " ").trim().slice(0, 120) || "source";
    } catch {
      /* a malformed URI escape is not worth a failed upload */
    }

    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "syntech-upload-"));
    const tmpPath = path.join(tmpDir, "source.bin");
    const bytes = await receiveToFile(req, tmpPath, UPLOAD_CAP_BYTES);
    if (!bytes) throw new GeminiFailure("no_media", "The upload was empty.");

    const file = await uploadAndWait(apiKey, tmpPath, mimeType, displayName, abort.signal);
    const body: UploadResponse = {
      fileUri: file.uri as string,
      mimeType: file.mimeType || mimeType,
      name: file.name || "",
      expiresAt: file.expirationTime ?? null,
    };
    res.json(body);
  } catch (err) {
    if (err instanceof TooLarge) {
      res.set("Connection", "close");
      sendFailure(res, reportFailure(new GeminiFailure("too_large", "File too large to upload (limit 500 MB).")));
    } else {
      sendFailure(res, forgetIfRejected(req, reportFailure(err)));
    }
  } finally {
    if (tmpDir) fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* ── the three roles ──────────────────────────────────────────── */

/* Same shape for all three: read + validate the body (400 no_media / bad_request
   before anything else), find a key (401 no_key), ask Gemini for JSON in the
   role's schema, validate the answer, send it. Fully try/caught: Express 4 does
   not catch a rejected async handler. A browser that hangs up (panel closed,
   page reloaded) aborts the Gemini call: nobody is left to read the answer. */
function roleEndpoint<R>(build: (body: unknown) => RoleJob<R>) {
  return async (req: Request, res: Response) => {
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableFinished) abort.abort(); });
    try {
      const job = build(req.body);
      const apiKey = resolveKey(req);
      if (!apiKey) throw new GeminiFailure("no_key", NO_KEY_MESSAGE);
      const ask = (responseJsonSchema: Record<string, unknown>) => generateJson<unknown>({
        apiKey,
        systemInstruction: job.systemInstruction,
        parts: job.parts,
        responseJsonSchema,
        mediaResolution: job.mediaResolution,
        signal: abort.signal,
      });
      let raw: unknown;
      try {
        raw = await ask(job.responseJsonSchema);
      } catch (err) {
        /* Google refuses a response schema it finds too complex (big key
           enums, arrays with length limits nested under other arrays,
           numeric bounds) with a 400 — often the bare "Request contains an
           invalid argument." that names nothing — or sometimes a bare 500.
           Then ask once more with the role's loose schema: no enums, caps or
           bounds; the validator enforces all of them anyway. Anything else
           is a failure. One log line says which branch ran. */
        const why = job.looseSchema && !abort.signal.aborted ? looseRetryReason(err) : null;
        if (!why) throw err;
        const where = routeOf(req).slice(0, 40);
        limitedWarn("gemini:schema", `[gemini] ${where}: strict schema failed (${why}), retrying once with the loose schema`, 5);
        try {
          raw = await ask(job.looseSchema as Record<string, unknown>);
        } catch (err2) {
          limitedWarn("gemini:schema-failed", `[gemini] ${where}: the loose schema failed too`, 5);
          throw err2;
        }
        limitedWarn("gemini:schema-ok", `[gemini] ${where}: the loose schema answered`, 5);
      }
      res.json(job.finish(raw));
    } catch (err) {
      if (abort.signal.aborted) {
        limitedWarn("gemini:cancelled", "[gemini] request cancelled: the browser hung up before Gemini answered", 5);
        return;
      }
      sendFailure(res, forgetIfRejected(req, reportFailure(err)));
    }
  };
}

app.post("/api/gemini/art-director", ...rolePipeline, roleEndpoint(artDirectorJob));
app.post("/api/gemini/agent", ...rolePipeline, roleEndpoint(agentJob));
app.post("/api/gemini/optimizer", ...rolePipeline, roleEndpoint(optimizerJob));

/* Anything else under /api is a 404 in the contract's error shape — not the
   SPA's index.html, which is what the Vite middleware would answer. */
app.all("/api/*", (_req, res) => {
  sendFailure(res, { ...failure("bad_request", "Unknown API endpoint."), status: 404 });
});

/* Errors raised before a handler runs — body-parser's 413 (entity.too.large)
   and 400 (entity.parse.failed) — still answer as AiErrorResponse JSON. */
app.use("/api", (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const type = (err as { type?: string })?.type;
  if (res.headersSent) {
    /* Already answered — typically guardBody's 408, after which the parser
       sees the body aborted. Do what Express would (drop the connection)
       without its stack trace per request: a client could flood the log. */
    if (type !== "request.aborted") limitedWarn("server:after-response", `[server] error after the response was sent: ${String(type || (err as Error)?.name || "error").slice(0, 60)}`, 5);
    req.socket.destroy();
    return;
  }
  if (type === "entity.too.large") return sendFailure(res, failure("too_large", "Request too large (limit 40 MB). Send fewer frames or a shorter clip."));
  if (type === "entity.parse.failed") return sendFailure(res, failure("bad_request", "Request body is not valid JSON."));
  sendFailure(res, reportFailure(err));
});

/* Uploads in flight live in os.tmpdir()/syntech-upload-*; the handler's
   `finally` removes them, but not when the server is killed mid-upload
   (Ctrl+C during a 300MB "Uploading clip…"). Sweep leftovers at boot — only
   ones untouched for 10 minutes, so a second server's live upload is safe. */
const STALE_UPLOAD_MS = 10 * 60_000;
async function sweepStaleUploads(): Promise<void> {
  const dir = os.tmpdir();
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - STALE_UPLOAD_MS;
  let removed = 0;
  for (const name of names) {
    if (!name.startsWith("syntech-upload-")) continue;
    const full = path.join(dir, name);
    try {
      let newest = (await fs.promises.stat(full)).mtimeMs;
      for (const f of await fs.promises.readdir(full)) {
        newest = Math.max(newest, (await fs.promises.stat(path.join(full, f))).mtimeMs);
      }
      if (newest >= cutoff) continue;
      await fs.promises.rm(full, { recursive: true, force: true });
      removed++;
    } catch {
      /* raced with another process, or not ours to remove: leave it */
    }
  }
  if (removed) console.log(`Removed ${removed} stale upload temp folder${removed === 1 ? "" : "s"} from ${dir}.`);
}

export interface ServeOptions {
  port?: number;
  host?: string;
  /** Serve this built `dist/` folder instead of running Vite. The desktop shell passes its own. */
  distPath?: string;
}

/** True for a URL path that must never be served from a built dist/: any
 *  source map, and the server bundle (it lives in dist-server/ since the
 *  build moved it out, but an old or hand-made dist/ may still hold one).
 *  Decoded and normalised first, so /server%2Ecjs, /SERVER.CJS (a
 *  case-insensitive disk) or a trailing dot cannot slip past. */
function forbiddenInDist(urlPath: string): boolean {
  let p: string;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return true; // a malformed escape: nothing legitimate looks like that
  }
  const base = path.posix.basename(p.replace(/\\/g, "/")).toLowerCase().split(":")[0].replace(/[. ]+$/, "");
  return base.endsWith(".map") || base === "server.cjs";
}

// Configure Vite middleware or static route handling depending on production state
export const startServer = async (opts: ServeOptions = {}): Promise<number> => {
  const port = opts.port ?? PORT;
  /* SYNTECH_HOST picks the bind address (default every interface, so a phone
     or an iPad on the LAN can open the dev app). SYNTECH_HOST=127.0.0.1 keeps
     it on this machine. Not plain HOST: some shells, containers and PaaS
     export HOST for their own purposes. The desktop shell always passes
     127.0.0.1. */
  const host = opts.host ?? (process.env.SYNTECH_HOST?.trim() || "0.0.0.0");
  await sweepStaleUploads();
  /* SYNTECH-SECURITY (SRV-04): a BUILT server is production, whatever NODE_ENV
     says — it never starts Vite (which would serve the whole project tree). */
  if (!opts.distPath && !IS_BUILT && process.env.NODE_ENV !== "production") {
    // Effect builds are self-contained static apps: serve them ahead of the
    // Vite pipeline, which blocks public assets requested as <script src>
    app.use("/effects", express.static(path.join(process.cwd(), "public/effects")));
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      /* Vite already accepts localhost, *.localhost and IP literals; add what
         hostAllowed adds, so the page never loads on a name its API refuses
         (or the reverse). */
      server: { middlewareMode: true, allowedHosts: HOST_RULE.any ? true : [".local", ...HOST_RULE.names] },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = opts.distPath ?? path.join(process.cwd(), "dist");
    serveCsp = true;
    /* SYNTECH-SECURITY (SRV-05): never a source map or the server bundle. */
    app.use((req, res, next) => {
      if (forbiddenInDist(req.path)) return res.status(404).type("text/plain").send("Not found");
      next();
    });
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  /* SYNTECH-SECURITY (SRV-10, slow requests): Node's requestTimeout (300 s) is off — it
     cut legitimate slow uploads; guardBody (above) bounds bodies instead.
     Headers must arrive within 20 s (checked every 5 s). */
  const server = http.createServer({ requestTimeout: 0, headersTimeout: 20_000, connectionsCheckingInterval: 5_000 }, app);
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const bound = (server.address() as net.AddressInfo).port;
      const hasKey = !!process.env.GEMINI_API_KEY?.trim();
      const policy = serverKeyPolicy();
      console.log(`Server launched on port ${bound} // Full-stack core ready.`);
      console.log(`Mode: ${serveCsp ? "built app (dist/)" : "dev (Vite)"}${IS_BUILT ? ", production bundle" : ""}${process.env.SYNTECH_DESKTOP ? ", desktop" : ""}; bound to ${host}${opts.host === undefined && process.env.SYNTECH_HOST?.trim() ? " (SYNTECH_HOST)" : ""}${TRUST_PROXY_HOPS ? `; trusting ${TRUST_PROXY_HOPS} proxy hop(s)` : ""}`);
      console.log(`Limits: ${UPLOAD_SLOTS.global} uploads and ${ROLE_SLOTS.global} Gemini calls at once (1 and 2 per client), ${Math.round(ROLE_BYTES.budget / 1048576)} MB of Gemini request bodies in flight`);
      console.log(`API hosts: ${HOST_RULE.any ? "any (ALLOWED_HOSTS=*)" : ["localhost", "IP addresses", "*.local", ...HOST_RULE.names.map((n) => (n.startsWith(".") ? `*${n}` : n))].join(", ")}`);
      console.log(`Gemini: model=${geminiModel()}, server key: ${!hasKey
        ? "not set (a key can be pasted in the panel)"
        : policy === "off"
          ? "IGNORED — a built standalone server never lends its key; every user pastes their own in the panel"
          : "set (used only by browsers on this machine)"}`);
      resolve(bound);
    });
  });
};

/* `npm run dev` and `npm start` run this file directly: listen on :3000 now.
   The desktop shell (desktop/main.ts) imports it instead and calls startServer
   itself, on its own port and with its own dist/ — it sets SYNTECH_DESKTOP first. */
if (!process.env.SYNTECH_DESKTOP) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
