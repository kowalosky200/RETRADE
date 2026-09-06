/* RETRADE yearly Sales line-motion refinement v1.4.47
 * Loaded after chart-reveal.js.
 *
 * Presentation-only responsibilities:
 * - prepare the chart BEFORE it becomes visible, eliminating loaded-then-rewind
 * - slower, steadier historical line draw with points arriving as the line passes
 * - forecast tails retain their dotted styling and reveal progressively, dash by dash
 * - forecast destination rings arrive only after the dotted tail completes
 * - first real-layout reveal and deliberate period switches replay; same-period
 *   background refreshes remain settled
 *
 * No accounting, forecast maths, sync, inventory lifecycle or persisted data is touched.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function')return;

  var NS='http://www.w3.org/2000/svg';
  var EASE='cubic-bezier(.22,.61,.36,1)';
  var HISTORY_MS=1480;
  var HISTORY_DELAY=100;
  var FORECAST_MS=1680;
  var FORECAST_DELAY=1510;
  var lastPlayedKey=null;
  var playTimer=0;
  var maskSerial=0;

  function num(v){v=Number(v);return isFinite(v)?v:0;}
  function reducedMotion(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }
  function isVisible(el){
    if(!el||!el.isConnected)return false;
    var cs;try{cs=getComputedStyle(el);}catch(_){cs=null;}
    if(cs&&(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0))return false;
    var r;try{r=el.getBoundingClientRect();}catch(_){r=null;}
    return !!(r&&r.width>80&&r.height>80);
  }
  function isSalesChart(svgEl,opts){
    return !!(svgEl&&svgEl.id==='monthly-profitability-svg'&&opts&&opts.primaryLabel==='Net Revenue'&&opts.secondaryLabel==='Net Profit');
  }
  function salesPeriodKey(){
    var key='';
    try{if(typeof MONTHLY_PERIOD!=='undefined')key=String(MONTHLY_PERIOD||'');}catch(_){}
    var sel=document.querySelector('#p-monthly select.period-select-inline,#p-monthly select');
    if(sel){
      try{key+='|'+String(sel.value||'')+'|'+String(sel.options[sel.selectedIndex].text||'');}catch(_){}
    }
    return key||'sales-default';
  }

  function installStyles(){
    ['rt-line-motion-v1446','rt-line-motion-v1447'].forEach(function(id){var old=document.getElementById(id);if(old)old.remove();});
    var s=document.createElement('style');s.id='rt-line-motion-v1447';
    s.textContent='\
#p-monthly svg.rt-refined-sales-motion path.rt-refined-history-line,\
#p-monthly svg.rt-refined-sales-motion path.rt-refined-forecast-line{animation:none!important;}\
#p-monthly svg.rt-refined-sales-motion .rt-sales-forecast-ring{animation:none!important;}\
#p-monthly svg.rt-refined-sales-motion circle.rt-refined-series-point{animation:none!important;}\
#p-monthly #monthly-profitability-svg{will-change:opacity;}\
@media(prefers-reduced-motion:reduce){#p-monthly #monthly-profitability-svg{opacity:1!important;}}';
    document.head.appendChild(s);
  }
  installStyles();

  function pathLength(path){
    try{var len=path.getTotalLength();return isFinite(len)?len:0;}catch(_){return 0;}
  }
  function strokeValue(path){
    var s=path.getAttribute('stroke');
    if(s&&s!=='none')return s;
    try{s=getComputedStyle(path).stroke;}catch(_){}
    return s||'none';
  }
  function dashValue(path){
    var d=String(path.getAttribute('stroke-dasharray')||'').trim();
    if(!d||d==='none'){
      try{d=String(getComputedStyle(path).strokeDasharray||'').trim();}catch(_){}
    }
    return d;
  }
  function isDashed(path){
    var d=dashValue(path);
    return !!(d&&d!=='none'&&d!=='0px'&&d!=='0'&&!/^none$/i.test(d));
  }
  function isSeriesPath(path){
    if(!path||path.closest('defs'))return false;
    var cls=String(path.getAttribute('class')||'');
    if(/scrub|axis|grid|hit|hover|area/i.test(cls))return false;
    if(!path.getAttribute('d')||strokeValue(path)==='none')return false;
    var fill=String(path.getAttribute('fill')||'').trim();
    if(fill&&fill!=='none'&&fill!=='transparent')return false;
    return pathLength(path)>14;
  }
  function ensureDefs(svg){
    var defs=svg.querySelector('defs');
    if(!defs){defs=document.createElementNS(NS,'defs');svg.insertBefore(defs,svg.firstChild);}
    return defs;
  }
  function clearPriorMasks(svg){
    Array.prototype.forEach.call(svg.querySelectorAll('mask[data-rt-sales-forecast-mask="1"]'),function(m){m.remove();});
    Array.prototype.forEach.call(svg.querySelectorAll('path.rt-refined-forecast-line'),function(p){p.removeAttribute('mask');});
  }
  function cancelAnimations(el){
    try{el.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
  }

  function prepareHistory(path){
    var len=pathLength(path);if(len<=0)return null;
    path.classList.add('rt-refined-history-line');
    cancelAnimations(path);
    var state={path:path,len:len,dash:path.style.strokeDasharray,offset:path.style.strokeDashoffset};
    path.style.strokeDasharray=len.toFixed(1)+' '+len.toFixed(1);
    path.style.strokeDashoffset=len.toFixed(1);
    return state;
  }

  function prepareForecast(svg,path){
    var len=pathLength(path);if(len<=0)return null;
    path.classList.add('rt-refined-forecast-line');
    cancelAnimations(path);

    var defs=ensureDefs(svg),mask=document.createElementNS(NS,'mask');
    var id='rt-sales-forecast-mask-'+Date.now()+'-'+(++maskSerial);
    var vb=svg.viewBox&&svg.viewBox.baseVal;
    var W=vb&&vb.width?vb.width:num(svg.getAttribute('width'))||800;
    var H=vb&&vb.height?vb.height:num(svg.getAttribute('height'))||320;
    mask.setAttribute('id',id);mask.setAttribute('data-rt-sales-forecast-mask','1');
    mask.setAttribute('maskUnits','userSpaceOnUse');mask.setAttribute('x','0');mask.setAttribute('y','0');
    mask.setAttribute('width',String(W));mask.setAttribute('height',String(H));

    var wipe=document.createElementNS(NS,'path');
    wipe.setAttribute('d',path.getAttribute('d'));
    wipe.setAttribute('fill','none');wipe.setAttribute('stroke','white');
    var sw=num(path.getAttribute('stroke-width'));
    if(!sw){try{sw=parseFloat(getComputedStyle(path).strokeWidth)||2;}catch(_){sw=2;}}
    wipe.setAttribute('stroke-width',String(Math.max(5,sw*3.1)));
    wipe.setAttribute('stroke-linecap','butt');wipe.setAttribute('stroke-linejoin','round');
    wipe.style.strokeDasharray=len.toFixed(1)+' '+len.toFixed(1);
    wipe.style.strokeDashoffset=len.toFixed(1);
    mask.appendChild(wipe);defs.appendChild(mask);
    path.setAttribute('mask','url(#'+id+')');
    return {path:path,wipe:wipe,mask:mask,len:len};
  }

  function preparePoints(svg){
    var circles=Array.prototype.slice.call(svg.querySelectorAll('circle')).filter(function(c){
      var cls=String(c.getAttribute('class')||'');
      if(/forecast-ring|scrub|hover/i.test(cls))return false;
      return isFinite(num(c.getAttribute('cx')))&&isFinite(num(c.getAttribute('cy')));
    });
    circles.forEach(function(c){
      c.classList.add('rt-refined-series-point');
      cancelAnimations(c);
      c.__rtOldOpacity=c.style.opacity||'';
      c.__rtOldTransform=c.style.transform||'';
      c.style.opacity='0';
      c.style.transform='scale(.72)';
      c.style.transformOrigin='center';
      c.style.transformBox='fill-box';
    });
    return circles;
  }

  function prepareRings(svg){
    var rings=Array.prototype.slice.call(svg.querySelectorAll('.rt-sales-forecast-ring'));
    rings.forEach(function(r){
      cancelAnimations(r);
      r.style.animation='none';
      r.__rtOldOpacity=r.style.opacity||'';
      r.__rtOldTransform=r.style.transform||'';
      r.style.opacity='0';
      r.style.transform='scale(.70)';
      r.style.transformOrigin='center';
      r.style.transformBox='fill-box';
    });
    return rings;
  }

  function prepareRefinedMotion(svg,key){
    if(!svg||reducedMotion()){
      if(svg)svg.classList.add('rt-motion-ready');
      return null;
    }
    clearPriorMasks(svg);
    /* Prevent the renderer's own draw class from racing our choreography. */
    svg.classList.remove('rt-chart-draw');
    var paths=Array.prototype.slice.call(svg.querySelectorAll('path')).filter(isSeriesPath);
    if(!paths.length){svg.classList.add('rt-motion-ready');return null;}
    var history=[],forecast=[];
    paths.forEach(function(p){
      var st=isDashed(p)?prepareForecast(svg,p):prepareHistory(p);
      if(st)(isDashed(p)?forecast:history).push(st);
    });
    var state={key:key,history:history,forecast:forecast,points:preparePoints(svg),rings:prepareRings(svg),played:false};
    svg.__rtRefinedSalesState=state;
    svg.classList.add('rt-refined-sales-motion','rt-motion-ready');
    return state;
  }

  function playHistory(state){
    state.history.forEach(function(st){
      var extra=st.path.classList.contains('rt-chart-tertiary-line')?90:0;
      try{
        var a=st.path.animate([{strokeDashoffset:st.len},{strokeDashoffset:0}],{
          duration:HISTORY_MS,delay:HISTORY_DELAY+extra,easing:EASE,fill:'forwards'
        });
        a.onfinish=function(){st.path.style.strokeDasharray=st.dash;st.path.style.strokeDashoffset=st.offset;};
      }catch(_){st.path.style.strokeDashoffset='0';}
    });
  }

  function playPoints(state){
    if(!state.points.length)return;
    var xs=state.points.map(function(c){return num(c.getAttribute('cx'));});
    var minX=Math.min.apply(Math,xs),maxX=Math.max.apply(Math,xs),span=Math.max(1,maxX-minX);
    state.points.forEach(function(c){
      var progress=(num(c.getAttribute('cx'))-minX)/span;
      var targetOpacity='1';
      var attr=c.getAttribute('opacity');if(attr!=null&&attr!=='')targetOpacity=String(attr);
      try{
        var a=c.animate([
          {opacity:0,transform:'scale(.72)'},
          {opacity:targetOpacity,transform:'scale(1)'}
        ],{
          duration:220,
          delay:HISTORY_DELAY+190+progress*(HISTORY_MS-300),
          easing:'cubic-bezier(.22,.61,.36,1)',fill:'forwards'
        });
        a.onfinish=function(){c.style.opacity=c.__rtOldOpacity||'';c.style.transform=c.__rtOldTransform||'';};
      }catch(_) {c.style.opacity='';c.style.transform='';}
    });
  }

  function playForecast(state){
    state.forecast.forEach(function(st,i){
      try{
        var a=st.wipe.animate([{strokeDashoffset:st.len},{strokeDashoffset:0}],{
          duration:FORECAST_MS,
          delay:FORECAST_DELAY+i*60,
          /* Linear mask travel makes each original dash appear in sequence at
             a constant visual speed instead of accelerating through the tail. */
          easing:'linear',fill:'forwards'
        });
        a.onfinish=function(){
          st.path.removeAttribute('mask');
          if(st.mask&&st.mask.isConnected)st.mask.remove();
        };
      }catch(_){st.wipe.style.strokeDashoffset='0';}
    });
  }

  function playRings(state){
    state.rings.forEach(function(ring,i){
      try{
        var a=ring.animate([{opacity:0,transform:'scale(.70)'},{opacity:1,transform:'scale(1)'}],{
          duration:280,
          delay:FORECAST_DELAY+FORECAST_MS+80+i*45,
          easing:EASE,fill:'forwards'
        });
        a.onfinish=function(){ring.style.opacity=ring.__rtOldOpacity||'';ring.style.transform=ring.__rtOldTransform||'';};
      }catch(_){ring.style.opacity='';ring.style.transform='';}
    });
  }

  function playPrepared(svg,force){
    if(reducedMotion()){svg.classList.add('rt-motion-ready');return false;}
    if(!svg||!isVisible(svg))return false;
    var state=svg.__rtRefinedSalesState;
    if(!state||state.played)return false;
    if(!force&&state.key===lastPlayedKey)return false;
    state.played=true;
    lastPlayedKey=state.key;
    playHistory(state);
    playPoints(state);
    playForecast(state);
    playRings(state);
    return true;
  }

  function schedulePrepared(svg,force,delay){
    if(playTimer)clearTimeout(playTimer);
    playTimer=setTimeout(function(){
      playTimer=0;
      if(!playPrepared(svg,force)){
        /* Hidden page / still handing off from the loader: retry without ever
           resetting a visible settled chart. */
        var st=svg&&svg.__rtRefinedSalesState;
        if(st&&!st.played)setTimeout(function(){playPrepared(svg,force);},140);
      }
    },delay==null?50:delay);
  }

  /* Prepare synchronously inside the render wrapper. This is the key to removing
     the old visible-settled -> rewind -> reveal jump on period changes. */
  var _renderBeforeLineMotion=_renderChartInto;
  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    var out=_renderBeforeLineMotion.apply(this,arguments);
    if(isSalesChart(svgEl,opts)){
      var key=salesPeriodKey();
      if(lastPlayedKey===null||key!==lastPlayedKey){
        prepareRefinedMotion(svgEl,key);
        schedulePrepared(svgEl,false,40);
      }else{
        svgEl.classList.add('rt-motion-ready');
      }
    }
    return out;
  };

  /* Handle a chart that app-core rendered before this presentation layer loaded.
     app.js pre-hides that SVG, so this preparation still happens before the user
     can see the real data strokes. */
  var existing=document.getElementById('monthly-profitability-svg');
  if(existing&&existing.querySelector('path')){
    prepareRefinedMotion(existing,salesPeriodKey());
    schedulePrepared(existing,false,70);
  }
  requestAnimationFrame(function(){document.documentElement.classList.remove('rt-motion-prep');});

  var observer;
  try{
    observer=new MutationObserver(function(){
      var svg=document.getElementById('monthly-profitability-svg');
      if(!svg)return;
      var st=svg.__rtRefinedSalesState;
      if(st&&!st.played&&isVisible(svg))schedulePrepared(svg,false,55);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-busy']});
  }catch(_){}
})();
