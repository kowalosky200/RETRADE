/* RETRADE app entrypoint.
 *
 * Cold-start is intentionally staged:
 *   1) launch coordinator + production core
 *   2) give the browser one real paint opportunity
 *   3) load feature/presentation refinements in deterministic order
 *   4) release the boot skeleton only after the final motion layer is installed
 *
 * This keeps the large core authoritative while avoiding a long back-to-back
 * chain of secondary JavaScript evaluation before the first useful frame.
 */
(function(){
  'use strict';
  var v='20260910-v1464';
  var motionReady=false;
  var motionFallbackTimer=0;

  window.__rtMotionStackReady=false;
  document.documentElement.classList.add('rt-app-cold','rt-motion-prep');

  if(!document.getElementById('rt-motion-preflight')){
    var pre=document.createElement('style');pre.id='rt-motion-preflight';
    pre.textContent='html.rt-motion-prep #monthly-profitability-svg{opacity:0!important}#monthly-profitability-svg{transition:opacity 120ms cubic-bezier(.22,.61,.36,1)}@media(prefers-reduced-motion:reduce){html.rt-motion-prep #monthly-profitability-svg{opacity:1!important}#monthly-profitability-svg{transition:none!important}}';
    document.head.appendChild(pre);
  }

  function markMotionReady(reason){
    if(motionReady)return;
    motionReady=true;
    window.__rtMotionStackReady=true;
    if(motionFallbackTimer){clearTimeout(motionFallbackTimer);motionFallbackTimer=0;}
    document.documentElement.classList.remove('rt-motion-prep');
    try{window.dispatchEvent(new CustomEvent('retrade:motion-ready',{detail:{reason:reason||'ready'}}));}catch(_){}
  }

  // Presentation failure must never strand the app indefinitely. Normal boots
  // signal readiness when motion-system.js finishes evaluating; this is only a
  // safety net for a failed optional enhancement request.
  motionFallbackTimer=setTimeout(function(){motionFallbackTimer=0;markMotionReady('fallback');},3000);
  setTimeout(function(){
    if(!document.body||!document.body.classList.contains('rt-real-layout-loading'))document.documentElement.classList.remove('rt-app-cold');
  },5000);

  function append(src,priority,onload){
    var s=document.createElement('script');
    s.src=src+'?v='+v;
    s.async=false;
    try{s.fetchPriority=priority||'auto';}catch(_){}
    if(onload)s.onload=onload;
    s.onerror=function(){
      console.error('[RETRADE] startup script failed:',src);
      if(src==='./launch-experience.js')document.documentElement.classList.remove('rt-app-cold');
      if(src==='./motion-system.js')markMotionReady('motion-system-error');
    };
    document.head.appendChild(s);
    return s;
  }

  function loadEnhancements(){
    /* Performance/navigation wrappers first: they are cheap and should be in
       place before a fast Supabase response causes the hydrated render. */
    var files=[
      './performance-system.js',
      './sales-defaults.js',
      './bundle-orders.js',
      './bundle-panel.js',
      './bundle-row-polish.js',
      './cashflow-liabilities.js',
      './partner-item-navigation.js',
      './chart-polish.js',
      './chart-motion.js',
      './chart-finalize.js',
      './chart-reveal.js',
      './sales-chart-sequence.js',
      './chart-forecast-sequence.js',
      './motion-system.js'
    ];
    files.forEach(function(src,index){
      append(src,index<2?'auto':'low',index===files.length-1?function(){markMotionReady('stack-loaded');}:null);
    });
  }

  /* Only two scripts sit on the first critical execution path. Dynamic classic
     scripts with async=false retain insertion order. */
  append('./launch-experience.js','high');
  append('./app-core.js','high',function(){
    try{if(typeof window.__rtInstallLaunchCoreHooks==='function')window.__rtInstallLaunchCoreHooks();}catch(_){}
    /* A frame boundary is deliberate: let the real shell/chrome reach the
       screen before evaluating bundle/chart presentation layers. */
    requestAnimationFrame(function(){loadEnhancements();});
  });
})();