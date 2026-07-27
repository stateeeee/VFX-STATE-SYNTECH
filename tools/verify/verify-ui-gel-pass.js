/*
 * UI pass verification (operator direction, 2026-07-25 late; backdrop + logo +
 * wordmark reworked to the operator's reference 2026-07-27):
 *   1. sections back to 100% opaque black;
 *   2. the gel slab behind them is the OPERATOR'S ARTWORK (/assets/bg-texture.jpg),
 *      stretched whole so its crusted border frames the UI, visible only in the
 *      frame and the gaps (the sections read as holes cut out of it);
 *   3. the logo is present top-left in its OWN iridescence, with a sheen on the
 *      brand's 6s cadence;
 *   3b. the hero wordmark sits hard against the left edge of the hero panel;
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

  /* ── 2. the stone: a MONTAGE of the artwork, dividing the sections ─────────
     (operator, 2026-07-27: "queste rocce colorate che delimitano le sezioni è una
     rielaborazione della texture … prendere dei pezzi e montarli"; and: the panels
     must stay rectangles, with the rock ON TOP giving them their irregular look.)
     So: no mask, no erosion of the panels — pieces of bead vein cut from the piece
     and stamped along every section's outline, painted once into a bitmap. */
  step('stone mounted in night mode', !!(await page.$('[data-testid="bg-layer"]')));
  const crust = await page.evaluate(async () => {
    const strips = [...document.querySelectorAll('.syn-gel-crust')];
    if (!strips.length) return null;
    const cs = getComputedStyle(strips[0]);
    const root = document.querySelector('.syn-gel-crust-root');
    /* the strips must cover the divisions ONLY — never the middle of a section.
       An overlay over the hero still has to be blended over its canvas every
       frame, which is what the frame-cost contract is about. */
    const hero = [...document.querySelectorAll('[data-crust]')]
      .map((e) => e.getBoundingClientRect())
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const coverage = strips.reduce((a, s) => {
      const r = s.getBoundingClientRect();
      return a + r.width * r.height;
    }, 0) / (window.innerWidth * window.innerHeight);
    const overCanvas = strips.some((s) => {
      const r = s.getBoundingClientRect();
      return r.left < hero.right - 60 && r.right > hero.left + 60
        && r.top < hero.bottom - 60 && r.bottom > hero.top + 60;
    });
    let decoded = null;
    try {
      const im = new Image(); im.src = '/assets/bg-texture.jpg'; await im.decode();
      decoded = `${im.naturalWidth}x${im.naturalHeight}`;
    } catch { /* decoded stays null */ }
    return {
      // a montage painted at runtime reaches the page as a Blob, never as the
      // source file: seeing bg-texture.jpg here would mean the artwork went back
      // to being shown whole instead of being cut up
      painted: /^url\("blob:/.test(cs.backgroundImage),
      rawPhoto: /bg-texture/.test(cs.backgroundImage),
      strips: strips.length,
      coverage: +(coverage * 100).toFixed(1),
      overCanvas,
      sections: document.querySelectorAll('[data-crust]').length,
      decoded,
      // the panels stay plain rectangles — nothing may mask or deform them
      deformed: [...document.querySelectorAll('[data-crust]')].some((e) => {
        const st = getComputedStyle(e);
        return (st.maskImage && st.maskImage !== 'none') || (st.clipPath && st.clipPath !== 'none');
      }),
      // FRAME-COST CONTRACT — see the note below
      anim: cs.animationName,
      cssFilter: cs.filter,
      blend: cs.mixBlendMode,
      overPanels: root ? parseInt(getComputedStyle(root).zIndex, 10) >= 40 : false,
      clickThrough: cs.pointerEvents === 'none',
    };
  });
  step('artwork actually decodes', !!crust && !!crust.decoded, (crust && crust.decoded) || 'failed to decode');
  step('stone is a montage painted at runtime, not the photo', !!crust && crust.painted && !crust.rawPhoto);
  step('a ridge is laid for every section', !!crust && crust.sections >= 6, crust && `${crust.sections} sections`);
  /* the operator was explicit: "non devono essere i pannelli con forme non
     regolari" — the irregularity is the rock's, never the panel's */
  step('the panels stay plain rectangles (never masked or clipped)', !!crust && !crust.deformed);
  step('stone sits over the panels and stays click-through', !!crust && crust.overPanels && crust.clickThrough,
    crust && `z\u226540=${crust.overPanels} pointer-events=${crust.clickThrough}`);
  step('stone is cut into skeleton strips, not one sheet', !!crust && crust.strips > 1 && crust.coverage < 65,
    crust && `${crust.strips} strips over ${crust.coverage}% of the viewport`);
  step('no stone strip sits over the hero canvas', !!crust && !crust.overCanvas);

  /* FRAME-COST CONTRACT — the stone must never animate and must carry no CSS
     filter or blend mode. The montage is painted once per geometry; anything that
     made this layer repaint per frame would skew AudioEngine's BPM estimate,
     because beat detection reads spectral flux BETWEEN frames (measured: 189 BPM
     with a full-screen blur, 171 with four blend layers, 138 with one, 124 with
     none — target 120). verify-phase3 is the live guard. */
  step('stone never animates (frame-cost contract)', !!crust && crust.anim === 'none', crust && crust.anim);
  step('no CSS filter or blend on the stone (frame-cost contract)',
    !!crust && crust.cssFilter === 'none' && crust.blend === 'normal', crust && `${crust.cssFilter} / ${crust.blend}`);

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
  const frame = await px({ x: 200, y: 2, width: 600, height: 14 });     // outer frame, top edge
  const vDiv = await px({ x: 1178, y: 150, width: 22, height: 400 });   // divider: hero ↔ right sidebar
  const hDiv = await px({ x: 300, y: 622, width: 600, height: 26 });    // divider: hero ↔ node panel
  const panel = await px({ x: 300, y: 880, width: 200, height: 40 });   // inside the node panel
  /* Thresholds are the MONTAGE's, not the photo's. The stretched-photo pass scored
     colour ~75 in the gaps because it landed on smooth magenta membrane; bead crust
     is pale and grey-blue by nature and scores ~28, which is the material the
     reference is actually made of. Bright stays high — the beads are lit. */
  step('stone fills the frame around the UI', frame.bright > 60, `frame bright=${frame.bright} colour=${frame.colour}`);
  step('vertical divider is stone, lit and tinted', vDiv.bright > 70 && vDiv.colour > 14, `bright=${vDiv.bright} colour=${vDiv.colour}`);
  step('horizontal divider is stone too', hDiv.bright > 70 && hDiv.colour > 14, `bright=${hDiv.bright} colour=${hDiv.colour}`);
  step('sections stay solid black inside', panel.bright < 12 && panel.colour < 6, `panel bright=${panel.bright} colour=${panel.colour}`);

  /* The point of the whole pass: the boundary between a section and the material
     must WANDER, not run straight — that is what makes it read as rock eroded
     through rather than a machined gap. Walk the hero's bottom edge column by
     column, find where the black stops, and require real variation. */
  const wander = await (async () => {
    const hero = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-crust]')]
        .map((e) => e.getBoundingClientRect())
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return { x: Math.round(el.x), y: Math.round(el.y), w: Math.round(el.width), h: Math.round(el.height) };
    });
    const band = { x: hero.x + 60, y: hero.y + hero.h - 26, width: 420, height: 60 };
    const png = (await page.screenshot({ clip: band })).toString('base64');
    return page.evaluate(async (d) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      c.getContext('2d').drawImage(im, 0, 0);
      const q = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const ys = [];
      for (let x = 0; x < c.width; x++) {
        for (let y = 0; y < c.height; y++) {
          const i = (y * c.width + x) * 4;
          if (Math.max(q[i], q[i + 1], q[i + 2]) > 45) { ys.push(y); break; }
        }
      }
      if (!ys.length) return { range: 0, sd: 0 };
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
      return {
        range: Math.max(...ys) - Math.min(...ys),
        sd: +Math.sqrt(ys.reduce((a, b) => a + (b - mean) ** 2, 0) / ys.length).toFixed(2),
      };
    }, png);
  })();
  step('the section edge wanders (rock, not a straight gap)', wander.range >= 8 && wander.sd >= 1.5,
    `range ${wander.range}px, sd ${wander.sd}px`);

  // ── 3. the logo: present top-left, in its own iridescence ─────────────────
  /* The mark is multicolour by design. It used to be recoloured by the violet→gold
     ramp (masked layer + `luminosity` blend) to tie it to the procedural slab; with
     the operator's artwork behind the UI it shows its OWN colours instead, and only
     a sheen rides the 6s brand cadence. */
  const logo = await page.evaluate(() => {
    const box = document.querySelector('[data-testid="brand-logo"]');
    const img = document.querySelector('.syn-logo-mark');
    const gloss = document.querySelector('.syn-logo-gloss');
    if (!box || !img || !gloss) return null;
    const i = getComputedStyle(img), g = getComputedStyle(gloss);
    const r = box.getBoundingClientRect();
    const nav = document.querySelector('nav').getBoundingClientRect();
    return {
      src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0,
      recoloured: /grayscale|sepia|hue-rotate|invert/.test(i.filter || '') || i.mixBlendMode !== 'normal',
      rampLayer: !!document.querySelector('.syn-logo-color'),
      glossMask: (g.maskImage || g.webkitMaskImage || '').includes('logo.png'),
      glossAnim: g.animationName,
      // top-left of the sidebar: above every nav item, near the top edge
      atTop: r.top - nav.top < 40 && r.width >= 40,
      box: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.top - nav.top)}px`,
    };
  });
  step('brand logo present top-left of the sidebar', !!logo && logo.loaded && logo.atTop, logo && `${logo.src} ${logo.box}`);
  step('logo shows its own iridescence (never recoloured)', !!logo && !logo.recoloured && !logo.rampLayer,
    logo && `recoloured=${logo.recoloured} rampLayer=${logo.rampLayer}`);
  const logoMoved = await (async () => {
    const p1 = await page.evaluate(() => getComputedStyle(document.querySelector('.syn-logo-gloss')).backgroundPosition);
    await page.waitForTimeout(900);
    const p2 = await page.evaluate(() => getComputedStyle(document.querySelector('.syn-logo-gloss')).backgroundPosition);
    return { p1, p2 };
  })();
  step('logo sheen is actually sweeping', logoMoved.p1 !== logoMoved.p2, `${logoMoved.p1} → ${logoMoved.p2}`);
  step('logo sheen is masked to the mark', !!logo && logo.glossMask && logo.glossAnim === 'syn-logo-flow', logo && logo.glossAnim);
  /* the point of showing the delivered mark untouched: it must read as MULTICOLOUR,
     not as a violet silhouette — sample it and require a real channel spread */
  const logoBox = await page.evaluate(() => {
    const r = document.querySelector('[data-testid="brand-logo"]').getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const logoPx = await px(logoBox);
  step('logo renders in colour, not as a silhouette', logoPx.colour > 12, `channel spread ${logoPx.colour}`);

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
      tileVar: getComputedStyle(root).getPropertyValue('--syn-gel-tex-text').slice(0, 18),
    };
  });
  step('hero wordmark filled with the gel tile', !!heroGel && heroGel.usesTile && heroGel.layers === 4,
    heroGel && `${heroGel.layers} layers, tile=${heroGel.usesTile}`);
  step('hero wordmark still clipped to the glyphs', !!heroGel && /text/.test(heroGel.clip) && /rgba\(0, 0, 0, 0\)|transparent/.test(heroGel.colour),
    heroGel && `${heroGel.clip} / ${heroGel.colour}`);
  step('hero wordmark has the moulded rim', !!heroGel && parseFloat(heroGel.stroke) > 0, heroGel && heroGel.stroke);
  step('the tile reaches CSS as a variable', !!heroGel && heroGel.tileVar.includes('url(data:image'), heroGel && heroGel.tileVar + '…');

  /* The slab is now a photograph and drifts on its own slow clock, so the 6s brand
     cadence is carried by the logo sheen and the two wordmarks. */
  const cadence = await page.evaluate(() => {
    const d = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).animationDuration : null; };
    return {
      logo: d('.syn-logo-gloss'),
      small: d('header span.hero-gradient'), hero: d('h1.hero-gel-text'),
    };
  });
  step('logo sheen and both wordmarks share one 6s cadence',
    ['logo', 'small', 'hero'].every((k) => cadence[k] === '6s'), JSON.stringify(cadence));

  /* 3b. the hero wordmark is the counterweight to the brain graph, which masses
     around and right of centre — so it must sit hard against the hero's left edge,
     not indented into the panel where the left half goes plain black. */
  const wordmark = await page.evaluate(() => {
    const w = document.querySelector('[data-testid="hero-wordmark"]');
    if (!w) return null;
    const r = w.getBoundingClientRect(), h = w.parentElement.getBoundingClientRect();
    return { inset: Math.round(r.left - h.left), top: Math.round(r.top - h.top) };
  });
  step('hero wordmark sits hard against the hero\'s left edge', !!wordmark && wordmark.inset <= 20,
    wordmark && `${wordmark.inset}px from the panel edge`);

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
