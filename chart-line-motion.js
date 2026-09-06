/* RETRADE yearly Sales line-motion refinement v1.4.46
 * Loaded after chart-reveal.js.
 *
 * Presentation-only responsibilities:
 * - slower, calmer left-to-right draw for historical Sales lines
 * - point markers appear as the draw reaches them
 * - forecast tails keep their dotted styling and are revealed progressively,
 *   dash-by-dash, behind a path-shaped wipe
 * - forecast destination rings arrive only after the dotted tail completes
 * - first real-layout reveal and period switches replay; same-period background
 *   refreshes do not.
 *
 * No accounting, forecast maths, sync, inventory lifecycle or persisted data is touched.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function')return;

  var NS='http://www.w3.org/2000/svg';
  var EASE='cubic-bezier(.22,.61,.36,1)';
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
    var old=document.getElementById('rt-line-motion-v1446');if(old)old.remove();
    var s=document.createElement('style');s.id='rt-line-motion-v1446';
    s.textContent='\
#p-monthly svg.rt-refined-sales-motion path.rt-refined-history-line,\
#p-monthly svg.rt-refined-sales-motion path.rt-refined-forecast-line{animation:none!important;}\
#p-monthly svg.rt-refined-sales-motion .rt-sales-forecast-ring{animation:none!important;}\
#p-monthly svg.rt-refined-sales-motion circle.rt-refined-series-point{animation:none!important;}\
';
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
    if(/scrub|axis|grid|hit|hover/i.test(cls))return false;
    if(!path.getAttribute('d')||strokeValue(path)==='none')return false;
    var fill=String(path.getAttribute('fill')||'').trim();
    if(fill&&fill!=='none'&&fill!=='transparent')return false;
    return pathLength(path)>14;
  }

  function clearPriorMasks(svg){
    Array.prototype.forEach.call(svg.querySelectorAll('mask[data-rt-sales-forecast-mask="1"]'),function(m){m.remove();});
    Array.prototype.forEach.call(svg.querySelectorAll('path.rt-refined-forecast-line'),function(p){p.removeAttribute('mask');});
  }

  function animateHistoryPath(path,index){
    var len=pathLength(path);if(len<=0)return;
    path.classList.add('rt-refined-history-line');
    try{path.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
    var originalDash=path.style.strokeDasharray,originalOffset=path.style.strokeDashoffset;
    path.style.strokeDasharray=len.toFixed(1)+' '+len.toFixed(1);
    path.style.strokeDashoffset=len.toFixed(1);
    var anim;
    try{
      anim=path.animate([
        {strokeDashoffset:len},
        {strokeDashoffset:0}
      ],{
        duration:1080,
        delay:70+Math.min(index,2)*35,
        easing:EASE,
        fill:'forwards'
      });
      anim.onfinish=function(){
        path.style.strokeDasharray=originalDash;
        path.style.strokeDashoffset=originalOffset;
      };
    }catch(_){
      path.style.strokeDashoffset='0';
    }
  }

  function ensureDefs(svg){
    var defs=svg.querySelector('defs');
    if(!defs){defs=document.createElementNS(NS,'defs');svg.insertBefore(defs,svg.firstChild);}
    return defs;
  }

  function animateForecastPath(svg,path,index){
    var len=pathLength(path);if(len<=0)return;
    path.classList.add('rt-refined-forecast-line');
    try{path.getAnimations().forEach(function(a){a.cancel();});}catch(_){}

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
    wipe.setAttribute('stroke-width',String(Math.max(5,sw*3.2)));
    wipe.setAttribute('stroke-linecap','round');wipe.setAttribute('stroke-linejoin','round');
    wipe.style.strokeDasharray=len.toFixed(1)+' '+len.toFixed(1);
    wipe.style.strokeDashoffset=len.toFixed(1);
    mask.appendChild(wipe);defs.appendChild(mask);
    path.setAttribute('mask','url(#'+id+')');

    try{
      wipe.animate([
        {strokeDashoffset:len},
        {strokeDashoffset:0}
      ],{
        duration:1180,
        delay:1040+index*55,
        easing:'cubic-bezier(.2,.55,.28,1)',
        fill:'forwards'
      });
    }catch(_){wipe.style.strokeDashoffset='0';}
  }

  function animateSeriesPoints(svg,historyPaths){
    var circles=Array.prototype.slice.call(svg.querySelectorAll('circle')).filter(function(c){
      var cls=String(c.getAttribute('class')||'');
      if(/forecast-ring|scrub|hover/i.test(cls))return false;
      return isFinite(num(c.getAttribute('cx')))&&isFinite(num(c.getAttribute('cy')));
    });
    if(!circles.length)return;
    var xs=circles.map(function(c){return num(c.getAttribute('cx'));});
    var minX=Math.min.apply(Math,xs),maxX=Math.max.apply(Math,xs),span=Math.max(1,maxX-minX);
    circles.forEach(function(c){
      c.classList.add('rt-refined-series-point');
      try{c.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
      var progress=(num(c.getAttribute('cx'))-minX)/span;
      try{
        c.animate([
          {opacity:0,transform:'scale(.68)',transformOrigin:'center',transformBox:'fill-box'},
          {opacity:1,transform:'scale(1)',transformOrigin:'center',transformBox:'fill-box'}
        ],{
          duration:190,
          delay:260+progress*760,
          easing:'ease-out',
          fill:'both'
        });
      }catch(_){}
    });
  }

  function animateForecastRings(svg,forecastDuration){
    var rings=svg.querySelectorAll('.rt-sales-forecast-ring');
    Array.prototype.forEach.call(rings,function(ring,i){
      try{ring.getAnimations().forEach(function(a){a.cancel();});}catch(_){}
      ring.style.animation='none';
      try{
        ring.animate([
          {opacity:0,transform:'scale(.66)',transformOrigin:'center',transformBox:'fill-box'},
          {opacity:1,transform:'scale(1)',transformOrigin:'center',transformBox:'fill-box'}
        ],{
          duration:250,
          delay:1040+forecastDuration-80+i*35,
          easing:'cubic-bezier(.22,.61,.36,1)',
          fill:'both'
        });
      }catch(_){}
    });
  }

  function playRefinedMotion(svg,force){
    if(reducedMotion()||!isVisible(svg))return false;
    var key=salesPeriodKey();
    if(!force&&key===lastPlayedKey)return false;

    var paths=Array.prototype.slice.call(svg.querySelectorAll('path')).filter(isSeriesPath);
    if(!paths.length)return false;
    var history=paths.filter(function(p){return !isDashed(p);});
    var forecast=paths.filter(isDashed);
    if(!history.length&&!forecast.length)return false;

    lastPlayedKey=key;
    svg.classList.add('rt-refined-sales-motion');
    clearPriorMasks(svg);
    history.forEach(animateHistoryPath);
    forecast.forEach(function(p,i){animateForecastPath(svg,p,i);});
    animateSeriesPoints(svg,history);
    animateForecastRings(svg,1180);
    return true;
  }

  function schedulePlay(svg,force,delay){
    if(playTimer)clearTimeout(playTimer);
    playTimer=setTimeout(function(){
      playTimer=0;
      if(!playRefinedMotion(svg,force)&&!lastPlayedKey){
        setTimeout(function(){playRefinedMotion(svg,force);},140);
      }
    },delay==null?80:delay);
  }

  /* Wrap renders so a deliberate period switch replays the refined motion,
     while a same-period background refresh leaves the chart settled. */
  var _renderBeforeLineMotion=_renderChartInto;
  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    var beforeKey=salesPeriodKey();
    var out=_renderBeforeLineMotion.apply(this,arguments);
    if(isSalesChart(svgEl,opts)){
      var afterKey=salesPeriodKey();
      if(lastPlayedKey===null||afterKey!==lastPlayedKey||beforeKey!==afterKey)schedulePlay(svgEl,false,70);
    }
    return out;
  };

  /* First real-layout reveal: wait until the Sales chart is actually visible,
     rather than spending the motion behind the loading/skeleton handoff. */
  var observer;
  try{
    observer=new MutationObserver(function(){
      if(lastPlayedKey!==null){observer.disconnect();return;}
      var svg=document.getElementById('monthly-profitability-svg');
      if(svg&&isVisible(svg))schedulePlay(svg,false,150);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-busy']});
  }catch(_){}
  window.addEventListener('load',function(){
    var svg=document.getElementById('monthly-profitability-svg');if(svg)schedulePlay(svg,false,180);
  },{once:true});
})();
