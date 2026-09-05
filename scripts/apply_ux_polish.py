from pathlib import Path
import sys

APP = Path('app.js')
CSS = Path('app.css')
INDEX = Path('index.html')

app = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')

MARKER = '/* v1.4.30 — contextual recall + semantic refund events */'
if MARKER in css:
    print('UX polish already applied; nothing to do.')
    sys.exit(0)


def replace_exact(text, old, new, expected=1, label='replacement'):
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} match(es), found {count}')
    return text.replace(old, new)


# ---------------------------------------------------------------------------
# Contextual smart input — expenses
# ---------------------------------------------------------------------------
old = """function _recallExpLabel(b){
  return (b.last.description||'Expense')+' \\u00b7 '+fmt(Number(b.last.amount)||0);
}
function applyExpensePreset(i){
  const b=_recallExp[i];if(!b)return;
  const e=b.last;
  const d=document.getElementById('exp-desc');if(d)d.value=e.description||'';
  const c=document.getElementById('exp-cat');if(c&&e.category)c.value=e.category;
  const a=document.getElementById('exp-amt');if(a)a.value=Number(e.amount)||'';
  const dt=document.getElementById('exp-date');
  if(dt&&!dt.readOnly)dt.value=new Date().toISOString().split('T')[0];
  if(a){try{a.focus();a.select();}catch(e2){}}
}
"""
new = """function _recallExpLabel(b){
  const e=b&&b.last?b.last:{};
  const desc=(e.description||'Expense').trim();
  const cat=(e.category||'').trim();
  return desc+(cat?' \\u00b7 '+cat:'');
}
function _recallExpenseMatches(query){
  const key=_recallKey(query);
  if(!key){_recallExp=[];return _recallExp;}
  const ranked=_frecencyRank((DB.expenses||[]),function(e){return e.description||'';},
                            function(e){return e.date;},12);
  _recallExp=ranked.filter(function(b){
    return _recallKey((b.last&&b.last.description)||'').indexOf(key)!==-1;
  }).slice(0,5);
  return _recallExp;
}
function _recallExpenseSuggest(){
  const input=document.getElementById('exp-desc');
  const box=document.getElementById('exp-recall-suggestions');
  if(!input||!box)return;
  const items=_recallExpenseMatches(input.value);
  if(!items.length){box.innerHTML='';box.style.display='none';return;}
  box.innerHTML=items.map(function(b,i){
    return '<button type="button" class="recall-chip" onclick="applyExpensePreset('+i+')">'+esc(_recallExpLabel(b))+'</button>';
  }).join('');
  box.style.display='flex';
}
function _recallExpenseHide(){
  const box=document.getElementById('exp-recall-suggestions');
  if(box)box.style.display='none';
}
function applyExpensePreset(i){
  const b=_recallExp[i];if(!b)return;
  const e=b.last||{};
  const d=document.getElementById('exp-desc');if(d)d.value=e.description||'';
  const c=document.getElementById('exp-cat');if(c&&e.category)c.value=e.category;
  _recallExpenseHide();
  // A remembered description may infer its usual category, but never money.
  // Amount remains an explicit input because repeated expenses can change.
  const a=document.getElementById('exp-amt');
  if(a){try{a.focus();}catch(e2){}}
}
"""
app = replace_exact(app, old, new, label='expense recall functions')

app = replace_exact(
    app,
    "    ${_recallChipsHTML('applyExpensePreset',_recallExpensePresets(),_recallExpLabel)}\n",
    '',
    label='remove generic expense Recent strip'
)

app = replace_exact(
    app,
    '      <input type="text" id="exp-desc" placeholder="e.g. Packaging materials">',
    '      <input type="text" id="exp-desc" placeholder="e.g. Packaging materials" autocomplete="off" oninput="_recallExpenseSuggest()" onfocus="_recallExpenseSuggest()" onblur="setTimeout(_recallExpenseHide,140)">\n      <div id="exp-recall-suggestions" class="recall-chips field-recall"></div>',
    label='expense contextual suggestions'
)

app = replace_exact(
    app,
    '<div class="fg"><label>Description</label><input type="text" id="exp-desc" placeholder="e.g. Packaging, entry fee"></div>',
    '<div class="fg"><label>Description</label><input type="text" id="exp-desc" placeholder="e.g. Packaging, entry fee" autocomplete="off" oninput="_recallExpenseSuggest()" onfocus="_recallExpenseSuggest()" onblur="setTimeout(_recallExpenseHide,140)"><div id="exp-recall-suggestions" class="recall-chips field-recall"></div></div>',
    label='run expense contextual suggestions'
)

# ---------------------------------------------------------------------------
# Contextual smart input — trip locations + remembered mileage
# ---------------------------------------------------------------------------
old = """function _recallTripDatalistHTML(){
  const places=_recallTripPlaces();
  if(!places.length)return '';
  let h='<datalist id="trip-place-list">';
  places.forEach(function(b){h+='<option value="'+esc(b.last.description||'')+'"></option>';});
  return h+'</datalist>';
}
"""
new = """let _recallTripHits=[];
function _recallTripMatches(query){
  const key=_recallKey(query);
  const places=_recallTripPlaces();
  _recallTripHits=(key?places.filter(function(b){
    return _recallKey((b.last&&b.last.description)||'').indexOf(key)!==-1;
  }):places).slice(0,4);
  return _recallTripHits;
}
function _recallTripSuggest(){
  const input=document.getElementById('trip-desc');
  const box=document.getElementById('trip-place-suggestions');
  if(!input||!box)return;
  const items=_recallTripMatches(input.value);
  if(!items.length){box.innerHTML='';box.style.display='none';return;}
  box.innerHTML=items.map(function(b,i){
    const t=b.last||{};
    const miles=Number(t.mileage)||0;
    const m=miles>0?(Number.isInteger(miles)?miles.toFixed(0):miles.toFixed(1))+' mi':'';
    const label=(t.description||'Location')+(m?' \\u00b7 '+m:'');
    return '<button type="button" class="recall-chip" onclick="applyTripPlacePreset('+i+')">'+esc(label)+'</button>';
  }).join('');
  box.style.display='flex';
}
function _recallTripHide(){
  const box=document.getElementById('trip-place-suggestions');
  if(box)box.style.display='none';
}
function applyTripPlacePreset(i){
  const b=_recallTripHits[i];if(!b)return;
  const t=b.last||{};
  const d=document.getElementById('trip-desc');if(d)d.value=t.description||'';
  _recallTripPlacePicked();
  _recallTripHide();
  const miles=document.getElementById('trip-miles');
  if(miles){try{miles.focus();miles.select();}catch(e){}}
}
"""
app = replace_exact(app, old, new, label='trip recall functions')

old = """      <input type="text" id="trip-desc" list="trip-place-list" placeholder="e.g. Car boot sale - Brighton"
             onchange="_recallTripPlacePicked()" onblur="_recallTripPlacePicked()">
      ${_recallTripDatalistHTML()}"""
new = """      <input type="text" id="trip-desc" placeholder="e.g. Car boot sale - Brighton" autocomplete="off"
             oninput="_recallTripSuggest()" onfocus="_recallTripSuggest()" onchange="_recallTripPlacePicked()"
             onblur="_recallTripPlacePicked();setTimeout(_recallTripHide,140)">
      <div id="trip-place-suggestions" class="recall-chips field-recall"></div>"""
app = replace_exact(app, old, new, label='trip location suggestion UI')

# ---------------------------------------------------------------------------
# Dashboard refunds as semantic events, not a quantitative third series
# ---------------------------------------------------------------------------
app = replace_exact(
    app,
    'let chartLabels=[], chartRev=[], chartProfit=[], chartReturns=[], chartClickHandlers=[];',
    'let chartLabels=[], chartRev=[], chartProfit=[], chartReturns=[], chartReturnCounts=[], chartClickHandlers=[];',
    label='chart refund counts array'
)

app = replace_exact(
    app,
    "        chartReturns.push(+refunds.toFixed(2));\n        chartClickHandlers.push(events.length===0?null:{fn:'showMonthSnapshot',args:[k]});",
    "        chartReturns.push(+refunds.toFixed(2));\n        chartReturnCounts.push(returns.length);\n        chartClickHandlers.push(events.length===0?null:{fn:'showMonthSnapshot',args:[k]});",
    label='FY refund counts'
)

app = replace_exact(
    app,
    "          refunds:returns.reduce(function(sum,x){return sum+Math.max(0,-(Number(x.salePrice)||0));},0),\n          eventCount:inB.length};",
    "          refunds:returns.reduce(function(sum,x){return sum+Math.max(0,-(Number(x.salePrice)||0));},0),\n          refundCount:returns.length,\n          eventCount:inB.length};",
    label='rolling bucket refund counts'
)

app = replace_exact(
    app,
    "        chartReturns.push(+b.refunds.toFixed(2));\n        chartClickHandlers.push(b.eventCount===0?null:{fn:'showRangeSnapshot',args:[b.label,b.from,b.to]});",
    "        chartReturns.push(+b.refunds.toFixed(2));\n        chartReturnCounts.push(Number(b.refundCount)||0);\n        chartClickHandlers.push(b.eventCount===0?null:{fn:'showRangeSnapshot',args:[b.label,b.from,b.to]});",
    label='rolling refund count array'
)

app = replace_exact(
    app,
    'renderSummaryChart(chartLabels,chartRev,chartProfit,chartReturns,_chartPartialLast);',
    'renderSummaryChart(chartLabels,chartRev,chartProfit,chartReturns,chartReturnCounts,_chartPartialLast);',
    label='render summary chart counts'
)

app = replace_exact(
    app,
    'function renderSummaryChart(labels,revData,profitData,returnData,partialLast){',
    'function renderSummaryChart(labels,revData,profitData,returnData,returnCounts,partialLast){',
    label='renderSummaryChart signature'
)

app = replace_exact(
    app,
    "tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryBars:true,tertiaryBarMaxW:6,tertiaryBarOpacity:0.22,",
    "tertiaryData:returnData,tertiaryCounts:returnCounts,tertiaryColor:'var(--red)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryMarkersOnly:true,tertiaryAlwaysDots:true,tertiaryEvents:true,tertiaryEventDotR:4.2,",
    label='desktop refund event options'
)

app = replace_exact(
    app,
    "tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryBars:true,tertiaryBarMaxW:6.5,tertiaryBarOpacity:0.22,",
    "tertiaryData:returnData,tertiaryCounts:returnCounts,tertiaryColor:'var(--red)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryMarkersOnly:true,tertiaryAlwaysDots:true,tertiaryEvents:true,tertiaryEventDotR:4.6,",
    label='mobile refund event options'
)

app = replace_exact(
    app,
    "  const tertiaryDotR=opts.tertiaryDotR||2.5;\n",
    "  const tertiaryDotR=opts.tertiaryDotR||2.5;\n  const tertiaryCounts=Array.isArray(opts.tertiaryCounts)?opts.tertiaryCounts:null;\n  const tertiaryEvents=!!opts.tertiaryEvents;\n  const tertiaryEventDotR=opts.tertiaryEventDotR!=null?Math.max(3,Number(opts.tertiaryEventDotR)||4.2):4.2;\n",
    label='renderer event options'
)

app = replace_exact(
    app,
    "  const _tert=tertiaryData||[];\n  const rawMax=Math.max(0,...revData,...profitData,..._tert);\n  const rawMin=Math.min(0,...revData,...profitData,..._tert);",
    "  // Semantic events must never distort the money scale.\n  const _tert=(tertiaryData&&!tertiaryEvents)?tertiaryData:[];\n  const rawMax=Math.max(0,...revData,...profitData,..._tert);\n  const rawMin=Math.min(0,...revData,...profitData,..._tert);",
    label='refunds excluded from Y scale'
)

old = """  // Refunds are discrete events, not a continuous trend. Render them as slim,
  // low-emphasis columns from the zero baseline so sales/profit stay dominant.
  const tertiaryBarW=Math.max(3.5,Math.min(tertiaryBarMaxW,(n>1?xStep:innerW)*0.22));
  const tertBars=(tertiaryData&&tertiaryBars)?tertiaryData.map(function(raw,i){
    const t=Math.max(0,Number(raw)||0);
    if(t<=0)return '';
    const cx=sx(i), y0=sy(0), yt=sy(t);
    const h=Math.max(2.4,Math.abs(y0-yt));
    const y=Math.min(y0,yt);
    const isPartial=_partial&&i===n-1;
    const op=isPartial?Math.max(0.10,tertiaryBarOpacity*0.6):tertiaryBarOpacity;
    const strokeOp=isPartial?0.58:0.28;
    return '<rect class="rt-chart-refund-bar" x="'+(cx-tertiaryBarW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+tertiaryBarW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="'+Math.min(2.4,tertiaryBarW/2).toFixed(1)+'" fill="'+tertiaryColor+'" opacity="'+op.toFixed(2)+'" stroke="'+tertiaryColor+'" stroke-opacity="'+strokeOp+'" stroke-width="0.8"/>';
  }).join(''):'';
"""
new = """  // Refunds are event annotations, not a third quantitative series. In event
  // mode every marker sits on one fixed rail INSIDE the plot; its Y-position and
  // size never encode amount. Amount/count are disclosed by title + scrub tooltip.
  const tertiaryEventY=H-pad.b-Math.max(10,Math.min(14,innerH*0.065));
  const tertiaryBarW=Math.max(3.5,Math.min(tertiaryBarMaxW,(n>1?xStep:innerW)*0.22));
  const tertOverlay=tertiaryData?tertiaryData.map(function(raw,i){
    const t=Math.max(0,Number(raw)||0);
    if(t<=0)return '';
    const cx=sx(i);
    if(tertiaryEvents){
      const count=tertiaryCounts?Math.max(0,Number(tertiaryCounts[i])||0):1;
      const rr=tertiaryEventDotR;
      const countText=count>1?(count>9?'9+':String(count)):'';
      const centre=countText
        ?'<text x="'+cx.toFixed(1)+'" y="'+(tertiaryEventY+2.45).toFixed(1)+'" text-anchor="middle" font-size="7.2" font-weight="700" fill="'+tertiaryColor+'" font-family="var(--font-body)">'+countText+'</text>'
        :'<circle cx="'+cx.toFixed(1)+'" cy="'+tertiaryEventY.toFixed(1)+'" r="1.65" fill="'+tertiaryColor+'"/>';
      return '<g class="rt-chart-refund-event" data-refund-count="'+count+'">'
        +'<circle cx="'+cx.toFixed(1)+'" cy="'+tertiaryEventY.toFixed(1)+'" r="'+(rr+1.15).toFixed(1)+'" fill="var(--surface-1)" stroke="'+tertiaryColor+'" stroke-width="1.45"/>'
        +centre+'</g>';
    }
    if(!tertiaryBars)return '';
    const y0=sy(0),yt=sy(t);
    const h=Math.max(2.4,Math.abs(y0-yt));
    const y=Math.min(y0,yt);
    const isPartial=_partial&&i===n-1;
    const op=isPartial?Math.max(0.10,tertiaryBarOpacity*0.6):tertiaryBarOpacity;
    const strokeOp=isPartial?0.58:0.28;
    return '<rect class="rt-chart-refund-bar" x="'+(cx-tertiaryBarW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+tertiaryBarW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="'+Math.min(2.4,tertiaryBarW/2).toFixed(1)+'" fill="'+tertiaryColor+'" opacity="'+op.toFixed(2)+'" stroke="'+tertiaryColor+'" stroke-opacity="'+strokeOp+'" stroke-width="0.8"/>';
  }).join(''):'';
"""
app = replace_exact(app, old, new, label='refund event overlay')

app = replace_exact(
    app,
    'hasT&&!tertiaryBars&&(showDots||tertiaryAlwaysDots)',
    'hasT&&!tertiaryBars&&!tertiaryEvents&&(showDots||tertiaryAlwaysDots)',
    label='suppress quantitative refund dot'
)

app = replace_exact(app, '    +tertBars\n', '', label='remove old bar layer position')
app = replace_exact(app, '    +_soFar\n    +hits', '    +_soFar\n    +tertOverlay\n    +hits', label='event markers above trend lines')

app = replace_exact(
    app,
    "+'<title>'+esc(l)+' · '+primaryLabel+' '+fmtMoney(r)+' · '+secondaryLabel+' '+fmtMoney(p)+(tertiaryData?' · '+tertiaryLabel+' '+fmtMoney(t):'')+'</title>'",
    "+'<title>'+esc(l)+' · '+primaryLabel+' '+fmtMoney(r)+' · '+secondaryLabel+' '+fmtMoney(p)+(hasT?' · '+tertiaryLabel+' -'+fmtMoney(t)+(tertiaryCounts&&tertiaryCounts[i]?' · '+tertiaryCounts[i]+' event'+(tertiaryCounts[i]===1?'':'s'):''):'')+'</title>'",
    label='refund event native title'
)

# Scrub interaction: use the same fixed event rail and reveal amount/count there.
app = replace_exact(
    app,
    "  const tertiaryLabel=ctx.tertiaryLabel||'Net Profit';\n",
    "  const tertiaryLabel=ctx.tertiaryLabel||'Net Profit';\n  const tertiaryCounts=Array.isArray(ctx.tertiaryCounts)?ctx.tertiaryCounts:null;\n  const tertiaryEvents=!!ctx.tertiaryEvents;\n  const tertiaryEventY=Number(ctx.tertiaryEventY);\n",
    label='scrub event context'
)

app = replace_exact(
    app,
    "      if(tv!==0){sTert.setAttribute('cx',cx.toFixed(1));sTert.setAttribute('cy',sy(tv).toFixed(1));sTert.style.display='';}",
    "      if(tv!==0){sTert.setAttribute('cx',cx.toFixed(1));sTert.setAttribute('cy',(tertiaryEvents&&isFinite(tertiaryEventY)?tertiaryEventY:sy(tv)).toFixed(1));sTert.style.display='';}",
    label='scrub refund marker rail'
)

app = replace_exact(
    app,
    "      +(tertiaryData?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+tertiaryLabel+' <strong>'+fmtMoneyTip(tv)+'</strong></div>':'');",
    "      +(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+((tertiaryCounts&&Number(tertiaryCounts[idx])===1)?'Refund':'Refunds')+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' · '+Number(tertiaryCounts[idx])+(Number(tertiaryCounts[idx])===1?' event':' events'):'')+'</strong></div>':'');",
    label='scrub refund tooltip'
)

app = replace_exact(
    app,
    '    tertiaryData:tertiaryData,tertiaryColor:tertiaryColor,tertiaryLabel:tertiaryLabel});',
    '    tertiaryData:tertiaryData,tertiaryColor:tertiaryColor,tertiaryLabel:tertiaryLabel,tertiaryCounts:tertiaryCounts,tertiaryEvents:tertiaryEvents,tertiaryEventY:tertiaryEventY});',
    label='pass event context to scrubber'
)

# Legend only appears when the selected period actually contains a refund.
old_legend = '<span class="legend-item"><span class="legend-dot" style="background:var(--warn)"></span>Refunds</span>'
new_legend = "${chartReturns.some(function(v){return Number(v)>0;})?'<span class=\"legend-item\"><span class=\"legend-dot\" style=\"background:var(--surface);border:2px solid var(--red)\"></span>Refunds</span>':''}"
app = replace_exact(app, old_legend, new_legend, expected=2, label='conditional refund legends')
app = replace_exact(app, 'Sales &amp; returns over time', 'Sales &amp; profit over time', label='chart title')
app = replace_exact(
    app,
    'Sales revenue, gross profit and refunds over time',
    'Sales revenue, gross profit and refund events over time',
    expected=2,
    label='chart aria labels'
)

# ---------------------------------------------------------------------------
# Styling: compact field-level suggestions + subtle event reveal
# ---------------------------------------------------------------------------
css += """

/* v1.4.30 — contextual recall + semantic refund events */
.field-recall{
  display:none;
  margin-top:8px;
  gap:6px;
  flex-wrap:wrap;
}
.field-recall .recall-chip{
  min-height:36px;
  padding:0 12px;
  max-width:100%;
  font-size:12px;
  font-weight:600;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.rt-chart-refund-event{
  pointer-events:none;
  transform-box:fill-box;
  transform-origin:center;
}
@keyframes rtRefundEventIn{
  from{opacity:0;transform:scale(.82)}
  to{opacity:1;transform:scale(1)}
}
svg.rt-chart-draw .rt-chart-refund-event{
  animation:rtRefundEventIn 160ms var(--ease-out) both;
  animation-delay:calc(var(--dur-draw) * .88);
}
@media(prefers-reduced-motion:reduce){
  svg.rt-chart-draw .rt-chart-refund-event{animation:none!important;}
}
"""

# Cache-bust only the assets changed in this pass.
index = replace_exact(index, './app.css?v=1.4.29', './app.css?v=1.4.30', label='CSS cache bust')
index = replace_exact(index, './app.js?v=1.4.29', './app.js?v=1.4.30', label='JS cache bust')

checks = {
    'generic expense Recent removed': "${_recallChipsHTML('applyExpensePreset',_recallExpensePresets(),_recallExpLabel)}" not in app,
    'expense field suggestions': 'exp-recall-suggestions' in app and '_recallExpenseMatches' in app,
    'expense amount not auto-recalled': "const a=document.getElementById('exp-amt');if(a)a.value=Number(e.amount)||'';" not in app,
    'trip suggestions include mileage': 'trip-place-suggestions' in app and "+' mi'" in app,
    'dashboard refund event mode': app.count('tertiaryEvents:true') == 2,
    'refund event marker renderer': 'rt-chart-refund-event' in app,
    'dashboard refund bars removed': "tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryBars:true" not in app,
    'refund values excluded from scale': 'const _tert=(tertiaryData&&!tertiaryEvents)?tertiaryData:[];' in app,
    'refund counts supplied': 'chartReturnCounts,_chartPartialLast' in app,
    'conditional legend': app.count('chartReturns.some(function(v){return Number(v)>0;})') == 2,
}
failed = [name for name, ok in checks.items() if not ok]
if failed:
    raise RuntimeError('Post-patch checks failed: ' + ', '.join(failed))

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
print('Applied contextual input recall and semantic refund-event chart polish.')
