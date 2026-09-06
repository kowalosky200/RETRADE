/* RETRADE chart spacing + first-real-layout reveal v1.4.45
 * Loaded last, after chart-finalize.js.
 *
 * Presentation-only responsibilities:
 * - 30-day daily columns are capped to a true band width so neighbouring days
 *   always have visible breathing room on mobile and desktop.
 * - first-load motion is replayed when the real chart becomes visible, so the
 *   skeleton/real-layout loading handoff leads naturally into the same motion
 *   users see when changing a period.
 * - Sales Profit Breakdown bars and values also animate on their first reveal.
 *
 * No accounting, sync, inventory lifecycle or persisted-data logic is touched.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function')return;

  var EASE='cubic-bezier(.22,.61,.36,1)';
  var initialSummaryDone=false;
  var initialSalesDone=false;

  function num(v){v=Number(v);return isFinite(v)?v:0;}
  function clamp(min,v,max){return Math.max(min,Math.min(max,v));}
  function reducedMotion(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }
  function periodKey(){
    try{if(typeof SUMMARY_PERIOD!=='undefined')return String(SUMMARY_PERIOD||'').toLowerCase();}catch(_){}
    return '';
  }
  function selectedSummaryText(){
    var el=document.getElementById('summary-period-select')||document.querySelector('#p-summary select.period-select-inline,#p-summary select');
    if(!el)return '';
    try{return String(el.options[el.selectedIndex].text||'').toLowerCase();}catch(_){return '';}
  }
  function isLast30Days(){
    var p=periodKey().replace(/[\s_-]+/g,'');
    if(p==='30d'||p==='30days'||p==='last30d'||p==='last30days')return true;
    return /last\s+30\s+days/.test(selectedSummaryText());
  }
  function isDashboardBars(opts){
    return !!(opts&&opts.primaryBars&&opts.secondaryBarsInPrimary&&opts.primaryLabel==='Gross Revenue'&&opts.secondaryLabel==='Gross Profit');
  }
  function isSalesChart(svgEl,opts){
    return !!(svgEl&&svgEl.id==='monthly-profitability-svg'&&opts&&opts.primaryLabel==='Net Revenue'&&opts.secondaryLabel==='Net Profit');
  }
  function isVisible(el){
    if(!el||!el.isConnected)return false;
    var cs;try{cs=getComputedStyle(el);}catch(_){cs=null;}
    if(cs&&(cs.display==='none'||cs.visibility==='hidden'||Number(cs.opacity)===0))return false;
    var r;try{r=el.getBoundingClientRect();}catch(_){r=null;}
    return !!(r&&r.width>40&&r.height>40);
  }

  function installStyles(){
    var old=document.getElementById('rt-chart-reveal-v1445');if(old)old.remove();
    var s=document.createElement('style');s.id='rt-chart-reveal-v1445';
    s.textContent='\
/* Thirty daily observations need visible negative space between columns. */\
#p-summary svg.rt-daily-gap-bars .rt-chart-primary-bar:not(.rt-chart-profit-bar){stroke-width:.48!important;stroke-opacity:.46!important;}\
#p-summary svg.rt-daily-gap-bars .rt-chart-profit-bar{stroke-width:.36!important;stroke-opacity:.40!important;}\
';
    document.head.appendChild(s);
  }
  installStyles();

  function centerResize(rect,targetWidth){
    if(!rect||!isFinite(targetWidth)||targetWidth<=0)return;
    var w=num(rect.getAttribute('width')),x=num(rect.getAttribute('x'));
    if(w<=0)return;
    var nw=Math.min(w,targetWidth);
    if(Math.abs(nw-w)<.05)return;
    rect.setAttribute('x',(x+(w-nw)/2).toFixed(2));
    rect.setAttribute('width',nw.toFixed(2));
    var rx=num(rect.getAttribute('rx'));
    if(rx>0)rect.setAttribute('rx',Math.min(rx,nw*.18).toFixed(2));
  }

  function median(values){
    values=values.filter(function(v){return isFinite(v)&&v>0;}).sort(function(a,b){return a-b;});
    if(!values.length)return 0;
    var m=Math.floor(values.length/2);
    return values.length%2?values[m]:(values[m-1]+values[m])/2;
  }

  function enforceThirtyDayGaps(svgEl,labels){
    if(!svgEl)return;
    var active=isLast30Days()&&labels&&labels.length>=24;
    svgEl.classList.toggle('rt-daily-gap-bars',!!active);
    if(!active)return;

    var revenue=Array.prototype.slice.call(svgEl.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar):not(.rt-chart-forecast-shell)'));
    if(revenue.length<2)return;
    revenue.sort(function(a,b){
      var ax=num(a.getAttribute('x'))+num(a.getAttribute('width'))/2;
      var bx=num(b.getAttribute('x'))+num(b.getAttribute('width'))/2;
      return ax-bx;
    });
    var centres=revenue.map(function(r){return num(r.getAttribute('x'))+num(r.getAttribute('width'))/2;});
    var gaps=[];for(var i=1;i<centres.length;i++)gaps.push(centres[i]-centres[i-1]);
    var band=median(gaps);if(!band)return;

    /* About one third of each daily band remains empty. On a typical mobile
       plot this is ~3px of clean air, enough to read each day as a day. */
    var revenueWidth=Math.max(4.8,band*.67);
    var profitWidth=Math.max(3.0,revenueWidth*.56);
    revenue.forEach(function(rect){centerResize(rect,revenueWidth);});
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-profit-bar:not(.rt-chart-forecast-shell)'),function(rect){centerResize(rect,profitWidth);});
  }

  function restartSvgMotion(svgEl){
    if(!svgEl||reducedMotion())return;
    svgEl.classList.remove('rt-chart-draw');
    try{void svgEl.getBoundingClientRect().width;}catch(_){}
    requestAnimationFrame(function(){
      requestAnimationFrame(function(){svgEl.classList.add('rt-chart-draw');});
    });
  }

  function parseMoneyText(s){
    s=String(s||'').replace(/,/g,'');
    var neg=/[−-]/.test(s),m=s.match(/\d+(?:\.\d+)?/);if(!m)return null;
    var v=Number(m[0]);return isFinite(v)?(neg?-v:v):null;
  }
  function formatMoney(v,decimals){
    v=num(v);var neg=v<0,a=Math.abs(v);
    return (neg?'−':'')+'£'+a.toLocaleString('en-GB',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
  }
  function animateValue(el,targetText,delay,duration){
    var target=parseMoneyText(targetText);if(target===null)return;
    var decimals=(String(targetText).split('.')[1]||'').replace(/[^0-9].*$/,'').length;
    decimals=Math.min(2,Math.max(0,decimals));
    setTimeout(function(){
      var start=null;
      function frame(ts){
        if(start===null)start=ts;
        var t=clamp(0,(ts-start)/duration,1),e=1-Math.pow(1-t,3);
        el.textContent=formatMoney(target*e,decimals);
        if(t<1)requestAnimationFrame(frame);else el.textContent=targetText;
      }
      requestAnimationFrame(frame);
    },delay);
  }

  function animateFirstMoneyFlow(){
    if(reducedMotion())return;
    var host=document.getElementById('monthly-money-flow');
    if(!host||!isVisible(host))return;
    var startDelay=620,fillDuration=650,stagger=58;
    Array.prototype.forEach.call(host.querySelectorAll('.mf-fill'),function(fill,i){
      var target=fill.style.width||'';if(!target)return;
      fill.style.transition='none';fill.style.width='0%';
      try{void fill.getBoundingClientRect().width;}catch(_){}
      requestAnimationFrame(function(){
        fill.style.transition='width '+fillDuration+'ms '+EASE+' '+(startDelay+i*stagger)+'ms';
        fill.style.width=target;
      });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.mf-val'),function(el,i){
      var target=String(el.textContent||'');if(parseMoneyText(target)===null)return;
      var decimals=target.indexOf('.')>=0?2:0;
      el.textContent=formatMoney(0,decimals);
      animateValue(el,target,startDelay+i*stagger,fillDuration);
    });
  }

  function hasSummaryMarks(svg){return !!(svg&&svg.querySelector('.rt-chart-primary-bar'));}
  function hasSalesMarks(svg){return !!(svg&&svg.querySelector('.rt-chart-line,.rt-sales-forecast-ring,path[data-series],polyline'));}

  function runFirstSummaryReveal(){
    if(initialSummaryDone)return true;
    var page=document.getElementById('p-summary');
    var svg=document.getElementById('summary-chart-svg-mobile')||document.getElementById('summary-chart-svg');
    if(!isVisible(page)||!isVisible(svg)||!hasSummaryMarks(svg))return false;
    initialSummaryDone=true;
    enforceThirtyDayGaps(svg,Array.prototype.slice.call(svg.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar)')));
    restartSvgMotion(svg);
    return true;
  }

  function runFirstSalesReveal(){
    if(initialSalesDone)return true;
    var page=document.getElementById('p-monthly'),svg=document.getElementById('monthly-profitability-svg');
    if(!isVisible(page)||!isVisible(svg)||!hasSalesMarks(svg))return false;
    initialSalesDone=true;
    restartSvgMotion(svg);
    animateFirstMoneyFlow();
    return true;
  }

  /* The production app can render chart data before its loading surface has
     finished handing off. Waiting for a short quiet window after DOM changes
     makes the motion belong to the real-layout reveal instead of happening
     invisibly behind the loading state. */
  var revealTimer=0;
  function scheduleInitialReveal(delay){
    if(revealTimer)clearTimeout(revealTimer);
    revealTimer=setTimeout(function(){
      revealTimer=0;
      runFirstSummaryReveal();
      runFirstSalesReveal();
    },delay==null?140:delay);
  }
  var observer=null;
  try{
    observer=new MutationObserver(function(){
      if(initialSummaryDone&&initialSalesDone){observer.disconnect();return;}
      scheduleInitialReveal(140);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-busy']});
  }catch(_){}
  window.addEventListener('load',function(){scheduleInitialReveal(180);},{once:true});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)scheduleInitialReveal(80);});
  scheduleInitialReveal(document.readyState==='complete'?180:260);

  /* Keep the 30-day spacing rule applied after every period render. */
  var _renderBeforeReveal=_renderChartInto;
  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    var out=_renderBeforeReveal.apply(this,arguments);
    if(isDashboardBars(opts))enforceThirtyDayGaps(svgEl,labels);
    if(isSalesChart(svgEl,opts)&&!initialSalesDone)scheduleInitialReveal(120);
    if(isDashboardBars(opts)&&!initialSummaryDone)scheduleInitialReveal(120);
    return out;
  };
})();
