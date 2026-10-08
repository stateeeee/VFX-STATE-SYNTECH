import express, { type NextFunction, type Request, type Response } from "express";
import path from "path";
import os from "os";
import fs from "fs";
import net from "net";
import dotenv from "dotenv";

/* .env.local first (the operator's own, git-ignored), then .env. The first
   file to define a variable wins; neither is required. */
dotenv.config({ path: [".env.local", ".env"], quiet: true });

/* GEMINI 3.8 — six endpoints under /api/gemini, all speaking the wire format of
   src/ai/contract.ts:

     GET  /status        is there a server key, which model          (no key needed)
     POST /key           validate the pasted key (one models.get)    → KeyResponse
     POST /upload        a whole source video → Gemini Files API     → UploadResponse
     POST /art-director  watch the source, propose effect chains     → ArtDirectorResult
     POST /agent         set params + audio routes for the Lab chain → AgentResult
     POST /optimizer     judge the Lab's OUTPUT, propose fixes       → OptimizerResult

   Every failure is an AiErrorResponse {error, message} with a 4xx/5xx status.
   Only Host names this machine answers to directly (localhost or an IP
   literal) reach /api — see hostGuard. The server's own GEMINI_API_KEY is used
   for loopback clients only (ai-provider.ts resolveKey).
   There are no offline answers any more: without a key the panel simply stays
   locked, and nothing that is not AI ever needs one. The prompts, schemas and
   validators live in ai-roles.ts; the Gemini client, key handling and error
   classification in ai-provider.ts. */
import {
  checkKey,
  failure,
  generateJson,
  geminiModel,
  GeminiFailure,
  isSchemaRejection,
  reportFailure,
  resolveKey,
  serverKeyAvailable,
  uploadAndWait,
  worthLooseRetry,
  type AiFailure,
} from "./ai-provider";
import { agentJob, artDirectorJob, optimizerJob, type RoleJob } from "./ai-roles";
import { GEMINI_KEY_HEADER, type KeyResponse, type StatusResponse, type UploadResponse } from "./src/ai/contract";

const app = express();

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
   still carry Host: evil.example. Vite's host check only covers Vite's own
   routes, and /api is mounted before Vite, so it gets its own: a hostname must
   be localhost or an IP literal (a rebinding attack needs a DNS name; the
   operator on a phone or another laptop types an IP). Runs before the body
   parser, so a refused request is never read. */
function hostAllowed(hostHeader: string | undefined): boolean {
  const host = (hostHeader || "").trim().toLowerCase();
  if (!host) return false;
  let name: string;
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) return false;
    name = host.slice(1, end);
  } else {
    name = host.replace(/:\d*$/, "");
  }
  return name === "localhost" || net.isIP(name) !== 0;
}

app.use("/api", (req, res, next) => {
  if (hostAllowed(req.headers.host)) return next();
  res.set("Connection", "close");
  sendFailure(res, { ...failure("bad_request", "This API only answers on localhost or an IP address. Open the app at http://localhost:" + PORT + "."), status: 403 });
});

/* Frames and a 4s clip arrive inline as base64; 40MB is far above what the
   panel sends and still below anything that would hurt the dev server. */
app.use(express.json({ limit: "40mb" }));

/* ── status + key ─────────────────────────────────────────────── */

/* serverKey is true only for a client that may USE it (this machine): a LAN
   client is told to paste its own key. */
app.get("/api/gemini/status", (req, res) => {
  const body: StatusResponse = { serverKey: serverKeyAvailable(req), model: geminiModel() };
  res.json(body);
});

/* Answers 200 with a KeyResponse either way: "this key does not work" is the
   successful outcome of a validation, not a server failure. */
app.post("/api/gemini/key", async (req, res) => {
  const fromHeader = !!req.get(GEMINI_KEY_HEADER)?.trim();
  const apiKey = resolveKey(req);
  let body: KeyResponse;
  if (!apiKey) {
    body = { active: false, error: "no_key", message: NO_KEY_MESSAGE };
  } else {
    try {
      await checkKey(apiKey);
      body = { active: true, model: geminiModel(), source: fromHeader ? "browser" : "server" };
    } catch (err) {
      const f = reportFailure(err);
      body = { active: false, error: f.kind, message: f.message };
    }
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

app.post("/api/gemini/upload", async (req, res) => {
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
      sendFailure(res, reportFailure(err));
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
        /* A long chain puts ~170 parameter keys in enums nested under capped
           arrays; if Google finds that too complex (a 400 naming the schema,
           or sometimes a bare 500), ask once more with the loose schema — no
           enums, caps or bounds; the validator enforces all of them anyway.
           Anything else is a failure. */
        if (!job.looseSchema || abort.signal.aborted || !worthLooseRetry(err)) throw err;
        console.warn(`[gemini] strict schema ${isSchemaRejection(err) ? "refused by Google" : "failed with HTTP 500"}, retrying once with the loose schema`);
        raw = await ask(job.looseSchema);
      }
      res.json(job.finish(raw));
    } catch (err) {
      if (abort.signal.aborted) {
        console.warn("[gemini] request cancelled: the browser hung up before Gemini answered");
        return;
      }
      sendFailure(res, reportFailure(err));
    }
  };
}

app.post("/api/gemini/art-director", roleEndpoint(artDirectorJob));
app.post("/api/gemini/agent", roleEndpoint(agentJob));
app.post("/api/gemini/optimizer", roleEndpoint(optimizerJob));

/* Anything else under /api is a 404 in the contract's error shape — not the
   SPA's index.html, which is what the Vite middleware would answer. */
app.all("/api/*", (_req, res) => {
  sendFailure(res, { ...failure("bad_request", "Unknown API endpoint."), status: 404 });
});

/* Errors raised before a handler runs — body-parser's 413 (entity.too.large)
   and 400 (entity.parse.failed) — still answer as AiErrorResponse JSON. */
app.use("/api", (err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  const type = (err as { type?: string })?.type;
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

// Configure Vite middleware or static route handling depending on production state
const startServer = async () => {
  await sweepStaleUploads();
  if (process.env.NODE_ENV !== "production") {
    // Effect builds are self-contained static apps: serve them ahead of the
    // Vite pipeline, which blocks public assets requested as <script src>
    app.use("/effects", express.static(path.join(process.cwd(), "public/effects")));
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server launched on port ${PORT} // Full-stack core ready.`);
    console.log(`Gemini: model=${geminiModel()}, server key: ${process.env.GEMINI_API_KEY?.trim() ? "set (used only by browsers on this machine)" : "not set (a key can be pasted in the panel)"}`);
  });
};

startServer();
