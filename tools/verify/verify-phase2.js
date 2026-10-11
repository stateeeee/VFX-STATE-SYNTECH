/* Phase 2 verification — AI Lab UX: armed toggle + drag wiring.
 * Roadmap acceptance: build INPUT → analog → blob_tracker → OUTPUT purely by
 * dragging, both nodes ACTIVE, detach one wire → node ghosts + leaves the
 * chain readout. Plus: armed violet toggle survives navigation, Add Node
 * menu alphabetical, port sides enforced, Lab toggle (hidden, not unmounted),
 * Lab panel ⇄ graph sync (the panel lists only the wired chain). */
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

  /* ── 7. Lab toggle: lit while on screen, stays MOUNTED when hidden ──
     (new behaviour: nav-ailab is lit only while the Lab is on screen; Home /
     an opened effect only HIDE it — its params, source and audio survive —
     and a second Lab click toggles it off again) */
  const navClass = (tid = 'nav-ailab') => page.getAttribute(`[data-testid="${tid}"]`, 'class');
  const lit = async (tid) => (await navClass(tid)).includes('text-violet-500');
  const labVisible = () => page.locator('[data-testid="chain-canvas"]').isVisible().catch(() => false);
  const labMounted = async () => !!(await page.$('[data-testid="chain-canvas"]'));
  step('Lab starts off (nav-ailab not lit, Home lit, Lab not mounted yet)', !(await lit('nav-ailab')) && (await lit('nav-home')) && !(await labMounted()));
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForTimeout(800);
  step('Lab click lights nav-ailab and shows the Lab surface', (await lit('nav-ailab')) && !(await lit('nav-home')) && (await labVisible()));

  // an opened effect covers the Lab: Lab hidden but still mounted, nav-ailab no longer lit
  await page.click('[data-testid="effect-card-analog"]');
  await page.waitForTimeout(1200);
  step('effect opens over the Lab: Lab hidden but still mounted', !(await labVisible()) && (await labMounted()) && !(await lit('nav-ailab')));
  // Home: dashboard shown (Home lit), Lab hidden and NOT unmounted — it no longer returns "armed"
  await page.click('[data-testid="nav-home"]');
  await page.waitForTimeout(600);
  step('Home hides the Lab and shows the dashboard (Lab stays mounted)',
    (await lit('nav-home')) && !(await lit('nav-ailab')) && !(await labVisible()) && (await labMounted()) && (await page.locator('[data-testid="nodal-svg"]').isVisible()));
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForTimeout(600);
  step('Lab click after Home shows the (still mounted) Lab again', (await labVisible()) && (await lit('nav-ailab')));

  /* ── 8. node graph ⇄ Lab panel sync ──
     (the rack toggle-<id> bypass buttons are gone: bypass and order come
     from the node-graph wiring; the Lab panel lists ONLY the wired effects,
     in chain order, as fx-head-<id>) */
  const panelIds = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="fx-head-"]')].map((el) => el.getAttribute('data-testid').replace('fx-head-', '')));
  const toGraph = async () => { await page.click('[data-testid="nav-home"]'); await page.waitForTimeout(400); };
  const toLab = async () => { await page.click('[data-testid="nav-ailab"]'); await page.waitForTimeout(600); };
  let ids = await panelIds();
  step('Lab panel lists the wired chain in order', JSON.stringify(ids) === JSON.stringify(['analog', 'blob_tracker']), JSON.stringify(ids));

  // graph → panel: re-route INPUT straight to blob_tracker; analog leaves the chain
  await toGraph();
  await dragPort(page, 'port-out-IN', 'port-in-blob_tracker');
  s = await readState(page);
  step('graph rewire bypasses analog (IN→blob_tracker→OUT)',
    s.analog.state === 'BYPASS' && s.wires['IN'] === 'blob_tracker' && s.wires['blob_tracker'] === 'OUT',
    JSON.stringify(s.wires));
  await toLab();
  ids = await panelIds();
  step('bypassed effect leaves the Lab panel', JSON.stringify(ids) === JSON.stringify(['blob_tracker']), JSON.stringify(ids));

  // graph → panel: wire analog back in AFTER blob_tracker (order change)
  await toGraph();
  await dragPort(page, 'port-out-blob_tracker', 'port-in-analog');
  await dragPort(page, 'port-out-analog', 'port-in-OUT');
  s = await readState(page);
  step('graph re-add appends analog after blob_tracker',
    s.wires['IN'] === 'blob_tracker' && s.wires['blob_tracker'] === 'analog' && s.wires['analog'] === 'OUT', JSON.stringify(s.wires));
  await toLab();
  ids = await panelIds();
  step('Lab panel order mirrors the new chain', JSON.stringify(ids) === JSON.stringify(['blob_tracker', 'analog']), JSON.stringify(ids));

  // graph → panel: IN→analog replaces IN→blob_tracker (blob_tracker drops out)
  await toGraph();
  await dragPort(page, 'port-out-IN', 'port-in-analog');
  s = await readState(page);
  await toLab();
  ids = await panelIds();
  step('graph drag propagates into the Lab panel', s.wires['IN'] === 'analog' && s.blob_tracker.state === 'BYPASS' && JSON.stringify(ids) === JSON.stringify(['analog']),
    `wires=${JSON.stringify(s.wires)} panel=${JSON.stringify(ids)}`);

  // the Lab button toggles the Lab off again; it is hidden, not unmounted
  await page.click('[data-testid="nav-ailab"]');
  await page.waitForTimeout(500);
  step('second Lab click hides the Lab (nav off, still mounted)', !(await lit('nav-ailab')) && !(await labVisible()) && (await labMounted()));

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
