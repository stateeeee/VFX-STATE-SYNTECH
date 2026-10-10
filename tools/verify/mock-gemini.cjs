/*
 * MOCK GEMINI — a tiny local stand-in for generativelanguage.googleapis.com.
 *
 * It speaks exactly the slice of the Gemini API that @google/genai (as used by
 * ai-provider.ts) calls, so the whole Gemini 3.8 flow can be verified with no
 * real key and no network. The app server is pointed at it with
 * GEMINI_BASE_URL=http://127.0.0.1:<port> (a test hook, see ai-provider.ts).
 *
 *   GET  /v1beta/models/<model>                 key check (models.get)
 *   POST /v1beta/models/<model>:generateContent the three roles
 *   POST /upload/v1beta/files                   resumable upload: start
 *   POST /upload-session/<n>                    resumable upload: chunks
 *   GET  /v1beta/files/<id>                     processing poll → ACTIVE
 *   DELETE /v1beta/files/<id>                   best-effort cleanup (recorded)
 *
 * Keys travel in the x-goog-api-key header (never in the URL). 'MOCKKEY' is
 * accepted; anything else — 'BADKEY' in the suite — gets Google's real
 * 400 INVALID_ARGUMENT / API_KEY_INVALID body. A model id other than
 * MODEL (default gemini-3.8-flash) gets a 404 NOT_FOUND, so a suite also
 * proves which model the server asks for.
 *
 * generateContent records every request body (and its prompt text, `rec.text`)
 * and answers with canned JSON per role (detected from the systemInstruction).
 * The Agent's and the Optimizer's answers are built from the chain table the
 * request carries: keys that exist (the validator keeps them) plus
 * deliberately invalid ones (unknown key, a carrier's base, a locked key, an
 * enum route, a base under its floor, a route over the depth cap…) that the
 * validator must drop (`dropped`) or keep changed (`adjusted`: the floor, the
 * cap — in the Agent's plan and in the Optimizer's first fix).
 *
 * Use it in-process:
 *   const { startMockGemini } = require('./mock-gemini.cjs');
 *   const mock = await startMockGemini({ port: 0 });
 *   mock.baseUrl; mock.generate; mock.uploads; mock.keyChecks; mock.log;
 *   mock.failNext({ status: 400, body: KEY_INVALID_BODY }); await mock.close();
 *   mock.failNext({ status: 200, body: SAFETY_BLOCKED_BODY }); // a refused answer
 * or standalone (manual runs):
 *   node tools/verify/mock-gemini.cjs [port]
 *   curl -XPOST localhost:<port>/__mock/fail-next -d '{"status":401}'
 *   curl localhost:<port>/__mock/log
 */
'use strict';

const http = require('http');

const MODEL = 'gemini-3.8-flash';
const GOOD_KEY = 'MOCKKEY';

/** What Google really answers for a key it does not know. */
const KEY_INVALID_BODY = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'API_KEY_INVALID',
        domain: 'googleapis.com',
        metadata: { service: 'generativelanguage.googleapis.com' },
      },
    ],
  },
};

const UNAUTHENTICATED_BODY = {
  error: {
    code: 401,
    message: 'Request had invalid authentication credentials.',
    status: 'UNAUTHENTICATED',
  },
};

/** A 200 whose prompt Google refused: no text, blockReason SAFETY. */
const SAFETY_BLOCKED_BODY = {
  promptFeedback: { blockReason: 'SAFETY' },
  candidates: [{ finishReason: 'SAFETY', index: 0 }],
  usageMetadata: { promptTokenCount: 1, totalTokenCount: 1 },
  modelVersion: MODEL,
};

/** contract.ts PARAM_FLOORS (kept in sync by hand: the mock is plain CJS). */
const FLOORS = { 'analog.modDepth': 0.1 };

/* ── the chain table (ai-roles.ts describeChain) ─────────────── */

/**
 * Parses the PARAMETERS lines of a role's context text:
 *   key | label | number 0..1 step 0.01 | base 0.2 | route bass ×0.3 | routable — hint
 *   key | label | on/off 0|1 | base 1 | route —
 *   key | label | enum 0..3 | base 2 | route — | ENUM
 */
function parseChainTable(text) {
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (!/^[a-z_]+\.[A-Za-z0-9_]+ \| /.test(line)) continue;
    const f = line.split(' | ');
    if (f.length < 5) continue;
    const key = f[0];
    const range = f[2];
    let kind = 'number', min = 0, max = 1, step = 0;
    let m;
    if (/^on\/off/.test(range)) {
      kind = 'boolean';
    } else if ((m = range.match(/^enum (-?[\d.e+-]+?)\.\.(-?[\d.e+-]+)$/))) {
      kind = 'enum'; min = Number(m[1]); max = Number(m[2]); step = 1;
    } else if ((m = range.match(/^number (-?[\d.e+-]+?)\.\.(-?[\d.e+-]+?)(?: step (\S+))?$/))) {
      min = Number(m[1]); max = Number(m[2]); step = m[3] ? Number(m[3]) : 0;
    } else {
      continue;
    }
    const base = Number((f[3].match(/^base (\S+)/) || [])[1]);
    // flags, when there are any, open the 6th field (a hint may follow them)
    const flag = ((f[5] || '').match(/^(LOCKED|CARRIER|ENUM|routable)\b/) || [])[1] || '';
    rows.push({ key, kind, min, max, step, base, flag });
  }
  return rows;
}

/** A value well away from the current base, inside the range. */
function farFrom(p) {
  const mid = (p.min + p.max) / 2;
  const v = Number.isFinite(p.base) && p.base < mid ? p.min + 0.8 * (p.max - p.min) : p.min + 0.2 * (p.max - p.min);
  return Math.round(v * 1000) / 1000;
}

/** Base-tunable ordinary numbers: not locked, not a carrier, not an enum, no floor. */
const tunable = (rows) => rows.filter((p) => p.kind === 'number' && (p.flag === '' || p.flag === 'routable') && p.max > p.min && !(p.key in FLOORS));
const routable = (rows) => rows.filter((p) => p.kind === 'number' && p.flag === 'routable' && p.max > p.min && !(p.key in FLOORS));

/* ── canned answers per role ──────────────────────────────────── */

function contextText(body) {
  const parts = body?.contents?.[0]?.parts || [];
  return parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n');
}

function roleOf(body) {
  const sys = (body?.systemInstruction?.parts || []).map((p) => p.text || '').join('');
  if (/You are the ART DIRECTOR/.test(sys)) return 'art_director';
  if (/You are the AGENT/.test(sys)) return 'agent';
  if (/You are the OPTIMIZER/.test(sys)) return 'optimizer';
  return 'unknown';
}

function artDirectorAnswer(body) {
  const parts = body?.contents?.[0]?.parts || [];
  const hearsVideo = parts.some((p) => p.fileData && /^video\//.test(p.fileData.mimeType || ''));
  return {
    read: {
      subject: 'una figura sola al centro (mock)',
      setting: 'notte, luci forti dietro (mock)',
      mood: 'cupo e teso',
      palette: ['blu', 'nero', 'ambra', 'bianco'],
      motion: hearsVideo ? 'un quadrato luminoso che attraversa il frame' : 'fermo, energia implicita',
      music: hearsVideo
        ? { energy: 'alta, cassa dritta (mock)', tempoFeel: '120 BPM four-on-the-floor', moments: [{ at: '0:02', label: 'cassa piena' }, { at: '0:04', label: 'ripresa' }] }
        : null,
    },
    proposals: [
      { title: 'Notte analogica', chain: ['analog', 'anamorphic_lab'], why: 'MOCK-WHY-0: le luci diventano scie sul tubo.', audioIdea: 'la cassa spinge il tear' },
      // reordered by the validator: blob_tracker must lead; 'nope' and the repeat go
      { title: 'Sorveglianza', chain: ['anamorphic_lab', 'blob_tracker', 'nope', 'anamorphic_lab'], why: 'MOCK-WHY-1', audioIdea: 'ripple sul beat' },
      // nothing valid left: the whole proposal must be dropped
      { title: 'Fantasma', chain: ['zzz'], why: 'MOCK-WHY-DROPPED', audioIdea: '-' },
      { title: 'Lente', chain: ['bokeh'], why: 'MOCK-WHY-3', audioIdea: 'raggio sul basso' },
    ],
  };
}

function agentAnswer(body) {
  const rows = parseChainTable(contextText(body));
  const t = tunable(rows);
  const r = routable(rows);
  const P = t[0] || null;
  const R = r.find((x) => !P || x.key !== P.key) || r[0] || null;
  // a third routable key, routed deeper than the cap allows (clamped, kept)
  const R3 = r.find((x) => (!P || x.key !== P.key) && (!R || x.key !== R.key)) || null;
  const carrier = rows.find((x) => x.flag === 'CARRIER');
  const locked = rows.find((x) => x.flag === 'LOCKED');
  const gate = rows.find((x) => x.key === 'analog.reactEnabled');       // analog's reactivity gate
  const floor = rows.find((x) => x.key in FLOORS && x.kind === 'number'); // analog.modDepth
  const en = rows.find((x) => x.kind === 'enum');
  const params = [];
  const routes = [];
  if (P) params.push({ key: P.key, value: farFrom(P) });
  params.push({ key: 'nope.ghost', value: 1 });                    // not in the chain
  if (carrier) params.push({ key: carrier.key, value: 0.5 });        // a carrier's base is never the AI's
  if (locked) params.push({ key: locked.key, value: 1 });            // protected
  if (gate && gate !== locked) params.push({ key: gate.key, value: 0 }); // protected: off would kill the carriers
  if (floor) params.push({ key: floor.key, value: 0 });              // under its floor: raised to it
  if (R) routes.push({ key: R.key, source: 'beat', amount: 0.2 });
  if (R3) routes.push({ key: R3.key, source: 'treble', amount: 0.9 }); // over MAX_ROUTE_AMOUNT: clamped
  routes.push({ key: 'nope.ghost', source: 'bass', amount: 0.1 });   // not in the chain
  if (en) routes.push({ key: en.key, source: 'bass', amount: 0.1 }); // enums are never routed
  if (carrier) routes.push({ key: carrier.key, source: 'off', amount: 0 }); // carriers cannot be switched off
  return {
    answer: { params, routes, summary: 'MOCK-AGENT: ho spinto un parametro e agganciato una route al beat.' },
    picked: {
      P: P && P.key, R: R && R.key, R3: R3 && R3.key, carrier: carrier && carrier.key, locked: locked && locked.key,
      gate: gate && gate.key, floor: floor && floor.key, floorValue: floor ? FLOORS[floor.key] : null, enum: en && en.key,
    },
  };
}

function optimizerAnswer(body) {
  const rows = parseChainTable(contextText(body));
  const t = tunable(rows);
  const r = routable(rows);
  const P2 = t[1] || t[0] || null;
  const R2 = r.find((x) => !P2 || x.key !== P2.key) || null;
  // a second route, deeper than the cap: kept at 0.6 — the server reports it
  // in `adjusted` ('fix 1 · key: route depth: …'), the panel on the fix's row
  const R4 = r.find((x) => (!P2 || x.key !== P2.key) && (!R2 || x.key !== R2.key)) || null;
  const routes = [];
  if (R2) routes.push({ key: R2.key, source: 'bass', amount: 0.15 });
  if (R4) routes.push({ key: R4.key, source: 'loud', amount: 0.9 });
  const fix = { params: P2 ? [{ key: P2.key, value: farFrom(P2) }] : [], routes, summary: 'MOCK-FIX-0: meno invadente.' };
  return {
    answer: {
      issues: [
        { severity: 'warning', finding: 'MOCK-ISSUE-0: l\'effetto copre il soggetto.', evidence: '0:01.0 — OUTPUT frame', fix },
        // unknown severity → 'tip'; a fix with nothing valid left → null
        { severity: 'bogus', finding: 'MOCK-ISSUE-1: fix impossibile.', evidence: 'x', fix: { params: [{ key: 'nope.ghost', value: 0 }], routes: [], summary: '' } },
        { severity: 'tip', finding: 'MOCK-ISSUE-2: il ritmo regge.', evidence: '0:03.0', fix: null },
      ],
      verdict: 'improve',
      summary: 'MOCK-OPT: quasi, una correzione.',
    },
    picked: { P2: P2 && P2.key, R2: R2 && R2.key, R4: R4 && R4.key },
  };
}

const candidate = (text) => ({
  candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  modelVersion: MODEL,
});

/* ── the server ──────────────────────────────────────────────── */

function startMockGemini({ port = 0, model = MODEL, goodKey = GOOD_KEY, processingPolls = 1 } = {}) {
  const state = {
    log: [],        // every request: {method, url, key, cmd, bytes}
    keyChecks: [],  // models.get: {model, key, ok}
    generate: [],   // generateContent: {role, model, key, body, answer, picked, status}
    uploadStarts: [],
    uploads: [],    // finalized uploads: {name, uri, mimeType, displayName, bytes}
    filePolls: [],
    fileDeletes: [],
    pendingFail: null,
  };
  const sessions = new Map();
  const files = new Map();
  let seq = 0;
  let baseUrl = '';

  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=UTF-8', ...headers });
    res.end(JSON.stringify(body));
  };
  const keyOk = (k) => k === goodKey;
  const notFound = (what) => ({ error: { code: 404, message: `models/${what} is not found for API version v1beta, or is not supported for generateContent.`, status: 'NOT_FOUND' } });

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = req.url || '';
      const pathname = url.split('?')[0];
      const key = req.headers['x-goog-api-key'] || '';
      const cmd = String(req.headers['x-goog-upload-command'] || '');
      state.log.push({ method: req.method, url, key, cmd, bytes: raw.length });

      try {
        /* control (standalone use) */
        if (pathname === '/__mock/fail-next' && req.method === 'POST') {
          const b = raw.length ? JSON.parse(raw.toString()) : {};
          api.failNext({ status: b.status || 400, body: b.body });
          return send(res, 200, { ok: true });
        }
        if (pathname === '/__mock/log') {
          return send(res, 200, { log: state.log, generate: state.generate.map((g) => ({ role: g.role, model: g.model, picked: g.picked })), uploads: state.uploads });
        }

        /* models.get — the key check */
        let m = pathname.match(/^\/v1beta\/models\/([^/:]+)$/);
        if (req.method === 'GET' && m) {
          const ok = keyOk(key);
          state.keyChecks.push({ model: m[1], key, ok });
          if (!ok) return send(res, 400, KEY_INVALID_BODY);
          if (m[1] !== model) return send(res, 404, notFound(m[1]));
          return send(res, 200, {
            name: `models/${model}`, version: '3.8', displayName: 'Gemini 3.8 Flash (mock)',
            inputTokenLimit: 1048576, outputTokenLimit: 65536,
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          });
        }

        /* generateContent — the three roles */
        m = pathname.match(/^\/v1beta\/models\/([^/:]+):generateContent$/);
        if (req.method === 'POST' && m) {
          const body = JSON.parse(raw.toString() || '{}');
          const role = roleOf(body);
          const rec = { role, model: m[1], key, body, text: contextText(body), answer: null, picked: null, status: 200 };
          state.generate.push(rec);
          if (state.pendingFail) {
            const f = state.pendingFail;
            state.pendingFail = null;
            rec.status = f.status;
            return send(res, f.status, f.body);
          }
          if (!keyOk(key)) { rec.status = 400; return send(res, 400, KEY_INVALID_BODY); }
          if (m[1] !== model) { rec.status = 404; return send(res, 404, notFound(m[1])); }
          if (role === 'art_director') {
            rec.answer = artDirectorAnswer(body);
            return send(res, 200, candidate(JSON.stringify(rec.answer)));
          }
          if (role === 'agent') {
            const a = agentAnswer(body);
            rec.answer = a.answer;
            rec.picked = a.picked;
            return send(res, 200, candidate(JSON.stringify(a.answer)));
          }
          if (role === 'optimizer') {
            const a = optimizerAnswer(body);
            rec.answer = a.answer;
            rec.picked = a.picked;
            // fenced on purpose: the server strips ```json fences
            return send(res, 200, candidate('```json\n' + JSON.stringify(a.answer) + '\n```'));
          }
          rec.status = 400;
          return send(res, 400, { error: { code: 400, message: 'mock: unknown role', status: 'INVALID_ARGUMENT' } });
        }

        /* resumable upload: start */
        if (req.method === 'POST' && pathname === '/upload/v1beta/files') {
          if (!keyOk(key)) return send(res, 400, KEY_INVALID_BODY);
          let meta = {};
          try { meta = JSON.parse(raw.toString() || '{}').file || {}; } catch { /* empty */ }
          const id = `mock${++seq}`;
          const mimeType = String(req.headers['x-goog-upload-header-content-type'] || meta.mimeType || 'application/octet-stream');
          sessions.set(id, { id, mimeType, displayName: meta.displayName || '', declared: Number(req.headers['x-goog-upload-header-content-length'] || 0), bytes: 0 });
          state.uploadStarts.push({ id, mimeType, displayName: meta.displayName || '', key });
          return send(res, 200, {}, { 'x-goog-upload-url': `${baseUrl}/upload-session/${id}`, 'x-goog-upload-status': 'active' });
        }

        /* resumable upload: chunks */
        m = pathname.match(/^\/upload-session\/([^/]+)$/);
        if (req.method === 'POST' && m) {
          const s = sessions.get(m[1]);
          if (!s) return send(res, 404, { error: { code: 404, message: 'mock: no such upload session', status: 'NOT_FOUND' } });
          s.bytes += raw.length;
          if (!cmd.includes('finalize')) return send(res, 200, {}, { 'x-goog-upload-status': 'active' });
          const file = {
            name: `files/${s.id}`,
            displayName: s.displayName,
            mimeType: s.mimeType,
            sizeBytes: String(s.bytes),
            uri: `${baseUrl}/v1beta/files/${s.id}`,
            state: 'PROCESSING',
            createTime: new Date().toISOString(),
            expirationTime: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
            polls: 0,
          };
          files.set(s.id, file);
          sessions.delete(s.id);
          state.uploads.push({ name: file.name, uri: file.uri, mimeType: file.mimeType, displayName: file.displayName, bytes: s.bytes, declared: s.declared });
          const { polls, ...wire } = file;
          return send(res, 200, { file: wire }, { 'x-goog-upload-status': 'final' });
        }

        /* best-effort cleanup (the server deletes a cancelled or failed upload) */
        m = pathname.match(/^\/v1beta\/files\/([^/:]+)$/);
        if (req.method === 'DELETE' && m) {
          if (!keyOk(key)) return send(res, 400, KEY_INVALID_BODY);
          state.fileDeletes.push(`files/${m[1]}`);
          const had = files.delete(m[1]);
          return had ? send(res, 200, {}) : send(res, 404, { error: { code: 404, message: 'mock: file not found', status: 'NOT_FOUND' } });
        }

        /* processing poll */
        if (req.method === 'GET' && m) {
          if (!keyOk(key)) return send(res, 400, KEY_INVALID_BODY);
          const f = files.get(m[1]);
          if (!f) return send(res, 404, { error: { code: 404, message: 'mock: file not found', status: 'NOT_FOUND' } });
          f.polls++;
          state.filePolls.push(f.name);
          if (f.polls >= processingPolls) f.state = 'ACTIVE';
          const { polls, ...wire } = f;
          return send(res, 200, wire);
        }

        send(res, 404, { error: { code: 404, message: `mock: no route for ${req.method} ${pathname}`, status: 'NOT_FOUND' } });
      } catch (e) {
        send(res, 500, { error: { code: 500, message: `mock crashed: ${e && e.message}`, status: 'INTERNAL' } });
      }
    });
  });

  const api = {
    get port() { return server.address().port; },
    get baseUrl() { return baseUrl; },
    get log() { return state.log; },
    get keyChecks() { return state.keyChecks; },
    get generate() { return state.generate; },
    get uploadStarts() { return state.uploadStarts; },
    get uploads() { return state.uploads; },
    get filePolls() { return state.filePolls; },
    get fileDeletes() { return state.fileDeletes; },
    /** the next generateContent answers {status, body} instead (once) */
    failNext({ status = 400, body } = {}) {
      state.pendingFail = { status, body: body || (status === 401 ? UNAUTHENTICATED_BODY : KEY_INVALID_BODY) };
    },
    close() { return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }); },
  };

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve(api);
    });
  });
}

module.exports = { startMockGemini, parseChainTable, contextText, KEY_INVALID_BODY, UNAUTHENTICATED_BODY, SAFETY_BLOCKED_BODY, FLOORS, MODEL, GOOD_KEY };

if (require.main === module) {
  const port = Number(process.argv[2] || 4010);
  startMockGemini({ port }).then((mock) => {
    console.log(`mock gemini on ${mock.baseUrl} (model ${MODEL}, good key ${GOOD_KEY})`);
    console.log(`run the app with: GEMINI_BASE_URL=${mock.baseUrl} npx tsx server.ts`);
  });
}
