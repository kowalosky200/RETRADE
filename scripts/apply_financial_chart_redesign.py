from pathlib import Path
import re
import sys

APP = Path('app.js')
CSS = Path('app.css')
INDEX = Path('index.html')

app = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')

MARKER = '/* v1.4.31 — compact recall + financial chart redesign */'
if MARKER in css:
    print('v1.4.31 already applied; nothing to do.')
    sys.exit(0)


def replace_exact(text, old, new, expected=1, label='replacement'):
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} match(es), found {count}')
    return text.replace(old, new)


def replace_regex(text, pattern, new, expected=1, label='regex replacement'):
    text2, count = re.subn(pattern, lambda _m: new, text, count=expected, flags=re.S)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected} match(es), found {count}')
    return text2


# ---------------------------------------------------------------------------
# 1) Expense recall — compact, relevance-ranked, with convenient amount reuse.
#    Selecting a remembered expense now prefills the latest amount. If the same
#    description has genuinely different historical prices, expose up to four
#    previous values as small explicit choices beneath Amount.
# ---------------------------------------------------------------------------
new_expense_recall = r'''function _recallExpLabel(b){
  const e=b&&b.last?b.last:{};
  return (e.description||'Expense').trim();
}
function _recallExpenseMatches(query){
  const key=_recallKey(query);
  if(!key){_recallExp=[];return _recallExp;}
  const ranked=_frecencyRank((DB.expenses||[]),function(e){return e.description||'';},
                            function(e){return e.date;},24);
  const matchRank=function(desc){
    const d=_recallKey(desc);
    if(d===key)return 0;
    if(d.indexOf(key)===0)return 1;
    const words=d.split(/[^a-z0-9]+/).filter(Boolean);
    if(words.some(function(w){return w.indexOf(key)===0;}))return 2;
    return d.indexOf(key)!==-1?3:99;
  };
  _recallExp=ranked.map(function(b){
    return {key:b.key,count:b.count,last:b.last,lastDate:b.lastDate,score:b.score,matchRank:matchRank((b.last&&b.last.description)||'')};
  }).filter(function(b){return b.matchRank<99;})
    .sort(function(a,b){return (a.matchRank-b.matchRank)||(b.score-a.score)||((Date.parse(b.lastDate)||0)-(Date.parse(a.lastDate)||0));})
    .slice(0,(window.innerWidth<=600?3:4));
  return _recallExp;
}
function _recallExpenseSuggest(){
  const input=document.getElementById('exp-desc');
  const box=document.getElementById('exp-recall-suggestions');
  if(!input||!box)return;
  const hist=document.getElementById('exp-amount-history');
  if(hist)hist.style.display='none';
  const items=_recallExpenseMatches(input.value);
  if(!items.length){box.innerHTML='';box.style.display='none';return;}
  box.innerHTML=items.map(function(b,i){
    const e=b.last||{};
    const desc=(e.description||'Expense').trim();
    const meta=[];
    if(e.category)meta.push(e.category);
    if(Number(e.amount)>0)meta.push(fmt(Number(e.amount)));
    return '<button type="button" class="recall-chip field-recall-option" onclick="applyExpensePreset('+i+')">'
      +'<span class="field-recall-main">'+esc(desc)+'</span>'
      +(meta.length?'<span class="field-recall-meta">'+esc(meta.join(' · '))+'</span>':'')
      +'</button>';
  }).join('');
  box.style.display='flex';
}
function _recallExpenseHide(){
  const box=document.getElementById('exp-recall-suggestions');
  if(box)box.style.display='none';
}
function _expenseAmountHistory(description){
  const key=_recallKey(description);
  if(!key)return [];
  const rows=(DB.expenses||[]).filter(function(e){return _recallKey(e.description||'')===key&&Number(e.amount)>0;})
    .slice().sort(function(a,b){return (Date.parse(b.date)||0)-(Date.parse(a.date)||0);});
  const seen=new Set(),vals=[];
  rows.forEach(function(e){
    const v=Math.round((Number(e.amount)||0)*100)/100;
    const k=v.toFixed(2);
    if(v>0&&!seen.has(k)){seen.add(k);vals.push(v);}
  });
  return vals.slice(0,4);
}
function _renderExpenseAmountHistory(description,selectedAmount){
  const box=document.getElementById('exp-amount-history');
  if(!box)return;
  const vals=_expenseAmountHistory(description);
  if(vals.length<2){box.innerHTML='';box.style.display='none';return;}
  const sel=Number(selectedAmount)||0;
  box.innerHTML='<span class="expense-history-label">Paid before</span>'
    +vals.map(function(v){
      return '<button type="button" class="expense-amount-chip'+(Math.abs(v-sel)<0.005?' active':'')+'" onclick="applyExpenseAmountPreset('+v+')">'+fmt(v)+'</button>';
    }).join('');
  box.style.display='flex';
}
function applyExpenseAmountPreset(v){
  const a=document.getElementById('exp-amt');if(!a)return;
  a.value=Number(v)||'';
  document.querySelectorAll('#exp-amount-history .expense-amount-chip').forEach(function(btn){
    btn.classList.toggle('active',btn.textContent===fmt(Number(v)||0));
  });
  try{a.focus();a.select();}catch(e){}
}
function applyExpensePreset(i){
  const b=_recallExp[i];if(!b)return;
  const e=b.last||{};
  const d=document.getElementById('exp-desc');if(d)d.value=e.description||'';
  const c=document.getElementById('exp-cat');if(c&&e.category)c.value=e.category;
  const a=document.getElementById('exp-amt');if(a&&Number(e.amount)>0)a.value=Number(e.amount);
  _recallExpenseHide();
  _renderExpenseAmountHistory(e.description||'',e.amount);
  if(a){try{a.focus();a.select();}catch(e2){}}
}

'''
app = replace_regex(
    app,
    r"function _recallExpLabel\(b\)\{.*?(?=/\* ---- trip locations:)",
    new_expense_recall,
    label='expense recall block'
)

app = replace_exact(
    app,
    '<div class="fg"><label>Amount (£)</label><input type="number" id="exp-amt" step="0.01" min="0" placeholder="0.00" inputmode="decimal"></div>',
    '<div class="fg"><label>Amount (£)</label><input type="number" id="exp-amt" step="0.01" min="0" placeholder="0.00" inputmode="decimal"><div id="exp-amount-history" class="expense-amount-history"></div></div>',
    label='run expense amount history host'
)
app = replace_exact(
    app,
    '''    <div class="fg">
      <label>Amount (£)</label>
      <input type="number" id="exp-amt" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
    </div>''',
    '''    <div class="fg">
      <label>Amount (£)</label>
      <input type="number" id="exp-amt" step="0.01" min="0" placeholder="0.00" inputmode="decimal">
      <div id="exp-amount-history" class="expense-amount-history"></div>
    </div>''',
    label='expense amount history host'
)
app = replace_exact(
    app,
    "  const a=document.getElementById('exp-amt');if(a)a.value=Number(e.amount)||'';\n  if(a){try{a.focus();a.select();}catch(e2){}}",
    "  const a=document.getElementById('exp-amt');if(a)a.value=Number(e.amount)||'';\n  _renderExpenseAmountHistory(e.description||'',e.amount);\n  if(a){try{a.focus();a.select();}catch(e2){}}",
    label='duplicate expense amount history'
)


# ---------------------------------------------------------------------------
# 2) Dashboard trend — refund activity becomes tiny timeline notches below the
#    plot rather than numbered circles competing with the profit line. Current
#    FY is YTD only and the live month gets the same dashed/hollow treatment as
#    the rolling dashboard periods instead of drawing future months as zero.
# ---------------------------------------------------------------------------
app = replace_exact(
    app,
    '    const _chartPartialLast=(range.to===_todayStr);',
    "    const _chartPartialLast=(range.to===_todayStr)||SUMMARY_PERIOD==='current_fy';",
    label='current FY partial month'
)
app = replace_exact(
    app,
    "      const keys=_fyKeys(SUMMARY_PERIOD==='current_fy'?_currentFYStart():_currentFYStart()-1);\n      keys.forEach(k=>{",
    "      let keys=_fyKeys(SUMMARY_PERIOD==='current_fy'?_currentFYStart():_currentFYStart()-1);\n      if(SUMMARY_PERIOD==='current_fy'){const ci=keys.indexOf(currentMonthKey());if(ci>=0)keys=keys.slice(0,ci+1);}\n      keys.forEach(k=>{",
    label='current FY YTD keys'
)

# Generic chart engine gains two presentation-only switches used by the Sales
# chart: primary columns and an optional extra tooltip metric. Dashboard callers
# keep their existing defaults, so this is backwards-compatible.
app = replace_exact(
    app,
    "  const tertiaryBarOpacity=opts.tertiaryBarOpacity!=null?Math.max(0.08,Math.min(0.5,Number(opts.tertiaryBarOpacity)||0.22)):0.22;\n  const fillColor=opts.fillColor||secondaryColor;",
    "  const tertiaryBarOpacity=opts.tertiaryBarOpacity!=null?Math.max(0.08,Math.min(0.5,Number(opts.tertiaryBarOpacity)||0.22)):0.22;\n  const primaryBars=!!opts.primaryBars;\n  const primaryBarMaxW=opts.primaryBarMaxW!=null?Math.max(10,Number(opts.primaryBarMaxW)||30):30;\n  const showArea=opts.showArea!==false;\n  const extraTooltipData=Array.isArray(opts.extraTooltipData)?opts.extraTooltipData:null;\n  const extraTooltipLabel=opts.extraTooltipLabel||'Gross Profit';\n  const extraTooltipColor=opts.extraTooltipColor||'var(--text-secondary)';\n  const fillColor=opts.fillColor||secondaryColor;",
    label='chart presentation options'
)

app = replace_regex(
    app,
    r"  // Refunds are event annotations, not a third quantitative series\. In event\n  // mode every marker sits on one fixed rail INSIDE the plot;.*?\n  const hits=labels\.map",
    r'''  // Optional primary columns (used by the yearly Sales performance chart).
  // They keep magnitude reading separate from the trend line while sharing the
  // same money axis. Bars always originate at the true £0 baseline.
  const primaryBarW=Math.max(8,Math.min(primaryBarMaxW,(n>1?xStep:innerW)*0.42));
  const primaryBarsHTML=primaryBars?revData.map(function(raw,i){
    const r=Number(raw)||0;if(r===0)return '';
    const cx=sx(i),y0=sy(0),yr=sy(r),h=Math.max(1.5,Math.abs(y0-yr)),y=Math.min(y0,yr);
    const isPartial=_partial&&i===n-1;
    const cls='rt-chart-primary-bar'+(r<0?' rt-chart-primary-bar--negative':'')+(isPartial?' rt-chart-primary-bar--partial':'');
    return '<rect class="'+cls+'" style="--bar-i:'+i+'" x="'+(cx-primaryBarW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+primaryBarW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="'+Math.min(4,primaryBarW/3).toFixed(1)+'" fill="'+primaryColor+'" fill-opacity="'+(isPartial?'0.12':'0.20')+'" stroke="'+primaryColor+'" stroke-opacity="'+(isPartial?'0.52':'0.62')+'" stroke-width="1"'+(isPartial?' stroke-dasharray="3 2"':'')+'/>';
  }).join(''):'';

  // Refunds are annotations, not a third money series. Put them in the x-axis
  // gutter below the plot so low-profit periods never collide with a marker.
  const tertiaryEventY=H-pad.b+Math.max(5,Math.min(7,fontSize*0.48));
  const tertiaryBarW=Math.max(3.5,Math.min(tertiaryBarMaxW,(n>1?xStep:innerW)*0.22));
  const tertOverlay=tertiaryData?tertiaryData.map(function(raw,i){
    const t=Math.max(0,Number(raw)||0);
    if(t<=0)return '';
    const cx=sx(i);
    if(tertiaryEvents){
      const count=tertiaryCounts?Math.max(0,Number(tertiaryCounts[i])||0):1;
      const w=count>1?8:6;
      return '<g class="rt-chart-refund-event" data-refund-count="'+count+'">'
        +'<rect x="'+(cx-w/2).toFixed(1)+'" y="'+(tertiaryEventY-1.5).toFixed(1)+'" width="'+w+'" height="3" rx="1.5" fill="'+tertiaryColor+'" opacity="0.92"/>'
        +'<title>'+tertiaryLabel+' '+fmtMoney(t)+(count?' · '+count+' event'+(count===1?'':'s'):'')+'</title></g>';
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
  const hits=labels.map''',
    label='chart bars and refund notches'
)

app = replace_exact(
    app,
    "+((hasR&&(showDots||_isLast))?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    "+((hasR&&!primaryBars&&(showDots||_isLast))?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    label='hide persistent revenue dots for bar mode'
)
app = replace_exact(
    app,
    "    +'<path class=\"rt-chart-area\" d=\"'+area+'\" fill=\"url(#'+gradientId+')\" stroke=\"none\"/>'\n    +tertOverlay",
    "    +(showArea?'<path class=\"rt-chart-area\" d=\"'+area+'\" fill=\"url(#'+gradientId+')\" stroke=\"none\"/>':'')\n    +primaryBarsHTML\n    +tertOverlay",
    label='area gate and primary bars render'
)
app = replace_exact(
    app,
    "    +'<path class=\"rt-chart-line\" d=\"'+line+'\" fill=\"none\" stroke=\"'+primaryColor+'\" stroke-width=\"'+revStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>'\n    +(revDash?'<path class=\"rt-chart-partial\" d=\"'+revDash+'\" fill=\"none\" stroke=\"'+primaryColor+'\" stroke-width=\"'+revStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.6\"/>':'')",
    "    +(primaryBars?'':'<path class=\"rt-chart-line\" d=\"'+line+'\" fill=\"none\" stroke=\"'+primaryColor+'\" stroke-width=\"'+revStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>')\n    +(!primaryBars&&revDash?'<path class=\"rt-chart-partial\" d=\"'+revDash+'\" fill=\"none\" stroke=\"'+primaryColor+'\" stroke-width=\"'+revStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.6\"/>':'')",
    label='primary line gate for bar mode'
)
app = replace_exact(
    app,
    '    tertiaryData:tertiaryData,tertiaryColor:tertiaryColor,tertiaryLabel:tertiaryLabel,tertiaryCounts:tertiaryCounts,tertiaryEvents:tertiaryEvents,tertiaryEventY:tertiaryEventY});',
    '    tertiaryData:tertiaryData,tertiaryColor:tertiaryColor,tertiaryLabel:tertiaryLabel,tertiaryCounts:tertiaryCounts,tertiaryEvents:tertiaryEvents,tertiaryEventY:tertiaryEventY,extraTooltipData:extraTooltipData,extraTooltipLabel:extraTooltipLabel,extraTooltipColor:extraTooltipColor});',
    label='extra tooltip context pass'
)
app = replace_exact(
    app,
    "  const tertiaryEventY=Number(ctx.tertiaryEventY);\n  const parent=svgEl.parentElement;",
    "  const tertiaryEventY=Number(ctx.tertiaryEventY);\n  const extraTooltipData=Array.isArray(ctx.extraTooltipData)?ctx.extraTooltipData:null;\n  const extraTooltipLabel=ctx.extraTooltipLabel||'Gross Profit';\n  const extraTooltipColor=ctx.extraTooltipColor||'var(--text-secondary)';\n  const parent=svgEl.parentElement;",
    label='extra tooltip scrub context'
)
app = replace_exact(
    app,
    "      +'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+secondaryColor+'\"></span>'+secondaryLabel+' <strong>'+fmtMoneyTip(p)+'</strong></div>'\n      +(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+((tertiaryCounts&&Number(tertiaryCounts[idx])===1)?'Refund':'Refunds')+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' · '+Number(tertiaryCounts[idx])+(Number(tertiaryCounts[idx])===1?' event':' events'):'')+'</strong></div>':'');",
    "      +'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+secondaryColor+'\"></span>'+secondaryLabel+' <strong>'+fmtMoneyTip(p)+'</strong></div>'\n      +(extraTooltipData?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+extraTooltipColor+'\"></span>'+extraTooltipLabel+' <strong>'+fmtMoneyTip(extraTooltipData[idx]||0)+'</strong></div>':'')\n      +(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+((tertiaryCounts&&Number(tertiaryCounts[idx])===1)?'Refund':'Refunds')+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' · '+Number(tertiaryCounts[idx])+(Number(tertiaryCounts[idx])===1?' event':' events'):'')+'</strong></div>':'');",
    label='extra tooltip row'
)

old_refund_legend = '<span class="legend-item"><span class="legend-dot" style="background:var(--surface);border:2px solid var(--red)"></span>Refunds</span>'
app = replace_exact(app, old_refund_legend, '<span class="legend-item"><span class="legend-event-mark"></span>Refunds</span>', expected=2, label='dashboard refund legend marks')


# ---------------------------------------------------------------------------
# 3) Sales / yearly chart — professional top-line vs bottom-line combo.
#    Visible: Net Revenue columns + Net Profit line. Gross Profit stays available
#    on scrub as a supporting number; refunds are the same subtle event notches as
#    the Dashboard. Future months are not manufactured as £0 observations.
# ---------------------------------------------------------------------------
new_monthly_html = r'''function _monthlyNetProfitChartHTML(){
  return '<div class="monthly-charts-row">'
    +'<div class="card summary-panel summary-chart-card monthly-profitability-card">'
    +'<div class="summary-chart-head monthly-performance-head"><div><div class="sl">Monthly performance</div><div class="monthly-chart-sub">Top line vs what you kept after all costs</div></div>'
    +'<div class="summary-chart-legend">'
    +'<span class="legend-item"><span class="monthly-legend-bar"></span>Net Revenue</span>'
    +'<span class="legend-item"><span class="monthly-legend-line"></span>Net Profit</span>'
    +'<span class="legend-item" id="monthly-refund-legend" style="display:none"><span class="legend-event-mark"></span>Refunds</span></div>'
    +'</div>'
    +'<svg id="monthly-profitability-svg" viewBox="0 0 800 360" preserveAspectRatio="none" role="img" aria-label="Monthly net revenue columns, net profit trend and refund events"></svg></div>'
    +_monthlyMoneyFlowHTML()
    +'</div>';
}

'''
app = replace_regex(
    app,
    r"function _monthlyNetProfitChartHTML\(\)\{.*?(?=// FY-to-date money flow\.)",
    new_monthly_html,
    label='monthly chart shell'
)

new_monthly_render = r'''function renderMonthlyProfitabilityChart(){
  const svg=document.getElementById('monthly-profitability-svg');
  if(!svg)return;
  const _box=svg.getBoundingClientRect();
  const _W=Math.max(320,Math.round(_box.width)||800);
  const _H=Math.max(200,Math.round(_box.height)||360);
  const per=_monthlyPeriodResolve(MONTHLY_PERIOD);
  const now=new Date(),curStart=new Date(now.getFullYear(),now.getMonth(),1);
  let keys=per.keys.filter(function(k){
    const mo=MONTHS.indexOf(keyCode(k));
    return mo>=0&&new Date(keyYear(k),mo,1)<=curStart;
  });
  if(!keys.length){
    svg.innerHTML='<text x="50%" y="50%" text-anchor="middle" font-size="13" fill="var(--text-tertiary)" font-family="var(--font-body)">No completed months in this period yet</text>';
    renderMonthlyMoneyFlow();
    return;
  }
  const showYear=keys.length>12;
  const labels=[],netRevenue=[],grossProfit=[],netProfit=[],refunds=[],refundCounts=[];
  keys.forEach(function(k){
    const ms=calcMonthStatsBySale(k);
    const short=MONTH_NAMES[keyCode(k)].slice(0,3);
    labels.push(showYear?short+' '+String(keyYear(k)).slice(-2):short);
    netRevenue.push(Number(ms.totalRev)||0);
    grossProfit.push(Number(ms.grossProfit)||0);
    netProfit.push(Number(ms.netProfit)||0);
    refunds.push(Number(ms.returnsAmt)||0);
    refundCounts.push(Number(ms.returnedCount)||0);
  });
  const currentIsLast=keys[keys.length-1]===currentMonthKey();
  const refundLegend=document.getElementById('monthly-refund-legend');
  if(refundLegend)refundLegend.style.display=refunds.some(function(v){return v>0;})?'inline-flex':'none';

  _renderChartInto(svg,labels,netRevenue,netProfit,[],{
    W:_W,H:_H,
    pad:{t:18,r:16,b:44,l:60},
    fontSize:13,
    yTicks:4,
    maxXLabels:_W<520?6:(keys.length>18?12:keys.length),
    profitDotR:_W<520?3:2.7,revDotR:0,
    profitStroke:_W<520?2.4:2.1,revStroke:0,scrubDotR:_W<520?5:4.5,
    maxDotsN:14,
    primaryColor:'var(--state-listed)',
    secondaryColor:'var(--profit)',
    primaryLabel:'Net Revenue',
    secondaryLabel:'Net Profit',
    primaryBars:true,
    primaryBarMaxW:_W<520?24:34,
    showArea:false,
    extraTooltipData:grossProfit,
    extraTooltipLabel:'Gross Profit',
    extraTooltipColor:'var(--text-secondary)',
    tertiaryData:refunds,
    tertiaryCounts:refundCounts,
    tertiaryColor:'var(--red)',
    tertiaryLabel:'Refunds',
    tertiaryStroke:0,
    tertiaryMarkersOnly:true,
    tertiaryAlwaysDots:true,
    tertiaryEvents:true,
    drawKey:'monthly:'+MONTHLY_PERIOD,
    gradientId:'rt-monthly-profit-fill',
    partialLast:currentIsLast
  });
  renderMonthlyMoneyFlow();
}

'''
app = replace_regex(
    app,
    r"function renderMonthlyProfitabilityChart\(\)\{.*?(?=function renderMonthlyGrid\(\))",
    new_monthly_render,
    label='monthly performance renderer'
)


# ---------------------------------------------------------------------------
# 4) CSS polish + motion. Append overrides so the previous v1.4.30 rules stay
#    backwards-compatible for any other recall chips while these field results
#    become a compact suggestion list.
# ---------------------------------------------------------------------------
css += r'''

/* v1.4.31 — compact recall + financial chart redesign */
.field-recall{
  margin-top:6px;
  gap:4px;
  flex-direction:column;
  flex-wrap:nowrap;
  max-height:132px;
  overflow:auto;
  padding:1px;
}
.field-recall .recall-chip{
  width:100%;
  min-height:34px;
  height:auto;
  padding:7px 9px;
  border-radius:9px;
  justify-content:flex-start;
  gap:9px;
  font-size:12px;
  text-align:left;
  background:var(--surface2);
}
.field-recall-main{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.field-recall-meta{flex:0 1 44%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);font-size:10.5px;font-weight:500;text-align:right;}
.expense-amount-history{display:none;align-items:center;gap:5px;flex-wrap:wrap;margin-top:7px;}
.expense-history-label{font-size:10.5px;color:var(--text-secondary);font-weight:600;margin-right:2px;}
.expense-amount-chip{height:29px;padding:0 9px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text-secondary);font:600 11px var(--font-body);cursor:pointer;}
.expense-amount-chip:hover,.expense-amount-chip.active{border-color:var(--accent);color:var(--text);background:var(--accent-dim);}
.expense-amount-chip:active{transform:scale(.97);}

.legend-event-mark{display:inline-block;width:10px;height:3px;border-radius:999px;background:var(--red);flex:none;}

.rt-chart-primary-bar{transform-box:fill-box;transform-origin:center bottom;}
.rt-chart-primary-bar--negative{transform-origin:center top;}
@keyframes rtChartBarIn{from{transform:scaleY(.04)}to{transform:scaleY(1)}}
svg.rt-chart-draw .rt-chart-primary-bar{
  animation:rtChartBarIn 380ms var(--ease-draw) both;
  animation-delay:calc(var(--bar-i) * 20ms);
}
@keyframes rtRefundEventNotchIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
svg.rt-chart-draw .rt-chart-refund-event{
  animation:rtRefundEventNotchIn 150ms var(--ease-out) both;
  animation-delay:calc(var(--dur-draw) * .84);
}

.rt #p-monthly .monthly-performance-head{align-items:flex-start;}
.rt #p-monthly .monthly-chart-sub{font-size:10.5px;color:var(--text-tertiary);margin-top:3px;line-height:1.35;}
.rt #p-monthly .monthly-legend-bar{display:inline-block;width:10px;height:8px;border-radius:2px;background:var(--state-listed);opacity:.72;flex:none;}
.rt #p-monthly .monthly-legend-line{display:inline-block;width:12px;height:0;border-top:2px solid var(--profit);border-radius:999px;flex:none;}
.rt #p-monthly .monthly-profitability-card .summary-chart-legend{align-items:center;flex-wrap:wrap;row-gap:6px;}

@media(max-width:600px){
  .field-recall{max-height:116px;gap:3px;}
  .field-recall .recall-chip{min-height:32px;padding:6px 8px;border-radius:8px;font-size:11.5px;}
  .field-recall-meta{font-size:10px;max-width:42%;}
  .expense-amount-chip{height:28px;padding:0 8px;}
  .rt #p-monthly .monthly-performance-head{gap:8px;}
  .rt #p-monthly .monthly-profitability-card .summary-chart-legend{gap:10px;font-size:10.5px;}
}
@media(prefers-reduced-motion:reduce){
  svg.rt-chart-draw .rt-chart-primary-bar,
  svg.rt-chart-draw .rt-chart-refund-event{animation:none!important;}
}
'''

# Cache-bust only changed assets.
index = replace_exact(index, './app.css?v=1.4.30', './app.css?v=1.4.31', label='CSS cache bust')
index = replace_exact(index, './app.js?v=1.4.30', './app.js?v=1.4.31', label='JS cache bust')

checks = {
    'compact expense suggestions': 'field-recall-option' in app and '.field-recall-main' in app,
    'expense amount recall': '_renderExpenseAmountHistory' in app and 'applyExpenseAmountPreset' in app,
    'current FY is YTD': "SUMMARY_PERIOD==='current_fy'" in app and 'keys=keys.slice(0,ci+1)' in app,
    'refund notches': 'height="3" rx="1.5" fill="'+"'"+'+tertiaryColor' in app or 'rt-chart-refund-event' in app,
    'monthly combo chart': 'primaryBars:true' in app and "primaryLabel:'Net Revenue'" in app and "secondaryLabel:'Net Profit'" in app,
    'gross profit tooltip support': 'extraTooltipData:grossProfit' in app,
    'future months filtered': 'new Date(keyYear(k),mo,1)<=curStart' in app,
    'cache bump css': './app.css?v=1.4.31' in index,
    'cache bump js': './app.js?v=1.4.31' in index,
}
failed=[k for k,v in checks.items() if not v]
if failed:
    raise RuntimeError('Post-patch checks failed: '+', '.join(failed))

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
print('Applied v1.4.31 compact recall and financial chart redesign.')
