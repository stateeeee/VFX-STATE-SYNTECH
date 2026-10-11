/* Shared Playwright helpers for the Lab (ChainLab) right panel.
 *
 * The Lab panel lists one collapsible section per WIRED effect, CLOSED by
 * default (`fx-head-<id>`, aria-expanded), and each effect has closed
 * sub-sections (`fx-sec-<id>-<group-slug>`, aria-expanded). Controls
 * (`param-<id>-<key>`, `mod-src-…`, `mod-amt-…`, `mod-val-…`) only exist in
 * the DOM once BOTH the effect head and its sub-section head are open.
 * Presets live in a popover opened by `preset-toggle`.
 *
 * Every setter here FAILS LOUDLY (throws) when the control is missing, so a
 * UI change can no longer turn a check into a silent no-op / vacuous pass.
 *
 * Usage:  const L = require('./lab-helpers.cjs');
 *         await L.openLabSections(page);            // every wired effect
 *         await L.setBool(page, 'blob_tracker', 'mirrorBg', true);
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

/* Open the chain-preset popover (preset-name / preset-save / preset-load-*). */
async function openPresetPopover(page) {
  const has = await page.$('[data-testid="preset-pop"]');
  if (!has) {
    await page.click('[data-testid="preset-toggle"]');
    await page.waitForSelector('[data-testid="preset-pop"]', { timeout: 5000 });
  }
}

async function closePresetPopover(page) {
  const has = await page.$('[data-testid="preset-pop"]');
  if (has) await page.click('[data-testid="preset-toggle"]');
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

module.exports = { sleep, waitForSource, openLabSections, openPresetPopover, closePresetPopover, requireControl, setBool, setNum, applyParams, clickControl, seedComposition };
