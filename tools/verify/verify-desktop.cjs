/*
 * THE DESKTOP APP — does the packaged build behave like the web app?
 *
 * Drives the REAL packaged executable (not `vite dev`) through Playwright's
 * Electron driver and checks what the desktop shell promises:
 *
 *   1. It opens by itself: one window, on http://127.0.0.1:47291, titled
 *      VFX SYNTECH, with the shell rendered — no terminal, no browser.
 *      First the intro (the operator's logo → pet animation) plays on black
 *      with its LOADING counter, reaches 100% and gives way to the app.
 *   2. Everything is served from INSIDE the app: the five effects, the vendored
 *      three.js / MediaPipe / fonts (wasm with the right MIME type).
 *   3. The AI endpoints answer with no key (offline fallback, never a 500).
 *   4. All five effects open from their cards, with no uncaught error in the shell.
 *   5. localStorage survives a quit + relaunch (why the port is fixed).
 *   6. A second launch does not open a second app (single instance).
 *   7. If port 47291 is taken by some other program, the app still opens.
 *
 * Runs on all three OSes: the desktop workflow runs it on GitHub's Windows and
 * macOS machines against the exact build it uploads; in the Linux sandbox it
 * needs a display, hence xvfb-run.
 * Build first:  npm run build && npm run desktop:bundle && npx electron-builder --linux dir
 * Run:          NODE_PATH=/opt/node22/lib/node_modules xvfb-run -a node tools/verify/verify-desktop.cjs [scratch-dir]
 */
/* playwright-core in CI (no browser download), the global playwright in the sandbox. */
const { _electron: electron } = (() => {
  try { return require('playwright-core'); } catch { return require('playwright'); }
})();
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
/* Where electron-builder leaves the unpacked app on each OS. */
/* SYNTECH_EXE: test an app somewhere else — CI points it at the Mac .zip
   unpacked the way Finder does, so the file people download is what is tested. */
const EXE = process.env.SYNTECH_EXE || path.join(ROOT, 'release', {
  linux: 'linux-unpacked/vfx-syntech',
  win32: 'win-unpacked/VFX SYNTECH.exe',
  darwin: 'mac-universal/VFX SYNTECH.app/Contents/MacOS/VFX SYNTECH',
}[process.platform]);
const SCRATCH = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'syn-desktop-'));
fs.mkdirSync(SCRATCH, { recursive: true });
/* A throwaway profile, so the run never touches a real user's presets. */
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-profile-'));
/* --no-sandbox: the sandbox runs as root, where Chromium refuses its own sandbox. */
const ARGS = [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${PROFILE}`];
const EFFECTS = ['blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab'];

let pass = 0, fail = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};

async function launch() {
  const app = await electron.launch({ executablePath: EXE, args: ARGS, timeout: 60000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForLoadState('load');
  return { app, page, errors };
}

(async () => {
  if (!fs.existsSync(EXE)) throw new Error(`no packaged app at ${EXE} — build it first (see header)`);

  // ── 1. it opens by itself ────────────────────────────────────────────────
  let { app, page, errors } = await launch();
  const url = page.url();
  step('window loads the embedded server', url === 'http://127.0.0.1:47291/', url);
  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
  step('window title', title === 'VFX SYNTECH', title);
  step('exactly one window', app.windows().length === 1, String(app.windows().length));

  // ── 1b. the intro: logo → pet on black, LOADING 0 → 100%, then the app ────
  const t0 = Date.now();
  await page.waitForSelector('[data-testid="intro-video"]', { timeout: 15000 });
  step('intro shows on launch', true);
  const sample = () => page.evaluate(() => {
    const v = document.querySelector('[data-testid="intro-video"]');
    const p = document.querySelector('[data-testid="intro-pct"]');
    return v ? { t: v.currentTime, d: v.duration, err: v.error && v.error.code, pct: parseInt((p && p.textContent || '').replace(/\D/g, ''), 10) || 0 } : null;
  }).catch(() => null);
  const first = await sample();
  await page.waitForTimeout(3000);
  const later = await sample();
  step('intro video plays (9.13 s, advancing, no error)',
    !!first && !!later && !later.err && later.t > first.t + 1.5 && Math.abs(later.d - 9.13) < 0.2,
    later ? `t ${first.t.toFixed(2)} → ${later.t.toFixed(2)} of ${later.d}` : 'gone');
  await page.screenshot({ path: path.join(SCRATCH, 'desktop-intro.png') });
  let maxPct = later ? later.pct : 0;
  for (let s; (s = await sample()); await page.waitForTimeout(200)) maxPct = Math.max(maxPct, s.pct);
  step('LOADING counter climbs to 100%', later && later.pct > 0 && later.pct < 100 && maxPct === 100, `mid ${later && later.pct}% · max ${maxPct}%`);
  await page.waitForSelector('[data-testid="intro"]', { state: 'detached', timeout: 20000 });
  const took = (Date.now() - t0) / 1000;
  step('intro ends by itself and hands over to the app', took > 8 && took < 14, `${took.toFixed(1)} s`);

  await page.waitForSelector('[data-testid="effect-card-bokeh"]', { timeout: 30000 });
  step('shell rendered (effect cards present)', true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SCRATCH, 'desktop-home.png') });

  // ── 2. everything served from inside the app ─────────────────────────────
  const assets = await page.evaluate(async (ids) => {
    const probe = async (u) => {
      const r = await fetch(u);
      return { u, status: r.status, type: r.headers.get('content-type') || '' };
    };
    return Promise.all([
      ...ids.map((id) => probe(`/effects/${id}/index.html`)),
      probe('/effects/vendor/three.min.js'),
      probe('/effects/vendor/fonts/shell.css'),
      probe('/effects/vendor/mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm'),
      probe('/assets/logo.webp'),
    ]);
  }, EFFECTS);
  for (const a of assets) step(`served ${a.u}`, a.status === 200, `${a.status} ${a.type}`);
  const wasm = assets.find((a) => a.u.endsWith('.wasm'));
  step('wasm served as application/wasm', wasm.type.startsWith('application/wasm'), wasm.type);

  // ── 3. AI endpoints, no key ───────────────────────────────────────────────
  const ai = await page.evaluate(async () => {
    const r = await fetch('/api/gemini/optimize', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeModule: 'bokeh', parameters: {} }),
    });
    return { status: r.status, body: await r.json() };
  });
  step('AI optimizer answers offline', ai.status === 200 && ai.body.isFallback === true && !!ai.body.preset, JSON.stringify(ai.body.preset));

  // ── 4. all five effects open ──────────────────────────────────────────────
  for (const id of EFFECTS) {
    const before = errors.length;
    await page.click(`[data-testid="effect-card-${id}"]`);
    /* The host reuses one <iframe> and swaps its src, so wait for THIS effect's
       document to be the one loaded — not the previous effect still in there. */
    const want = `/effects/${id}/index.html`;
    let f = null;
    for (const t0 = Date.now(); Date.now() - t0 < 30000; await page.waitForTimeout(250)) {
      f = page.frames().find((fr) => fr.url().endsWith(want));
      if (f && (await f.evaluate(() => document.readyState).catch(() => '')) === 'complete') break;
      f = null;
    }
    await page.waitForTimeout(2500);
    const bodyText = f ? await f.evaluate(() => document.body.innerText.length).catch(() => 0) : 0;
    step(`effect ${id} opens`, !!f && bodyText > 0 && errors.length === before,
      `${f ? want : 'never loaded'}${errors.length > before ? ' · ' + errors.slice(before).join(' | ') : ''}`);
    await page.screenshot({ path: path.join(SCRATCH, `desktop-${id}.png`) });
  }

  const codecs = await page.evaluate(async () => {
    if (!('VideoEncoder' in window)) return 'no WebCodecs';
    const q = (codec) => VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 8e6, framerate: 30 })
      .then((r) => r.supported).catch(() => false);
    return `h264=${await q('avc1.640028')} vp9=${await q('vp09.00.10.08')}`;
  });
  console.log(`INFO  WebCodecs encoders on this machine: ${codecs}`);
  const decode = await page.evaluate(() => {
    const v = document.createElement('video');
    return ['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="hvc1.1.6.L120.90"', 'video/webm; codecs="vp9"']
      .map((t) => `${t.split(';')[0]}/${t.split('"')[1]}=${v.canPlayType(t) || 'no'}`).join(' ');
  });
  console.log(`INFO  video decode: ${decode}`);
  step('H.264 MP4 plays (the operator\'s clips)', decode.includes('avc1.640028=probably'), decode);

  // ── 5. localStorage survives a relaunch ───────────────────────────────────
  const stamp = String(Date.now());
  await page.evaluate((s) => localStorage.setItem('syntech.desktopProbe', s), stamp);
  await app.close();
  ({ app, page, errors } = await launch());
  const back = await page.evaluate(() => localStorage.getItem('syntech.desktopProbe'));
  step('localStorage survives quit + relaunch', back === stamp, `${back}`);

  // ── 6. single instance ────────────────────────────────────────────────────
  const second = spawn(EXE, ARGS, { stdio: 'ignore' });
  const code = await new Promise((resolve) => {
    const t = setTimeout(() => { second.kill(); resolve('still running'); }, 15000);
    second.on('exit', (c) => { clearTimeout(t); resolve(c); });
  });
  step('second launch exits, first keeps running', code === 0 && app.windows().length === 1, `exit=${code}`);
  await page.evaluate(() => localStorage.removeItem('syntech.desktopProbe'));
  await app.close();

  // ── 7. port taken by another program ──────────────────────────────────────
  const squatter = net.createServer().listen(47291, '127.0.0.1');
  await new Promise((r) => squatter.once('listening', r));
  ({ app, page, errors } = await launch());
  const alt = page.url();
  await page.waitForSelector('[data-testid="effect-card-bokeh"]', { timeout: 30000 });
  step('port busy → still opens on another port', /^http:\/\/127\.0\.0\.1:\d+\/$/.test(alt) && !alt.includes(':47291/'), alt);
  await app.close();
  squatter.close();

  fs.rmSync(PROFILE, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed · screenshots in ${SCRATCH}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
