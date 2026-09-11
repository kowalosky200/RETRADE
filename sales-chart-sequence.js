/* RETRADE Sales yearly chart sequence v3.0 (v1.4.66)
 *
 * One presentation owner for the Sales yearly chart.
 *
 * Premium-motion goals:
 * - useful chart geometry is ready immediately; animation never gates data
 * - history draws once with a short continuous left-to-right reveal
 * - current-month actual/forecast follows as one compact second act
 * - incidental data refreshes settle in place instead of replaying the show
 * - no perpetual requestAnimationFrame loop; browser-owned WAAPI handles paths
 * - reduced-motion settles the finished chart immediately
 *
 * No accounting, forecast calculation, sync, lifecycle or persisted data.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function'){
    window.__rtSalesSequenceArmed=false;
    return;
  }

  var EASE='cubic-bezier(.22,.61,.36,1)';
  var START_DELAY=35;
  var HISTORY_MIN=480;
  var HISTORY_MAX=760;
  var HISTORY_PER_MONTH=55;
  var FORECAST_GAP=65;
  var DASH_STEP=34;
  var DASH_MAX=360;
  var ENDPOINT_GAP=45;
  var ENDPOINT_MS=165;
  var active=null;
  var serial=0;
  var lastAnimatedKey='';

  window.__rtSalesChartSequence=window.__rtSalesChartSequence||{};
  var diag=window.__rtSalesChartSequence;
  diag.version='3.0';
  window.__rtSalesSequenceArmed=true;

  function reduced(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }
  function visible(svg){
    if(!svg||!svg.isConnected)return false;
    var r;try{r=svg.getBoundingClientRect();}catch(_){r=null;}
    return !!(r&&r.width>80&&r.height>80);
  }
  function bootHolding(){
    var body=document.body;
    return !!(body&&body.classList.contains('rt-real-layout-loading')&&!body.classList.contains('rt-real-layout-revealing'));
  }
  function isSales(svg,opts){
    return !!(svg&&svg.id==='monthly-profitability-svg'&&opts&&opts.primaryLabel==='Net Revenue'&&opts.secondaryLabel==='Net Profit');
  }
  function routeKey(){
    var period='',view='',replay=window.__rtSalesMotionReplayToken||0;
    try{period=String(typeof MONTHLY_PERIOD!=='undefined'?MONTHLY_PERIOD:'');}catch(_){}
    try{view=String(typeof MONTHLY_VIEW!=='undefined'?MONTHLY_VIEW:'');}catch(_){}
    return period+'|'+view+'|'+String(replay);
  }
  function chartColumns(svg){
    return Array.prototype.slice.call(svg.querySelectorAll('.rt-chart-col[data-idx]')).sort(function(a,b){
      return (Number(a.getAttribute('data-idx'))||0)-(Number(b.getAttribute('data-idx'))||0);
    });
  }
  function historyPaths(svg){
    return Array.prototype.slice.call(svg.querySelectorAll('path.rt-chart-line:not(.rt-chart-tertiary-line)')).filter(function(path){
      if(path.closest('.rt-chart-partial-group'))return false;
      try{return path.getTotalLength()>8;}catch(_){return false;}
    });
  }

  function installStyles(){
    ['rt-sales-sequence-v2-css','rt-sales-sequence-v3-css','rt-sales-forecast-hard-gate-css','rt-line-motion-v1455'].forEach(function(id){var n=document.getElementById(id);if(n)n.remove();});
    var s=document.createElement('style');s.id='rt-sales-sequence-v3-css';
    s.textContent='\
#p-monthly #monthly-profitability-svg.rt-sales-sequence{--rt-sales-point-ms:135ms}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-history-point{opacity:0!important;transform:scale(.92)!important;transform-box:fill-box;transform-origin:center;animation:none!important;transition:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-history-point.rt-sales-point-on{opacity:1!important;transform:scale(1)!important;transition:opacity var(--rt-sales-point-ms) ease-out,transform var(--rt-sales-point-ms) '+EASE+'!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-group{visibility:hidden!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-forecast-stage .rt-chart-partial-group{visibility:visible!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-dash{opacity:0!important;animation:none!important;transition:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-dash.rt-sales-dash-on{opacity:1!important;transition:opacity 80ms ease-out!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-dot{opacity:0!important;visibility:hidden!important;animation:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-actual-dot{opacity:0!important;transform:scale(.94)!important;transform-box:fill-box;transform-origin:center;animation:none!important;transition:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-forecast-stage .rt-sales-actual-dot{opacity:1!important;transform:scale(1)!important;transition:opacity 135ms ease-out,transform 135ms '+EASE+'!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-forecast-ring,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-forecast-label,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-range-label{opacity:0!important;visibility:hidden!important;animation:none!important;transition:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-forecast-ring{transform:scale(.94)!important;transform-box:fill-box;transform-origin:center}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-endpoint-stage .rt-sales-forecast-ring,#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-endpoint-stage .rt-sales-forecast-label,#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-endpoint-stage .rt-sales-range-label{opacity:1!important;visibility:visible!important;transform:scale(1)!important;transition:opacity '+ENDPOINT_MS+'ms ease-out,transform '+ENDPOINT_MS+'ms '+EASE+'!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-so-far{opacity:0!important;transition:none!important}\
#p-monthly #monthly-profitability-svg.rt-sales-sequence.rt-sales-forecast-stage .rt-chart-so-far{opacity:.72!important;transition:opacity 130ms ease-out!important}\
@media(prefers-reduced-motion:reduce){\
 #p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-history-point,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-dash,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-actual-dot,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-forecast-ring,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-forecast-label,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-sales-range-label,#p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-dot{opacity:1!important;visibility:visible!important;transform:none!important;transition:none!important}\
 #p-monthly #monthly-profitability-svg.rt-sales-sequence .rt-chart-partial-group{visibility:visible!important}\
}\
';
    document.head.appendChild(s);
  }
  installStyles();

  function addTimer(session,fn,delay){
    var id=setTimeout(function(){
      var i=session.timers.indexOf(id);if(i>=0)session.timers.splice(i,1);
      if(!session.cancelled)fn();
    },Math.max(0,delay||0));
    session.timers.push(id);return id;
  }
  function cancel(session){
    if(!session)return;
    session.cancelled=true;
    (session.timers||[]).forEach(clearTimeout);session.timers=[];
    (session.animations||[]).forEach(function(a){try{a.cancel();}catch(_){}});session.animations=[];
  }
  function cleanupPath(path){
    if(!path||!path.isConnected)return;
    path.style.removeProperty('stroke-dasharray');
    path.style.removeProperty('stroke-dashoffset');
  }
  function settle(svg){
    if(!svg)return;
    svg.classList.add('rt-sales-sequence','rt-sales-forecast-stage','rt-sales-endpoint-stage','rt-sales-sequence-complete');
    svg.classList.remove('rt-sales-history-stage');
    historyPaths(svg).forEach(cleanupPath);
    Array.prototype.forEach.call(svg.querySelectorAll('.rt-sales-history-point'),function(c){c.classList.add('rt-sales-point-on');});
    Array.prototype.forEach.call(svg.querySelectorAll('.rt-chart-partial-dash'),function(d){d.classList.add('rt-sales-dash-on');});
    var rings=svg.querySelectorAll('.rt-sales-forecast-ring');
    if(!rings.length){Array.prototype.forEach.call(svg.querySelectorAll('.rt-chart-partial-dot'),function(d){d.style.visibility='visible';d.style.opacity='1';});}
  }
  function primePath(path){
    if(!path||!path.isConnected)return;
    try{path.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
    var len=0;try{len=path.getTotalLength();}catch(_){len=0;}
    if(!(len>8))return;
    path.style.strokeDasharray=len.toFixed(2)+'px '+len.toFixed(2)+'px';
    path.style.strokeDashoffset=len.toFixed(2)+'px';
  }
  function prepare(svg){
    svg.classList.add('rt-sales-sequence','rt-sales-history-stage');
    svg.classList.remove('rt-sales-forecast-stage','rt-sales-endpoint-stage','rt-sales-sequence-complete');
    var columns=chartColumns(svg);
    var partial=svg.querySelector('.rt-chart-partial-group');
    var historyColumns=partial&&columns.length>1?columns.slice(0,-1):columns.slice();
    var paths=historyPaths(svg);paths.forEach(primePath);
    columns.forEach(function(col,idx){
      Array.prototype.forEach.call(col.querySelectorAll('circle'),function(c){
        c.classList.remove('rt-sales-history-point','rt-sales-point-on');
        if(idx<historyColumns.length&&!c.classList.contains('rt-chart-partial-dot'))c.classList.add('rt-sales-history-point');
      });
    });
    Array.prototype.forEach.call(svg.querySelectorAll('.rt-chart-partial-dash'),function(d){d.classList.remove('rt-sales-dash-on');});
    return {columns:columns,historyColumns:historyColumns,paths:paths,dashes:Array.prototype.slice.call(svg.querySelectorAll('.rt-chart-partial-dash'))};
  }
  function animatePath(session,path,duration,delay){
    var len=0;try{len=path.getTotalLength();}catch(_){len=0;}
    if(!(len>8))return;
    try{path.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
    path.style.strokeDasharray=len.toFixed(2)+'px '+len.toFixed(2)+'px';
    path.style.strokeDashoffset=len.toFixed(2)+'px';
    if(typeof path.animate!=='function'){
      addTimer(session,function(){path.style.strokeDashoffset='0px';cleanupPath(path);},delay+duration);
      return;
    }
    try{
      var a=path.animate([{strokeDashoffset:len.toFixed(2)+'px'},{strokeDashoffset:'0px'}],{duration:duration,delay:delay,easing:EASE,fill:'forwards'});
      session.animations.push(a);
      a.onfinish=function(){
        path.style.strokeDashoffset='0px';cleanupPath(path);
        var i=session.animations.indexOf(a);if(i>=0)session.animations.splice(i,1);
        try{a.cancel();}catch(_){}
      };
    }catch(_){addTimer(session,function(){cleanupPath(path);},delay+duration);}
  }

  function run(svg,key){
    if(!svg||!svg.isConnected)return;
    cancel(active);
    var session=active={id:++serial,key:key,cancelled:false,timers:[],animations:[]};
    lastAnimatedKey=key;
    var state=prepare(svg);
    if(reduced()||!visible(svg)){settle(svg);return;}

    var points=Math.max(1,state.historyColumns.length);
    var historyMs=Math.max(HISTORY_MIN,Math.min(HISTORY_MAX,Math.max(1,points-1)*HISTORY_PER_MONTH));
    state.paths.forEach(function(path){animatePath(session,path,historyMs,START_DELAY);});

    state.historyColumns.forEach(function(col,index){
      var ratio=points<=1?0:index/(points-1);
      addTimer(session,function(){
        Array.prototype.forEach.call(col.querySelectorAll('circle.rt-sales-history-point'),function(c){c.classList.add('rt-sales-point-on');});
      },START_DELAY+historyMs*ratio-18);
    });

    var forecastStart=START_DELAY+historyMs+FORECAST_GAP;
    addTimer(session,function(){svg.classList.remove('rt-sales-history-stage');svg.classList.add('rt-sales-forecast-stage');},forecastStart);

    var dashCount=state.dashes.length;
    var dashTotal=Math.min(DASH_MAX,Math.max(0,dashCount*DASH_STEP));
    if(dashCount){
      var step=dashTotal/Math.max(1,dashCount);
      state.dashes.forEach(function(dash,index){addTimer(session,function(){dash.classList.add('rt-sales-dash-on');},forecastStart+index*step);});
    }

    var endpointStart=forecastStart+dashTotal+ENDPOINT_GAP;
    addTimer(session,function(){svg.classList.add('rt-sales-endpoint-stage');},endpointStart);
    addTimer(session,function(){settle(svg);diag.lastTotalMs=endpointStart+ENDPOINT_MS;},endpointStart+ENDPOINT_MS+20);

    diag.historyMs=historyMs;
    diag.forecastMs=dashTotal;
    diag.points=points;
    diag.dashes=dashCount;
    diag.totalMs=endpointStart+ENDPOINT_MS;
  }

  function arm(svg,key){
    if(!svg||!svg.isConnected)return;
    if(key===lastAnimatedKey){cancel(active);settle(svg);return;}
    prepare(svg);
    if(reduced()){settle(svg);lastAnimatedKey=key;return;}
    if(bootHolding()){
      var once=function(){window.removeEventListener('retrade:boot-reveal',once);requestAnimationFrame(function(){run(svg,key);});};
      window.addEventListener('retrade:boot-reveal',once,{once:true});
      return;
    }
    requestAnimationFrame(function(){run(svg,key);});
  }

  var renderBeforeSequence=_renderChartInto;
  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    var out=renderBeforeSequence.apply(this,arguments);
    if(isSales(svgEl,opts))arm(svgEl,routeKey());
    return out;
  };

  /* The first hydrated render can precede this late presentation layer. Enhance
     an already-present visible Sales chart once; never hold the app for it. */
  requestAnimationFrame(function(){
    try{
      var svg=document.getElementById('monthly-profitability-svg');
      if(svg&&visible(svg))arm(svg,routeKey());
    }catch(_){}
  });
})();