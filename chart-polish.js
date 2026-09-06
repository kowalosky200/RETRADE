/* RETRADE Command Centre chart polish v1.4.38
 * Dashboard-only enhancement layered over the existing renderer:
 * - band-centred columns with stable first/last breathing room
 * - blue revenue + inset green profit + red outlined refund columns
 * - tighter "nice" money scale and quieter axes
 * - restrained, sequenced bar motion with reduced-motion support
 * - geometry derived from the rendered SVG size and refreshed on resize
 *
 * The underlying chart renderer/scrubber remains the source of truth for
 * tooltips, drill-down handlers and non-dashboard charts.
 */
(function(){
  'use strict';

  if(typeof _renderChartInto !== 'function' || typeof _setupChartScrub !== 'function') return;

  var _legacyRenderChartInto = _renderChartInto;
  var NS = 'http://www.w3.org/2000/svg';

  function clamp(min, value, max){ return Math.max(min, Math.min(max, value)); }
  function num(v){ v=Number(v); return isFinite(v)?v:0; }
  function isDashboardBars(opts){
    return !!(opts && opts.primaryBars && opts.secondaryBarsInPrimary &&
      opts.primaryLabel === 'Gross Revenue' && opts.secondaryLabel === 'Gross Profit');
  }
  function cssSize(svgEl, fallbackW, fallbackH){
    var r;
    try{ r=svgEl.getBoundingClientRect(); }catch(_){ r=null; }
    var w=r&&r.width>=260?Math.round(r.width):fallbackW;
    var h=r&&r.height>=150?Math.round(r.height):fallbackH;
    return {w:w,h:h,visible:!!(r&&r.width>=260&&r.height>=150)};
  }
  function niceStep(raw){
    if(!isFinite(raw) || raw<=0) return 1;
    var exp=Math.floor(Math.log10(raw));
    var mag=Math.pow(10,exp);
    var f=raw/mag;
    var nf;
    // Rounded 1 / 2 / 2.5 / 5 / 10 progression. This keeps financial ticks
    // familiar while avoiding the old 1k -> 2k jump for ~1k datasets.
    if(f<1.5) nf=1;
    else if(f<2.25) nf=2;
    else if(f<3.75) nf=2.5;
    else if(f<7.5) nf=5;
    else nf=10;
    return nf*mag;
  }
  function nextNiceStep(step){
    if(!isFinite(step)||step<=0) return 1;
    var exp=Math.floor(Math.log10(step));
    var mag=Math.pow(10,exp);
    var f=step/mag;
    if(f<1.5) return 2*mag;
    if(f<2.25) return 2.5*mag;
    if(f<3.75) return 5*mag;
    if(f<7.5) return 10*mag;
    return 20*mag;
  }
  function buildScale(revData,profitData,tertiaryData,targetIntervals){
    var vals=[];
    (revData||[]).forEach(function(v){vals.push(num(v));});
    (profitData||[]).forEach(function(v){vals.push(num(v));});
    (tertiaryData||[]).forEach(function(v){vals.push(Math.max(0,num(v)));});
    var rawMax=Math.max.apply(Math,[0].concat(vals));
    var rawMin=Math.min.apply(Math,[0].concat((revData||[]).map(num),(profitData||[]).map(num)));
    if(rawMax<=0 && rawMin>=0) return {min:0,max:100,step:50,ticks:[0,50,100]};

    var target=Math.max(2,targetIntervals||3);
    var paddedMax=rawMax>0?rawMax*1.045:0;
    var paddedMin=rawMin<0?rawMin*1.045:0;
    var rough=(paddedMax-paddedMin)/target;
    var step=niceStep(rough||1);
    var yMin=rawMin<0?Math.floor(paddedMin/step)*step:0;
    var yMax=Math.ceil(paddedMax/step)*step;
    if(yMax<=yMin) yMax=yMin+step;
    var intervals=Math.round((yMax-yMin)/step);

    // On a compact phone chart, five or six horizontal bands look like a
    // spreadsheet. Move up one familiar step when the rounded scale is denser
    // than requested; desktop is allowed one extra interval.
    var allowed=target+1;
    if(intervals>allowed){
      step=nextNiceStep(step);
      yMin=rawMin<0?Math.floor(paddedMin/step)*step:0;
      yMax=Math.ceil(paddedMax/step)*step;
      intervals=Math.round((yMax-yMin)/step);
    }
    intervals=Math.max(1,intervals);
    var ticks=[];
    for(var i=0;i<=intervals;i++) ticks.push(yMin+i*step);
    // Floating point protection for values such as 0.1 / 0.2.
    ticks=ticks.filter(function(v){return v<=yMax+Math.abs(step)*0.001;});
    return {min:yMin,max:yMax,step:step,ticks:ticks};
  }
  function fmtAxisMoney(v){
    v=num(v);
    if(Math.abs(v)<0.00001) return '£0';
    var sign=v<0?'−':'';
    var a=Math.abs(v);
    if(a>=1000000){
      var m=a/1000000;
      return sign+'£'+m.toFixed(m>=10||Math.abs(m-Math.round(m))<0.001?0:1)+'m';
    }
    if(a>=1000){
      var k=a/1000;
      return sign+'£'+k.toFixed(k>=10||Math.abs(k-Math.round(k))<0.001?0:1)+'k';
    }
    if(a>=10 || Math.abs(a-Math.round(a))<0.001) return sign+'£'+Math.round(a);
    return sign+'£'+a.toFixed(1);
  }
  function setRectY(rect,value,sy){
    if(!rect) return;
    var y0=sy(0), yv=sy(value);
    var h=Math.max(1.5,Math.abs(y0-yv));
    rect.setAttribute('y',Math.min(y0,yv).toFixed(1));
    rect.setAttribute('height',h.toFixed(1));
  }
  function parseBarIndex(el){
    if(!el) return -1;
    var raw='';
    try{raw=el.style.getPropertyValue('--bar-i');}catch(_){}
    var i=parseInt(raw,10);
    return isFinite(i)?i:-1;
  }
  function axisMarkup(W,H,pad,fontSize,scale,sy){
    var out='<g class="rt-polished-axis" aria-hidden="true">';
    scale.ticks.forEach(function(v){
      var y=sy(v).toFixed(1);
      var isZero=Math.abs(v)<Math.abs(scale.step)*0.001;
      out+='<line x1="'+pad.l+'" x2="'+(W-pad.r)+'" y1="'+y+'" y2="'+y+'" stroke="var(--border)" stroke-width="1" opacity="'+(isZero?'0.52':'0.28')+'"/>';
      out+='<text x="'+(pad.l-Math.round(fontSize*0.9))+'" y="'+(sy(v)+fontSize*0.27).toFixed(1)+'" font-size="'+fontSize+'" fill="var(--text-tertiary)" text-anchor="end" font-family="var(--font-body)" style="font-variant-numeric:tabular-nums">'+fmtAxisMoney(v)+'</text>';
    });
    return out+'</g>';
  }
  function installStyles(){
    if(document.getElementById('rt-chart-polish-v1438')) return;
    var s=document.createElement('style');
    s.id='rt-chart-polish-v1438';
    s.textContent='\
#p-summary .summary-chart-legend .legend-item:nth-child(3) .legend-dot{background:transparent!important;border:1.4px solid var(--red);box-sizing:border-box;border-radius:2px;}\
#p-summary .rt-chart-refund-outline{fill:none!important;stroke:var(--red);stroke-linejoin:round;vector-effect:non-scaling-stroke;transform-box:fill-box;transform-origin:center bottom;}\
#p-summary .rt-chart-primary-bar,#p-summary .rt-chart-profit-bar,#p-summary .rt-chart-refund-outline{will-change:transform,opacity;}\
@keyframes rtRevenueBarPolishIn{from{transform:scaleY(.025);opacity:.18}to{transform:scaleY(1);opacity:1}}\
@keyframes rtProfitBarPolishIn{from{transform:scaleY(.025);opacity:.12}to{transform:scaleY(1);opacity:1}}\
@keyframes rtRefundOutlinePolishIn{from{transform:scaleY(.025);opacity:0}to{transform:scaleY(1);opacity:1}}\
#p-summary svg.rt-chart-draw .rt-chart-primary-bar:not(.rt-chart-profit-bar){animation:rtRevenueBarPolishIn 420ms cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--bar-i) * 38ms);}\
#p-summary svg.rt-chart-draw .rt-chart-profit-bar{animation:rtProfitBarPolishIn 360ms cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--bar-i) * 38ms + 68ms);}\
#p-summary svg.rt-chart-draw .rt-chart-refund-outline{animation:rtRefundOutlinePolishIn 260ms cubic-bezier(.22,.61,.36,1) both;animation-delay:calc(var(--bar-i) * 38ms + 108ms);}\
#p-summary .rt-chart-so-far{font-weight:500;letter-spacing:.01em;}\
@media(prefers-reduced-motion:reduce){#p-summary svg.rt-chart-draw .rt-chart-primary-bar,#p-summary svg.rt-chart-draw .rt-chart-profit-bar,#p-summary svg.rt-chart-draw .rt-chart-refund-outline{animation:none!important;transform:none!important;opacity:1!important;}}';
    document.head.appendChild(s);
  }

  function polishDashboard(svgEl,labels,revData,profitData,handlers,opts,drawBefore){
    var n=labels.length;
    if(!n) return;
    var W=opts.W,H=opts.H,pad=opts.pad,fontSize=opts.fontSize;
    var innerW=W-pad.l-pad.r, innerH=H-pad.t-pad.b;
    var isMobile=svgEl.id==='summary-chart-svg-mobile' || W<560;
    var bandW=innerW/Math.max(1,n);
    var sx=function(i){return pad.l+bandW*(i+0.5);};
    var targetTicks=isMobile?(H<215?2:3):4;
    var tert=Array.isArray(opts.tertiaryData)?opts.tertiaryData:[];
    var scale=buildScale(revData,profitData,tert,targetTicks);
    var yRange=(scale.max-scale.min)||1;
    var sy=function(v){return pad.t+innerH-((num(v)-scale.min)/yRange)*innerH;};

    // Replace only the generated Y chrome. X labels remain the renderer's text
    // nodes so date formatting and skip semantics stay unchanged.
    Array.prototype.forEach.call(svgEl.querySelectorAll('line[stroke="var(--border)"]'),function(el){el.remove();});
    Array.prototype.forEach.call(svgEl.querySelectorAll('text[text-anchor="end"]:not(.rt-chart-so-far)'),function(el){el.remove();});
    var defs=svgEl.querySelector('defs');
    var holder=document.createElementNS(NS,'g');
    holder.innerHTML=axisMarkup(W,H,pad,fontSize,scale,sy);
    var axis=holder.firstElementChild;
    if(axis){
      if(defs&&defs.nextSibling) svgEl.insertBefore(axis,defs.nextSibling);
      else if(defs) defs.parentNode.appendChild(axis);
      else svgEl.insertBefore(axis,svgEl.firstChild);
    }

    var maxPrimary=isMobile?34:46;
    var barW=clamp(isMobile?10:12,bandW*0.52,maxPrimary);
    var profitW=Math.max(6,barW*0.60);
    var refundW=clamp(4,bandW*0.105,isMobile?6:7);
    var refundGap=clamp(3,bandW*0.075,5);
    var groupW=barW+refundGap+refundW;
    var primaryCxOffset=-(refundGap+refundW)/2;

    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-primary-bar:not(.rt-chart-profit-bar)'),function(rect){
      var i=parseBarIndex(rect); if(i<0||i>=n) return;
      var cx=sx(i)+primaryCxOffset;
      rect.setAttribute('x',(cx-barW/2).toFixed(1));
      rect.setAttribute('width',barW.toFixed(1));
      rect.setAttribute('rx',Math.min(4,barW*0.16).toFixed(1));
      setRectY(rect,num(revData[i]),sy);
    });
    Array.prototype.forEach.call(svgEl.querySelectorAll('.rt-chart-profit-bar'),function(rect){
      var i=parseBarIndex(rect); if(i<0||i>=n) return;
      var cx=sx(i)+primaryCxOffset;
      rect.setAttribute('x',(cx-profitW/2).toFixed(1));
      rect.setAttribute('width',profitW.toFixed(1));
      rect.setAttribute('rx',Math.min(3,profitW*0.16).toFixed(1));
      setRectY(rect,num(profitData[i]),sy);
    });

    var refundIndices=[];
    tert.forEach(function(v,i){if(num(v)>0) refundIndices.push(i);});
    var refundRects=Array.prototype.slice.call(svgEl.querySelectorAll('.rt-chart-refund-bar'));
    refundRects.forEach(function(rect,k){
      var i=refundIndices[k]; if(i===undefined) return;
      var primaryLeft=(sx(i)+primaryCxOffset)-barW/2;
      var refundX=primaryLeft+barW+refundGap;
      rect.classList.add('rt-chart-refund-outline');
      rect.style.setProperty('--bar-i',i);
      rect.setAttribute('x',refundX.toFixed(1));
      rect.setAttribute('width',refundW.toFixed(1));
      rect.setAttribute('rx',Math.min(2,refundW/2).toFixed(1));
      rect.setAttribute('fill','none');
      rect.setAttribute('fill-opacity','0');
      rect.setAttribute('opacity','1');
      rect.setAttribute('stroke','var(--red)');
      rect.setAttribute('stroke-opacity','0.90');
      rect.setAttribute('stroke-width',isMobile?'1.2':'1.35');
      setRectY(rect,Math.max(0,num(tert[i])),sy);
    });

    // Re-centre the full-height hit bands and the labels on column bands rather
    // than line-chart endpoints. Revenue stays aligned even in periods that do
    // not contain refunds because the narrow refund slot is reserved throughout.
    var hitGroups=svgEl.querySelectorAll('.rt-chart-col');
    Array.prototype.forEach.call(hitGroups,function(g,i){
      if(i>=n) return;
      var hit=g.querySelector('rect');
      if(hit){hit.setAttribute('x',(pad.l+i*bandW).toFixed(1));hit.setAttribute('width',bandW.toFixed(1));}
    });
    var skip=Math.max(1,Math.ceil(n/Math.max(1,opts.maxXLabels||n)));
    var labelIndices=[];
    for(var li=0;li<n;li++){if(li%skip===0||li===n-1)labelIndices.push(li);}
    var xTexts=Array.prototype.slice.call(svgEl.querySelectorAll('text[text-anchor="middle"]'));
    xTexts.forEach(function(t,k){var i=labelIndices[k];if(i!==undefined)t.setAttribute('x',sx(i).toFixed(1));});

    var soFar=svgEl.querySelector('.rt-chart-so-far');
    if(soFar && opts.partialLast===true){
      var last=n-1;
      var tops=[];
      if(num(revData[last])!==0) tops.push(sy(num(revData[last])));
      if(num(profitData[last])!==0) tops.push(sy(num(profitData[last])));
      if(num(tert[last])>0) tops.push(sy(num(tert[last])));
      var top=tops.length?Math.min.apply(Math,tops):sy(0);
      var labelY=Math.max(pad.t+fontSize,top-7);
      soFar.setAttribute('x',(sx(last)+groupW/2).toFixed(1));
      soFar.setAttribute('y',labelY.toFixed(1));
      soFar.setAttribute('text-anchor','end');
    }

    svgEl.setAttribute('preserveAspectRatio','xMidYMid meet');
    svgEl.setAttribute('role','img');
    svgEl.setAttribute('aria-label','Gross revenue, gross profit and refunds by period');

    // Rebind the existing scrubber to the new band centres. Passing the first
    // and last band centres as the interaction range makes the original nearest
    // index maths exact without forking the battle-tested gesture code.
    var scrubPad={t:pad.t,r:pad.r+bandW/2,b:pad.b,l:pad.l+bandW/2};
    var scrubInner=Math.max(1,innerW-bandW);
    _setupChartScrub(svgEl,{
      W:W,pad:scrubPad,innerW:scrubInner,n:n,sx:sx,sy:sy,
      revData:revData,profitData:profitData,labels:labels,
      primaryColor:opts.primaryColor||'var(--state-listed)',
      secondaryColor:opts.secondaryColor||'var(--profit)',
      primaryLabel:opts.primaryLabel||'Gross Revenue',
      secondaryLabel:opts.secondaryLabel||'Gross Profit',
      tertiaryData:tert,
      tertiaryColor:opts.tertiaryColor||'var(--red)',
      tertiaryLabel:opts.tertiaryLabel||'Refunds',
      tertiaryCounts:Array.isArray(opts.tertiaryCounts)?opts.tertiaryCounts:null,
      tertiaryEvents:false,
      tertiaryEventY:NaN,
      extraTooltipData:Array.isArray(opts.extraTooltipData)?opts.extraTooltipData:null,
      extraTooltipLabel:opts.extraTooltipLabel||'Gross Profit',
      extraTooltipColor:opts.extraTooltipColor||'var(--text-secondary)'
    });

    // The legacy draw gate only arms when a line has measurable path length.
    // Dashboard bars intentionally have no trend lines, so explicitly arm the
    // same period/reveal gate for bar marks.
    var shouldDraw=(drawBefore===undefined)||(drawBefore!==opts.drawKey);
    svgEl.classList.remove('rt-chart-draw');
    if(shouldDraw && svgEl.querySelector('.rt-chart-primary-bar,.rt-chart-refund-outline')){
      // Force the pre-animation state to commit before the class is re-added.
      try{void svgEl.getBoundingClientRect().width;}catch(_){}
      svgEl.classList.add('rt-chart-draw');
    }
  }

  function ensureResizeObserver(svgEl){
    if(!window.ResizeObserver || svgEl.__rtPolishedResizeObserver) return;
    var lastW=0,lastH=0,raf=0;
    var ro=new ResizeObserver(function(entries){
      var e=entries&&entries[0];
      if(!e || !svgEl.isConnected) return;
      var r=e.contentRect;
      if(!r || r.width<260 || r.height<150) return;
      var w=Math.round(r.width),h=Math.round(r.height);
      if(Math.abs(w-lastW)<6 && Math.abs(h-lastH)<6) return;
      lastW=w;lastH=h;
      if(raf) cancelAnimationFrame(raf);
      raf=requestAnimationFrame(function(){
        var snap=svgEl.__rtPolishedSnapshot;
        if(!snap || !svgEl.isConnected) return;
        _renderChartInto(svgEl,snap.labels,snap.revData,snap.profitData,snap.handlers,Object.assign({},snap.opts));
      });
    });
    ro.observe(svgEl);
    svgEl.__rtPolishedResizeObserver=ro;
  }

  _renderChartInto = function(svgEl,labels,revData,profitData,handlers,opts){
    if(!isDashboardBars(opts)){
      return _legacyRenderChartInto.apply(this,arguments);
    }
    installStyles();

    var original=Object.assign({},opts);
    var mobile=svgEl.id==='summary-chart-svg-mobile';
    var measured=cssSize(svgEl,opts.W,opts.H);
    var W=measured.w,H=measured.h;
    var polished=Object.assign({},opts);
    polished.W=W; polished.H=H;
    polished.pad=mobile?{t:14,r:12,b:32,l:48}:{t:16,r:18,b:40,l:58};
    polished.fontSize=mobile?12:13;
    polished.yTicks=mobile?(H<215?2:3):4;
    var usable=Math.max(1,W-polished.pad.l-polished.pad.r);
    polished.maxXLabels=clamp(mobile?3:5,Math.floor(usable/(mobile?72:84)),mobile?5:10);
    polished.primaryBarMaxW=mobile?34:46;
    polished.tertiaryEvents=false;
    polished.tertiaryMarkersOnly=false;
    polished.tertiaryAlwaysDots=false;
    polished.tertiaryBars=true;
    polished.tertiaryBarMaxW=mobile?6:7;
    polished.tertiaryBarOpacity=0.16;

    var id=svgEl.id||polished.gradientId||'rt-chart-anon';
    var before=(typeof _chartDrawKey!=='undefined' && _chartDrawKey)?_chartDrawKey[id]:undefined;
    var result=_legacyRenderChartInto.call(this,svgEl,labels,revData,profitData,handlers,polished);
    polishDashboard(svgEl,labels,revData,profitData,handlers,polished,before);

    svgEl.__rtPolishedSnapshot={
      labels:labels.slice(),revData:revData.slice(),profitData:profitData.slice(),handlers:handlers,
      opts:original
    };
    ensureResizeObserver(svgEl);
    return result;
  };
})();
