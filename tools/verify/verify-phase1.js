/* Phase 1 verification — settings save/restore via the SYNTECH bridge.
 * Per effect: open → tweak params (slider to a distinctive value, plus a
 * toggle where curated) → nav Save (expect "Saved" flash) → Home → reopen →
 * assert the values came back. Then open each HTML standalone (top-level)
 * and assert zero page errors and bridge silence. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const CDN = path.join(SCRATCH, 'cdn');

const IDS = ['blob_tracker', 'analog', 'blob_reveal', 'bokeh', 'anamorphic_lab'];
// Slider per effect chosen from what each bridge actually captures.
const TWEAKS = {
  blob_tracker: { slider: 'sThr', toggle: null },
  analog: { slider: 'sl-sortThresh', toggle: 'btn-mirror' },
  blob_reveal: { slider: 'sl-thr', toggle: 'btn-model' },
  bokeh: { slider: 'sl-bokehRadius', toggle: 'tog-anamBreathing' },
  anamorphic_lab: { slider: 's-halation', toggle: 'tog-flare' },
};

const MIME = { '.js': 'application/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css' };
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const routeCdn = async (ctx) => {
  await ctx.route(/^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)\//, async (route) => {
    const url = new URL(route.request().url());
    let local = null;
    if (url.hostname === 'cdnjs.cloudflare.com' && url.pathname.endsWith('three.js/r128/three.min.js')) {
      local = path.join(CDN, 'three/build/three.min.js');
    } else if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/')) {
      const m = url.pathname.slice(5).match(/^(@[^/]+\/[^/@]+|[^/@]+)(?:@[^/]+)?\/(.+)$/);
      if (m) local = path.join(CDN, m[1], m[2]);
    }
    if (local && fs.existsSync(local)) {
      await route.fulfill({ status: 200, body: fs.readFileSync(local), contentType: MIME[path.extname(local)] || 'application/octet-stream', headers: { 'access-control-allow-origin': '*' } });
    } else await route.abort();
  });
};

const getFrame = async (page, id) => {
  await page.waitForSelector(`iframe[src="/effects/${id}/index.html"]`, { timeout: 10000 });
  let frame = null;
  for (let i = 0; i < 20 && !frame; i++) {
    frame = page.frames().find((f) => f.url().includes(`/effects/${id}/`));
    if (!frame) await page.waitForTimeout(250);
  }
  await frame.waitForLoadState('load', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500); // effect boot + bridge apply
  return frame;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  await routeCdn(ctx);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  await page.goto('http://localhost:3000', { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  for (const id of IDS) {
    const { slider, toggle } = TWEAKS[id];
    await page.click(`[data-testid="effect-card-${id}"]`);
    let frame = await getFrame(page, id);

    // tweak: slider → 73% of range (distinctive), toggle → flip
    const target = await frame.evaluate(({ slider, toggle }) => {
      const s = document.getElementById(slider);
      if (!s) return { error: 'no slider ' + slider };
      const min = parseFloat(s.min || 0), max = parseFloat(s.max || 100);
      const stp = parseFloat(s.step || 1) || 1;
      let v = min + (max - min) * 0.73;
      v = Math.round(v / stp) * stp;
      s.value = v;
      s.dispatchEvent(new Event('input', { bubbles: true }));
      s.dispatchEvent(new Event('change', { bubbles: true }));
      let togState = null;
      if (toggle) {
        const t = document.getElementById(toggle);
        if (t) { t.click(); togState = t.classList.contains('on'); }
      }
      return { sliderValue: document.getElementById(slider).value, togState };
    }, { slider, toggle });
    if (target.error) { step(`${id}: tweak`, false, target.error); continue; }

    // Save → flash
    await page.click('[data-testid="nav-save"]');
    let flashed = false;
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="nav-save"]');
        return el && /saved/i.test(el.textContent || '');
      }, { timeout: 3000 });
      flashed = true;
    } catch {}
    step(`${id}: Save flashes "Saved"`, flashed);
    const stored = await page.evaluate((id) => localStorage.getItem('syntech.effectSettings.' + id), id);
    step(`${id}: settings persisted to localStorage`, !!stored, stored ? `${stored.length} bytes` : 'missing key');

    // Home → reopen → check restore
    await page.click('[data-testid="nav-home"]');
    await page.waitForTimeout(600);
    await page.click(`[data-testid="effect-card-${id}"]`);
    frame = await getFrame(page, id);
    const after = await frame.evaluate(({ slider, toggle }) => {
      const s = document.getElementById(slider);
      const t = toggle ? document.getElementById(toggle) : null;
      return { sliderValue: s ? s.value : null, togState: t ? t.classList.contains('on') : null };
    }, { slider, toggle });
    const sliderOk = String(after.sliderValue) === String(target.sliderValue);
    const togOk = toggle ? after.togState === target.togState : true;
    step(`${id}: reopen restores settings`, sliderOk && togOk,
      `${slider}: ${target.sliderValue} → ${after.sliderValue}${toggle ? `; ${toggle}: ${target.togState} → ${after.togState}` : ''}`);

    await page.click('[data-testid="nav-home"]');
    await page.waitForTimeout(400);
  }
  step('shell: no page errors during save/restore', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  // ---- standalone: bridge must stay silent, zero errors ----
  for (const id of IDS) {
    const p2 = await ctx.newPage();
    const errs = [];
    p2.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 160)));
    p2.on('console', (m) => {
      const loc = (m.location().url || '');
      if (m.type() === 'error' && !/fonts\.googleapis|fonts\.gstatic/.test(m.text() + loc)) {
        errs.push('[console] ' + m.text().slice(0, 160));
      }
    });
    const posted = [];
    await p2.exposeFunction('__synSpy', (t) => posted.push(t));
    await p2.addInitScript(() => {
      const orig = window.postMessage.bind(window);
      window.addEventListener('message', (ev) => {
        if (ev.data && typeof ev.data === 'object' && /^syn:/.test(ev.data.type || '')) window.__synSpy(ev.data.type);
      });
    });
    await p2.goto(`http://localhost:3000/effects/${id}/index.html`, { waitUntil: 'load' });
    await p2.waitForTimeout(3000);
    step(`${id}: standalone clean (no errors, bridge silent)`, errs.length === 0 && posted.length === 0,
      [...errs.slice(0, 3), posted.length ? `bridge posted: ${posted.join(',')}` : ''].filter(Boolean).join(' | '));
    await p2.close();
  }

  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
