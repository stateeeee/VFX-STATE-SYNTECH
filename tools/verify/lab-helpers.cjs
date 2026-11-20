/* Shared Playwright helpers for the Lab (ChainLab).
 *
 * LAB v3 (2026-11-19): the Lab is an opened effect with several effects
 * chained. Its right column (`lab-column`) holds blocks, each with a header
 * button `lab-block-head-<id>` (aria-expanded; node heads also carry
 * data-link = loading / ready / missing):
 *   SOURCE (`lab-block-source`, open at load) — IMAGE / VIDEO / WEBCAM, CLIP / MIC / TRACK
 *   one block per wired effect, A→Z by name (`lab-block-<ModuleId>`, CLOSED at load) —
 *     the effect's real panel: its iframe `lab-frame-<ModuleId>` in panel-only layout
 *   LABORATORY (`lab-block-laboratory`, open at load) — four buttons, no captions:
 *     lab-save-chain (→ preset-name / preset-save), lab-open-chain (→ preset-load-<name> /
 *     preset-del-<name>), lab-reset, chain-master (+ chain-export-msg)
 * There are no tabs any more. The helpers below for the old SynEngine panel
 * (fx-head-*, param-*) are kept for the phase 3–8 scripts that still import them.
 *
 * Every setter here FAILS LOUDLY (throws) when the control is missing, so a
 * UI change can no longer turn a check into a silent no-op / vacuous pass.
 *
 * Usage:  const L = require('./lab-helpers.cjs');
 *         await L.openLabBlock(page, 'analog');
 *         await L.savePreset(page, 'my chain');
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Click every collapsed effect head (or only `id`'s), then every collapsed
 * sub-section head (same filter). Repeats until nothing is collapsed (a
 * freshly opened head renders its section heads on the next React commit). */
async function openLabSections(page, id) {
  const headSel = id ? `[data-testid="fx-head-${id}"]` : '[data-testid^="fx-head-"]';
  const secSel = id ? `[data-testid^="fx-sec-${id}-"]` : '[data-testid^="fx-sec-"]';
  let opened = 0;
  // the panel lists the wired effects once the engine has racked them
  await page.waitForSelector(headSel, { state: 'attached', timeout: 15000 }).catch(() => {});
  for (let pass = 0; pass < 6; pass++) {
    const n = await page.evaluate(({ headSel, secSel }) => {
      let c = 0;
      document.querySelectorAll(`${headSel}[aria-expanded="false"]`).forEach((el) => { el.click(); c++; });
      return c;
    }, { headSel, secSel });
    await sleep(n ? 250 : 80);
    const m = await page.evaluate(({ headSel, secSel }) => {
      let c = 0;
      document.querySelectorAll(`${secSel}[aria-expanded="false"]`).forEach((el) => { el.click(); c++; });
      return c;
    }, { headSel, secSel });
    await sleep(m ? 250 : 80);
    opened += n + m;
    if (!n && !m) break;
  }
  return opened;
}

/* LAB v3: open / close a block of the right column ('source', 'laboratory' or a ModuleId).
 * In-page clicks (a renderer busy with software-GL effects can stall Playwright's pointer clicks).
 * Throws when the block does not exist. Returns the header's aria-expanded after the click. */
async function setLabBlock(page, id, open = true) {
  return page.evaluate(({ id, open }) => {
    const head = document.querySelector(`[data-testid="lab-block-head-${id}"]`);
    if (!head) throw new Error(`Lab block missing: lab-block-head-${id}`);
    if ((head.getAttribute('aria-expanded') === 'true') !== open) head.click();
    return open;
  }, { id, open });
}
const openLabBlock = (page, id) => setLabBlock(page, id, true);
const closeLabBlock = (page, id) => setLabBlock(page, id, false);

/* The chain presets live in the LABORATORY block (open at load), behind two of its four buttons:
 * SAVE VFX CHAIN TO PROJECTS (`lab-save-chain` → preset-name + preset-save) and OPEN VFX CHAIN
 * FROM PROJECTS (`lab-open-chain` → preset-load-<name> / preset-del-<name>). `pane` = 'save' | 'open'.
 * The old popover names are kept so older callers keep working. */
async function openPresetPopover(page, pane = 'save') {
  await openLabBlock(page, 'laboratory');
  await page.evaluate((pane) => {
    const b = document.querySelector(`[data-testid="lab-${pane}-chain"]`);
    if (!b) throw new Error(`missing lab-${pane}-chain`);
    if (b.getAttribute('aria-expanded') !== 'true') b.click();
  }, pane);
  await sleep(250);
}
async function closePresetPopover() { /* LAB v3: no popover */ }

/* Save the current chain as preset `name` (LABORATORY → SAVE VFX CHAIN TO PROJECTS). */
async function savePreset(page, name) {
  await openPresetPopover(page, 'save');
  await page.waitForSelector('[data-testid="preset-name"]', { state: 'attached', timeout: 5000 });
  await page.evaluate((name) => {
    const el = document.querySelector('[data-testid="preset-name"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, name);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, name);
  await sleep(250);
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="preset-save"]');
    if (!b || b.disabled) throw new Error('preset-save missing or disabled');
    b.click();
  });
}

/* Load the saved chain preset `name` (LABORATORY → OPEN VFX CHAIN FROM PROJECTS). Throws when it is not listed. */
async function loadPreset(page, name) {
  await openPresetPopover(page, 'open');
  await page.evaluate((name) => {
    const b = document.querySelector(`[data-testid="preset-load-${name}"]`);
    if (!b) throw new Error(`preset not listed: preset-load-${name}`);
    b.click();
  }, name);
}

/* Make sure `testid` is in the DOM (opening the effect's sections if needed);
 * throws when it still is not. */
async function requireControl(page, id, testid) {
  if (await page.$(`[data-testid="${testid}"]`)) return;
  await openLabSections(page, id);
  if (!(await page.$(`[data-testid="${testid}"]`))) {
    throw new Error(`Lab control missing from the DOM: [data-testid="${testid}"] (is "${id}" wired into the chain?)`);
  }
}

async function setBool(page, id, key, on) {
  const tid = `param-${id}-${key}`;
  await requireControl(page, id, tid);
  await page.evaluate(({ tid, on }) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (el.type !== 'checkbox') throw new Error(tid + ' is not a checkbox');
    if (el.checked !== !!on) el.click();
  }, { tid, on });
}

async function setNum(page, id, key, val) {
  const tid = `param-${id}-${key}`;
  await requireControl(page, id, tid);
  await page.evaluate(({ tid, val }) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (el.type !== 'range') throw new Error(tid + ' is not a range input (type=' + el.type + ')');
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setV.call(el, val);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { tid, val });
}


/* Apply a {key: value} map to one effect's Lab controls: range → value +
 * change event, checkbox → click when it differs. Opens the sections when a
 * key is not in the DOM yet. THROWS if a key (not listed in opts.optional)
 * still has no control — a missing control must never be a silent no-op.
 * Returns the list of optional keys that were skipped. */
async function applyParams(page, id, map, opts = {}) {
  const optional = opts.optional || [];
  const run = () => page.evaluate(({ id, map, optional }) => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const missing = [];
    Object.entries(map).forEach(([k, v]) => {
      const el = document.querySelector(`[data-testid="param-${id}-${k}"]`);
      if (!el) { missing.push(k); return; }
      if (el.type === 'range') { setV.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else if (el.type === 'checkbox') { if (el.checked !== !!v) el.click(); }
      else throw new Error(`param-${id}-${k}: unsupported control type ${el.type}`);
    });
    return missing;
  }, { id, map, optional });
  let missing = await run();
  if (missing.length) { await openLabSections(page, id); missing = await run(); }
  const hard = missing.filter((k) => !optional.includes(k));
  if (hard.length) throw new Error(`Lab controls missing for "${id}": ${hard.join(', ')}`);
  return missing;
}

/* Click a control by testid (opens the sections first when it is missing).
 * Throws when the control does not exist. */
async function clickControl(page, id, testid) {
  await requireControl(page, id, testid);
  // in-page click: the switches are visually-hidden inputs (their label/LED
  // intercepts a pointer click), and this also avoids scroll-into-view in the sticky panel
  await page.evaluate((t) => document.querySelector(`[data-testid="${t}"]`).click(), testid);
}


/* Wait until the Lab engine has the picked clip attached as its source (on a
 * slow / contended SwiftShader box a fixed sleep after setInputFiles is not
 * enough and `__SYN.engine.source` is still null). */
async function waitForSource(page, timeout = 60000) {
  await page.waitForFunction(() => {
    const S = window.__SYN;
    return !!(S && S.engine && S.engine.source && S.engine.source.readyState >= 1);
  }, null, { timeout });
}

/* Seed the shell composition (localStorage 'syntech.composition.v3') BEFORE
 * the app boots: INPUT → ids[0] → ids[1] … → OUTPUT. Call after a first
 * goto() and before reload(). Returns the seeded object. */
async function seedComposition(page, ids) {
  const nodes = ids.slice();
  const wires = { IN: ids[0] };
  for (let i = 0; i < ids.length - 1; i++) wires[ids[i]] = ids[i + 1];
  wires[ids[ids.length - 1]] = 'OUT';
  await page.evaluate(({ nodes, wires }) => localStorage.setItem('syntech.composition.v3', JSON.stringify({ nodes, wires })), { nodes, wires });
}

module.exports = { sleep, waitForSource, openLabSections, openPresetPopover, closePresetPopover, requireControl, setBool, setNum, applyParams, clickControl, seedComposition, setLabBlock, openLabBlock, closeLabBlock, savePreset, loadPreset };
