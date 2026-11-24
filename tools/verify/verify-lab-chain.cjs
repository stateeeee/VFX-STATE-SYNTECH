/*
 * THE LAB v2/v3 — a chain of the REAL effects (operator decision 2026-10-28, "option 1"),
 * shown like an OPENED EFFECT (LAB v3, operator design 2026-11-19): the effects' top bar
 * (the chain's names A→Z), the chain OUTPUT in the framed stage + transport, and a right
 * column with SOURCE · one block per node (A→Z, collapsed; open = its real panel) · LABORATORY.
 *
 * Every Lab node is the standalone effect in an iframe; each hop is the previous
 * effect's canvas.captureStream() fed through window.SynLab as an external source.
 * This suite drives the real app with a deterministic clip made here with ffmpeg:
 *   picture — LEFT half bright, RIGHT half dark (the mirror test), a red square
 *             moving on the right (motion), 1280×720, 30 fps, 8 s
 *   sound   — a 110 Hz bass pulse twice a second + a 440 Hz tone
 *
 *   1. wiring: one iframe per node, each with its FULL panel (its Info section) in
 *      panel-only layout (SynLab.setLayout: its own Source section hidden, its canvas
 *      area out of view at the stage's size — never 0×0); no tabs; the title = the
 *      chain's names A→Z; blocks A→Z, every node block collapsed at open
 *   2. every hop delivers frames (fps of each captureStream, measured through a
 *      <video> + requestVideoFrameCallback) with EVERY node block collapsed, then with an
 *      open panel scrolled out of view — collapsed / scrolled-away iframes must not stall;
 *      every node at the Lab frame budget (30); opening a block shows its panel
 *   3. OUTPUT ≠ INPUT (pixels); the external source is NOT mirrored (left-bright
 *      input → left-bright in node 1)
 *   4. audio: Clip turns on by itself, the sidebar meter moves; the Clip button
 *      turns it off and on again
 *   5. transport: pause freezes the chain (no input frames, output still), play
 *      resumes, scrub moves currentTime, loop toggles; LOOP = PAUSE's look, on = amber text
 *   6. LABORATORY = four buttons (SAVE / OPEN VFX CHAIN … PROJECTS, RESET, EXPORT): save →
 *      change a param → open restores it; RESET puts the initial value back
 *   7. Gemini LabHandle: chainState lists params from every node; applyPlan /
 *      revertPlan round-trip one value
 *   8. EXPORT VFX CHAIN = offline SynExport.render of a 2 s clip: download *_LAB_MASTER.mp4; ffprobe h264 / size / fps /
 *      frame count / audio equal the input's; MASTER/HIGH + PNG/JPEG/PDF rows exist
 *   9. day theme reaches every Lab iframe (data-syn-theme + the effect's <html>); the
 *      block headers turn white + violet (operator decision 2026-11-22, commit 6f12310)
 *  10. hidden Lab: parked, every node paused, a Gemini grab holds it live (FRESH frames)
 *
 * Two targets (same as verify-audio-meter.cjs):
 *   browser: BASE=http://localhost:3103 NODE_PATH=/opt/node22/lib/node_modules \
 *              node tools/verify/verify-lab-chain.cjs [scratch-dir]
 *   desktop: SYNTECH_EXE=release/linux-unpacked/vfx-syntech NODE_PATH=/opt/node22/lib/node_modules \
 *              xvfb-run -a node tools/verify/verify-lab-chain.cjs [scratch-dir]
 * LAB_CHAIN=analog,painting,bokeh (default) picks the chain.
 * The page is opened with ?labdebug, which publishes window.__synLabDebug (the
 * LabHandle + read-only taps) — never present without that flag.
 */
const { chromium, _electron: electron } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:3000';
const SCRATCH = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'syn-labchain-'));
fs.mkdirSync(SCRATCH, { recursive: true });
const CLIP = path.join(SCRATCH, 'lab-chain-test.webm');
const CHAIN = (process.env.LAB_CHAIN || 'analog,painting,bokeh').split(',').map((s) => s.trim()).filter(Boolean);
const TARGET = process.env.SYNTECH_EXE ? 'desktop' : 'browser';
const shotPath = (name) => path.join(SCRATCH, `${TARGET}-${name}.png`);
/* software GL is slow: a screenshot may wait long for a frame — never fail the run on one */
const snap = (page, name) => page.screenshot({ path: shotPath(name), timeout: 120000 }).catch((e) => console.log(`INFO  screenshot ${name} skipped: ${e.message.split('\n')[0]}`));

let pass = 0, fail = 0;
const results = [];
const step = (name, ok, detail = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  console.log(line);
  results.push(line);
  ok ? pass++ : fail++;
};
const info = (s) => console.log(`INFO  ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClip() {
  if (fs.existsSync(CLIP)) return;
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x101010:s=1280x720:r=30:d=8',
    '-f', 'lavfi', '-i', "aevalsrc='0.45*sin(2*PI*110*t)*lt(mod(t\\,0.5)\\,0.12)+0.12*sin(2*PI*440*t)':s=48000:d=8",
    '-vf', "drawbox=x=0:y=0:w=640:h=720:color=0xf0f0f0@1:t=fill,drawbox=x='700+mod(t*160\\,480)':y=300:w=90:h=90:color=0xe03030@1:t=fill",
    '-c:v', 'libvpx', '-b:v', '1500k', '-c:a', 'libopus', '-b:a', '160k', '-shortest', CLIP,
  ]);
}

const q = (id) => `[data-testid="${id}"]`;
const dbg = (page, fn, arg) => page.evaluate(fn, arg);
/* in-page click: with software GL (CI, this sandbox) the renderer is busy drawing the
   effects and Playwright's pointer click can time out waiting for it */
const domClick = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) throw new Error('missing ' + s);
  el.click();
}, sel);

/* frames/s of a set of MediaStreams, counted through <video> + requestVideoFrameCallback */
const streamFps = (page, ms = Number(process.env.FPS_WINDOW_MS) || 10000) => page.evaluate(async (ms) => {
  const D = window.__synLabDebug;
  const list = [{ id: 'INPUT', stream: D.inputStream() }, ...D.hopStreams(), { id: 'OUTPUT', stream: D.outputStream() }];
  const vids = list.map(({ stream }) => {
    if (!stream) return null;
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:6px;height:6px;pointer-events:none;z-index:99999';
    document.body.appendChild(v);
    v.play().catch(() => {});
    return v;
  });
  await new Promise((r) => setTimeout(r, 500));
  // the first callback is the frame the stream already holds (a paused input still shows one): not counted
  const counts = list.map(() => -1);
  vids.forEach((v, i) => { if (!v) return; const cb = () => { counts[i]++; v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); });
  await new Promise((r) => setTimeout(r, ms));
  vids.forEach((v) => { if (v) { v.srcObject = null; v.remove(); } });
  return list.map((x, i) => ({ id: x.id, fps: Math.round((Math.max(0, counts[i]) * 10000) / ms) / 10 }));
}, ms);

/* a 64×36 luma picture of a MediaStream / element: [mean, left mean, right mean, data] */
const lumaOnce = (page, which) => page.evaluate(async (which) => {
  const D = window.__synLabDebug;
  let el;
  let tmp = null;
  if (which === 'input') el = D.inputVideo();
  else if (which === 'output') el = document.querySelector('[data-testid="lab-output-video"]');
  else {
    const s = D.hopStreams().find((h) => h.id === which)?.stream;
    if (!s) return null;
    tmp = document.createElement('video');
    tmp.muted = true; tmp.srcObject = s;
    tmp.style.cssText = 'position:fixed;left:0;top:0;width:8px;height:8px;opacity:0.01';
    document.body.appendChild(tmp);
    await tmp.play().catch(() => {});
    await new Promise((r) => { const t0 = performance.now(); const w = () => (tmp.readyState >= 2 && tmp.videoWidth) || performance.now() - t0 > 4000 ? r() : setTimeout(w, 50); w(); });
    await new Promise((r) => setTimeout(r, 300));
    el = tmp;
  }
  if (!el || el.readyState < 2) { tmp?.remove(); return null; }
  const c = document.createElement('canvas'); c.width = 64; c.height = 36;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(el, 0, 0, 64, 36);
  const d = g.getImageData(0, 0, 64, 36).data;
  tmp?.remove();
  const luma = [];
  let L = 0, R = 0, all = 0;
  for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) {
    const o = (y * 64 + x) * 4;
    const v = d[o] * 0.2126 + d[o + 1] * 0.7152 + d[o + 2] * 0.0722;
    luma.push(Math.round(v));
    all += v;
    if (x < 32) L += v; else R += v;
  }
  return { mean: all / 2304, left: L / 1152, right: R / 1152, luma };
}, which);
/* a looping clip has no frame for a moment at its loop point: retry */
async function lumaOf(page, which) {
  for (let i = 0; i < 6; i++) {
    const r = await lumaOnce(page, which).catch(() => null);
    if (r) return r;
    await sleep(700);
  }
  return null;
}
const diffOf = (a, b) => a.luma.reduce((s, v, i) => s + Math.abs(v - b.luma[i]), 0) / a.luma.length;

/* poll a page predicate from Node (Playwright's own waitFor* polls on rAF, which a renderer
   busy with software-GL effects runs at ~1 Hz) */
async function until(page, fn, timeout = 20000, arg) {
  for (const t0 = Date.now(); Date.now() - t0 < timeout; await sleep(250)) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
  }
  return false;
}
const meterLive = (page, want, timeout) => until(page, (w) => document.querySelector('[data-testid="audio-meter"]')?.dataset.live === (w ? 'true' : 'false'), timeout, want);

const readMeter = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="audio-meter"]');
  const track = document.querySelector('[data-testid="audio-meter-track"]');
  const fill = document.querySelector('[data-testid="audio-meter-fill"]');
  const h = track ? track.getBoundingClientRect().height : 0;
  return { live: el?.dataset.live === 'true', l: fill && h ? fill.getBoundingClientRect().height / h : 0 };
});
/* the transport button is a toggle: press it only when the INPUT is not already in the wanted state
   (at the loop point a slow renderer can report a still-ended element for a moment) */
async function setPlaying(page, want) {
  for (let i = 0; i < 3; i++) {
    const paused = await page.evaluate(() => window.__synLabDebug.inputVideo().paused);
    if (paused === !want) return true;
    await domClick(page, q('lab-play'));
    await sleep(600);
  }
  return (await page.evaluate(() => window.__synLabDebug.inputVideo().paused)) === !want;
}
/* each node's SynLab frame budget (state().budget: null = native, 0 = paused, 30 = Lab rate) */
const nodeBudgets = (page) => page.evaluate((chain) => Object.fromEntries(chain.map((id) => {
  try { return [id, window.__synLabDebug.api(id).state().budget]; } catch { return [id, 'n/a']; }
})), CHAIN);
const audioMode = (page) => page.evaluate(() => window.__synLabDebug.audio.mode);
const clipOn = (page) => page.evaluate(() => document.querySelector('[data-testid="audio-clip"]')?.classList.contains('on'));
const NAME = { analog: 'ANALOG', anamorphic_lab: 'ANAMORPHIC', blob_reveal: 'BLOB REVEAL', blob_tracker: 'BLOB TRACKER', bokeh: 'BOKEH', invisible: 'INVISIBLE', time_machine: 'TIME MACHINE', quadtree: 'QUADTREE', pointcloud: 'POINTCLOUD', painting: 'PAINTING' };
const SORTED = CHAIN.slice().sort((a, b) => (NAME[a] || a).localeCompare(NAME[b] || b));
/* the right column: every block in DOM order, with its open state and its clip's height */
const blocks = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="lab-block-head-"]')].map((h) => {
  const blk = h.closest('section');
  const clip = blk?.querySelector('.fxl-blk-clip');
  return { id: h.dataset.testid.replace('lab-block-head-', ''), open: h.getAttribute('aria-expanded') === 'true', link: h.dataset.link || null, clipH: clip ? Math.round(clip.getBoundingClientRect().height) : -1 };
}));
const setBlock = (page, id, open) => page.evaluate(({ id, open }) => {
  const h = document.querySelector(`[data-testid="lab-block-head-${id}"]`);
  if (!h) throw new Error('missing block ' + id);
  if ((h.getAttribute('aria-expanded') === 'true') !== open) h.click();
}, { id, open });
const scrollColumn = (page, where) => page.evaluate((where) => {
  const c = document.querySelector('[data-testid="lab-column"]');
  c.scrollTop = where === 'end' ? c.scrollHeight : 0;
  return { top: Math.round(c.scrollTop), max: c.scrollHeight - c.clientHeight };
}, where);
/* the OUTPUT <video>: frames presented in `ms` (rVFC) and how far its clock moved */
const outputAdvance = (page, ms) => page.evaluate(async (ms) => {
  const ov = document.querySelector('[data-testid="lab-output-video"]');
  let n = 0, alive = true;
  const cb = () => { if (!alive) return; n++; ov.requestVideoFrameCallback(cb); };
  ov.requestVideoFrameCallback(cb);
  const t0 = ov.currentTime;
  await new Promise((r) => setTimeout(r, ms));
  alive = false;
  return { frames: n, clock: Math.round((ov.currentTime - t0) * 100) / 100, live: !!(ov.srcObject && ov.srcObject.getVideoTracks().some((t) => t.readyState === 'live')) };
}, ms);

(async () => {
  makeClip();
  let app = null, browser = null, page;
  const errors = [];
  if (TARGET === 'desktop') {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-profile-'));
    app = await electron.launch({
      executablePath: process.env.SYNTECH_EXE,
      args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), `--user-data-dir=${profile}`],
      timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector(q('intro'), { timeout: 15000 }).catch(() => {});
    await page.keyboard.press('Space');
    await page.waitForSelector(q('intro'), { state: 'detached', timeout: 20000 }).catch(() => {});
    const origin = new URL(page.url()).origin;
    info(`desktop app: ${await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+|Electron\/[\d.]+/g).join(' '))} at ${origin}`);
    await page.evaluate((chain) => {
      const wires = { IN: chain[0] };
      chain.forEach((id, i) => { wires[id] = chain[i + 1] || 'OUT'; });
      localStorage.setItem('syntech.composition.v3', JSON.stringify({ nodes: chain, wires }));
      localStorage.removeItem('syntech.chainPresets');
    }, CHAIN);
    await page.goto(`${origin}/?labdebug`);
    await page.waitForSelector(q('intro'), { timeout: 8000 }).then(() => page.keyboard.press('Space')).catch(() => {});
    await page.waitForSelector(q('intro'), { state: 'detached', timeout: 20000 }).catch(() => {});
  } else {
    browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/?labdebug`);
    await page.evaluate((chain) => {
      const wires = { IN: chain[0] };
      chain.forEach((id, i) => { wires[id] = chain[i + 1] || 'OUT'; });
      localStorage.setItem('syntech.composition.v3', JSON.stringify({ nodes: chain, wires }));
      localStorage.removeItem('syntech.chainPresets');
    }, CHAIN);
    await page.reload();
    info(`browser: ${await browser.version()} at ${BASE}`);
  }
  await page.waitForSelector(q('effect-card-bokeh'), { timeout: 30000 });
  info(`chain: ${CHAIN.join(' → ')}`);

  // the clip on Home (INPUT node), then the Lab (a click: the user gesture the audio needs)
  await page.setInputFiles(q('source-file'), CLIP);
  await page.waitForSelector(q('hero-video'), { timeout: 10000 });
  await domClick(page, q('nav-ailab'));
  await page.waitForSelector(q('chain-lab'), { timeout: 20000 });

  // ── 1. wiring + full panels ────────────────────────────────────────────
  const framesThere = await page.evaluate((chain) => chain.every((id) => !!document.querySelector(`[data-testid="lab-frame-${id}"]`)), CHAIN);
  step('one iframe per wired node', framesThere, CHAIN.map((id) => `lab-frame-${id}`).join(', '));
  let ready = [];
  for (const t0 = Date.now(); Date.now() - t0 < 90000; await sleep(500)) {
    const links = await dbg(page, () => window.__synLabDebug.links());
    ready = CHAIN.filter((id) => links[id] === 'ready');
    if (ready.length === CHAIN.length) break;
  }
  const notReady = CHAIN.filter((id) => !ready.includes(id));
  step('every node has its SynLab link', notReady.length === 0, notReady.length ? `NOT READY: ${notReady.join(', ')}` : CHAIN.join(', '));
  for (const id of CHAIN) {
    const fr = page.frames().find((f) => f.url().includes(`/effects/${id}/`));
    const panel = fr ? await fr.evaluate(() => {
      const titles = [...document.querySelectorAll('.sec-title')].map((e) => (e.textContent || '').trim());
      return { titles, info: titles.some((t) => /info/i.test(t)), panel: !!document.getElementById('panel') };
    }).catch(() => null) : null;
    step(`${id}: full panel in its iframe (Info section present)`, !!panel && panel.panel && panel.info, panel ? `${panel.titles.length} sections: ${panel.titles.join(' | ').slice(0, 160)}` : 'no frame');
  }
  // ── 1b. LAB v3: panel-only layout, no tabs, the title + blocks A→Z, node blocks collapsed ──
  await until(page, (n) => Object.values(window.__synLabDebug.layouts()).filter((l) => l.layout && l.layout.mode === 'panel' && l.panelHeight > 0).length === n, 30000, CHAIN.length);
  const lay = await page.evaluate((chain) => {
    const stage = document.querySelector('[data-testid="lab-stage"]').getBoundingClientRect();
    return {
      stage: [Math.round(stage.width), Math.round(stage.height)],
      nodes: chain.map((id) => {
        const f = document.querySelector(`[data-testid="lab-frame-${id}"]`);
        const d = f.contentDocument;
        const area = d.getElementById('canvas-area').getBoundingClientRect();
        const src = [...d.querySelectorAll('#panel .sec-title')].filter((t) => /^source$/i.test(t.textContent.trim()));
        const srcHidden = src.length > 0 && src.every((t) => t.getClientRects().length === 0);
        const topbarOut = d.getElementById('topbar').getBoundingClientRect().right <= 0;
        const panel = d.getElementById('panel').getBoundingClientRect();
        return { id, mode: d.documentElement.dataset.synLayout, area: [Math.round(area.width), Math.round(area.height)], areaOut: area.right <= 0, srcHidden, topbarOut, panelW: Math.round(panel.width), frameW: Math.round(f.getBoundingClientRect().width) };
      }),
    };
  }, CHAIN);
  for (const n of lay.nodes) {
    step(`${n.id}: panel-only layout (its Source section hidden, top bar + canvas out of view, panel at full width)`,
      n.mode === 'panel' && n.srcHidden && n.topbarOut && n.areaOut && Math.abs(n.panelW - n.frameW) <= 1, JSON.stringify(n));
    step(`${n.id}: its canvas area keeps the stage's size (never 0×0)`, n.area[0] === lay.stage[0] && n.area[1] === lay.stage[1] && n.area[0] >= 320, `area ${n.area.join('×')} · stage ${lay.stage.join('×')}`);
  }
  const tabs = await page.evaluate(() => document.querySelectorAll('[data-testid^="lab-tab-"]').length);
  step('no tabs (LAB v3)', tabs === 0, `${tabs} lab-tab-* elements`);
  const title = (await page.textContent(q('lab-title'))).trim();
  const wantTitle = SORTED.map((id) => NAME[id]).join(' · ');
  step('title = the chain\'s names A→Z (display only)', title === wantTitle, `"${title}" (processing order ${CHAIN.join(' → ')})`);
  const bl0 = await blocks(page);
  step('column: SOURCE · the nodes A→Z · LABORATORY', JSON.stringify(bl0.map((b) => b.id)) === JSON.stringify(['source', ...SORTED, 'laboratory']), bl0.map((b) => b.id).join(' · '));
  step('at open every node block is collapsed (clip 0 px), SOURCE + LABORATORY open',
    bl0.filter((b) => CHAIN.includes(b.id)).every((b) => !b.open && b.clipH === 0) && bl0.find((b) => b.id === 'source').open && bl0.find((b) => b.id === 'laboratory').open,
    bl0.map((b) => `${b.id}:${b.open ? 'open' : 'closed'}/${b.clipH}px`).join(' '));
  step('every node block head says its link is ready', bl0.filter((b) => CHAIN.includes(b.id)).every((b) => b.link === 'ready'), bl0.map((b) => `${b.id}:${b.link}`).join(' '));
  await until(page, () => document.querySelector('[data-testid="chain-input"]')?.classList.contains('live'), 30000);

  // ── 2. every hop flows with every node block COLLAPSED (frame budget: every node at 30) ──
  await sleep(2500);
  const budgetsAll = await nodeBudgets(page);
  step('Lab visible: every node at the Lab frame budget (30)', CHAIN.every((id) => budgetsAll[id] === 30), JSON.stringify(budgetsAll));
  const hops = await streamFps(page);
  info(`hop fps (every node block collapsed): ${hops.map((h) => `${h.id} ${h.fps}`).join(' · ')}`);
  step('every hop delivers frames (fps > 0) with every node block collapsed', hops.every((h) => h.fps > 0), hops.map((h) => `${h.id}=${h.fps}`).join(' '));
  const lastHop = hops[hops.length - 2];
  step(`the LAST node (${lastHop.id}) keeps rendering, collapsed`, lastHop.fps > 0, `${lastHop.fps} fps`);
  const adv0 = await outputAdvance(page, 4000);
  step('collapsed: the OUTPUT video advances (frames presented, stream live)', adv0.frames > 0 && adv0.live, JSON.stringify(adv0));
  const fpsPill = Number(await page.textContent(q('chain-fps')));
  step('FPS pill = the output\'s measured fps (> 0)', fpsPill > 0, `chain-fps ${fpsPill}`);
  await snap(page, 'lab-open-collapsed');
  // every block open, then the column scrolled to its END: the first nodes' panels are out of view
  for (const id of CHAIN) await setBlock(page, id, true);
  await sleep(1500);
  const blOpen = await blocks(page);
  const ph = await page.evaluate(() => window.__synLabDebug.layouts());
  step('opening a block shows the node\'s panel (clip = its panel height)', blOpen.filter((b) => CHAIN.includes(b.id)).every((b) => b.open && b.clipH > 100 && Math.abs(b.clipH - ph[b.id].panelHeight) <= 1),
    blOpen.filter((b) => CHAIN.includes(b.id)).map((b) => `${b.id}:${b.clipH}px/panel ${ph[b.id].panelHeight}`).join(' '));
  /* one panel open (the first block), the column scrolled to its end: that panel's iframe is out of view.
     (All panels open on software GL starve the whole renderer — INPUT included — so one is enough to
     prove an out-of-view iframe is not throttled.) */
  for (const id of SORTED.slice(1)) await setBlock(page, id, false);
  await until(page, (n) => [...document.querySelectorAll('.fxl-blk.fx .fxl-blk-clip')].filter((c) => c.getBoundingClientRect().height < 1).length === n, 15000, SORTED.length - 1);
  const sc = await scrollColumn(page, 'end');
  await sleep(800);
  const hopsScrolled = await streamFps(page);
  const away = await page.evaluate((id) => {
    const c = document.querySelector('[data-testid="lab-column"]').getBoundingClientRect();
    const b = document.querySelector(`[data-testid="lab-frame-${id}"]`).parentElement.getBoundingClientRect();
    return { top: Math.round(document.querySelector('[data-testid="lab-column"]').scrollTop), panelBottom: Math.round(b.bottom), columnTop: Math.round(c.top), outOfView: b.bottom <= c.top };
  }, SORTED[0]);
  info(`hop fps (${SORTED[0]}'s panel open, column scrolled to the end ${JSON.stringify(sc)} → ${JSON.stringify(away)}): ${hopsScrolled.map((h) => `${h.id} ${h.fps}`).join(' · ')}`);
  step(`column scrolled: ${SORTED[0]}'s open panel out of view, every hop still delivers frames`, away.outOfView && hopsScrolled.every((h) => h.fps > 0), hopsScrolled.map((h) => `${h.id}=${h.fps}`).join(' '));
  await snap(page, 'lab-scrolled-end');
  await scrollColumn(page, 'top');
  for (const id of CHAIN) await setBlock(page, id, false);
  await sleep(800)
  const adv1 = await outputAdvance(page, 4000);
  step('collapsed again: the OUTPUT video still advances', adv1.frames > 0 && adv1.live, JSON.stringify(adv1));

  // ── 3. pixels: OUTPUT ≠ INPUT, no mirror ────────────────────────────────
  const lin = await lumaOf(page, 'input');
  const lout = await lumaOf(page, 'output');
  const d = lin && lout ? diffOf(lin, lout) : 0;
  step('OUTPUT differs from INPUT', d > 6, `mean |Δluma| ${d.toFixed(1)} /255`);
  const n1 = await lumaOf(page, CHAIN[0]);
  step('INPUT is left-bright (sanity)', !!lin && lin.left > lin.right + 40, lin ? `L ${lin.left.toFixed(0)} R ${lin.right.toFixed(0)}` : 'none');
  step(`not mirrored: ${CHAIN[0]} (node 1) is left-bright too`, !!n1 && n1.left > n1.right + 15, n1 ? `L ${n1.left.toFixed(0)} R ${n1.right.toFixed(0)}` : 'no frame');

  // ── 4. audio: Clip on by itself, meter, button both ways ────────────────
  let mode = await audioMode(page);
  step('Clip audio turned on by itself (video INPUT, no Track/Mic)', mode === 'clip' && (await clipOn(page)), `mode ${mode}`);
  const elemAudible = await page.evaluate(() => { const v = window.__synLabDebug.inputVideo(); return { muted: v.muted, paused: v.paused, volume: v.volume }; });
  step('the INPUT element plays its own sound (unmuted, once)', !elemAudible.muted && !elemAudible.paused, JSON.stringify(elemAudible));
  const liveOn = await meterLive(page, true, 30000);
  let ms = [];
  for (let i = 0; i < 20; i++) { ms.push((await readMeter(page)).l); await sleep(100); }
  step('sidebar meter live and moving on the Lab clip', liveOn && Math.max(...ms) > 0.3, `max ${Math.max(...ms).toFixed(2)}`);
  await domClick(page, q('audio-clip'));
  await sleep(600);
  mode = await audioMode(page);
  const mutedOff = await page.evaluate(() => window.__synLabDebug.inputVideo().muted);
  await sleep(1500); // the meter's release (24 dB/s) and peak hold settle
  ms = [];
  for (let i = 0; i < 8; i++) { ms.push((await readMeter(page)).l); await sleep(150); }
  step('Clip button → off (element muted again, meter reads silence)', mode === 'off' && mutedOff && Math.max(...ms) < 0.05, `mode ${mode} muted ${mutedOff} meter max ${Math.max(...ms).toFixed(2)}`);
  await domClick(page, q('audio-clip'));
  await sleep(600);
  mode = await audioMode(page);
  const liveAgain = await meterLive(page, true, 20000);
  ms = [];
  for (let i = 0; i < 15; i++) { ms.push((await readMeter(page)).l); await sleep(100); }
  step('Clip button → on again (meter moves)', mode === 'clip' && liveAgain && Math.max(...ms) > 0.3, `mode ${mode} max ${Math.max(...ms).toFixed(2)}`);

  // ── 5. transport ────────────────────────────────────────────────────────
  step('transport bar under the stage', !!(await page.$(q('lab-transport'))) && !!(await page.$(q('lab-scrub'))));
  await setPlaying(page, false); // pause
  await sleep(1200);
  const paused = await page.evaluate(() => window.__synLabDebug.inputVideo().paused);
  const pA = await page.evaluate(() => window.__synLabDebug.inputVideo().currentTime);
  const hopsP = await streamFps(page, 3000);
  const pB = await page.evaluate(() => window.__synLabDebug.inputVideo().currentTime);
  /* Chromium can still hand out ONE (repeated) frame of a paused element's
     capture inside the window — 0.3 fps over 3 s; the clock must not move. */
  const inFps = hopsP[0].fps;
  const inputHeld = pA === pB && inFps <= 0.34;
  const o1 = await lumaOf(page, 'output');
  await sleep(700);
  const o2 = await lumaOf(page, 'output');
  const dd = o1 && o2 ? diffOf(o1, o2) : 99;
  info(`paused: hop fps ${hopsP.map((h) => `${h.id} ${h.fps}`).join(' · ')}; consecutive output frames |Δ| ${dd.toFixed(2)}`);
  step('pause: INPUT paused, no new input frames', paused && inputHeld, `paused ${paused} input fps ${inFps} · currentTime ${pA} → ${pB}`);
  step('pause: the output holds (consecutive output frames ~identical)', dd < 3, `|Δluma| ${dd.toFixed(2)} (animated effects may still move a little)`);
  await setPlaying(page, true); // play
  const tA = await page.evaluate(() => window.__synLabDebug.inputVideo().currentTime);
  await sleep(1000);
  const tB = await page.evaluate(() => window.__synLabDebug.inputVideo().currentTime);
  step('play resumes', tB !== tA && !(await page.evaluate(() => window.__synLabDebug.inputVideo().paused)), `${tA.toFixed(2)} → ${tB.toFixed(2)}`);
  await setPlaying(page, false); // pause, then scrub a still video
  await sleep(500);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="lab-scrub"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '3');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const tS = await page.evaluate(() => window.__synLabDebug.inputVideo().currentTime);
  step('scrub moves currentTime (paused video → 3 s)', Math.abs(tS - 3) < 0.15, `currentTime ${tS.toFixed(2)}`);
  await setPlaying(page, true); // play again
  const loop0 = await page.evaluate(() => window.__synLabDebug.inputVideo().loop);
  await domClick(page, q('lab-loop'));
  const loop1 = await page.evaluate(() => window.__synLabDebug.inputVideo().loop);
  await domClick(page, q('lab-loop'));
  const loop2 = await page.evaluate(() => window.__synLabDebug.inputVideo().loop);
  step('loop toggles', loop0 !== loop1 && loop2 === loop0, `${loop0} → ${loop1} → ${loop2}`);
  /* LOOP = PAUSE's normal look (operator): same background + border in both states, on = amber text, off = PAUSE's text */
  const look = (sel) => page.evaluate((s) => { const c = getComputedStyle(document.querySelector(s)); return `${c.color}|${c.borderTopColor}|${c.backgroundImage}`; }, sel);
  /* software GL starves the main thread: wait for React to show the state before reading the look */
  const setLoop = async (want) => {
    if ((await page.evaluate(() => window.__synLabDebug.inputVideo().loop)) !== want) await domClick(page, q('lab-loop'));
    await until(page, (w) => document.querySelector('[data-testid="lab-loop"]').classList.contains('on') === w, 15000, want);
    await sleep(300);
  };
  await page.mouse.move(2, 2); // no hover
  await setPlaying(page, true);
  await until(page, () => !document.querySelector('[data-testid="lab-play"]').classList.contains('lit'), 15000);
  await setLoop(false);
  const loopOff = await look(q('lab-loop'));
  const pausePlaying = await look(q('lab-play'));
  await setPlaying(page, false);
  await until(page, () => document.querySelector('[data-testid="lab-play"]').classList.contains('lit'), 15000);
  await setLoop(true);
  const loopOn = await look(q('lab-loop'));
  const pausePaused = await look(q('lab-play'));
  await setPlaying(page, true);
  const [onColor, onBorder, onBg] = loopOn.split('|');
  const [pColor, pBorder, pBg] = pausePlaying.split('|');
  step('LOOP off = PAUSE\'s normal look; LOOP on = the same look with amber text only', loopOff === pausePlaying && onBorder === pBorder && onBg === pBg && onColor === 'rgb(232, 192, 0)' && onColor !== pColor,
    `off ${loopOff.split('|').slice(0, 2).join(' ')} · on ${onColor} ${onBorder} · pause ${pColor} ${pBorder} · pause while paused ${pausePaused.split('|').slice(0, 2).join(' ')}`);
  // loop off + the end of the clip: Chromium ENDS the element's captured tracks (the chain freezes, the
  // Clip analyser goes off). Play again must bring both back (ChainLab reviveInput).
  await page.evaluate(() => { const v = window.__synLabDebug.inputVideo(); v.loop = false; v.currentTime = Math.max(0, v.duration - 0.4); });
  await until(page, () => window.__synLabDebug.inputVideo().ended, 30000);
  const atEnd = await page.evaluate(() => ({ ended: window.__synLabDebug.inputVideo().ended, mode: window.__synLabDebug.audio.mode }));
  await page.evaluate(() => { window.__synLabDebug.inputVideo().loop = true; });
  await setPlaying(page, true);
  const back = await until(page, () => window.__synLabDebug.audio.mode === 'clip' && window.__synLabDebug.inputStream()?.getVideoTracks().some((t) => t.readyState === 'live'), 20000);
  step('after the clip ENDED (loop off), Play brings the chain and the Clip audio back', back, `at end ${JSON.stringify(atEnd)} → ${JSON.stringify(await page.evaluate(() => ({ mode: window.__synLabDebug.audio.mode, paused: window.__synLabDebug.inputVideo().paused })))}`);
  await snap(page, 'transport');

  // ── 6. presets ──────────────────────────────────────────────────────────
  const pick = await page.evaluate((id) => {
    const p = window.__synLabDebug.api(id).params().find((x) => x.type === 'number' && !x.locked && x.max > x.min && x.step > 0);
    return p ? { key: p.key, value: p.value, min: p.min, max: p.max, step: p.step, label: p.label } : null;
  }, CHAIN[0]);
  if (pick) {
    const labBtns = await page.evaluate(() => [...document.querySelectorAll('[data-testid="lab-block-laboratory"] .fxl-blk-body > button')].map((e) => e.textContent.trim()));
    const labTitles = await page.evaluate(() => [...document.querySelectorAll('[data-testid="lab-block-laboratory"] .fxl-blk-body > button')].map((e) => !!e.title));
    step('LABORATORY: the four icon buttons (SAVE / OPEN / RESET / EXPORT) with their titles', labTitles.length === 4 && labTitles.every(Boolean) && JSON.stringify(labBtns) === JSON.stringify(['SAVE VFX CHAIN TO PROJECTS', 'OPEN VFX CHAIN FROM PROJECTS', 'RESET VFX CHAIN', 'EXPORT VFX CHAIN']), JSON.stringify(labBtns));
    await domClick(page, q('lab-save-chain'));
    await sleep(300);
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="preset-name"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, 'labtest');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(300);
    await domClick(page, q('preset-save'));
    const other = pick.value === pick.max ? pick.min : pick.max;
    await page.evaluate(({ id, key, v }) => window.__synLabDebug.api(id).setParam(key, v), { id: CHAIN[0], key: pick.key, v: other });
    const changed = await page.evaluate(({ id, key }) => window.__synLabDebug.api(id).params().find((x) => x.key === key).value, { id: CHAIN[0], key: pick.key });
    await domClick(page, q('lab-open-chain'));
    await sleep(300);
    await domClick(page, q('preset-load-labtest'));
    await sleep(800);
    const back = await page.evaluate(({ id, key }) => window.__synLabDebug.api(id).params().find((x) => x.key === key).value, { id: CHAIN[0], key: pick.key });
    step(`preset save → change → load restores ${CHAIN[0]}.${pick.key}`, changed === other && Math.abs(back - pick.value) < 1e-6, `${pick.value} → ${changed} → ${back}`);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('syntech.chainPresets') || '[]').find((p) => p.name === 'labtest'));
    step('preset v2 stores chain + every node\'s settings', stored?.v === 2 && JSON.stringify(stored.chain) === JSON.stringify(CHAIN) && CHAIN.every((id) => stored.settings?.[id] != null),
      stored ? `chain ${stored.chain.join('>')} · settings for ${Object.keys(stored.settings || {}).join(',')}` : 'missing');
    // RESET: every effect back to its initial values (this run has no saved effect settings: initial = pick.value)
    const other2 = pick.value === pick.max ? pick.min : pick.max;
    await page.evaluate(({ id, key, v }) => window.__synLabDebug.api(id).setParam(key, v), { id: CHAIN[0], key: pick.key, v: other2 });
    const moved = await page.evaluate(({ id, key }) => window.__synLabDebug.api(id).params().find((x) => x.key === key).value, { id: CHAIN[0], key: pick.key });
    await domClick(page, q('lab-reset'));
    await sleep(800);
    const reset = await page.evaluate(({ id, key }) => window.__synLabDebug.api(id).params().find((x) => x.key === key).value, { id: CHAIN[0], key: pick.key });
    const resetNote = await page.textContent(q('chain-note')).catch(() => '');
    step(`RESET puts ${CHAIN[0]}.${pick.key} back to its initial value`, moved === other2 && Math.abs(reset - pick.value) < 1e-6, `${pick.value} → ${moved} → reset ${reset} · "${resetNote}"`);
  } else step('preset round-trip (no number param on node 1)', false);

  info(`audio.stop() calls so far: ${JSON.stringify(await page.evaluate(() => window.__synLabDebug.audioLog()))}`);
  // ── 7. LabHandle ────────────────────────────────────────────────────────
  const cs = await page.evaluate(() => {
    const s = window.__synLabDebug.lab.chainState();
    const per = {};
    s.params.forEach((p) => { const id = p.key.split('.')[0]; per[id] = (per[id] || 0) + 1; });
    return { order: s.order, per, n: s.params.length, fps: s.fps, sourceKind: s.sourceKind, audioMode: s.audioMode, sample: s.params[0] };
  });
  step('chainState lists params from every node', CHAIN.every((id) => cs.per[id] > 0), `${cs.n} params: ${JSON.stringify(cs.per)} · order ${cs.order.join('>')} · ${cs.sourceKind}/${cs.audioMode} · fps ${cs.fps}`);
  const rt = await page.evaluate((id) => {
    const lab = window.__synLabDebug.lab;
    const p = lab.chainState().params.find((x) => x.key.startsWith(id + '.') && x.type === 'number' && !x.locked && x.max > x.min);
    if (!p) return null;
    const target = p.value === p.max ? p.min : p.max;
    const r = lab.applyPlan({ summary: 't', params: [{ key: p.key, value: target }], routes: [{ key: p.key, source: 'bass', amount: 0.3 }] });
    const mid = lab.chainState().params.find((x) => x.key === p.key).value;
    const u = lab.revertPlan(r.undo);
    const end = lab.chainState().params.find((x) => x.key === p.key).value;
    return { key: p.key, from: p.value, target, mid, end, applied: r.applied, skipped: r.skipped, reverted: u.reverted };
  }, CHAIN[CHAIN.length - 1]);
  step('applyPlan / revertPlan round-trip one value (routes reported as skipped)',
    !!rt && rt.applied === 1 && Math.abs(rt.mid - rt.target) < 1e-6 && rt.reverted === 1 && Math.abs(rt.end - rt.from) < 1e-6 && rt.skipped.length === 1,
    rt ? `${rt.key}: ${rt.from} → ${rt.mid} → ${rt.end} · skipped: ${rt.skipped[0]?.slice(0, 60)}` : 'no param');
  const pair = await page.evaluate(async () => {
    const r = await window.__synLabDebug.lab.grabPair(512);
    return { s: r.source?.data.length || 0, o: r.output?.data.length || 0 };
  });
  step('grabPair returns SOURCE + OUTPUT stills', pair.s > 1000 && pair.o > 1000, `${pair.s} / ${pair.o} b64 chars`);

  // ── 8. EXPORT VFX CHAIN = OFFLINE frame-by-frame render (SynExport.render), MASTER ──────
  // A short (2 s) clip is loaded as the source: software GL renders the chain frame by frame.
  const probe = (file) => {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file], { maxBuffer: 1 << 26 }).toString());
    const v = j.streams.find((x) => x.codec_type === 'video');
    const a = j.streams.find((x) => x.codec_type === 'audio');
    return { v, a, frames: Number(v.nb_read_frames || v.nb_frames), rate: v.r_frame_rate, w: v.width, h: v.height };
  };
  const SHORT = path.join(SCRATCH, 'lab-chain-short.webm');
  execFileSync('ffmpeg', [
    '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=0x101010:s=1280x720:r=30:d=2',
    '-f', 'lavfi', '-i', "aevalsrc='0.45*sin(2*PI*110*t)*lt(mod(t\\,0.5)\\,0.12)+0.12*sin(2*PI*440*t)':s=48000:d=2",
    '-vf', "drawbox=x=0:y=0:w=640:h=720:color=0xf0f0f0@1:t=fill,drawbox=x='700+mod(t*160\\,480)':y=300:w=90:h=90:color=0xe03030@1:t=fill",
    '-c:v', 'libvpx', '-b:v', '1500k', '-c:a', 'libopus', '-b:a', '160k', '-shortest', SHORT,
  ]);
  const inSrc = probe(SHORT);
  info(`export input: ${inSrc.w}×${inSrc.h} · ${inSrc.rate} · ${inSrc.frames} frames · audio ${inSrc.a ? inSrc.a.codec_name : 'none'}`);
  await page.setInputFiles(q('source-file'), SHORT);
  await until(page, () => { const v = window.__synLabDebug.inputVideo(); return v && v.readyState >= 2 && Math.abs(v.duration - 2) < 0.3; }, 60000);
  await sleep(2500);
  await setPlaying(page, true);
  await page.evaluate(() => { window.__synExportNoPicker = true; });
  step('LABORATORY: MASTER / HIGH quality row and PNG / JPEG / PDF row exist', await page.evaluate(() => {
    const t = (sel) => [...document.querySelectorAll(`${sel} .fxl-seg`)].map((e) => e.textContent.trim().toUpperCase());
    return JSON.stringify(t('[data-testid="chain-quality"]')) === '["MASTER","HIGH"]' && JSON.stringify(t('[data-testid="chain-stills"]')) === '["PNG","JPEG","PDF"]'
      && !!document.querySelector('[data-testid="chain-quality"].fxl-seg-row') && !!document.querySelector('[data-testid="chain-stills"].fxl-seg-row');
  }), 'chain-quality + chain-stills');
  await page.evaluate(() => document.querySelector('[data-testid="chain-quality-master"]')?.click());
  const dl = browser ? page.waitForEvent('download', { timeout: 900000 }).catch(() => null) : Promise.resolve(null);
  await domClick(page, q('chain-master'));
  await until(page, () => /^[✓✗]/.test(document.querySelector('[data-testid="chain-export-msg"]')?.textContent || ''), 900000);
  const msg = await page.textContent(q('chain-export-msg')).catch(() => '');
  info(`export: ${msg}`);
  const last = await page.evaluate(() => window.__synExportLast || null);
  const dbgLast = await page.evaluate(() => window.__synLabDebug.lastExport());
  step('EXPORT VFX CHAIN finished with ✓ (no cancel / error)', msg.startsWith('✓'), msg);
  step('offline render: __synExportLast is a success with frames + fps (not the realtime MasterRecorder)', !!last && !last.error && !last.cancelled && last.frames > 0 && (!dbgLast || dbgLast.url === ''),
    last ? `frames ${last.frames} · ${last.width}×${last.height} · ${last.fps} fps · ${last.codec} · debug url '${dbgLast?.url ?? 'n/a'}'` : 'no __synExportLast');
  const d1 = await dl;
  if (browser) {
    step('the browser received a download named <source>_LAB_MASTER.mp4', !!d1 && /_LAB_MASTER\.mp4$/.test(d1.suggestedFilename()), d1 ? d1.suggestedFilename() : 'no download event');
    if (d1) {
      const outFile = path.join(SCRATCH, 'export-master.mp4');
      await d1.saveAs(outFile);
      const o = probe(outFile);
      const [wantW, wantH] = (last && last.width && last.height) ? [last.width, last.height] : [inSrc.w, inSrc.h];
      step('ffprobe: video is h264', o.v.codec_name === 'h264', `${o.v.codec_name} ${o.v.profile || ''}`);
      step('ffprobe: width × height = the input\'s native size (this chain keeps the size)', o.w === inSrc.w && o.h === inSrc.h && wantW === inSrc.w && wantH === inSrc.h,
        `${o.w}×${o.h} · input ${inSrc.w}×${inSrc.h} · SynExport ${wantW}×${wantH}`);
      step('ffprobe: r_frame_rate = the input\'s', o.rate === inSrc.rate, `${o.rate} vs ${inSrc.rate}`);
      step('ffprobe: frame count = the input\'s (nothing dropped)', o.frames === inSrc.frames, `${o.frames} vs ${inSrc.frames}`);
      step('ffprobe: an audio stream, as the input has', !!inSrc.a && !!o.a, o.a ? `${o.a.codec_name} ${o.a.sample_rate} Hz · ${o.a.channels} ch` : 'none');
      info(`ffprobe ${outFile}: ${o.v.codec_name} ${o.w}×${o.h} ${o.rate} ${o.frames} frames · ${fs.statSync(outFile).size} bytes`);
    }
  }
  await snap(page, 'after-export');

  // ── 9. day theme on every Lab iframe ────────────────────────────────────
  await domClick(page, 'button[title="Toggle day / night"]');
  await sleep(1200);
  const day = await page.evaluate((chain) => chain.map((id) => {
    const f = document.querySelector(`[data-testid="lab-frame-${id}"]`);
    let inner = null;
    try { inner = f.contentDocument.documentElement.dataset.synTheme || null; } catch { /* */ }
    return { id, attr: f?.dataset.synTheme, inner };
  }), CHAIN);
  step('day theme: every Lab iframe gets data-syn-theme="day"', day.every((x) => x.attr === 'day'), day.map((x) => `${x.id}:${x.attr}/${x.inner}`).join(' '));
  await setBlock(page, SORTED[0], true);
  await sleep(1000);
  const heads = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="lab-block-head-"]')].map((h) => { const c = getComputedStyle(h); return `${c.backgroundColor}|${c.color}`; }));
  step('day: the block headers are white + violet (2026-11-22)', heads.length > 0 && heads.every((x) => x === 'rgb(255, 255, 255)|rgb(109, 40, 217)'), [...new Set(heads)].join(' · '));
  await snap(page, 'day');
  await setBlock(page, SORTED[0], false);
  await domClick(page, 'button[title="Toggle day / night"]');

  // after the export (the clip played to its END, loop off): the chain and the Clip must come back
  await sleep(2500);
  const after = await page.evaluate(() => ({ mode: window.__synLabDebug.audio.mode, paused: window.__synLabDebug.inputVideo().paused, live: window.__synLabDebug.inputStream()?.getVideoTracks().some((t) => t.readyState === 'live') }));
  const hopsAfter = await streamFps(page);
  step('after the export: INPUT playing again, chain flowing, Clip audio back on', after.mode === 'clip' && !after.paused && after.live && hopsAfter[hopsAfter.length - 1].fps > 0,
    `${JSON.stringify(after)} · output ${hopsAfter[hopsAfter.length - 1].fps} fps`);

  // ── 10. hidden Lab: parked, a held capture still sees the chain, shown again resumes ──
  await domClick(page, q('nav-home'));
  await sleep(1500);
  const hid = await page.evaluate(() => ({ paused: window.__synLabDebug.inputVideo().paused, mode: window.__synLabDebug.audio.mode }));
  step('Lab hidden (Home): INPUT parked (video paused → silent)', hid.paused, JSON.stringify(hid));
  const budgetsHidden = await nodeBudgets(page);
  step('Lab hidden: every node paused (frame budget 0)', CHAIN.every((id) => budgetsHidden[id] === 0), JSON.stringify(budgetsHidden));
  const heldPair = await page.evaluate(async () => {
    const ov = document.querySelector('[data-testid="lab-output-video"]');
    let n = 0, alive = true;
    const cb = () => { if (!alive) return; n++; ov.requestVideoFrameCallback(cb); };
    ov.requestVideoFrameCallback(cb);
    const r = await window.__synLabDebug.lab.grabPair(256);
    alive = false;
    return { s: r.source?.data.length || 0, o: r.output?.data.length || 0, framesDuringGrab: n };
  });
  step('Lab hidden: a Gemini capture holds it live, waits for FRESH output frames, gets SOURCE + OUTPUT', heldPair.s > 500 && heldPair.o > 500 && heldPair.framesDuringGrab >= 1, JSON.stringify(heldPair));
  const measuredHidden = await page.evaluate(() => window.__synLabDebug.lab.measureFps());
  const capState = await page.evaluate(() => window.__synLabDebug.lab.chainState().fpsCap);
  step('Lab hidden: measureFps holds the chain live (> 0), chainState says the cap (30)', measuredHidden > 0 && capState === 30, `measured ${measuredHidden} fps · fpsCap ${capState}`);
  const budgetsAfterHold = await nodeBudgets(page);
  step('Lab hidden: after the capture every node is paused again', CHAIN.every((id) => budgetsAfterHold[id] === 0), JSON.stringify(budgetsAfterHold));
  await domClick(page, q('nav-ailab'));
  await sleep(1500);
  const shown = await page.evaluate(() => ({ paused: window.__synLabDebug.inputVideo().paused, mode: window.__synLabDebug.audio.mode }));
  step('Lab shown again: the INPUT plays again, Clip still on', !shown.paused && shown.mode === 'clip', JSON.stringify(shown));

  // Vite's HMR socket (dev server only) is not the app: ignore its noise
  const appErrors = errors.filter((m) => !/WebSocket closed without opened/.test(m));
  step('no uncaught page errors', appErrors.length === 0, appErrors.slice(0, 3).join(' | '));
  if (app) await app.close(); else await browser.close();
  console.log(`\n${TARGET}: ${pass} passed, ${fail} failed · screenshots in ${SCRATCH}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
