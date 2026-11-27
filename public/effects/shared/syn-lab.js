/* ═══════════════════════════════════════════════════════════════════════
   SYNTECH-LAB — the Lab chain link, shared by all ten effects.
   Operator decision 2026-10-28 ("option 1"): every Lab node IS this very
   effect in an iframe, with its whole interface. The shell chains them:
       INPUT → effect 1 → effect 2 → … → OUTPUT
   each hop = canvas.captureStream() of one effect fed to the next one as an
   EXTERNAL STREAM (a video source that is not the webcam: no mirror).

   This file is the generic half. Each effect registers its own adapter
   (in its delimited SYNTECH-LAB block, right after SYNTECH-BRIDGE):

     SynLab.register({
       setVideoStream(stream|null),   // required — external video source
       setAudioStream(stream|null),   // required — external audio for reactivity
       outputCanvas(),                // required — the canvas with the final picture
       // optional:
       params(),                      // → extra SynLabParam[] (knobs, LEDs, segments…)
       setParam(key, value),          // → true when it handled `key`
       excludeKey(key, el),           // → true to hide a control from params()
       state(),                       // → {hasSource, external, fps}
       locked: ['key', …],            // keys Gemini must never change
       // optional, added 2026-10-28 (bridge-a) — all backward compatible:
       labelOf(el),                   // → better label for a generic control (falsy = generic)
       controls(),                    // → control descriptors built with SynLab.kit
                                      //   (get/set live: no params()/setParam() code needed)
       applySettings(s, bridgeApply), // → wraps the bridge's apply (bridgeApply(s) = the default)
     });

   Frame budget (added 2026-11-05, shell-controlled — the Lab lag fix):
     SynLab.setFrameBudget(fps)   null/undefined = native (the default: standalone
                                  never calls it), 0 = paused, > 0 = cap at fps.
   Implemented by a gate over window.requestAnimationFrame / cancelAnimationFrame
   in this iframe, installed only by the shell's first outputCanvas() /
   captureStream() / non-native setFrameBudget() call (in native mode it is a
   pure pass-through). Under a cap, queued callbacks fire together, in request
   order, with the real frame timestamp, once the interval has elapsed; paused,
   they are HELD (never dropped) and fire when the budget is raised;
   cancelAnimationFrame cancels a held one. The compositor below follows it.
   2026-11-26: the cap fires on ABSOLUTE time slots, slot = floor((performance.timeOrigin + t) /
   (1000 / budget)), the same in every iframe (same origin = same vsync clock): a callback batch fires
   when the slot differs from the last fired one. Every node at the same budget therefore draws in the
   same vsync, so node N+1 always sees node N's previous-slot frame (no phase beat between nodes), and a
   24 fps source gets a regular 24-slot grid. A slot boundary within ~1 ms of a vsync is snapped to the
   later vsync so it never double-fires. The shell sets the budget to the SOURCE's frame rate. While a
   budget is set, window.__synLabBudget mirrors it and SynView.capRefresh (syn-view.js, 120/144 Hz cap)
   steps aside, so no per-iframe vsync parity sits under the shared slots.
   Only rendering is gated: media elements and audio keep playing. Timers
   (setInterval / setTimeout) and requestVideoFrameCallback are NOT gated.
   state().budget reports the current budget.

   Layout (added 2026-11-19, LAB v3 — the Lab shows each node as its PANEL only):
     SynLab.setLayout('panel', {width, height})   the effect shows only its #panel, at the
                                  iframe's full width and its natural height; its own Source
                                  section is hidden (the Lab's SOURCE feeds the chain); the top
                                  bar, the canvas area and the effect's own timeline leave the
                                  viewport but stay laid out, the canvas area at width × height
                                  CSS px (it keeps rendering at that size — never 0×0).
     SynLab.setLayout('standalone')   back to the effect as it was (the default).
     SynLab.layout()          → {mode, width, height}
     SynLab.panelHeight()     → the panel's height in px (0 outside panel mode)
   A page loaded with ?synlayout=panel starts in panel mode before its first paint. In panel
   mode a panel resize is posted to the parent as {type:'syn:lab-panel', payload:{id, h}}.
   Nothing here touches the effect's markup or code: one <style> + attributes on <html>.

   SynLab.kit (helpers for adapters, optional):
     kit.led(key, el|id, {label, group, onClass, get, set})       → boolean descriptor (click toggles)
     kit.seg(key, buttons|selector|fn, {label, group, options})    → enum descriptor (click option i)
     kit.knobs(setKnob, {labelOf, root})                           → number descriptors 'knob:<data-id>'
     kit.number(key, {label, group, el, min, max, step, get, set}) → number descriptor
     kit.ownText(el)                  → the element's own text (child text nodes only)
     kit.rowLabel(el, selectors)      → first matching label inside the control's row
     kit.compositor({layers, size})   → {canvas, touch()} — a 2D canvas redrawn each frame
                                        from a stack of canvases, ONLY while its capture
                                        stream is live (or touch() was called < 3 s ago)
   Descriptor = {key, label, group, type, min, max, step, options?, el?, get(), set(v)}.

   The shell reads window.SynLab synchronously (same origin). Nothing here
   runs unless the shell calls it: opened alone, the effect is unchanged.
   Contract: SynLabApi in docs/workflow/02-ARCHITECTURE.md (LAB v2).
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.SynLab) return;

  var m=/\/effects\/([^\/]+)\//.exec(location.pathname);
  var FX_ID=m?m[1]:'effect';
  var A=null;               /* the effect's adapter */
  var streamCache=null, streamCanvas=null;

  /* ── frame budget: a gate over this window's requestAnimationFrame ──── */
  var budget=null;          /* null = native, 0 = paused, > 0 = fps cap */
  var gate=null;            /* {raf, caf}: what window.requestAnimationFrame was when installed */
  var GATE_ID0=0x40000000;  /* gate ids never collide with the browser's (small) native ids */
  var gateSeq=0, held=[], heldById={}, pumpId=0, lastSlot=-1, lastPumpT=-1e9, vsync=0;
  function reportErr(e){
    try{ if(typeof window.reportError==='function') window.reportError(e); else setTimeout(function(){ throw e; }); }catch(_){}
  }
  function schedulePump(){
    if(!pumpId && budget!==0 && held.length) pumpId=gate.raf.call(window,pump);
  }
  /* The slot of this vsync. Each iframe's performance.timeOrigin is only known to ~0.1-6 ms, so two
     iframes could put the SAME vsync on different sides of a slot boundary. The first iframe to pump in a
     vsync (|Δt| < 3 ms) publishes its slot on the shell window (same origin) and the others reuse it. */
  /* Only numbers are stored on the shell window (no object of this iframe's realm, so a removed / reloaded
     iframe is never kept alive by the shell, and nothing is allocated per vsync). The "same vsync" window is
     half the display interval (3–7 ms). */
  function slotOf(t,iv){
    var ta=performance.timeOrigin+t, slot=Math.floor((ta+1)/iv), sh=null;
    try{ sh=window.top; }catch(_){ sh=null; }
    if(!sh) return slot;
    try{
      var thr=vsync>0 ? Math.max(3,Math.min(7,vsync*0.5)) : 3;
      if(Math.abs(ta-sh.__synLabClockTa)<thr){
        if(sh.__synLabClockIv===iv) return sh.__synLabClockSlot;        /* another node pumped this vsync first */
      } else { sh.__synLabClockTa=ta; sh.__synLabClockIv=iv; sh.__synLabClockSlot=slot; }
    }catch(_){}
    return slot;
  }
  /* the display's frame interval: median of the last 15 pump intervals (a single short or long outlier,
     or a move to a screen with another refresh rate, cannot latch it) */
  var dts=[], dtScratch=[], dtN=0;
  function dtAsc(a,b){ return a-b; }
  function noteDt(dt){
    if(!(dt>2&&dt<40)) return;
    dts[dtN%15]=dt; dtN++;
    if(dtN<15){ if(!vsync) vsync=dt; return; }
    if(dtN%5===0){ for(var i=0;i<15;i++) dtScratch[i]=dts[i]; dtScratch.length=15; dtScratch.sort(dtAsc); vsync=dtScratch[7]; }
  }
  function pump(t){
    pumpId=0;
    if(budget===0 || !held.length) return;              /* paused: everything stays held */
    if(budget>0){
      var iv=1000/budget;
      /* absolute slot of this vsync; +1 ms: a boundary that falls just after a vsync belongs to it,
         so the next vsync (one frame later) cannot fire the same logical slot again */
      var slot=slotOf(t,iv);
      noteDt(t-lastPumpT); lastPumpT=t;
      /* budget ≈ the display rate: fire on every vsync (a slot grid there would drop frames to jitter) */
      if(!(vsync && iv<=vsync*1.08)){
        if(slot===lastSlot){ schedulePump(); return; }
      }
      lastSlot=slot;
    }
    var q=held; held=[];                                 /* re-requests during this pump go to the next one */
    for(var i=0;i<q.length;i++){
      var e=q[i];
      if(heldById[e.id]!==e) continue;                   /* cancelled */
      delete heldById[e.id];
      try{ e.cb(t); }catch(err){ reportErr(err); }      /* like native: one throwing callback does not stop the rest */
    }
    schedulePump();
  }
  /* Installed once, never removed. The adapters of POINTCLOUD / PAINTING wrap
     window.requestAnimationFrame inside their outputCanvas() (to copy the WebGL
     canvas right after the engine draws): the gate is installed BEFORE that
     (api.outputCanvas), so their wrappers sit on top of it and their copy runs
     in the same gated callback. Load-time wrappers (BOKEH's motion sampler,
     PAINTING's PAINT-off throttle) sit under it and keep working. */
  function installGate(){
    if(gate) return;
    gate={raf:window.requestAnimationFrame, caf:window.cancelAnimationFrame};
    window.requestAnimationFrame=function(cb){
      if(budget==null) return gate.raf.call(window,cb); /* native: pure pass-through */
      var e={id:GATE_ID0+(++gateSeq), cb:cb};
      held.push(e); heldById[e.id]=e;
      schedulePump();
      return e.id;
    };
    window.cancelAnimationFrame=function(id){
      var e=heldById[id];
      if(e){ delete heldById[id]; var i=held.indexOf(e); if(i>=0) held.splice(i,1); return; }
      return gate.caf.call(window,id);
    };
  }
  function setFrameBudget(fps){
    var b=null;
    if(fps!=null){ b=Number(fps); b=isFinite(b) ? Math.max(0,b) : null; }
    if(b===budget) return;
    if(b!==null) installGate();
    budget=b; lastSlot=-1; vsync=0; dtN=0;
    try{ window.__synLabBudget=b; }catch(_){}           /* SynView.capRefresh is a pass-through while a budget is set */
    if(gate) schedulePump();                             /* raised / native again: held callbacks resume */
  }

  /* ── generic panel scan ────────────────────────────────────────────── */
  /* The panel section a control lives in: the .sec-title of the .sec-head
     right before its .sec-body (Bokeh's chrome, shared by all ten). */
  function groupOf(el){
    var body=el&&el.closest ? el.closest('.sec-body') : null;
    if(!body) return 'Parameters';
    var head=body.previousElementSibling;
    while(head && !(head.classList && head.classList.contains('sec-head'))) head=head.previousElementSibling;
    var t=head ? head.querySelector('.sec-title') : null;
    return t ? (t.textContent||'').trim() : 'Parameters';
  }
  function clean(s){ return String(s||'').replace(/\s+/g,' ').trim(); }
  /* The visible label of a control: a <label for=id>, else the first
     label-ish text in its row (the element that holds the control and some
     text of its own), else the id. */
  function labelOfGeneric(el){
    try{
      if(el.id){
        var lf=document.querySelector('label[for="'+el.id+'"]');
        if(lf && clean(lf.textContent)) return clean(lf.textContent).slice(0,60);
      }
      var row=el.parentElement, hops=0;
      while(row && hops<4){
        var lab=row.querySelector('.ctrl-label, .ctrl-name, .lbl, .label, label, .name, .k-label, .knob-label');
        if(lab && !lab.contains(el) && clean(lab.textContent)) return clean(lab.textContent).slice(0,60);
        if(row.classList && row.classList.contains('sec-body')) break;
        row=row.parentElement; hops++;
      }
    }catch(e){}
    return el.id||'control';
  }
  function labelOf(el){
    if(A&&A.labelOf){ try{ var s=A.labelOf(el); if(s) return clean(s).slice(0,60); }catch(e){} }
    return labelOfGeneric(el);
  }
  function visibleInPanel(el){
    /* source / export / info controls are not the look: never offered */
    var g=groupOf(el).toLowerCase();
    return !/^(source|export|info|camera|record)/.test(g);
  }
  function num(v,d){ v=parseFloat(v); return isFinite(v)?v:d; }

  /* ── kit: descriptors for controls the generic scan cannot see ─────── */
  function byId(x){ return typeof x==='string' ? document.getElementById(x) : x; }
  function ownText(el){
    if(!el) return '';
    var s='';
    for(var n=el.firstChild;n;n=n.nextSibling) if(n.nodeType===3) s+=n.nodeValue;
    return clean(s);
  }
  function rowLabel(el,selectors,stopAt){
    var row=el?el.parentElement:null, hops=0;
    while(row && hops<5){
      if(row.classList && row.classList.contains(stopAt||'sec-body')) break;
      var lab=row.querySelector(selectors);
      if(lab && !lab.contains(el) && clean(lab.textContent)) return clean(lab.textContent);
      row=row.parentElement; hops++;
    }
    return '';
  }
  function resolveList(b){
    if(typeof b==='function'){ try{ b=b(); }catch(e){ b=[]; } }
    if(typeof b==='string') b=document.querySelectorAll(b);
    return Array.prototype.slice.call(b||[]).filter(Boolean);
  }
  var kit={
    clean:clean, ownText:ownText, rowLabel:rowLabel, groupOf:groupOf, labelOf:labelOfGeneric,
    led:function(key,el,o){
      o=o||{}; var node=byId(el); if(!node) return null;
      var onClass=o.onClass||'on';
      var get=o.get||function(){ return node.classList.contains(onClass)?1:0; };
      return {key:key,el:node,type:'boolean',min:0,max:1,step:1,
        label:o.label||clean(node.textContent),group:o.group||groupOf(node),
        get:get,
        set:o.set||function(v){ var on=!!Number(v); if((get()>0)!==on) node.click(); return true; }};
    },
    seg:function(key,buttons,o){
      o=o||{}; var btns=resolveList(buttons); if(!btns.length) return null;
      var onClass=o.onClass||'on';
      var opts=o.options||btns.map(function(b){ return clean(b.textContent); });
      return {key:key,el:btns[0],type:'enum',min:0,max:btns.length-1,step:1,options:opts,
        label:o.label||groupOf(btns[0]),group:o.group||groupOf(btns[0]),
        get:o.get||function(){ for(var i=0;i<btns.length;i++) if(btns[i].classList.contains(onClass)) return i; return 0; },
        set:o.set||function(v){
          var i=Math.round(Number(v)); if(!(i>=0&&i<btns.length)) return false;
          if(!btns[i].classList.contains(onClass)) btns[i].click();
          return true;
        }};
    },
    knobs:function(setKnob,o){
      o=o||{}; var root=o.root||document.getElementById('panel')||document;
      return resolveList(root.querySelectorAll('.knob[data-id]')).map(function(k){
        var min=num(k.dataset.min,0), max=num(k.dataset.max,1), dec=parseInt(k.dataset.dec||'2',10);
        var lab=(o.labelOf&&o.labelOf(k))||(function(){
          var g=k.closest('.knob-group'); var l=g&&g.querySelector('.knob-lbl,.knob-label'); return l?clean(l.textContent):k.dataset.id;
        })();
        return {key:'knob:'+k.dataset.id,el:k,type:'number',min:min,max:max,step:isFinite(dec)&&dec>=0?Math.pow(10,-dec):0,
          label:lab,group:groupOf(k),
          get:function(){ return num(k.dataset.val,min); },
          set:function(v){ v=Math.max(min,Math.min(max,Number(v))); setKnob(k,v); return true; }};
      });
    },
    number:function(key,o){
      o=o||{};
      return {key:key,el:o.el||null,type:'number',min:num(o.min,0),max:num(o.max,1),step:num(o.step,0),
        label:o.label||key,group:o.group||(o.el?groupOf(o.el):'Parameters'),
        get:o.get,
        set:function(v){ v=Math.max(num(o.min,0),Math.min(num(o.max,1),Number(v))); return o.set(v)!==false; }};
    },
    compositor:function(o){
      var cv=document.createElement('canvas'), ctx=cv.getContext('2d');
      cv.width=16; cv.height=9;
      var raf=0, lastTouch=0;
      function draw(){
        /* paused (frame budget 0): no copy either — PAINTING's PAINT-off loop calls draw() from the
           native rAF it saved at load (outside the gate); this keeps that loop at ~zero cost */
        if(budget===0) return;
        var s=null; try{ s=o.size(); }catch(e){}
        if(s && s.w>0 && s.h>0){ if(cv.width!==s.w) cv.width=s.w; if(cv.height!==s.h) cv.height=s.h; }
        ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
        ctx.fillStyle='#000'; ctx.fillRect(0,0,cv.width,cv.height);
        var layers=[]; try{ layers=o.layers()||[]; }catch(e){}
        for(var i=0;i<layers.length;i++){ try{ ctx.drawImage(layers[i],0,0,cv.width,cv.height); }catch(e){} }
      }
      /* re-queued at the END of the callback: it stays after the effect's own
         render loops in the frame's rAF list, so it reads what they just drew
         (WebGL canvases without preserveDrawingBuffer included) */
      function frame(){
        raf=0;
        if(!api.capturing() && performance.now()-lastTouch>3000) return; /* nobody watches: zero cost */
        draw();
        raf=requestAnimationFrame(frame);
      }
      return {canvas:cv, draw:draw,
        touch:function(){ lastTouch=performance.now(); if(!raf){ draw(); raf=requestAnimationFrame(frame); } return cv; }};
    }
  };

  function controlList(){
    if(!A||!A.controls) return [];
    var list=[]; try{ list=(typeof A.controls==='function'?A.controls():A.controls)||[]; }catch(e){ list=[]; }
    return list.filter(function(d){ return d&&d.key&&typeof d.get==='function'&&typeof d.set==='function'; });
  }
  function describe(d){
    var v=0; try{ v=Number(d.get()); }catch(e){}
    var p={key:d.key,label:clean(d.label||d.key).slice(0,60),group:d.group||(d.el?groupOf(d.el):'Parameters'),
      type:d.type||'number',min:num(d.min,0),max:num(d.max,1),step:num(d.step,0),value:isFinite(v)?v:0};
    if(d.options) p.options=d.options.slice();
    return p;
  }

  function scanParams(){
    var out=[], seen={};
    function push(p,el){
      if(!p.key||seen[p.key]) return;
      if(A&&A.excludeKey){ try{ if(A.excludeKey(p.key,el)) return; }catch(e){} }
      seen[p.key]=1; out.push(p);
    }
    var root=document.getElementById('panel')||document.body;
    root.querySelectorAll('input[type="range"][id]').forEach(function(el){
      if(!visibleInPanel(el)) return;
      var min=num(el.min,0), max=num(el.max,100), step=num(el.step,1);
      push({key:el.id,label:labelOf(el),group:groupOf(el),type:'number',min:min,max:max,step:step>0?step:0,value:num(el.value,min)},el);
    });
    root.querySelectorAll('input[type="checkbox"][id]').forEach(function(el){
      if(!visibleInPanel(el)) return;
      push({key:el.id,label:labelOf(el),group:groupOf(el),type:'boolean',min:0,max:1,step:1,value:el.checked?1:0},el);
    });
    root.querySelectorAll('select[id]').forEach(function(el){
      if(!visibleInPanel(el)) return;
      var opts=[]; for(var i=0;i<el.options.length;i++) opts.push(clean(el.options[i].textContent));
      push({key:el.id,label:labelOf(el),group:groupOf(el),type:'enum',min:0,max:Math.max(0,opts.length-1),step:1,value:Math.max(0,el.selectedIndex),options:opts},el);
    });
    controlList().forEach(function(d){ push(describe(d),d.el||null); });
    if(A&&A.params){
      var extra=[]; try{ extra=A.params()||[]; }catch(e){}
      extra.forEach(function(p){ push(p,null); });
    }
    var locked=(A&&A.locked)||[];
    out.forEach(function(p){ if(locked.indexOf(p.key)>=0) p.locked=true; });
    return out;
  }

  function fire(el,type){ try{ el.dispatchEvent(new Event(type,{bubbles:true})); }catch(e){} }
  function setGeneric(key,value){
    var el=document.getElementById(key);
    if(!el) return false;
    if(el.tagName==='INPUT' && el.type==='range'){
      el.value=String(value); fire(el,'input'); fire(el,'change'); return true;
    }
    if(el.tagName==='INPUT' && el.type==='checkbox'){
      var on=!!Number(value);
      if(el.checked!==on){ el.click(); if(el.checked!==on){ el.checked=on; fire(el,'change'); } }
      return true;
    }
    if(el.tagName==='SELECT'){
      var i=Math.round(Number(value)); if(i<0||i>=el.options.length) return false;
      el.selectedIndex=i; fire(el,'input'); fire(el,'change'); return true;
    }
    return false;
  }

  /* ── layout: 'standalone' (the effect as it is) or 'panel' (LAB v3) ─── */
  var LAYOUT_CSS=
    'html[data-syn-layout="panel"],html[data-syn-layout="panel"] body{height:auto!important;min-height:0!important;max-height:none!important;overflow:hidden!important}'+
    'html[data-syn-layout="panel"] body{display:block!important;background:transparent!important}'+
    /* out of the viewport but laid out (never display:none: the effects read their sizes, and the
       canvas must keep rendering + feeding the chain) */
    'html[data-syn-layout="panel"] #topbar,html[data-syn-layout="panel"] #syn-transport,html[data-syn-layout="panel"] #transport,'+
    'html[data-syn-layout="panel"] #tl-bar,html[data-syn-layout="panel"] #tlb,html[data-syn-layout="panel"] #bottombar'+
      '{position:fixed!important;left:-40000px!important;top:0!important;width:1200px!important;pointer-events:none!important}'+
    'html[data-syn-layout="panel"] #main{display:block!important;height:auto!important;min-height:0!important;overflow:visible!important}'+
    'html[data-syn-layout="panel"] #canvas-area{position:fixed!important;left:-40000px!important;top:0!important;'+
      'width:var(--syn-lab-area-w,1280px)!important;height:var(--syn-lab-area-h,720px)!important;'+
      'min-width:0!important;max-width:none!important;flex:none!important;pointer-events:none!important}'+
    'html[data-syn-layout="panel"] #panel{width:100%!important;height:auto!important;min-height:0!important;max-height:none!important;'+
      'overflow:hidden!important;border-left:0!important}'+
    'html[data-syn-layout="panel"] [data-syn-lab-hidden]{display:none!important}';
  var layoutMode='standalone', areaW=1280, areaH=720, panelRO=null, lastPanelH=-1;
  function ensureLayoutStyle(){
    if(document.getElementById('syn-lab-layout')) return;
    var st=document.createElement('style');
    st.id='syn-lab-layout';
    st.textContent=LAYOUT_CSS;
    (document.head||document.documentElement).appendChild(st);
  }
  /* the effect's own Source section (the Lab's SOURCE replaces it): the .section whose
     .sec-title reads "Source" — the markup all ten share; a bare head + body pair as fallback */
  function hideSourceSection(){
    var panel=document.getElementById('panel'); if(!panel) return 0;
    var n=0;
    panel.querySelectorAll('.sec-title').forEach(function(t){
      if(!/^source$/i.test(clean(t.textContent))) return;
      var head=t.closest('.sec-head');
      var sec=t.closest('.section');
      if(sec && sec!==panel){ sec.setAttribute('data-syn-lab-hidden','source'); n++; return; }
      if(head){
        head.setAttribute('data-syn-lab-hidden','source');
        var body=head.nextElementSibling;
        if(body && body.classList.contains('sec-body')) body.setAttribute('data-syn-lab-hidden','source');
        n++;
      }
    });
    return n;
  }
  function panelHeight(){
    if(layoutMode!=='panel') return 0;
    var p=document.getElementById('panel');
    return p ? Math.ceil(p.getBoundingClientRect().height) : 0;
  }
  function postPanelHeight(){
    var h=panelHeight();
    if(h===lastPanelH) return;
    lastPanelH=h;
    try{ if(window.parent!==window) window.parent.postMessage({type:'syn:lab-panel',payload:{id:FX_ID,h:h}},'*'); }catch(e){}
  }
  function watchPanel(){
    var p=document.getElementById('panel');
    if(!p||panelRO||typeof ResizeObserver!=='function') return;
    panelRO=new ResizeObserver(postPanelHeight);
    panelRO.observe(p);
  }
  function setLayout(mode,opts){
    mode = mode==='panel' ? 'panel' : 'standalone';
    var root=document.documentElement;
    var w=opts&&Number(opts.width), h=opts&&Number(opts.height);
    var sized=false;
    if(w>0 && h>0){
      w=Math.round(w); h=Math.round(h);
      if(w!==areaW||h!==areaH){ areaW=w; areaH=h; sized=true; }
    }
    var changed = mode!==layoutMode;
    layoutMode=mode;
    if(mode==='panel'){
      ensureLayoutStyle();
      root.style.setProperty('--syn-lab-area-w',areaW+'px');
      root.style.setProperty('--syn-lab-area-h',areaH+'px');
      root.setAttribute('data-syn-layout','panel');
      hideSourceSection();
      watchPanel();
    }else{
      root.removeAttribute('data-syn-layout');
      root.style.removeProperty('--syn-lab-area-w');
      root.style.removeProperty('--syn-lab-area-h');
      var hid=document.querySelectorAll('[data-syn-lab-hidden]');
      for(var i=0;i<hid.length;i++) hid[i].removeAttribute('data-syn-lab-hidden');
    }
    /* the effects fit their frame on window resize (some on a ResizeObserver too) */
    if(changed||sized){ try{ window.dispatchEvent(new Event('resize')); }catch(e){} }
    lastPanelH=-1;
    if(mode==='panel') postPanelHeight();
    return {mode:layoutMode,width:areaW,height:areaH};
  }
  /* ?synlayout=panel: panel mode from the first paint (this file runs at the end of <body>) */
  try{
    if(/[?&]synlayout=panel(&|$)/.test(location.search)){
      setLayout('panel');
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',function(){ hideSourceSection(); watchPanel(); postPanelHeight(); });
    }
  }catch(e){}

  function liveFps(){
    var el=document.getElementById('fps-val');
    var v=el?parseFloat(el.textContent):0;
    return isFinite(v)?v:0;
  }

  /* ── the API ───────────────────────────────────────────────────────── */
  var api={
    version:1,
    id:FX_ID,
    ready:false,
    kit:kit,
    register:function(adapter){
      A=adapter||null;
      var go=function(){
        api.ready=!!A;
        try{ if(window.parent!==window) window.parent.postMessage({type:'syn:lab-ready',payload:{id:FX_ID}},'*'); }catch(e){}
      };
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',go);
      else go();
    },
    setVideoStream:function(stream){
      if(A&&A.setVideoStream){ try{ A.setVideoStream(stream||null); }catch(e){ try{ console.warn('[SynLab] setVideoStream',e); }catch(_){} } }
    },
    setAudioStream:function(stream){
      if(A&&A.setAudioStream){ try{ A.setAudioStream(stream||null); }catch(e){ try{ console.warn('[SynLab] setAudioStream',e); }catch(_){} } }
    },
    /* the gate goes in (pass-through) before the adapter's outputCanvas() may wrap rAF itself */
    outputCanvas:function(){ installGate(); try{ return A&&A.outputCanvas ? A.outputCanvas()||null : null; }catch(e){ return null; } },
    captureStream:function(){
      var c=api.outputCanvas();
      if(!c||typeof c.captureStream!=='function') return null;
      if(streamCache && streamCanvas===c){
        var live=streamCache.getVideoTracks().some(function(t){ return t.readyState==='live'; });
        if(live) return streamCache;
      }
      if(streamCache){ try{ streamCache.getTracks().forEach(function(t){ t.stop(); }); }catch(e){} }
      try{ streamCache=c.captureStream(); streamCanvas=c; }catch(e){ streamCache=null; streamCanvas=null; }
      return streamCache;
    },
    /* true while the stream handed out by captureStream() still has a live
       video track (a compositor keeps drawing only then) */
    capturing:function(){
      try{ return !!(streamCache && streamCache.getVideoTracks().some(function(t){ return t.readyState==='live'; })); }catch(e){ return false; }
    },
    params:function(){ try{ return scanParams(); }catch(e){ return []; } },
    setParam:function(key,value){
      if(typeof key!=='string'||!isFinite(Number(value))) return false;
      if(A&&A.setParam){ try{ if(A.setParam(key,Number(value))) return true; }catch(e){} }
      var ds=controlList();
      for(var i=0;i<ds.length;i++){
        if(ds[i].key!==key) continue;
        if(A&&A.excludeKey){ try{ if(A.excludeKey(key,ds[i].el||null)) return false; }catch(e){} }
        try{ return ds[i].set(Number(value))!==false; }catch(e){ return false; }
      }
      return setGeneric(key,Number(value));
    },
    getSettings:function(){ try{ return window.__synBridge ? window.__synBridge.collect() : null; }catch(e){ return null; } },
    applySettings:function(s){
      if(!s) return;
      var base=function(x){ if(window.__synBridge) window.__synBridge.apply(x); };
      try{ if(A&&A.applySettings) A.applySettings(s,base); else base(s); }catch(e){}
    },
    state:function(){
      var s=null;
      if(A&&A.state){ try{ s=A.state(); }catch(e){ s=null; } }
      if(!s) s={hasSource:false,external:false,fps:liveFps()};
      var out={}; for(var k in s) if(Object.prototype.hasOwnProperty.call(s,k)) out[k]=s[k];
      out.budget=budget;
      return out;
    },
    /* null = native (default), 0 = paused, > 0 = cap (fps) — see the header */
    setFrameBudget:setFrameBudget,
    /* 'panel' | 'standalone' (+ the canvas area's size in panel mode) — see the header */
    setLayout:setLayout,
    layout:function(){ return {mode:layoutMode,width:areaW,height:areaH}; },
    panelHeight:panelHeight
  };
  window.SynLab=api;
})();
