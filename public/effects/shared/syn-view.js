/* ═══════════════════════════════════════════════════════════════════════
   syn-view.js — window.SynView: the LIVE PREVIEW quality layer shared by the ten
   effects (docs/workflow/12-PREVIEW-QUALITY.md, 03-SPEC-SHELL §5.4).

   Operator, 2026-11-26: "il mio video, oltre a perdere di qualità visiva
   sgranandosi, va anche a scatti … come Premiere: carico un video, lo modifico,
   non deve perdere di qualità, non deve perdere FPS."  The export is already
   native (syn-export.js); this file is about what the operator SEES while working.

   SynView.size(srcW, srcH, boxW, boxH) → {w, h}
       The backing size of a preview canvas: the source's aspect fitted (contain)
       into the CSS box boxW × boxH, times devicePixelRatio — the pixels the screen
       really shows — and never above the source. That is Premiere's "Auto"
       playback resolution: a 1080p clip on a Retina screen draws at 1920×1080
       (was 1280 in ANAMORPHIC), a 4K clip in a 2500-px-wide frame draws at
       2500×1406 (was 1920×1080 in ANALOG / BOKEH / QUADTREE / TIME MACHINE), a
       4K clip fullscreen on a 5K display draws at 3840×2160. Exactly the source
       size when it is the smaller one, else even integers (H.264 live REC), ≥ 2.
       A box of 0 × 0 (not laid out yet) → the source size.
   SynView.fit(w, h, gl) → {w, h}
       Shrinks w × h proportionally ONLY if this GPU cannot draw it
       (MAX_TEXTURE_SIZE / MAX_RENDERBUFFER_SIZE / MAX_VIEWPORT_DIMS); else unchanged.
   SynView.watch(el, cb) → stop()
       cb() (trailing, 150 ms) when el's CSS box changes (ResizeObserver), the
       window resizes, or devicePixelRatio changes (window dragged to another
       screen, browser zoom). Also fires once shortly after it is installed.
   SynView.frames(getVideo) → gate      — upload a video frame only when it is NEW
       getVideo() returns the element the effect uploads from right now (or null
       when the source is not a <video>: image, canvas, none). Each tick:
         if (gate.fresh()) gl.texImage2D(…, video)
       fresh() is true when: the source is not a <video>; requestVideoFrameCallback
       does not exist; an export / SynFx drives the draw (window.__synExpCtl or
       window.__synPrevBypass); the element, its src or its srcObject changed; a
       new frame was presented since the last true (rVFC); seeked / loadeddata /
       resize / emptied / playing happened in the last 200 ms; or the video plays
       and rVFC has been silent for 250 ms (a browser that does not deliver it for
       this element: the old every-tick upload, never a frozen picture).
       A paused video is uploaded once, then not again until it changes.
         gate.force()  the next fresh() is true (the effect re-created its texture)
         gate.fps()    the playing video's frame rate measured from rVFC mediaTime
                       (0 = unknown); used by capRefresh.
   SynView.capRefresh([fpsFn])
       On a display faster than ~75 Hz (120 Hz ProMotion, 144 Hz) the page's
       requestAnimationFrame callbacks fire at max(60, video fps) Hz instead of
       120/144: every video frame is still drawn, the GPU does half the work, and
       the per-drawn-frame temporal looks (feedback, trails, datamosh) run at the
       ≈60 Hz the offline export reproduces (syn-export.js k = round(60/fps)).
       On a 60 Hz display it is a pure pass-through (measured continuously from
       the real vsync interval, so moving the window between screens is followed).
       fpsFn() → fps of the source; default = the highest gate.fps() of this page.
       Idempotent. It sits UNDER SynLab's frame-budget gate (syn-lab.js installs
       its gate lazily over whatever window.requestAnimationFrame is then) and is a
       pass-through while a Lab budget is set (window.__synLabBudget != null): the
       Lab gate then paces every node on shared time slots.

   Loaded by each effect's delimited SYNTECH-PREVIEW block; standalone-safe,
   nothing runs until an effect calls it.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.SynView) return;

  function report(e){
    try{ if(typeof window.reportError==='function') window.reportError(e); else setTimeout(function(){ throw e; }); }catch(_){}
  }
  function dpr(){ var d=Number(window.devicePixelRatio)||1; return d>0&&isFinite(d)?d:1; }
  function even(v){ v=Math.max(2,Math.round(v)); return (v&1)?v-1:v; }

  /* ── preview resolution ─────────────────────────────────────────────── */
  function size(sw,sh,bw,bh){
    sw=Number(sw)||0; sh=Number(sh)||0; bw=Number(bw)||0; bh=Number(bh)||0;
    if(!(sw>0&&sh>0)) return {w:2,h:2};
    if(!(bw>0&&bh>0)) return {w:Math.round(sw),h:Math.round(sh)};
    var ar=sw/sh, d=dpr(), pw=bw*d, ph=bh*d, w, h;
    if(pw/ph>ar){ h=ph; w=h*ar; } else { w=pw; h=w/ar; }
    if(w>=sw-1||h>=sh-1) return {w:Math.round(sw),h:Math.round(sh)};  /* the screen shows more than the source: native */
    return {w:even(w),h:even(h)};
  }
  function fit(w,h,gl){
    w=Math.max(1,Math.round(w)); h=Math.max(1,Math.round(h));
    if(!gl) return {w:w,h:h};
    var mt=0, mr=0, vp=null;
    try{ mt=gl.getParameter(gl.MAX_TEXTURE_SIZE)||0; mr=gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)||0; vp=gl.getParameter(gl.MAX_VIEWPORT_DIMS); }catch(e){}
    var lim=[mt,mr,vp?vp[0]:0], limH=[mt,mr,vp?vp[1]:0], s=1;
    for(var i=0;i<3;i++){ if(lim[i]>0) s=Math.min(s,lim[i]/w); if(limH[i]>0) s=Math.min(s,limH[i]/h); }
    return s<1 ? {w:even(w*s),h:even(h*s)} : {w:w,h:h};
  }

  /* ── box watcher ────────────────────────────────────────────────────── */
  function watch(el,cb){
    var t=0, alive=true, ro=null, mq=null;
    function fire(){ clearTimeout(t); t=setTimeout(function(){ if(!alive) return; try{ cb(); }catch(e){ report(e); } },150); }
    function onDpr(){ arm(); fire(); }
    function arm(){
      if(mq){ try{ mq.removeEventListener('change',onDpr); }catch(e){} mq=null; }
      try{ mq=window.matchMedia('(resolution: '+dpr()+'dppx)'); mq.addEventListener('change',onDpr); }catch(e){ mq=null; }
    }
    if(el&&typeof window.ResizeObserver==='function'){ try{ ro=new ResizeObserver(fire); ro.observe(el); }catch(e){ ro=null; } }
    window.addEventListener('resize',fire);
    arm(); fire();
    return function stop(){
      alive=false; clearTimeout(t);
      if(ro) try{ ro.disconnect(); }catch(e){}
      window.removeEventListener('resize',fire);
      if(mq) try{ mq.removeEventListener('change',onDpr); }catch(e){}
    };
  }

  /* ── new-frame gate ─────────────────────────────────────────────────── */
  var HAS_RVFC=typeof HTMLVideoElement!=='undefined'&&'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  var gates=[];
  function numAsc(a,b){ return a-b; }
  function frames(getVideo){
    var cur=null, curSrc=null, dirty=true, eventUntil=0, lastCb=0, forced=false;
    var lastMT=-1, lastPF=-1, deltas=[], est=0, nSamp=0, scratch=[];
    var hooked=typeof WeakSet==='function'?new WeakSet():null, hookedList=[];
    function isHooked(v){ return hooked?hooked.has(v):hookedList.indexOf(v)>=0; }
    function srcKey(v){ return v.srcObject||v.currentSrc||v.src||null; }
    function measure(meta){
      if(!meta) return;
      var pf=meta.presentedFrames, mt=meta.mediaTime;
      if(typeof pf==='number'&&typeof mt==='number'){
        if(pf===lastPF+1&&mt>lastMT){                     /* consecutive frames only (skips / seeks: no sample) */
          var d=mt-lastMT;
          if(d>0.002&&d<0.25){
            deltas.push(d); if(deltas.length>24) deltas.shift();
            if(deltas.length>=6&&(++nSamp%12===0||est===0)){  /* median refreshed every 12 frames, not per callback */
              for(var i=0;i<deltas.length;i++) scratch[i]=deltas[i];
              scratch.length=deltas.length; scratch.sort(numAsc); est=1/scratch[scratch.length>>1];
            }
          }
        }
        lastPF=pf; lastMT=mt;
      }
    }
    function hook(v){
      if(isHooked(v)) return;
      if(hooked) hooked.add(v); else hookedList.push(v);
      ['seeked','loadeddata','resize','emptied','playing'].forEach(function(ev){
        v.addEventListener(ev,function(){ if(v===cur){ dirty=true; eventUntil=performance.now()+200; if(ev!=='playing'){ deltas=[]; lastPF=-1; } } });
      });
      if(HAS_RVFC){
        var cb=function(now,meta){
          if(v===cur){ dirty=true; lastCb=performance.now(); measure(meta); }
          try{ v.requestVideoFrameCallback(cb); }catch(e){}
        };
        try{ v.requestVideoFrameCallback(cb); }catch(e){}
      }
    }
    var gate={
      fresh:function(){
        if(window.__synExpCtl||window.__synPrevBypass) return true;
        var v=null; try{ v=getVideo(); }catch(e){ v=null; }
        if(!v||!HAS_RVFC||typeof HTMLVideoElement==='undefined'||!(v instanceof HTMLVideoElement)){ cur=null; return true; }
        hook(v);
        var now=performance.now(), k=srcKey(v);
        if(v!==cur||k!==curSrc){
          cur=v; curSrc=k; dirty=false; forced=false; lastCb=now; eventUntil=now+200;
          deltas=[]; lastPF=-1; est=0;
          return true;
        }
        if(forced){ forced=false; dirty=false; return true; }
        if(dirty){ dirty=false; return true; }
        if(now<eventUntil) return true;
        if(!v.paused&&!v.ended&&now-lastCb>250) return true;        /* rVFC silent while playing: as before */
        return false;
      },
      force:function(){ forced=true; },
      fps:function(){ return (cur&&!cur.paused&&est>0)?est:0; }
    };
    gates.push(gate);
    return gate;
  }

  /* ── refresh cap (120 / 144 Hz displays) ────────────────────────────── */
  var capOn=false;
  function capRefresh(fpsFn){
    if(capOn) return; capOn=true;
    var nraf=window.requestAnimationFrame, ncaf=window.cancelAnimationFrame;
    var q=[], byId={}, seq=0, ID0=0x20000000, pumpId=0, lastFire=-1e9, lastT=-1, vs=16.7;
    function srcFps(){
      var f=0;
      try{
        if(typeof fpsFn==='function') f=Number(fpsFn())||0;
        else for(var i=0;i<gates.length;i++){ var g=gates[i].fps(); if(g>f) f=g; }
      }catch(e){ f=0; }
      return (f>0&&f<=480)?f:0;
    }
    function pump(t){
      pumpId=0;
      if(lastT>0){ var d=t-lastT; if(d>2&&d<40) vs=vs*0.85+d*0.15; }
      lastT=t;
      if(!q.length) return;
      /* a Lab frame budget (syn-lab.js, window.__synLabBudget) rate-limits this iframe on time slots shared by
         every node: the cap must not add its own per-iframe phase underneath (nodes on alternate vsyncs) */
      var lb=window.__synLabBudget;
      if(vs<13.3&&lb==null){                                 /* faster than ~75 Hz, no Lab budget */
        /* fire every n-th vsync, n whole: 120 Hz → 60, 144 → 72, 240 → 60; 90 / 100 Hz → n = 1
           (60 would be an uneven 1-2 cadence there, worse than drawing every vsync) */
        var n=Math.max(1,Math.floor((1000/vs)/Math.max(60,srcFps())+0.15));
        if(n>1&&t-lastFire<n*vs-vs*0.5){ pumpId=nraf.call(window,pump); return; }
      }
      lastFire=t;
      var list=q; q=[];                                      /* re-requests go to a later pump */
      for(var i=0;i<list.length;i++){
        var e=list[i];
        if(byId[e.id]!==e) continue;                         /* cancelled */
        delete byId[e.id];
        try{ e.cb(t); }catch(err){ report(err); }
      }
      if(q.length&&!pumpId) pumpId=nraf.call(window,pump);
    }
    window.requestAnimationFrame=function(cb){
      var e={id:ID0+(++seq),cb:cb};
      q.push(e); byId[e.id]=e;
      if(!pumpId) pumpId=nraf.call(window,pump);
      return e.id;
    };
    window.cancelAnimationFrame=function(id){
      var e=byId[id];
      if(e){ delete byId[id]; var i=q.indexOf(e); if(i>=0) q.splice(i,1); return; }
      return ncaf.call(window,id);
    };
  }

  window.SynView={size:size, fit:fit, watch:watch, frames:frames, capRefresh:capRefresh, dpr:dpr};
})();
