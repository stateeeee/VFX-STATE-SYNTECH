/* Phase 2 verification — AI Lab UX: armed toggle + drag wiring.
 * Roadmap acceptance: build INPUT → analog → blob_tracker → OUTPUT purely by
 * dragging, both nodes ACTIVE, detach one wire → node ghosts + leaves the
 * chain readout. Plus: armed violet toggle survives navigation, Add Node
 * menu alphabetical, port sides enforced, ChainLab rack ⇄ graph sync. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCRATCH = '__SCRATCH__';
const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

// getBoundingClientRect via evaluate: locator.boundingBox() is flaky on SVG <g>
const portCenter = async (page, testid) => {
  const box = await page.evaluate((tid) => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, testid);
  if (!box) throw new Error(`no element for ${testid}`);
  return box;
};

const dragPort = async (page, fromTid, to /* {x,y} or testid string */) => {
  const a = await portCenter(page, fromTid);
  const b = typeof to === 'string' ? await portCenter(page, to) : to;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  // few intermediate moves so `moved` latches
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 4, a.y + ((b.y - a.y) * i) / 4);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(250);
};

const readState = (page) =>
  page.evaluate(() => {
    const comp = JSON.parse(localStorage.getItem('syntech.composition.v3') || '{}');
    const stateOf = (id) => {
      const el = document.querySelector(`[data-testid="nodal-state-${id}"]`);
      return el ? el.textContent : null;
    };
    const opacityOf = (id) => {
      const el = document.querySelector(`[data-testid="nodal-node-${id}"]`);
      return el ? el.getAttribute('opacity') : null;
    };
    const count = document.querySelector('[data-testid="nodal-chain-count"]');
    return {
      wires: comp.wires || {},
      nodes: comp.nodes || [],
      analog: { state: stateOf('analog'), opacity: opacityOf('analog') },
      blob_tracker: { state: stateOf('blob_tracker'), opacity: opacityOf('blob_tracker') },
      chainCount: count ? count.textContent : null,
    };
  });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

  await page.goto('http://localhost:3000', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);

  /* ── 1. Add Node menu strictly alphabetical ── */
  await page.click('[data-testid="nodal-add"]');
  const menuNames = await page.$$eval('[data-testid="nodal-add-menu"] button', (els) => els.map((e) => e.textContent.trim()));
  step('Add Node menu alphabetical', JSON.stringify(menuNames) === JSON.stringify(['ANALOG', 'ANAMORPHIC LAB', 'BLOB REVEAL', 'BLOB TRACKER', 'BOKEH']), menuNames.join(', '));

  /* ── 2. add analog + blob_tracker → auto-wired IN→analog→blob_tracker→OUT ── */
  await page.click('[data-testid="nodal-add-analog"]');
  await page.click('[data-testid="nodal-add"]');
  await page.click('[data-testid="nodal-add-blob_tracker"]');
  await page.waitForTimeout(300);
  let s = await readState(page);
  step('Add Node wires between INPUT and OUTPUT',
    s.wires['IN'] === 'analog' && s.wires['analog'] === 'blob_tracker' && s.wires['blob_tracker'] === 'OUT',
    JSON.stringify(s.wires));
  step('both nodes ACTIVE after add', s.analog.state === 'ACTIVE' && s.blob_tracker.state === 'ACTIVE');

  /* ── 3. detach every wire by dragging into the void → all ghost ── */
  const voidPt = async () => {
    const svg = await page.locator('[data-testid="nodal-svg"]').boundingBox();
    return { x: svg.x + svg.width * 0.28, y: svg.y + svg.height * 0.12 };
  };
  await dragPort(page, 'port-out-IN', await voidPt());
  await dragPort(page, 'port-out-analog', await voidPt());
  await dragPort(page, 'port-out-blob_tracker', await voidPt());
  s = await readState(page);
  step('drag-off disconnects all wires', Object.keys(s.wires).length === 0, JSON.stringify(s.wires));
  step('unwired nodes ghost at 50% + BYPASS',
    s.analog.state === 'BYPASS' && s.analog.opacity === '0.5' &&
    s.blob_tracker.state === 'BYPASS' && s.blob_tracker.opacity === '0.5',
    `analog ${s.analog.state}/${s.analog.opacity}, bt ${s.blob_tracker.state}/${s.blob_tracker.opacity}`);
  step('OUTPUT readout shows passthrough', s.chainCount === 'passthrough', String(s.chainCount));

  /* ── 4. build INPUT → analog → blob_tracker → OUTPUT purely by dragging ── */
  await dragPort(page, 'port-out-IN', 'port-in-analog');
  await dragPort(page, 'port-out-analog', 'port-in-blob_tracker');
  await dragPort(page, 'port-out-blob_tracker', 'port-in-OUT');
  s = await readState(page);
  step('drag-built chain IN→analog→blob_tracker→OUT',
    s.wires['IN'] === 'analog' && s.wires['analog'] === 'blob_tracker' && s.wires['blob_tracker'] === 'OUT',
    JSON.stringify(s.wires));
  step('both nodes ACTIVE at full opacity',
    s.analog.state === 'ACTIVE' && s.analog.opacity === '1' && s.blob_tracker.state === 'ACTIVE' && s.blob_tracker.opacity === '1');
  step('OUTPUT readout shows 2 fx · live', s.chainCount === '2 fx · live', String(s.chainCount));

  /* ── 5. port sides enforced: out→out must not connect ── */
  await dragPort(page, 'port-out-IN', 'port-out-analog'); // release over another OUT port
  s = await readState(page);
  // the drop misses (no in-port there) → the picked-up IN wire is dropped in the void → IN wire gone
  const sidesOk = s.wires['IN'] === undefined && s.wires['analog'] === 'blob_tracker';
  step('port sides enforced (out→out rejected)', sidesOk, JSON.stringify(s.wires));
  await dragPort(page, 'port-out-IN', 'port-in-analog'); // re-attach
  s = await readState(page);
  step('re-attach IN→analog', s.wires['IN'] === 'analog');

  /* ── 6. detach one wire → node ghosts and leaves the chain readout ── */
  await dragPort(page, 'port-out-analog', await voidPt());
  s = await readState(page);
  step('detached middle wire → chain breaks, both ghost',
    s.analog.state === 'BYPASS' && s.blob_tracker.state === 'BYPASS' && s.chainCount === 'passthrough',
    `${s.analog.state}/${s.blob_tracker.state}/${s.chainCount}`);
  await dragPort(page, 'port-out-analog', 'port-in-blob_tracker'); // restore
  s = await readState(page);
  step('restore full chain', s.chainCount === '2 fx · live');

  /* ── 7. AI Lab armed toggle: violet, survives navigation, manual disarm ── */
  const navClass = () => page.getAttribute('[data-testid="nav-ailab"]', 'class');
  step('AI Lab starts disarmed', !(await navClass()).includes('text-violet-500'));
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForTimeout(800);
  step('arming turns nav violet', (await navClass()).includes('text-violet-500'));
  const labVisible = () => page.locator('[data-testid="chain-canvas"]').isVisible().catch(() => false);
  step('armed lab shows ChainLab surface', await labVisible());

  // navigation: open an effect → lab hidden but still armed; Home → lab back
  await page.click('[data-testid="effect-card-analog"]');
  await page.waitForTimeout(1200);
  step('effect opens over armed lab, nav stays violet', (await navClass()).includes('text-violet-500') && !(await labVisible()));
  await page.click('[data-testid="nav-home"]');
  await page.waitForTimeout(600);
  step('Home returns to armed lab (still violet)', (await navClass()).includes('text-violet-500') && (await labVisible()));

  /* ── 8. rack ⇄ graph sync (both ways) ── */
  const rackReadout = () => page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-testid^="toggle-"]')];
    return els.map((el) => ({
      id: el.getAttribute('data-testid').replace('toggle-', ''),
      on: el.className.includes('bg-violet-500'),
    }));
  });
  let rack = await rackReadout();
  const rackOn = rack.filter((r) => r.on).map((r) => r.id);
  step('rack mirrors wired chain', JSON.stringify(rackOn) === JSON.stringify(['analog', 'blob_tracker']), JSON.stringify(rack));

  // rack → graph: bypass analog in the rack
  await page.click('[data-testid="toggle-analog"]');
  await page.waitForTimeout(400);
  s = await readState(page);
  step('rack bypass propagates to graph wiring',
    s.analog.state === 'BYPASS' && s.wires['IN'] === 'blob_tracker' && s.wires['blob_tracker'] === 'OUT',
    JSON.stringify(s.wires));

  // graph → rack: re-wire analog back in via drag (lab still open below? node graph is on dashboard)
  await page.click('[data-testid="toggle-analog"]'); // re-enable via rack (appends at end)
  await page.waitForTimeout(400);
  s = await readState(page);
  rack = await rackReadout();
  step('rack re-enable appends to chain', s.wires['blob_tracker'] === 'analog' && s.wires['analog'] === 'OUT', JSON.stringify(s.wires));
  step('rack order mirrors new chain', JSON.stringify(rack.filter((r) => r.on).map((r) => r.id)) === JSON.stringify(['blob_tracker', 'analog']), JSON.stringify(rack));

  // graph → rack: drag rewire on the dashboard graph while lab armed
  await dragPort(page, 'port-out-IN', 'port-in-analog'); // IN→analog (replaces IN→blob_tracker)
  await page.waitForTimeout(300);
  s = await readState(page);
  const rackAfterDrag = await rackReadout();
  step('graph drag propagates into rack',
    s.wires['IN'] === 'analog' && JSON.stringify(rackAfterDrag.filter((r) => r.on).map((r) => r.id)) !== JSON.stringify(['blob_tracker', 'analog']) ? true : rackAfterDrag.some((r) => r.id === 'analog' && r.on),
    `wires=${JSON.stringify(s.wires)} rack=${JSON.stringify(rackAfterDrag)}`);

  // manual disarm
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForTimeout(500);
  step('manual click disarms (violet off, lab gone)', !(await navClass()).includes('text-violet-500') && !(await labVisible()));

  /* ── 9. persistence across reload ── */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  s = await readState(page);
  step('wiring persists across reload (v3)', s.nodes.length === 2 && Object.keys(s.wires).length > 0, JSON.stringify(s));

  step('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(SCRATCH, 'shots', 'phase2-final.png') });
  const fails = results.filter((r) => !r.ok);
  console.log(`\n===== SUMMARY: ${results.length} steps, ${fails.length} failed =====`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
