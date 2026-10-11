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
