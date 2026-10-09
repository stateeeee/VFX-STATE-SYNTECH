/*
 * GEMINI 3.8 — end-to-end suite for the panel, the three roles and the server.
 *
 * Self-contained: it starts a mock of the Gemini API (mock-gemini.cjs), then
 * the app server ITSELF (`npx tsx server.ts`, GEMINI_BASE_URL pointed at the
 * mock, no server key), generates its media with ffmpeg into os.tmpdir(), drives
 * the real UI in Chromium and checks both what the operator sees and what
 * actually reached "Google" (the mock records every request body and prompt).
 *
 *   1  boot: STANDBY, rail locked, "Lab" / "GEMINI 3.8" / "Gemini 3.8" copy
 *   2  a key Google rejects: error shown, still STANDBY, nothing stored; a key
 *      with a curly quote is refused in the browser (invalid characters)
 *   3  a key Google accepts: ACTIVE (green), rail unlocked, survives a reload;
 *      the ACTIVE card's ai-pick-* buttons select each role
 *   4  photo on Home → Art Director: one ≤1024px JPEG + a response schema;
 *      validator filters the proposals; "Use this chain" opens the Lab,
 *      becomes the ART DIRECTION, marks its card 'In use' and lands the panel
 *      on the Agent tab (Direction line; the Art Director's 'Agent →' link);
 *      the Optimizer on the photo (audio off): carriers are not audio routes,
 *      audio_routes is no FAIL, exposure is judged against the source, the
 *      direction reaches the prompt, the silent clip is sampled at 12 fps
 *   5  video on Home → Art Director: the photo's read is flagged as another
 *      source's (its buttons off); uploaded once (Files API) and referenced
 *      by fileUri + videoMetadata; a second run reuses the upload
 *   6  "Use this chain" on the video → Lab with audio OFF → Agent: the Run
 *      switches the Clip audio on itself and says so; Google gets the cached
 *      upload (fileUri, no new upload) + SOURCE/OUTPUT jpegs + a 4s OUTPUT clip
 *      with the music at 12 fps + the art direction; the plan lands on the
 *      ParamBus (protected/invalid keys in `dropped`; the floor raise and the
 *      depth cap in `adjusted`, shown on their applied rows, never under
 *      'Not applied'); Undo reverts only the plan's keys (an edit made after
 *      the run stays) and the Optimizer says the run was undone; a second
 *      run is kept
 *   7  Optimizer: output webm (music, 12 fps) + jpegs + the chain + checks +
 *      the Agent's plan + the art direction; numbered issue cards with their
 *      own refusals; each fix lists its rows before Apply (with its capped
 *      route's note); ONE undo stack shared with the Agent, last in first
 *      out: the Agent's Undo waits ("Undo the Optimizer's fixes first") until
 *      the fix is undone, then restores the values from before its run; after
 *      the Lab is closed and reopened both results say 'Earlier run — on a
 *      Lab that has closed' and their actions are off
 *   8  a clip with no soundtrack: the Agent's Run cannot switch music on, says
 *      so, sends the picture only (no output clip) and its Sends / context
 *      lines stop promising audio; the Optimizer's clip is '(silent)'
 *   9  Google rejects the key mid-session (400 API_KEY_INVALID, then 401):
 *      STANDBY, key form back, rail locked again
 *  10  the HTTP contract: /status, 400 no_media (also for an uploaded source
 *      with no frame from the Lab), 401 no_key, a direction that is not an
 *      object, a SAFETY-blocked answer, the Host guard (a .local name in, any
 *      other name out with a message naming ALLOWED_HOSTS), old endpoints
 *  11  the key never reaches a log, a URL, or Google from the browser
 *
 * Needs: the suite's port FREE — PORT from the environment, default 3000 (the
 *        suite starts its own server there and stops it at the end), ffmpeg,
 *        Playwright resolvable via NODE_PATH like the other suites.
 *        No real key, no network: everything Gemini answers comes from the mock.
 * Run:   node tools/verify/verify-gemini.cjs        (~3.5 min under SwiftShader)
 *        PORT=3100 node tools/verify/verify-gemini.cjs   (next to a dev server)
 * Exit:  0 all PASS, 1 any FAIL.
 */
'use strict';

const { chromium } = require('playwright');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { startMockGemini, KEY_INVALID_BODY, UNAUTHENTICATED_BODY, SAFETY_BLOCKED_BODY, MODEL } = require('./mock-gemini.cjs');

const ROOT = path.resolve(__dirname, '../..');
const PORT = (() => { const n = Number(process.env.PORT); return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3000; })();
const APP = `http://127.0.0.1:${PORT}`;
const GOOD = 'MOCKKEY';
const BAD = 'BADKEY';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ROLE_TIMEOUT = 90_000;
const CLIP_ON_NOTE = 'Clip audio switched on so Gemini can hear the music';
const SILENT_NOTE = 'This clip has no soundtrack: Gemini gets the picture only. Start Track or Mic for music.';
const STALE_LAB = 'Earlier run — on a Lab that has closed';
const AUDIO_SOURCES = ['bass', 'treble', 'loud', 'beat'];
/** contract.ts INLINE_VIDEO_FPS: the sampling rate asked for every inline clip */
const INLINE_FPS = 12;
const T0 = Date.now();

/* ── reporting ───────────────────────────────────────────────── */

const STEPS = [
  [1, 'boot: standby, locked rail, renamed copy'],
  [2, 'bad key rejected, nothing stored; curly quote refused'],
  [3, 'good key → ACTIVE, rail unlocked, survives reload, ai-pick-*'],
  [4, 'photo → Art Director → Use this chain (In use, Agent tab) → Optimizer, audio off'],
  [5, 'video → Art Director: stale read flagged, upload once, then reuse'],
  [6, 'Use this chain → Agent: auto Clip, fileUri + clip, adjusted rows, per-key Undo'],
  [7, 'Optimizer: numbered issues, fix rows, shared LIFO undo, stale results'],
  [8, 'silent clip: no-soundtrack note, picture only, truthful Sends'],
  [9, 'key rejected mid-session → relocked'],
  [10, 'HTTP contract'],
  [11, 'the key never leaks'],
];
const stepOk = new Map(STEPS.map(([n]) => [n, true]));
let current = 0;
let checks = 0;
const check = (name, ok, detail = '') => {
  checks++;
  if (!ok) stepOk.set(current, false);
  const d = String(detail).replace(/\s*\n\s*/g, ' ⏎ ');
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${current}.${name}${d ? `  — ${d}` : ''}`);
  return !!ok;
};
async function step(n, fn) {
  current = n;
  const title = STEPS.find(([k]) => k === n)[1];
  console.log(`\n── STEP ${n}: ${title}  (t+${((Date.now() - T0) / 1000).toFixed(0)}s)`);
  try {
    await fn();
  } catch (e) {
    check(' step crashed', false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '));
  }
}

/* ── small helpers ───────────────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (v, n = 160) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const near = (a, b, tol = 1e-6) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;
const sameMod = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

/** width/height from a JPEG's SOF marker */
function jpegSize(buf) {
  if (!buf || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** what a generateContent request carried: media (decoded) with the label before it */
function mediaOf(rec) {
  const parts = (rec && rec.body && rec.body.contents && rec.body.contents[0] && rec.body.contents[0].parts) || [];
  const media = [];
  parts.forEach((p, i) => {
    if (p.inlineData) {
      const prev = parts[i - 1];
      media.push({ mime: p.inlineData.mimeType, buf: Buffer.from(p.inlineData.data || '', 'base64'), label: (prev && prev.text) || '', meta: p.videoMetadata || null });
    }
  });
  return {
    parts,
    media,
    files: parts.filter((p) => p.fileData),
    text: parts.filter((p) => typeof p.text === 'string').map((p) => p.text).join('\n'),
  };
}

/* ── fixtures (generated, never committed) ───────────────────── */

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', timeout: 90_000 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr || r.error}`);
}

function makeFixtures(dir) {
  const video = path.join(dir, 'clip120.webm');
  const photo = path.join(dir, 'portrait.jpg');
  const silent = path.join(dir, 'silent.webm');
  // 6s 1280x720: a bright square sweeping a dark frame; audio = a 120 BPM kick
  // (one every 0.5s, pitch-dropping sine) with an off-beat hat
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=0x0b0b14:s=1280x720:r=30:d=6',
    '-f', 'lavfi', '-i', 'color=c=white:s=160x160:r=30:d=6',
    '-f', 'lavfi', '-i',
    "aevalsrc='0.9*sin(2*PI*55*mod(t,0.5)+14*(1-exp(-30*mod(t,0.5))))*exp(-9*mod(t,0.5))+0.12*(random(0)*2-1)*exp(-70*mod(t+0.25,0.5))':s=48000:c=stereo:d=6",
    '-filter_complex',
    "[0:v][1:v]overlay=x='100+900*(0.5+0.5*sin(2*PI*t/3))':y='280+150*sin(2*PI*t/2)':shortest=1,format=yuv420p[v]",
    '-map', '[v]', '-map', '2:a',
    '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8',
    '-c:a', 'libopus', '-b:a', '96k', '-t', '6', video,
  ]);
  // 1024x768: a person-ish figure (head + torso) in front of two street lights
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=0x1a1f2e:s=1024x768:d=1',
    '-vf', [
      'drawbox=x=0:y=560:w=1024:h=208:color=0x2a2a30:t=fill',
      'drawbox=x=432:y=372:w=160:h=396:color=0x7a4a3a:t=fill',
      'drawbox=x=467:y=228:w=90:h=124:color=0xd9a07a:t=fill',
      'drawbox=x=120:y=90:w=40:h=40:color=0xfff2c0:t=fill',
      'drawbox=x=860:y=140:w=36:h=36:color=0xffe0a0:t=fill',
      'noise=alls=10:allf=t',
    ].join(','),
    '-frames:v', '1', '-q:v', '3', photo,
  ]);
  // 4s 640x360 with NO audio track at all: an orange square drifting on dark
  ffmpeg([
    '-f', 'lavfi', '-i', 'color=c=0x14100b:s=640x360:r=30:d=4',
    '-f', 'lavfi', '-i', 'color=c=0xff8a2a:s=120x120:r=30:d=4',
    '-filter_complex', "[0:v][1:v]overlay=x='60+400*(0.5+0.5*sin(2*PI*t/2))':y=120:shortest=1,format=yuv420p[v]",
    '-map', '[v]', '-an',
    '-c:v', 'libvpx', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '8', '-t', '4', silent,
  ]);
  return { video, photo, silent };
}

/* ── the app server, started by the suite ────────────────────── */

let server = null;
let serverOut = '';

function startServer(baseUrl) {
  // no server key (the panel's pasted key is the only one), default model.
  // DISABLE_HMR (vite.config.ts): no HMR and no file watcher, so the page
  // cannot be reloaded mid-run because some file in the tree changed.
  // ALLOWED_HOSTS '' (set, so a .env.local cannot fill it): the Host guard's default rule
  const env = { ...process.env, PORT: String(PORT), GEMINI_BASE_URL: baseUrl, GEMINI_API_KEY: '', GEMINI_MODEL: '', ALLOWED_HOSTS: '', DISABLE_HMR: 'true' };
  delete env.NODE_ENV; // dev mode, like `npm run dev`
  server = spawn('npx', ['tsx', 'server.ts'], { cwd: ROOT, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });
}

async function waitForServer(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (server.exitCode !== null) throw new Error(`server exited early (${server.exitCode}): ${serverOut.slice(-600)}`);
    try {
      const r = await fetch(`${APP}/api/gemini/status`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error(`server not up on :${PORT} after ${ms}ms: ${serverOut.slice(-600)}`);
}

async function stopServer() {
  if (!server) return;
  const exited = new Promise((r) => (server.exitCode !== null ? r() : server.once('exit', r)));
  try { server.kill('SIGTERM'); } catch { /* gone */ }
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ }
  await Promise.race([exited, sleep(4000)]);
  if (await portOpen(PORT)) spawnSync('fuser', ['-k', `${PORT}/tcp`]);
}

/* ── page helpers ────────────────────────────────────────────── */

const sel = (tid) => `[data-testid="${tid}"]`;
/* DOM clicks: under SwiftShader the Lab renders at a few fps and Playwright's
   actionability waits can stall; the buttons are plain React onClick. */
const domClick = (page, tid) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.click();
  return true;
}, sel(tid));
const visible = (page, tid, timeout = 10_000) =>
  page.waitForSelector(sel(tid), { state: 'visible', timeout }).then(() => true).catch(() => false);
const text = (page, tid) => page.evaluate((s) => (document.querySelector(s)?.textContent || '').trim(), sel(tid));
const badge = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="ai-status"]');
  return el ? { text: el.textContent.trim().toUpperCase(), cls: el.className } : { text: '', cls: '' };
});
const waitBadge = (page, want, timeout = 15_000) => page.waitForFunction(
  (w) => (document.querySelector('[data-testid="ai-status"]')?.textContent || '').trim().toUpperCase() === w,
  want, { timeout },
).then(() => true).catch(() => false);
const rail = (page) => page.evaluate(() => ['art_director', 'agent', 'optimizer'].map((k) => {
  const b = document.querySelector(`[data-testid="nav-gemini-${k}"]`);
  return b ? b.disabled : null;
}));
/** the rail's boxes: unlocking may change colour and cursor, never a size */
const railBoxes = (page) => page.evaluate(() => ['nav-ailab', 'nav-gemini-art_director', 'nav-gemini-agent', 'nav-gemini-optimizer'].map((t) => {
  const r = document.querySelector(`[data-testid="${t}"]`)?.getBoundingClientRect();
  return r ? [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10) : null;
}));
const storedKey = (page) => page.evaluate(() => localStorage.getItem('syntech.geminiKey'));
const busState = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__SYN.bus.state)));

/** the Gemini panel's whole visible text */
const panelAll = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="ai-status"]')?.closest('.h-full.w-full.overflow-hidden');
  return root ? root.innerText : '';
}).catch(() => '');
const sendsLine = (page) => page.evaluate(() => (document.body.innerText.match(/Sends: [^\n]+/) || [''])[0]);
const audioState = (page) => page.evaluate(() => ({ mode: window.__SYN.audio.mode, active: !!window.__SYN.audio.active }));
const gone = (page, tid) => page.evaluate((s) => !document.querySelector(s), sel(tid));
const disabled = (page, tid) => page.evaluate((s) => { const el = document.querySelector(s); return el ? el.disabled : null; }, sel(tid));
/** the panel's mode title (h2): 'Agent', 'Optimizer', 'Art Director' */
const onTab = (page, title, timeout = 5000) => page.waitForFunction(
  (t) => [...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === t), title, { timeout },
).then(() => true).catch(() => false);

/** the Art Director's proposal cards: chosen ('In use', full violet border) or not */
const proposalMarks = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="ai-ad-proposal-"]')].map((c) => ({
  inUse: c.getAttribute('data-in-use') === 'true',
  violet: /(^|\s)border-\[#8b5cf6\](\s|$)/.test(c.className),
  btn: (c.querySelector('[data-testid^="ai-ad-apply-"]')?.textContent || '').trim(),
})));
const marksOk = (m) => m.length > 1 && m[0].inUse && m[0].violet && m[0].btn === 'In use'
  && m.slice(1).every((x) => !x.inUse && !x.violet && x.btn === 'Use this chain');

/** a ChangeList's rows (title = the key; a route row's label ends ' ~'), with
 *  the validator's note shown on the row ([data-adjusted]) */
const changeRows = (page, tid) => page.evaluate((s) => [...document.querySelectorAll(`${s} > li`)].map((li) => ({
  key: li.getAttribute('title') || '',
  text: li.textContent.replace(/\s+/g, ' ').trim(),
  route: / ~: /.test(li.textContent),
  note: (li.querySelector('[data-adjusted]')?.textContent || '').trim(),
})), sel(tid));
/** the text of every 'Not applied:' block inside `tid`, each with whether it
 *  sits in an Optimizer issue card */
const notAppliedBlocks = (page, tid) => page.evaluate((s) => [...(document.querySelector(s)?.querySelectorAll('span') || [])]
  .filter((x) => x.textContent.trim() === 'Not applied:')
  .map((x) => ({ text: x.parentElement.textContent, inIssue: !!x.closest('[data-testid^="ai-opt-issue-"]') })), sel(tid));
/** the panel's number format (AiDirector fmtNum) */
const fmtNum = (v) => { const a = Math.abs(v); return String(Number(v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2))); };
/** keys whose base or route differ between two bus snapshots */
const busDiff = (a, b, keys = Object.keys(a)) => keys.filter((k) => !a[k] || !b[k] || !near(a[k].base, b[k].base, 1e-9) || !sameMod(a[k].mod, b[k].mod));

/** moves a rack slider the way a hand does: React sees an input event */
const setRange = (page, tid, value) => page.evaluate(([s, v]) => {
  const el = document.querySelector(s);
  if (!el) return null;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
}, [sel(tid), value]);

/** a plain GET with a chosen Host header (fetch will not let a caller set Host) */
function rawGet(pathname, host) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', headers: { host } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { /* not JSON */ } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('error', (e) => resolve({ status: 0, json: null, err: String(e) }));
    req.end();
  });
}

/** fill + submit the key form (React-controlled input: Playwright fill fires input events) */
async function submitKey(page, key) {
  await page.locator(sel('ai-key-input')).fill(key);
  await domClick(page, 'ai-key-submit');
}

/** opens a role tab via the rail unless it is already on screen (the rail toggles) */
async function openRole(page, mode, runTid) {
  if (await page.locator(sel(runTid)).isVisible().catch(() => false)) return true;
  await domClick(page, `nav-gemini-${mode}`);
  return visible(page, runTid, 10_000);
}

/** the Gemini panel's visible text (busy line, inline error) — for failure details */
const panelText = (page) => page.evaluate(() => {
  const root = document.querySelector('[data-testid="ai-status"]')?.closest('.h-full.w-full.overflow-hidden');
  return (root ? root.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 300);
}).catch(() => '');

/** clicks `tid` and returns the server's answer to `endpoint`. A role run that
 *  outlives the timeout is waited out (its busy line gone) before the step
 *  fails, so a late answer cannot leak into the next step. */
async function roleCall(page, endpoint, tid, timeout = ROLE_TIMEOUT) {
  const t = Date.now();
  const resp = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === 'POST', { timeout });
  if (!(await domClick(page, tid))) throw new Error(`no [data-testid=${tid}] to click`);
  let r;
  try {
    r = await resp;
  } catch {
    const busy = await panelText(page);
    await page.waitForFunction(() => !document.querySelector('.animate-spin'), null, { timeout: 60_000 }).catch(() => {});
    throw new Error(`no answer from ${endpoint} within ${timeout / 1000}s; panel: ${busy}`);
  }
  let json = null;
  try { json = await r.json(); } catch { /* not JSON */ }
  return { status: r.status(), json, sec: ((Date.now() - t) / 1000).toFixed(1) };
}

/** opens the Lab (nav-ailab) and waits for a fresh engine + handle */
async function openLabVia(page, how) {
  await page.evaluate(() => { window.__SYN = undefined; });
  await how();
  return page.waitForFunction(
    () => !!(window.__SYN && window.__SYN.lab && window.__SYN.bus && document.querySelector('[data-testid="chain-canvas"]')),
    null, { timeout: 20_000 },
  ).then(() => true).catch(() => false);
}

const labOrder = (page) => page.evaluate(() => window.__SYN.lab.chainState().order.join('>'));
async function waitOrder(page, want, ms = 8000) {
  const end = Date.now() + ms;
  let got = '';
  while (Date.now() < end) {
    got = await labOrder(page).catch(() => '');
    if (got === want) return got;
    await sleep(250);
  }
  return got;
}

/* ═══════════════════════════════════════════════════════════════ */

let mock = null;
let browser = null;
let tmp = null;
let finished = false;

async function cleanup() {
  try { if (browser) await browser.close(); } catch { /* closed */ }
  await stopServer().catch(() => {});
  try { if (mock) await mock.close(); } catch { /* closed */ }
  try { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

const watchdog = setTimeout(async () => {
  if (finished) return;
  console.log(`\nFAIL  watchdog: the suite ran past 9 minutes (stuck in step ${current})`);
  await cleanup();
  process.exit(1);
}, 9 * 60_000);

process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

(async () => {
  /* ── setup ── */
  if (await portOpen(PORT)) {
    console.log(`FAIL  port ${PORT} is busy — stop the dev server first (fuser -k ${PORT}/tcp); this suite starts its own.`);
    process.exit(1);
  }
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syntech-gemini-'));
  const fx = makeFixtures(tmp);
  const videoBytes = fs.statSync(fx.video).size;
  console.log(`fixtures: ${path.basename(fx.video)} ${(videoBytes / 1024).toFixed(0)}KB, ${path.basename(fx.photo)} ${(fs.statSync(fx.photo).size / 1024).toFixed(0)}KB, ${path.basename(fx.silent)} ${(fs.statSync(fx.silent).size / 1024).toFixed(0)}KB (no audio) in ${tmp}`);

  mock = await startMockGemini({ port: 0 });
  console.log(`mock gemini on ${mock.baseUrl}`);
  startServer(mock.baseUrl);
  await waitForServer(90_000);
  console.log(`app server up (t+${((Date.now() - T0) / 1000).toFixed(0)}s)`);

  browser = await chromium.launch({
    ...(fs.existsSync(CHROME) ? { executablePath: CHROME } : {}),
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb', '--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 953 } });
  /* Vite's dev client still opens its HMR socket on :24678 even with HMR off.
     When another dev server on this machine holds that port, the handshake
     fails and the client throws an unhandled "WebSocket closed without
     opened." — a pageerror that has nothing to do with the app. The socket is
     answered here (mocked, never forwarded), so the run does not depend on
     what else is running on the machine. */
  await ctx.routeWebSocket(/:24678\//, () => {});
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));
  /* main-frame loads: exactly two are expected (the first visit, the reload of
     step 3) — anything else means the page reloaded under the suite's feet */
  const loads = [];
  page.on('load', () => loads.push(`t+${((Date.now() - T0) / 1000).toFixed(0)}s (step ${current})`));
  page.on('crash', () => pageErrors.push(`renderer crashed in step ${current}`));
  /* every request the PAGE makes: where the key goes, and that Google is never called from the browser */
  const pageReqs = [];
  /* …and the JSON body of every role call, as the browser sent it */
  const roleBodies = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.startsWith('data:') || u.startsWith('blob:')) return;
    pageReqs.push({ url: u, method: r.method(), key: r.headers()['x-gemini-key'] || null });
    if (r.method() === 'POST' && /\/api\/gemini\/(art-director|agent|optimizer)$/.test(u)) {
      let body = null;
      try { body = r.postDataJSON(); } catch { /* not JSON */ }
      roleBodies.push({ url: u, body });
    }
  });
  const lastBody = (endpoint) => { const b = [...roleBodies].reverse().find((x) => x.url.endsWith(endpoint)); return b ? b.body : null; };
  const uploadCalls = () => pageReqs.filter((x) => x.url.endsWith('/api/gemini/upload')).length;

  /* shared across steps */
  let agentPicked = null;
  let agentPlan = null;
  /** the bus right before the Agent's second run (step 6): what its Undo restores in step 7 */
  let beforeRun2 = null;
  let lockedRail = null;
  let uploadedUri = null;

  /* ── 1 ── */
  await step(1, async () => {
    await page.goto(APP, { waitUntil: 'load', timeout: 90_000 });
    check(' key form rendered', await visible(page, 'ai-key-input', 30_000));
    // the boot check is over once the submit button stops saying "Checking…"
    await page.waitForFunction(() => /^connect$/i.test((document.querySelector('[data-testid="ai-key-submit"]')?.textContent || '').trim()), null, { timeout: 15_000 }).catch(() => {});
    await sleep(800);
    check(' no pageerror on boot', pageErrors.length === 0, pageErrors.join(' | '));
    const b = await badge(page);
    check(" ai-status reads STANDBY", b.text === 'STANDBY', b.text);
    check(' STANDBY is grey (neutral), not green', /neutral/.test(b.cls) && !/green/.test(b.cls), short(b.cls, 120));
    const r = await rail(page);
    check(' nav-gemini-art_director/agent/optimizer disabled', r.every((d) => d === true), JSON.stringify(r));
    lockedRail = await railBoxes(page);
    const copy = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="nav-ailab"]');
      const attrs = [...document.querySelectorAll('[title],[placeholder],[aria-label]')]
        .map((e) => `${e.getAttribute('title') || ''} ${e.getAttribute('placeholder') || ''} ${e.getAttribute('aria-label') || ''}`).join(' ');
      return {
        lab: nav ? nav.textContent.trim() : null,
        railCaption: [...document.querySelectorAll('nav span')].some((s) => s.textContent.trim() === 'GEMINI 3.8'),
        panelTitle: [...document.querySelectorAll('h2')].map((h) => h.textContent.trim()).filter((t) => /gemini/i.test(t)),
        banned: [document.body.innerText, document.body.textContent, attrs, document.title].join('\n').match(/\bAI\s*Lab\b|Gemini\s*Pro/gi),
      };
    });
    check(" nav-ailab text is 'Lab'", copy.lab === 'Lab', String(copy.lab));
    check(" rail caption 'GEMINI 3.8'", copy.railCaption);
    check(" panel title 'Gemini 3.8'", copy.panelTitle.includes('Gemini 3.8'), JSON.stringify(copy.panelTitle));
    check(" no 'AI Lab' / 'Gemini Pro' anywhere on the page", !copy.banned, JSON.stringify(copy.banned));
    check(' boot asked Google nothing (no key yet)', mock.keyChecks.length === 0 && mock.generate.length === 0, `keyChecks=${mock.keyChecks.length}`);
  });

  /* ── 2 ── */
  await step(2, async () => {
    const n0 = mock.keyChecks.length;
    await submitKey(page, BAD);
    check(' ai-key-error visible', await visible(page, 'ai-key-error', 20_000), await text(page, 'ai-key-error'));
    check(' the error says Google rejected the key', /rejected/i.test(await text(page, 'ai-key-error')), await text(page, 'ai-key-error'));
    const b = await badge(page);
    check(' still STANDBY', b.text === 'STANDBY', b.text);
    check(' rail still locked', (await rail(page)).every((d) => d === true));
    check(" localStorage 'syntech.geminiKey' not set", (await storedKey(page)) === null, String(await storedKey(page)));
    const kc = mock.keyChecks.slice(n0);
    check(' Google saw exactly one key check, with the header key BADKEY', kc.length === 1 && kc[0].key === BAD && kc[0].ok === false, short(kc));

    // a key copied with a typographic quote cannot travel in a header: the
    // form says so, instead of a fetch failure that reads 'Server not reachable'
    const n1 = mock.keyChecks.length;
    const q0 = pageReqs.filter((x) => x.url.endsWith('/api/gemini/key')).length;
    await submitKey(page, `${GOOD}’`);
    await page.waitForFunction(() => /invalid characters/.test(document.querySelector('[data-testid="ai-key-error"]')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const qe = await text(page, 'ai-key-error');
    check(" a key with a curly quote → 'The key contains invalid characters — copy it again'", qe === 'The key contains invalid characters — copy it again', qe);
    check(' …refused in the browser: no /api/gemini/key call, no key check at Google',
      pageReqs.filter((x) => x.url.endsWith('/api/gemini/key')).length === q0 && mock.keyChecks.length === n1,
      `key calls +${pageReqs.filter((x) => x.url.endsWith('/api/gemini/key')).length - q0}, Google +${mock.keyChecks.length - n1}`);
    check(' …still STANDBY, nothing stored', (await badge(page)).text === 'STANDBY' && (await storedKey(page)) === null);
  });

  /* ── 3 ── */
  await step(3, async () => {
    const n0 = mock.keyChecks.length;
    await submitKey(page, GOOD);
    check(' badge turns ACTIVE', await waitBadge(page, 'ACTIVE', 20_000), (await badge(page)).text);
    const b = await badge(page);
    const dot = await page.evaluate(() => document.querySelector('[data-testid="ai-status"] span')?.className || '');
    check(' ACTIVE is green', /green/.test(b.cls) && /bg-green/.test(dot), short(`${b.cls} | dot: ${dot}`, 140));
    check(' rail unlocked (3 buttons enabled)', (await rail(page)).every((d) => d === false), JSON.stringify(await rail(page)));
    const open = await railBoxes(page);
    check(' unlocking changed no rail box (same x/y/w/h)', JSON.stringify(open) === JSON.stringify(lockedRail), `${JSON.stringify(lockedRail)} → ${JSON.stringify(open)}`);
    check(" key stored in localStorage 'syntech.geminiKey'", (await storedKey(page)) === GOOD);
    check(' key form gone', !(await page.locator(sel('ai-key-input')).isVisible().catch(() => false)));
    const kc = mock.keyChecks.slice(n0);
    check(` Google was asked models.get on '${MODEL}' with the pasted key`, kc.length === 1 && kc[0].model === MODEL && kc[0].key === GOOD && kc[0].ok, short(kc));

    const n1 = mock.keyChecks.length;
    await page.reload({ waitUntil: 'load', timeout: 60_000 });
    check(' after reload: ACTIVE again from the stored key', await waitBadge(page, 'ACTIVE', 20_000), (await badge(page)).text);
    check(' after reload: rail unlocked', (await rail(page)).every((d) => d === false));
    check(' after reload: the stored key was re-validated', mock.keyChecks.slice(n1).some((k) => k.key === GOOD && k.ok));

    // the ACTIVE card repeats the rail's three roles (on a short window the
    // rail's lower buttons sit under the meter): each one selects its mode
    check(' ACTIVE card shows ai-pick-art_director / agent / optimizer',
      await page.evaluate(() => ['art_director', 'agent', 'optimizer'].every((m) => !!document.querySelector(`[data-testid="ai-pick-${m}"]`))));
    for (const [m, title] of [['agent', 'Agent'], ['optimizer', 'Optimizer'], ['art_director', 'Art Director']]) {
      const clicked = await domClick(page, `ai-pick-${m}`);
      const on = await page.waitForFunction((t) => [...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === t), title, { timeout: 5000 }).then(() => true).catch(() => false);
      const cardGone = await gone(page, `ai-pick-${m}`);
      const body = m === 'art_director' ? await visible(page, 'ai-ad-run', 5000) : await visible(page, 'ai-open-lab', 5000);
      check(` ai-pick-${m} selects ${title} (title, its tab, the card gone)`, clicked && on && cardGone && body, `clicked=${clicked} title=${on} cardGone=${cardGone} tab=${body}`);
      if (m === 'agent') {
        check(" …on Home it is 'Open in Lab', off until the INPUT node has a source", await page.evaluate(() => document.querySelector('[data-testid="ai-open-lab"]').disabled));
      }
      if (m !== 'art_director') {
        await domClick(page, `nav-gemini-${m}`); // the rail toggles back to the card
        await visible(page, 'ai-pick-art_director', 5000);
      }
    }
  });

  /* ── 4 ── */
  await step(4, async () => {
    await page.locator(sel('source-file')).setInputFiles(fx.photo);
    check(' photo shown on Home (hero-image)', await visible(page, 'hero-image', 10_000));
    check(' Art Director tab opens from the rail', await openRole(page, 'art_director', 'ai-ad-run'));
    const sends = await page.evaluate(() => (document.body.innerText.match(/Sends: [^\n]+/) || [''])[0]);
    check(" the panel says what leaves: '1 photo'", /1 photo/.test(sends), sends);

    const g0 = mock.generate.length;
    const r = await roleCall(page, '/api/gemini/art-director', 'ai-ad-run');
    check(' server answered 200', r.status === 200, `${r.status} in ${r.sec}s ${short(r.json, 90)}`);
    check(' result card shown', await visible(page, 'ai-ad-result', 10_000));
    const recs = mock.generate.slice(g0);
    check(' Google got exactly one generateContent, role Art Director', recs.length === 1 && recs[0].role === 'art_director', recs.map((x) => x.role).join(','));
    const rec = recs[0];
    const m = mediaOf(rec);
    const jpg = m.media[0];
    const dims = jpg ? jpegSize(jpg.buf) : null;
    check(' exactly one inline image/jpeg, nothing else', m.media.length === 1 && jpg.mime === 'image/jpeg' && m.files.length === 0,
      m.media.map((x) => `${x.mime}:${x.buf.length}`).join(',') + ` files=${m.files.length}`);
    check(' the JPEG is ≤ 400KB and real', jpg && jpg.buf.length <= 400 * 1024 && jpg.buf.length > 2048 && !!dims, jpg ? `${(jpg.buf.length / 1024).toFixed(1)}KB ${dims ? `${dims.w}x${dims.h}` : 'not a JPEG'}` : 'none');
    check(' long side ≤ 1024px', dims && Math.max(dims.w, dims.h) <= 1024, dims ? `${dims.w}x${dims.h}` : '');
    check(" labelled 'SOURCE photo'", jpg && /^SOURCE photo/.test(jpg.label), jpg && jpg.label);
    const gc = (rec && rec.body.generationConfig) || {};
    check(' a responseJsonSchema (JSON mode) was sent', gc.responseMimeType === 'application/json' && !!(gc.responseJsonSchema && gc.responseJsonSchema.properties && gc.responseJsonSchema.properties.proposals), short(Object.keys(gc)));
    check(` model ${MODEL}, key in the header`, rec.model === MODEL && rec.key === GOOD, `${rec.model} key=${rec.key ? 'header' : 'none'}`);
    check(' context says it is a still photo', /still photo/.test(m.text));

    // the validator: 4 mock proposals → 3 (the all-invalid one dropped), ids cleaned, raw-source effect first
    const props = (r.json && r.json.proposals) || [];
    const chains = props.map((p) => p.chain.join('>'));
    check(' validator kept 3 proposals with valid chains', props.length === 3 && chains[0] === 'analog>anamorphic_lab' && chains[1] === 'blob_tracker>anamorphic_lab' && chains[2] === 'bokeh', JSON.stringify(chains));
    const ui = await page.evaluate(() => ({
      apply: document.querySelectorAll('[data-testid^="ai-ad-apply-"]').length,
      text: document.querySelector('[data-testid="ai-ad-result"]')?.textContent || '',
    }));
    check(' 3 proposal cards rendered, the dropped one absent', ui.apply === 3 && ui.text.includes('MOCK-WHY-0') && !ui.text.includes('MOCK-WHY-DROPPED'), `cards=${ui.apply}`);
    check(' Read card rendered (subject, palette)', /una figura sola/.test(ui.text) && /ambra/.test(ui.text));

    const opened = await openLabVia(page, () => domClick(page, 'ai-ad-apply-0'));
    check(" 'Use this chain' opens the Lab", opened);
    if (opened) {
      const order = await waitOrder(page, 'analog>anamorphic_lab');
      check(' Lab chain = analog → anamorphic_lab', order === 'analog>anamorphic_lab', order);
      const ready = await page.evaluate(() => window.__SYN.lab.whenReady(20_000));
      const kind = await page.evaluate(() => window.__SYN.lab.sourceKind());
      check(' the Lab renders the photo', ready === true && kind === 'image', `ready=${ready} kind=${kind}`);
    }
    if (!opened) return;

    // the handoff: creative mind → operator. The panel lands on the Agent with
    // the direction on top; the chosen card reads 'In use'
    check(" 'Use this chain' lands the panel on the Agent tab (title + Run)", (await onTab(page, 'Agent')) && await visible(page, 'ai-agent-run', 5000));
    await sleep(1300); // the tab polls the Lab once a second
    const adir = await text(page, 'ai-agent-direction');
    check(" …with the line 'Direction: Notte analogica' on top", adir === 'Direction: Notte analogica' && !(await gone(page, 'ai-agent-direction-clear')), adir);
    const marks = await proposalMarks(page);
    check(" the chosen proposal reads 'In use' with a full violet border; the others 'Use this chain'", marksOk(marks), JSON.stringify(marks));
    check(' Art Director tab back on screen (rail)', await openRole(page, 'art_director', 'ai-ad-run'));
    const ddir = await text(page, 'ai-ad-direction');
    check(" the Art Director shows 'Direction: Notte analogica' with an 'Agent →' link", ddir === 'Direction: Notte analogica' && (await text(page, 'ai-ad-direction-next')) === 'Agent →', ddir);
    check(" …its read of this photo is current (no stale line, its buttons on)", (await gone(page, 'ai-ad-stale')) && (await disabled(page, 'ai-ad-apply-1')) === false);
    await domClick(page, 'ai-ad-direction-next');
    check(" 'Agent →' opens the Agent tab", (await onTab(page, 'Agent')) && await visible(page, 'ai-agent-run', 5000));

    // ── the Optimizer on the photo, audio OFF (the Lab's default) ──
    check(' audio is off in the Lab', !(await audioState(page)).active, JSON.stringify(await audioState(page)));
    check(' Optimizer tab on screen (Lab)', await openRole(page, 'optimizer', 'ai-opt-run'));
    await sleep(1300); // the tab polls the Lab once a second
    const dir = await text(page, 'ai-opt-direction');
    check(" 'Use this chain' became the direction: 'Direction: Notte analogica' + a clear ×", dir === 'Direction: Notte analogica' && !(await gone(page, 'ai-opt-direction-clear')), dir);
    const pt = await panelAll(page);
    check(' a photo with audio off: music routes wait for Track or Mic (no Clip offered)', /No music on: music routes wait for it — start Track or Mic in the Lab\./.test(pt), short(pt.replace(/\s+/g, ' '), 200));
    const al = await text(page, 'ai-opt-agent-line');
    check(" no Agent run on this Lab: 'No Agent run yet: judges the Lab as it is'", al === 'No Agent run yet: judges the Lab as it is', al);
    const os = await sendsLine(page);
    check(" Sends: '4s output clip (silent) + 1 frame pair + 2s of live signals + the chain + the checks + the art direction'",
      os === 'Sends: 4s output clip (silent) + 1 frame pair + 2s of live signals + the chain + the checks + the art direction', os);
    // the operator wires one ordinary music route by hand (the rack's ~ button:
    // off → bass): with audio off it is waiting for music, not an error
    const wired = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-testid^="mod-src-anamorphic_lab-"]')) {
        const key = `anamorphic_lab.${el.getAttribute('data-testid').slice('mod-src-anamorphic_lab-'.length)}`;
        const st = window.__SYN.bus.state[key];
        if (!st || st.mod) continue;
        el.click();
        return key;
      }
      return null;
    });
    await sleep(200);
    const wiredMod = wired ? (await busState(page))[wired].mod : null;
    check(' a hand-wired music route on an ordinary param (the rack ~ button)', !!wiredMod && AUDIO_SOURCES.includes(wiredMod.source), `${wired}: ${short(wiredMod)}`);
    const og0 = mock.generate.length;
    const ro = await roleCall(page, '/api/gemini/optimizer', 'ai-opt-run', 120_000);
    check(' Optimizer answered 200', ro.status === 200, `${ro.status} in ${ro.sec}s ${short(ro.json, 90)}`);
    check(' a photo has no clip audio: no note, audio still off', (await gone(page, 'ai-opt-note')) && !(await audioState(page)).active);
    const orecs = mock.generate.slice(og0);
    check(' Google got exactly one generateContent, role Optimizer', orecs.length === 1 && orecs[0].role === 'optimizer', orecs.map((x) => x.role).join(','));
    const orec = orecs[0];
    const om = mediaOf(orec);
    const oclip = om.media.find((x) => x.mime === 'video/webm');
    check(` the silent output clip is sampled at ${INLINE_FPS} fps (videoMetadata + label)`, !!oclip && oclip.meta && oclip.meta.fps === INLINE_FPS && /^OUTPUT clip 4s \(no audio\) \(video sampled at 12 fps\)$/.test(oclip.label),
      oclip ? `${oclip.label} ${short(oclip.meta)}` : 'no clip');
    check(' the JPEGs carry no videoMetadata', om.media.filter((x) => x.mime === 'image/jpeg').every((x) => !x.meta));

    const ob = lastBody('/api/gemini/optimizer') || {};
    const params = (ob.chain && ob.chain.params) || [];
    const carriersRouted = params.filter((p) => p.carrier && p.route && AUDIO_SOURCES.includes(p.route.source));
    const musicRoutes = params.filter((p) => !p.carrier && p.route && AUDIO_SOURCES.includes(p.route.source));
    const ar = ((ob.checks) || []).find((c) => c.id === 'audio_routes');
    check(' the chain has carriers routed on music (analog reactBass/Mid/High)', carriersRouted.length >= 1, carriersRouted.map((p) => p.key).join(','));
    const wantDetail = musicRoutes.length
      ? new RegExp(`^${musicRoutes.length} audio routes? waiting for music — audio is off`)
      : /^no music on, no audio routes$/;
    check(" audio_routes is ok (no FAIL): the hand-wired route is 'waiting for music', the carriers are not counted",
      !!ar && ar.ok === true && musicRoutes.length >= 1 && musicRoutes.some((p) => p.key === wired) && wantDetail.test(ar.detail),
      `${short(ar)} — non-carrier music routes: ${musicRoutes.map((p) => p.key).join(',')}`);
    check(" the prompt says '[ok] audio_routes'", /^- \[ok\] audio_routes: /m.test(orec.text));
    // exposure is the chain's doing, judged against the source frame's own luma
    const ex = ((ob.checks) || []).find((c) => c.id === 'output_exposure');
    const exm = ex && /^output mean luma ([\d.]+) vs source ([\d.]+)( — (almost black|blown out|like the source))?$/.exec(ex.detail);
    check(" output_exposure compares the output with the source ('output mean luma X vs source Y'); FAIL only for 'almost black' / 'blown out'",
      !!exm && ex.ok === !/almost black|blown out/.test(ex.detail), short(ex));
    check(' the prompt says audio is OFF and its music routes are waiting', /audio OFF \(music routes are waiting for music\)/.test(orec.text) && /- audio: OFF — /.test(orec.text));
    check(' the art direction reached the Optimizer prompt (title, chain, why)', /ART DIRECTION chosen by the director/.test(orec.text)
      && orec.text.includes('- look: "Notte analogica" — chain analog → anamorphic_lab') && /- why: MOCK-WHY-0/.test(orec.text) && !/- music read:/.test(orec.text),
      short((orec.text.match(/ART DIRECTION[^\n]*(\n- [^\n]*)*/) || [''])[0], 260));
    check(' …and the browser sent it as direction (music null: a photo)', !!ob.direction && ob.direction.title === 'Notte analogica' && ob.direction.music === null && ob.chain.audioMode === 'off', short(ob.direction));
    check(" no Agent run yet: lastAgent null, 'LAST AGENT RUN: none'", ob.lastAgent === null && /LAST AGENT RUN: none/.test(orec.text));
  });

  /* ── 5 ── */
  await step(5, async () => {
    // back to Home with the Lab closed (nav-ailab toggles), then the video as the INPUT source
    if (await page.$(sel('chain-canvas'))) await domClick(page, 'nav-ailab');
    check(' Lab closed, Home on screen', await page.waitForSelector(sel('chain-canvas'), { state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false));
    await page.locator(sel('source-file')).setInputFiles(fx.video);
    check(' video shown on Home (hero-video)', await visible(page, 'hero-video', 10_000));
    check(' Art Director tab on screen', await openRole(page, 'art_director', 'ai-ad-run'));
    const sends = await page.evaluate(() => (document.body.innerText.match(/Sends: [^\n]+/) || [''])[0]);
    check(" the panel says 'clip … (video + audio)'", /clip .*video \+ audio/.test(sends), sends);

    // the photo's read is still on screen, but it is not a read of THIS source
    const st = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="ai-ad-result"]');
      return {
        line: (document.querySelector('[data-testid="ai-ad-stale"]')?.textContent || '').trim(),
        first: r ? (r.firstElementChild?.getAttribute('data-testid') || '') : '',
        stale: r ? r.getAttribute('data-stale') : null,
        dim: !!r?.querySelector('.opacity-50'),
        apply: [...document.querySelectorAll('[data-testid^="ai-ad-apply-"]')].map((b) => b.disabled),
      };
    });
    check(" the photo's read says 'Read of portrait.jpg, not the current source — run Analyze again for this one.' at its top",
      st.line === 'Read of portrait.jpg, not the current source — run Analyze again for this one.' && st.first === 'ai-ad-stale' && st.stale === 'true', JSON.stringify(st));
    check(" …dimmed, every 'Use this chain' off", st.dim && st.apply.length === 3 && st.apply.every((d) => d === true), JSON.stringify(st.apply));

    const g0 = mock.generate.length;
    const u0 = mock.uploads.length;
    const s0 = mock.uploadStarts.length;
    const p0 = pageReqs.filter((x) => x.url.endsWith('/api/gemini/upload')).length;
    const r1 = await roleCall(page, '/api/gemini/art-director', 'ai-ad-run', 90_000);
    check(' first run: server answered 200', r1.status === 200, `${r1.status} in ${r1.sec}s ${short(r1.json, 90)}`);
    const ups = mock.uploads.slice(u0);
    check(' Google got ONE upload of the whole file (video/webm, every byte)', ups.length === 1 && ups[0].mimeType === 'video/webm' && ups[0].bytes === videoBytes,
      short(ups.map((u) => `${u.mimeType} ${u.bytes}B of ${videoBytes}B "${u.displayName}"`)));
    check(' upload carried the file name', ups[0] && ups[0].displayName === 'clip120.webm', ups[0] && ups[0].displayName);
    uploadedUri = ups[0] ? ups[0].uri : null;
    check(' processing was polled until ACTIVE', mock.filePolls.length >= 1);
    const recs1 = mock.generate.slice(g0);
    const m1 = mediaOf(recs1[0]);
    const fd = m1.files[0];
    check(' one Art Director generateContent', recs1.length === 1 && recs1[0].role === 'art_director');
    check(' it references the upload by fileUri (video/webm)', !!fd && ups[0] && fd.fileData.fileUri === ups[0].uri && fd.fileData.mimeType === 'video/webm', short(fd));
    check(' with videoMetadata (fps sampling)', !!fd && fd.videoMetadata && typeof fd.videoMetadata.fps === 'number' && fd.videoMetadata.fps > 0, short(fd && fd.videoMetadata));
    check(' and no inline frames on top (only what is needed)', m1.media.length === 0, `${m1.media.length} inline`);
    check(' context asks to watch AND listen', /watch it AND listen to it/.test(m1.text));
    check(' result card shows the music read', await page.evaluate(() => /120 BPM/.test(document.querySelector('[data-testid="ai-ad-result"]')?.textContent || '')));
    check(' the new read is current: no stale line, its buttons on', (await gone(page, 'ai-ad-stale')) && (await disabled(page, 'ai-ad-apply-0')) === false);
    const cache = await page.evaluate(() => localStorage.getItem('syntech.geminiFiles') || '');
    check(' upload cached in localStorage (no key inside)', cache.includes(ups[0] ? ups[0].uri : '#') && !cache.includes(GOOD), short(cache, 120));

    const r2 = await roleCall(page, '/api/gemini/art-director', 'ai-ad-run', 60_000);
    check(' second run: server answered 200', r2.status === 200, `${r2.status} in ${r2.sec}s`);
    check(' second run: NO new upload (Google or our /upload)', mock.uploads.length === u0 + 1 && mock.uploadStarts.length === s0 + 1
      && pageReqs.filter((x) => x.url.endsWith('/api/gemini/upload')).length === p0 + 1,
      `uploads=${mock.uploads.length - u0} starts=${mock.uploadStarts.length - s0} browser=${pageReqs.filter((x) => x.url.endsWith('/api/gemini/upload')).length - p0}`);
    const recs2 = mock.generate.slice(g0 + 1);
    const fd2 = recs2[0] && mediaOf(recs2[0]).files[0];
    check(' second run reuses the same fileUri', recs2.length === 1 && !!fd2 && fd2.fileData.fileUri === fd.fileData.fileUri, short(fd2));
  });

  /* ── 6 ── */
  await step(6, async () => {
    if (await page.$(sel('chain-canvas'))) { // still open after a failed step 5: close it first (nav-ailab toggles)
      await domClick(page, 'nav-ailab');
      await page.waitForSelector(sel('chain-canvas'), { state: 'detached', timeout: 10_000 }).catch(() => {});
    }
    // "Use this chain" on the VIDEO result: wires it, opens the Lab, and keeps
    // the proposal (now with the music read) as the art direction
    check(' Art Director tab on screen (Home)', await openRole(page, 'art_director', 'ai-ad-run'));
    const opened = await openLabVia(page, () => domClick(page, 'ai-ad-apply-0'));
    check(" 'Use this chain' (video result) opens the Lab", opened);
    if (!opened) return;
    const ready = await page.evaluate(() => window.__SYN.lab.whenReady(20_000));
    const kind = await page.evaluate(() => window.__SYN.lab.sourceKind());
    check(' Lab source is the video', ready === true && kind === 'video', `ready=${ready} kind=${kind}`);
    const order = await waitOrder(page, 'analog>anamorphic_lab');
    check(' Lab chain = analog → anamorphic_lab', order === 'analog>anamorphic_lab', order);
    const a0 = await audioState(page);
    check(' audio is OFF in the Lab, even for a music video (the default)', !a0.active && a0.mode === 'off', JSON.stringify(a0));
    check(' Clip audio button present (not pressed by the suite)', await visible(page, 'audio-clip', 10_000));

    check(" the panel landed on the Agent tab by itself (no rail click)", (await onTab(page, 'Agent')) && await page.locator(sel('ai-agent-run')).isVisible().catch(() => false));
    const marks = await proposalMarks(page);
    check(" the video's first proposal now reads 'In use' (violet border), the others not", marksOk(marks), JSON.stringify(marks));
    check(' Agent tab on screen (Lab)', await openRole(page, 'agent', 'ai-agent-run'));
    await sleep(1300); // the tab polls the Lab once a second
    const dir = await text(page, 'ai-agent-direction');
    check(" one line 'Direction: Notte analogica' with a clear ×", dir === 'Direction: Notte analogica' && !(await gone(page, 'ai-agent-direction-clear')), dir);
    const pt = await panelAll(page);
    check(" the panel says Run switches on the clip's own audio", /No music on: Run switches on the clip's own audio/.test(pt), short(pt.replace(/\s+/g, ' '), 200));
    const sends = await sendsLine(page);
    check(" Sends: the uploaded clip + frame pair + 4s output clip + signals + chain + the art direction",
      /^Sends: the uploaded clip \(video \+ audio, already on Google\) \+ 1 frame pair \(source \+ output\) \+ 4s output clip with the clip's music, if it has any \+ 3s of live signals \+ the chain \+ the art direction$/.test(sends), sends);

    const before = await busState(page);
    const g0 = mock.generate.length;
    const u0 = mock.uploads.length;
    const s0 = mock.uploadStarts.length;
    const p0 = uploadCalls();
    const r = await roleCall(page, '/api/gemini/agent', 'ai-agent-run');
    check(' server answered 200', r.status === 200, `${r.status} in ${r.sec}s ${short(r.json, 90)}`);
    check(' result card shown', await visible(page, 'ai-agent-result', 10_000));

    // the Run switched the clip's own soundtrack on, inside the click
    const a1 = await audioState(page);
    check(" Run switched the Clip audio on by itself (AudioEngine mode 'clip')", a1.active && a1.mode === 'clip', JSON.stringify(a1));
    const note = await text(page, 'ai-agent-note');
    check(` …and said so in one line: '${CLIP_ON_NOTE}'`, note === CLIP_ON_NOTE, note);
    check(' the Clip button now shows it on (amber)', await page.evaluate(() => /\bborder-amber-400\b/.test(document.querySelector('[data-testid="audio-clip"]')?.className || '')),
      await page.evaluate(() => document.querySelector('[data-testid="audio-clip"]')?.className || ''));

    const recs = mock.generate.slice(g0);
    check(' Google got exactly one generateContent, role Agent', recs.length === 1 && recs[0].role === 'agent', recs.map((x) => x.role).join(','));
    const rec = recs[0];
    const m = mediaOf(rec);
    // the whole source, with its song: the step-5 upload, reused
    const fd = m.files[0];
    check(' Google got the uploaded source by fileUri (the step-5 upload)', m.files.length === 1 && !!uploadedUri && fd.fileData.fileUri === uploadedUri && fd.fileData.mimeType === 'video/webm',
      short(m.files.map((f) => f.fileData)));
    check(' …sampled with videoMetadata (whole-file rate)', !!fd && !!fd.videoMetadata && fd.videoMetadata.fps > 0 && fd.videoMetadata.fps <= 1, short(fd && fd.videoMetadata));
    check(' no new upload (Google or our /upload): the cached fileUri', mock.uploads.length === u0 && mock.uploadStarts.length === s0 && uploadCalls() === p0,
      `uploads +${mock.uploads.length - u0} starts +${mock.uploadStarts.length - s0} browser +${uploadCalls() - p0}`);
    const labels = m.media.map((x) => `${x.mime}|${x.label}`);
    check(' inline: SOURCE frame + OUTPUT frame (JPEG) + OUTPUT clip 4s with music (WebM)', m.media.length === 3
      && m.media[0].mime === 'image/jpeg' && /^SOURCE frame/.test(m.media[0].label) && !!jpegSize(m.media[0].buf)
      && m.media[1].mime === 'image/jpeg' && /^OUTPUT frame/.test(m.media[1].label) && !!jpegSize(m.media[1].buf)
      && m.media[2].mime === 'video/webm' && /^OUTPUT clip 4s with music/.test(m.media[2].label), JSON.stringify(labels));
    check(' frames ≤ 768px', m.media.filter((x) => x.mime === 'image/jpeg').every((x) => { const d = jpegSize(x.buf); return d && Math.max(d.w, d.h) <= 768; }));
    const clip = m.media.find((x) => x.mime === 'video/webm');
    check(` the OUTPUT clip is sampled at ${INLINE_FPS} fps (videoMetadata + label)`, !!clip && !!clip.meta && clip.meta.fps === INLINE_FPS && / \(video sampled at 12 fps\)$/.test(clip.label), clip ? `${clip.label} ${short(clip.meta)}` : 'none');
    check(' the clip is a real WebM with the music (an Opus track)', !!clip && clip.buf.length > 8 * 1024 && clip.buf.readUInt32BE(0) === 0x1a45dfa3 && clip.buf.includes(Buffer.from('A_OPUS')), clip ? `${(clip.buf.length / 1024).toFixed(1)}KB` : 'none');
    check(' the context tells it the whole source + soundtrack is attached', /the WHOLE source video[^\n]* attached above WITH its soundtrack/.test(m.text));
    check(' the chain table was sent', /CHAIN \(render order\): analog → anamorphic_lab/.test(m.text) && /PARAMETERS — key \| label \| range \| base \| route \| flags/.test(m.text) && /\[anamorphic_lab\]/.test(m.text));
    const audioLine = (m.text.match(/- audio: [^\n]+/) || [''])[0];
    check(' live signals with audio ON (the Clip)', /- audio: ON — Clip/.test(m.text) && /audio on — Clip/.test(m.text), short(audioLine, 200));
    check(' live video signals sent', /- video: motion mean [\d.]+ \/ peak [\d.]+; bright mean/.test(m.text));
    // the art direction, as the brief
    const dirBlock = (m.text.match(/ART DIRECTION[^\n]*(\n- [^\n]*)*/) || [''])[0];
    check(' the art direction reached the Agent prompt (look, chain, why, audioIdea, music read)', /^ART DIRECTION chosen by the director/.test(dirBlock)
      && dirBlock.includes('- look: "Notte analogica" — chain analog → anamorphic_lab') && dirBlock.includes('- why: MOCK-WHY-0')
      && dirBlock.includes('- audioIdea: la cassa spinge il tear') && dirBlock.includes('- music read: energy alta, cassa dritta (mock); tempo 120 BPM four-on-the-floor; moments: 0:02 cassa piena'),
      short(dirBlock, 300));
    const ab = lastBody('/api/gemini/agent') || {};
    check(' the browser sent direction + source.fileUri + chain.audioMode', !!ab.direction && ab.direction.title === 'Notte analogica' && !!ab.direction.music
      && ab.source && ab.source.fileUri === uploadedUri && ab.chain && ab.chain.audioMode === 'clip' && ab.chain.audioActive === true,
      short({ direction: ab.direction && ab.direction.title, fileUri: ab.source && ab.source.fileUri, audioMode: ab.chain && ab.chain.audioMode }));

    const sch = rec.body.generationConfig && rec.body.generationConfig.responseJsonSchema;
    const pEnum = (sch && sch.properties.params.items.properties.key.enum) || [];
    agentPicked = rec.picked || {};
    const { P, R, R3, floor, gate } = agentPicked;
    check(' per-chain schema: tunable keys allowed, locked + carrier keys not', pEnum.includes(P) && (!agentPicked.locked || !pEnum.includes(agentPicked.locked)) && (!agentPicked.carrier || !pEnum.includes(agentPicked.carrier)),
      `enum=${pEnum.length} P=${P} locked=${agentPicked.locked} carrier=${agentPicked.carrier}`);

    // what the validator kept, raised, clamped and dropped
    const plan = (r.json && r.json.plan) || { params: [], routes: [] };
    const dropped = (r.json && r.json.dropped) || [];
    const pv = plan.params.find((x) => x.key === P);
    const rv = plan.routes.find((x) => x.key === R);
    const r3 = plan.routes.find((x) => x.key === R3);
    const fv = plan.params.find((x) => x.key === floor);
    check(' plan kept the valid param + route', !!pv && !!rv && rv.source === 'beat' && near(rv.amount, 0.2), short(plan));
    check(' a route over the cap is clamped to 0.6 (MAX_ROUTE_AMOUNT)', !R3 || (!!r3 && r3.source === 'treble' && near(r3.amount, 0.6)), `${R3}: ${short(r3)}`);
    check(` a base under its floor is raised: ${floor} 0 → ${agentPicked.floorValue}`, !floor || (!!fv && near(fv.value, agentPicked.floorValue, 1e-9)), short(fv));
    const keptKeys = [...plan.params, ...plan.routes].map((x) => x.key);
    check(' plan carries no invalid key', !keptKeys.includes('nope.ghost') && !plan.params.some((x) => [agentPicked.carrier, agentPicked.locked, gate].includes(x.key)), JSON.stringify(keptKeys));
    const want = [
      'nope.ghost: not a parameter of this chain',
      agentPicked.carrier && `${agentPicked.carrier}: carrier`,
      agentPicked.locked && `${agentPicked.locked}: protected`,
      gate && `${gate}: protected`,
      agentPicked.enum && `${agentPicked.enum}: enum parameters are never routed`,
      agentPicked.carrier && `${agentPicked.carrier}: carrier route cannot be switched off`,
    ].filter(Boolean);
    check(' validator dropped every bad entry, with a reason (analog.reactEnabled protected)', !!gate && want.every((w) => dropped.some((d) => d.startsWith(w))),
      `missing: ${short(want.filter((w) => !dropped.some((d) => d.startsWith(w))))} | ${short(dropped, 300)}`);
    // kept but changed: `adjusted`, never `dropped` (it WAS applied)
    const adjusted = (r.json && r.json.adjusted) || [];
    const wantAdj = [
      floor && `${floor}: Gemini asked 0, raised to its floor ${agentPicked.floorValue}`,
      R3 && `${R3}: route depth: Gemini asked 0.9, capped at 0.6`,
    ].filter(Boolean);
    check(' adjusted: the floor raise and the depth cap, one line each', wantAdj.length === 2 && wantAdj.every((w) => adjusted.some((a) => a.startsWith(w))) && adjusted.length === wantAdj.length,
      `missing: ${short(wantAdj.filter((w) => !adjusted.some((a) => a.startsWith(w))))} | ${short(adjusted, 300)}`);
    check(' …and neither of them in dropped', !dropped.some((d) => (floor && d.startsWith(`${floor}:`)) || (R3 && d.startsWith(`${R3}:`)) || /raised to|capped at/.test(d)), short(dropped, 300));

    // applied to the ParamBus
    await sleep(300);
    const after = await busState(page);
    check(` ${P} base changed on the bus to the plan's value`, !!pv && after[P] && near(after[P].base, pv.value, 1e-6) && !near(before[P] && before[P].base, pv.value, 1e-9),
      `${before[P] && before[P].base} → ${after[P] && after[P].base} (plan ${pv && pv.value})`);
    check(` ${R} now routed beat × 0.2`, after[R] && sameMod(after[R].mod, { source: 'beat', amount: 0.2 }), short(after[R] && after[R].mod));
    check(` ${R3} now routed treble × 0.6`, !R3 || (after[R3] && sameMod(after[R3].mod, { source: 'treble', amount: 0.6 })), short(R3 && after[R3] && after[R3].mod));
    check(` ${floor} at its floor on the bus`, !floor || (after[floor] && near(after[floor].base, agentPicked.floorValue, 1e-9) && !near(before[floor].base, agentPicked.floorValue, 1e-9)),
      floor ? `${before[floor] && before[floor].base} → ${after[floor] && after[floor].base}` : '');
    const ui = await text(page, 'ai-agent-result');
    const n = plan.params.length + plan.routes.length;
    check(" the card lists what was not applied ('Not applied:', the ghost key)", /Not applied:/.test(ui) && ui.includes('nope.ghost: not a parameter of this chain') && !/muted:/.test(ui), short(ui, 240));
    check(` the card says 'Applied ${n} changes' and shows the summary`, new RegExp(`Applied ${n} changes`).test(ui) && /MOCK-AGENT/.test(ui), short(ui, 120));
    // the adjustments sit on the rows that were applied, never under 'Not applied'
    const rows = await changeRows(page, 'ai-agent-rows');
    const fRow = rows.find((x) => x.key === floor && !x.route);
    const cRow = rows.find((x) => x.key === R3 && x.route);
    check(` the applied row of ${floor} carries its note: '→ ${agentPicked.floorValue} · Gemini asked 0, raised to its floor ${agentPicked.floorValue} …'`,
      !!fRow && fRow.text.includes(`→ ${agentPicked.floorValue}`) && fRow.note.startsWith(`· Gemini asked 0, raised to its floor ${agentPicked.floorValue}`), short(fRow));
    check(` the route row of ${R3} carries the cap: '→ treble 0.6 · Gemini asked 0.9, capped at 0.6 …'`,
      !!cRow && cRow.text.includes('→ treble 0.6') && cRow.note.startsWith('· Gemini asked 0.9, capped at 0.6'), short(cRow));
    check(` one row per kept change (${n}), no other note`, rows.length === n && rows.filter((x) => x.note).length === 2, `${rows.length} rows, ${rows.filter((x) => x.note).length} notes`);
    const na = await notAppliedBlocks(page, 'ai-agent-result');
    check(" 'Not applied' lists no floor raise and no cap", na.length === 1 && !/raised to|capped at|its floor/.test(na[0].text), short(na, 300));

    // ── Undo reverts the plan's keys only: an edit made after the run stays ──
    const planKeys = new Set(keptKeys);
    const manual = await page.evaluate((keys) => {
      const skip = new Set(keys);
      for (const el of document.querySelectorAll('input[type="range"][data-testid^="param-"]')) {
        const s = el.getAttribute('data-testid').slice('param-'.length);
        const i = s.lastIndexOf('-');
        const key = `${s.slice(0, i)}.${s.slice(i + 1)}`;
        const st = window.__SYN.bus.state[key];
        if (skip.has(key) || !st || st.mod || Number(el.max) <= Number(el.min)) continue;
        return { tid: el.getAttribute('data-testid'), key, min: Number(el.min), max: Number(el.max), base: st.base };
      }
      return null;
    }, [...planKeys]);
    check(' found a rack slider the plan did not touch', !!manual, short(manual));
    let manualValue = null;
    if (manual) {
      const target = manual.base < (manual.min + manual.max) / 2 ? manual.min + 0.7 * (manual.max - manual.min) : manual.min + 0.3 * (manual.max - manual.min);
      await setRange(page, manual.tid, target);
      await sleep(200);
      manualValue = (await busState(page))[manual.key].base;
      check(` the operator moves ${manual.key} by hand after the run`, !near(manualValue, manual.base, 1e-9), `${manual.base} → ${manualValue}`);
    }
    const order0 = await labOrder(page);
    await domClick(page, 'ai-agent-undo');
    await sleep(400);
    const undone = await busState(page);
    const notBack = [...planKeys].filter((k) => !undone[k] || !before[k] || !near(undone[k].base, before[k].base, 1e-9) || !sameMod(undone[k].mod, before[k].mod));
    check(` Undo: every plan key back to its value before the run (${planKeys.size} keys)`, notBack.length === 0,
      notBack.length ? notBack.map((k) => `${k}: ${short(undone[k])} vs ${short(before[k])}`).join('; ') : [...planKeys].join(','));
    check(' Undo: the hand edit made after the run is kept (per-key revert)', !!manual && near(undone[manual.key].base, manualValue, 1e-9), manual ? `${manual.key} ${undone[manual.key].base} vs ${manualValue}` : '');
    check(' Undo: chain order untouched', (await labOrder(page)) === order0);
    check(" Undo: the card says 'Undone', its Undo is off", /Undone/.test(await text(page, 'ai-agent-result')) && await page.evaluate(() => document.querySelector('[data-testid="ai-agent-undo"]').disabled));
    check(' the music stays on after Undo', (await audioState(page)).active);
    check(' Optimizer tab on screen', await openRole(page, 'optimizer', 'ai-opt-run'));
    await sleep(1300);
    const optLine = await text(page, 'ai-opt-agent-line');
    const optSends = await sendsLine(page);
    check(" the Optimizer knows the run was undone: 'The Agent's last run was undone: judges the Lab as it is', not in Sends",
      optLine === "The Agent's last run was undone: judges the Lab as it is" && !/Agent's last plan/.test(optSends), `${optLine} | ${optSends}`);

    // ── run again (music already on): this plan stays for the Optimizer ──
    check(' Agent tab on screen', await openRole(page, 'agent', 'ai-agent-run'));
    beforeRun2 = await busState(page);
    const g1 = mock.generate.length;
    const r2 = await roleCall(page, '/api/gemini/agent', 'ai-agent-run');
    check(' second run: 200, applied again', r2.status === 200 && new RegExp(`Applied ${n} changes`).test(await text(page, 'ai-agent-result')), `${r2.status} in ${r2.sec}s`);
    check(' second run: music was already on — no note, no new upload', (await gone(page, 'ai-agent-note')) && mock.uploads.length === u0 && uploadCalls() === p0);
    const rec2 = mock.generate.slice(g1).find((x) => x.role === 'agent');
    agentPicked = (rec2 && rec2.picked) || agentPicked;
    agentPlan = r2.json && r2.json.plan;
  });

  /* ── 7 ── */
  await step(7, async () => {
    check(' Optimizer tab on screen (Lab)', await openRole(page, 'optimizer', 'ai-opt-run'));
    await sleep(1300);
    const sends = await sendsLine(page);
    check(" Sends: '4s output clip with music + 1 frame pair + 2s of live signals + the chain + the checks + the Agent's last plan + the art direction'",
      sends === "Sends: 4s output clip with music + 1 frame pair + 2s of live signals + the chain + the checks + the Agent's last plan + the art direction", sends);
    const al = await text(page, 'ai-opt-agent-line');
    check(" it names the Agent run it checks (run 2, the one still in effect)", /^Checks the Agent's run of \S+/.test(al), al);
    check(" 'Direction: Notte analogica' on the Optimizer too", (await text(page, 'ai-opt-direction')) === 'Direction: Notte analogica');
    const g0 = mock.generate.length;
    const r = await roleCall(page, '/api/gemini/optimizer', 'ai-opt-run', 120_000);
    check(' server answered 200', r.status === 200, `${r.status} in ${r.sec}s ${short(r.json, 90)}`);
    check(' result card shown', await visible(page, 'ai-opt-result', 10_000));
    check(' music already on: no clip note', await gone(page, 'ai-opt-note'));
    const recs = mock.generate.slice(g0);
    check(' Google got exactly one generateContent, role Optimizer', recs.length === 1 && recs[0].role === 'optimizer', recs.map((x) => x.role).join(','));
    const rec = recs[0];
    const m = mediaOf(rec);
    const webm = m.media.filter((x) => x.mime === 'video/webm');
    const jpgs = m.media.filter((x) => x.mime === 'image/jpeg');
    const clip = webm[0];
    check(' one video/webm output clip + 2 JPEGs, nothing else', webm.length === 1 && jpgs.length === 2 && m.media.length === 3 && m.files.length === 0,
      m.media.map((x) => `${x.mime}:${(x.buf.length / 1024).toFixed(0)}KB`).join(','));
    check(' the clip is a real WebM of non-trivial size', !!clip && clip.buf.length > 8 * 1024 && clip.buf.readUInt32BE(0) === 0x1a45dfa3, clip ? `${(clip.buf.length / 1024).toFixed(1)}KB` : 'none');
    check(' the clip carries the music (an Opus track)', !!clip && clip.buf.includes(Buffer.from('A_OPUS')), clip && clip.label);
    check(` the clip is sampled at ${INLINE_FPS} fps (videoMetadata on the part)`, !!clip && !!clip.meta && clip.meta.fps === INLINE_FPS, short(clip && clip.meta));
    check(" labelled 'OUTPUT clip 4s with music … (video sampled at 12 fps)', then SOURCE / OUTPUT frames", !!clip && /^OUTPUT clip 4s with music \(video sampled at 12 fps\)$/.test(clip.label) && /^SOURCE frame/.test(jpgs[0] && jpgs[0].label) && /^OUTPUT frame/.test(jpgs[1] && jpgs[1].label),
      JSON.stringify(m.media.map((x) => x.label)));
    check(' the prompt says the clip is sampled at 12 fps, with the music', /OUTPUT CLIP: "OUTPUT clip 4s with music", sampled at 12 fps, with the music/.test(m.text));
    const checkIds = (m.text.match(/^- \[(ok|FAIL)\] ([a-z_]+):/gm) || []).map((l) => l.replace(/^- \[(ok|FAIL)\] /, '').replace(/:$/, ''));
    check(' the Lab checks were sent', /CHECKS \(computed by the Lab — facts\):/.test(m.text) && ['performance', 'audio_routes', 'video_routes', 'person_mask', 'output_exposure'].every((id) => checkIds.includes(id)), JSON.stringify(checkIds));
    check(" audio_routes with music on: '[ok] audio_routes: music on (clip), …'", /^- \[ok\] audio_routes: music on \(clip\), \d+ audio routes?$/m.test(m.text), short((m.text.match(/^- \[[a-zA-Z]+\] audio_routes:[^\n]*/m) || [''])[0]));
    const P = agentPicked && agentPicked.P;
    check(" the Agent's last plan was sent", /LAST AGENT RUN \(/.test(m.text) && !!P && m.text.includes(`params: ${P}=`) && /MOCK-AGENT/.test(m.text), short((m.text.match(/LAST AGENT RUN[^\n]*\n[^\n]*\n[^\n]*/) || [''])[0], 200));
    check(' the art direction reached the Optimizer prompt (with the music read)', /ART DIRECTION chosen by the director/.test(m.text) && m.text.includes('- look: "Notte analogica"') && /- music read: energy alta, cassa dritta \(mock\)/.test(m.text));
    check(' live signals with audio ON', /- audio: ON — Clip/.test(m.text));
    const ob = lastBody('/api/gemini/optimizer') || {};
    check(' the browser sent direction + lastAgent + chain.audioMode', !!ob.direction && ob.direction.title === 'Notte analogica' && !!ob.lastAgent && !!agentPlan
      && JSON.stringify(ob.lastAgent.plan) === JSON.stringify(agentPlan) && ob.chain && ob.chain.audioMode === 'clip',
      short({ direction: ob.direction && ob.direction.title, lastAgent: !!ob.lastAgent, audioMode: ob.chain && ob.chain.audioMode }));

    const res = r.json || { issues: [], dropped: [], adjusted: [] };
    check(' validator: 3 issues, unknown severity → tip, empty fix → null', res.issues.length === 3 && res.issues[1].severity === 'tip' && res.issues[1].fix === null && !!res.issues[0].fix && res.verdict === 'improve',
      short(res.issues.map((i) => `${i.severity}:${i.fix ? 'fix' : 'null'}`)));
    check(' validator: the dead fix is reported', res.dropped.some((d) => d.startsWith('fix 2 · nope.ghost')) && res.dropped.some((d) => d === 'fix 2 · nothing left to apply'), short(res.dropped, 200));
    const R4 = (rec && rec.picked && rec.picked.R4) || null;
    const oadj = res.adjusted || [];
    check(" validator: fix 1's capped route is in adjusted ('fix 1 · <key>: route depth: Gemini asked 0.9, capped at 0.6 …'), not in dropped",
      !!R4 && oadj.length === 1 && oadj[0].startsWith(`fix 1 · ${R4}: route depth: Gemini asked 0.9, capped at 0.6`) && !res.dropped.some((d) => /capped at|raised to/.test(d)),
      `${short(oadj, 200)} | ${short(res.dropped, 200)}`);
    const ui = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="ai-opt-result"]')?.textContent || '',
      fixes: [...document.querySelectorAll('button[data-testid^="ai-opt-fix-"]')].map((b) => b.getAttribute('data-testid')),
      heads: [...document.querySelectorAll('[data-testid^="ai-opt-issue-"]')].map((c) => (c.firstElementChild?.textContent || '').trim()),
    }));
    check(' issues rendered (finding + verdict + summary)', ['MOCK-ISSUE-0', 'MOCK-ISSUE-1', 'MOCK-ISSUE-2', 'improve', 'MOCK-OPT'].every((s) => ui.text.includes(s)), short(ui.text, 160));
    check(" one 'Apply fix' (issue 0) + 'Apply all', no fix Undo before Apply", JSON.stringify([...ui.fixes].sort()) === JSON.stringify(['ai-opt-fix-0', 'ai-opt-fix-all']), JSON.stringify(ui.fixes));
    check(" issue cards numbered like the server's 'fix N': '1 · warning', '2 · tip', '3 · tip'", JSON.stringify(ui.heads) === JSON.stringify(['1 · warning', '2 · tip', '3 · tip']), JSON.stringify(ui.heads));
    // each issue's refusals sit in its own card: nothing left in a shared list
    const na2 = await text(page, 'ai-opt-not-applied-1');
    const naOpt = await notAppliedBlocks(page, 'ai-opt-result');
    check(" issue 2's refusals inside its own card (the ghost key, 'nothing left to apply'), no 'fix 2 ·' prefix",
      na2.includes('nope.ghost: not a parameter of this chain') && na2.includes('nothing left to apply') && !/fix \d+ · /.test(na2), na2);
    check(" no 'Not applied' list outside the issue cards", naOpt.length === 1 && naOpt.every((b) => b.inIssue), short(naOpt));

    // ── what a fix changes, listed BEFORE it is applied ──
    const fix = res.issues[0] && res.issues[0].fix;
    const P2 = fix && fix.params[0] && fix.params[0].key;
    const R2 = fix && fix.routes[0] && fix.routes[0].key;
    const issue0 = await text(page, 'ai-opt-issue-0');
    const fr = await changeRows(page, 'ai-opt-fix-rows-0');
    const nFix = fix ? fix.params.length + fix.routes.length : 0;
    const pRow = fr.find((x) => x.key === P2 && !x.route);
    const r2Row = fr.find((x) => x.key === R2 && x.route);
    const r4Row = fr.find((x) => x.key === R4 && x.route);
    check(" before Apply the fix lists what it would change ('Would change:', one row per change)", /Would change:/.test(issue0) && !/Changed:/.test(issue0) && nFix === 3 && fr.length === nFix,
      `${fr.length} rows of ${nFix} | ${short(fr.map((x) => x.text), 300)}`);
    check(` …${P2}: '→ ${fix && fix.params[0] ? fmtNum(fix.params[0].value) : '?'}'; ${R2} ~: '→ bass 0.15'`,
      !!pRow && pRow.text.includes(`→ ${fmtNum(fix.params[0].value)}`) && !!r2Row && r2Row.text.includes('→ bass 0.15'), short([pRow, r2Row]));
    check(` …${R4} ~: '→ loud 0.6' with its note on the row ('Gemini asked 0.9, capped at 0.6'), not under 'Not applied'`,
      !!r4Row && r4Row.text.includes('→ loud 0.6') && r4Row.note.startsWith('· Gemini asked 0.9, capped at 0.6') && (await gone(page, 'ai-opt-not-applied-0')), short(r4Row));

    const before = await busState(page);
    await domClick(page, 'ai-opt-fix-0');
    await sleep(400);
    const after = await busState(page);
    check(` Apply fix: ${P2} base changed on the bus`, !!P2 && after[P2] && near(after[P2].base, fix.params[0].value, 1e-6) && !near(before[P2] && before[P2].base, fix.params[0].value, 1e-9),
      `${before[P2] && before[P2].base} → ${after[P2] && after[P2].base} (fix ${fix && fix.params[0] && fix.params[0].value})`);
    check(` Apply fix: ${R2} routed bass × 0.15`, !R2 || (after[R2] && sameMod(after[R2].mod, { source: 'bass', amount: 0.15 })), short(after[R2] && after[R2].mod));
    check(` Apply fix: ${R4} routed loud × 0.6 (the capped depth)`, !!R4 && after[R4] && sameMod(after[R4].mod, { source: 'loud', amount: 0.6 }), short(after[R4] && after[R4].mod));
    const fixBtn = await text(page, 'ai-opt-fix-0');
    const fixUndo = await text(page, 'ai-opt-fix-undo-0');
    check(" the button says 'Applied', the rows 'Changed:', a small Undo next to it", /Applied/.test(fixBtn) && /Changed:/.test(await text(page, 'ai-opt-issue-0'))
      && fixUndo === 'Undo' && (await disabled(page, 'ai-opt-fix-undo-0')) === false, `${fixBtn} | ${fixUndo}`);

    // ── ONE undo stack with the Agent, last in first out ──
    check(' Agent tab on screen', await openRole(page, 'agent', 'ai-agent-run'));
    await sleep(300);
    const blocked = await text(page, 'ai-agent-undo');
    check(" the Agent's Undo waits for the fix on top of it: off, 'Undo the Optimizer's fixes first'", blocked === "Undo the Optimizer's fixes first" && (await disabled(page, 'ai-agent-undo')) === true, blocked);
    await domClick(page, 'ai-agent-undo');
    await sleep(300);
    const still = busDiff(after, await busState(page));
    check(' …a click on it changes nothing on the bus', still.length === 0, still.join(','));
    check(' Optimizer tab on screen', await openRole(page, 'optimizer', 'ai-opt-run'));
    await domClick(page, 'ai-opt-fix-undo-0');
    await sleep(400);
    const d1 = busDiff(before, await busState(page));
    check(" the fix's own Undo puts every key back to before the fix", d1.length === 0, d1.join(','));
    check(" …and the fix offers 'Apply fix' again ('Would change:', no small Undo)", (await text(page, 'ai-opt-fix-0')) === 'Apply fix' && (await gone(page, 'ai-opt-fix-undo-0')) && /Would change:/.test(await text(page, 'ai-opt-issue-0')));
    await domClick(page, 'ai-opt-fix-all');
    await sleep(400);
    const again = busDiff(after, await busState(page));
    check(" 'Apply all' applies it again (the same values as 'Apply fix')", again.length === 0 && /Applied/.test(await text(page, 'ai-opt-fix-0')), again.join(','));
    await domClick(page, 'ai-opt-undo');
    await sleep(400);
    const undone = await busState(page);
    check(` Undo: ${P2} restored`, !!P2 && undone[P2] && before[P2] && near(undone[P2].base, before[P2].base, 1e-9), `${undone[P2] && undone[P2].base} vs ${before[P2] && before[P2].base}`);
    check(` Undo: ${R2} and ${R4} routes restored`, (!R2 || (undone[R2] && before[R2] && sameMod(undone[R2].mod, before[R2].mod))) && !!R4 && undone[R4] && before[R4] && sameMod(undone[R4].mod, before[R4].mod));
    const others = busDiff(before, undone);
    check(' Undo touched nothing else on the bus', others.length === 0, others.join(','));

    check(' Agent tab on screen', await openRole(page, 'agent', 'ai-agent-run'));
    await sleep(300);
    const free = await text(page, 'ai-agent-undo');
    check(" with the fix undone, the Agent's Undo is on again ('Undo')", free === 'Undo' && (await disabled(page, 'ai-agent-undo')) === false, free);
    await domClick(page, 'ai-agent-undo');
    await sleep(400);
    const back = await busState(page);
    const d2 = beforeRun2 ? busDiff(beforeRun2, back) : ['(no snapshot from step 6)'];
    check(' Agent Undo: the whole bus is back to its values before the run (no undone value came back)', d2.length === 0,
      d2.map((k) => `${k}: ${short(back[k])} vs ${short(beforeRun2 && beforeRun2[k])}`).join('; '));
    check(" the card says 'Undone', nothing left to undo (Undo off)", /Undone/.test(await text(page, 'ai-agent-result')) && (await disabled(page, 'ai-agent-undo')) === true);
    check(' Optimizer tab on screen', await openRole(page, 'optimizer', 'ai-opt-run'));
    await sleep(1300);
    const al2 = await text(page, 'ai-opt-agent-line');
    check(" the Optimizer: 'The Agent's last run was undone: judges the Lab as it is', no plan in Sends",
      al2 === "The Agent's last run was undone: judges the Lab as it is" && !/Agent's last plan/.test(await sendsLine(page)), al2);

    // ── the Lab closes and reopens: both results belong to a Lab that is gone ──
    await domClick(page, 'nav-ailab');
    const closed = await page.waitForSelector(sel('chain-canvas'), { state: 'detached', timeout: 10_000 }).then(() => true).catch(() => false);
    const reopened = closed && await openLabVia(page, () => domClick(page, 'nav-ailab'));
    check(' the Lab closed and reopened (a new Lab handle)', reopened);
    if (!reopened) return;
    await page.evaluate(() => window.__SYN.lab.whenReady(20_000)).catch(() => false);
    const ov = await page.waitForSelector(sel('ai-opt-stale'), { state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
    const ost = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="ai-opt-result"]');
      return {
        line: (document.querySelector('[data-testid="ai-opt-stale"]')?.textContent || '').trim(),
        first: r?.firstElementChild?.getAttribute('data-testid') || '',
        dim: !!r?.querySelector('.opacity-50'),
        off: ['ai-opt-fix-0', 'ai-opt-fix-all', 'ai-opt-undo'].map((t) => document.querySelector(`[data-testid="${t}"]`)?.disabled ?? null),
      };
    });
    check(` Optimizer: its result opens with '${STALE_LAB}', dimmed, Apply fix / Apply all / Undo off`,
      ov && ost.line === STALE_LAB && ost.first === 'ai-opt-stale' && ost.dim && ost.off.every((d) => d === true), JSON.stringify(ost));
    check(' Agent tab on screen', await openRole(page, 'agent', 'ai-agent-run'));
    const av = await page.waitForSelector(sel('ai-agent-stale'), { state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
    const ast = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="ai-agent-result"]');
      return {
        line: (document.querySelector('[data-testid="ai-agent-stale"]')?.textContent || '').trim(),
        first: r?.firstElementChild?.getAttribute('data-testid') || '',
        dim: !!r?.querySelector('.opacity-50'),
        label: /\d+ changes? on that Lab/.test(r?.textContent || ''),
        undo: document.querySelector('[data-testid="ai-agent-undo"]')?.disabled ?? null,
      };
    });
    check(` Agent: its card opens with '${STALE_LAB}', '… on that Lab', dimmed, its Undo off`,
      av && ast.line === STALE_LAB && ast.first === 'ai-agent-stale' && ast.label && ast.dim && ast.undo === true, JSON.stringify(ast));
  });

  /* ── 8 ── */
  await step(8, async () => {
    // a clip with no audio track on the INPUT node, then the Lab on it
    if (await page.$(sel('chain-canvas'))) {
      await domClick(page, 'nav-ailab');
      await page.waitForSelector(sel('chain-canvas'), { state: 'detached', timeout: 10_000 }).catch(() => {});
    }
    const prev = await page.evaluate(() => document.querySelector('[data-testid="hero-video"]')?.src || '');
    await page.locator(sel('source-file')).setInputFiles(fx.silent);
    const shown = await page.waitForFunction((p) => { const v = document.querySelector('[data-testid="hero-video"]'); return !!v && !!v.src && v.src !== p; }, prev, { timeout: 10_000 })
      .then(() => true).catch(() => false);
    check(' the silent clip is the INPUT source (hero-video, a new URL)', shown);
    const opened = await openLabVia(page, () => domClick(page, 'nav-ailab'));
    check(' the Lab opens on it', opened);
    if (!opened) return;
    const ready = await page.evaluate(() => window.__SYN.lab.whenReady(20_000));
    const kind = await page.evaluate(() => window.__SYN.lab.sourceKind());
    const a0 = await audioState(page);
    check(' Lab source is the video, audio off', ready === true && kind === 'video' && !a0.active, `ready=${ready} kind=${kind} ${JSON.stringify(a0)}`);
    check(' Agent tab on screen (Lab)', await openRole(page, 'agent', 'ai-agent-run'));
    await sleep(1300);
    const pt0 = await panelAll(page);
    check(" before Run nothing is known yet: 'Run switches on the clip's own audio'", /No music on: Run switches on the clip's own audio/.test(pt0), short(pt0.replace(/\s+/g, ' '), 200));
    const s0 = await sendsLine(page);
    check(" Sends before the upload: 'clip N KB (video + audio)' (a small clip in KB, not '0.0 MB')", /^Sends: clip \d+ KB \(video \+ audio\) \+ 1 frame pair \(source \+ output\) \+ /.test(s0), s0);

    const g0 = mock.generate.length;
    const u0 = mock.uploads.length;
    const r = await roleCall(page, '/api/gemini/agent', 'ai-agent-run');
    check(' server answered 200', r.status === 200, `${r.status} in ${r.sec}s ${short(r.json, 90)}`);
    const note = await text(page, 'ai-agent-note');
    check(` the Run says why there is no music: '${SILENT_NOTE}'`, note === SILENT_NOTE, note);
    const a1 = await audioState(page);
    check(' no music came on (AudioEngine still off)', !a1.active, JSON.stringify(a1));
    const recs = mock.generate.slice(g0);
    check(' Google got exactly one generateContent, role Agent', recs.length === 1 && recs[0].role === 'agent', recs.map((x) => x.role).join(','));
    const m = mediaOf(recs[0]);
    const ups = mock.uploads.slice(u0);
    check(' the silent clip was uploaded whole, once, and referenced by fileUri', ups.length === 1 && ups[0].displayName === 'silent.webm' && m.files.length === 1 && m.files[0].fileData.fileUri === ups[0].uri,
      short({ uploads: ups.map((u) => u.displayName), files: m.files.map((f) => f.fileData.fileUri) }));
    check(' inline: the picture only — SOURCE + OUTPUT frames, no output clip', m.media.length === 2 && m.media.every((x) => x.mime === 'image/jpeg')
      && /^SOURCE frame/.test(m.media[0].label) && /^OUTPUT frame/.test(m.media[1].label), JSON.stringify(m.media.map((x) => `${x.mime}|${x.label}`)));
    const ab = lastBody('/api/gemini/agent') || {};
    check(' the browser sent 2 media and audio off (chain.audioActive false)', ab.chain && ab.chain.audioActive === false && Array.isArray(ab.media) && ab.media.length === 2,
      short({ audioActive: ab.chain && ab.chain.audioActive, media: ab.media && ab.media.length }));
    const ui = await text(page, 'ai-agent-result');
    check(' the result is current on this Lab (no stale line) and applied', (await gone(page, 'ai-agent-stale')) && /Applied \d+ changes?/.test(ui), short(ui, 120));
    await sleep(1300); // the tab polls the Lab, and re-reads the upload cache
    const s1 = await sendsLine(page);
    check(" Sends now: 'the uploaded clip (video only — it has no soundtrack, already on Google)', no output clip promised",
      s1 === 'Sends: the uploaded clip (video only — it has no soundtrack, already on Google) + 1 frame pair (source + output) + 3s of live signals + the chain + the art direction', s1);
    const pt1 = await panelAll(page);
    check(" the context line: 'No music on: this clip has no soundtrack — music routes wait for Track or Mic in the Lab.'",
      /No music on: this clip has no soundtrack — music routes wait for Track or Mic in the Lab\./.test(pt1) && !/Run switches on the clip's own audio/.test(pt1), short(pt1.replace(/\s+/g, ' '), 200));
    check(' Optimizer tab on screen', await openRole(page, 'optimizer', 'ai-opt-run'));
    await sleep(1300);
    const os = await sendsLine(page);
    check(" Optimizer Sends: '4s output clip (silent) + 1 frame pair + 2s of live signals + the chain + the checks + the Agent's last plan + the art direction'",
      os === "Sends: 4s output clip (silent) + 1 frame pair + 2s of live signals + the chain + the checks + the Agent's last plan + the art direction", os);
    const al = await text(page, 'ai-opt-agent-line');
    check(' …and it checks the run just made on this Lab', /^Checks the Agent's run of /.test(al), al);
  });

  /* ── 9 ── */
  await step(9, async () => {
    // (a) Google answers 400 API_KEY_INVALID to a role call
    check(' Agent tab on screen', await openRole(page, 'agent', 'ai-agent-run'));
    mock.failNext({ status: 400, body: KEY_INVALID_BODY });
    const g0 = mock.generate.length;
    const r = await roleCall(page, '/api/gemini/agent', 'ai-agent-run');
    check(' 400 API_KEY_INVALID from Google → our 401 invalid_key', r.status === 401 && r.json && r.json.error === 'invalid_key' && mock.generate.slice(g0).some((x) => x.status === 400), `${r.status} ${short(r.json)}`);
    check(' badge back to STANDBY', await waitBadge(page, 'STANDBY', 10_000), (await badge(page)).text);
    check(' key form back', await visible(page, 'ai-key-input', 10_000));
    check(" it says the key was rejected", /rejected/i.test(await text(page, 'ai-key-error')), await text(page, 'ai-key-error'));
    check(' rail locked again', (await rail(page)).every((d) => d === true), JSON.stringify(await rail(page)));

    // (b) reconnect, then Google answers 401 UNAUTHENTICATED
    await submitKey(page, GOOD);
    check(' reconnect → ACTIVE', await waitBadge(page, 'ACTIVE', 20_000));
    check(' Art Director tab on screen', await openRole(page, 'art_director', 'ai-ad-run'));
    check(' its step-5 result survived the relock (tabs stay mounted)', await page.evaluate(() => /MOCK-WHY-0/.test(document.querySelector('[data-testid="ai-ad-result"]')?.textContent || '')));
    mock.failNext({ status: 401, body: UNAUTHENTICATED_BODY });
    const r2 = await roleCall(page, '/api/gemini/art-director', 'ai-ad-run');
    check(' 401 from Google → our 401 invalid_key', r2.status === 401 && r2.json && r2.json.error === 'invalid_key', `${r2.status} ${short(r2.json)}`);
    check(' badge back to STANDBY', await waitBadge(page, 'STANDBY', 10_000), (await badge(page)).text);
    check(' key form back', await visible(page, 'ai-key-input', 10_000));
    check(' rail locked again', (await rail(page)).every((d) => d === true), JSON.stringify(await rail(page)));
  });

  /* ── 10 ── */
  await step(10, async () => {
    const st = await fetch(`${APP}/api/gemini/status`);
    const stj = await st.json().catch(() => null);
    check(' GET /api/gemini/status → 200 {serverKey:false, model}', st.status === 200 && stj && stj.serverKey === false && stj.model === MODEL, `${st.status} ${short(stj)}`);

    const ag = await fetch(`${APP}/api/gemini/agent`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const agj = await ag.json().catch(() => null);
    check(' POST /api/gemini/agent {} → 400 no_media (JSON)', ag.status === 400 && agj && agj.error === 'no_media' && typeof agj.message === 'string', `${ag.status} ${short(agj)}`);

    const g0 = mock.generate.length;
    const tiny = fs.readFileSync(fx.photo).toString('base64');
    const nk = await fetch(`${APP}/api/gemini/art-director`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'image', name: 'x.jpg' }, media: [{ mimeType: 'image/jpeg', data: tiny, label: 'SOURCE photo' }] }),
    });
    const nkj = await nk.json().catch(() => null);
    check(' a role call with media but no key → 401 no_key, Google not called', nk.status === 401 && nkj && nkj.error === 'no_key' && mock.generate.length === g0, `${nk.status} ${short(nkj)}`);

    // a direction that is not an object is a client bug: 400, Google not called
    const photoMedia = [{ mimeType: 'image/jpeg', data: tiny, label: 'SOURCE photo' }];
    const keyed = { 'content-type': 'application/json', 'x-gemini-key': GOOD };
    const bd = await fetch(`${APP}/api/gemini/agent`, {
      method: 'POST', headers: keyed,
      body: JSON.stringify({ source: { kind: 'image', name: 'x.jpg' }, media: photoMedia, chain: { order: ['analog'], params: [] }, direction: 'Notte analogica' }),
    });
    const bdj = await bd.json().catch(() => null);
    check(' POST /agent with direction as a string → 400 bad_request, Google not called', bd.status === 400 && bdj && bdj.error === 'bad_request' && /direction/.test(bdj.message) && mock.generate.length === g0, `${bd.status} ${short(bdj)}`);

    // the whole source already uploaded, but not one frame from the Lab (a
    // Master export holds the capture): the Agent would tune blind — refused
    // before Gemini is paid
    const fu = await fetch(`${APP}/api/gemini/agent`, {
      method: 'POST', headers: keyed,
      body: JSON.stringify({ source: { kind: 'video', name: 'clip120.webm', fileUri: uploadedUri || `${mock.baseUrl}/v1beta/files/mock1`, fileMimeType: 'video/webm' }, media: [], chain: { order: ['analog'], params: [] } }),
    });
    const fuj = await fu.json().catch(() => null);
    check(' POST /agent with a fileUri but no frame from the Lab → 400 no_media "No picture arrived from the Lab…", Google not called',
      fu.status === 400 && fuj && fuj.error === 'no_media' && /^No picture arrived from the Lab/.test(fuj.message) && mock.generate.length === g0, `${fu.status} ${short(fuj)}`);

    // Google refuses the media (finishReason SAFETY): a clear 400, not 'empty answer, try again'
    mock.failNext({ status: 200, body: SAFETY_BLOCKED_BODY });
    const sf = await fetch(`${APP}/api/gemini/art-director`, { method: 'POST', headers: keyed, body: JSON.stringify({ source: { kind: 'image', name: 'x.jpg' }, media: photoMedia }) });
    const sfj = await sf.json().catch(() => null);
    check(' a SAFETY-blocked answer → 400 bad_request "Gemini declined this media (SAFETY)…", no retry',
      sf.status === 400 && sfj && sfj.error === 'bad_request' && /declined this media \(SAFETY\)/.test(sfj.message) && mock.generate.length === g0 + 1, `${sf.status} ${short(sfj)} calls=${mock.generate.length - g0}`);

    // DNS-rebinding guard: /api answers on localhost, IP literals and *.local
    // (the Mac's mDNS name, from the iPad) — plus ALLOWED_HOSTS, empty here
    const rb = await rawGet('/api/gemini/status', 'rebind.attacker.example');
    check(' Host: rebind.attacker.example → 403 JSON', rb.status === 403 && rb.json && rb.json.error === 'bad_request', `${rb.status} ${short(rb.json)}`);
    const ev = await rawGet('/api/gemini/status', `evil.example:${PORT}`);
    check(' Host: evil.example → 403 bad_request whose message says how to get in (add evil.example to ALLOWED_HOSTS, or open by IP / localhost)',
      ev.status === 403 && ev.json && ev.json.error === 'bad_request' && typeof ev.json.message === 'string'
      && ev.json.message.includes('does not answer on "evil.example"') && ev.json.message.includes('add evil.example to ALLOWED_HOSTS') && ev.json.message.includes(`http://localhost:${PORT}`),
      `${ev.status} ${short(ev.json, 220)}`);
    const md = await rawGet('/api/gemini/status', `studio-mac.local:${PORT}`);
    check(' Host: studio-mac.local (mDNS) → 200, and no server key for it', md.status === 200 && md.json && md.json.model === MODEL && md.json.serverKey === false, `${md.status} ${short(md.json)}`);
    const lh = await rawGet('/api/gemini/status', `localhost:${PORT}`);
    check(' Host: localhost → 200', lh.status === 200 && lh.json && lh.json.model === MODEL, `${lh.status} ${short(lh.json)}`);
    await sleep(200);
    check(" the terminal names the refused host and the fix ('[host] refused /api on \"evil.example\" … ALLOWED_HOSTS')",
      /\[host\] refused \/api on "evil\.example" — to allow that name, add it to ALLOWED_HOSTS/.test(serverOut), short((serverOut.match(/\[host\][^\n]*/g) || []).join(' | '), 240));

    for (const old of ['/api/gemini/chat', '/api/gemini/analyze', '/api/gemini/analyze-video', '/api/gemini/optimize']) {
      const o = await fetch(`${APP}${old}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const ct = o.headers.get('content-type') || '';
      const oj = await o.json().catch(() => null);
      check(` old ${old} → 404 JSON`, o.status === 404 && /json/.test(ct) && oj && typeof oj.error === 'string', `${o.status} ${ct} ${short(oj)}`);
    }
    const src = ['server.ts', 'ai-provider.ts', 'ai-roles.ts', 'package.json'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    check(' no Groq left in the server code or dependencies', !/groq/i.test(src));
  });

  /* ── 11 ── */
  await step(11, async () => {
    await sleep(300);
    const leaks = [GOOD, BAD].filter((k) => serverOut.includes(k));
    check(' server stdout/stderr never contains MOCKKEY or BADKEY', leaks.length === 0, leaks.length ? `found ${leaks.join(',')}` : `${serverOut.split('\n').length} log lines`);
    check(' the server logged the key failures (classified, keyless)', /\[gemini\] invalid_key:/.test(serverOut));
    const urlLeak = mock.log.filter((l) => l.url.includes(GOOD) || l.url.includes(BAD) || /[?&]key=/.test(l.url));
    check(' Google never saw the key in a URL', urlLeak.length === 0, short(urlLeak));
    check(' Google got the key in x-goog-api-key on every call', mock.log.filter((l) => !l.url.startsWith('/__mock')).every((l) => l.key === GOOD || l.key === BAD || l.url.startsWith('/upload-session/')),
      short(mock.log.filter((l) => !l.key).map((l) => l.url)));
    const off = pageReqs.filter((x) => !x.url.startsWith(APP) && !x.url.startsWith(`http://localhost:${PORT}`));
    check(' the browser never called Google (only our server)', !off.some((x) => /googleapis|generativelanguage/.test(x.url)), short(off.map((x) => x.url).slice(0, 5)));
    check(' the browser never put the key in a URL', !pageReqs.some((x) => x.url.includes(GOOD) || x.url.includes(BAD)));
    const roleReqs = pageReqs.filter((x) => /\/api\/gemini\/(art-director|agent|optimizer|upload)$/.test(x.url));
    check(' every role/upload call carried x-gemini-key', roleReqs.length > 0 && roleReqs.every((x) => x.key === GOOD), `${roleReqs.length} calls`);
    check(' no pageerror during the whole run', pageErrors.length === 0, pageErrors.join(' | '));
    check(' no unexpected page reload (2 loads: visit + step-3 reload)', loads.length === 2, loads.join(', '));
  });

  /* ── summary ── */
  finished = true;
  clearTimeout(watchdog);
  await cleanup();
  const failed = STEPS.filter(([n]) => !stepOk.get(n));
  console.log('\n── SUMMARY');
  for (const [n, title] of STEPS) console.log(`${stepOk.get(n) ? 'PASS' : 'FAIL'}  STEP ${n} ${title}`);
  console.log(`\n${STEPS.length - failed.length}/${STEPS.length} steps PASS (${checks} checks) in ${((Date.now() - T0) / 1000).toFixed(0)}s`);
  if (failed.length) {
    console.log('\nlast server output:\n' + serverOut.split('\n').slice(-25).join('\n'));
  }
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.log(`FAIL  suite crashed: ${(e && e.stack) || e}`);
  finished = true;
  clearTimeout(watchdog);
  await cleanup();
  process.exit(1);
});
