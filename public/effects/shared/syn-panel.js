/* VFX SYNTECH — SynPanel: the ONE Export panel of every effect (docs/workflow/13-EXPORT-PANEL.md §2).
 *
 *   QUALITY  [range 0–100]  100          localStorage 'syntech.export.q' (default 100; the old 'syntech.export.quality'
 *   FOTO     PNG · JPEG · PDF            is migrated once: master → 100, high → 60)
 *   VIDEO    REC SCREEN · EXPORT MP4
 *
 * Nothing per effect: SynExport.attach() and SynStill.attach() (syn-export.js / syn-still.js) queue their controllers
 * in window.__synPanelQ and load this file on demand (resolved next to them). On load the queue is drained; the panel
 * mounts ONCE, when the SynExport controller that owns a RENDER MP4 button is there, into the section body that holds
 * that button (`.sec-body`, else its parent). The body gets the class `syn-xp-host`: every old child stays in the DOM
 * (the effect's JS reads rec-label, rec-status, render-status, …) but is hidden (`display:none !important`), and the
 * panel is inserted as its first child. The old PNG · JPEG · PDF row of SynStill.attach is removed (its ids move here).
 *
 * Ids: syn-q, syn-q-val, syn-still-png, syn-still-jpeg, syn-still-pdf, syn-rec-screen, syn-export-mp4 (container
 * #syn-xp). Look: a scoped <style> (#syn-xp-style) built on the syn-chrome variables — the segment-button "off" look for
 * all five buttons, the lit `.on` look (and the job's progress text: "■ STOP 42%", "■ STOP 0:12", "WRITING…") on the
 * button whose job runs; day theme under html[data-syn-theme="day"]. Identical in all 10 effects (id selectors, every
 * property set here, nothing inherited from the effect's own button classes).
 *
 * Actions: FOTO → stillController.run(format); EXPORT MP4 → exportController.exportMp4(); REC SCREEN →
 * exportController.recScreen() (see the two attach() headers for what each does per source).
 * Messages: the controllers send results / errors to the effect's own toast through SynPanel.toastVia(raw, msg, ms):
 * when the effect's toast is not visible (it writes into the hidden old status line, or into a hidden bar) the panel
 * shows the message in its own small toast.
 *
 * window.SynPanel = { quality() → 0…100, setQuality(q), mounted() → bool, toast(msg, ms), toastVia(raw, msg, ms),
 *                     _drain() (internal), el() → #syn-xp | null }
 */
(function () {
  'use strict';
  if (window.SynPanel) { window.SynPanel._drain(); return; }

  var Q_KEY = 'syntech.export.q', Q_OLD = 'syntech.export.quality';
  var exportCtl = null, stillCtl = null, panel = null, host = null, q = readQ(), toastEl = null, toastT = 0;
  var LABELS = { png: 'PNG', jpeg: 'JPEG', pdf: 'PDF', rec: 'REC SCREEN', mp4: 'EXPORT MP4' };
  var IDS = { png: 'syn-still-png', jpeg: 'syn-still-jpeg', pdf: 'syn-still-pdf', rec: 'syn-rec-screen', mp4: 'syn-export-mp4' };

  function readQ() {
    try {
      var v = localStorage.getItem(Q_KEY);
      if (v !== null && v !== '' && isFinite(Number(v))) return clampQ(Number(v));
      var m = localStorage.getItem(Q_OLD) === 'high' ? 60 : 100;
      localStorage.setItem(Q_KEY, String(m));
      return m;
    } catch (e) { return 100; }
  }
  function clampQ(v) { v = Math.round(Number(v)); return isFinite(v) ? Math.max(0, Math.min(100, v)) : 100; }
  function setQuality(v) {
    q = clampQ(v);
    try { localStorage.setItem(Q_KEY, String(q)); } catch (e) { /* */ }
    var r = document.getElementById('syn-q'), t = document.getElementById('syn-q-val');
    if (r && Number(r.value) !== q) r.value = String(q);
    if (t) t.textContent = String(q);
    if (r) r.style.setProperty('--syn-q-fill', q + '%');
  }

  /* ── style: night = the syn-chrome segment button / DAW slider, day = their day versions ── */
  var CSS = [
    '.syn-xp-host > :not(#syn-xp) { display:none !important; }',
    '#syn-xp { display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box; margin:0; padding:0; }',
    '#syn-xp .syn-xp-row { display:flex; align-items:center; gap:8px; min-height:27px; margin:0; }',
    '#syn-xp .syn-xp-lbl { width:52px; flex:0 0 52px; font-family:var(--mono,"JetBrains Mono",monospace); font-size:8px; font-weight:400;',
    '  letter-spacing:1px; line-height:1; color:var(--t2,#7a5518); text-transform:uppercase; white-space:nowrap; text-align:left; }',
    '#syn-xp .syn-xp-btns { display:flex; gap:2px; flex:1 1 auto; min-width:0; }',
    '#syn-xp .syn-xp-val { width:28px; flex:0 0 28px; text-align:right; font-family:var(--mono,"JetBrains Mono",monospace); font-size:9px;',
    '  letter-spacing:.5px; color:var(--t4,#f2d458); font-variant-numeric:tabular-nums; text-shadow:0 0 6px rgba(232,192,0,.3); }',
    /* QUALITY slider (the DAW slider of the effects) */
    '#syn-xp #syn-q { -webkit-appearance:none; appearance:none; flex:1 1 auto; min-width:0; width:auto; height:2px; margin:0; padding:0; border:0;',
    '  background:linear-gradient(90deg,rgba(255,255,255,.06),rgba(255,255,255,.12)); outline:none; cursor:ew-resize; border-radius:1px;',
    '  box-shadow:inset 0 1px 0 rgba(0,0,0,.4),0 1px 0 rgba(255,255,255,.06); }',
    '#syn-xp #syn-q::-webkit-slider-thumb { -webkit-appearance:none; appearance:none; width:9px; height:22px; border:none; cursor:ew-resize; border-radius:2px;',
    '  background:linear-gradient(180deg,rgba(255,255,255,.5) 0%,#e0d0a0 10%,#c8a830 40%,#a07820 65%,#5a4010 85%,rgba(255,255,255,.2) 100%);',
    '  box-shadow:inset 0 1px 0 rgba(255,255,255,.6),inset 0 -1px 0 rgba(0,0,0,.4),0 0 10px rgba(200,168,48,.5),0 2px 6px rgba(0,0,0,.8); }',
    '#syn-xp #syn-q::-moz-range-thumb { width:9px; height:22px; border:none; cursor:ew-resize; border-radius:2px;',
    '  background:linear-gradient(180deg,#e0d0a0,#c8a830,#a07820,#5a4010); box-shadow:0 0 10px rgba(200,168,48,.5),0 2px 6px rgba(0,0,0,.8); }',
    /* the five buttons: the segment button, off */
    '#syn-xp .syn-xp-btn { -webkit-appearance:none; appearance:none; box-sizing:border-box; flex:1 1 0; min-width:0; height:27px; margin:0; padding:0 4px;',
    '  display:flex; align-items:center; justify-content:center; white-space:nowrap; overflow:hidden; text-overflow:clip;',
    '  background:radial-gradient(ellipse 100% 55% at 50% -10%,rgba(255,255,255,.20) 0%,rgba(255,255,255,.07) 40%,transparent 72%),',
    '    linear-gradient(180deg,#181618 0%,#0c0a0c 35%,#060406 65%,#0a080a 100%);',
    '  border:1px solid rgba(255,255,255,.09); border-bottom-color:rgba(0,0,0,.65); border-radius:1px; opacity:1;',
    '  font-family:var(--mono,"JetBrains Mono",monospace); font-size:8.5px; font-weight:400; line-height:1; letter-spacing:1.5px;',
    '  color:var(--t2,#7a5518); text-transform:uppercase; text-shadow:none; cursor:pointer; position:relative; transition:all .12s; animation:none;',
    '  box-shadow:inset 0 2px 10px rgba(255,255,255,.13),inset 0 -2px 8px rgba(0,0,0,.65),0 2px 4px rgba(0,0,0,.6); }',
    '#syn-xp .syn-xp-btn::before { content:""; position:absolute; top:0; left:0; right:0; height:45%; background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.02)); pointer-events:none; }',
    '#syn-xp .syn-xp-btn:hover { color:var(--t4,#f2d458); border-color:rgba(255,255,255,.16);',
    '  background:radial-gradient(ellipse 100% 55% at 50% -10%,rgba(255,255,255,.28) 0%,rgba(255,255,255,.10) 40%,transparent 72%),',
    '    linear-gradient(180deg,#222022 0%,#141214 35%,#0c0a0c 65%,#121012 100%); }',
    '#syn-xp .syn-xp-btn:focus-visible { outline:1px solid rgba(232,192,0,.5); outline-offset:1px; }',
    /* lit while its job runs */
    '#syn-xp .syn-xp-btn.on { color:var(--t4,#f2d458); border-color:rgba(232,192,0,.48); border-bottom-color:rgba(0,0,0,.65);',
    '  background:radial-gradient(ellipse 100% 55% at 50% -10%,rgba(255,255,255,.36) 0%,rgba(255,255,255,.16) 40%,transparent 72%),',
    '    linear-gradient(180deg,#282428 0%,#1a161a 35%,#100e10 65%,#181418 100%);',
    '  box-shadow:inset 0 3px 14px rgba(255,255,255,.24),inset 0 -2px 8px rgba(0,0,0,.65),0 2px 5px rgba(0,0,0,.65);',
    '  text-shadow:0 0 8px rgba(255,255,255,.2); animation:iri-glow 5s linear infinite; }',
    /* own toast (only when the effect's toast is not visible) */
    '#syn-xp-toast { position:fixed; left:50%; bottom:22px; transform:translateX(-50%); z-index:2147483000; pointer-events:none; max-width:min(80vw,640px);',
    '  padding:8px 14px; border:1px solid var(--border-hi,#38286a); border-radius:3px; background:rgba(6,4,14,.94); color:var(--t4,#f2d458);',
    '  font-family:var(--mono,"JetBrains Mono",monospace); font-size:9px; letter-spacing:1px; line-height:1.5; text-align:center;',
    '  box-shadow:0 6px 24px rgba(0,0,0,.6); opacity:0; transition:opacity .18s; overflow-wrap:anywhere; }',
    '#syn-xp-toast.show { opacity:1; }',
    /* day */
    'html[data-syn-theme="day"] #syn-xp .syn-xp-lbl { color:#6b655d; }',
    'html[data-syn-theme="day"] #syn-xp .syn-xp-val { color:#1c1917; text-shadow:none; }',
    'html[data-syn-theme="day"] #syn-xp #syn-q { background:linear-gradient(90deg,#d8d4ca,#cdc8bc); box-shadow:inset 0 1px 1px rgba(0,0,0,.12); }',
    'html[data-syn-theme="day"] #syn-xp #syn-q::-webkit-slider-thumb { background:linear-gradient(180deg,#ffffff 0%,#ddd6fe 35%,#8b5cf6 100%); box-shadow:0 0 0 1px rgba(109,40,217,.55),0 2px 5px rgba(60,50,30,.3); }',
    'html[data-syn-theme="day"] #syn-xp #syn-q::-moz-range-thumb { background:linear-gradient(180deg,#ffffff,#ddd6fe 35%,#8b5cf6); box-shadow:0 0 0 1px rgba(109,40,217,.55),0 2px 5px rgba(60,50,30,.3); }',
    'html[data-syn-theme="day"] #syn-xp .syn-xp-btn { background:var(--d-btn,linear-gradient(180deg,#ffffff 0%,#f7f5f0 55%,#ece9e1 100%));',
    '  border:1px solid #d8d4ca; border-bottom-color:#c9c4b8; color:#6b655d; box-shadow:var(--d-btn-shadow,0 1px 2px rgba(60,50,30,.14),inset 0 1px 0 #fff); }',
    'html[data-syn-theme="day"] #syn-xp .syn-xp-btn::before { display:none; }',
    'html[data-syn-theme="day"] #syn-xp .syn-xp-btn:hover { color:#1c1917; background:var(--d-btn-hover,linear-gradient(180deg,#ffffff 0%,#f1eefb 100%)); border-color:#b9a8ee; }',
    'html[data-syn-theme="day"] #syn-xp .syn-xp-btn.on { background:var(--d-btn-on,linear-gradient(180deg,#faf7ff 0%,#ede9fe 100%));',
    '  border-color:rgba(124,58,237,.55); border-bottom-color:rgba(124,58,237,.65); color:#5b21b6; animation:none; text-shadow:none;',
    '  box-shadow:0 0 0 1px rgba(139,92,246,.12),0 0 10px rgba(139,92,246,.18),inset 0 1px 0 #fff; }',
    'html[data-syn-theme="day"] #syn-xp-toast { background:rgba(255,255,255,.97); color:#1c1917; border-color:#d8d4ca; box-shadow:0 6px 20px rgba(60,50,30,.18); }'
  ].join('\n');

  function injectStyle() {
    if (document.getElementById('syn-xp-style')) return;
    var st = document.createElement('style');
    st.id = 'syn-xp-style';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  /* ── messages ── */
  function toast(msg, ms) {
    if (!document.body) return;
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.id = 'syn-xp-toast';
      toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = String(msg);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { if (toastEl) toastEl.classList.remove('show'); }, ms || 3000);
  }
  function visible(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      if (e.id === 'syn-xp-toast') return false;
      if (host && e === host) return false;          /* the hidden old export controls */
    }
    if (typeof el.checkVisibility === 'function') { if (!el.checkVisibility({ checkVisibilityCSS: true })) return false; }
    else if (!el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  /* raw = the effect's toast. When the message did not land anywhere visible, show it in the panel's own toast. */
  function toastVia(raw, msg, ms) {
    try { if (typeof raw === 'function') raw(msg, ms); } catch (e) { console.error(e); }
    if (!panel) return;
    var key = String(msg).slice(0, 28);
    setTimeout(function () {
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n, seen = false;
      while ((n = w.nextNode())) {
        if (n.nodeValue && n.nodeValue.indexOf(key) >= 0 && n.parentElement && visible(n.parentElement)) { seen = true; break; }
      }
      if (!seen) toast(msg, ms);
    }, 40);
  }

  /* ── button states from the two controllers ── */
  function btn(k) { return document.getElementById(IDS[k]); }
  function paint(kinds, st) {
    kinds.forEach(function (k) {
      var b = btn(k); if (!b) return;
      var on = st.owner === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.textContent = on && st.text ? st.text : LABELS[k];
    });
  }

  function makeBtn(k) {
    var b = document.createElement('button');
    b.type = 'button'; b.id = IDS[k]; b.className = 'syn-xp-btn';
    b.setAttribute('data-syn-xp', k); b.setAttribute('aria-pressed', 'false');
    if (k === 'png' || k === 'jpeg' || k === 'pdf') b.setAttribute('data-still', k);
    b.textContent = LABELS[k];
    b.addEventListener('click', function () {
      if (k === 'rec') { if (exportCtl) exportCtl.recScreen(); return; }
      if (k === 'mp4') { if (exportCtl) exportCtl.exportMp4(); return; }
      if (stillCtl) stillCtl.run(k);
      else toast('PNG / JPEG / PDF are not available in this effect', 3000);
    });
    return b;
  }
  function row(label, content) {
    var r = document.createElement('div'); r.className = 'syn-xp-row';
    var l = document.createElement('div'); l.className = 'syn-xp-lbl'; l.textContent = label;
    r.appendChild(l);
    content.forEach(function (c) { r.appendChild(c); });
    return r;
  }

  function mount() {
    if (panel || !exportCtl || !exportCtl.renderBtn) return;
    var rb = exportCtl.renderBtn;
    host = (rb.closest && rb.closest('.sec-body')) || rb.parentElement;
    if (!host) return;
    injectStyle();
    /* the old PNG · JPEG · PDF row: its ids move into the panel */
    if (stillCtl && stillCtl.row && stillCtl.row.parentNode) stillCtl.row.parentNode.removeChild(stillCtl.row);
    var old = document.getElementById('syn-still-row'); if (old && old.parentNode) old.parentNode.removeChild(old);

    panel = document.createElement('div'); panel.id = 'syn-xp'; panel.setAttribute('data-syn-panel', '1');
    var range = document.createElement('input');
    range.type = 'range'; range.id = 'syn-q'; range.min = '0'; range.max = '100'; range.step = '1'; range.value = String(q);
    range.setAttribute('aria-label', 'Export quality');
    var val = document.createElement('div'); val.id = 'syn-q-val'; val.className = 'syn-xp-val'; val.textContent = String(q);
    range.addEventListener('input', function () { setQuality(range.value); });
    range.addEventListener('change', function () { setQuality(range.value); });
    var foto = document.createElement('div'); foto.className = 'syn-xp-btns';
    ['png', 'jpeg', 'pdf'].forEach(function (k) { foto.appendChild(makeBtn(k)); });
    var video = document.createElement('div'); video.className = 'syn-xp-btns';
    ['rec', 'mp4'].forEach(function (k) { video.appendChild(makeBtn(k)); });
    panel.appendChild(row('Quality', [range, val]));
    panel.appendChild(row('Foto', [foto]));
    panel.appendChild(row('Video', [video]));
    host.insertBefore(panel, host.firstChild);
    host.classList.add('syn-xp-host');
    setQuality(q);
    window.__synPanelMounted = true;
  }

  function drain() {
    var Q = window.__synPanelQ || [];
    window.__synPanelQ = [];
    Q.forEach(function (it) {
      if (it.kind === 'export' && !exportCtl && it.ctl && it.ctl.renderBtn) {
        exportCtl = it.ctl;
        exportCtl.onState(function (st) { paint(['rec', 'mp4'], st); });
      } else if (it.kind === 'still' && !stillCtl && it.ctl) {
        stillCtl = it.ctl;
        stillCtl.onState(function (st) { paint(['png', 'jpeg', 'pdf'], st); });
      }
    });
    if (exportCtl && stillCtl) { exportCtl.linkStill(stillCtl.cfg); stillCtl.linkExport(exportCtl); }
    mount();
    if (panel && stillCtl && stillCtl.row && stillCtl.row.parentNode) stillCtl.row.parentNode.removeChild(stillCtl.row);
  }

  window.SynPanel = {
    quality: function () { return q; },
    setQuality: setQuality,
    mounted: function () { return !!panel; },
    el: function () { return panel; },
    toast: toast,
    toastVia: toastVia,
    _drain: drain
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drain);
  else drain();
})();
