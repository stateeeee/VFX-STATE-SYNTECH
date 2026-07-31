/*
 * PREVIEW ONLY — composites the running app under the cage so the look can be
 * judged before a line of app code is written. Nothing here changes the app.
 *
 * Needs: the dev server on :3000, and tools/frame/build-frame.cjs run at least once.
 * For the brain-graph look, apply tools/frame/graph-preview-patch.py first and
 * `git checkout src/components/VfxCanvas.tsx` after.
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/frame/preview-frame.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'out');
const VW = 1600, VH = Math.round(1600 / 1.679);
const HOLES = JSON.parse(fs.readFileSync(__dirname + '/holes.json', 'utf8'));

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--enable-unsafe-swiftshader', '--no-sandbox', '--force-color-profile=srgb'],
  });
  const work = await (await browser.newContext()).newPage();
  await work.goto('about:blank');
  const keyedPng = 'data:image/png;base64,' + fs.readFileSync(`${DIR}/frame-keyed.png`).toString('base64');

  const shot = async ({ pick, day, viewport }) => {
    const ctx = await browser.newContext({ viewport: viewport || { width: VW, height: VH }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.goto('http://localhost:3000', { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(2500);
    if (day) {
      await page.click('button[title="Toggle day / night"]').catch(() => {});
      await page.waitForTimeout(1200);
    }

    const probe = await page.evaluate(async ({ holes, pick, day }) => {
      const root = document.querySelector('#root > div') || document.body;
      document.querySelectorAll('.syn-bg-layer').forEach((e) => e.remove());
      /* The bed behind the frame must be the SAME colour as the panels. At night
         both are black, so nothing shows; in day mode a pure-white bed against
         cream panels drew a bright halo in every opening the panel doesn't fill.
         Read the surface off a real panel instead of guessing it. */
      /* The bed matches the panels: black at night, warm ivory by day. Nothing then
         outlines the individual sections — the only black line is the artwork's own
         rim, i.e. a contour around the FRAME, which is what the operator asked for.
         (A black bed was tried: it drew an outline around every section instead.) */
      /* The bed is BLACK in both themes. In day mode each panel's opening gets its
         own light backdrop behind the frame, so the panel's surface fills the whole
         organic hole — while the EMPTY openings (the one beside the effects column,
         next to the orange stars) stay black, as at night. The bottom-right corner
         lights up whole: it is the raw-video reference, not an empty opening. */
      const bed = '#000000';
      const surface = day ? 'rgb(251, 250, 247)' : '#000000';
      for (const el of [document.documentElement, document.body, root]) el.style.background = bed;
      root.style.padding = '0';
      document.querySelectorAll('[data-panel-resize-handle-id]').forEach((e) => { e.style.opacity = '0'; e.style.pointerEvents = 'none'; });

      const W = window.innerWidth, H = window.innerHeight;
      const px = (r, inset = 5) => ({ l: r.x * W + inset, t: r.y * H + inset, w: r.w * W - inset * 2, h: r.h * H - inset * 2 });
      const put = (el, r, inset = 5) => {
        if (!el) return;
        const b = px(r, inset);
        Object.assign(el.style, { position: 'fixed', margin: '0', zIndex: '5',
          left: `${b.l}px`, top: `${b.t}px`, width: `${b.w}px`, height: `${b.h}px` });
        const shell = el.matches('header, nav') ? el : el.firstElementChild;
        if (shell) { shell.style.border = '1px solid transparent'; shell.style.boxShadow = 'none'; shell.style.borderRadius = '16px'; }
      };
      window.__backdrops = [];
      if (day) {
        /* The video corner lights up like a panel (the operator's red ring); the
           opening beside the effects column does not — it stays black. */
        for (const b of [...Object.values(holes.boxes), ...(holes.videoBoxes || [])]) {
          window.__backdrops.push(b);
          const el = document.createElement('div');
          Object.assign(el.style, { position: 'fixed', zIndex: '1', background: surface,
            left: `${b.x * W}px`, top: `${b.y * H}px`, width: `${b.w * W}px`, height: `${b.h * H}px` });
          document.body.appendChild(el);
        }
      }

      const panelOf = (el) => el && el.closest('[data-panel]');
      const header = document.querySelector('header');
      put(header, holes.topbar, 4);
      put(document.querySelector('nav'), holes.railTop, 4);
      /* With the meter moved out, the rail's own slot is 597px and the nav still
         wants ~620 — enough for AI LAB and GEMINI PRO to collide. Tighten the
         rhythm rather than shrink the type. */
      {
        const nav = document.querySelector('nav');
        nav.style.paddingTop = '12px'; nav.style.paddingBottom = '12px';
        nav.querySelectorAll('ul').forEach((u) => { u.style.gap = '13px'; });
        const logo = nav.querySelector('.syn-logo');
        if (logo) { logo.style.width = '34px'; logo.style.height = '34px'; logo.style.marginBottom = '10px'; }
        [...nav.querySelectorAll('span')].filter((x) => /gemini pro/i.test(x.textContent)).forEach((x) => { x.style.margin = '12px 0 8px'; });
      }
      put(panelOf(document.querySelector('canvas')), holes.hero);
      put(panelOf(document.querySelector('[data-testid="effect-search"]')), holes.sidebar);
      /* The list will grow past five effects, and a hard clip reads as a black line
         cutting the art. Fade it at BOTH ends instead, so the frame appears to
         swallow the cards. (Scrolled a little here so the effect is visible.) */
      {
        const firstCard = document.querySelector('[data-testid="effect-card-blob_tracker"]');
        const list = firstCard && firstCard.parentElement;
        if (list) {
          const fade = 'linear-gradient(to bottom, transparent 0px, #000 26px, #000 calc(100% - 26px), transparent 100%)';
          list.style.webkitMaskImage = fade; list.style.maskImage = fade;
          list.style.overflowY = 'auto';
          list.scrollTop = 34;
        }
      }
      const groups = [...document.querySelectorAll('[data-panel-group]')];
      const bottomGroup = groups[groups.length - 1];
      const kids = bottomGroup ? [...bottomGroup.querySelectorAll(':scope > [data-panel]')] : [];
      put(kids[0], holes.nodes);
      put(kids[1], holes.gemini);

      // ── 1. wordmark right-aligned, at the right end of the left slot ────────
      const wm = [...header.querySelectorAll('div')].find((d) => /VFX Syntech/.test(d.textContent) && /absolute/.test(d.className));
      if (wm) {
        const headerRight = (holes.topbar.x + holes.topbar.w) * W;
        const slotLRight = (holes.slotL.x + holes.slotL.w) * W;
        Object.assign(wm.style, { left: 'auto', right: `${headerRight - slotLRight + 16}px`, transform: 'none' });
        // NOTE: no alignItems override here — the block keeps `items-center`, so
        // "created by state" sits centred under the title (my flex-end was the bug)
      }

      // ── the top bar's status label ──────────────────────────────────────────
      [...header.querySelectorAll('div')].forEach((d) => {
        if (d.children.length === 1 && /live streaming/i.test(d.textContent)) {
          d.childNodes.forEach((n) => { if (n.nodeType === 3 && n.textContent.trim()) n.textContent = ' system online'; });
        }
      });

      /* The hero carries a black-to-transparent scrim for the wordmark. On a light
         bed that scrim IS the grey rectangle the operator sees, with hard edges at
         the panel bounds. Off in day mode: the hero then reads as one surface with
         everything around it. */
      if (day) {
        document.querySelectorAll('div.absolute.inset-0').forEach((d) => {
          if (/bg-gradient-to-br/.test(d.className)) d.style.display = 'none';
        });
        /* That scrim was also what made the hero's strapline legible — it is pale
           by design. With the scrim gone it has to darken, or it disappears into
           the ivory. */
        document.querySelectorAll('p').forEach((el) => {
          if (/AI-Powered/i.test(el.textContent)) { el.style.color = 'rgb(82, 82, 82)'; el.style.textShadow = 'none'; }
        });
      }

      // ── the Gemini STANDBY badge goes grey, like the node panel's ────────────
      {
        const gemPanel = kids[1];
        const badge = gemPanel && [...gemPanel.querySelectorAll('span')].find((x) => /^standby$/i.test(x.textContent.trim()));
        if (badge) {
          badge.style.background = 'rgba(115, 115, 115, 0.10)';
          badge.style.color = 'rgb(163, 163, 163)';
          badge.style.borderColor = 'rgba(115, 115, 115, 0.40)';
          const dot = badge.querySelector('span');
          if (dot) dot.style.background = 'rgba(163, 163, 163, 0.8)';
        }
      }

      const keyJobs = [];
      if (day && pick === 'white') {
        // variant: pure white panels instead of the app's cream
        document.querySelectorAll('[data-panel] > div, header, nav').forEach((el) => {
          const c = getComputedStyle(el).backgroundColor;
          if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'rgb(0, 0, 0)') el.style.background = '#ffffff';
        });
      }
      if (day) {
        document.querySelectorAll('[data-testid^="effect-card-"]').forEach((card) => {
          card.style.background = surface;
          [...card.querySelectorAll('div')].forEach((d) => {
            if (getComputedStyle(d).backgroundColor === 'rgb(0, 0, 0)') d.style.background = surface;
          });
          const img = card.querySelector('img');
          if (img) keyJobs.push(img);
        });
      }

      /* The covers are the star on a BLACK plate. On a white card that plate reads
         as a black rectangle, so key the black out and let the star stand on white
         — the same keying the logo already gets in the shipped app. */
      for (const img of keyJobs) {
        const im = new Image(); im.src = img.src; await im.decode();
        const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
        const g2 = c.getContext('2d'); g2.drawImage(im, 0, 0);
        const d2 = g2.getImageData(0, 0, c.width, c.height);
        for (let i = 0; i < d2.data.length; i += 4) {
          const mx = Math.max(d2.data[i], d2.data[i + 1], d2.data[i + 2]);
          if (mx <= 26) d2.data[i + 3] = 0;
          else if (mx < 70) d2.data[i + 3] = Math.round(((mx - 26) / 44) * 255);
        }
        g2.putImageData(d2, 0, 0);
        img.src = c.toDataURL('image/png');
      }

      // ── the effect names take the SAME grey as the left rail's labels ───────
      {
        const railLabel = [...document.querySelectorAll('nav span')].find((x) => /^projects$/i.test(x.textContent.trim()));
        const grey = railLabel ? getComputedStyle(railLabel).color : 'rgb(115,115,115)';
        document.querySelectorAll('[data-testid^="effect-card-"] span').forEach((s2) => { s2.style.color = grey; });
        window.__railGrey = grey;
      }

      // ── the bottom-right opening becomes the RAW VIDEO reference ────────────
      {
        const vid = document.createElement('div');
        /* The opening's own bounding box, measured by build-frame — never typed by
           hand. A rect edge that falls INSIDE a hole shows as a straight cut through
           the art (it did: the corner read as a black rectangle sliced off at
           y=0.838); a bounding box cannot, because each of its edges rests on the
           opening's outermost pixel, where the material takes over. */
        const r = holes.videoBoxes[0];
        Object.assign(vid.style, {
          position: 'fixed', left: `${r.x * W}px`, top: `${r.y * H}px`,
          width: `${r.w * W}px`, height: `${r.h * H}px`, zIndex: '2',
          /* Empty = the theme's own surface, so by day this corner reads white like
             a panel (it was painting black over the day backdrop — that plane sits
             ABOVE it, which is why the corner stayed black). */
          background: surface, overflow: 'hidden',
        });
        /* EMPTY until a clip is loaded — it just shows the theme's bed. (The logo
           in the last preview was only a stand-in for "a video is playing here".) */
        document.body.appendChild(vid);
      }

      // ── 4. the meter: caption gone, dB dashes gone, divider gone, and the
      //    whole thing centred in the small bottom-left opening ────────────────
      const meter = document.querySelector('[data-testid="audio-meter"]');
      if (meter) {
        [...meter.querySelectorAll('span')].filter((s) => /^audio$/i.test(s.textContent.trim())).forEach((s) => s.remove());
        const readout = meter.querySelector('[data-testid="audio-meter-readout"]');
        if (readout) readout.remove();

        /* Take the meter OUT of the rail first. Squeezed into the shorter rail its
           flex-1 box collapses to zero height, and the hairline sweep below would
           then delete it as if it were one of the dividers (it did, once). */
        const m = px(holes.meter, 6);
        Object.assign(meter.style, { position: 'fixed', left: `${m.l}px`, top: `${m.t}px`,
          width: `${m.w}px`, height: `${m.h}px`, zIndex: '6' });

        /* Only the hairline BELOW Optimizer goes — the one that used to separate the
           rail from the meter. The divider above GEMINI PRO stays: the operator
           asked for one, and taking both left AI LAB and GEMINI PRO touching. */
        const rail = document.querySelector('nav');
        const opt = [...rail.querySelectorAll('span')].find((x) => /optimizer/i.test(x.textContent));
        const cut = opt ? opt.getBoundingClientRect().bottom : 0;
        [...rail.querySelectorAll('div')].forEach((d) => {
          if (d === meter || d.contains(meter) || meter.contains(d)) return;
          const r = d.getBoundingClientRect();
          if (r.height <= 2 && r.width > 10 && r.top >= cut) d.remove();
        });
      }

      // ── 3. the Gemini card must size to its content, not to h-full ──────────
      const gem = kids[1];
      if (gem) {
        /* The opening is shorter than the panel's natural height, so the card was
           clipping its button. Let it size to content and tighten the paddings and
           the body copy — the panel adapts to the hole, which is the whole point. */
        gem.querySelectorAll('div').forEach((d) => {
          if (/rounded-xl/.test(d.className) && /h-full/.test(d.className)) { d.style.height = 'auto'; d.style.padding = '12px'; d.style.gap = '10px'; }
          if (/overflow-y-auto/.test(d.className)) d.style.padding = '8px';
        });
        gem.querySelectorAll('p').forEach((el) => { el.style.fontSize = '11.5px'; el.style.lineHeight = '1.45'; });
      }


      // ── the picked colour re-skins everything (feasibility check included) ──
      let violetFollows = null;
      if (pick) {
        const probeEl = document.createElement('span');
        probeEl.className = 'text-violet-500';
        document.body.appendChild(probeEl);
        const before = getComputedStyle(probeEl).color;
        const r = document.documentElement.style;
        const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        const [pr, pg, pb] = hexToRgb(pick);
        r.setProperty('--syn-accent', pick);
        r.setProperty('--syn-accent-rgb', `${pr}, ${pg}, ${pb}`);
        for (const k of ['--color-violet-400', '--color-violet-500', '--color-violet-600', '--color-violet-700']) r.setProperty(k, pick);
        const after = getComputedStyle(probeEl).color;
        violetFollows = { before, after, changed: before !== after };
        probeEl.remove();
      }
      const mEl = document.querySelector('[data-testid="audio-meter"]');
      const mr = mEl && mEl.getBoundingClientRect();
      const tracks = [...document.querySelectorAll('[data-testid^="audio-meter-track"]')].map((t) => {
        const r = t.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      const vb = holes.videoBoxes[0];
      const probePt = document.elementFromPoint(Math.round((vb.x + vb.w / 2) * W), Math.round((vb.y + vb.h / 2) * H));
      return { violetFollows, nBackdrops: window.__backdrops.length, atVideo: probePt ? `${probePt.tagName}.${(probePt.className || '').toString().slice(0, 40)}` : 'none', meter: mEl ? `${Math.round(mr.x)},${Math.round(mr.y)} ${Math.round(mr.width)}x${Math.round(mr.height)}` : 'GONE', tracks };
    }, { holes: HOLES, pick, day: !!day });


    console.log('  meter:', probe.meter, '| backdrops:', probe.nBackdrops, '| element at video corner:', probe.atVideo);
    await page.waitForTimeout(2600); // let the canvas re-read the accent token
    const buf = await page.screenshot();
    await ctx.close();
    return buf.toString('base64');
  };

  const compose = async (appB64, out, size) => {
    const png = await work.evaluate(async ({ appB64, keyedPng }) => {
      const app = new Image(); app.src = 'data:image/png;base64,' + appB64; await app.decode();
      const fr = new Image(); fr.src = keyedPng; await fr.decode();
      const c = document.createElement('canvas'); c.width = app.naturalWidth; c.height = app.naturalHeight;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(app, 0, 0);
      g.drawImage(fr, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }, { appB64, keyedPng });
    fs.writeFileSync(`${DIR}/${out}`, Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote', out);
  };

  console.log('round 11 — day: video corner lit, contour softened');
  await compose(await shot({ pick: null, day: true }), 'preview-day.png');
  console.log('round 11 — night');
  await compose(await shot({ pick: null }), 'preview-night.png');

  await browser.close();
})();
