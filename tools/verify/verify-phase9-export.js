/* Phase 9 check — Master MP4 chain export (WebCodecs + mp4-muxer).
 *  A. UNIT: SyntechExport.exportMasterQuality with a mock 2s video + a synthetic
 *     getFrame → a real encoded MP4 is produced; validate ftyp/moov/mdat boxes,
 *     the stsz sample_count = frame count (2s×30 = 60), and the mvhd duration.
 *  B. INTEGRATION: the real ChainLab "Master MP4" button drives the engine
 *     (blob_tracker→analog chain) over a short clip → a valid MP4 downloads and
 *     the button reports success.
 * NOTE: the sandbox headless Chromium has NO H.264 encoder (like the ≥30fps
 * criterion, a machine capability) → the exporter falls back to VP9/AV1, which
 * proves the whole frame-stepping + mux + download pipeline. On the operator's
 * Chrome the preferred universal H.264 (avc) path is used. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const results = [];
const step = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };

// validate an MP4 ArrayBuffer (as a plain byte array from the page)
function validateMp4(bytes) {
  const u8 = Uint8Array.from(bytes);
  const ascii = (o, n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[o + i]); return s; };
  const idxOf = (str) => { for (let i = 0; i + str.length <= u8.length; i++) { let ok = true; for (let j = 0; j < str.length; j++) if (u8[i + j] !== str.charCodeAt(j)) { ok = false; break; } if (ok) return i; } return -1; };
  const u32 = (o) => (u8[o] * 0x1000000) + (u8[o + 1] << 16) + (u8[o + 2] << 8) + u8[o + 3];
  const out = { size: u8.length, ftyp: ascii(4, 4) === 'ftyp', moov: idxOf('moov') >= 0, mdat: idxOf('mdat') >= 0 };
  const stsz = idxOf('stsz'); out.sampleCount = stsz >= 0 ? u32(stsz + 12) : -1; // type(4)vf(4)sampleSize(4)count(4)
  const mvhd = idxOf('mvhd'); // type at mvhd; body layout v0: vf(4) creation(4) modification(4) timescale(4) duration(4)
  if (mvhd >= 0) {
    const version = u8[mvhd + 4];
    const tsOff = version === 1 ? mvhd + 4 + 4 + 8 + 8 : mvhd + 4 + 4 + 4 + 4; // skip vf + creation + modification
    const ts = u32(tsOff);
    const dur = version === 1 ? u32(tsOff + 4 + 4) : u32(tsOff + 4); // v1 duration is 64-bit → low word
    out.durationS = ts ? +(dur / ts).toFixed(3) : -1;
  } else out.durationS = -1;
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 980 } });
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (r) => r.abort());
  const pageErrors = [];
  const en = await ctx.newPage();
  en.on('pageerror', (e) => { const s = String(e); if (!/SelfieSegmentation|MediaPipe|tasks-vision|THREE is not defined/i.test(s)) pageErrors.push('engine: ' + s.slice(0, 150)); });
  await en.goto('http://localhost:3000', { waitUntil: 'load' });
  await en.evaluate(() => localStorage.clear());
  await en.reload({ waitUntil: 'load' });
  await en.waitForTimeout(1000);
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-blob_tracker"]');
  await en.click('[data-testid="nav-ailab"]');
  await en.waitForSelector('[data-testid="chain-canvas"]', { state: 'attached', timeout: 120000 });

  // load the vendor scripts + capture any blob URL created (the download)
  await en.evaluate(async () => {
    const load = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(el); });
    await load('/effects/vendor/mp4-muxer.min.js');
    await load('/effects/vendor/syntech-export.js');
    window.__caps = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__lastBlob = blob; return orig(blob); };
  });

  const supported = await en.evaluate(() => !!(window.Mp4Muxer && window.SyntechExport && window.SyntechExport.isSupported()));
  step('SyntechExport + Mp4Muxer load and isSupported()', supported === true, `supported=${supported}`);

  // A) UNIT export with a mock 2s video + synthetic getFrame
  const unit = await en.evaluate(async () => {
    const W = 320, H = 180, FPS = 30, DUR = 2.0;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
    let n = 0;
    const getFrame = async () => { g.fillStyle = `hsl(${(n * 12) % 360},70%,45%)`; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect((n * 5) % W, 20, 30, 30); n++; return cv; };
    const video = { duration: DUR, _t: 0, _ls: [], get currentTime() { return this._t; }, set currentTime(v) { this._t = v; const ls = this._ls.slice(); setTimeout(() => ls.forEach((f) => f()), 0); }, addEventListener(ev, f) { if (ev === 'seeked') this._ls.push(f); }, removeEventListener(ev, f) { this._ls = this._ls.filter((x) => x !== f); } };
    const res = await window.SyntechExport.exportMasterQuality({ video, fps: FPS, getFrame, filename: 'unit.mp4', onProgress: () => {} });
    const buf = await window.__lastBlob.arrayBuffer();
    return { res, bytes: Array.from(new Uint8Array(buf)), expectedFrames: Math.round(DUR * FPS) };
  });
  const v = validateMp4(unit.bytes);
  step('UNIT: produces a structurally-valid MP4 (ftyp + moov + mdat)', v.ftyp && v.moov && v.mdat && v.size > 500, JSON.stringify({ size: v.size, ftyp: v.ftyp, moov: v.moov, mdat: v.mdat, codec: unit.res.codec }));
  step('UNIT: frame count in the MP4 matches the source (2s × 30 = 60)', v.sampleCount === unit.expectedFrames, `stsz sampleCount=${v.sampleCount} expected=${unit.expectedFrames}`);
  step('UNIT: MP4 duration ≈ 2.0s', Math.abs(v.durationS - 2.0) < 0.15, `duration=${v.durationS}s`);

  // B) INTEGRATION: real ChainLab export button over a short clip + a 2-effect chain
  await en.evaluate(() => { window.__lastBlob = null; });
  await en.click('[data-testid="nodal-add"]');
  await en.click('[data-testid="nodal-add-analog"]');
  await en.setInputFiles('[data-testid="chain-file"]', path.join(SCRATCH, 'short360.webm'));
  await en.waitForTimeout(2500);
  const exportBtn = '[data-testid="chain-master"]';
  const hasBtn = await en.$(exportBtn);
  if (hasBtn) {
    await en.click(exportBtn);
    // wait for the export to finish (success ✓ or failure ✗)
    let msg = '';
    for (let i = 0; i < 120; i++) {
      await en.waitForTimeout(1000);
      msg = await en.evaluate(() => { const el = document.querySelector('[data-testid="chain-export-msg"]'); return el ? el.textContent : ''; });
      if (/^✓|^✗/.test(msg)) break;
    }
    const ok = msg.startsWith('✓');
    step('INTEGRATION: ChainLab Master MP4 button exports successfully', ok, `msg="${msg}"`);
    if (ok && (await en.evaluate(() => !!window.__lastBlob))) {
      const ib = await en.evaluate(async () => Array.from(new Uint8Array(await window.__lastBlob.arrayBuffer())));
      const iv = validateMp4(ib);
      step('INTEGRATION: downloaded MP4 is structurally valid', iv.ftyp && iv.moov && iv.mdat && iv.sampleCount > 0, JSON.stringify({ size: iv.size, frames: iv.sampleCount, duration: iv.durationS }));
    }
  } else {
    step('INTEGRATION: chain-export button present', false, 'button testid not found');
  }

  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '));

  fs.writeFileSync(path.join(SCRATCH, 'phase9-export-summary.json'), JSON.stringify({ supported, unit: { codec: unit.res.codec, mp4: v }, pageErrors }, null, 2));
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
