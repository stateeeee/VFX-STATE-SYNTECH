/*
 * UI pass verification (operator direction, 2026-07-25 late):
 *   1. sections back to 100% opaque black;
 *   2. an animated violet→gold "gel" LED slab visible only in the gaps between
 *      them (the sections read as holes cut over it);
 *   3. the logo follows that same ramp while keeping its inflated glossy 3D;
 *   4. nothing added above or below an open effect (its HTML is self-sufficient);
 *   5. a playback level meter in the sidebar — green low, red hot. Since the
 *      2026-07-28 direction it is a STEREO PAIR: two columns side by side,
 *      centred in the rail, filling all the space left down to its foot, with
 *      the "Audio" caption UNDER them instead of above;
 *   6. the wordmarks are bolder (700, the vendored family's max).
 *
 * Needs a clip WITH audio at $AUDIO_CLIP for step 5 (a STEREO one, ideally with
 * the channels at different levels, proves the two columns are independent).
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

  /* the hero wordmark wears the gel: the SAME tile as the slab plus a specular
     dome and a shaded underside inside the glyphs, so it reads as one inflated
     glossy object like the logo. And slab, logo and wordmarks all share the 6s
     cadence, so the whole brand shifts colour together. */
  const heroGel = await page.evaluate(() => {
    const h = document.querySelector('h1.hero-gel-text');
    if (!h) return null;
    const c = getComputedStyle(h);
    const root = document.querySelector('#root > div');
    return {
      usesTile: /data:image/.test(c.backgroundImage),
      layers: c.backgroundSize.split(',').length,
      clip: c.webkitBackgroundClip || c.backgroundClip,
      colour: c.color,
      stroke: c.webkitTextStrokeWidth,
      anim: c.animationName,
      tileVar: getComputedStyle(root).getPropertyValue('--syn-gel-tex').slice(0, 18),
    };
  });
  step('hero wordmark filled with the gel tile', !!heroGel && heroGel.usesTile && heroGel.layers === 4,
    heroGel && `${heroGel.layers} layers, tile=${heroGel.usesTile}`);
  step('hero wordmark still clipped to the glyphs', !!heroGel && /text/.test(heroGel.clip) && /rgba\(0, 0, 0, 0\)|transparent/.test(heroGel.colour),
    heroGel && `${heroGel.clip} / ${heroGel.colour}`);
  step('hero wordmark has the moulded rim', !!heroGel && parseFloat(heroGel.stroke) > 0, heroGel && heroGel.stroke);
  step('the tile reaches CSS as a variable', !!heroGel && heroGel.tileVar.includes('url(data:image'), heroGel && heroGel.tileVar + '…');

  const cadence = await page.evaluate(() => {
    const d = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).animationDuration : null; };
    return {
      slab: d('.syn-gel-sheet'), logo: d('.syn-logo-color'),
      small: d('header span.hero-gradient'), hero: d('h1.hero-gel-text'),
    };
  });
  step('slab, logo and both wordmarks share one 6s cadence',
    ['slab', 'logo', 'small', 'hero'].every((k) => cadence[k] === '6s'), JSON.stringify(cadence));

  /* Guard for a real bug: the ramp layer is 200% wide and slides a full 200%, so
     with `no-repeat` it scrolls clean out of the box and the glyphs — which are
     `color: transparent` — drop to BLACK for part of every cycle. Sample the whole
     6s cycle and require the wordmark's brightness to stay steady. */
  const heroBox = await page.evaluate(() => {
    const h = document.querySelectorAll('h1.hero-gel-text')[1];
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const bright = [];
  for (let k = 0; k < 8; k++) {
    const png = (await page.screenshot({ clip: heroBox })).toString('base64');
    bright.push(await page.evaluate(async (d) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
      const q = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let s = 0, n = 0;
      for (let i = 0; i < q.length; i += 4) { const mx = Math.max(q[i], q[i + 1], q[i + 2]); if (mx > 18) { s += mx; n++; } }
      return n ? +(s / n).toFixed(1) : 0;
    }, png));
    await page.waitForTimeout(700);
  }
  const lo = Math.min(...bright), hi = Math.max(...bright);
  step('hero wordmark never dims out over a full colour cycle', lo > 120 && lo / hi > 0.7,
    `brightness ${lo}…${hi} (ratio ${(lo / hi).toFixed(2)})`);

  // ── 5. the level meter ────────────────────────────────────────────────────
  step('meter present in the sidebar', !!(await page.$('[data-testid="audio-meter"]')));

  /* Geometry, per the 2026-07-28 direction: TWO columns, side by side, centred in
     the rail, running to its foot, caption underneath. */
  const meterGeom = await page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) }; };
    const meter = document.querySelector('[data-testid="audio-meter"]');
    const rail = meter.closest('nav');
    const cap = [...meter.querySelectorAll('span')].find((s) => /^audio$/i.test(s.textContent.trim()));
    return {
      rail: box(rail), padBottom: parseFloat(getComputedStyle(rail).paddingBottom),
      l: box(document.querySelector('[data-testid="audio-meter-track"]')),
      r: box(document.querySelector('[data-testid="audio-meter-track-r"]')),
      cap: cap ? box(cap) : null,
    };
  });
  step('meter is a stereo PAIR — two columns side by side, same height',
    meterGeom.r.x > meterGeom.l.right && Math.abs(meterGeom.l.h - meterGeom.r.h) < 1,
    `L x=${meterGeom.l.x} w=${meterGeom.l.w} | R x=${meterGeom.r.x} w=${meterGeom.r.w} | h=${meterGeom.l.h}`);
  const pairMid = (meterGeom.l.x + meterGeom.r.right) / 2;
  const railMid = meterGeom.rail.x + meterGeom.rail.w / 2;
  step('the pair is centred in the rail', Math.abs(pairMid - railMid) < 2,
    `pair ${pairMid.toFixed(1)} vs rail ${railMid.toFixed(1)}`);
  step('the "Audio" caption is UNDER the columns', !!meterGeom.cap && meterGeom.cap.y > meterGeom.l.bottom,
    `caption y=${meterGeom.cap && meterGeom.cap.y} vs column bottom ${meterGeom.l.bottom}`);
  const foot = meterGeom.rail.bottom - meterGeom.padBottom - (meterGeom.cap ? meterGeom.cap.bottom : 0);
  step('the columns fill the space left, down to the foot of the rail',
    meterGeom.l.h > 200 && foot < 4,
    `h=${meterGeom.l.h}px, ${foot.toFixed(1)}px left under the caption`);

  const idle = await page.evaluate(() => {
    const h = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect().height : -1; };
    const r = document.querySelector('[data-testid="audio-meter-readout"]');
    return { l: h('[data-testid="audio-meter-fill"]'), r: h('[data-testid="audio-meter-fill-r"]'), txt: r ? r.textContent.trim() : '' };
  });
  step('meter idle with no clip loaded', idle.l === 0 && idle.r === 0 && idle.txt === '––',
    `L=${idle.l} R=${idle.r} readout="${idle.txt}"`);

  if (CLIP && fs.existsSync(CLIP)) {
    await page.setInputFiles('[data-testid="source-file"]', CLIP);
    await page.waitForTimeout(2500);
    const samples = [];
    for (let i = 0; i < 12; i++) {
      samples.push(await page.evaluate(() => {
        const h = (s) => { const e = document.querySelector(s); return e ? +e.getBoundingClientRect().height.toFixed(1) : -1; };
        const hot = !!document.querySelector('[data-testid="audio-meter"] .shadow-\\[0_0_10px_rgba\\(239\\,68\\,68\\,0\\.45\\)\\]');
        return { h: h('[data-testid="audio-meter-fill"]'), hr: h('[data-testid="audio-meter-fill-r"]'), hot };
      }));
      await page.waitForTimeout(320);
    }
    const hs = samples.map((s) => s.h), hrs = samples.map((s) => s.hr);
    const maxH = Math.max(...hs), minH = Math.min(...hs), maxR = Math.max(...hrs);
    const track = meterGeom.l.h;
    step('meter reads the clip level (> 0)', maxH > 5, `heights ${minH}…${maxH} of ${track}px`);
    step('the RIGHT column reads it too (both channels are live)', maxR > 5, `right max ${maxR} of ${track}px`);
    step('meter tracks the level as it changes', maxH - minH > 4, `span ${(maxH - minH).toFixed(1)}px`);
    step('meter goes hot on the loud ramp (red state)',
      samples.some((s) => s.hot) || maxH > track * 0.83, `maxH=${maxH} of ${track} hot=${samples.some((s) => s.hot)}`);
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
