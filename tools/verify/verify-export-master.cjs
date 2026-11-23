/*
 * End-to-end check of the offline "RENDER MP4" export (docs/workflow/10-EXPORT-MASTER.md)
 * of the ANAMORPHIC effect. Serves public/ itself (Range support), drives the real effect page
 * in Chromium, renders each fixture and verifies the file with ffprobe + a per-frame barcode.
 *
 *   NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-export-master.cjs \
 *       [--fixtures=DIR] [--out=DIR] [--only=f24,f30,f2997,f25,letterbox,stop,high] [--timeout=600]
 *
 * Cases: f24, f30, f2997 (master, barcode), f25 (no audio, master, barcode), letterbox (f24, default look),
 *        stop (f30, stop after ~2 s), high (f25_noaudio, quality "high"; needs f25 run in the same
 *        invocation for the bpp comparison, otherwise only checked against 0.5).
 * Fixtures: f24.mp4 f30.mp4 f2997.mov f25_noaudio.mp4 — every frame N carries a 10-bit barcode
 *        (band 0.40H..0.60H, blocks 0.08W wide from x=0.10W, block k white iff bit k of N).
 * Self-test of the decoder + server only (no feature needed):  --selftest
 * Fixtures are generated with ffmpeg on first use (or with --make-fixtures) into --fixtures
 * (default: <os tmpdir>/syn-export-fixtures).
 */
const { execFileSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const FIX = path.resolve(args.fixtures && args.fixtures !== true ? args.fixtures : path.join(os.tmpdir(), 'syn-export-fixtures'));
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'syn-export-verify'));
const PUBLIC = path.resolve(__dirname, '..', '..', 'public');
const TIMEOUT = (parseInt(args.timeout, 10) || 600) * 1000;
const ONLY = args.only && args.only !== true ? String(args.only).split(',') : null;
const EFFECT_PATH = '/effects/anamorphic_lab/index.html';
const BARCODE_BITS = 10;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); return ok; };
const info = (m) => console.log(`      ${m}`);

/* ---------- static server with Range ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function startServer(extraRoots) {
  const srv = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(req.url.split('?')[0]);
      let file;
      const x = extraRoots.find((r) => p.startsWith(r.prefix));
      if (x) file = path.join(x.dir, p.slice(x.prefix.length)); else file = path.join(PUBLIC, p);
      const root = x ? x.dir : PUBLIC;
      if (!path.resolve(file).startsWith(root)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
      const size = fs.statSync(file).size;
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const rg = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
      const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
      if (rg && (rg[1] !== '' || rg[2] !== '')) {
        let s = rg[1] === '' ? Math.max(0, size - parseInt(rg[2], 10)) : parseInt(rg[1], 10);
        let e = rg[1] === '' || rg[2] === '' ? size - 1 : Math.min(parseInt(rg[2], 10), size - 1);
        if (s > e || s >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { ...head, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Content-Length': e - s + 1 });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file, { start: s, end: e }).pipe(res);
      } else {
        res.writeHead(200, { ...head, 'Content-Length': size });
        if (req.method === 'HEAD') return res.end();
        fs.createReadStream(file).pipe(res);
      }
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

/* ---------- ffprobe / barcode ---------- */
function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file],
    { maxBuffer: 1 << 28 }).toString());
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  return { v, a, fmt: j.format, frames: v ? parseInt(v.nb_read_frames, 10) : 0 };
}
function decodeBarcodes(file, W, H) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-an', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { stdio: ['ignore', 'pipe', 'inherit'] });
    const fsz = W * H; const out = []; let buf = Buffer.alloc(0);
    const cy = Math.round(H * 0.5);
    const cx = (k) => Math.round(W * (0.10 + 0.08 * k + 0.04));
    const decode = (f) => {
      const lv = [];
      for (let k = 0; k < BARCODE_BITS; k++) {
        let s = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { s += f[(cy + dy) * W + cx(k) + dx]; n++; }
        lv.push(s / n);
      }
      const lo = Math.min(...lv), hi = Math.max(...lv);
      const thr = hi - lo > 60 ? (lo + hi) / 2 : 128;
      let N = 0; for (let k = 0; k < BARCODE_BITS; k++) if (lv[k] > thr) N |= 1 << k;
      return N;
    };
    ff.stdout.on('data', (c) => {
      buf = buf.length ? Buffer.concat([buf, c]) : c;
      while (buf.length >= fsz) { out.push(decode(buf.subarray(0, fsz))); buf = buf.subarray(fsz); }
    });
    ff.on('error', reject);
    ff.on('close', () => resolve(out));
  });
}
function analyseSeq(seq, expected) {
  let firstBad = -1, dups = 0, gaps = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] !== i && firstBad < 0) firstBad = i;
    if (i > 0) { if (seq[i] === seq[i - 1]) dups++; else if (seq[i] > seq[i - 1] + 1) gaps += seq[i] - seq[i - 1] - 1; }
  }
  const ok = seq.length === expected && firstBad < 0;
  return { ok, firstBad, dups, gaps, n: seq.length };
}
const ratio = (s) => { const [a, b] = String(s).split('/').map(Number); return b ? a / b : a; };

/* ---------- fixtures ---------- */
const FIXTURES = {
  f24:   { file: 'f24.mp4', fps: '24/1', audio: true },
  f30:   { file: 'f30.mp4', fps: '30/1', audio: true },
  f2997: { file: 'f2997.mov', fps: '30000/1001', audio: true },
  f25:   { file: 'f25_noaudio.mp4', fps: '25/1', audio: false },
};
/* ffmpeg recipes (lavfi color + geq barcode, sine audio) — makes any missing fixture */
const GEQ = "geq=lum='if(between(Y,0.4*H,0.6*H-1)*between(X,0.1*W,0.9*W-1), if(mod(floor(N/pow(2,floor((X-0.1*W)/(0.08*W)))),2),235,16), 128)':cb=128:cr=128";
const RECIPES = {
  'f24.mp4':         { s: '1920x1080', r: '24', d: 4, audio: true, extra: ['-movflags', '+faststart'] },
  'f30.mp4':         { s: '1920x1080', r: '30', d: 3, audio: true, extra: ['-movflags', '+faststart'] },
  'f2997.mov':       { s: '1280x720', r: '30000/1001', d: 3, audio: true, extra: ['-f', 'mov'] },   // moov at the end
  'f25_noaudio.mp4': { s: '1280x720', r: '25', d: 2, audio: false, extra: ['-movflags', '+faststart'] },
};
function makeFixtures() {
  fs.mkdirSync(FIX, { recursive: true });
  for (const [file, c] of Object.entries(RECIPES)) {
    const out = path.join(FIX, file);
    if (fs.existsSync(out)) continue;
    console.log(`making fixture ${out}`);
    const a = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=${c.s}:r=${c.r}:d=${c.d},format=yuv420p,${GEQ}`];
    if (c.audio) a.push('-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${c.d}`, '-ac', '2', '-c:a', 'aac', '-b:a', '192k', '-shortest');
    else a.push('-an');
    a.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', ...c.extra, out);
    execFileSync('ffmpeg', a, { stdio: 'inherit' });
  }
}
try { makeFixtures(); } catch (e) { console.log(`(could not make fixtures: ${e.message})`); }
if (args['make-fixtures']) { console.log('fixtures ready in ' + FIX); process.exit(0); }

async function waitFixture(name) {
  const p = path.join(FIX, FIXTURES[name].file);
  const t0 = Date.now();
  while (Date.now() - t0 < 4 * 60 * 1000) {
    if (fs.existsSync(p)) { try { const a = fs.statSync(p).size; await sleep(800); if (a > 0 && a === fs.statSync(p).size) return p; } catch (_) { /* retry */ } }
    await sleep(2000);
  }
  throw new Error(`fixture missing: ${p}`);
}

/* ---------- self test: server + barcode decoder on the fixtures ---------- */
async function selfTest() {
  console.log('== self-test: static server + barcode decoder on the fixtures');
  const { srv, port } = await startServer([{ prefix: '/fx/', dir: FIX }]);
  try {
    for (const name of Object.keys(FIXTURES)) {
      const f = FIXTURES[name]; const p = await waitFixture(name);
      const r = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: '/fx/' + f.file, headers: { Range: 'bytes=0-99' } },
        (m) => { let n = 0; m.on('data', (c) => (n += c.length)); m.on('end', () => res({ s: m.statusCode, n, cr: m.headers['content-range'], t: m.headers['content-type'] })); }).on('error', rej));
      check(r.s === 206 && r.n === 100, `server Range ${f.file}: ${r.s} ${r.cr} ${r.t}`);
      const pr = probe(p);
      const seq = await decodeBarcodes(p, pr.v.width, pr.v.height);
      const an = analyseSeq(seq, pr.frames);
      check(an.ok, `decoder ${f.file}: ${an.n} frames decoded, 0..${pr.frames - 1} ${an.ok ? 'exact' : 'first mismatch at ' + an.firstBad + ' (' + seq[an.firstBad] + ')'}`);
    }
  } finally { srv.close(); }
}

/* ---------- browser cases ---------- */
let browser, base;
async function openEffect(fixName) {
  const { chromium } = require('playwright');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${base}${EFFECT_PATH}`, { waitUntil: 'load' });
  if (!(await page.$('#btn-render'))) throw new Error('#btn-render not found on the ANAMORPHIC page: the RENDER MP4 feature has not landed');
  const p = await waitFixture(fixName);
  await page.setInputFiles('#file-input', p);
  await page.waitForFunction(() => { const v = document.getElementById('vid') || document.querySelector('video'); const c = document.getElementById('cv'); return v && v.videoWidth > 0 && c && c.classList.contains('on'); }, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.__synExportNoPicker = true;
    // the Export section is closed at load (§5.1): open it so #btn-render is clickable
    const h = document.querySelector('#sec-export .sec-head');
    if (h && h.classList.contains('closed') && typeof toggleSection === 'function') toggleSection(h);
  });
  return { page, ctx, errs, src: p };
}
async function setQuality(page, q) {
  const r = await page.evaluate((q) => {
    const el = document.getElementById('sel-render-q'); if (!el) return 'missing';
    if (el.tagName === 'SELECT') { el.value = q; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'select'; }
    const b = el.querySelector(`[data-q="${q}"]`); if (!b) return 'nobutton'; b.click(); return 'buttons';
  }, q);
  if (r === 'missing' || r === 'nobutton') throw new Error(`#sel-render-q: ${r}`);
}
const flat = (page) => page.evaluate(() => { P.letterbox = 0; P.barrel = 0; P.ca = 0; P.breathing = 0; P.grain = 0; P.squeeze = 1; P.desqueeze = 0; });

async function renderToFile(page, outName, { timeout = TIMEOUT } = {}) {
  await page.evaluate(() => { window.__synExportLast = null; });
  const dl = page.waitForEvent('download', { timeout }).catch(() => null);
  await page.click('#btn-render');
  const t0 = Date.now(); let lastLog = 0;
  for (;;) {
    const st = await page.evaluate(() => ({ busy: !!window.__synExportBusy, last: window.__synExportLast || null, msg: (document.getElementById('render-msg') || document.getElementById('export-msg') || {}).textContent || '' }));
    if (!st.busy && st.last) break;
    if (Date.now() - t0 > timeout) throw new Error('render timeout');
    if (Date.now() - lastLog > 15000) { lastLog = Date.now(); info(`rendering… ${Math.round((Date.now() - t0) / 1000)}s ${st.msg.slice(0, 80)}`); }
    await sleep(1000);
  }
  const last = await page.evaluate(() => window.__synExportLast);
  const d = await Promise.race([dl, sleep(20000).then(() => null)]);
  let file = null;
  if (d) { file = path.join(OUT, outName); await d.saveAs(file); }
  return { last, file, seconds: (Date.now() - t0) / 1000 };
}

async function checkOutput(tag, r, srcInfo, opts) {
  const { last, file } = r;
  const okDl = check(!!file && fs.existsSync(file) && fs.statSync(file).size > 0, `${tag}: download saved (${file ? fs.statSync(file).size + ' bytes' : 'NONE'})`);
  check(last && !last.error && !last.stopped, `${tag}: __synExportLast ok ${last ? JSON.stringify(last) : 'null'}`);
  if (!okDl) return null;
  const o = probe(file);
  info(`codec=${o.v.codec_name} ${o.v.width}x${o.v.height} r_frame_rate=${o.v.r_frame_rate} frames=${o.frames} audio=${o.a ? o.a.codec_name : 'none'} (${r.seconds.toFixed(0)}s render)`);
  check(o.v.codec_name === 'h264', `${tag}: video codec h264 (got ${o.v.codec_name})`);
  if (opts.letterbox) {
    check(o.v.width === srcInfo.v.width, `${tag}: width ${o.v.width} == source ${srcInfo.v.width}`);
    const exp = srcInfo.v.width / 2.39;
    check(Math.abs(o.v.height - exp) <= 2 && o.v.height % 2 === 0, `${tag}: height ${o.v.height} ~ ${exp.toFixed(1)} (even, +-2)`);
  } else {
    check(o.v.width === srcInfo.v.width && o.v.height === srcInfo.v.height, `${tag}: size ${o.v.width}x${o.v.height} == source ${srcInfo.v.width}x${srcInfo.v.height}`);
  }
  check(o.v.r_frame_rate === srcInfo.v.r_frame_rate, `${tag}: r_frame_rate ${o.v.r_frame_rate} == ${srcInfo.v.r_frame_rate}`);
  check(o.frames === srcInfo.frames, `${tag}: nb_read_frames ${o.frames} == source ${srcInfo.frames}`);
  const hasA = !!o.a;
  check(hasA === !!srcInfo.a, `${tag}: audio stream ${hasA ? 'present' : 'absent'} (source ${srcInfo.a ? 'has' : 'has no'} audio)`);
  if (hasA) {
    const dv = parseFloat(o.v.duration || o.fmt.duration), da = parseFloat(o.a.duration || o.fmt.duration);
    check(Math.abs(dv - da) <= 0.1, `${tag}: audio duration ${da.toFixed(3)} vs video ${dv.toFixed(3)} (<=0.1 s)`);
  }
  let br = parseFloat(o.v.bit_rate);
  if (!(br > 0)) { const d = parseFloat(o.fmt.duration); br = (fs.statSync(file).size * 8) / d - (o.a ? parseFloat(o.a.bit_rate) || 320000 : 0); }
  const bpp = br / (o.v.width * o.v.height * ratio(o.v.r_frame_rate));
  info(`video bitrate ${(br / 1e6).toFixed(1)} Mbps = ${bpp.toFixed(3)} bits/pixel/frame`);
  if (opts.barcode) {
    const seq = await decodeBarcodes(file, o.v.width, o.v.height);
    const an = analyseSeq(seq, srcInfo.frames);
    check(an.ok, `${tag}: barcode sequence 0..${srcInfo.frames - 1} (${an.n} decoded, dups=${an.dups}, gaps=${an.gaps}${an.firstBad >= 0 ? ', first mismatch at output frame ' + an.firstBad + ' = ' + seq[an.firstBad] : ''})`);
  }
  return { bpp };
}

const results = {};
async function runMasterCase(key, { quality = 'master', barcode = true, flatLook = true, letterbox = false } = {}, tag = key) {
  console.log(`\n== case ${tag} (${FIXTURES[key].file}, quality=${quality}${letterbox ? ', default look/letterbox' : ''})`);
  const { page, ctx, errs, src } = await openEffect(key);
  try {
    if (flatLook) await flat(page);
    await setQuality(page, quality);
    const srcInfo = probe(src);
    const r = await renderToFile(page, `${tag}.mp4`);
    const res = await checkOutput(tag, r, srcInfo, { barcode, letterbox });
    check(errs.length === 0, `${tag}: no page errors${errs.length ? ' ' + errs[0] : ''}`);
    return res;
  } finally { await ctx.close(); }
}

async function runStop() {
  const tag = 'stop'; console.log('\n== case stop (f30.mp4)');
  const { page, ctx } = await openEffect('f30');
  try {
    await page.evaluate(() => { const v = document.querySelector('video'); try { v.loop = true; v.play(); } catch (_) {} });
    let downloads = 0; page.on('download', () => downloads++);
    await page.evaluate(() => { window.__synExportLast = null; });
    await page.click('#btn-render');
    await page.waitForFunction(() => window.__synExportBusy === true, null, { timeout: 30000 }).catch(() => {});
    check(await page.evaluate(() => window.__synExportBusy === true), `${tag}: __synExportBusy true while rendering`);
    await sleep(2000);
    await page.click('#btn-render');
    await page.waitForFunction(() => !window.__synExportBusy && window.__synExportLast, null, { timeout: 120000 });
    const last = await page.evaluate(() => window.__synExportLast);
    check(last && last.stopped === true, `${tag}: __synExportLast.stopped === true (${JSON.stringify(last)})`);
    await sleep(3000);
    check(downloads === 0, `${tag}: no download (${downloads})`);
    check(await page.evaluate(() => !window.__synExportBusy), `${tag}: __synExportBusy false afterwards`);
    const cvw = await page.evaluate(() => document.getElementById('cv').width);
    check(cvw <= 1280 && cvw > 0, `${tag}: cv.width back to live value (${cvw} <= 1280)`);
    await page.evaluate(() => { const v = document.querySelector('video'); try { v.play(); } catch (_) {} });
    const cv = await page.$('#cv');
    const a = await cv.screenshot(); await sleep(700); const b = await cv.screenshot(); await sleep(700); const c = await cv.screenshot();
    const moving = !a.equals(b) || !b.equals(c);
    const ticks = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : res(n); }; requestAnimationFrame(f); }));
    check(moving, `${tag}: live preview resumes (canvas changes between screenshots; rAF ticks/s ${ticks})`);
  } finally { await ctx.close(); }
}

async function main() {
  if (args.selftest) { await selfTest(); return; }
  const want = (k) => !ONLY || ONLY.includes(k);
  const { srv, port } = await startServer([]);
  base = `http://127.0.0.1:${port}`;
  console.log(`serving ${PUBLIC} on ${base}; fixtures ${FIX}; out ${OUT}`);
  const { chromium } = require('playwright');
  browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const run = async (name, fn) => { try { await fn(); } catch (e) { check(false, `${name}: ${e.message}`); } };
    if (want('f24')) await run('f24', async () => { results.master = results.master || await runMasterCase('f24'); });
    if (want('f30')) await run('f30', () => runMasterCase('f30'));
    if (want('f2997')) await run('f2997', () => runMasterCase('f2997'));
    if (want('f25')) await run('f25', async () => { const r = await runMasterCase('f25'); if (r && !results.master) results.master = r; results.f25 = r; });
    if (want('letterbox')) await run('letterbox', () => runMasterCase('f24', { barcode: false, flatLook: false, letterbox: true }, 'letterbox'));
    if (want('stop')) await run('stop', runStop);
    if (want('high')) await run('high', async () => {
      const r = await runMasterCase('f25', { quality: 'high' }, 'high');
      if (r) {
        check(r.bpp > 0, `high: bpp ${r.bpp.toFixed(3)}`);
        const m = results.f25 || results.master;
        if (m) check(r.bpp < m.bpp, `high: bpp ${r.bpp.toFixed(3)} < master bpp ${m.bpp.toFixed(3)}`); else info('no master bpp in this run to compare (run f25 too)');
      }
    });
  } finally { await browser.close(); srv.close(); }
}
main().then(() => {
  console.log(`\n${fails ? 'FAILED' : 'OK'}: ${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}).catch((e) => { console.error('FATAL', e.message); process.exit(1); });
