/* ═══════════════════════════════════════════════════════════════════════
   SYNTECH-UNIFORM — work timer + timeline, shared by all five effects
   (BOKEH included). Operator request 2026-10-11 (second round):

   1. WORK TIMER — in the top bar, where the 00:00:00:00 timecode was (next
      to FPS). It starts as soon as the effect opens and counts only the time
      you actually work on it: it STOPS while the app is in the background
      (another app / tab / window focused, window minimised) and while the
      effect is not on screen. One timer per effect, separate from the app's
      SESSION timer; it keeps its value when you leave the effect and come
      back, and resets only when the app (the browser tab) is closed —
      sessionStorage, key "syntech.timer.fx.<ModuleId>". Format DD:HH:MM:SS,
      the same as the app's SESSION timer.

   2. TIMELINE — BLOB REVEAL's transport bar (▶ PLAY / ▮▮ PAUSE · time ·
      scrub track · duration · ⟳ LOOP), copied 1:1 from
      public/effects/blob_reveal/index.html (CSS "TRANSPORT BAR"), built under
      the video for the effects that call SynExtras.attach({video:…}). It is
      shown only while a video FILE is the source. Play / loop go through the
      effect's own functions so its Source-section LEDs stay in sync.

   3. FPS 0 WITHOUT A SOURCE — safety net (BOKEH shows FPS 0 with no
      source): if the effect reports no source, #fps-val / #ic-fps read 0.

   Standalone-safe: works the same in the app's iframe and opened directly.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.SynExtras) return;

  /* ── styles ──────────────────────────────────────────────────────────
     #syn-timer = BOKEH's #timecode rule. #syn-transport = BLOB REVEAL's
     transport (its tokens resolved: --text-mid #c89030, --text-lo #7a5518,
     --blue #00e0c0, --amber #e8c000, --bg-deep #020108). */
  var CSS =
    '#timecode{display:none!important}' +
    '#syn-timer{font-size:12px;letter-spacing:3px;color:var(--t3,#c89030);font-variant-numeric:tabular-nums;margin-left:auto;min-width:100px;text-align:right;font-family:var(--mono,"JetBrains Mono",monospace);white-space:nowrap}' +
    '#syn-transport{height:36px;background:#020108;border-top:1px solid rgba(255,255,255,.05);display:none;flex-shrink:0;align-items:center;gap:8px;padding:0 10px;font-family:var(--mono,"JetBrains Mono",monospace);user-select:none}' +
    '#syn-transport.visible{display:flex}' +
    '#syn-transport .syn-tl-pause{height:24px;padding:0 12px;background:linear-gradient(180deg,#1a181c 0%,#0e0c10 35%,#080608 70%,#0c0a0e 100%);border:1px solid rgba(255,255,255,.1);border-bottom-color:rgba(0,0,0,.65);color:#c89030;font-family:var(--mono,"JetBrains Mono",monospace);font-size:9px;letter-spacing:2px;cursor:pointer;transition:all .12s;white-space:nowrap;display:flex;align-items:center;gap:5px;box-shadow:inset 0 2px 8px rgba(255,255,255,.13),inset 0 -2px 6px rgba(0,0,0,.6);border-radius:0;margin:0}' +
    '#syn-transport .syn-tl-pause:hover{border-color:#00e0c0;color:#00e0c0}' +
    '#syn-transport .syn-tl-pause.paused{border-color:#e8c000;color:#e8c000;background:linear-gradient(180deg,#221e0c 0%,#141005 100%)}' +
    '#syn-transport .syn-tl-wrap{flex:1;height:100%;display:flex;align-items:center;gap:6px;min-width:0}' +
    '#syn-transport .syn-tl-cur{font-size:9px;color:#c89030;font-variant-numeric:tabular-nums;white-space:nowrap;width:38px;letter-spacing:0}' +
    '#syn-transport .syn-tl-dur{font-size:9px;color:#7a5518;font-variant-numeric:tabular-nums;white-space:nowrap;width:38px;text-align:right;letter-spacing:0}' +
    '#syn-transport .syn-tl-track{flex:1;height:4px;background:rgba(255,255,255,.08);position:relative;cursor:pointer;display:flex;align-items:center;border-radius:2px;overflow:hidden;box-shadow:inset 0 1px 0 rgba(0,0,0,.4)}' +
    '#syn-transport .syn-tl-track:hover{background:rgba(255,255,255,.12)}' +
    '#syn-transport .syn-tl-fill{position:absolute;left:0;top:0;height:100%;width:0%;pointer-events:none;border-radius:2px;background:linear-gradient(90deg,#5a3800,#e8c000,#c0a0ff);box-shadow:0 0 6px rgba(232,192,0,.4)}' +
    '#syn-transport .syn-tl-head{position:absolute;width:12px;height:12px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff,#e8c000);left:0%;transform:translateX(-50%);top:50%;margin-top:-6px;pointer-events:none;box-shadow:0 0 8px rgba(232,192,0,.8),inset 0 1px 0 rgba(255,255,255,.5)}' +
    '#syn-transport .syn-tl-loop{height:24px;padding:0 8px;background:linear-gradient(180deg,#181618 0%,#0a080a 100%);border:1px solid rgba(255,255,255,.09);color:#7a5518;font-family:var(--mono,"JetBrains Mono",monospace);font-size:8px;letter-spacing:1px;cursor:pointer;transition:all .12s;border-radius:1px;margin:0}' +
    '#syn-transport .syn-tl-loop:hover{border-color:rgba(255,255,255,.18);color:#c89030}' +
    '#syn-transport .syn-tl-loop.on{border-color:rgba(0,224,192,.4);color:#00e0c0}';

  function addStyle(){
    if(document.getElementById('syn-extras-style')) return;
    var st=document.createElement('style');
    st.id='syn-extras-style';
    st.textContent=CSS;
    (document.head||document.documentElement).appendChild(st);
  }

  /* ── 1. work timer ─────────────────────────────────────────────────── */
  var m=/\/effects\/([^\/]+)\//.exec(location.pathname);
  var FX_ID=m?m[1]:'effect';
  var KEY='syntech.timer.fx.'+FX_ID;
  var STEP_CAP=1500;            /* never credit more than this per tick (sleep / throttling) */
  var workMs=0;
  try{ workMs=Math.max(0, Number(sessionStorage.getItem(KEY))||0); }catch(e){}

  function topDoc(){ try{ return window.top.document; }catch(e){ return document; } }
  /* "working on this effect" = app window visible AND focused (focus inside
     this iframe counts: the top document reports it) AND the effect on screen */
  function isWorking(){
    var d=topDoc();
    if(d.visibilityState && d.visibilityState!=='visible') return false;
    if(typeof d.hasFocus==='function' && !d.hasFocus()) return false;
    var fe=null; try{ fe=window.frameElement; }catch(e){}
    if(fe){
      if(!fe.getClientRects().length) return false;
      try{ if(getComputedStyle(fe).visibility==='hidden') return false; }catch(e){}
    }
    return true;
  }
  function pad2(n){ return (n<10?'0':'')+n; }
  function fmtWork(ms){
    var s=Math.floor(ms/1000);
    var d=Math.floor(s/86400), h=Math.floor((s%86400)/3600), mi=Math.floor((s%3600)/60), se=s%60;
    return pad2(d)+':'+pad2(h)+':'+pad2(mi)+':'+pad2(se);
  }
  var timerEl=null, lastTick=0, lastSaved=-1;
  function buildTimer(){
    var tc=document.getElementById('timecode');
    if(!tc||document.getElementById('syn-timer')) return;
    timerEl=document.createElement('div');
    timerEl.id='syn-timer';
    timerEl.title='Tempo di lavoro su questo effetto (si ferma quando usi altre app)';
    timerEl.textContent=fmtWork(workMs);
    tc.parentNode.insertBefore(timerEl, tc.nextSibling);
  }
  function tickTimer(){
    var now=performance.now();
    var dt=lastTick?now-lastTick:0;
    lastTick=now;
    if(dt>0 && isWorking()) workMs+=Math.min(dt, STEP_CAP);
    var sec=Math.floor(workMs/1000);
    if(sec!==lastSaved){
      lastSaved=sec;
      try{ sessionStorage.setItem(KEY, String(Math.round(workMs))); }catch(e){}
      if(timerEl) timerEl.textContent=fmtWork(workMs);
    }
  }
  function saveNow(){ tickTimer(); try{ sessionStorage.setItem(KEY, String(Math.round(workMs))); }catch(e){} }

  /* ── 2/3. effect adapter: timeline + FPS-0 safety net ───────────────── */
  var A=null, tr=null, els={}, scrubbing=false, shown=false;
  function fmtTC(s){
    if(!s||isNaN(s)) return '00:00';
    return pad2(Math.floor(s/60))+':'+pad2(Math.floor(s%60));
  }
  function curVideo(){
    if(!A||!A.video) return null;
    var v=null; try{ v=A.video(); }catch(e){}
    if(!v||v.srcObject) return null;
    return v;
  }
  function buildTransport(){
    if(tr) return;
    tr=document.createElement('div');
    tr.id='syn-transport';
    tr.innerHTML=
      '<button type="button" class="syn-tl-pause paused">&#9654; PLAY</button>'+
      '<div class="syn-tl-wrap">'+
        '<span class="syn-tl-cur">00:00</span>'+
        '<div class="syn-tl-track"><div class="syn-tl-fill"></div><div class="syn-tl-head"></div></div>'+
        '<span class="syn-tl-dur">00:00</span>'+
      '</div>'+
      '<button type="button" class="syn-tl-loop" title="Loop">⟳ LOOP</button>';
    ['pause','cur','track','fill','head','dur','loop'].forEach(function(k){ els[k]=tr.querySelector('.syn-tl-'+k); });
    var main=document.getElementById('main');
    var bb=document.getElementById('bottombar');
    if(main&&main.parentNode) main.parentNode.insertBefore(tr, main.nextSibling);
    else if(bb&&bb.parentNode) bb.parentNode.insertBefore(tr, bb);
    else document.body.appendChild(tr);

    els.pause.addEventListener('click', function(){ if(curVideo()&&A.togglePlay){ try{A.togglePlay();}catch(e){} } setTimeout(updateTransport,30); this.blur(); });
    els.loop.addEventListener('click', function(){ if(curVideo()&&A.toggleLoop){ try{A.toggleLoop();}catch(e){} } setTimeout(updateTransport,30); this.blur(); });
    function scrubTo(e){
      var v=curVideo(); if(!v||!v.duration||!isFinite(v.duration)) return;
      var r=els.track.getBoundingClientRect();
      var pct=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      try{ v.currentTime=pct*v.duration; }catch(err){}
      els.fill.style.width=(pct*100)+'%';
      els.head.style.left=(pct*100)+'%';
      els.cur.textContent=fmtTC(pct*v.duration);
    }
    els.track.addEventListener('mousedown', function(e){ scrubbing=true; scrubTo(e); e.preventDefault(); });
    window.addEventListener('mousemove', function(e){ if(scrubbing&&!(e.buttons&1)){ scrubbing=false; return; } if(scrubbing) scrubTo(e); }); /* button released outside the iframe: stop scrubbing */
    window.addEventListener('mouseup', function(){ scrubbing=false; });
  }
  function setShown(on){
    if(on===shown) return;
    shown=on;
    tr.classList.toggle('visible', on);
    /* the bar takes / gives back 36px under the video: let the effect re-fit its frame */
    try{ window.dispatchEvent(new Event('resize')); }catch(e){}
  }
  function updateTransport(){
    if(!tr) return;
    var v=curVideo();
    var ok=!!(v && v.duration && isFinite(v.duration) && v.duration>0);
    setShown(ok);
    if(!ok) return;
    var paused=v.paused||v.ended;
    var lbl=paused?'▶ PLAY':'▮▮ PAUSE';
    if(els.pause.textContent!==lbl) els.pause.textContent=lbl;
    els.pause.classList.toggle('paused', paused);
    var loop=false; try{ loop=A.isLoop?!!A.isLoop():!!v.loop; }catch(e){}
    els.loop.classList.toggle('on', loop);
    if(!scrubbing){
      var pct=(v.currentTime/v.duration)*100;
      els.fill.style.width=pct+'%';
      els.head.style.left=pct+'%';
      els.cur.textContent=fmtTC(v.currentTime);
    }
    els.dur.textContent=fmtTC(v.duration);
  }
  function fpsZero(){
    if(!A||!A.hasSource) return;
    var has=true; try{ has=!!A.hasSource(); }catch(e){}
    if(has) return;
    ['fps-val','ic-fps'].forEach(function(id){ var el=document.getElementById(id); if(el&&el.textContent!=='0') el.textContent='0'; });
  }

  function attach(adapter){
    A=adapter||null;
    if(A&&A.video){ addStyle(); buildTransport(); updateTransport(); }
    fpsZero();
  }

  function start(){
    addStyle();
    buildTimer();
    tickTimer();
    setInterval(function(){ tickTimer(); updateTransport(); fpsZero(); }, 250);
    document.addEventListener('visibilitychange', saveNow);
    window.addEventListener('pagehide', saveNow);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.SynExtras={ attach:attach, workMs:function(){ return workMs; }, isWorking:isWorking };
})();
