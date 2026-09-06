/* RETRADE chart final presentation pass v1.4.42
 * Loaded after chart-motion.js.
 *
 * Small visual corrections only:
 * - Calendar Year keeps a current-month forecast; other dashboard ranges stay actual-only.
 * - 30-day daily bars get a little more air and quieter outlines on small screens.
 * - Refund legend is a true event dot.
 * - Sales forecast no longer leaves detached achieved-value dots beneath the forecast rings.
 *
 * Accounting, sync, inventory lifecycle and persisted data are untouched.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function')return;

  function num(v){v=Number(v);return isFinite(v)?v:0;}
  function periodKey(){
    try{if(typeof SUMMARY_PERIOD!=='undefined')return String(SUMMARY_PERIOD||'').toLowerCase();}catch(_){}
    return '';
  }
  function selectedSummaryText(){
    var el=document.getElementById('summary-period-select')||document.querySelector('#p-summary select.period-select-inline,#p-summary select');
    if(!el)return '';
    try{return String(el.options[el.selectedIndex].text||'').toLowerCase();}catch(_){return '';}
  }
  function isCalendarYear(){
    var p=periodKey().replace(/[\s_-]+/g,'');
    if(p==='cy'||p==='currentcy'||p==='calendaryear'||p==='currentyear'||p==='ytd'||p==='currentytd'||p==='calendarytd')return true;
    var txt=selectedSummaryText();
    return /\bcalendar\s+year\b|\bcurrent\s+cy\b|\bthis\s+calendar\s+year\b|\byear\s+to\s+date\b/.test(txt)&&!/\bfy\b|fiscal/.test(txt);
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

  function installStyles(){
    var old=document.getElementById('rt-chart-finalize-v1442');if(old)old.remove();
    var s=document.createElement('style');s.id='rt-chart-finalize-v1442';
    s.textContent='\
/* Refunds are discrete events: keep the legend language identical to the chart. */\
#p-summary .summary-chart-legend .rt-refund-legend-dot,\
#p-summary .summary-chart-legend .legend-event-mark,\
#p-summary .summary-chart-legend .legend-dot--refund{\
 display:inline-block!important;width:7px!important;height:7px!important;min-width:7px!important;min-height:7px!important;\
 padding:0!important;border:0!important;border-top:0!important;border-radius:50%!important;\
 background:var(--red)!important;background-color:var(--red)!important;box-shadow:inset 0 0 0 4px var(--red)!important;\
 opacity:.92!important;transform:none!important;box-sizing:border-box!important;\
}\
/* Dense daily view: preserve the blue/green hierarchy without the outlines touching visually. */\
#p-summary svg.rt-dense-daily-bars .rt-chart-primary-bar:not(.rt-chart-profit-bar){stroke-width:.65!important;stroke-opacity:.52!important;}\
#p-summary svg.rt-dense-daily-bars .rt-chart-profit-bar{stroke-width:.5!important;stroke-opacity:.44!important;}\
/* The line itself already projects to the hollow forecast rings; detached achieved dots read as stray marks. */\
#p-monthly .rt-sales-forecast-layer .rt-sales-actual-dot{display:none!important;}';
    document.head.appendChild(s);
  }

  function fixRefundLegend(){
    var items=document.querySelectorAll('#p-summary .summary-chart-legend .legend-item');
    Array.prototype.forEach.call(items,function(item){
      if(!/refund/i.test(String(item.textContent||'')))return;
      var marker=item.firstElementChild;
      if(marker)marker.classList.add('rt-refund-legend-dot');
    });
  }

  function shrinkAroundCentre(rect,factor,minWidth){
    if(!rect)return;
    var w=num(rect.getAttribute('width')),x=num(rect.getAttribute('x'));
    if(w<=0)return;
    var nw=Math.max(minWidth,w*factor);
    if(nw>=w-.05)return;
    rect.setAttribute('x',(x+(w-nw)/2).toFixed(2));
    rect.setAttribute('width',nw.toFixed(2));
    var rx=num(rect.getAttribute('rx'));
    if(rx>0)rect.setAttribute('rx',Math.min(rx,nw*.18).toFixed(2));
  }

  function tuneDenseDailyBars(svgEl,active){
    if(!svgEl)return;
    svgEl.classList.toggle('rt-dense-daily-bars',!!active);
    if(!active)return;
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar)'),function(rect){
      shrinkAroundCentre(rect,.80,7.8);
    });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-profit-bar'),function(rect){
      shrinkAroundCentre(rect,.78,4.8);
    });
  }

  function cleanSalesForecast(svgEl){
    if(!svgEl)return;
    var layer=svgEl.querySelector('.rt-sales-forecast-layer');
    if(!layer)return;
    Array.prototype.forEach.call(layer.querySelectorAll('.rt-sales-actual-dot'),function(dot){dot.remove();});
  }

  function withCalendarYearSignal(fn){
    var changed=false,previous;
    try{
      if(typeof SUMMARY_PERIOD!=='undefined'){
        previous=SUMMARY_PERIOD;
        SUMMARY_PERIOD='cy';
        changed=true;
      }
    }catch(_){}
    try{return fn();}
    finally{
      if(changed){try{SUMMARY_PERIOD=previous;}catch(_){} }
    }
  }

  installStyles();
  fixRefundLegend();

  var _renderBeforeFinalize=_renderChartInto;
  _renderChartInto=function(svgEl,labels,revData,profitData,handlers,opts){
    var dashboard=isDashboardBars(opts);
    if(dashboard){
      var cy=isCalendarYear(),dense30=isLast30Days(),nextOpts=Object.assign({},opts),out;
      if(cy){
        /* chart-polish uses this key to project the remainder of the current month,
           while chart-motion uses the CY signal to permit the forecast at all. */
        nextOpts.partialLast=true;
        nextOpts.drawKey='current_fy';
        out=withCalendarYearSignal(function(){
          return _renderBeforeFinalize.call(this,svgEl,labels,revData,profitData,handlers,nextOpts);
        }.bind(this));
      }else{
        out=_renderBeforeFinalize.call(this,svgEl,labels,revData,profitData,handlers,nextOpts);
      }
      tuneDenseDailyBars(svgEl,dense30&&labels&&labels.length>=24);
      fixRefundLegend();
      return out;
    }

    var result=_renderBeforeFinalize.apply(this,arguments);
    if(isSalesChart(svgEl,opts))cleanSalesForecast(svgEl);
    return result;
  };

  /* Handles the rare case where a chart was rendered immediately before this final layer loaded. */
  requestAnimationFrame(function(){
    fixRefundLegend();
    var sales=document.getElementById('monthly-profitability-svg');if(sales)cleanSalesForecast(sales);
  });
})();
