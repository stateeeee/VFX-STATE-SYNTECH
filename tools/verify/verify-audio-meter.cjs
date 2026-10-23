/*
 * THE SIDEBAR LEVEL METER — does it follow the sound on screen, and read it right?
 *
 * A stereo test clip (made here with ffmpeg) whose levels are known:
 *   left  = 440 Hz at −12 dBFS for 4 s, then driven past full scale (clipping);
 *   right = 660 Hz at −30 dBFS throughout.
 * On the −60…0 dBFS scale that is 0.80 of the column on the left (amber zone),
 * 0.50 on the right (green), then the left column at the top with CLIP lit.
 *
 *   1. Home: the clip loaded in INPUT → the meter is live, L ≈ 0.80, R ≈ 0.50.
 *   2. Home, past 4 s: the left CLIP light is on, the right one is not.
 *   3. An open effect playing the same clip from its own file input → the
 *      meter follows it (it used to stay dead inside effects). BOKEH, and BLOB
 *      REVEAL — the one effect whose SynExtras adapter has no `video`.
 *   4. Back to Home → live again (the hero <video> is re-mounted; it used to
 *      stay detached after visiting an effect).
 *   5. The Lab with its Clip audio on → the meter reads the Lab's audio.
 *
 * Two targets — they differ: Chromium 128 (the desktop app's Electron 32)
 * captures a MUTED element as silence, newer Chromium does not, and the Lab's
 * clip audio was silent in the desktop app only.
 *   browser: the dev server (default http://localhost:3000; BASE=… to override)
 *     NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-audio-meter.cjs [scratch-dir]
 *   desktop: the packaged app (build it as in verify-desktop.cjs)
 *     SYNTECH_EXE=release/linux-unpacked/vfx-syntech NODE_PATH=/opt/node22/lib/node_modules \
 *       xvfb-run -a node tools/verify/verify-audio-meter.cjs [scratch-dir]
 */
const { chromium, _electron: electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const SCRATCH = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'syn-meter-'));
fs.mkdirSync(SCRATCH, { recursive: true });
const CLIP = path.join(SCRATCH, 'meter-test.webm');

const L_UNIT = 0.8;   // −12 dBFS on a −60…0 scale
const R_UNIT = 0.5;   // −30 dBFS
const TOL = 0.06;     // a few pixels on a ~200 px column, plus codec ripple

let pass = 0, fail = 0;
const step = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const near = (v, want) => Math.abs(v - want) <= TOL;
const f2 = (v) => v.toFixed(2);

function makeClip() {
  if (fs.existsSync(CLIP)) return;
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x202040:s=640x360:r=30:d=8',
    '-f', 'lavfi', '-i',
    "aevalsrc='if(lt(t,4),0.251*sin(2*PI*440*t),max(-1,min(1,2*sin(2*PI*440*t))))|0.0316*sin(2*PI*660*t)':s=48000:d=8",
    '-c:v', 'libvpx', '-b:v', '300k', '-c:a', 'libopus', '-b:a', '256k', '-shortest', CLIP,
  ]);
}

/* the two columns as fractions of their track, and the CLIP lights */
const readMeter = (page) => page.evaluate(() => {
  const q = (id) => document.querySelector(`[data-testid="${id}"]`);
  const track = q('audio-meter-track');
  const h = track ? track.getBoundingClientRect().height : 0;
  const frac = (id) => { const el = q(id); return el && h ? el.getBoundingClientRect().height / h : 0; };
  return {
    live: q('audio-meter')?.dataset.live === 'true',
    l: frac('audio-meter-fill'),
    r: frac('audio-meter-fill-r'),
    clipL: q('audio-meter-track')?.dataset.clip === 'true',
    clipR: q('audio-meter-track-r')?.dataset.clip === 'true',
  };
});

/* sample the meter while `time()` (the playing clip's currentTime) is in [from, to) */
async function sampleWhile(page, time, from, to, ms = 2500) {
  const out = [];
  for (const t0 = Date.now(); Date.now() - t0 < ms; await page.waitForTimeout(100)) {
    const t = await time();
    if (t >= from && t < to) out.push(await readMeter(page));
  }
  return out;
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function waitLive(page, timeout = 8000) {
  try {
    await page.waitForSelector('[data-testid="audio-meter"][data-live="true"]', { timeout });
    return true;
  } catch { return false; }
}

(async () => {
  makeClip();
  let browser, page;
  if (process.env.SYNTECH_EXE) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-profile-'));
    browser = await electron.launch({
      executablePath: process.env.SYNTECH_EXE,
      args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`],
      timeout: 60000,
    });
    page = await browser.firstWindow();
    await page.waitForSelector('[data-testid="intro"]', { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('Space'); // skip the intro
    await page.waitForSelector('[data-testid="intro"]', { state: 'detached', timeout: 20000 }).catch(() => {});
    console.log(`INFO  desktop app: ${await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+|Electron\/[\d.]+/g).join(' '))}`);
  } else {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(BASE);
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.waitForSelector('[data-testid="effect-card-bokeh"]', { timeout: 30000 });

  // ── 1. Home ───────────────────────────────────────────────────────────────
  step('idle with no source', !(await readMeter(page)).live);
  await page.setInputFiles('[data-testid="source-file"]', CLIP);
  await page.waitForSelector('[data-testid="hero-video"]', { timeout: 10000 });
  const heroTime = () => page.evaluate(() => document.querySelector('[data-testid="hero-video"]')?.currentTime ?? -1);
  step('Home: meter live on the INPUT clip', await waitLive(page));
  let s = await sampleWhile(page, heroTime, 0.6, 3.8);
  let l = median(s.map((x) => x.l)), r = median(s.map((x) => x.r));
  step('Home: left reads −12 dBFS (0.80, amber)', s.length > 3 && near(l, L_UNIT), `L ${f2(l)} over ${s.length} samples`);
  step('Home: right reads −30 dBFS (0.50, green)', s.length > 3 && near(r, R_UNIT), `R ${f2(r)}`);
  step('Home: no CLIP while below full scale', s.length > 3 && s.every((x) => !x.clipL && !x.clipR));
  await page.screenshot({ path: path.join(SCRATCH, 'meter-home.png'), clip: { x: 0, y: 560, width: 220, height: 440 } });

  // ── 2. clipping ───────────────────────────────────────────────────────────
  s = await sampleWhile(page, heroTime, 4.3, 7.8, 5000);
  step('Home: left CLIP lights past full scale', s.some((x) => x.clipL), `${s.filter((x) => x.clipL).length}/${s.length} samples`);
  step('Home: left column at the top', s.some((x) => x.l > 0.97), `max L ${f2(Math.max(0, ...s.map((x) => x.l)))}`);
  step('Home: right CLIP stays off', s.length > 3 && s.every((x) => !x.clipR));
  await page.screenshot({ path: path.join(SCRATCH, 'meter-clip.png'), clip: { x: 0, y: 560, width: 220, height: 440 } });

  // ── 3. inside an effect ───────────────────────────────────────────────────
  for (const id of ['bokeh', 'blob_reveal']) {
    await page.click(`[data-testid="effect-card-${id}"]`);
    let fx = null;
    for (const t0 = Date.now(); !fx && Date.now() - t0 < 20000; await page.waitForTimeout(250)) {
      fx = page.frames().find((f) => f.url().includes(`/effects/${id}/`));
      if (fx && !(await fx.$('#file-input').catch(() => null))) fx = null;
    }
    step(`${id}: opened`, !!fx);
    if (!fx) continue;
    step(`${id}: no clip loaded yet → meter idle`, !(await readMeter(page)).live);
    await fx.setInputFiles('#file-input', CLIP);
    const fxTime = () => fx.evaluate(() => window.SynExtras?.media?.()?.currentTime ?? -1).catch(() => -1);
    /* an effect renders WebGL in the same renderer as the shell: on a machine
       without a GPU (CI, this sandbox) each read can take seconds, so this part
       waits and samples longer — the readings themselves are held to the same bounds */
    step(`${id}: meter live on the effect's clip`, await waitLive(page, 30000));
    s = await sampleWhile(page, fxTime, 0.6, 3.8, 40000);
    l = median(s.map((x) => x.l)); r = median(s.map((x) => x.r));
    step(`${id}: left −12 dBFS, right −30 dBFS`, s.length > 3 && near(l, L_UNIT) && near(r, R_UNIT), `L ${f2(l)} R ${f2(r)} over ${s.length} samples`);
    s = await sampleWhile(page, fxTime, 4.3, 7.8, 40000);
    step(`${id}: left CLIP lights past full scale`, s.some((x) => x.clipL), `${s.filter((x) => x.clipL).length}/${s.length} samples`);
  }

  // ── 4. back to Home ───────────────────────────────────────────────────────
  await page.click('[data-testid="nav-home"]');
  await page.waitForSelector('[data-testid="hero-video"]', { timeout: 10000 });
  step('Home again: meter re-attached to the re-mounted clip', await waitLive(page));
  s = await sampleWhile(page, heroTime, 0.6, 3.8, 9000);
  l = median(s.map((x) => x.l));
  step('Home again: left still reads −12 dBFS', s.length > 3 && near(l, L_UNIT), `L ${f2(l)}`);

  // ── 5. the Lab ────────────────────────────────────────────────────────────
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForSelector('[data-testid="audio-clip"]', { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.click('[data-testid="audio-clip"]');
  step('Lab: meter live on the Lab\'s clip audio', await waitLive(page));
  await page.waitForTimeout(1000);
  s = [];
  for (let i = 0; i < 40; i++) { s.push(await readMeter(page)); await page.waitForTimeout(100); }
  const maxL = Math.max(...s.map((x) => x.l)), maxR = Math.max(...s.map((x) => x.r));
  step('Lab: left louder than right, right ≈ −30 dBFS', maxL > maxR + 0.15 && near(median(s.map((x) => x.r)), R_UNIT),
    `max L ${f2(maxL)} · max R ${f2(maxR)} · median R ${f2(median(s.map((x) => x.r)))}`);

  step('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed · screenshots in ${SCRATCH}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
