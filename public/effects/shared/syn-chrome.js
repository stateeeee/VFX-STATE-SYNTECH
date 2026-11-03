/* ═══════════════════════════════════════════════════════════════════════
   SYNTECH-UNIFORM — DAY MODE bridge (operator request B1, 2026-10-28).
   The shell's sun/moon toggle puts data-syn-theme="day"|"night" on the effect's
   <iframe> and posts {type:'syn:theme', payload:{mode}} to it. This mirrors that
   on <html data-syn-theme> (+ data-syn-fx = the effect id, so day CSS can be
   scoped per effect): read from window.frameElement at boot, followed through a
   MutationObserver on the attribute and through the message. Standalone (no
   frameElement) → night, exactly the original look. The same snippet sits in
   syn-chrome.js AND syn-extras.js (BOKEH loads only the latter); it runs once.
   Every day rule lives in ../shared/syn-chrome.css under html[data-syn-theme="day"];
   a page that does not link that sheet (BOKEH) gets it injected while day is on.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  if(window.SynTheme) return;
  var root=document.documentElement;
  var src=''; try{ src=(document.currentScript&&document.currentScript.src)||''; }catch(e){}
  var fx=/\/effects\/([^\/]+)\//.exec(location.pathname);
  if(fx) root.setAttribute('data-syn-fx', fx[1]);
  function frameEl(){ try{ return window.frameElement||null; }catch(e){ return null; } }
  function norm(v){ return v==='day'?'day':'night'; }
  /* pages that do not link syn-chrome.css themselves (BOKEH): load it only for day,
     remove it for night, so BOKEH's night look stays byte-for-byte what it was */
  function sheet(mode){
    try{
      if(document.querySelector('link[rel="stylesheet"][href*="syn-chrome.css"]:not(#syn-theme-css)')) return;
      var l=document.getElementById('syn-theme-css');
      if(mode==='day' && !l && src){
        l=document.createElement('link'); l.id='syn-theme-css'; l.rel='stylesheet';
        l.href=src.replace(/[^\/]*$/,'syn-chrome.css').split('?')[0];
        (document.head||root).appendChild(l);
      }else if(mode!=='day' && l){ l.parentNode.removeChild(l); }
    }catch(e){}
  }
  function apply(v){
    var mode=norm(v);
    if(root.getAttribute('data-syn-theme')!==mode) root.setAttribute('data-syn-theme', mode);
    sheet(mode);
  }
  var fe=frameEl();
  apply(fe?fe.getAttribute('data-syn-theme'):'night');
  if(fe){
    try{ new MutationObserver(function(){ apply(fe.getAttribute('data-syn-theme')); }).observe(fe,{attributes:true,attributeFilter:['data-syn-theme']}); }catch(e){}
  }
  window.addEventListener('message', function(ev){
    var d=ev.data;
    if(!d||typeof d!=='object'||d.type!=='syn:theme'||!d.payload) return;
    if(fe && ev.source!==window.parent) return;
    apply(d.payload.mode);
  });
  window.SynTheme={ mode:function(){ return root.getAttribute('data-syn-theme')||'night'; }, set:apply };
})();

/* ═══════════════════════════════════════════════════════════════════════
   SYNTECH-UNIFORM — section title + mark gradient sync, shared by every
   effect (operator request 2026-10-11: the small line before each section
   name must light up together with the name, as in BOKEH STATE).

   Copied from syncSectionTitleGradients() in public/effects/bokeh/index.html
   (🔒 LOCKED feature there): every .sec-title and .sec-mark runs the same
   iri-logo animation (see ../shared/syn-chrome.css); this aligns all their
   start times to one reference so the line and the text read as holes on
   the same colour-changing LED. Standalone-safe, no globals.
   ═══════════════════════════════════════════════════════════════════════ */
(function(){
  'use strict';
  function syncSectionTitleGradients(){
    try{
      var titles=document.querySelectorAll('.sec-title, .sec-mark');
      if(!titles.length)return;
      var refStart=null;
      titles.forEach(function(el){
        var anims=el.getAnimations ? el.getAnimations() : [];
        var a=anims.find(function(x){return x.animationName==='iri-logo';}) || anims[0];
        if(!a)return;
        if(refStart===null) refStart=a.startTime;
        else a.startTime=refStart;
      });
    }catch(e){ /* getAnimations() unsupported — default (unsynced) animation */ }
  }
  /* INPUT pill: green (.live) while a source is active, like Bokeh's. Each
     effect writes its own wording into the pill's last span (VIDEO, IMAGE,
     WEBCAM, LIVE…); NONE / empty means no source. */
  function watchInputPill(){
    var pill=document.querySelector('#topbar .pill:not(.engine):not(#pill-rec)');
    if(!pill)return;
    var spans=pill.querySelectorAll('span');
    var val=spans.length?spans[spans.length-1]:null;
    if(!val)return;
    function sync(){
      var t=(val.textContent||'').trim().toUpperCase();
      pill.classList.toggle('live', !!t && t!=='NONE' && t!=='NO INPUT' && t!=='--');
    }
    sync();
    try{ new MutationObserver(sync).observe(val,{childList:true,characterData:true,subtree:true}); }catch(e){}
  }
  function run(){ requestAnimationFrame(syncSectionTitleGradients); watchInputPill(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',run);
  else run();
})();
