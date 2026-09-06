/* RETRADE Command Centre chart polish v1.4.39
 * Dashboard-only enhancement layered over the existing renderer:
 * - band-centred blue revenue bars with inset green gross-profit bars
 * - thin red refund trend line instead of side-by-side refund columns
 * - current-period forecast shell based on a 14-day weighted run-rate
 * - tighter money axis, responsive geometry and restrained motion
 *
 * Accounting, sync and lifecycle logic stay in app-core.js unchanged.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto !== 'function' || typeof _setupChartScrub !== 'function') return;

  var _legacyRenderChartInto = _renderChartInto;
  var NS = 'http://www.w3.org/2000/svg';

  function clamp(min,value,max){return Math.max(min,Math.min(max,value));}
  function num(v){v=Number(v);return isFinite(v)?v:0;}
  function isDashboardBars(opts){
    return !!(opts && opts.primaryBars && opts.secondaryBarsInPrimary &&
      opts.primaryLabel==='Gross Revenue' && opts.secondaryLabel==='Gross Profit');
  }
  function cssSize(svgEl,fallbackW,fallbackH){
    var r;try{r=svgEl.getBoundingClientRect();}catch(_){r=null;}
    var w=r&&r.width>=260?Math.round(r.width):fallbackW;
    var h=r&&r.height>=150?Math.round(r.height):fallbackH;
    return {w:w,h:h};
  }
  function niceStep(raw){
    if(!isFinite(raw)||raw<=0)return 1;
    var exp=Math.floor(Math.log10(raw)),mag=Math.pow(10,exp),f=raw/mag,nf;
    if(f<1.5)nf=1;else if(f<2.25)nf=2;else if(f<3.75)nf=2.5;else if(f<7.5)nf=5;else nf=10;
    return nf*mag;
  }
  function nextNiceStep(step){
    if(!isFinite(step)||step<=0)return 1;
    var exp=Math.floor(Math.log10(step)),mag=Math.pow(10,exp),f=step/mag;
    if(f<1.5)return 2*mag;if(f<2.25)return 2.5*mag;if(f<3.75)return 5*mag;if(f<7.5)return 10*mag;
    return 20*mag;
  }
  function buildScale(revData,profitData,refundData,targetIntervals,forecast){
    var vals=[0];
    (revData||[]).forEach(function(v){vals.push(num(v));});
    (profitData||[]).forEach(function(v){vals.push(num(v));});
    (refundData||[]).forEach(function(v){vals.push(Math.max(0,num(v)));});
    if(forecast){vals.push(num(forecast.rev));vals.push(num(forecast.profit));}
    var rawMax=Math.max.apply(Math,vals);
    var rawMin=Math.min.apply(Math,[0].concat((revData||[]).map(num),(profitData||[]).map(num),forecast?[num(forecast.profit)]:[]));
    if(rawMax<=0&&rawMin>=0)return {min:0,max:100,step:50,ticks:[0,50,100]};
    var target=Math.max(2,targetIntervals||3),paddedMax=rawMax>0?rawMax*1.05:0,paddedMin=rawMin<0?rawMin*1.05:0;
    var step=niceStep((paddedMax-paddedMin)/target||1);
    var yMin=rawMin<0?Math.floor(paddedMin/step)*step:0;
    var yMax=Math.ceil(paddedMax/step)*step;
    if(yMax<=yMin)yMax=yMin+step;
    var intervals=Math.round((yMax-yMin)/step);
    if(intervals>target+1){
      step=nextNiceStep(step);
      yMin=rawMin<0?Math.floor(paddedMin/step)*step:0;
      yMax=Math.ceil(paddedMax/step)*step;
      intervals=Math.round((yMax-yMin)/step);
    }
    intervals=Math.max(1,intervals);
    var ticks=[];
    for(var i=0;i<=intervals;i++)ticks.push(yMin+i*step);
    ticks=ticks.filter(function(v){return v<=yMax+Math.abs(step)*.001;});
    return {min:yMin,max:yMax,step:step,ticks:ticks};
  }
  function fmtAxisMoney(v){
    v=num(v);if(Math.abs(v)<.00001)return '£0';
    var sign=v<0?'−':'',a=Math.abs(v);
    if(a>=1000000){var m=a/1000000;return sign+'£'+m.toFixed(m>=10||Math.abs(m-Math.round(m))<.001?0:1)+'m';}
    if(a>=1000){var k=a/1000;return sign+'£'+k.toFixed(k>=10||Math.abs(k-Math.round(k))<.001?0:1)+'k';}
    if(a>=10||Math.abs(a-Math.round(a))<.001)return sign+'£'+Math.round(a);
    return sign+'£'+a.toFixed(1);
  }
  function fmtForecastMoney(v){
    v=Math.max(0,num(v));
    return '£'+v.toLocaleString('en-GB',{maximumFractionDigits:v>=100?0:2,minimumFractionDigits:0});
  }
  function setRectY(rect,value,sy){
    if(!rect)return;
    var y0=sy(0),yv=sy(value),h=Math.max(1.5,Math.abs(y0-yv));
    rect.setAttribute('y',Math.min(y0,yv).toFixed(1));
    rect.setAttribute('height',h.toFixed(1));
  }
  function parseBarIndex(el){
    if(!el)return -1;
    var raw='';try{raw=el.style.getPropertyValue('--bar-i');}catch(_){}
    var i=parseInt(raw,10);return isFinite(i)?i:-1;
  }
  function axisMarkup(W,H,pad,fontSize,scale,sy){
    var out='<g class="rt-polished-axis" aria-hidden="true">';
    scale.ticks.forEach(function(v){
      var y=sy(v).toFixed(1),isZero=Math.abs(v)<Math.abs(scale.step)*.001;
      out+='<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+y+'" y2="'+y+'" stroke="var(--border)" stroke-width="1" opacity="'+(isZero?'.52':'.28')+'"/>';
      out+='<text x="'+(pad.l-Math.round(fontSize*.9))+'" y="'+(sy(v)+fontSize*.27).toFixed(1)+'" font-size="'+fontSize+'" fill="var(--text-tertiary)" text-anchor="end" font-family="var(--font-body)" style="font-variant-numeric:tabular-nums">'+fmtAxisMoney(v)+'</text>';
    });
    return out+'</g>';
  }
  function isoShift(ds,days){
    var d=new Date(ds+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
  }
  function todayISO(){return new Date().toISOString().slice(0,10);}
  function dayProgress(){
    var d=new Date();
    var sec=d.getHours()*3600+d.getMinutes()*60+d.getSeconds();
    return clamp(.08,sec/86400,.995);
  }
  function recentDailyRunRate(){
    if(typeof getSaleEventsInRange!=='function'||typeof _saleBreakdown!=='function')return null;
    var today=todayISO(),start=isoShift(today,-14),end=isoShift(today,-1),events=[];
    try{events=getSaleEventsInRange(start,end)||[];}catch(_){return null;}
    var daily={};
    for(var age=1;age<=14;age++)daily[isoShift(today,-age)]={rev:0,profit:0};
    events.forEach(function(ev){
      if(!ev||ev.isReturnAdjustment)return;
      var ds=ev.saleDate;if(!daily[ds])return;
      try{
        var b=_saleBreakdown(ev)||{};
        daily[ds].rev+=(num(b.salePrice)+num(b.postage));
        daily[ds].profit+=num(b.netProfit);
      }catch(_){}
    });
    var wSum=0,rev=0,profit=0;
    for(var a=1;a<=14;a++){
      var key=isoShift(today,-a),row=daily[key]||{rev:0,profit:0};
      var w=Math.pow(.5,a/7);
      wSum+=w;rev+=row.rev*w;profit+=row.profit*w;
    }
    if(wSum<=0)return null;
    return {rev:rev/wSum,profit:profit/wSum};
  }
  function buildForecast(revData,profitData,opts){
    if(!opts||opts.partialLast!==true||!revData.length)return null;
    var rate=recentDailyRunRate();if(!rate)return null;
    var progress=dayProgress(),remaining=1-progress,label='Forecast';
    if(opts.drawKey==='current_fy'){
      var now=new Date(),daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
      remaining=Math.max(0,(daysInMonth-now.getDate())+(1-progress));
      label='Month forecast';
    }
    var last=revData.length-1;
    var actualRev=num(revData[last]),actualProfit=num(profitData[last]);
    var forecastRev=actualRev+Math.max(0,rate.rev)*remaining;
    var forecastProfit=actualProfit+rate.profit*remaining;
    if(Math.abs(forecastRev-actualRev)<.5&&Math.abs(forecastProfit-actualProfit)<.5)return null;
    return {
      rev:Math.max(actualRev,forecastRev),
      profit:forecastProfit,
      actualRev:actualRev,
      actualProfit:actualProfit,
      remaining:remaining,
      label:label
    };
  }
  function installStyles(){
    var old=document.getElementById('rt-chart-polish-v1438');if(old)old.remove();
    if(document.getElementById('rt-chart-polish-v1439'))return;
    var s=document.createElement('style');s.id='rt-chart-polish-v1439';
    s.textContent='\
#p-summary .summary-chart-legend .legend-event-mark{display:inline-block;width:14px;height:0;background:none!important;border:0!important;border-top:1.6px solid var(--red)!important;border-radius:999px!important;box-sizing:border-box;opacity:.78;}\
#p-summary .rt-chart-primary-bar,#p-summary .rt-chart-profit-bar,#p-summary .rt-chart-actual-overlay,#p-summary .rt-chart-forecast-shell{will-change:transform,opacity;}\
#p-summary .rt-chart-forecast-shell{fill-opacity:.10!important;stroke-dasharray:4 3!important;stroke-opacity:.56!important;}\
#p-summary .rt-chart-actual-overlay{pointer-events:none;}\
#p-summary .rt-chart-refund-trend{fill:none;stroke:var(--red);stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round;opacity:.62;vector-effect:non-scaling-stroke;}\
#p-summary .rt-chart-refund-dot{fill:var(--red);stroke:var(--surface-1);stroke-width:1.2;opacity:.90;vector-effect:non-scaling-stroke;}\
#p-summary .rt-chart-forecast-label{font-family:var(--font-body);fill:var(--text-tertiary);font-weight:600;letter-spacing:.01em;}\
@keyframes rtRevenueBarPolishIn{from{transform:scaleY(.025);opacity:.18}to{transform:scaleY(1);opacity:1}}\
@keyframes rtProfitBarPolishIn{from{transform:scaleY(.025);opacity:.12}to{transform:scaleY(1);opacity:1}}\
@keyframes rtForecastShellIn{from{opacity:0}to{opacity:1}}\
@keyframes rtRefundTrendDraw{from{stroke-dashoffset:var(--rt-refund-len)}to{stroke-dashoffset:0}}\
@keyframes rtRefundDotIn{from{opacity:0;transform:scale(.5)}to{opacity:.9;transform:scale(1)}}\
#p-summary svg.rt-chart-draw .rt-chart-primary-bar:not(.rt-chart-profit-bar):not(.rt-chart-forecast-shell),#p-summary svg.rt-chart-draw .rt-chart-primary-actual{animation:rtRevenueBarPolishIn 420ms cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--bar-i) * 38ms);}\
#p-summary svg.rt-chart-draw .rt-chart-profit-bar:not(.rt-chart-forecast-shell),#p-summary svg.rt-chart-draw .rt-chart-profit-actual{animation:rtProfitBarPolishIn 360ms cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--bar-i) * 38ms + 68ms);}\
#p-summary svg.rt-chart-draw .rt-chart-forecast-shell{animation:rtForecastShellIn 260ms ease-out both;animation-delay:calc(var(--bar-i) * 38ms + 115ms);}\
#p-summary svg.rt-chart-draw .rt-chart-refund-trend{stroke-dasharray:var(--rt-refund-len);animation:rtRefundTrendDraw 520ms cubic-bezier(.22,.61,.36,1) both;animation-delay:110ms;}\
#p-summary svg.rt-chart-draw .rt-chart-refund-dot{transform-box:fill-box;transform-origin:center;animation:rtRefundDotIn 180ms ease-out both;animation-delay:330ms;}\
@media(prefers-reduced-motion:reduce){#p-summary svg.rt-chart-draw .rt-chart-primary-bar,#p-summary svg.rt-chart-draw .rt-chart-actual-overlay,#p-summary svg.rt-chart-draw .rt-chart-forecast-shell,#p-summary svg.rt-chart-draw .rt-chart-refund-trend,#p-summary svg.rt-chart-draw .rt-chart-refund-dot{animation:none!important;transform:none!important;opacity:1!important;stroke-dashoffset:0!important;}}';
    document.head.appendChild(s);
  }
  function removeLegacyRefundMarks(svgEl){
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-refund-bar,.rt-chart-refund-event'),function(el){el.remove();});
  }
  function addRefundTrend(svgEl,refundData,sx,sy,n,beforeNode){
    if(!refundData||!n||!refundData.some(function(v){return num(v)>0;}))return;
    var d='';
    for(var i=0;i<n;i++)d+=(i===0?'M ':' L ')+sx(i).toFixed(1)+' '+sy(Math.max(0,num(refundData[i]))).toFixed(1);
    var g=document.createElementNS(NS,'g');g.setAttribute('class','rt-chart-refund-layer');
    var path=document.createElementNS(NS,'path');path.setAttribute('class','rt-chart-refund-trend');path.setAttribute('d',d);
    g.appendChild(path);
    refundData.forEach(function(v,i){
      v=Math.max(0,num(v));if(v<=0)return;
      var c=document.createElementNS(NS,'circle');
      c.setAttribute('class','rt-chart-refund-dot');c.setAttribute('cx',sx(i).toFixed(1));c.setAttribute('cy',sy(v).toFixed(1));c.setAttribute('r','2.8');
      g.appendChild(c);
    });
    svgEl.insertBefore(g,beforeNode||null);
    try{
      var len=path.getTotalLength();
      if(isFinite(len)&&len>0)path.style.setProperty('--rt-refund-len',len.toFixed(1)+'px');
    }catch(_){}
  }
  function cloneActualBar(rect,actual,sy,kind){
    if(!rect)return null;
    var clone=rect.cloneNode(false);
    clone.classList.remove('rt-chart-primary-bar--partial','rt-chart-forecast-shell');
    clone.classList.add('rt-chart-actual-overlay',kind==='profit'?'rt-chart-profit-actual':'rt-chart-primary-actual');
    clone.removeAttribute('stroke-dasharray');
    clone.setAttribute('stroke-opacity',kind==='profit'?'.82':'.90');
    clone.setAttribute('fill-opacity',kind==='profit'?'.82':'.78');
    setRectY(clone,actual,sy);
    rect.parentNode.insertBefore(clone,rect.nextSibling);
    return clone;
  }
  function addForecastTreatment(svgEl,revData,profitData,forecast,sy,fontSize,pad,W){
    var soFar=svgEl.querySelector('.rt-chart-so-far');if(soFar)soFar.remove();
    if(!forecast)return;
    var last=revData.length-1;
    var revenueBars=svgEl.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar)');
    var profitBars=svgEl.querySelectorAll('.rt-chart-profit-bar');
    var revRect=revenueBars[last]||null,profitRect=profitBars[last]||null;
    if(revRect){
      revRect.classList.add('rt-chart-forecast-shell');
      setRectY(revRect,forecast.rev,sy);
      cloneActualBar(revRect,forecast.actualRev,sy,'revenue');
    }
    if(profitRect){
      profitRect.classList.add('rt-chart-forecast-shell');
      setRectY(profitRect,forecast.profit,sy);
      cloneActualBar(profitRect,forecast.actualProfit,sy,'profit');
    }
    if(revRect){
      var x=num(revRect.getAttribute('x'))+num(revRect.getAttribute('width'))/2;
      var y=Math.max(pad.t+fontSize,sy(forecast.rev)-8);
      var t=document.createElementNS(NS,'text');
      t.setAttribute('class','rt-chart-forecast-label');
      t.setAttribute('x',clamp(pad.l+36,x,W-pad.r-36).toFixed(1));
      t.setAttribute('y',y.toFixed(1));
      t.setAttribute('text-anchor','middle');
      t.setAttribute('font-size',Math.max(10,Math.round(fontSize*.92)));
      t.textContent=(forecast.label||'Forecast')+' '+fmtForecastMoney(forecast.rev);
      var hit=svgEl.querySelectorAll('.rt-chart-col')[last];
      svgEl.insertBefore(t,hit||null);
    }
  }
  function polishDashboard(svgEl,labels,revData,profitData,handlers,opts,drawBefore){
    var n=labels.length;if(!n)return;
    var W=opts.W,H=opts.H,pad=opts.pad,fontSize=opts.fontSize;
    var innerW=W-pad.l-pad.r,innerH=H-pad.t-pad.b;
    var mobile=svgEl.id==='summary-chart-svg-mobile'||W<560;
    var bandW=innerW/Math.max(1,n);
    var sx=function(i){return pad.l+bandW*(i+.5);};
    var forecast=buildForecast(revData,profitData,opts);
    var refunds=Array.isArray(opts.tertiaryData)?opts.tertiaryData:[];
    var scale=buildScale(revData,profitData,refunds,mobile?(H<215?2:3):4,forecast);
    var yRange=(scale.max-scale.min)||1;
    var sy=function(v){return pad.t+innerH-((num(v)-scale.min)/yRange)*innerH;};

    Array.prototype.forEach.call(svgEl.querySelectorAll('line[stroke="var(--border)"]'),function(el){el.remove();});
    Array.prototype.forEach.call(svgEl.querySelectorAll('text[text-anchor="end"]:not(.rt-chart-so-far)'),function(el){el.remove();});
    var defs=svgEl.querySelector('defs'),holder=document.createElementNS(NS,'g');
    holder.innerHTML=axisMarkup(W,H,pad,fontSize,scale,sy);
    var axis=holder.firstElementChild;
    if(axis){
      if(defs&&defs.nextSibling)svgEl.insertBefore(axis,defs.nextSibling);
      else if(defs)defs.parentNode.appendChild(axis);
      else svgEl.insertBefore(axis,svgEl.firstChild);
    }

    var barW=clamp(mobile?11:13,bandW*.56,mobile?36:48),profitW=Math.max(7,barW*.60);
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar)'),function(rect){
      var i=parseBarIndex(rect);if(i<0||i>=n)return;
      rect.setAttribute('x',(sx(i)-barW/2).toFixed(1));rect.setAttribute('width',barW.toFixed(1));
      rect.setAttribute('rx',Math.min(4,barW*.16).toFixed(1));setRectY(rect,num(revData[i]),sy);
    });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-profit-bar'),function(rect){
      var i=parseBarIndex(rect);if(i<0||i>=n)return;
      rect.setAttribute('x',(sx(i)-profitW/2).toFixed(1));rect.setAttribute('width',profitW.toFixed(1));
      rect.setAttribute('rx',Math.min(3,profitW*.16).toFixed(1));setRectY(rect,num(profitData[i]),sy);
    });

    removeLegacyRefundMarks(svgEl);

    var hitGroups=svgEl.querySelectorAll('.rt-chart-col');
    Array.prototype.forEach.call(hitGroups,function(g,i){
      if(i>=n)return;var hit=g.querySelector('rect');
      if(hit){hit.setAttribute('x',(pad.l+i*bandW).toFixed(1));hit.setAttribute('width',bandW.toFixed(1));}
    });
    var skip=Math.max(1,Math.ceil(n/Math.max(1,opts.maxXLabels||n))),labelIndices=[];
    for(var li=0;li<n;li++)if(li%skip===0||li===n-1)labelIndices.push(li);
    var xTexts=Array.prototype.slice.call(svgEl.querySelectorAll('text[text-anchor="middle"]'));
    xTexts.forEach(function(t,k){var i=labelIndices[k];if(i!==undefined)t.setAttribute('x',sx(i).toFixed(1));});

    addForecastTreatment(svgEl,revData,profitData,forecast,sy,fontSize,pad,W);
    var firstHit=svgEl.querySelector('.rt-chart-col');
    addRefundTrend(svgEl,refunds,sx,sy,n,firstHit);

    svgEl.setAttribute('preserveAspectRatio','xMidYMid meet');
    svgEl.setAttribute('role','img');
    svgEl.setAttribute('aria-label','Gross revenue and gross profit bars with refund trend and current-period forecast');

    var scrubPad={t:pad.t,r:pad.r+bandW/2,b:pad.b,l:pad.l+bandW/2};
    _setupChartScrub(svgEl,{
      W:W,pad:scrubPad,innerW:Math.max(1,innerW-bandW),n:n,sx:sx,sy:sy,
      revData:revData,profitData:profitData,labels:labels,
      primaryColor:opts.primaryColor||'var(--state-listed)',
      secondaryColor:opts.secondaryColor||'var(--profit)',
      primaryLabel:opts.primaryLabel||'Gross Revenue',
      secondaryLabel:opts.secondaryLabel||'Gross Profit',
      tertiaryData:refunds,tertiaryColor:opts.tertiaryColor||'var(--red)',
      tertiaryLabel:opts.tertiaryLabel||'Refunds',
      tertiaryCounts:Array.isArray(opts.tertiaryCounts)?opts.tertiaryCounts:null,
      tertiaryEvents:false,tertiaryEventY:NaN
    });

    var shouldDraw=(drawBefore===undefined)||(drawBefore!==opts.drawKey);
    svgEl.classList.remove('rt-chart-draw');
    if(shouldDraw&&svgEl.querySelector('.rt-chart-primary-bar,.rt-chart-refund-trend')){
      try{void svgEl.getBoundingClientRect().width;}catch(_){}
      svgEl.classList.add('rt-chart-draw');
    }
  }
  function ensureResizeObserver(svgEl){
    if(!window.ResizeObserver||svgEl.__rtPolishedResizeObserver)return;
    var lastW=0,lastH=0,raf=0;
    try{var initial=svgEl.getBoundingClientRect();if(initial&&initial.width>=260&&initial.height>=150){lastW=Math.round(initial.width);lastH=Math.round(initial.height);}}catch(_){}
    var ro=new ResizeObserver(function(entries){
      var e=entries&&entries[0];if(!e||!svgEl.isConnected)return;
      var r=e.contentRect;if(!r||r.width<260||r.height<150)return;
      var w=Math.round(r.width),h=Math.round(r.height);
      if(Math.abs(w-lastW)<6&&Math.abs(h-lastH)<6)return;
      lastW=w;lastH=h;if(raf)cancelAnimationFrame(raf);
      raf=requestAnimationFrame(function(){
        var snap=svgEl.__rtPolishedSnapshot;
        if(!snap||!svgEl.isConnected)return;
        _renderChartInto(svgEl,snap.labels,snap.revData,snap.profitData,snap.handlers,Object.assign({},snap.opts));
      });
    });
    ro.observe(svgEl);svgEl.__rtPolishedResizeObserver=ro;
  }

  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    if(!isDashboardBars(opts))return _legacyRenderChartInto.apply(this,arguments);
    installStyles();
    var original=Object.assign({},opts),mobile=svgEl.id==='summary-chart-svg-mobile';
    var measured=cssSize(svgEl,opts.W,opts.H),W=measured.w,H=measured.h;
    var polished=Object.assign({},opts);
    polished.W=W;polished.H=H;
    polished.pad=mobile?{t:14,r:12,b:32,l:48}:{t:16,r:18,b:40,l:58};
    polished.fontSize=mobile?12:13;
    polished.yTicks=mobile?(H<215?2:3):4;
    var usable=Math.max(1,W-polished.pad.l-polished.pad.r);
    polished.maxXLabels=clamp(mobile?3:5,Math.floor(usable/(mobile?72:84)),mobile?5:10);
    polished.primaryBarMaxW=mobile?36:48;

    polished.tertiaryEvents=false;
    polished.tertiaryMarkersOnly=true;
    polished.tertiaryAlwaysDots=false;
    polished.tertiaryBars=false;

    var id=svgEl.id||polished.gradientId||'rt-chart-anon';
    var before=(typeof _chartDrawKey!=='undefined'&&_chartDrawKey)?_chartDrawKey[id]:undefined;
    var result=_legacyRenderChartInto.call(this,svgEl,labels,revData,profitData,handlers,polished);
    polishDashboard(svgEl,labels,revData,profitData,handlers,polished,before);

    svgEl.__rtPolishedSnapshot={
      labels:labels.slice(),revData:revData.slice(),profitData:profitData.slice(),handlers:handlers,opts:original
    };
    ensureResizeObserver(svgEl);
    return result;
  };
})();