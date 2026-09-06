/* RETRADE chart motion + forecast pass v1.4.40
 * Loaded after chart-polish.js. This file deliberately stays presentation-only:
 * - 30 day Command Centre uses real daily buckets (7 day was already daily)
 * - Dashboard refunds are event dots only; no implied connecting trend
 * - Bar motion is slightly slower, but long daily series use a capped stagger
 * - Dashboard forecast shells grow from the achieved value toward forecast
 * - Sales monthly/yearly line chart projects the current month and reuses the
 *   existing dash-by-dash partial-tail reveal toward the forecast endpoint
 * - Sales profit-breakdown bars and values animate on first reveal / period switch
 *
 * Accounting, sync, inventory lifecycle and persisted data are untouched.
 */
(function(){
  'use strict';

  var NS='http://www.w3.org/2000/svg';
  function num(v){v=Number(v);return isFinite(v)?v:0;}
  function clamp(min,v,max){return Math.max(min,Math.min(max,v));}
  function reducedMotion(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }
  function money(v,decimals){
    v=num(v);var neg=v<0,a=Math.abs(v);
    var s='£'+a.toLocaleString('en-GB',{minimumFractionDigits:decimals,maximumFractionDigits:decimals});
    return (neg?'−':'')+s;
  }
  function compactMoney(v){
    v=num(v);var neg=v<0,a=Math.abs(v),s;
    if(a>=1000000){var m=a/1000000;s='£'+m.toFixed(m>=10||Math.abs(m-Math.round(m))<.01?0:1)+'m';}
    else if(a>=1000){var k=a/1000;s='£'+k.toFixed(k>=10||Math.abs(k-Math.round(k))<.01?0:1)+'k';}
    else s='£'+Math.round(a);
    return (neg?'−':'')+s;
  }
  function dateAdd(ds,days){
    var p=String(ds||'').split('-');
    if(p.length!==3)return ds;
    var d=new Date(Number(p[0]),Number(p[1])-1,Number(p[2]),12,0,0,0);
    d.setDate(d.getDate()+days);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }
  function shortDate(ds){
    var p=String(ds||'').split('-');
    return p.length===3?(Number(p[1])+'/'+Number(p[2])):String(ds||'');
  }

  function installStyles(){
    if(document.getElementById('rt-chart-motion-v1440'))return;
    var s=document.createElement('style');
    s.id='rt-chart-motion-v1440';
    s.textContent='\
/* Dashboard refund = isolated event, not a continuous trend. */\
#p-summary .summary-chart-legend .legend-event-mark{display:inline-block!important;width:7px!important;height:7px!important;background:var(--red)!important;border:0!important;border-radius:50%!important;opacity:.92!important;}\
#p-summary .rt-chart-refund-dot{fill:var(--red);stroke:var(--surface-1);stroke-width:1.15;opacity:.9;vector-effect:non-scaling-stroke;}\
/* Calm, slightly slower operational motion. Per-mark delay is supplied in JS so a 30-day daily chart never takes two seconds to finish. */\
@keyframes rtRevenueBarV1440{from{transform:scaleY(.02);opacity:.14}to{transform:scaleY(1);opacity:1}}\
@keyframes rtProfitBarV1440{from{transform:scaleY(.02);opacity:.10}to{transform:scaleY(1);opacity:1}}\
@keyframes rtForecastGrowV1440{from{transform:scaleY(var(--rt-forecast-start,.55));opacity:.28}to{transform:scaleY(1);opacity:1}}\
@keyframes rtRefundDotV1440{from{opacity:0;transform:scale(.55)}to{opacity:.9;transform:scale(1)}}\
#p-summary svg.rt-chart-draw .rt-chart-primary-bar:not(.rt-chart-profit-bar):not(.rt-chart-forecast-shell),\
#p-summary svg.rt-chart-draw .rt-chart-primary-actual{animation:rtRevenueBarV1440 560ms cubic-bezier(.22,.61,.36,1) both!important;animation-delay:var(--rt-bar-delay,0ms)!important;}\
#p-summary svg.rt-chart-draw .rt-chart-profit-bar:not(.rt-chart-forecast-shell),\
#p-summary svg.rt-chart-draw .rt-chart-profit-actual{animation:rtProfitBarV1440 470ms cubic-bezier(.22,.61,.36,1) both!important;animation-delay:calc(var(--rt-bar-delay,0ms) + 82ms)!important;}\
#p-summary svg.rt-chart-draw .rt-chart-forecast-shell{animation:rtForecastGrowV1440 430ms cubic-bezier(.22,.61,.36,1) both!important;animation-delay:calc(var(--rt-bar-delay,0ms) + 350ms)!important;}\
#p-summary svg.rt-chart-draw .rt-chart-refund-dot{transform-box:fill-box;transform-origin:center;animation:rtRefundDotV1440 220ms ease-out both!important;animation-delay:430ms!important;}\
/* Sales forecast: filled dot = achieved current month; hollow ring = projected finish. */\
#p-monthly .rt-sales-actual-dot{stroke:var(--surface-1);stroke-width:1.6;vector-effect:non-scaling-stroke;}\
#p-monthly .rt-sales-forecast-ring{fill:var(--surface-1);stroke-width:1.8;vector-effect:non-scaling-stroke;opacity:.96;}\
#p-monthly .rt-sales-forecast-label{font-family:var(--font-body);fill:var(--text-tertiary);font-weight:600;letter-spacing:.01em;}\
@keyframes rtSalesForecastPointIn{from{opacity:0;transform:scale(.65)}to{opacity:1;transform:scale(1)}}\
#p-monthly svg.rt-chart-draw .rt-sales-forecast-ring,#p-monthly svg.rt-chart-draw .rt-sales-forecast-label{transform-box:fill-box;transform-origin:center;animation:rtSalesForecastPointIn 300ms ease-out both;animation-delay:900ms;}\
/* Profit breakdown gets a real data reveal rather than appearing fully drawn. */\
#p-monthly .mf-fill{transform-origin:left center;will-change:width;}\
#p-monthly .mf-val{font-variant-numeric:tabular-nums;}\
@media(prefers-reduced-motion:reduce){\
 #p-summary svg.rt-chart-draw .rt-chart-primary-bar,#p-summary svg.rt-chart-draw .rt-chart-actual-overlay,#p-summary svg.rt-chart-draw .rt-chart-forecast-shell,#p-summary svg.rt-chart-draw .rt-chart-refund-dot,\
 #p-monthly svg.rt-chart-draw .rt-sales-forecast-ring,#p-monthly svg.rt-chart-draw .rt-sales-forecast-label{animation:none!important;transform:none!important;opacity:1!important;}\
 #p-monthly .mf-fill{transition:none!important;}\
}';
    document.head.appendChild(s);
  }
  installStyles();

  // -------------------------------------------------------------------------
  // Command Centre: Last 30 days should answer "what happened each day?".
  // Rebuild only the chart series. Headline KPIs still use the canonical stats.
  // -------------------------------------------------------------------------
  function buildDaily30(){
    if(typeof getSummaryDateRange!=='function'||typeof getSaleEventsInRange!=='function'||typeof _saleBreakdown!=='function')return null;
    var tf=getSummaryDateRange();
    if(!tf||!tf.from||!tf.to)return null;
    var events;
    try{events=getSaleEventsInRange(tf.from,tf.to)||[];}catch(_){return null;}
    var labels=[],rev=[],profit=[],refunds=[],counts=[],handlers=[];
    for(var day=tf.from;day<=tf.to;day=dateAdd(day,1)){
      var inDay=events.filter(function(e){return e&&e.saleDate===day;});
      var r=0,p=0,rf=0,rc=0;
      inDay.forEach(function(e){
        if(e.isReturnAdjustment){rf+=Math.max(0,-num(e.salePrice));rc++;return;}
        var b;
        try{b=_saleBreakdown(e);}catch(_){b=null;}
        if(!b)return;
        r+=num(b.salePrice)+num(b.postage);
        p+=num(b.netProfit);
      });
      var label=shortDate(day);
      labels.push(label);rev.push(+r.toFixed(2));profit.push(+p.toFixed(2));refunds.push(+rf.toFixed(2));counts.push(rc);
      handlers.push(inDay.length?{fn:'showRangeSnapshot',args:[label,day,day]}:null);
      if(day===tf.to)break; // ISO dates sort lexically; also protects malformed ranges.
    }
    return {labels:labels,rev:rev,profit:profit,refunds:refunds,counts:counts,handlers:handlers};
  }

  if(typeof renderSummaryChart==='function'){
    var _renderSummaryChartV1439=renderSummaryChart;
    renderSummaryChart=function(labels,revData,profitData,returnData,returnCounts,partialLast){
      var is30=false;
      try{is30=(typeof SUMMARY_PERIOD!=='undefined'&&SUMMARY_PERIOD==='30d');}catch(_){}
      if(is30){
        var d=buildDaily30();
        if(d&&d.labels.length){
          window.__chartClickHandlers=d.handlers;
          return _renderSummaryChartV1439.call(this,d.labels,d.rev,d.profit,d.refunds,d.counts,partialLast);
        }
      }
      return _renderSummaryChartV1439.apply(this,arguments);
    };
  }

  // -------------------------------------------------------------------------
  // Sales current-month projection. Pace is blended with the last three
  // completed months so an early-month spike does not create a silly forecast.
  // -------------------------------------------------------------------------
  function monthProgress(){
    var now=new Date(),dim=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    var frac=(now.getHours()+now.getMinutes()/60+now.getSeconds()/3600)/24;
    return clamp(.035,((now.getDate()-1)+frac)/dim,1);
  }
  function weightedHistory(series){
    var vals=(series||[]).slice(0,-1).filter(function(v){return isFinite(Number(v));}).slice(-3);
    if(!vals.length)return null;
    var sum=0,w=0;
    vals.forEach(function(v,i){var ww=i+1;sum+=num(v)*ww;w+=ww;});
    return w?sum/w:null;
  }
  function projectMonth(series,isRevenue){
    if(!series||!series.length)return 0;
    var actual=num(series[series.length-1]),progress=monthProgress();
    var pace=actual/progress,hist=weightedHistory(series);
    // Trust current pace more as the month develops. On day 1-3 the recent
    // completed months prevent an unstable annual-looking spike.
    var paceWeight=clamp(.34,progress*2.55,.74);
    var forecast=hist===null?pace:(pace*paceWeight+hist*(1-paceWeight));
    if(hist!==null&&Math.abs(hist)>1){
      var cap=Math.abs(hist)*3.25+Math.abs(actual);
      forecast=clamp(-cap,forecast,cap);
    }
    if(isRevenue&&actual>=0)forecast=Math.max(actual,forecast);
    return forecast;
  }
  function salesForecast(revData,profitData,opts){
    if(!opts||opts.partialLast!==true||!revData||revData.length<2)return null;
    var ar=num(revData[revData.length-1]),ap=num(profitData[profitData.length-1]);
    var fr=projectMonth(revData,true),fp=projectMonth(profitData,false);
    if(Math.abs(fr-ar)<.5&&Math.abs(fp-ap)<.5)return null;
    return {rev:fr,profit:fp,actualRev:ar,actualProfit:ap};
  }
  function baseLineGeometry(revData,profitData,opts){
    var W=opts.W,H=opts.H,pad=opts.pad,n=revData.length,innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b;
    var tert=(Array.isArray(opts.tertiaryData)&&!opts.tertiaryEvents)?opts.tertiaryData:[];
    var rawMax=Math.max.apply(Math,[0].concat(revData,profitData,tert).map(num));
    var rawMin=Math.min.apply(Math,[0].concat(revData,profitData,tert).map(num));
    function niceBound(v){
      v=Math.abs(v);if(v<=0)return 0;
      var mag=Math.pow(10,Math.floor(Math.log10(v))),norm=v/mag;
      return (norm<=1?1:norm<=2?2:norm<=5?5:10)*mag;
    }
    var yMax=niceBound(rawMax)||100,yMin=rawMin<0?-niceBound(rawMin):0;
    if(yMin===yMax){yMin=0;yMax=100;}
    var yr=(yMax-yMin)||1,step=n>1?innerW/(n-1):0;
    return {
      W:W,H:H,pad:pad,innerW:innerW,
      sx:function(i){return n>1?pad.l+i*step:pad.l+innerW/2;},
      sy:function(v){return pad.t+innerH-((num(v)-yMin)/yr)*innerH;}
    };
  }
  function addSalesForecastOverlay(svgEl,labels,actualRev,actualProfit,forecast,opts,forecastRev,forecastProfit){
    if(!svgEl||!forecast)return;
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-so-far'),function(n){n.remove();});
    var g=baseLineGeometry(forecastRev,forecastProfit,opts),last=labels.length-1,x=g.sx(last);
    var before=svgEl.querySelector('.rt-chart-scrub');
    function dot(y,color,cls,r){
      var c=document.createElementNS(NS,'circle');c.setAttribute('class',cls);c.setAttribute('cx',x.toFixed(1));c.setAttribute('cy',y.toFixed(1));c.setAttribute('r',r);c.setAttribute('fill',color);c.setAttribute('stroke',color);return c;
    }
    var layer=document.createElementNS(NS,'g');layer.setAttribute('class','rt-sales-forecast-layer');
    var actualR=dot(g.sy(forecast.actualRev),'var(--state-listed)','rt-sales-actual-dot',3.5);
    var actualP=dot(g.sy(forecast.actualProfit),'var(--profit)','rt-sales-actual-dot',3.2);
    var forecastR=dot(g.sy(forecast.rev),'var(--surface-1)','rt-sales-forecast-ring',4.3);forecastR.setAttribute('stroke','var(--state-listed)');
    var forecastP=dot(g.sy(forecast.profit),'var(--surface-1)','rt-sales-forecast-ring',3.9);forecastP.setAttribute('stroke','var(--profit)');
    layer.appendChild(actualR);layer.appendChild(actualP);layer.appendChild(forecastR);layer.appendChild(forecastP);
    var t=document.createElementNS(NS,'text');
    t.setAttribute('class','rt-sales-forecast-label');
    t.setAttribute('x',(x-4).toFixed(1));
    t.setAttribute('y',Math.max(opts.pad.t+opts.fontSize,g.sy(forecast.rev)-9).toFixed(1));
    t.setAttribute('text-anchor','end');t.setAttribute('font-size',Math.max(10,Math.round(opts.fontSize*.9)));
    t.textContent='Forecast '+compactMoney(forecast.rev);layer.appendChild(t);
    svgEl.insertBefore(layer,before||null);
    svgEl.setAttribute('aria-label','Monthly net revenue and net profit with current-month forecast');

    // The visual endpoint is forecast, but scrubbing the current month should
    // still report what has actually happened so far. Forecast is stated by the
    // label/rings rather than silently replacing accounting data in the tooltip.
    if(typeof _setupChartScrub==='function'){
      try{
        _setupChartScrub(svgEl,{
          W:g.W,pad:g.pad,innerW:g.innerW,n:labels.length,sx:g.sx,sy:g.sy,
          revData:actualRev,profitData:actualProfit,labels:labels,
          primaryColor:opts.primaryColor||'var(--state-listed)',secondaryColor:opts.secondaryColor||'var(--profit)',
          primaryLabel:opts.primaryLabel||'Net Revenue',secondaryLabel:opts.secondaryLabel||'Net Profit',
          tertiaryData:Array.isArray(opts.tertiaryData)?opts.tertiaryData:null,
          tertiaryColor:opts.tertiaryColor||'var(--red)',tertiaryLabel:opts.tertiaryLabel||'Refunds',
          tertiaryCounts:Array.isArray(opts.tertiaryCounts)?opts.tertiaryCounts:null,
          tertiaryEvents:!!opts.tertiaryEvents,tertiaryEventY:NaN,
          extraTooltipData:Array.isArray(opts.extraTooltipData)?opts.extraTooltipData:null,
          extraTooltipLabel:opts.extraTooltipLabel||'Gross Profit',extraTooltipColor:opts.extraTooltipColor||'var(--text-secondary)'
        });
      }catch(_){}
    }
    var cols=svgEl.querySelectorAll('.rt-chart-col'),col=cols[last];
    if(col){
      var title=col.querySelector('title');
      if(title)title.textContent=String(labels[last]||'Current month')+' · Net Revenue actual '+money(forecast.actualRev,2)+' · forecast '+money(forecast.rev,2)+' · Net Profit actual '+money(forecast.actualProfit,2)+' · forecast '+money(forecast.profit,2);
    }
  }

  function isDashboardBars(opts){
    return !!(opts&&opts.primaryBars&&opts.secondaryBarsInPrimary&&opts.primaryLabel==='Gross Revenue'&&opts.secondaryLabel==='Gross Profit');
  }
  function parseIndex(el){
    if(!el)return -1;var s='';try{s=el.style.getPropertyValue('--bar-i');}catch(_){}
    var i=parseInt(s,10);return isFinite(i)?i:-1;
  }
  function tuneDashboardMarks(svgEl,n,opts){
    if(!svgEl||!n)return;
    // Refund circles remain at their real £ Y-position, but the connecting path
    // is removed because a refund is an event, not a continuous state.
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-refund-trend'),function(p){p.remove();});
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-so-far'),function(t){t.remove();});

    var mobile=svgEl.id==='summary-chart-svg-mobile';
    var vb=svgEl.viewBox&&svgEl.viewBox.baseVal?svgEl.viewBox.baseVal:null;
    var W=vb&&vb.width?vb.width:num(svgEl.getAttribute('width'))||opts.W;
    var pad=mobile?{l:48,r:12}:{l:58,r:18},band=(W-pad.l-pad.r)/Math.max(1,n);
    var sx=function(i){return pad.l+band*(i+.5);};
    var isDaily30=(opts.drawKey==='30d'&&n>=24);
    var blueW=isDaily30?Math.max(3.5,Math.min(mobile?8:16,band*.68)):null;
    var greenW=blueW?Math.max(2.5,blueW*.58):null;

    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-primary-bar'),function(rect){
      var i=parseIndex(rect);if(i<0)return;
      // Long 30-day series gets a shorter stagger; shorter series can breathe.
      var stagger=isDaily30?18:(n>12?26:45);
      rect.style.setProperty('--rt-bar-delay',(i*stagger)+'ms');
      if(blueW){
        var w=rect.classList.contains('rt-chart-profit-bar')?greenW:blueW;
        rect.setAttribute('width',w.toFixed(1));rect.setAttribute('x',(sx(i)-w/2).toFixed(1));
        rect.setAttribute('rx',Math.min(rect.classList.contains('rt-chart-profit-bar')?2.2:3,w*.22).toFixed(1));
      }
    });
    // Forecast shell begins exactly at the achieved height and then extends to
    // the calculated finish, rather than simply fading a full dashed box in.
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-forecast-shell'),function(shell){
      var i=parseIndex(shell),isProfit=shell.classList.contains('rt-chart-profit-bar');
      var candidates=svgEl.querySelectorAll(isProfit?'.rt-chart-profit-actual':'.rt-chart-primary-actual');
      var actual=null;
      Array.prototype.some.call(candidates,function(c){if(parseIndex(c)===i){actual=c;return true;}return false;});
      if(actual){
        var sh=Math.max(.1,num(shell.getAttribute('height'))),ah=Math.max(.1,num(actual.getAttribute('height')));
        shell.style.setProperty('--rt-forecast-start',clamp(.04,ah/sh,3).toFixed(3));
      }
    });
    var dots=svgEl.querySelectorAll('.rt-chart-refund-dot');
    Array.prototype.forEach.call(dots,function(d,i){d.style.animationDelay=(430+i*35)+'ms';});
  }

  if(typeof _renderChartInto==='function'){
    var _renderChartIntoV1439=_renderChartInto;
    _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
      var isSales=!!(svgEl&&svgEl.id==='monthly-profitability-svg'&&opts&&opts.primaryLabel==='Net Revenue'&&opts.secondaryLabel==='Net Profit');
      if(isSales){
        var fc=salesForecast(revData,profitData,opts);
        if(fc){
          var ar=revData.slice(),ap=profitData.slice(),fr=revData.slice(),fp=profitData.slice(),last=fr.length-1;
          fr[last]=fc.rev;fp[last]=fc.profit;
          var result=_renderChartIntoV1439.call(this,svgEl,labels,fr,fp,handlers,opts);
          addSalesForecastOverlay(svgEl,labels,ar,ap,fc,opts,fr,fp);
          return result;
        }
      }
      var result=_renderChartIntoV1439.apply(this,arguments);
      if(isDashboardBars(opts))tuneDashboardMarks(svgEl,labels.length,opts);
      return result;
    };
  }

  // -------------------------------------------------------------------------
  // Sales Profit breakdown — animate once for the current DOM/period. A sync
  // refresh with the same host and same period stays calm; a period switch or
  // freshly opened Sales page reveals again.
  // -------------------------------------------------------------------------
  var _moneyHost=null,_moneyPeriod=null;
  function parseMoneyText(s){
    s=String(s||'').replace(/,/g,'');
    var neg=/[−-]/.test(s),m=s.match(/\d+(?:\.\d+)?/);
    if(!m)return null;var v=Number(m[0]);return isFinite(v)?(neg?-v:v):null;
  }
  function animateValue(el,targetText,delay){
    var target=parseMoneyText(targetText);if(target===null)return;
    var decimals=(String(targetText).split('.')[1]||'').replace(/[^0-9].*$/,'').length;
    decimals=Math.min(2,Math.max(0,decimals));
    var dur=680,start=null;
    function frame(ts){
      if(start===null)start=ts;
      var t=clamp(0,(ts-start)/dur,1),e=1-Math.pow(1-t,3),v=target*e;
      el.textContent=money(v,decimals);
      if(t<1)requestAnimationFrame(frame);else el.textContent=targetText;
    }
    setTimeout(function(){requestAnimationFrame(frame);},delay);
  }
  function animateMoneyFlow(host){
    if(!host||reducedMotion())return;
    var fills=host.querySelectorAll('.mf-fill');
    Array.prototype.forEach.call(fills,function(fill,i){
      var target=fill.style.width||getComputedStyle(fill).width;
      fill.style.transition='none';fill.style.width='0%';
      // Force the 0 state before transitioning to the real percentage.
      try{void fill.getBoundingClientRect().width;}catch(_){}
      requestAnimationFrame(function(){
        fill.style.transition='width 680ms cubic-bezier(.22,.61,.36,1) '+(i*55)+'ms';
        fill.style.width=target;
      });
    });
    var vals=host.querySelectorAll('.mf-val');
    Array.prototype.forEach.call(vals,function(el,i){
      var target=el.textContent;el.textContent=money(0,(target.indexOf('.')>=0?2:0));
      animateValue(el,target,80+i*55);
    });
  }
  if(typeof renderMonthlyMoneyFlow==='function'){
    var _renderMonthlyMoneyFlowV1439=renderMonthlyMoneyFlow;
    renderMonthlyMoneyFlow=function(){
      var ret=_renderMonthlyMoneyFlowV1439.apply(this,arguments);
      var host=document.getElementById('monthly-money-flow'),key='';
      try{key=(typeof MONTHLY_PERIOD!=='undefined'?String(MONTHLY_PERIOD):'');}catch(_){}
      var should=!!host&&(host!==_moneyHost||key!==_moneyPeriod);
      _moneyHost=host;_moneyPeriod=key;
      if(should)animateMoneyFlow(host);
      return ret;
    };
  }
})();
