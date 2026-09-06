/* RETRADE chart final presentation pass v1.4.44
 * Loaded after chart-motion.js.
 *
 * Small visual corrections only:
 * - Current FY keeps the dashboard current-month forecast shell; other dashboard ranges stay actual-only.
 * - Current FY forecast text is contextual only: hover on desktop, press-and-hold near September on touch.
 * - 30-day daily bars keep extra breathing room and quieter outlines on small screens.
 * - Refund legend remains a true event dot.
 * - Sales forecast keeps only the dotted projection + hollow end points; forecast text appears contextually near Sep on hover/touch.
 *
 * Accounting, sync, inventory lifecycle and persisted data are untouched.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto!=='function')return;

  var NS='http://www.w3.org/2000/svg';
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
  function isCurrentFY(){
    var p=periodKey().replace(/[\s_-]+/g,'');
    if(p==='fy'||p==='currentfy'||p==='fiscalyear'||p==='currentfiscalyear'||p==='financialyear'||p==='currentfinancialyear')return true;
    return /\bcurrent\s+fy\b|\bcurrent\s+fiscal\s+year\b|\bcurrent\s+financial\s+year\b/.test(selectedSummaryText());
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
    var ids=['rt-chart-finalize-v1442','rt-chart-finalize-v1443','rt-chart-finalize-v1444'];
    ids.forEach(function(id){var old=document.getElementById(id);if(old)old.remove();});
    var s=document.createElement('style');s.id='rt-chart-finalize-v1444';
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
/* Forecast labels stay out of the plot until the user asks for them. */\
#p-summary .rt-chart-forecast-label{display:none!important;}\
#p-summary .rt-dashboard-hover-forecast,\
#p-monthly .rt-sales-hover-forecast{pointer-events:none;opacity:0;transition:opacity 120ms ease-out;}\
#p-summary .rt-dashboard-hover-forecast.is-visible,\
#p-monthly .rt-sales-hover-forecast.is-visible{opacity:1;}\
#p-summary .rt-dashboard-hover-forecast rect,\
#p-monthly .rt-sales-hover-forecast rect{fill:var(--surface-1);stroke:var(--border);stroke-width:1;vector-effect:non-scaling-stroke;}\
#p-summary .rt-dashboard-hover-forecast text,\
#p-monthly .rt-sales-hover-forecast text{fill:var(--text-secondary);font-family:var(--font-body);font-weight:650;letter-spacing:.01em;}\
/* Sales projection: dotted continuation + hollow destination points do the visual work. */\
#p-monthly .rt-sales-forecast-layer .rt-sales-actual-dot{display:none!important;}\
#p-monthly .rt-sales-forecast-layer .rt-sales-forecast-label{display:none!important;}\
@media(prefers-reduced-motion:reduce){#p-summary .rt-dashboard-hover-forecast,#p-monthly .rt-sales-hover-forecast{transition:none;}}';
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

  function svgPointX(svgEl,clientX){
    var rect;try{rect=svgEl.getBoundingClientRect();}catch(_){rect=null;}
    if(!rect||!rect.width)return NaN;
    var vb=svgEl.viewBox&&svgEl.viewBox.baseVal;
    var vx=vb&&vb.width?vb.x:0,vw=vb&&vb.width?vb.width:num(svgEl.getAttribute('width'))||rect.width;
    return vx+((clientX-rect.left)/rect.width)*vw;
  }

  function buildContextBubble(svgEl,className,label,x,topY){
    var vb=svgEl.viewBox&&svgEl.viewBox.baseVal;
    var W=vb&&vb.width?vb.width:num(svgEl.getAttribute('width'))||600;
    var fontSize=W<560?10.5:11.5;
    var boxW=Math.max(78,Math.min(134,label.length*fontSize*.56+18));
    var boxH=24;
    var cx=Math.max(boxW/2+4,Math.min(W-boxW/2-4,x));
    var cy=Math.max(18,topY-25);
    var g=document.createElementNS(NS,'g');g.setAttribute('class',className);
    var r=document.createElementNS(NS,'rect');
    r.setAttribute('x',(cx-boxW/2).toFixed(1));r.setAttribute('y',(cy-boxH/2).toFixed(1));
    r.setAttribute('width',boxW.toFixed(1));r.setAttribute('height',boxH.toFixed(1));r.setAttribute('rx','7');
    var t=document.createElementNS(NS,'text');
    t.setAttribute('x',cx.toFixed(1));t.setAttribute('y',(cy+fontSize*.34).toFixed(1));t.setAttribute('text-anchor','middle');t.setAttribute('font-size',fontSize.toFixed(1));t.textContent=label;
    g.appendChild(r);g.appendChild(t);svgEl.appendChild(g);
    return {group:g,W:W};
  }

  function installDashboardForecastHold(svgEl,label,shells){
    if(!svgEl||!label||!shells||!shells.length)return;
    if(svgEl.__rtDashboardForecastCleanup){try{svgEl.__rtDashboardForecastCleanup();}catch(_){}svgEl.__rtDashboardForecastCleanup=null;}
    var prior=svgEl.querySelector('.rt-dashboard-hover-forecast');if(prior)prior.remove();

    var revShell=null;
    Array.prototype.some.call(shells,function(shell){
      if(!shell.classList.contains('rt-chart-profit-bar')){revShell=shell;return true;}
      return false;
    });
    revShell=revShell||shells[0];
    var x=num(revShell.getAttribute('x'))+num(revShell.getAttribute('width'))/2;
    var topY=Infinity;
    Array.prototype.forEach.call(shells,function(shell){topY=Math.min(topY,num(shell.getAttribute('y')));});
    if(!isFinite(topY))topY=30;

    label=String(label||'').replace(/^month\s+forecast\s+/i,'Forecast ').trim();
    var bubble=buildContextBubble(svgEl,'rt-dashboard-hover-forecast',label,x,topY),g=bubble.group,W=bubble.W;
    var threshold=Math.max(34,Math.min(58,W*.09));
    var holdTimer=0,startX=0,startY=0,holding=false;

    function near(clientX){var px=svgPointX(svgEl,clientX);return isFinite(px)&&Math.abs(px-x)<=threshold;}
    function show(){g.classList.add('is-visible');holding=true;}
    function hide(){g.classList.remove('is-visible');holding=false;}
    function cancelHold(){if(holdTimer){clearTimeout(holdTimer);holdTimer=0;}}
    function onPointerMove(e){
      if(!e||!isFinite(e.clientX))return;
      if(e.pointerType==='mouse'){
        g.classList.toggle('is-visible',near(e.clientX));
        return;
      }
      if(holdTimer&&Math.hypot((e.clientX||0)-startX,(e.clientY||0)-startY)>10)cancelHold();
    }
    function onPointerDown(e){
      if(!e||!isFinite(e.clientX)||!near(e.clientX))return;
      if(e.pointerType==='mouse'){show();return;}
      cancelHold();startX=e.clientX||0;startY=e.clientY||0;
      holdTimer=setTimeout(function(){holdTimer=0;show();},240);
    }
    function onPointerUp(){cancelHold();if(holding)setTimeout(hide,80);}
    function onPointerLeave(){cancelHold();hide();}
    svgEl.addEventListener('pointermove',onPointerMove,{passive:true});
    svgEl.addEventListener('pointerdown',onPointerDown,{passive:true});
    svgEl.addEventListener('pointerup',onPointerUp,{passive:true});
    svgEl.addEventListener('pointercancel',onPointerUp,{passive:true});
    svgEl.addEventListener('pointerleave',onPointerLeave,{passive:true});
    svgEl.__rtDashboardForecastCleanup=function(){
      cancelHold();
      svgEl.removeEventListener('pointermove',onPointerMove);
      svgEl.removeEventListener('pointerdown',onPointerDown);
      svgEl.removeEventListener('pointerup',onPointerUp);
      svgEl.removeEventListener('pointercancel',onPointerUp);
      svgEl.removeEventListener('pointerleave',onPointerLeave);
    };
  }

  function cleanDashboardForecast(svgEl){
    if(!svgEl)return;
    var labelEl=svgEl.querySelector('.rt-chart-forecast-label');
    var label=labelEl?String(labelEl.textContent||'').trim():'';
    if(labelEl)labelEl.remove();
    var shells=svgEl.querySelectorAll('.rt-chart-forecast-shell');
    if(label&&shells.length)installDashboardForecastHold(svgEl,label,shells);
  }

  function installSalesForecastHover(svgEl,label,rings){
    if(!svgEl||!label||!rings||!rings.length)return;
    if(svgEl.__rtForecastHoverCleanup){try{svgEl.__rtForecastHoverCleanup();}catch(_){}svgEl.__rtForecastHoverCleanup=null;}
    var prior=svgEl.querySelector('.rt-sales-hover-forecast');if(prior)prior.remove();

    var x=num(rings[0].getAttribute('cx'));
    var topY=Infinity;
    Array.prototype.forEach.call(rings,function(r){topY=Math.min(topY,num(r.getAttribute('cy')));});
    if(!isFinite(topY))topY=30;
    var bubble=buildContextBubble(svgEl,'rt-sales-hover-forecast',label,x,topY),g=bubble.group,W=bubble.W;

    Array.prototype.forEach.call(rings,function(ring){
      var title=ring.querySelector('title');
      if(!title){title=document.createElementNS(NS,'title');ring.appendChild(title);}
      title.textContent=label;
    });

    var threshold=Math.max(34,Math.min(58,W*.09));
    function showForClientX(clientX){
      var px=svgPointX(svgEl,clientX);
      g.classList.toggle('is-visible',isFinite(px)&&Math.abs(px-x)<=threshold);
    }
    function onPointerMove(e){if(e&&isFinite(e.clientX))showForClientX(e.clientX);}
    function onPointerDown(e){if(e&&isFinite(e.clientX))showForClientX(e.clientX);}
    function hide(){g.classList.remove('is-visible');}
    svgEl.addEventListener('pointermove',onPointerMove,{passive:true});
    svgEl.addEventListener('pointerdown',onPointerDown,{passive:true});
    svgEl.addEventListener('pointerleave',hide,{passive:true});
    svgEl.__rtForecastHoverCleanup=function(){
      svgEl.removeEventListener('pointermove',onPointerMove);
      svgEl.removeEventListener('pointerdown',onPointerDown);
      svgEl.removeEventListener('pointerleave',hide);
    };
  }

  function cleanSalesForecast(svgEl){
    if(!svgEl)return;
    var layer=svgEl.querySelector('.rt-sales-forecast-layer');
    if(!layer)return;
    Array.prototype.forEach.call(layer.querySelectorAll('.rt-sales-actual-dot'),function(dot){dot.remove();});

    var labelEl=layer.querySelector('.rt-sales-forecast-label');
    var label=labelEl?String(labelEl.textContent||'').trim():'';
    if(labelEl)labelEl.remove();
    if(!label){
      var title=layer.querySelector('title');
      var m=title&&String(title.textContent||'').match(/Net Revenue[^;]*;\s*([^;]*forecast)/i);
      if(m)label=String(m[1]||'').replace(/^\s*/,'');
    }
    var rings=layer.querySelectorAll('.rt-sales-forecast-ring');
    if(label&&rings.length)installSalesForecastHover(svgEl,label,rings);
  }

  function withForecastSignal(fn){
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
      var fy=isCurrentFY(),dense30=isLast30Days(),nextOpts=Object.assign({},opts),out;
      if(fy){
        /* chart-polish uses current_fy to project the remainder of September;
           chart-motion currently keys forecast permission from the CY signal,
           so the signal is scoped to this render only. */
        nextOpts.partialLast=true;
        nextOpts.drawKey='current_fy';
        out=withForecastSignal(function(){
          return _renderBeforeFinalize.call(this,svgEl,labels,revData,profitData,handlers,nextOpts);
        }.bind(this));
        cleanDashboardForecast(svgEl);
      }else{
        nextOpts.partialLast=false;
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
    var dash=document.getElementById('summary-chart-svg-mobile')||document.getElementById('summary-chart-svg');if(dash&&isCurrentFY())cleanDashboardForecast(dash);
  });
})();
