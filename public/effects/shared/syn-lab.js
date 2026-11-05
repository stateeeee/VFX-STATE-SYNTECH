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
   Only rendering is gated: media elements and audio keep playing. Timers
   (setInterval / setTimeout) and requestVideoFrameCallback are NOT gated.
   state().budget reports the current budget.

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
  var gateSeq=0, held=[], heldById={}, pumpId=0, lastFire=-1e9;
  function reportErr(e){
    try{ if(typeof window.reportError==='function') window.reportError(e); else setTimeout(function(){ throw e; }); }catch(_){}
  }
  function schedulePump(){
    if(!pumpId && budget!==0 && held.length) pumpId=gate.raf.call(window,pump);
  }
  function pump(t){
    pumpId=0;
    if(budget===0 || !held.length) return;              /* paused: everything stays held */
    if(budget>0){
      var iv=1000/budget, el=t-lastFire;
      if(el<iv-2){ schedulePump(); return; }             /* 2 ms slack: 120 Hz → every 4th frame at 30 */
      lastFire = el>iv*2 ? t : lastFire+iv;
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
    budget=b; lastFire=-1e9;
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
    setFrameBudget:setFrameBudget
  };
  window.SynLab=api;
})();
