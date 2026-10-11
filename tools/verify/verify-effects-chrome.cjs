/*
 * Effects chrome audit (2026-10-11): computed styles of the top bar, video frame,
 * right panel, sections, Info grid and state-matched controls of every effect
 * vs BOKEH (the reference look, 03-SPEC-SHELL §5.1). Animations frozen at t=0.
 * Needs the dev server on :3000.
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/verify/verify-effects-chrome.cjs <outdir>
 * Writes <outdir>/audit.md, audit-controls.md, audit.json, shots/.
 * Expected: only text-length geometry / content / button-state rows remain.
 */
// audit-chrome.cjs
// Measures the UI chrome (top bar, video frame, right panel, sections, controls) of the
// five standalone effect apps and diffs every non-bokeh effect against bokeh.
// Usage: cd <SCR> && NODE_PATH=/opt/node22/lib/node_modules node audit-chrome.cjs <outdir>
// Writes <outdir>/audit.json (raw, full values), <outdir>/audit.md (truncated), <outdir>/shots/*.png
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const REPO = '/home/user/VFX-STATE-SYNTECH';

const OUTDIR = path.resolve(process.argv[2] || 'audit-out');
const BASE = 'http://localhost:3000/effects/';
const REF = 'bokeh';
const EFFECTS = ['bokeh', 'analog', 'blob_reveal', 'blob_tracker', 'anamorphic_lab'];
const VIEWPORTS = [{ w: 1440, h: 900 }, { w: 722, h: 396 }];
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SETTLE_MS = 3000;

const PROPS = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'padding', 'margin', 'gap', 'flex-direction', 'align-items', 'justify-content', 'overflow-y',
  'background-color', 'background-image', 'background-size',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'box-shadow',
  'color', '-webkit-text-fill-color', 'font-family', 'font-size', 'font-weight',
  'letter-spacing', 'text-transform', 'opacity', 'filter',
  'animation-name', 'animation-duration', 'z-index', 'content',
];

// [logical name, ordered selector list, resolution mode]
//   first        document.querySelector per selector in order; hidden elements allowed
//   panel        inside the resolved #panel/.panel first, then document; per selector in order
//   visible      first VISIBLE match (offsetParent !== null) in document order; if none,
//                falls back to the first match (fallback:true)
//   visible-strict  first visible match only; none -> not found
const LOGICAL = [
  ['body', ['body'], 'first'],
  ['topbar', ['#topbar'], 'first'],
  ['logo', ['#topbar .logo'], 'first'],
  ['tbsep', ['#topbar .tb-sep'], 'first'],
  ['pillInput', ['#topbar .pill:not(.engine)'], 'first'],
  ['pillEngine', ['#topbar .pill.engine', '#pill-seg', '#topbar .pill:nth-of-type(2)'], 'first'],
  ['pillPre', ['#topbar .pill-pre'], 'first'],
  ['pillDot', ['#topbar .pill .dot'], 'first'],
  ['timecode', ['#timecode', '#tb-time'], 'first'],
  ['fps', ['#fps-display', '#topbar .tb-stat.fps'], 'first'],
  ['fpsVal', ['#fps-val'], 'first'],
  ['main', ['#main', '.main'], 'first'],
  ['canvasArea', ['#canvas-area', '.preview'], 'first'],
  ['canvasWrap', ['#canvas-wrap'], 'first'],
  ['frameOutline', ['#frame-outline'], 'first'],
  ['drop', ['#drop-overlay', '#drop-ov', '#drop-hint'], 'first'],
  ['dropIcon', ['.drop-ico', '.drop-icon', '#drop-hint svg'], 'first'],
  ['dropTitle', ['.drop-title'], 'first'],
  ['dropSub', ['.drop-sub', '#drop-hint small'], 'first'],
  ['dropBtn', ['.drop-source-btn', '.drop-browse'], 'first'],
  ['panel', ['#panel', '.panel'], 'first'],
  ['section', ['.section'], 'panel'],
  ['secHead', ['.sec-head'], 'panel'],
  ['secMark', ['.sec-mark'], 'panel'],
  ['secTitle', ['.sec-title'], 'panel'],
  ['secChevron', ['.sec-chevron', '.sec-chev'], 'panel'],
  ['openBody', ['.sec-body'], 'visible-strict'],
  ['infoGrid', ['.info-grid'], 'visible'],
  ['infoCell', ['.info-cell'], 'visible'],
  ['icLbl', ['.ic-lbl'], 'visible'],
  ['icVal', ['.ic-val'], 'visible'],
  ['bottombar', ['#bottombar'], 'first'],
  // controls: whole document, hidden allowed (computed style is read regardless)
  ['ledBtn', ['.led-btn'], 'first'],
  ['segBtn', ['.seg-btn'], 'first'],
  ['slider', ['input[type=range]'], 'first'],
  ['knob', ['.knob'], 'first'],
  ['rowLbl', ['.lbl'], 'first'],
];

// STATE-MATCHED control comparisons (added section; audit.md is unchanged by it).
// Each selector names its state explicitly (.on / :not(.on)). Resolved document-wide with
// querySelector, hidden elements allowed. Style props only; rect rows are not compared.
// Nothing is clicked and no section is opened: the controls are read as the page loads.
const CONTROLS = [
  ['ledOff', '.led-btn:not(.on)'],
  ['ledOn', '.led-btn.on'],
  ['ledDotOff', '.led-btn:not(.on) .led'],
  ['ledDotOn', '.led-btn.on .led'],
  ['ledTxtOff', '.led-btn:not(.on) .led-txt'],
  ['ledTxtOn', '.led-btn.on .led-txt'],
  ['kbd', '.kbd-badge'],
  ['segOff', '.seg-btn:not(.on)'],
  ['segOn', '.seg-btn.on'],
  ['rowLbl', '.row > .lbl'],
  ['ctrlLbl', '.ctrl-lbl'],
  ['ctrlVal', '.ctrl-val'],
  ['slider', 'input[type=range]'],
  ['knobOuter', '.knob-outer'],
  ['knob', '.knob'],
  ['knobDot', '.knob-dot'],
  ['knobLbl', '.knob-lbl'],
  ['knobVal', '.knob-val'],
  ['vuTrack', '.vu-track'],
  ['vuBar', '.vu-bar'],
  ['presetBtn', '.preset-btn:not(.on)'],
  ['presetOn', '.preset-btn.on'],
  ['recBtn', '.rec-btn'],
  ['fsBtn', '.fs-btn'],
  ['scKey', '.sc-key'],
  ['scDesc', '.sc-desc'],
  ['pdiv', '.pdiv'],
];

// Runs INSIDE the page. Must be self-contained (Playwright serializes the function).
function collect(arg) {
  const LOG = arg.LOGICAL;
  const PROPS_ = arg.PROPS;
  const r2 = (v) => Math.round(v * 2) / 2;
  const rectOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };
  const vis = (el) => el.offsetParent !== null;
  const txt = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const clsOf = (el) => ((typeof el.className === 'string' ? el.className : el.getAttribute('class')) || '').trim();
  const styleOf = (el, ps) => {
    const cs = getComputedStyle(el, ps || null);
    const o = {};
    for (const p of PROPS_) o[p] = cs.getPropertyValue(p);
    return o;
  };
  const pseudoOf = (el, ps) => {
    const c = getComputedStyle(el, ps).getPropertyValue('content');
    if (c === 'none' || c === 'normal' || c === '') return null;
    return styleOf(el, ps);
  };

  const resolved = {};
  const logical = {};
  for (const [name, sels, mode] of LOG) {
    let hit = null;
    if (mode === 'first') {
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (el) { hit = { el, sel, scope: 'document', fallback: false }; break; }
      }
    } else if (mode === 'panel') {
      const pn = resolved.panel ? resolved.panel.el : null;
      for (const sel of sels) {
        const el = (pn && pn.querySelector(sel)) || document.querySelector(sel);
        if (el) { hit = { el, sel, scope: pn && pn.contains(el) ? 'panel' : 'document', fallback: false }; break; }
      }
    } else if (mode === 'visible' || mode === 'visible-strict') {
      for (const sel of sels) {
        const el = Array.from(document.querySelectorAll(sel)).find(vis);
        if (el) { hit = { el, sel, scope: 'document', fallback: false }; break; }
      }
      if (!hit && mode === 'visible') {
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el) { hit = { el, sel, scope: 'document', fallback: true }; break; }
        }
      }
    }
    if (!hit) { logical[name] = { found: false, tried: sels }; continue; }
    resolved[name] = hit;
    logical[name] = {
      found: true,
      sel: hit.sel,
      scope: hit.scope,
      fallback: hit.fallback,
      visible: vis(hit.el),
      rect: rectOf(hit.el),
      styles: {
        el: styleOf(hit.el),
        '::before': pseudoOf(hit.el, '::before'),
        '::after': pseudoOf(hit.el, '::after'),
      },
    };
  }

  const tb = document.querySelector('#topbar');
  const topbarChildren = tb
    ? Array.from(tb.children).map((c) => ({
        tag: c.tagName.toLowerCase(),
        id: c.id || '',
        cls: clsOf(c),
        visible: vis(c),
        text: txt(c.textContent),
      }))
    : null;

  const pnEl = resolved.panel ? resolved.panel.el : null;
  const sectionRoot = pnEl || document;
  const sections = Array.from(sectionRoot.querySelectorAll('.section')).map((s, i) => {
    const head = s.querySelector(':scope > .sec-head') || s.querySelector('.sec-head');
    const titleEl = head ? (head.querySelector('.sec-title') || head) : null;
    const body = s.querySelector(':scope > .sec-body') || s.querySelector('.sec-body');
    return {
      i,
      id: s.id || '',
      cls: clsOf(s),
      title: txt(titleEl ? titleEl.textContent : ''),
      headClass: head ? clsOf(head) : null,
      hasBody: !!body,
      open: body ? vis(body) : null,
    };
  });

  const caEl = resolved.canvasArea ? resolved.canvasArea.el : null;
  let placement = 'unresolved';
  if (pnEl && caEl) {
    placement = pnEl.getBoundingClientRect().x > caEl.getBoundingClientRect().x + 10 ? 'right' : 'below';
  }
  const layout = { placement, panelRect: rectOf(pnEl), canvasAreaRect: rectOf(caEl) };

  const meta = {
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    tbsepCount: document.querySelectorAll('#topbar .tb-sep').length,
    title: document.title,
  };
  return { meta, logical, sections, topbarChildren, layout };
}

// Runs INSIDE the page (self-contained). Reads each control with its state-matched selector.
function collectControls(arg) {
  const DEFS = arg.CONTROLS;
  const PROPS_ = arg.PROPS;
  const clsOf = (el) => ((typeof el.className === 'string' ? el.className : el.getAttribute('class')) || '').trim();
  const styleOf = (el, ps) => {
    const cs = getComputedStyle(el, ps || null);
    const o = {};
    for (const p of PROPS_) o[p] = cs.getPropertyValue(p);
    return o;
  };
  const pseudoOf = (el, ps) => {
    const c = getComputedStyle(el, ps).getPropertyValue('content');
    if (c === 'none' || c === 'normal' || c === '') return null;
    return styleOf(el, ps);
  };
  const out = {};
  for (const [name, sel] of DEFS) {
    let all;
    try {
      all = document.querySelectorAll(sel);
    } catch (e) {
      out[name] = { found: false, sel, count: 0, error: String(e.message).slice(0, 120) };
      continue;
    }
    const el = all[0];
    if (!el) { out[name] = { found: false, sel, count: 0 }; continue; }
    out[name] = {
      found: true,
      sel,
      count: all.length,
      cls: clsOf(el),
      visible: el.offsetParent !== null,
      styles: { el: styleOf(el), '::before': pseudoOf(el, '::before'), '::after': pseudoOf(el, '::after') },
    };
  }
  return out;
}

async function runOne(ctx, id, vk, outdir) {
  const url = BASE + id + '/index.html';
  const notes = [];
  const page = await ctx.newPage();
  page.on('pageerror', (e) => notes.push('pageerror: ' + String(e && e.message ? e.message : e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') notes.push('console.error: ' + m.text().slice(0, 200)); });
  let gotoErr = null;
  try {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 20000 });
    } catch (e) {
      gotoErr = 'goto: ' + String(e.message).split('\n')[0];
    }
    await page.waitForTimeout(SETTLE_MS);
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        try { a.pause(); a.currentTime = 0; } catch (e) { /* ignore */ }
      }
      const st = document.createElement('style');
      st.id = 'audit-freeze';
      st.textContent = '*,*::before,*::after{transition:none!important}';
      document.head.appendChild(st);
    });
    await page.waitForTimeout(100);
    const data = await page.evaluate(collect, { LOGICAL, PROPS });
    let controls = null;
    let controlsError = null;
    try {
      controls = await page.evaluate(collectControls, { CONTROLS, PROPS });
    } catch (e) {
      controlsError = String(e.message).split('\n')[0];
    }
    await page.screenshot({ path: path.join(outdir, 'shots', `${vk}-${id}.png`) });
    return { effect: id, viewport: vk, url, error: gotoErr, notes: notes.slice(0, 30), ...data, controls, controlsError };
  } catch (e) {
    return {
      effect: id, viewport: vk, url,
      error: (gotoErr ? gotoErr + '; ' : '') + 'run: ' + String(e.message).split('\n')[0],
      notes: notes.slice(0, 30), logical: null, sections: [], topbarChildren: null, layout: null, meta: null,
    };
  } finally {
    await page.close().catch(() => {});
  }
}

// Compare one effect run against the bokeh run. Returns an array of diff rows.
function compareRuns(ref, eff) {
  const rows = [];
  if (!ref.logical || !eff.logical) {
    rows.push({
      kind: 'RUN-FAILED', logical: '(run)', target: '', property: 'run',
      bokeh: ref.error || 'ok', effect: eff.error || 'ok', selBokeh: '', selEffect: '',
    });
    return rows;
  }
  const mk = (logical, target, property, bokeh, effect, selBokeh, selEffect) =>
    ({ kind: 'PROP', logical, target, property, bokeh, effect, selBokeh, selEffect });
  const selDesc = (L) => {
    if (!L || !L.found) return '(not found)';
    return L.sel + (L.scope === 'panel' ? ' [in #panel]' : '') + (L.fallback ? ' [fallback: none visible]' : '');
  };
  for (const [name] of LOGICAL) {
    const a = ref.logical[name];
    const b = eff.logical[name];
    const sa = selDesc(a);
    const sb = selDesc(b);
    if (name === 'tbsep' && ref.meta.tbsepCount !== eff.meta.tbsepCount) {
      rows.push(mk('tbsep', '', 'count of #topbar .tb-sep', String(ref.meta.tbsepCount), String(eff.meta.tbsepCount), '#topbar .tb-sep', '#topbar .tb-sep'));
    }
    if (!a.found && !b.found) continue;
    if (a.found !== b.found) {
      rows.push({
        kind: 'MISSING', logical: name, target: '', property: 'MISSING',
        bokeh: a.found ? 'found: ' + sa : 'NOT FOUND (tried: ' + a.tried.join(' | ') + ')',
        effect: b.found ? 'found: ' + sb : 'NOT FOUND (tried: ' + b.tried.join(' | ') + ')',
        selBokeh: sa, selEffect: sb,
      });
      continue;
    }
    for (const k of ['x', 'y', 'w', 'h']) {
      if (a.rect[k] !== b.rect[k]) rows.push(mk(name, 'box', 'rect.' + k, String(a.rect[k]), String(b.rect[k]), sa, sb));
    }
    for (const p of PROPS) {
      if (a.styles.el[p] !== b.styles.el[p]) rows.push(mk(name, 'el', p, a.styles.el[p], b.styles.el[p], sa, sb));
    }
    for (const ps of ['::before', '::after']) {
      const pa = a.styles[ps];
      const pb = b.styles[ps];
      if (!pa && !pb) continue;
      if (!pa || !pb) {
        rows.push(mk(name, ps, '(pseudo presence)',
          pa ? 'present, content=' + pa.content : 'absent',
          pb ? 'present, content=' + pb.content : 'absent', sa, sb));
        continue;
      }
      for (const p of PROPS) {
        if (pa[p] !== pb[p]) rows.push(mk(name, ps, p, pa[p], pb[p], sa, sb));
      }
    }
  }
  return rows;
}

// Tags for controls rows. Untagged PROP rows are the "real" differences.
const GEOM_PROPS = new Set(['width', 'height', 'top', 'right', 'bottom', 'left', 'margin', 'padding', 'gap']);
function tagFor(prop, a, b) {
  if (prop.startsWith('border-') && /^0px none/.test(String(a)) && /^0px none/.test(String(b))) return 'zero-width-border';
  if (GEOM_PROPS.has(prop)) return 'geometry';
  return '';
}

// Control comparison vs bokeh: style props of element, ::before, ::after (rect rows excluded).
function compareControls(ref, eff) {
  const rows = [];
  const mk = (logical, target, property, bokeh, effect, selBokeh, selEffect, tag) =>
    ({ kind: 'PROP', logical, target, property, bokeh, effect, selBokeh, selEffect, tag });
  const desc = (C) => {
    if (!C || !C.found) return '(not found)';
    return C.sel + (C.count > 1 ? ` [${C.count} matches]` : '');
  };
  for (const [name, sel] of CONTROLS) {
    const a = ref.controls[name];
    const b = eff.controls[name];
    const sa = desc(a);
    const sb = desc(b);
    if (!a.found && !b.found) continue;
    if (a.found !== b.found) {
      rows.push({
        kind: 'MISSING', logical: name, target: '', property: 'MISSING', tag: 'MISSING',
        bokeh: a.found ? 'found: ' + sa : 'NOT FOUND (' + sel + ')',
        effect: b.found ? 'found: ' + sb : 'NOT FOUND (' + sel + ')',
        selBokeh: sa, selEffect: sb,
      });
      continue;
    }
    if (name === 'slider' && a.cls !== b.cls) rows.push(mk(name, 'el', '(class name)', a.cls, b.cls, sa, sb, ''));
    for (const p of PROPS) {
      const va = a.styles.el[p];
      const vb = b.styles.el[p];
      if (va !== vb) rows.push(mk(name, 'el', p, va, vb, sa, sb, tagFor(p, va, vb)));
    }
    for (const ps of ['::before', '::after']) {
      const pa = a.styles[ps];
      const pb = b.styles[ps];
      if (!pa && !pb) continue;
      if (!pa || !pb) {
        rows.push(mk(name, ps, '(pseudo presence)',
          pa ? 'present, content=' + pa.content : 'absent',
          pb ? 'present, content=' + pb.content : 'absent', sa, sb, ''));
        continue;
      }
      for (const p of PROPS) {
        const va = pa[p];
        const vb = pb[p];
        if (va !== vb) rows.push(mk(name, ps, p, va, vb, sa, sb, tagFor(p, va, vb)));
      }
    }
  }
  return rows;
}

// Source fingerprints of the five effect files (read-only), to identify the snapshot.
function fingerprints() {
  const out = {};
  for (const id of EFFECTS) {
    const f = path.join(REPO, 'public', 'effects', id, 'index.html');
    try {
      const buf = fs.readFileSync(f);
      out[id] = {
        file: f,
        sha1: crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12),
        bytes: buf.length,
        mtime: fs.statSync(f).mtime.toISOString(),
      };
    } catch (e) {
      out[id] = { file: f, error: String(e.message).split('\n')[0] };
    }
  }
  return out;
}

const trunc = (v) => {
  if (v === undefined || v === null) return '(null)';
  let s = String(v).replace(/\s*\n\s*/g, ' ');
  if (s.length > 160) s = s.slice(0, 160) + '…';
  return s.replace(/\|/g, '\\|');
};

(async () => {
  const t0 = Date.now();
  const fpStart = fingerprints();
  fs.mkdirSync(path.join(OUTDIR, 'shots'), { recursive: true });
  const vkeys = VIEWPORTS.map((v) => `${v.w}x${v.h}`);
  const others = EFFECTS.filter((e) => e !== REF);
  const runs = {};

  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  try {
    for (const vp of VIEWPORTS) {
      const vk = `${vp.w}x${vp.h}`;
      runs[vk] = {};
      const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
      await ctx.route(/^https:\/\/fonts\./, (r) => r.abort());
      for (const id of EFFECTS) {
        const run = await runOne(ctx, id, vk, OUTDIR);
        runs[vk][id] = run;
        console.log(`[${vk}] ${id}: ${run.logical ? 'ok' : 'FAILED'}${run.error ? ' error=' + run.error : ''}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const diffs = {};
  for (const vk of vkeys) {
    diffs[vk] = {};
    for (const id of others) diffs[vk][id] = compareRuns(runs[vk][REF], runs[vk][id]);
  }

  const openTitles = (run) => (run.sections || []).filter((s) => s.open).map((s) => s.title || '#' + (s.i + 1));
  const summary = [];
  for (const vk of vkeys) {
    summary.push({ viewport: vk, effect: REF, role: 'reference', pairs: null, logicalsWithDiffs: null, missing: null,
      openSections: openTitles(runs[vk][REF]), error: runs[vk][REF].error });
    for (const id of others) {
      const run = runs[vk][id];
      const rows = diffs[vk][id];
      const failed = !run.logical;
      summary.push({
        viewport: vk, effect: id, role: 'effect',
        pairs: failed ? null : rows.filter((r) => r.kind === 'PROP').length,
        logicalsWithDiffs: failed ? null : new Set(rows.map((r) => r.logical)).size,
        missing: failed ? null : rows.filter((r) => r.kind === 'MISSING').length,
        openSections: openTitles(run),
        error: run.error,
      });
    }
  }

  // ---------- controls: state-matched, style props only ----------
  const fpEnd = fingerprints();
  const controlsDiffs = {};
  const controlsSummary = [];
  for (const vk of vkeys) {
    controlsDiffs[vk] = {};
    const refRun = runs[vk][REF];
    const resolvedCount = (run) => (run.controls ? Object.values(run.controls).filter((c) => c.found).length : null);
    controlsSummary.push({ viewport: vk, effect: REF, role: 'reference', real: null, tagged: null, missing: null,
      resolved: resolvedCount(refRun), error: refRun.controlsError || (refRun.controls ? null : 'no controls data') });
    for (const id of others) {
      const effRun = runs[vk][id];
      if (!refRun.controls || !effRun.controls) {
        controlsDiffs[vk][id] = null;
        controlsSummary.push({ viewport: vk, effect: id, role: 'effect', real: null, tagged: null, missing: null,
          resolved: resolvedCount(effRun), error: effRun.controlsError || (effRun.controls ? null : 'no controls data') });
        continue;
      }
      const rows = compareControls(refRun, effRun);
      controlsDiffs[vk][id] = rows;
      controlsSummary.push({
        viewport: vk, effect: id, role: 'effect',
        real: rows.filter((r) => r.kind === 'PROP' && !r.tag).length,
        tagged: rows.filter((r) => r.kind === 'PROP' && r.tag).length,
        missing: rows.filter((r) => r.kind === 'MISSING').length,
        resolved: resolvedCount(effRun), error: null,
      });
    }
  }
  const controlsMeta = { defs: CONTROLS, fingerprints: { start: fpStart, end: fpEnd }, summary: controlsSummary, diffs: controlsDiffs };

  const meta = {
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    base: BASE, reference: REF, effects: EFFECTS, viewports: vkeys, settleMs: SETTLE_MS,
    props: PROPS,
    logicalSelectors: LOGICAL.map(([n, s, m]) => ({ name: n, selectors: s, mode: m })),
    controlSelectors: CONTROLS,
  };
  fs.writeFileSync(path.join(OUTDIR, 'audit.json'), JSON.stringify({ meta, summary, runs, diffs, controls: controlsMeta }, null, 1));

  // ---------- audit.md ----------
  const L = [];
  const sumCell = (v) => (v === null || v === undefined ? 'n/a' : String(v));
  L.push('# Chrome audit: effect UI chrome vs bokeh');
  L.push('');
  L.push(`Generated ${meta.generatedAt} (${Math.round(meta.elapsedMs / 1000)} s). Reference: \`${REF}\`. Viewports: ${vkeys.join(', ')}.`);
  L.push('');
  L.push(`Method: open \`${BASE}<id>/index.html\`, wait ${SETTLE_MS} ms, pause every \`document.getAnimations()\` at t=0, inject \`transition:none\`, wait 100 ms, read \`getComputedStyle\` for the element and its \`::before\`/\`::after\` (pseudo skipped when content is none/normal). Logical elements are resolved by ordered selector lists (first match wins). A **pair** is one (logical, target, property) whose computed value differs from bokeh; target is \`el\`, \`::before\`, \`::after\`, or \`box\` (rect x/y/w/h, px, rounded to 0.5); a pseudo present on one side only is a pair with property \`(pseudo presence)\`. **MISSING** = logical element resolved on one side only.`);
  L.push('');
  L.push('## Summary');
  L.push('');
  L.push('| viewport | effect | differing pairs | logicals with diffs | MISSING elements | open sections (count) | which sections are open |');
  L.push('|---|---|---:|---:|---:|---:|---|');
  for (const s of summary) {
    const isRef = s.role === 'reference';
    const openCell = s.error && !isRef ? 'n/a' : String(s.openSections.length);
    L.push(`| ${s.viewport} | ${s.effect}${isRef ? ' (ref)' : ''} | ${isRef ? '–' : sumCell(s.pairs)} | ${isRef ? '–' : sumCell(s.logicalsWithDiffs)} | ${isRef ? '–' : sumCell(s.missing)} | ${openCell} | ${trunc(s.error ? 'RUN ERROR: ' + s.error : (s.openSections.join(' · ') || 'none'))} |`);
  }
  L.push('');

  const renderStructure = (run, heading) => {
    L.push(`### ${heading}: structure`);
    L.push('');
    if (!run.logical) {
      L.push(`Run failed: ${trunc(run.error)}`);
      L.push('');
      return;
    }
    L.push(`- Layout: panel is **${run.layout.placement}** the canvas area (panel rect.x=${sumCell(run.layout.panelRect && run.layout.panelRect.x)}, canvas-area rect.x=${sumCell(run.layout.canvasAreaRect && run.layout.canvasAreaRect.x)}).`);
    L.push(`- Viewport ${run.meta.innerW}x${run.meta.innerH}, document scrollWidth ${run.meta.scrollW}, scrollHeight ${run.meta.scrollH}; \`#topbar .tb-sep\` count ${run.meta.tbsepCount}.`);
    if (run.error) L.push(`- Note: ${trunc(run.error)}`);
    L.push('');
    L.push('Sections (panel DOM order):');
    L.push('');
    L.push('| # | title | state | head class |');
    L.push('|---|---|---|---|');
    for (const s of run.sections) {
      const state = s.open === null ? 'no .sec-body' : s.open ? 'OPEN' : 'closed';
      L.push(`| ${s.i + 1} | ${trunc(s.title || '(no title)')} | ${state} | ${trunc(s.headClass)} |`);
    }
    L.push('');
    L.push('Topbar children (direct children, DOM order):');
    L.push('');
    L.push('| # | tag | id | class | visible | text |');
    L.push('|---|---|---|---|---|---|');
    (run.topbarChildren || []).forEach((c, i) => {
      L.push(`| ${i + 1} | ${c.tag} | ${trunc(c.id)} | ${trunc(c.cls)} | ${c.visible ? 'yes' : 'no'} | ${trunc(c.text)} |`);
    });
    L.push('');
  };

  for (const vk of vkeys) {
    L.push(`## ${vk} · ${REF} (reference)`);
    L.push('');
    renderStructure(runs[vk][REF], `${vk} · ${REF}`);
    for (const id of others) {
      const run = runs[vk][id];
      const rows = diffs[vk][id];
      L.push(`## ${vk} · ${id}`);
      L.push('');
      renderStructure(run, `${vk} · ${id}`);
      if (run.logical) {
        const nPairs = rows.filter((r) => r.kind === 'PROP').length;
        const nMiss = rows.filter((r) => r.kind === 'MISSING').length;
        L.push(`### ${vk} · ${id}: diff vs ${REF} (${nPairs} differing pairs, ${nMiss} MISSING)`);
        L.push('');
        if (!rows.length) {
          L.push('No differences.');
        } else {
          L.push('| logical | selector used | property | bokeh | effect |');
          L.push('|---|---|---|---|---|');
          for (const r of rows) {
            const selCol = r.selBokeh === r.selEffect ? r.selBokeh : `bokeh: ${r.selBokeh} / effect: ${r.selEffect}`;
            const propCol = r.kind === 'MISSING' ? 'MISSING' : (!r.target || r.target === 'el' ? r.property : `${r.target} ${r.property}`);
            L.push(`| ${r.logical} | ${trunc(selCol)} | ${trunc(propCol)} | ${trunc(r.bokeh)} | ${trunc(r.effect)} |`);
          }
        }
        L.push('');
      }
    }
  }

  fs.writeFileSync(path.join(OUTDIR, 'audit.md'), L.join('\n') + '\n');

  // ---------- audit-controls.md ----------
  const CL = [];
  CL.push('# Controls audit: state-matched control styles vs bokeh');
  CL.push('');
  CL.push(`Generated ${meta.generatedAt} (${Math.round(meta.elapsedMs / 1000)} s). Reference: \`${REF}\`. Viewports: ${vkeys.join(', ')}.`);
  if (process.env.AUDIT_NOTE) CL.push(`Note: ${process.env.AUDIT_NOTE}`);
  CL.push('');
  CL.push('Method: same page load as audit.md (3000 ms settle, animations paused at t=0, transitions off). No section is opened and nothing is clicked. Each control is resolved document-wide with `querySelector` (first match, hidden elements allowed). Compared: computed style of the element and its `::before`/`::after` (same PROPS list as audit.md). Rect rows are not compared. Only `input[type=range]` also compares its class name. Tags: `zero-width-border` = border-* that is `0px none` on both sides (colour only, invisible); `geometry` = width/height/top/right/bottom/left/margin/padding/gap (may be text-length driven). **Real diffs = untagged rows.**');
  CL.push('');
  CL.push('## Source fingerprints (snapshot identity)');
  CL.push('');
  CL.push('| effect | sha1 at start | sha1 at end | bytes | mtime | changed during run |');
  CL.push('|---|---|---|---:|---|---|');
  for (const id of EFFECTS) {
    const s = fpStart[id] || {};
    const e = fpEnd[id] || {};
    const changed = s.sha1 && e.sha1 ? (s.sha1 === e.sha1 ? 'no' : 'YES') : 'n/a';
    CL.push(`| ${id} | ${s.sha1 || trunc(s.error)} | ${e.sha1 || trunc(e.error)} | ${s.bytes || '–'} | ${s.mtime || '–'} | ${changed} |`);
  }
  CL.push('');
  CL.push('## Summary');
  CL.push('');
  CL.push('| viewport | effect | real diffs | tagged diffs | MISSING controls | controls resolved | error |');
  CL.push('|---|---|---:|---:|---:|---:|---|');
  for (const s of controlsSummary) {
    const isRef = s.role === 'reference';
    CL.push(`| ${s.viewport} | ${s.effect}${isRef ? ' (ref)' : ''} | ${isRef ? '–' : sumCell(s.real)} | ${isRef ? '–' : sumCell(s.tagged)} | ${isRef ? '–' : sumCell(s.missing)} | ${sumCell(s.resolved)} / ${CONTROLS.length} | ${trunc(s.error || '')} |`);
  }
  CL.push('');
  CL.push('## Resolution (selector used; (n) = match count in the document; — = not found)');
  CL.push('');
  for (const vk of vkeys) {
    const cell = (run, name) => {
      const c = run.controls && run.controls[name];
      if (!c) return 'n/a';
      if (!c.found) return '—';
      return `${trunc(c.sel)} (${c.count})`;
    };
    CL.push(`### ${vk}`);
    CL.push('');
    CL.push(`| control | ${[REF, ...others].join(' | ')} |`);
    CL.push(`|---|${[REF, ...others].map(() => '---').join('|')}|`);
    for (const [name] of CONTROLS) {
      CL.push(`| ${name} | ${[REF, ...others].map((id) => cell(runs[vk][id], name)).join(' | ')} |`);
    }
    CL.push('');
  }
  CL.push('## Diffs vs bokeh (state-matched controls, style props only)');
  CL.push('');
  for (const vk of vkeys) {
    for (const id of others) {
      const rows = controlsDiffs[vk][id];
      CL.push(`### ${vk} · ${id}`);
      CL.push('');
      if (rows === null) {
        CL.push(`Controls data missing: ${trunc(runs[vk][id].controlsError || runs[vk][REF].controlsError || 'no controls data')}`);
        CL.push('');
        continue;
      }
      const real = rows.filter((r) => r.kind === 'PROP' && !r.tag).length;
      const tagged = rows.filter((r) => r.kind === 'PROP' && r.tag).length;
      const miss = rows.filter((r) => r.kind === 'MISSING').length;
      CL.push(`${real} real diffs, ${tagged} tagged (noise), ${miss} MISSING.`);
      CL.push('');
      if (!rows.length) { CL.push('No control differences.'); CL.push(''); continue; }
      CL.push('| control | selector used | property | bokeh | effect | tag |');
      CL.push('|---|---|---|---|---|---|');
      for (const r of rows) {
        const selCol = r.selBokeh === r.selEffect ? r.selBokeh : `bokeh: ${r.selBokeh} / effect: ${r.selEffect}`;
        const propCol = r.kind === 'MISSING' ? 'MISSING' : (!r.target || r.target === 'el' ? r.property : `${r.target} ${r.property}`);
        const tagCol = r.kind === 'MISSING' ? 'MISSING' : (r.tag || 'real');
        CL.push(`| ${r.logical} | ${trunc(selCol)} | ${trunc(propCol)} | ${trunc(r.bokeh)} | ${trunc(r.effect)} | ${tagCol} |`);
      }
      CL.push('');
    }
  }
  fs.writeFileSync(path.join(OUTDIR, 'audit-controls.md'), CL.join('\n') + '\n');

  // stdout summary
  console.log('');
  console.log('SUMMARY');
  console.log('viewport | effect | differing pairs | logicals with diffs | MISSING | open sections');
  for (const s of summary) {
    const isRef = s.role === 'reference';
    console.log(`${s.viewport} | ${s.effect}${isRef ? ' (ref)' : ''} | ${isRef ? '-' : sumCell(s.pairs)} | ${isRef ? '-' : sumCell(s.logicalsWithDiffs)} | ${isRef ? '-' : sumCell(s.missing)} | ${s.openSections.length}: ${s.openSections.join(', ') || 'none'}${s.error ? ' ERROR ' + s.error : ''}`);
  }
  console.log('');
  console.log(`Wrote ${path.join(OUTDIR, 'audit.md')}`);
  console.log(`Wrote ${path.join(OUTDIR, 'audit.json')}`);
  console.log(`Shots in ${path.join(OUTDIR, 'shots')}`);
  console.log('');
  console.log('CONTROLS (state-matched, style props; real = untagged)');
  console.log('viewport | effect | real diffs | tagged | MISSING | resolved');
  for (const s of controlsSummary) {
    const isRef = s.role === 'reference';
    console.log(`${s.viewport} | ${s.effect}${isRef ? ' (ref)' : ''} | ${isRef ? '-' : sumCell(s.real)} | ${isRef ? '-' : sumCell(s.tagged)} | ${isRef ? '-' : sumCell(s.missing)} | ${sumCell(s.resolved)}/${CONTROLS.length}${s.error ? ' ERROR ' + s.error : ''}`);
  }
  console.log(`Wrote ${path.join(OUTDIR, 'audit-controls.md')}`);
})().catch((e) => {
  console.error('audit-chrome failed:', e);
  process.exit(1);
});
