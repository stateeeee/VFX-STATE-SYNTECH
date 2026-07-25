/*
 * UI pass verification (operator direction, 2026-07-25 late):
 *   1. sections back to 100% opaque black;
 *   2. an animated violet→gold "gel" LED slab visible only in the gaps between
 *      them (the sections read as holes cut over it);
 *   3. the logo follows that same ramp while keeping its inflated glossy 3D;
 *   4. nothing added above or below an open effect (its HTML is self-sufficient);
 *   5. a single-column playback level meter in the sidebar — green low, red hot;
 *   6. the wordmarks are bolder (700, the vendored family's max).
 *
 * Needs a clip WITH audio at $AUDIO_CLIP (see gen-audio-video.cjs) for step 5.
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-ui-gel-pass.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const CLIP = process.env.AUDIO_CLIP || '';
let pass = 0, fail = 0, skip = 0;
const step = (n, c, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };
const skipped = (n, why) => { skip++; console.log(`SKIP  ${n} — ${why}`); };

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message || e)));
  await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2500);

  // ── 1. sections fully opaque ──────────────────────────────────────────────
  const surf = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const nav = document.querySelector('nav');
    const header = document.querySelector('header');
    return {
      ink950: cs.getPropertyValue('--syn-ink-950').trim(),
      ink900: cs.getPropertyValue('--syn-ink-900').trim(),
      bg: cs.getPropertyValue('--syn-bg').trim(),
      hero: cs.getPropertyValue('--syn-hero-canvas').trim(),
      navBg: nav ? getComputedStyle(nav).backgroundColor : '',
      headBg: header ? getComputedStyle(header).backgroundColor : '',
    };
  });
  step('surface tokens are solid black', surf.ink950 === '#000000' && surf.ink900 === '#000000', `${surf.ink950} / ${surf.ink900}`);
  step('sidebar + top bar paint 100% opaque', surf.navBg === 'rgb(0, 0, 0)' && surf.headBg === 'rgb(0, 0, 0)', `${surf.navBg} | ${surf.headBg}`);
  step('hero canvas back to filling (opaque theme)', surf.hero === 'opaque', surf.hero);
  step('the gaps stay transparent so the slab shows', surf.bg === 'transparent', surf.bg);

  // ── 2. the gel slab: present, animated, and only in the gaps ──────────────
  step('gel slab mounted in night mode', !!(await page.$('[data-testid="bg-layer"]')));
  // the sheet slides by TRANSFORM (GPU, no per-frame repaint — an animated
  // background-position or a full-screen blur here costs frames, and the beat
  // detector reads spectral flux between frames)
  const flow = async () => page.evaluate(() => {
    const b = getComputedStyle(document.querySelector('.syn-gel-sheet'));
    return { tf: b.transform, anim: b.animationName, img: b.backgroundImage };
  });
  const f1 = await flow(); await page.waitForTimeout(1200); const f2 = await flow();
  const hasViolet = /8b5cf6|139, 92, 246/.test(f1.img), hasGold = /ffda4d|255, 218, 77/.test(f1.img);
  step('slab runs the violet→gold ramp', hasViolet && hasGold, `violet=${hasViolet} gold=${hasGold}`);
  step('slab slides (GPU transform advances)', f1.anim === 'syn-gel-flow' && f1.tf !== f2.tf, `${f1.tf} → ${f2.tf}`);

  /* The gel material: one baked tile carrying the swell, the bubbles and the gloss,
     plus the rising bubbles. FRAME-COST CONTRACT — the slab must contain no blend
     modes and no filters: anything blended or filtered over the sliding ramp is
     re-composited every frame, and on a GPU-less machine that skews AudioEngine's
     BPM estimate (measured: 189 with a blur, 171 with four blend layers, 138 with
     one, 124 with none). Both are asserted so it cannot regress silently. */
  const mat = await page.evaluate(() => {
    const relief = document.querySelector('[data-testid="bg-relief"]');
    const bubbles = [...document.querySelectorAll('.syn-bubble')];
    const layers = [...document.querySelectorAll('.syn-bg-layer > *')];
    const r = relief ? getComputedStyle(relief) : null;
    const blended = layers.filter((el) => {
      const m = getComputedStyle(el).mixBlendMode;
      return m && m !== 'normal';
    }).length;
    return {
      reliefImg: r ? r.backgroundImage.slice(0, 22) : '',
      reliefSize: r && r.backgroundSize,
      bubbles: bubbles.length,
      blended,
      anyFilter: layers.some((el) => /blur|drop-shadow/.test(getComputedStyle(el).filter || '')),
    };
  });
  step('gel material baked into one tiling texture', mat.reliefImg.startsWith('url("data:image'),
    `${mat.reliefImg}… tile=${mat.reliefSize}`);
  step('air bubbles rising inside the gel', mat.bubbles >= 20, `${mat.bubbles} bubbles`);
  step('no blend modes in the slab (frame-cost contract)', mat.blended === 0, `${mat.blended} blended layer(s)`);
  step('no filters in the slab (frame-cost contract)', !mat.anyFilter);

  // pixels: a gap must be colourful, a section must be black
  const px = async (clip) => {
    const png = (await page.screenshot({ clip })).toString('base64');
    return page.evaluate(async (d) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
      const q = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let b = 0, s = 0, n = 0;
      for (let i = 0; i < q.length; i += 4) {
        const mx = Math.max(q[i], q[i + 1], q[i + 2]), mn = Math.min(q[i], q[i + 1], q[i + 2]);
        b += mx; s += mx - mn; n++;
      }
      return { bright: +(b / n).toFixed(1), colour: +(s / n).toFixed(1) };
    }, png);
  };
  const gap = await px({ x: 2, y: 300, width: 10, height: 300 });      // outer left gap
  const panel = await px({ x: 300, y: 950, width: 200, height: 30 });  // inside the node panel
  step('slab is bright + colourful in the gaps', gap.bright > 90 && gap.colour > 40, `gap bright=${gap.bright} colour=${gap.colour}`);
  step('sections are solid black over it', panel.bright < 12 && panel.colour < 6, `panel bright=${panel.bright} colour=${panel.colour}`);

  // ── 3. logo on the same ramp, shading preserved ───────────────────────────
  const logo = await page.evaluate(() => {
    const col = document.querySelector('.syn-logo-color');
    const sh = document.querySelector('.syn-logo-shade');
    if (!col || !sh) return null;
    const c = getComputedStyle(col), s = getComputedStyle(sh);
    return {
      ramp: c.backgroundImage.slice(0, 60), anim: c.animationName,
      mask: (c.maskImage || c.webkitMaskImage || '').includes('logo.png'),
      blend: s.mixBlendMode, grey: s.filter.includes('grayscale'),
    };
  });
  step('logo colour layer rides the ramp', !!logo && /8b5cf6|139, 92, 246/.test(logo.ramp) && logo.anim === 'syn-logo-flow', logo && logo.anim);
  const logoMoved = await (async () => {
    const p1 = await page.evaluate(() => getComputedStyle(document.querySelector('.syn-logo-color')).backgroundPosition);
    await page.waitForTimeout(900);
    const p2 = await page.evaluate(() => getComputedStyle(document.querySelector('.syn-logo-color')).backgroundPosition);
    return { p1, p2 };
  })();
  step('logo colour is actually flowing', logoMoved.p1 !== logoMoved.p2, `${logoMoved.p1} → ${logoMoved.p2}`);
  step('logo colour is masked to the mark', !!logo && logo.mask);
  step('logo keeps its 3D shading (luminosity blend)', !!logo && logo.blend === 'luminosity' && logo.grey, logo && `${logo.blend}/${logo.grey}`);

  // ── 6. bolder wordmarks ───────────────────────────────────────────────────
  const w = await page.evaluate(() => {
    const small = document.querySelector('header span.hero-gradient');
    const hero = document.querySelector('h1.hero-gradient');
    return { small: small && getComputedStyle(small).fontWeight, hero: hero && getComputedStyle(hero).fontWeight };
  });
  step('both wordmarks at weight 700', w.small === '700' && w.hero === '700', `small=${w.small} hero=${w.hero}`);

  // ── 5. the level meter ────────────────────────────────────────────────────
  step('meter present in the sidebar', !!(await page.$('[data-testid="audio-meter"]')));
  const idle = await page.evaluate(() => {
    const f = document.querySelector('[data-testid="audio-meter-fill"]');
    const r = document.querySelector('[data-testid="audio-meter-readout"]');
    return { h: f ? f.getBoundingClientRect().height : -1, txt: r ? r.textContent.trim() : '' };
  });
  step('meter idle with no clip loaded', idle.h === 0 && idle.txt === '––', `h=${idle.h} readout="${idle.txt}"`);

  if (CLIP && fs.existsSync(CLIP)) {
    await page.setInputFiles('[data-testid="source-file"]', CLIP);
    await page.waitForTimeout(2500);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      samples.push(await page.evaluate(() => {
        const f = document.querySelector('[data-testid="audio-meter-fill"]');
        const hot = !!document.querySelector('[data-testid="audio-meter"] .shadow-\\[0_0_10px_rgba\\(239\\,68\\,68\\,0\\.45\\)\\]');
        return { h: f ? +f.getBoundingClientRect().height.toFixed(1) : -1, hot };
      }));
      await page.waitForTimeout(320);
    }
    const hs = samples.map((s) => s.h);
    const maxH = Math.max(...hs), minH = Math.min(...hs);
    step('meter reads the clip level (> 0)', maxH > 5, `heights ${minH}…${maxH} of 96px`);
    step('meter tracks the level as it changes', maxH - minH > 4, `span ${(maxH - minH).toFixed(1)}px`);
    step('meter goes hot on the loud ramp (red state)', samples.some((s) => s.hot) || maxH > 80, `maxH=${maxH} hot=${samples.some((s) => s.hot)}`);
    const readout = await page.evaluate(() => document.querySelector('[data-testid="audio-meter-readout"]').textContent.trim());
    step('meter shows a dB readout while playing', /^-?\d+$/.test(readout), `"${readout}"`);
  } else {
    skipped('meter level with a real clip', 'set AUDIO_CLIP to a webm with audio');
  }

  // ── 4. nothing added above/below an open effect ───────────────────────────
  await page.click('[data-testid="nav-home"]').catch(() => {});
  await page.waitForTimeout(400);
  await page.click('[data-testid="effect-card-analog"]');
  await page.waitForTimeout(3000);
  const host = await page.evaluate(() => {
    const fr = document.querySelector('iframe[src*="/effects/analog/"]');
    if (!fr) return null;
    const host = fr.parentElement;
    const hb = host.getBoundingClientRect(), fb = fr.getBoundingClientRect();
    return {
      backTxt: /BACK TO GRAPH/i.test(document.body.innerText),
      // the iframe must fill its host: no strip added above or below
      dTop: Math.round(fb.top - hb.top), dBottom: Math.round(hb.bottom - fb.bottom),
      hostKids: host.children.length,
    };
  });
  step('effect opens (iframe mounted)', !!host);
  step('no "BACK TO GRAPH" chrome added', !!host && !host.backTxt);
  step('iframe fills the panel — no strip above or below', !!host && host.dTop === 0 && host.dBottom === 0, host && `top+${host.dTop} bottom+${host.dBottom}`);
  step('effect host wraps the iframe alone', !!host && host.hostKids === 1, host && `${host.hostKids} child(ren)`);

  // ── day mode: no slab ─────────────────────────────────────────────────────
  await page.click('[data-testid="nav-home"]').catch(() => {});
  await page.waitForTimeout(500);
  await page.click('button[title="Toggle day / night"]').catch(() => {});
  await page.waitForTimeout(800);
  step('day mode shows no gel slab', !(await page.$('[data-testid="bg-layer"]')));

  step('no page errors', errs.filter((m) => !/THREE|SelfieSegmentation/.test(m)).length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n${pass}/${pass + fail} PASS${skip ? ` (${skip} skipped)` : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
