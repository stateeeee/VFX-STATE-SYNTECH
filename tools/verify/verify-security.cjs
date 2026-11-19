/*
 * SECURITY GATE — the "Cancello di sicurezza" of docs/workflow/10-SECURITY-WORKFLOW.md,
 * made executable. Every check attacks the BUILT server (`node dist-server/server.cjs`,
 * started with a clean environment and deliberately WITHOUT NODE_ENV: a built bundle is
 * production whatever NODE_ENV says) and prints one PASS / FAIL line with the measured value.
 *
 *   A  no code served      server bundle, source maps, sources, .env, docs → 404 or the
 *                          SPA's index.html, never code; dist/ holds no .map / server bundle
 *   B  security headers    CSP (frame-ancestors 'self'), X-Frame-Options, nosniff,
 *                          Referrer-Policy, COOP, CORP, Permissions-Policy; no X-Powered-By,
 *                          no HSTS over plain http
 *   C  server key never    GEMINI_API_KEY set in the server's environment: /status says
 *      lent                serverKey:false for every Host (normal, 127.0.0.1, localhost,
 *                          0.0.0.0); a role call with no pasted key → 401
 *   D  cross-site guard    POST /api/gemini/key: foreign Origin, Origin null, Sec-Fetch-Site:
 *                          cross-site, foreign Host → 403; the app's own origin → 200
 *   E  nothing accepted    30 MB upload and 12 × 38 MB role bodies without a usable key →
 *      without a key       401 at once, not one byte in the temp folder, RSS flat
 *   F  rate limit          200 POSTs → the first 30 pass, the rest 429 (+ Retry-After; a
 *                          spoofed X-Forwarded-For buys no new bucket)
 *   G  slow bodies         a trickled role body is cut with 408 at ~11 s, a trickled upload
 *                          at ~30 s; no temp file left; the server then serves normally
 *   H  key-check cap       SYNTECH_MAX_KEY_CHECKS=3: of 6 distinct keys sent at once, 3 wait
 *                          for Google and 3 get 429 at once; a cached key is still admitted.
 *                          A build without the cap FAILS (opt-in SKIP: SEC_ALLOW_SKIP_H=1).
 *   I  effect bridge       each of the 10 effects, framed by a page on ANOTHER origin, never
 *                          answers syn:get-settings, never applies syn:apply-settings or
 *                          syn:theme (the listener checks ev.origin); the same messages from a
 *                          same-origin page work. Also: a foreign page cannot frame the built
 *                          server at all (X-Frame-Options / frame-ancestors).
 *
 * No key, no network, nothing from Google: the Gemini API is the local mock
 * (mock-gemini.cjs, key MOCKKEY, opt-in slow key check for H). The script starts everything
 * itself (mock, one built server per group on a free port, two tiny static servers for I,
 * a private TMPDIR and working folder), restarts the server between groups so the per-client
 * rate limiter (30 POSTs / minute) never leaks from one group into the next, and always kills
 * its children and removes what it created.
 *
 * Needs:  `npm run build` done (dist/ and dist-server/server.cjs); Playwright resolvable
 *         (NODE_PATH=/opt/node22/lib/node_modules is tried automatically); no ffmpeg, no key.
 * Run:    node tools/verify/verify-security.cjs
 *         SEC_ONLY=A,B,E node tools/verify/verify-security.cjs     (a subset of the groups)
 * Time:   about 2.5 minutes (136-155 s measured; G alone waits ~31 s for the upload cut; I loads each effect twice).
 * Exit:   0 when every check is PASS (SKIP does not count), 1 on any FAIL.
 * Quiet machine: G and E measure time and memory. Run it with nothing else heavy going on,
 *         or the 408 windows (8-16 s, 25-40 s) and the RSS figure can wobble.
 * References: 103 checks (A 31, B 13, C 7, D 6, E 8, F 5, G 7, H 6, I 23; the last line says N/N).
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { startMockGemini } = require('./mock-gemini.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const BUNDLE = path.join(ROOT, 'dist-server', 'server.cjs');
const DIST = path.join(ROOT, 'dist');
const GOOD = 'MOCKKEY';
const KEY_HEADER = 'x-gemini-key';
const ONLY = process.env.SEC_ONLY ? new Set(process.env.SEC_ONLY.toUpperCase().split(',')) : null;

/* ── reporting ───────────────────────────────────────────────── */

let total = 0, passed = 0, skipped = 0;
const failures = [];
function check(name, ok, value) {
  total++;
  if (ok) passed++; else failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${value !== undefined && value !== '' ? `  [${value}]` : ''}`);
}
function skip(name, why) {
  skipped++;
  console.log(`SKIP  ${name}  [${why}]`);
}
const info = (s) => console.log(`      ${s}`);
const head = (s) => console.log(`\n== ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (s, n = 90) => String(s).replace(/\s+/g, ' ').slice(0, n);

/* ── cleanup, whatever happens ───────────────────────────────── */

const children = new Set();
const closers = [];
const tmpRoots = [];
function cleanup() {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  children.clear();
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } }
  tmpRoots.length = 0;
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

function mkTmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `syn-sec-${label}-`));
  tmpRoots.push(d);
  return d;
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/* ── the built server, in its own clean world ────────────────── */

/** env: extra variables (GEMINI_API_KEY, SYNTECH_MAX_KEY_CHECKS …). Clean environment: only
 *  PATH/HOME + what is passed; NO NODE_ENV. cwd is a private folder holding a symlink to dist/
 *  (so no .env / .env.local of the project is ever read); TMPDIR is a private empty folder. */
async function startServer(mock, env = {}) {
  const work = mkTmp('work');
  const tmp = mkTmp('tmp');
  fs.symlinkSync(DIST, path.join(work, 'dist'), 'dir');
  const port = await freePort();
  const child = spawn(process.execPath, [BUNDLE], {
    cwd: work,
    env: { PATH: process.env.PATH, HOME: work, TMPDIR: tmp, PORT: String(port), SYNTECH_HOST: '127.0.0.1', GEMINI_BASE_URL: mock.baseUrl, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const exited = new Promise((r) => child.once('exit', r));
  const t0 = Date.now();
  while (!/Server launched on port/.test(log)) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${short(log, 300)}`);
    if (Date.now() - t0 > 20_000) throw new Error(`server did not start: ${short(log, 300)}`);
    await sleep(50);
  }
  return {
    port, pid: child.pid, tmp, work, base: `http://127.0.0.1:${port}`,
    get log() { return log; },
    async stop() {
      try { child.kill('SIGKILL'); } catch { /* gone */ }
      await exited;
      children.delete(child);
    },
    rss() {
      try { return Number((fs.readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+) kB/) || [])[1]) / 1024; } catch { return NaN; }
    },
  };
}

/* ── raw HTTP (Host / Origin overrides that fetch refuses) ───── */

function raw(srv, { method = 'GET', p = '/', headers = {}, body = null, timeout = 30_000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const buf = body === null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const h = { ...headers };
    if (buf && !Object.keys(h).some((k) => k.toLowerCase() === 'content-length')) h['content-length'] = String(buf.length);
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path: p, headers: h, agent: false, setHost: !Object.keys(h).some((k) => k.toLowerCase() === 'host'), timeout }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json, ms: Date.now() - t0 });
      });
      res.on('error', () => resolve({ status: 0, headers: {}, text: '', json: null, ms: Date.now() - t0, error: 'res error' }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, headers: {}, text: '', json: null, ms: Date.now() - t0, error: 'timeout' }); });
    req.on('error', (e) => resolve({ status: 0, headers: {}, text: '', json: null, ms: Date.now() - t0, error: e.code || e.message }));
    if (buf) req.write(buf);
    req.end();
  });
}
/** Default Host is the server's own, unless the caller overrides it (no host key at all = Node adds the normal one). */
const hostHdr = (srv, extra = {}) => ({ host: `127.0.0.1:${srv.port}`, ...extra });
const get = (srv, p, extra) => raw(srv, { p, headers: hostHdr(srv, extra) });

/** A role body that is valid (art-director: one tiny JPEG) — `pad` extra bytes of base64 padding. */
const TINY_JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64').toString('base64');
const roleBody = (pad = 0) => JSON.stringify({ source: { kind: 'image', name: 'x.jpg' }, media: [{ mimeType: 'image/jpeg', data: TINY_JPEG, label: 'SOURCE photo' }], ...(pad ? { pad: 'A'.repeat(pad) } : {}) });
const JSONH = { 'content-type': 'application/json' };

/** Streams `total` bytes to a path (declared Content-Length = total) as fast as the server lets it,
 *  until the response arrives (then stops). Resolves {status, ms, sent, error}. */
function flood(srv, { p, headers, total, first = '', hostOverride, delay = 0 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false, sent = 0;
    const fin = (r) => { if (done) return; done = true; resolve({ ms: Date.now() - t0, sent, ...r }); };
    const req = http.request({
      host: '127.0.0.1', port: srv.port, method: 'POST', path: p, agent: false, setHost: false,
      headers: { host: hostOverride || `127.0.0.1:${srv.port}`, 'content-length': String(total), ...headers },
    }, (res) => {
      res.resume();
      fin({ status: res.statusCode, headers: res.headers });
      req.destroy();
    });
    req.on('error', (e) => setTimeout(() => fin({ status: 0, error: e.code || e.message }), 100)); // a reset may still be followed by the answer
    const chunk = Buffer.alloc(1024 * 1024, 0x41);
    let started = false;
    const pump = () => {
      if (done) return;
      if (!started) { started = true; const b = Buffer.from(first); sent += b.length; req.write(b); }
      while (!done && sent < total) {
        const n = Math.min(chunk.length, total - sent);
        sent += n;
        if (!req.write(n === chunk.length ? chunk : chunk.subarray(0, n))) { req.once('drain', pump); return; }
      }
      if (!done && sent >= total) req.end();
    };
    /* delay > 0: headers first, the body only after the server had `delay` ms to answer (a clean 401 to read);
       delay 0: the body is pushed at once, so a server that refuses and hangs up may reset the connection
       before the client can read its answer (EPIPE / ECONNRESET: refused, but with no status to read). */
    if (delay > 0) { req.flushHeaders(); setTimeout(pump, delay); } else pump();
    setTimeout(() => fin({ status: 0, error: 'timeout' }), 60_000).unref();
  });
}

/** A body that starts fast (`fast` bytes) then trickles one byte every 200 ms. */
function trickle(srv, { p, headers, declared, fast = 100 * 1024 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false, timer = null;
    const fin = (r) => { if (done) return; done = true; clearInterval(timer); resolve({ ms: Date.now() - t0, ...r }); try { req.destroy(); } catch { /* gone */ } };
    const req = http.request({
      host: '127.0.0.1', port: srv.port, method: 'POST', path: p, agent: false, setHost: false,
      headers: { host: `127.0.0.1:${srv.port}`, 'content-length': String(declared), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => fin({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => fin({ status: res.statusCode, text: '' }));
    });
    req.on('error', (e) => fin({ status: 0, error: e.code || e.message }));
    req.write(Buffer.alloc(fast, 0x41));
    timer = setInterval(() => { if (!done) req.write('A'); }, 200);
    setTimeout(() => fin({ status: 0, error: 'timeout (never cut)' }), 90_000).unref();
  });
}

const listTmp = (srv) => { try { return fs.readdirSync(srv.tmp); } catch { return ['<unreadable>']; } };

/* ═══════════════ A · B · C · D — one server WITH a (fake) server key set ═══════════════ */

const SOURCE_MARKERS = ['SYNTECH-SECURITY', 'express', 'GoogleGenAI', 'sourcesContent', '"dependencies"', 'ai-provider', 'GEMINI_API_KEY'];

async function groupABCD(mock) {
  const FAKE_KEY = 'AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0';
  const srv = await startServer(mock, { GEMINI_API_KEY: FAKE_KEY });
  try {
    if (!ONLY || ONLY.has('A')) {
      head('A · no code served');
      const index = await get(srv, '/');
      check('A0 / serves the app (index.html, 200 text/html)', index.status === 200 && /text\/html/.test(index.headers['content-type'] || '') && /<div id="root"/.test(index.text), `${index.status} ${index.headers['content-type']}`);
      const paths = ['/server.cjs', '/server.cjs.map', '/x.map', '/assets/x.js.map', '/server.ts', '/src/App.tsx', '/package.json', '/.env', '/security.ts', '/dist-server/server.cjs', '/docs/workflow/STATE.md',
        '/SERVER.CJS', '/server%2Ecjs', '/server.cjs.', '/server.cjs::$DATA', '/assets/../server.cjs', '/%2e%2e/server.cjs', '/..%2f..%2fpackage.json', '/effects/../../server.ts', '/ai-provider.ts', '/.env.local', '/.git/config', '/node_modules/express/package.json', '/assets/%2e%2e/%2e%2e/package.json'];
      for (const p of paths) {
        const r = await get(srv, p);
        const markers = SOURCE_MARKERS.filter((m) => r.text.includes(m));
        const isIndex = r.status === 200 && r.text === index.text;
        check(`A ${p} → 404 or the SPA index.html, no code`, (r.status === 404 || isIndex || r.status === 400) && markers.length === 0, `${r.status}${isIndex ? ' =index.html' : ''}${markers.length ? ' MARKERS ' + markers.join(',') : ''}`);
      }
      const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
      const files = walk(DIST);
      const bad = files.filter((f) => /\.map$/i.test(f) || path.basename(f).toLowerCase() === 'server.cjs');
      check('A dist/ holds no .map file and no server bundle', bad.length === 0, `${files.length} files${bad.length ? ', BAD: ' + bad.map((f) => path.relative(DIST, f)).join(', ') : ''}`);
      const rel = path.relative(DIST, path.dirname(BUNDLE));
      check('A dist-server/ is not inside dist/', rel.startsWith('..') && !path.isAbsolute(rel) && fs.existsSync(BUNDLE), `server bundle at ${path.relative(ROOT, BUNDLE)}`);
    }

    if (!ONLY || ONLY.has('B')) {
      head('B · security headers');
      const targets = [['/', true], ['/effects/bokeh/index.html', true], ['/api/gemini/status', false]];
      for (const [p, page] of targets) {
        const r = await get(srv, p);
        const h = r.headers;
        const csp = h['content-security-policy'] || '';
        check(`B ${p} 200`, r.status === 200, r.status);
        check(`B ${p} Content-Security-Policy with frame-ancestors 'self'${page ? '' : ' (the server sends it on every response, API included)'}`, /frame-ancestors 'self'/.test(csp) && /default-src 'self'/.test(csp), short(csp, 60));
        check(`B ${p} X-Frame-Options SAMEORIGIN, nosniff, no-referrer, COOP same-origin, CORP same-origin`,
          h['x-frame-options'] === 'SAMEORIGIN' && h['x-content-type-options'] === 'nosniff' && h['referrer-policy'] === 'no-referrer' && h['cross-origin-opener-policy'] === 'same-origin' && h['cross-origin-resource-policy'] === 'same-origin',
          `xfo=${h['x-frame-options']} nosniff=${h['x-content-type-options']} ref=${h['referrer-policy']} coop=${h['cross-origin-opener-policy']} corp=${h['cross-origin-resource-policy']}`);
        const pp = h['permissions-policy'] || '';
        check(`B ${p} Permissions-Policy (camera/mic self only, geolocation/payment/usb off), no X-Powered-By, no HSTS over http`,
          /camera=\(self\)/.test(pp) && /microphone=\(self\)/.test(pp) && /geolocation=\(\)/.test(pp) && /payment=\(\)/.test(pp) && /usb=\(\)/.test(pp) && h['x-powered-by'] === undefined && h['strict-transport-security'] === undefined,
          `pp=${short(pp, 40)} xpb=${h['x-powered-by']} hsts=${h['strict-transport-security']}`);
      }
      const nf = await get(srv, '/api/gemini/nope');
      check('B an unknown /api path → 404 JSON in the contract shape, with the same headers', nf.status === 404 && nf.json && nf.json.error === 'bad_request' && !!nf.headers['content-security-policy'] && nf.headers['x-powered-by'] === undefined, `${nf.status} ${short(nf.text, 50)}`);
    }

    if (!ONLY || ONLY.has('C')) {
      head('C · the server key is never lent');
      info('server started with GEMINI_API_KEY=' + FAKE_KEY.slice(0, 8) + '… (fake)');
      const hosts = [['the normal Host', undefined], ['Host: 127.0.0.1:<port>', `127.0.0.1:${srv.port}`], ['Host: localhost:<port>', `localhost:${srv.port}`], ['Host: 0.0.0.0', '0.0.0.0'], ['Host: [::1]:<port>', `[::1]:${srv.port}`]];
      for (const [label, host] of hosts) {
        const r = await raw(srv, { p: '/api/gemini/status', headers: host ? { host } : {} });
        check(`C /status with ${label} → serverKey:false`, r.status === 200 && r.json && r.json.serverKey === false, `${r.status} ${short(r.text, 60)}`);
      }
      const g0 = mock.generate.length;
      const c0 = mock.keyChecks.length;
      for (const host of [`127.0.0.1:${srv.port}`, `localhost:${srv.port}`]) {
        const r = await raw(srv, { method: 'POST', p: '/api/gemini/art-director', headers: { ...JSONH, host }, body: roleBody() });
        check(`C a valid role call with no pasted key (Host ${host.replace(/:\d+$/, ':<port>')}) → 401 no_key, nothing sent to Google`, r.status === 401 && r.json && r.json.error === 'no_key' && mock.generate.length === g0 && mock.keyChecks.length === c0, `${r.status} ${short(r.text, 50)} generate+${mock.generate.length - g0} keychecks+${mock.keyChecks.length - c0}`);
      }
    }

    if (!ONLY || ONLY.has('D')) {
      head('D · cross-site guard (POST /api/gemini/key)');
      const body = '{}';
      const k = { ...JSONH, [KEY_HEADER]: GOOD };
      const post = (extra, hostOverride) => raw(srv, { method: 'POST', p: '/api/gemini/key', headers: { ...k, host: hostOverride || `127.0.0.1:${srv.port}`, ...extra }, body });
      const k0 = mock.keyChecks.length;
      let r = await post({ origin: 'https://evil.example' });
      check('D Origin: https://evil.example → 403', r.status === 403, `${r.status} ${short(r.text, 40)}`);
      r = await post({ origin: 'null' });
      check('D Origin: null (sandboxed frame / file://) → 403', r.status === 403, r.status);
      r = await post({ 'sec-fetch-site': 'cross-site' });
      check('D Sec-Fetch-Site: cross-site → 403', r.status === 403, r.status);
      r = await post({}, 'evil.example');
      check('D Host: evil.example → 403 (DNS-rebinding guard)', r.status === 403, `${r.status} ${short(r.text, 40)}`);
      check('D none of the refused requests reached Google (mock key checks)', mock.keyChecks.length === k0, `+${mock.keyChecks.length - k0}`);
      r = await post({ origin: `http://127.0.0.1:${srv.port}`, 'sec-fetch-site': 'same-origin' });
      check('D same-origin Origin → 200 (active:true with the mock key)', r.status === 200 && r.json && r.json.active === true, `${r.status} ${short(r.text, 60)}`);
    }
  } finally {
    await srv.stop();
  }
}

/* ═══════════════ E · nothing accepted without a key ═══════════════ */

async function groupE(mock) {
  head('E · no key, nothing accepted (30 MB upload, 12 × 38 MB role bodies)');
  const srv = await startServer(mock);
  try {
    const before = listTmp(srv);
    const refused = (r) => r.status === 401 || (r.status === 0 && /^(EPIPE|ECONNRESET)$/.test(r.error || ''));
    const what = (r) => r.status || r.error;
    const up = await flood(srv, { p: '/api/gemini/upload', headers: { 'content-type': 'video/mp4', [KEY_HEADER]: 'x' }, total: 30 * 1024 * 1024, delay: 150 });
    check('E 30 MB upload with key header "x" → 401 quickly (headers first, answer read)', up.status === 401 && up.ms < 1500, `${up.status} in ${up.ms} ms (150 ms head start included), ${(up.sent / 1048576).toFixed(1)} MB sent before the answer`);
    const up2 = await flood(srv, { p: '/api/gemini/upload', headers: { 'content-type': 'video/mp4' }, total: 30 * 1024 * 1024, delay: 150 });
    check('E 30 MB upload with NO key header → 401 quickly (headers first, answer read)', up2.status === 401 && up2.ms < 1500, `${up2.status} in ${up2.ms} ms, ${(up2.sent / 1048576).toFixed(1)} MB sent`);
    const up3 = await flood(srv, { p: '/api/gemini/upload', headers: { 'content-type': 'video/mp4', [KEY_HEADER]: 'x' }, total: 30 * 1024 * 1024 });
    check('E 30 MB pushed at once with key "x" → refused (401, or the connection dropped: never accepted) quickly', refused(up3) && up3.ms < 3000, `${what(up3)} in ${up3.ms} ms, ${(up3.sent / 1048576).toFixed(1)} MB sent`);
    await sleep(300);
    const after = listTmp(srv);
    check('E not one byte written to the temp upload folder', after.length === before.length && !after.some((n) => n.startsWith('syntech-upload-')), `TMPDIR entries before ${before.length}, after ${after.length}${after.length ? ': ' + after.join(',') : ''}`);

    const rssBefore = srv.rss();
    let peak = rssBefore;
    const sampler = setInterval(() => { const r = srv.rss(); if (r > peak) peak = r; }, 50);
    const t0 = Date.now();
    const res = await Promise.all(Array.from({ length: 12 }, () => flood(srv, { p: '/api/gemini/art-director', headers: JSONH, total: 38 * 1024 * 1024, first: '{"media":"' })));
    const ms = Date.now() - t0;
    await sleep(1500);
    clearInterval(sampler);
    const rssAfter = srv.rss();
    const codes = res.map((r) => r.status || r.error);
    const n401 = res.filter((r) => r.status === 401).length;
    /* How many clients still READ the 401 before the server closes the socket is a race
       on the client side (EPIPE while still writing): not a server property, so not
       asserted here — the next check (headers first) proves the 401 itself. */
    check('E 12 concurrent 38 MB JSON bodies without a key → every one refused (401, or the connection dropped by the server: none accepted)', res.every(refused), `${codes.join(',')} (${n401} x 401) in ${ms} ms`);
    const res2 = await Promise.all(Array.from({ length: 12 }, () => flood(srv, { p: '/api/gemini/art-director', headers: JSONH, total: 38 * 1024 * 1024, first: '{"media":"', delay: 150 })));
    check('E the same 12 with the headers first → all 401', res2.every((r) => r.status === 401), res2.map(what).join(','));
    check('E server RSS growth stays under 150 MB while 12 × 38 MB are offered', peak - rssBefore < 150 && rssAfter - rssBefore < 150, `before ${rssBefore.toFixed(0)} MB, peak ${peak.toFixed(0)} MB, after ${rssAfter.toFixed(0)} MB (peak growth ${(peak - rssBefore).toFixed(0)} MB; sent ${(res.reduce((a, r) => a + r.sent, 0) / 1048576).toFixed(0)} MB total)`);
    check('E the temp folder is still empty', listTmp(srv).length === before.length, `${listTmp(srv).length} entries`);
  } finally {
    await srv.stop();
  }
}

/* ═══════════════ F · rate limit ═══════════════ */

async function groupF(mock) {
  head('F · rate limit (30 POSTs a minute per client)');
  const srv = await startServer(mock);
  try {
    const codes = [];
    let firstRetry = null, firstBody = null;
    for (let i = 0; i < 200; i++) {
      const r = await raw(srv, { method: 'POST', p: '/api/gemini/art-director', headers: hostHdr(srv, JSONH), body: '{}' });
      codes.push(r.status);
      if (r.status === 429 && firstRetry === null) { firstRetry = r.headers['retry-after'] || ''; firstBody = r.text; }
    }
    const n429 = codes.filter((c) => c === 429).length;
    const firstLimited = codes.indexOf(429);
    const notLimited = codes.slice(0, 30).every((c) => c !== 429);
    const rest = codes.slice(30).every((c) => c === 429);
    check('F the first 30 POSTs are not 429, every one after is', notLimited && rest && firstLimited === 30, `first 429 at request #${firstLimited + 1}; ${n429} x 429 of 200; first 30 codes ${[...new Set(codes.slice(0, 30))].join('/')}`);
    check('F 429 count >= 160', n429 >= 160, n429);
    const ra = Number(firstRetry);
    check('F 429 carries Retry-After (1..60 s) and a JSON body', Number.isFinite(ra) && ra >= 1 && ra <= 60 && /"error":"quota"/.test(firstBody || ''), `Retry-After ${firstRetry}, ${short(firstBody || '', 60)}`);
    const spoof = await raw(srv, { method: 'POST', p: '/api/gemini/art-director', headers: hostHdr(srv, { ...JSONH, 'x-forwarded-for': '203.0.113.77' }), body: '{}' });
    check('F a spoofed X-Forwarded-For does not buy a fresh bucket (TRUST_PROXY unset)', spoof.status === 429, spoof.status);
    const g = await get(srv, '/api/gemini/status');
    check('F GET /status has its own (looser) bucket: still 200 while POSTs are limited', g.status === 200, g.status);
  } finally {
    await srv.stop();
  }
}

/* ═══════════════ G · slow bodies ═══════════════ */

async function groupG(mock) {
  head('G · slow bodies are cut (trickle: 100 KB fast, then 1 byte / 200 ms) — takes ~31 s');
  const srv = await startServer(mock);
  try {
    const keyed = { [KEY_HEADER]: GOOD };
    const [role, up] = await Promise.all([
      trickle(srv, { p: '/api/gemini/art-director', headers: { ...JSONH, ...keyed }, declared: 10 * 1024 * 1024 }),
      trickle(srv, { p: '/api/gemini/upload', headers: { 'content-type': 'video/webm', ...keyed }, declared: 100 * 1024 * 1024 }),
    ]);
    check('G trickled role body → 408 at about 11 s (8-16 s)', role.status === 408 && role.ms >= 8000 && role.ms <= 16000, `${role.status ?? role.error} after ${(role.ms / 1000).toFixed(1)} s`);
    check('G trickled upload → 408 at about 30 s (25-40 s)', up.status === 408 && up.ms >= 25000 && up.ms <= 40000, `${up.status ?? up.error} after ${(up.ms / 1000).toFixed(1)} s`);
    let left = listTmp(srv);
    for (let i = 0; i < 20 && left.length; i++) { await sleep(250); left = listTmp(srv); }
    check('G afterwards no temp directory or file is left behind', left.length === 0, left.length ? left.join(',') : 'TMPDIR empty');
    const small = await raw(srv, { method: 'POST', p: '/api/gemini/upload', headers: hostHdr(srv, { 'content-type': 'video/webm', ...keyed }), body: Buffer.alloc(2048, 1), timeout: 30_000 });
    check('G a normal small upload right after → 200 with a fileUri', small.status === 200 && small.json && typeof small.json.fileUri === 'string', `${small.status} ${short(small.text, 60)}`);
    const rc = await raw(srv, { method: 'POST', p: '/api/gemini/art-director', headers: hostHdr(srv, { ...JSONH, ...keyed }), body: roleBody(), timeout: 30_000 });
    check('G a normal role call (mock Gemini) right after → 200', rc.status === 200 && rc.json && !rc.json.error, `${rc.status} ${short(rc.text, 60)}`);
    left = listTmp(srv);
    for (let i = 0; i < 20 && left.length; i++) { await sleep(250); left = listTmp(srv); }
    check('G the normal upload cleaned its temp folder too', left.length === 0, left.length ? left.join(',') : 'TMPDIR empty');
    check('G the server logged the cuts without crashing (still answering /status)', (await get(srv, '/api/gemini/status')).status === 200 && /connection cut/.test(srv.log), srv.log.split('\n').filter((l) => /cut/.test(l)).map((l) => short(l, 70)).join(' | '));
  } finally {
    await srv.stop();
  }
}

/* ═══════════════ H · global key-check cap (spec: SYNTECH_MAX_KEY_CHECKS) ═══════════════ */

async function groupH(mock) {
  head('H · global key-check cap (SYNTECH_MAX_KEY_CHECKS=3, Google answers after ~3 s)');
  const srv = await startServer(mock, { SYNTECH_MAX_KEY_CHECKS: '3' });
  try {
    const keyed = { [KEY_HEADER]: GOOD };
    const prime = await raw(srv, { method: 'POST', p: '/api/gemini/key', headers: hostHdr(srv, { ...JSONH, ...keyed }), body: '{}' });
    check('H setup: MOCKKEY validated once (cached "valid")', prime.status === 200 && prime.json && prime.json.active === true, `${prime.status} ${short(prime.text, 50)}`);
    const slow = Array.from({ length: 6 }, (_, i) => `SLOWKEY${i}abcdefghijklmnopqrstuvwxyz`);
    const k0 = mock.keyChecks.length;
    const t0 = Date.now();
    const calls = slow.map((key) => raw(srv, { method: 'POST', p: '/api/gemini/key', headers: hostHdr(srv, { ...JSONH, [KEY_HEADER]: key }), body: '{}', timeout: 30_000 }));
    await sleep(400);
    const cached = await raw(srv, { method: 'POST', p: '/api/gemini/art-director', headers: hostHdr(srv, { ...JSONH, ...keyed }), body: roleBody(), timeout: 15_000 });
    const res = await Promise.all(calls);
    const fast429 = res.filter((r) => r.status === 429 && r.ms < 500).length;
    const any429 = res.filter((r) => r.status === 429).length;
    const waited = res.filter((r) => r.status !== 429 && r.ms >= 2500).length;
    const summary = res.map((r) => `${r.status}/${r.ms}ms`).join(' ');
    if (any429 === 0 && waited === 6 && process.env.SEC_ALLOW_SKIP_H === '1') {
      skip('H key-check cap: 6 keys sent at once → 3 wait, 3 get 429 at once; a cached key is still admitted', `SKIP (not implemented in this build): all 6 waited for Google, no 429 (${summary}; ${mock.keyChecks.length - k0} upstream checks)`);
      info(`(the cached MOCKKEY role call answered ${cached.status} in ${cached.ms} ms during the burst)`);
    } else {
      check('H exactly 3 of the 6 keys wait for Google (>= 2.5 s)', waited === 3, summary);
      check('H the other 3 get 429 immediately (< 500 ms)', fast429 === 3 && any429 === 3, `${fast429} fast 429 / ${any429} total`);
      const ra429 = res.filter((r) => r.status === 429).map((r) => r.headers['retry-after']);
      check('H each 429 carries Retry-After (1..60 s)', ra429.length > 0 && ra429.every((v) => Number(v) >= 1 && Number(v) <= 60), `Retry-After ${ra429.join(',') || 'none'}`);
      check('H only 3 key checks reached Google', mock.keyChecks.length - k0 === 3, `${mock.keyChecks.length - k0} upstream models.get`);
      check('H meanwhile an already-validated (cached) key is admitted: role call → 200 without waiting', cached.status === 200 && cached.ms < 2500, `${cached.status} in ${cached.ms} ms (total ${Date.now() - t0} ms)`);
    }
  } finally {
    await srv.stop();
  }
}

/* ═══════════════ I · effect bridge origin check ═══════════════ */

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.tflite': 'application/octet-stream', '.data': 'application/octet-stream', '.txt': 'text/plain', '.ico': 'image/x-icon' };

const FRAME_PAGE = `<!doctype html><meta charset="utf-8"><title>frame</title><body style="margin:0">
<iframe id="f" style="width:900px;height:600px;border:0"></iframe>
<script>
window.__replies = [];
window.addEventListener('message', function (e) { if (e.data && typeof e.data === 'object') window.__replies.push({ type: e.data.type, origin: e.origin }); });
document.getElementById('f').src = new URLSearchParams(location.search).get('src');
</script>`;
const MULTI_PAGE = `<!doctype html><meta charset="utf-8"><title>multi</title><body>
<script>
var urls = new URLSearchParams(location.search).get('srcs').split(',');
urls.forEach(function (u, i) { var f = document.createElement('iframe'); f.name = 'f' + i; f.style.cssText = 'width:300px;height:200px'; f.src = u; document.body.appendChild(f); });
</script>`;

/** A static http server WITHOUT any security header. `root` may be null (only the virtual pages). */
function staticServer(root, virtual) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const v = virtual[u.pathname];
    if (v) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(v); }
    if (!root) { res.writeHead(404); return res.end('no'); }
    let p;
    try { p = decodeURIComponent(u.pathname); } catch { res.writeHead(400); return res.end(); }
    let file = path.join(root, p);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); return res.end(); }
    try { if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html'); } catch { /* 404 below */ }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    closers.push(() => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
    resolve({ port: server.address().port, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

function loadPlaywright() {
  try { return require('playwright'); } catch { /* try the shared install */ }
  for (const dir of [process.env.NODE_PATH, '/opt/node22/lib/node_modules'].filter(Boolean).flatMap((x) => x.split(path.delimiter))) {
    try { return require(path.join(dir, 'playwright')); } catch { /* next */ }
  }
  throw new Error('Playwright is not resolvable (set NODE_PATH=/opt/node22/lib/node_modules)');
}

async function groupI(mock) {
  head('I · effect bridge origin check (Playwright, headless Chromium)');
  const registry = fs.readFileSync(path.join(ROOT, 'src', 'effects-registry.ts'), 'utf8');
  const ids = [...registry.matchAll(/^\s*([a-z_]+):\s*\{\s*iframeSrc:/gm)].map((m) => m[1]);
  check('I effect ids read from src/effects-registry.ts: 10', ids.length === 10 && ids.every((id) => fs.existsSync(path.join(DIST, 'effects', id, 'index.html'))), ids.join(','));
  if (ids.length !== 10) return;

  const srv = await startServer(mock);
  const P1 = await staticServer(DIST, { '/__frame.html': FRAME_PAGE });          // the effects, no headers
  const P2 = await staticServer(null, { '/__frame.html': FRAME_PAGE, '/__multi.html': MULTI_PAGE }); // the attacker
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  let cspMsgs = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const watch = (page) => page.on('console', (m) => { if (/Content Security Policy|frame-ancestors|X-Frame-Options/i.test(m.text())) cspMsgs++; });

    /* I1 — a foreign page cannot frame the BUILT server (X-Frame-Options + frame-ancestors) */
    {
      const page = await ctx.newPage();
      watch(page);
      const urls = ids.map((id) => `${srv.base}/effects/${id}/index.html`);
      await page.goto(`http://127.0.0.1:${P2.port}/__multi.html?srcs=${encodeURIComponent(urls.join(','))}`);
      await sleep(3000);
      const frames = page.frames().filter((f) => f !== page.mainFrame());
      const states = [];
      for (const f of frames) {
        let loaded = false;
        try { loaded = await f.evaluate(() => !!window.__synBridge || !!document.querySelector('canvas')); } catch { loaded = false; }
        states.push({ url: f.url(), loaded });
      }
      const blocked = states.filter((s) => !s.loaded).length;
      check('I a foreign page cannot frame any of the 10 effects on the built server (frame blocked)', frames.length === 10 && blocked === 10, `${blocked}/${frames.length} blocked; frame urls: ${[...new Set(states.map((s) => s.url.slice(0, 22)))].join(' ')}`);
      await page.close();
    }

    /* I2/I3 — the listener itself: effects served without X-Frame-Options / CSP on P1 */
    let foreignOk = 0, sameOk = 0;
    const rows = [];
    for (const id of ids) {
      const effectUrl = `http://127.0.0.1:${P1.port}/effects/${id}/index.html`;
      for (const mode of ['foreign', 'same']) {
        const host = mode === 'foreign' ? P2.port : P1.port;
        const page = await ctx.newPage();
        watch(page);
        page.setDefaultTimeout(90_000);
        let verdict = { ok: false, note: '' };
        try {
          await page.goto(`http://127.0.0.1:${host}/__frame.html?src=${encodeURIComponent(effectUrl)}`);
          let frame = null;
          for (let i = 0; i < 400 && !frame; i++) { frame = page.frames().find((f) => f.url().includes(`/effects/${id}/`)); if (!frame) await sleep(100); }
          if (!frame) throw new Error('effect frame never appeared');
          let ready = false;
          for (let i = 0; i < 360 && !ready; i++) { try { ready = await frame.evaluate(() => document.readyState !== 'loading' && !!window.__synBridge); } catch { /* navigating */ } if (!ready) await sleep(250); }
          if (!ready) throw new Error('bridge never ready');
          await sleep(500);
          const target = await frame.evaluate(() => {
            const s = window.__synBridge.collect().sliders || {};
            for (const sid of Object.keys(s)) {
              const el = document.getElementById(sid);
              if (el && el.type === 'range' && !el.disabled && Number(el.max) > Number(el.min)) {
                return { id: sid, cur: el.value, next: el.value !== el.max ? el.max : el.min };
              }
            }
            return null;
          });
          if (!target) throw new Error('no usable slider to attack');
          const readSlider = () => frame.evaluate((sid) => document.getElementById(sid).value, target.id);
          const readTheme = () => frame.evaluate(() => document.documentElement.getAttribute('data-syn-theme'));
          const before = { slider: await readSlider(), theme: await readTheme() };
          const themeNext = before.theme === 'day' ? 'night' : 'day';
          await page.evaluate(({ t, themeNext }) => {
            const w = document.getElementById('f').contentWindow;
            w.postMessage({ type: 'syn:get-settings' }, '*');
            w.postMessage({ type: 'syn:apply-settings', payload: { sliders: { [t.id]: t.next } } }, '*');
            w.postMessage({ type: 'syn:theme', payload: { mode: themeNext } }, '*');
            w.postMessage({ type: 'syn:get-settings' }, '*');
          }, { t: target, themeNext });
          await sleep(1500);
          const replies = (await page.evaluate(() => window.__replies)).filter((r) => r.type === 'syn:settings').length;
          const after = { slider: await readSlider(), theme: await readTheme() };
          const sliderChanged = after.slider !== before.slider;
          const themeChanged = after.theme !== before.theme;
          if (mode === 'foreign') {
            verdict = { ok: replies === 0 && !sliderChanged && !themeChanged, note: `replies ${replies}, slider ${target.id} ${before.slider}→${after.slider}, theme ${before.theme}→${after.theme}` };
          } else {
            verdict = { ok: replies >= 1 && Number(after.slider) === Number(target.next) && themeChanged, note: `replies ${replies}, slider ${target.id} ${before.slider}→${after.slider} (sent ${target.next}), theme ${before.theme}→${after.theme}` };
          }
        } catch (e) {
          verdict = { ok: false, note: `error: ${short(e.message, 100)}` };
        }
        if (mode === 'foreign') { if (verdict.ok) foreignOk++; } else if (verdict.ok) sameOk++;
        check(`I ${id}: ${mode === 'foreign' ? 'FOREIGN origin (other port) gets no reply, nothing applied (settings, theme)' : 'SAME origin gets a reply and the applied value sticks (settings, theme)'}`, verdict.ok, verdict.note);
        rows.push([id, mode, verdict.ok]);
        await page.close();
      }
    }
    check('I 10/10 effects ignore a foreign origin', foreignOk === 10, `${foreignOk}/10`);
    check('I 10/10 effects obey the same origin (the check does not break the app)', sameOk === 10, `${sameOk}/10`);
    info(`(informational) console messages about CSP / framing seen on the test pages: ${cspMsgs}`);
  } finally {
    await browser.close().catch(() => {});
    await P1.close();
    await P2.close();
    await srv.stop();
  }
}

/* ═══════════════ main ═══════════════ */

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(BUNDLE) || !fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('FAIL  no build: run `npm run build` first (dist/ and dist-server/server.cjs are missing)');
    process.exit(1);
  }
  const mock = await startMockGemini({ port: 0, slowKeyMs: 3000 });
  closers.push(() => mock.close());
  console.log(`VFX SYNTECH security gate — built server ${path.relative(ROOT, BUNDLE)}, mock Gemini ${mock.baseUrl}${ONLY ? `, groups ${[...ONLY].join(',')}` : ''}`);
  const groups = [['A', groupABCD], ['E', groupE], ['F', groupF], ['G', groupG], ['H', groupH], ['I', groupI]];
  for (const [name, fn] of groups) {
    if (ONLY && !(name === 'A' ? ['A', 'B', 'C', 'D'].some((x) => ONLY.has(x)) : ONLY.has(name))) continue;
    try {
      await fn(mock);
    } catch (e) {
      check(`${name} group crashed: ${short(e && e.message, 120)}`, false, e && e.stack ? short(e.stack.split('\n')[1] || '', 80) : '');
    }
  }
  for (const c of closers) { try { await c(); } catch { /* gone */ } }
  cleanup();
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n${passed}/${total} PASS${skipped ? `, ${skipped} SKIP` : ''}${failures.length ? `, ${failures.length} FAIL` : ''}  (${secs} s)`);
  if (failures.length) for (const f of failures) console.log(`  FAILED: ${f}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); cleanup(); process.exit(1); });
