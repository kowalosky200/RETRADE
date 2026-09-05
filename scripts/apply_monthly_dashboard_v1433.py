from pathlib import Path
import re

APP=Path('app.js')
ACC=Path('accounting.js')
CSS=Path('app.css')
INDEX=Path('index.html')

app=APP.read_text(encoding='utf-8')
acc=ACC.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')
index=INDEX.read_text(encoding='utf-8')

MARK='/* v1.4.33 — stable Sales route + gross Dashboard + monthly P&L bridge */'
if MARK in css:
    print('v1.4.33 already applied')
    raise SystemExit(0)

def rep(text,old,new,count=1,label='replacement'):
    n=text.count(old)
    if n!=count:
        raise RuntimeError(f'{label}: expected {count}, found {n}')
    return text.replace(old,new)

def sub(text,pattern,repl,count=1,label='regex replacement',flags=0):
    out,n=re.subn(pattern,repl,text,count=count,flags=flags)
    if n!=count:
        raise RuntimeError(f'{label}: expected {count}, found {n}')
    return out

# ---------------------------------------------------------------------------
# 1. Sales route boot stability.
# Capture the complete monthly sub-route once before the loading renderer, then
# re-apply that exact snapshot before the hydrated render. Loading and live UI
# therefore cannot disagree (grid vs detail) during a hard refresh.
# ---------------------------------------------------------------------------
old_boot="""    const _safeTab = ['summary','monthly','stock','expenses','cash','returns','scrapped','tax','data','runs','activity'].includes(_lastTab) ? _lastTab : 'summary';
    // Local UI state is synchronous and must be restored BEFORE the loading
    // renderer so its geometry/subview is the exact page the user left.
    _loadUIState();
    showRealLayoutLoading(_safeTab, 'Loading your data…');
"""
new_boot="""    const _safeTab = ['summary','monthly','stock','expenses','cash','returns','scrapped','tax','data','runs','activity'].includes(_lastTab) ? _lastTab : 'summary';
    // v1.4.33 — Sales has two real sub-routes (calendar + month detail). Capture
    // the COMPLETE route before any boot render and re-apply it after hydration.
    // This prevents a stale in-memory MONTHLY_VIEW from painting Calendar for a
    // frame before the remembered month-detail route takes over.
    const _bootMonthlyRoute=(function(){
      if(_safeTab!=='monthly')return null;
      try{return {
        view:localStorage.getItem(_SK.monthV),
        selected:localStorage.getItem('_rt_mon_sel'),
        filter:localStorage.getItem('_rt_mon_filter'),
        sort:localStorage.getItem('_rt_mon_sort'),
        origin:localStorage.getItem('_rt_mon_origin')
      };}catch(e){return null;}
    })();
    const _restoreBootMonthlyRoute=function(){
      const r=_bootMonthlyRoute;if(!r)return;
      if(r.view==='grid'||r.view==='detail')MONTHLY_VIEW=r.view;
      if(r.selected&&/^[A-Z]{3}-\\d{2}$/.test(r.selected)&&MONTHS.includes(keyCode(r.selected)))SELECTED_MONTH=r.selected;
      if(r.filter)MONTH_FILTER=r.filter;
      if(r.sort)MONTH_SORT=r.sort;
      if(r.origin)_monthOrigin=r.origin;
    };
    // Local UI state is synchronous and must be restored BEFORE the loading
    // renderer so its geometry/subview is the exact page the user left.
    _loadUIState();
    _restoreBootMonthlyRoute();
    showRealLayoutLoading(_safeTab, 'Loading your data…');
"""
app=rep(app,old_boot,new_boot,label='boot route snapshot')
app=rep(app,"    else if(_safeTab==='monthly')renderMonthlyPage();","    else if(_safeTab==='monthly'){_restoreBootMonthlyRoute();renderMonthlyPage();}",label='hydrated monthly route restore')

# Persist month detail as one coherent route — view, selected month and origin
# are final before the single save occurs.
app=rep(app,"""  MONTH_FILTER='sold';
  MONTH_SORT='date-sold';
  SELECTED_ITEMS.clear();
  MONTHLY_VIEW='detail';_saveUIState();
  const cur=document.querySelector('.page.on');
""","""  MONTH_FILTER='sold';
  MONTH_SORT='date-sold';
  SELECTED_ITEMS.clear();
  MONTHLY_VIEW='detail';
  const cur=document.querySelector('.page.on');
""",label='defer month route save')
app=rep(app,"""  } else {
    _monthOrigin=(cur&&cur.id)||'p-summary';
  }
  if(cur&&cur.id==='p-monthly'){
    // _monthOrigin is final now, so persist the exact detail context before render.
    _saveUIState();
    renderMonthlyPage();
""","""  } else {
    _monthOrigin=(cur&&cur.id)||'p-summary';
  }
  // Persist the completed Sales sub-route once. No intermediate grid/detail
  // state is ever written for boot to observe.
  _saveUIState();
  if(cur&&cur.id==='p-monthly'){
    renderMonthlyPage();
""",label='atomic month route save')

# ---------------------------------------------------------------------------
# 2. Monthly refund-rate semantics.
# The monthly page is an activity-period view: if a return is listed in this
# month, its rate must also be represented in this month. Group refund events by
# sale cycle to avoid counting multiple partial adjustments as multiple items.
# Year/FY cohort analytics remain untouched.
# ---------------------------------------------------------------------------
old_refund="""  // Refund-rate cohort mirrors calcYearlyStats: of sales MADE this month, how
  // many were eventually affected by a refund? The cash/profit effect itself
  // remains on the actual refund date above.
  let fullRefundCount=0,partialOnlyCount=0;
  saleEvents.forEach(function(ev){
    const n=Math.max(1,Number(ev.sale)||1),rh=(ev.item&&ev.item.returnHistory)||[];
    const cycle=rh.filter(function(r){return Math.max(1,Number(r.saleNo)||1)===n;});
    if(cycle.some(function(r){return r.type==='full_seller'||r.type==='full_ebay';}))fullRefundCount++;
    else if(cycle.some(function(r){return r.type==='partial_seller'||r.type==='partial_ebay';}))partialOnlyCount++;
  });
  const refundedItemCount=fullRefundCount+partialOnlyCount,refundDenom=soldCount;
  const refundItemRate=refundDenom>0?(refundedItemCount/refundDenom*100):0;
  const refundCount=fullRefundCount,partialCount=partialOnlyCount;
"""
new_refund="""  // v1.4.33 — month-detail is an ACTIVITY-period view, not a sale cohort.
  // Returns shown in this month's list must contribute to this month's return
  // rate, even when the original sale occurred in an earlier month. Deduplicate
  // by item + sale cycle so several partial adjustments on one sale count once.
  const refundCycles=new Map();
  events.forEach(function(ev){
    if(!ev.isReturnAdjustment)return;
    const r=ev.returnEntry||{};
    const n=Math.max(1,Number(r.saleNo)||Number(ev.sale)||1);
    const id=(ev.item&&ev.item.id)||('event-'+eventCount);
    const key=id+':'+n;
    const slot=refundCycles.get(key)||{full:false,partial:false};
    if(r.type==='full_seller'||r.type==='full_ebay')slot.full=true;
    else if(r.type==='partial_seller'||r.type==='partial_ebay')slot.partial=true;
    refundCycles.set(key,slot);
  });
  let fullRefundCount=0,partialOnlyCount=0;
  refundCycles.forEach(function(x){if(x.full)fullRefundCount++;else if(x.partial)partialOnlyCount++;});
  const refundedItemCount=fullRefundCount+partialOnlyCount,refundDenom=soldCount;
  const refundItemRate=refundDenom>0?(refundedItemCount/refundDenom*100):0;
  const refundCount=fullRefundCount,partialCount=partialOnlyCount;
"""
acc=rep(acc,old_refund,new_refund,label='monthly event-period refund rate')

# Add a dedicated gross operational summary for the Dashboard. It deliberately
# excludes return adjustments: refunds stay visible as events, while the hero
# answers "what did we sell?". Monthly/FY reporting remains net.
needle="""function calcSummaryDeltas(){
"""
helper="""function _grossSummaryForRange(range){
  const sales=getSaleEventsInRange(range&&range.from,range&&range.to).filter(function(e){return !e.isReturnAdjustment;});
  let revenue=0,profit=0;
  sales.forEach(function(ev){
    const b=_saleBreakdown(ev);
    revenue+=(Number(b.salePrice)||0)+(Number(b.postage)||0);
    profit+=Number(b.netProfit)||0;
  });
  revenue=+revenue.toFixed(2);profit=+profit.toFixed(2);
  return {revenue:revenue,profit:profit,margin:revenue?+((profit/revenue)*100).toFixed(1):0,soldCount:sales.length};
}
function calcSummaryGrossStats(){return _grossSummaryForRange(_periodDateRange(SUMMARY_PERIOD));}
function calcSummaryGrossDeltas(){
  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);if(!prevKey)return null;
  const cur=calcSummaryGrossStats(),prev=_grossSummaryForRange(_prevPeriodRange(prevKey));
  const pct=function(c,p){if(p===null||p===undefined||Math.abs(p)<0.005)return null;return ((c-p)/Math.abs(p))*100;};
  return {revenue:pct(cur.revenue,prev.revenue),profit:pct(cur.profit,prev.profit),margin:cur.margin-prev.margin};
}

function calcSummaryDeltas(){
"""
acc=rep(acc,needle,helper,label='gross dashboard helpers')

# ---------------------------------------------------------------------------
# 3. Dashboard = gross operational view.
# Monthly detail + FY chart stay net. Refund-rate KPI remains a separate risk
# metric and is not folded into the gross series.
# ---------------------------------------------------------------------------
app=rep(app,"""    const stats=calcSummaryStats();
    const deltas=calcSummaryDeltas();
""","""    const stats=calcSummaryStats();
    const deltas=calcSummaryDeltas();
    const grossStats=calcSummaryGrossStats();
    const grossDeltas=calcSummaryGrossDeltas();
""",label='dashboard gross stats')

# Mobile hero.
app=rep(app,"<div class=\"kpi-label\">Net revenue · ${(periods.find(p=>p.key===SUMMARY_PERIOD)||{}).label||''}</div>","<div class=\"kpi-label\">Gross revenue · ${(periods.find(p=>p.key===SUMMARY_PERIOD)||{}).label||''}</div>",label='mobile gross revenue label')
app=rep(app,"data-cv=\"${Number(stats.totalRev||0)}\" data-cv-fmt=\"money\" data-cv-key=\"sum-m-rev\">${fmt(stats.totalRev||0)}","data-cv=\"${Number(grossStats.revenue||0)}\" data-cv-fmt=\"money\" data-cv-key=\"sum-m-rev\">${fmt(grossStats.revenue||0)}",label='mobile gross revenue value')
app=rep(app,"${deltaChip(deltas&&deltas.totalRev)||((stats.soldCount||0)+' sold')}","${deltaChip(grossDeltas&&grossDeltas.revenue)||((grossStats.soldCount||0)+' sold')}",label='mobile gross revenue delta')

# Mobile gross profit / margin pair.
app=rep(app,"data-cv=\"${Number(stats.grossProfit||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-m-gp\">${fmtK(stats.grossProfit||0)}","data-cv=\"${Number(grossStats.profit||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-m-gp\">${fmtK(grossStats.profit||0)}",label='mobile gross profit value')
app=rep(app,"${deltaChip(deltas&&deltas.grossProfit)||'After returns · before overheads'}","${deltaChip(grossDeltas&&grossDeltas.profit)||'Before refunds · before overheads'}",label='mobile gross profit foot')
app=rep(app,"<div class=\"kpi-label\">Avg margin</div>","<div class=\"kpi-label\">Gross margin</div>",count=2,label='gross margin labels')
app=rep(app,"data-cv=\"${Number(stats.grossMargin||0)}\" data-cv-fmt=\"pct0\" data-cv-key=\"sum-m-margin\">${Math.round(stats.grossMargin||0)}%","data-cv=\"${Number(grossStats.margin||0)}\" data-cv-fmt=\"pct0\" data-cv-key=\"sum-m-margin\">${Math.round(grossStats.margin||0)}%",label='mobile gross margin value')
app=rep(app,"${(deltaChip(deltas&&deltas.grossMargin,{pp:true})||'Item-level margin')}${stats.avgROI!=null?' · '+Math.round(stats.avgROI)+'% ROI':''}","${(deltaChip(grossDeltas&&grossDeltas.margin,{pp:true})||'Gross profit ÷ gross revenue')}${stats.avgROI!=null?' · '+Math.round(stats.avgROI)+'% ROI':''}",label='mobile gross margin foot')

# Desktop KPI strip.
old_desktop="""          <div class=\"card kpi clickable\" onclick=\"showFilteredItems('revenue')\"><div class=\"kpi-label\">Net revenue</div><div class=\"kpi-value num\" data-cv=\"${Number(stats.totalRev||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-rev\">${fmtK(stats.totalRev||0)}</div><div class=\"kpi-foot\">${deltaChip(deltas&&deltas.totalRev)||((stats.soldCount||0)+' sold in view')}</div></div>
          <div class=\"card kpi clickable kpi-netprofit\" onclick=\"showFilteredItems('realised')\"><div class=\"kpi-label\">Gross profit</div><div class=\"kpi-value num\" data-cv=\"${Number(stats.grossProfit||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-gp\">${fmtK(stats.grossProfit||0)}</div><div class=\"kpi-foot\">${deltaChip(deltas&&deltas.grossProfit)||'After returns · before overheads'}</div></div>
          <div class=\"card kpi clickable\" onclick=\"showMarginItems()\"><div class=\"kpi-label\">Gross margin</div><div class=\"kpi-value num\" data-cv=\"${Number(stats.grossMargin||0)}\" data-cv-fmt=\"pct0\" data-cv-key=\"sum-margin\">${Math.round(stats.grossMargin||0)}%</div><div class=\"kpi-foot\">${(deltaChip(deltas&&deltas.grossMargin,{pp:true})||'Item-level margin')}${stats.avgROI!=null?' · '+Math.round(stats.avgROI)+'% ROI':''}</div></div>
"""
new_desktop="""          <div class=\"card kpi clickable\" onclick=\"showFilteredItems('revenue')\"><div class=\"kpi-label\">Gross revenue</div><div class=\"kpi-value num\" data-cv=\"${Number(grossStats.revenue||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-rev\">${fmtK(grossStats.revenue||0)}</div><div class=\"kpi-foot\">${deltaChip(grossDeltas&&grossDeltas.revenue)||((grossStats.soldCount||0)+' sold in view')}</div></div>
          <div class=\"card kpi clickable kpi-netprofit\" onclick=\"showFilteredItems('realised')\"><div class=\"kpi-label\">Gross profit</div><div class=\"kpi-value num\" data-cv=\"${Number(grossStats.profit||0)}\" data-cv-fmt=\"k\" data-cv-key=\"sum-gp\">${fmtK(grossStats.profit||0)}</div><div class=\"kpi-foot\">${deltaChip(grossDeltas&&grossDeltas.profit)||'Before refunds · before overheads'}</div></div>
          <div class=\"card kpi clickable\" onclick=\"showMarginItems()\"><div class=\"kpi-label\">Gross margin</div><div class=\"kpi-value num\" data-cv=\"${Number(grossStats.margin||0)}\" data-cv-fmt=\"pct0\" data-cv-key=\"sum-margin\">${Math.round(grossStats.margin||0)}%</div><div class=\"kpi-foot\">${(deltaChip(grossDeltas&&grossDeltas.margin,{pp:true})||'Gross profit ÷ gross revenue')}${stats.avgROI!=null?' · '+Math.round(stats.avgROI)+'% ROI':''}</div></div>
"""
app=rep(app,old_desktop,new_desktop,label='desktop gross KPIs')

# Chart copy: chart data already excludes refund adjustments, so make its gross
# contract explicit rather than implying net monthly reporting.
app=rep(app,'Sales Revenue','Gross Revenue',count=4,label='dashboard gross chart legend/labels')
app=rep(app,'Sales &amp; profit over time','Gross revenue &amp; profit over time',label='dashboard chart title')
app=rep(app,'Sales revenue, gross profit and refund events over time','Gross revenue, gross profit and refund events over time',count=2,label='dashboard aria')

# ---------------------------------------------------------------------------
# 4. Month detail is explicitly NET and uses return-event semantics everywhere.
# ---------------------------------------------------------------------------
app=rep(app,"const cSold=events.filter(e=>!e.isReturned).length;","const cSold=events.filter(e=>!e.isReturnAdjustment).length;",label='month sold count canonical')
app=rep(app,"const cReturned=events.filter(e=>e.isReturned).length;","const cReturned=events.filter(e=>e.isReturnAdjustment).length;",label='month return count canonical')
app=rep(app,"if(MONTH_FILTER==='sold')visible=events.filter(e=>!e.isReturned);","if(MONTH_FILTER==='sold')visible=events.filter(e=>!e.isReturnAdjustment);",label='month sold filter canonical')
app=rep(app,"else if(MONTH_FILTER==='returned')visible=events.filter(e=>e.isReturned);","else if(MONTH_FILTER==='returned')visible=events.filter(e=>e.isReturnAdjustment);",label='month return filter canonical')
app=rep(app,"<div class=\"kpi-label\">Revenue${stats.returnsAmt>0?' (net)':''}</div>","<div class=\"kpi-label\">Net Revenue</div>",label='month net revenue label')
app=rep(app,"${fmt(stats.grossRev)} gross − ${fmt(stats.returnsAmt)} returns","${fmt(stats.grossRev)} gross − ${fmt(stats.returnsAmt)} refunds",label='month net revenue breakdown')

# Return-rate helper text now says what the denominator is. If returns exist but
# there were no sales this month, percentage is deliberately undefined rather
# than a misleading 0%.
old_rate="""  const refundSub=stats.refundDenom===0?'No sales'
    :(stats.fullRefundCount||0)+' full · '+(stats.partialOnlyCount||0)+' partial';
"""
new_rate="""  const refundSub=stats.refundDenom===0
    ?((stats.refundedItemCount||0)>0?((stats.refundedItemCount||0)+' return'+((stats.refundedItemCount||0)===1?'':'s')+' this month · no sales denominator'):'No sales')
    :(stats.fullRefundCount||0)+' full · '+(stats.partialOnlyCount||0)+' partial · '+stats.refundDenom+' sale'+(stats.refundDenom===1?'':'s');
"""
app=rep(app,old_rate,new_rate,label='monthly refund rate copy')

# ---------------------------------------------------------------------------
# 5. Year/FY supporting card: a concise P&L bridge rather than a vague cost list.
# It complements the Net Revenue / Net Profit chart by showing how gross sales
# become net profit, while preserving exact reconciliation to the same P&L engine.
# ---------------------------------------------------------------------------
old_flow_html="""function _monthlyMoneyFlowHTML(){
  return '<div class=\"card summary-panel money-flow-card\">'
    +'<div class=\"summary-chart-head\"><div class=\"sl\">Where the money went</div></div>'
    +'<div id=\"monthly-money-flow\" class=\"money-flow-rows\"></div></div>';
}
"""
new_flow_html="""function _monthlyMoneyFlowHTML(){
  return '<div class=\"card summary-panel money-flow-card\">'
    +'<div class=\"summary-chart-head monthly-performance-head\"><div><div class=\"sl\">Profit breakdown</div><div class=\"monthly-chart-sub\">How gross revenue becomes net profit</div></div></div>'
    +'<div id=\"monthly-money-flow\" class=\"money-flow-rows\"></div></div>';
}
"""
app=rep(app,old_flow_html,new_flow_html,label='profit breakdown header')

old_flow_body="""  const turnover=Number(p.revenue)||0;
  const cogs=Number(p.cogs)||0;
  const selling=Number((p.selling&&p.selling.total))||0;
  const overheads=Number((p.overheads&&p.overheads.total))||0;
  const net=Number(p.netProfit)||0;

  if(turnover<=0){
    host.innerHTML='<div class=\"mf-foot\">No sales in '+esc(r.label)+'. Once you log sales, this shows exactly where your money goes.</div>';
    return;
  }
  const pct=function(v){return Math.max(0,Math.min(100,(Math.abs(v)/turnover)*100));};
  const row=function(label,val,colour){
    return '<div class=\"mf-row\">'
      +'<div class=\"mf-top\"><span class=\"mf-label\">'+esc(label)+'</span><span class=\"mf-val\">'+fmt(val)+'</span></div>'
      +'<div class=\"mf-bar\"><span class=\"mf-fill\" style=\"width:'+pct(val).toFixed(1)+'%;background:'+colour+'\"></span></div>'
      +'</div>';
  };
  const netColour=net>=0?'var(--green)':'var(--red)';
  host.innerHTML=
     row('Turnover',turnover,'var(--state-listed)')
    +row('− Cost of goods',cogs,'var(--red)')
    +row('− Selling costs (fees, postage, splits)',selling,'var(--red)')
    +row('− Overheads (trips, expenses)',overheads,'var(--warn)')
    +'<div class=\"mf-row mf-net\">'
      +'<div class=\"mf-top\"><span class=\"mf-label\">Net profit</span><span class=\"mf-val\" style=\"color:'+netColour+'\">'+fmt(net)+'</span></div>'
      +'<div class=\"mf-bar\"><span class=\"mf-fill\" style=\"width:'+pct(net).toFixed(1)+'%;background:'+netColour+'\"></span></div>'
    +'</div>'
    +'<div class=\"mf-foot\">'+esc(r.label)+' · '+(p.soldCount||0)+' sold. Bars are % of turnover. Reconciles with your Tax Return.</div>';
"""
new_flow_body="""  const grossRevenue=Number(p.revenue)||0;
  const flowEvents=getSaleEventsInRange(r.from,r.to);
  const customerRefunds=+flowEvents.filter(function(e){return e.isReturnAdjustment;})
    .reduce(function(sum,e){return sum+Math.max(0,-(Number(e.salePrice)||0));},0).toFixed(2);
  const netRevenue=+(grossRevenue-customerRefunds).toFixed(2);
  const cogs=Number(p.cogs)||0;
  const selling=Number((p.selling&&p.selling.total))||0;
  // p.selling.total includes the customer refund itself plus any return postage.
  // Pull only the customer refund out here so it is not double-counted; return
  // postage and all other selling costs remain in this line and reconciliation.
  const otherSelling=+(selling-customerRefunds).toFixed(2);
  const overheads=Number((p.overheads&&p.overheads.total))||0;
  const net=Number(p.netProfit)||0;

  if(grossRevenue<=0){
    host.innerHTML='<div class=\"mf-foot\">No sales in '+esc(r.label)+'. Once you log sales, this will bridge gross revenue to net profit.</div>';
    return;
  }
  const pct=function(v){return Math.max(0,Math.min(100,(Math.abs(v)/grossRevenue)*100));};
  const row=function(label,val,colour,cls){
    return '<div class=\"mf-row'+(cls?' '+cls:'')+'\">'
      +'<div class=\"mf-top\"><span class=\"mf-label\">'+esc(label)+'</span><span class=\"mf-val\">'+fmt(val)+'</span></div>'
      +'<div class=\"mf-bar\"><span class=\"mf-fill\" style=\"width:'+pct(val).toFixed(1)+'%;background:'+colour+'\"></span></div>'
      +'</div>';
  };
  const netColour=net>=0?'var(--green)':'var(--red)';
  const margin=netRevenue!==0?(net/netRevenue*100):null;
  host.innerHTML=
     row('Gross revenue',grossRevenue,'var(--state-listed)','mf-key')
    +(customerRefunds>0?row('− Refunds',customerRefunds,'var(--red)','mf-deduction'):'')
    +row('= Net revenue',netRevenue,'var(--state-listed)','mf-key mf-net-revenue')
    +row('− Cost of goods',cogs,'var(--red)','mf-deduction')
    +row('− Selling costs',otherSelling,'var(--red)','mf-deduction')
    +row('− Overheads',overheads,'var(--warn)','mf-deduction')
    +'<div class=\"mf-row mf-net\">'
      +'<div class=\"mf-top\"><span class=\"mf-label\">Net profit</span><span class=\"mf-val\" style=\"color:'+netColour+'\">'+fmt(net)+'</span></div>'
      +'<div class=\"mf-bar\"><span class=\"mf-fill\" style=\"width:'+pct(net).toFixed(1)+'%;background:'+netColour+'\"></span></div>'
    +'</div>'
    +'<div class=\"mf-foot\">'+esc(r.label)+' · '+(p.soldCount||0)+' sold'+(margin!==null?' · '+margin.toFixed(1)+'% net margin':'')+'. Bars are % of gross revenue · reconciles with your Tax Return.</div>';
"""
app=rep(app,old_flow_body,new_flow_body,label='profit breakdown bridge')

# Small precision improvement to FY chart copy.
app=rep(app,'Top line vs what you kept after all costs','Net revenue vs net profit after all costs',label='FY chart subtitle')

# v1.4.33 visual hierarchy for the P&L bridge. Revenue endpoints are blue; cost
# rows recede; Net Profit remains the strongest green/red endpoint.
css += """

/* v1.4.33 — stable Sales route + gross Dashboard + monthly P&L bridge */
.rt #p-monthly .money-flow-card .mf-row.mf-key{padding-top:11px;padding-bottom:11px;}
.rt #p-monthly .money-flow-card .mf-row.mf-key .mf-label,
.rt #p-monthly .money-flow-card .mf-row.mf-key .mf-val{font-weight:700;color:var(--text);}
.rt #p-monthly .money-flow-card .mf-row.mf-net-revenue{border-top:1px solid var(--border);border-bottom:1px solid var(--border);margin-top:2px;margin-bottom:2px;}
.rt #p-monthly .money-flow-card .mf-row.mf-deduction .mf-label{color:var(--text-secondary);}
.rt #p-monthly .money-flow-card .mf-row.mf-deduction .mf-fill{opacity:.72;}
.rt #p-monthly .money-flow-card .mf-net{margin-top:6px;padding-top:12px;border-top:1px solid var(--border);}
.rt #p-monthly .money-flow-card .mf-foot{line-height:1.45;}
"""

# Cache-bust all app assets using the established patch version.
index=index.replace('1.4.32','1.4.33')
if '1.4.33' not in index:
    raise RuntimeError('cache version bump did not apply')

APP.write_text(app,encoding='utf-8')
ACC.write_text(acc,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
INDEX.write_text(index,encoding='utf-8')
print('Applied v1.4.33 stable Sales route, gross Dashboard, monthly refund-rate and P&L bridge patch.')
