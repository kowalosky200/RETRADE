from pathlib import Path


def rep(text, old, new, count=1, label='replacement'):
    n=text.count(old)
    if n!=count:
        raise RuntimeError(f'{label}: expected {count}, found {n}')
    return text.replace(old,new,count)

app_path=Path('app.js')
css_path=Path('app.css')
index_path=Path('index.html')
app=app_path.read_text(encoding='utf-8')
css=css_path.read_text(encoding='utf-8')
index=index_path.read_text(encoding='utf-8')

# Dashboard legend: marker only. Counts belong to the selected point, not the legend.
old_dash_legend="${chartReturns.some(function(v){return Number(v)>0;})?'<span class=\"legend-item\"><span class=\"legend-event-mark\"></span>Refunds ('+chartReturnCounts.reduce(function(s,v){return s+(Number(v)||0);},0)+')</span>':''}"
new_dash_legend="${chartReturns.some(function(v){return Number(v)>0;})?'<span class=\"legend-item\"><span class=\"legend-event-mark\"></span>Refunds</span>':''}"
app=rep(app,old_dash_legend,new_dash_legend,count=2,label='dashboard legend counts')

# Tooltip: label owns the count; the money column stays right-aligned with all other values.
app=rep(app,
    "+(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+tertiaryLabel+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' ('+Number(tertiaryCounts[idx])+')':'')+'</strong></div>':'');",
    "+(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+tertiaryLabel+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' ('+Number(tertiaryCounts[idx])+')':'')+' <strong>−'+fmtMoneyTip(tv)+'</strong></div>':'');",
    label='refund scrub tooltip layout')

# Native SVG titles follow the same Refunds (n) -> amount reading order.
app=rep(app,
    "+'<title>'+tertiaryLabel+' '+fmtMoney(t)+(count?' ('+count+')':'')+'</title></g>';",
    "+'<title>'+tertiaryLabel+(count?' ('+count+')':'')+' · '+fmtMoney(t)+'</title></g>';",
    label='dashboard refund title')
app=rep(app,
    "(tertiaryCounts&&tertiaryCounts[i]?' ('+tertiaryCounts[i]+')':'')",
    "(tertiaryCounts&&tertiaryCounts[i]?' ('+tertiaryCounts[i]+')':'')",
    count=1,label='noop guard')
# Replace the full column title expression so count sits after the Refunds label rather than after amount.
old_col_title="+'<title>'+esc(l)+' · '+primaryLabel+' '+fmtMoney(r)+' · '+secondaryLabel+' '+fmtMoney(p)+(hasT?' · '+tertiaryLabel+' -'+fmtMoney(t)+(tertiaryCounts&&tertiaryCounts[i]?' ('+tertiaryCounts[i]+')':''):'')+'</title>'"
new_col_title="+'<title>'+esc(l)+' · '+primaryLabel+' '+fmtMoney(r)+' · '+secondaryLabel+' '+fmtMoney(p)+(hasT?' · '+tertiaryLabel+(tertiaryCounts&&tertiaryCounts[i]?' ('+tertiaryCounts[i]+')':'')+' -'+fmtMoney(t):'')+'</title>'"
app=rep(app,old_col_title,new_col_title,label='column refund title order')

# FY legend: no aggregate count. It is a series label; point-specific counts appear on interaction.
app=rep(app,
    "if(hasRefunds)refundLegend.innerHTML='<span class=\"monthly-legend-refund-line\"></span>Refunds ('+refundTotalCount+')';",
    "if(hasRefunds)refundLegend.innerHTML='<span class=\"monthly-legend-refund-line\"></span>Refunds';",
    label='FY refund legend count')
# refundTotalCount is no longer needed once the legend stops displaying it.
app=rep(app,
    "  const refundTotalCount=refundCounts.reduce(function(s,v){return s+(Number(v)||0);},0);\n",
    "",
    label='unused FY refund total count')

# Revenue columns: make completed months read as solid filled columns, while the live month stays provisional.
app=rep(app,
    "fill-opacity=\"'+(isPartial?'0.12':'0.30')+'\" stroke=\"'+primaryColor+'\" stroke-opacity=\"'+(isPartial?'0.52':'0.72')+'\"",
    "fill-opacity=\"'+(isPartial?'0.12':'0.82')+'\" stroke=\"'+primaryColor+'\" stroke-opacity=\"'+(isPartial?'0.52':'0.94')+'\"",
    label='filled FY revenue bars')

# Sales is a genuine two-level route. Explicit Sales navigation must preserve whichever subview
# the user last chose instead of always forcing current-month detail.
old_month_nav="""  else if(name==='monthly'){
    // A genuine Sales-tab navigation starts at the live month and Back goes to
    // the top of Calendar. goToMonth() sets _monthOpenFromContext while routing
    // through this same tab switch so an explicit month/origin is not overwritten.
    if(!_monthOpenFromContext){_monthOrigin='calendar-top';SELECTED_MONTH=currentMonthKey();MONTHLY_VIEW='detail';MONTH_FILTER='all';MONTH_SORT='date-sold';}
    _renderTab(renderMonthlyPage);
    // Save AFTER the Sales route has chosen current-month detail vs calendar.
    // The old save happened earlier in goToTab and could persist the previous subview.
    _saveUIState();
  }
"""
new_month_nav="""  else if(name==='monthly'){
    // Sales is a two-level route: Calendar is the overview, Month is drill-down.
    // Preserve the user's last real subview instead of forcing current-month detail
    // every time the Sales tab is selected. Explicit goToMonth() still owns detail.
    if(!_monthOpenFromContext){
      if(MONTHLY_VIEW!=='grid'&&MONTHLY_VIEW!=='detail')MONTHLY_VIEW='grid';
      if(MONTHLY_VIEW==='detail'&&!SELECTED_MONTH)SELECTED_MONTH=currentMonthKey();
      if(MONTHLY_VIEW==='grid')_monthOrigin='calendar-top';
      // A deliberate return to the Calendar is a new visual visit. Re-arm only
      // the chart draw gate; background/data rerenders remain silent.
      if(MONTHLY_VIEW==='grid')delete _chartDrawKey['monthly-profitability-svg'];
    }
    _renderTab(renderMonthlyPage);
    _saveUIState();
  }
"""
app=rep(app,old_month_nav,new_month_nav,label='Sales route preservation')

# Back to Calendar canonicalises the route and re-arms the chart reveal so its historical
# draw -> dedicated dotted current-period phase is visible again when the user returns.
app=rep(app,
    "function backToMonthlyGrid(restoreMonth){\n  MONTHLY_VIEW='grid';_saveUIState();",
    "function backToMonthlyGrid(restoreMonth){\n  MONTHLY_VIEW='grid';_monthOrigin='calendar-top';\n  delete _chartDrawKey['monthly-profitability-svg'];\n  _saveUIState();",
    label='calendar back route')

# Explicit Dashboard entry is also a meaningful chart visit. Re-arm the two responsive SVGs;
# live/background rerenders still use the existing draw-key gate and do not replay motion.
app=rep(app,
    "  if(name==='summary')_renderTab(renderSummary);",
    "  if(name==='summary'){delete _chartDrawKey['summary-chart-svg'];delete _chartDrawKey['summary-chart-svg-mobile'];_renderTab(renderSummary);}",
    label='dashboard chart visit motion')

# FY refund legend uses the exact same line grammar as Net Profit, only fainter/red.
css=rep(css,
    ".monthly-legend-refund-line{display:inline-block;width:12px;height:0;border-top:1.5px solid var(--red);border-radius:999px;opacity:.72;flex:none;position:relative;}\n.monthly-legend-refund-line::after{content:\"\";position:absolute;width:4px;height:4px;border-radius:50%;background:var(--red);left:4px;top:-2.75px;}",
    ".monthly-legend-refund-line{display:inline-block;width:12px;height:0;border-top:2px solid var(--red);border-radius:999px;opacity:.58;flex:none;}",
    label='FY refund legend line consistency')

# Keep the carefully tuned v1.4.32 partial sequence intact, but document the re-arm behaviour.
css += "\n\n/* v1.4.35 — chart legend/value alignment + explicit-view motion re-arm */\n.rt .rt-chart-scrub-tip .tip-row{min-width:0;}\n.rt .rt-chart-scrub-tip .tip-row strong{min-width:52px;text-align:right;}\n"

# Asset busting.
index=rep(index,'app.css?v=1.4.34','app.css?v=1.4.35',label='css cache bump')
index=rep(index,'app.js?v=1.4.34','app.js?v=1.4.35',label='js cache bump')

app_path.write_text(app,encoding='utf-8')
css_path.write_text(css,encoding='utf-8')
index_path.write_text(index,encoding='utf-8')
