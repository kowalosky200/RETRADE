/* RETRADE global motion coherence v1.4.47
 * Presentation-only layer loaded last.
 *
 * Goals:
 * - one calm easing language across page switches, panels, sheets and confirms
 * - FAB/search FAB fade in/out instead of visibility snapping
 * - keep motion short enough to feel responsive and respect reduced motion
 *
 * No accounting, sync, lifecycle, forecast maths or persisted data is touched.
 */
(function(){
  'use strict';

  var EASE='cubic-bezier(.22,.61,.36,1)';
  var FAST=180;
  var MED=260;

  function reducedMotion(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }

  function installStyles(){
    var old=document.getElementById('rt-global-motion-v1447');if(old)old.remove();
    var s=document.createElement('style');s.id='rt-global-motion-v1447';
    s.textContent='\
:root{--rt-motion-ease:'+EASE+';--rt-motion-fast:180ms;--rt-motion-med:260ms;}\
@keyframes rtPageEnterV1447{from{opacity:0;transform:translate3d(0,5px,0)}to{opacity:1;transform:translate3d(0,0,0)}}\
@keyframes rtSurfaceEnterV1447{from{opacity:0;transform:translate3d(0,6px,0)}to{opacity:1;transform:translate3d(0,0,0)}}\
@keyframes rtOverlayInV1447{from{opacity:0}to{opacity:1}}\
@keyframes rtConfirmInV1447{from{opacity:0;transform:translate3d(0,7px,0) scale(.985)}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}\
.page.on:not(.rt-boot-noanim){animation:rtPageEnterV1447 270ms var(--rt-motion-ease) both!important;}\
#panel-content{animation:rtSurfaceEnterV1447 250ms var(--rt-motion-ease) both!important;}\
.slide-panel{transition:transform 300ms var(--rt-motion-ease)!important;}\
#more-sheet{transition:transform 300ms var(--rt-motion-ease)!important;}\
.country-panel{transition:opacity 180ms ease-out,transform 240ms var(--rt-motion-ease)!important;}\
#confirm-modal.open{animation:rtOverlayInV1447 180ms ease-out both!important;}\
#confirm-modal.open .confirm-box{animation:rtConfirmInV1447 260ms var(--rt-motion-ease) both!important;}\
.fab-dial-item{transition:opacity 180ms ease-out,transform 240ms var(--rt-motion-ease)!important;}\
#fab-dial,#search-fab{transition-property:opacity,scale,transform,bottom!important;transition-duration:180ms,220ms,220ms,220ms!important;transition-timing-function:ease-out,var(--rt-motion-ease),var(--rt-motion-ease),var(--rt-motion-ease)!important;}\
#fab-dial.rt-fab-motion-hidden,#search-fab.rt-fab-motion-hidden{opacity:0!important;scale:.94;pointer-events:none!important;}\
.tab,.bnt,.nav-more-btn,.more-sheet-row{transition-property:color,background-color,opacity!important;transition-duration:160ms!important;transition-timing-function:ease-out!important;}\
.tab svg,.bnt svg,.nav-more-btn svg{transition:transform 180ms var(--rt-motion-ease),color 160ms ease-out!important;}\
.tab.on svg,.bnt.on svg{transform:translateY(-1px);}\
@media(prefers-reduced-motion:reduce){\
 .page.on:not(.rt-boot-noanim),#panel-content,#confirm-modal.open,#confirm-modal.open .confirm-box{animation:none!important;}\
 .slide-panel,#more-sheet,.country-panel,.fab-dial-item,#fab-dial,#search-fab,.tab,.bnt,.nav-more-btn,.more-sheet-row,.tab svg,.bnt svg,.nav-more-btn svg{transition:none!important;}\
 #fab-dial.rt-fab-motion-hidden,#search-fab.rt-fab-motion-hidden{scale:1;}\
}';
    document.head.appendChild(s);
  }
  installStyles();

  function clearHideTimer(el){
    if(!el)return;
    if(el.__rtFabHideTimer){clearTimeout(el.__rtFabHideTimer);el.__rtFabHideTimer=0;}
  }

  function motionVisibility(el,visible){
    if(!el)return;
    clearHideTimer(el);
    if(reducedMotion()){
      el.classList.toggle('rt-fab-motion-hidden',!visible);
      el.style.visibility=visible?'':'hidden';
      if(visible)el.removeAttribute('aria-hidden');else el.setAttribute('aria-hidden','true');
      return;
    }
    if(visible){
      /* Start from the faded state before visibility is restored so the FAB
         cannot pop for a frame on page changes. */
      el.classList.add('rt-fab-motion-hidden');
      el.style.visibility='';
      el.removeAttribute('aria-hidden');
      try{void el.getBoundingClientRect().width;}catch(_){}
      requestAnimationFrame(function(){requestAnimationFrame(function(){el.classList.remove('rt-fab-motion-hidden');});});
    }else{
      el.setAttribute('aria-hidden','true');
      el.classList.add('rt-fab-motion-hidden');
      el.__rtFabHideTimer=setTimeout(function(){
        el.__rtFabHideTimer=0;
        if(el.classList.contains('rt-fab-motion-hidden'))el.style.visibility='hidden';
      },FAST+35);
    }
  }

  /* Replace the visibility snap in the production helper while preserving its
     page/context rules. If those internals ever change, fall back to the native
     helper instead of guessing. */
  try{
    if(typeof _syncFabVisibility==='function'){
      var nativeSyncFab=_syncFabVisibility;
      _syncFabVisibility=function(){
        var dial=document.getElementById('fab-dial');
        if(!dial)return;
        try{
          if(dial.style.display==='none' && typeof DB!=='undefined' && !DB._userOwned && !(typeof _previewMode!=='undefined'&&_previewMode))return;
        }catch(_){}
        var activePage=(document.querySelector('.page.on')||{id:''}).id;
        var hidden;
        try{
          hidden=_FAB_HIDDEN_PAGES.has(activePage)||_fabOptionsForPage(activePage).length===0;
        }catch(e){
          return nativeSyncFab.apply(this,arguments);
        }
        var searchFab=document.getElementById('search-fab');
        if(hidden)dial.classList.remove('open');
        motionVisibility(dial,!hidden);
        motionVisibility(searchFab,!hidden);
      };
      requestAnimationFrame(function(){try{_syncFabVisibility();}catch(_){};});
    }
  }catch(_){}

  /* A tiny page-state observer keeps the selected nav/FAB state visually in
     phase with the incoming page even for routes that do not go through the
     main tab helper (item detail, run detail, account detail, etc.). */
  try{
    var lastPage=(document.querySelector('.page.on')||{id:''}).id;
    var obs=new MutationObserver(function(){
      var current=(document.querySelector('.page.on')||{id:''}).id;
      if(current===lastPage)return;
      lastPage=current;
      try{if(typeof _syncFabVisibility==='function')_syncFabVisibility();}catch(_){}
    });
    obs.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class']});
  }catch(_){}
})();
