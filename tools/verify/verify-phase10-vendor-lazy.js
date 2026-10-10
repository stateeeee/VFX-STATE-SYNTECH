/*
 * Phase 10 — offline proof for the LAZY blob_tracker MediaPipe deps.
 *
 * blob_tracker lazy-loads MediaPipe tasks-vision on demand (behind UI toggles):
 * the ImageSegmenter (smart contour) and the Pose / Hand / Face landmarkers of
 * the Body section (the legacy Pose / FaceMesh libs were removed). Only the
 * ImageSegmenter is checked here; the landmarkers are not.
 * verify-phase10-vendor.js covers the always-loaded deps (THREE + selfie
 * segmentation + fonts); this covers the lazy tasks-vision ImageSegmenter. Each is exercised on its
 * OWN fresh page — in the real app they never coexist in one document, and
 * loading several Emscripten runtimes into one page collides on the global
 * `Module` (that collision is a test artefact, not a vendoring bug).
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-phase10-vendor-lazy.js
 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:3000';
const PAGE = `${BASE}/effects/blob_tracker/index.html`;

let pass = 0, fail = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

async function freshPage(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdn = [];
  page.on('request', (r) => { const u = r.url(); if (/cdn\.jsdelivr|cdnjs\.cloudflare|storage\.googleapis|unpkg/.test(u)) cdn.push(u); });
  await page.goto(PAGE, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(() => typeof window.THREE !== 'undefined', { timeout: 20000 });
  return { ctx, page, cdn };
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });

  // POSE and FACE: blob_tracker now uses tasks-vision (vendor/mediapipe/tasks-vision/pose_landmarker_lite.task, face_landmarker.task); the legacy pose/face_mesh checks were removed.

  // TASKS-VISION — vision_bundle.mjs + wasm + selfie_segmenter.tflite (smart contour)
  {
    const { ctx, page, cdn } = await freshPage(browser);
    const r = await page.evaluate(async () => {
      try {
        const { ImageSegmenter, FilesetResolver } = await import('../vendor/mediapipe/tasks-vision/vision_bundle.mjs');
        const vision = await FilesetResolver.forVisionTasks('../vendor/mediapipe/tasks-vision/wasm');
        const seg = await ImageSegmenter.createFromOptions(vision, {
          baseOptions: { modelAssetPath: '../vendor/mediapipe/tasks-vision/selfie_segmenter.tflite' },
          outputCategoryMask: true, runningMode: 'IMAGE',
        });
        const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
        const x = cv.getContext('2d'); x.fillStyle = '#333'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#eee'; x.fillRect(80, 60, 96, 160);
        const out = seg.segment(cv); const ok = !!(out && out.categoryMask); if (out && out.close) out.close();
        return { ok };
      } catch (e) { return { ok: false, e: String(e && e.message || e) }; }
    });
    step('tasks-vision ImageSegmenter runs offline from vendor', r.ok, r.e || 'categoryMask produced');
    step('tasks-vision: zero CDN requests', cdn.length === 0, cdn.slice(0, 2).join(','));
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
