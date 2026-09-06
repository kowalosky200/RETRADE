from pathlib import Path


def rep(text, old, new, count=1, label='replacement'):
    n=text.count(old)
    if n!=count:
        raise RuntimeError(f'{label}: expected {count}, found {n}')
    return text.replace(old,new,count)


def replace_in_slice(text, start_marker, end_marker, transform, label):
    s=text.index(start_marker)
    e=text.index(end_marker,s+len(start_marker))
    before=text[:s]
    chunk=text[s:e]
    after=text[e:]
    new_chunk=transform(chunk)
    if new_chunk==chunk:
        raise RuntimeError(f'{label}: slice unchanged')
    return before+new_chunk+after

app_path=Path('app.js')
css_path=Path('app.css')
acct_path=Path('accounting.js')
index_path=Path('index.html')
app=app_path.read_text(encoding='utf-8')
css=css_path.read_text(encoding='utf-8')
acct=acct_path.read_text(encoding='utf-8')
index=index_path.read_text(encoding='utf-8')

# ---------------------------------------------------------------------------
# 1) Sales routing: a deliberate Sales-tab click opens the live month.
#    Boot/reload restoration remains separate in initDB(), so reloading an
#    explicitly opened Calendar still restores Calendar without flicker.
# ---------------------------------------------------------------------------
old_sales_nav="""  else if(name==='monthly'){
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
new_sales_nav="""  else if(name==='monthly'){
    // A deliberate Sales-tab click is the fast daily workflow: open THIS month.
    // Calendar remains a real sub-route and hard reload restores it through the
    // boot-route snapshot in initDB(); only an explicit nav click resets to live month.
    if(!_monthOpenFromContext){
      _monthOrigin='calendar-top';
      SELECTED_MONTH=currentMonthKey();
      MONTHLY_VIEW='detail';
      MONTH_FILTER='all';
      MONTH_SORT='date-sold';
    }
    _renderTab(renderMonthlyPage);
    _saveUIState();
  }
"""
app=rep(app,old_sales_nav,new_sales_nav,label='Sales tab default current month')

# Background sync/save refresh must respect Calendar vs month-detail. The old
# renderMonth() call was the remaining source of the page "fighting" the user.
app=rep(app,"  else if(id==='p-monthly')renderMonth();","  else if(id==='p-monthly')renderMonthlyPage();",label='active Sales subroute refresh')

# ---------------------------------------------------------------------------
# 2) Restore the intended current-period motion: the historical line completes,
#    pauses very slightly, then the provisional tail reveals visibly dash-by-dash.
#    Tail duration adapts to geometry so short and steep segments feel consistent.
# ---------------------------------------------------------------------------
old_dash_block="""  const _mkDashMarks=function(data,color,strokeWidth,opacity){
    if(!_partial)return '';
    const x1=sx(n-2),y1=sy(data[n-2]||0),x2=sx(n-1),y2=sy(data[n-1]||0);
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy);
    if(!isFinite(dist)||dist<=0.01)return '';
    const dashLen=4.2,gap=3.2,step=dashLen+gap;
    let out='<g class=\"rt-chart-partial-group\" opacity=\"'+opacity+'\">',di=0;
    for(let pos=0;pos<dist;pos+=step,di++){
      const end=Math.min(pos+dashLen,dist);
      const a=pos/dist,b=end/dist;
      const ax=x1+dx*a,ay=y1+dy*a,bx=x1+dx*b,by=y1+dy*b;
      out+='<line class=\"rt-chart-partial-dash\" style=\"--dash-delay:'+(di*22)+'ms\" x1=\"'+ax.toFixed(1)+'\" y1=\"'+ay.toFixed(1)+'\" x2=\"'+bx.toFixed(1)+'\" y2=\"'+by.toFixed(1)+'\" stroke=\"'+color+'\" stroke-width=\"'+strokeWidth+'\" stroke-linecap=\"round\"/>';
    }
    return out+'</g>';
  };
"""
new_dash_block="""  let _maxPartialTailMs=0;
  const _mkDashMarks=function(data,color,strokeWidth,opacity){
    if(!_partial)return '';
    const x1=sx(n-2),y1=sy(data[n-2]||0),x2=sx(n-1),y2=sy(data[n-1]||0);
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy);
    if(!isFinite(dist)||dist<=0.01)return '';
    const dashLen=4.2,gap=3.2,step=dashLen+gap;
    const dashCount=Math.max(1,Math.ceil(dist/step));
    // Keep the reveal clearly sequential without letting a steep segment drag on.
    // Most tails land around 0.4–0.65s after the historical line completes.
    const dashStagger=Math.max(26,Math.min(42,520/Math.max(1,dashCount-1)));
    let out='<g class=\"rt-chart-partial-group\" opacity=\"'+opacity+'\">',di=0;
    for(let pos=0;pos<dist;pos+=step,di++){
      const end=Math.min(pos+dashLen,dist);
      const a=pos/dist,b=end/dist;
      const ax=x1+dx*a,ay=y1+dy*a,bx=x1+dx*b,by=y1+dy*b;
      out+='<line class=\"rt-chart-partial-dash\" style=\"--dash-delay:'+Math.round(di*dashStagger)+'ms\" x1=\"'+ax.toFixed(1)+'\" y1=\"'+ay.toFixed(1)+'\" x2=\"'+bx.toFixed(1)+'\" y2=\"'+by.toFixed(1)+'\" stroke=\"'+color+'\" stroke-width=\"'+strokeWidth+'\" stroke-linecap=\"round\"/>';
    }
    _maxPartialTailMs=Math.max(_maxPartialTailMs,Math.max(360,Math.round(Math.max(0,di-1)*dashStagger+125)));
    return out+'</g>';
  };
"""
app=rep(app,old_dash_block,new_dash_block,label='adaptive dash reveal')

# Do not build hidden partial paths: Dashboard refund events and FY revenue bars
# previously did string/geometry work for lines that were never inserted.
app=rep(app,"""  let tertLine='',tertPartial='';
  if(tertiaryData){
    tertLine=_mkLine(tertiaryData,0,_solidTo);
    tertPartial=_mkDashMarks(tertiaryData,tertiaryColor,tertiaryStroke,0.58);
  }

  // Revenue line (primary visual)
  const line=_mkLine(revData,0,_solidTo);
  const revPartial=_mkDashMarks(revData,primaryColor,revStroke,0.68);
  const _soFar=""",
"""  let tertLine='',tertPartial='';
  if(tertiaryData&&!tertiaryMarkersOnly&&!tertiaryBars){
    tertLine=_mkLine(tertiaryData,0,_solidTo);
    tertPartial=_mkDashMarks(tertiaryData,tertiaryColor,tertiaryStroke,0.58);
  }

  // Revenue line only exists on line charts; FY revenue is rendered as bars.
  const line=primaryBars?'':_mkLine(revData,0,_solidTo);
  const revPartial=primaryBars?'':_mkDashMarks(revData,primaryColor,revStroke,0.68);
  if(_partial)svgEl.style.setProperty('--partial-tail-ms',(_maxPartialTailMs||360)+'ms');
  else svgEl.style.removeProperty('--partial-tail-ms');
  const _soFar=""",label='skip hidden partial paths')

old_partial_css="""svg.rt-chart-draw .rt-chart-partial-dash{
  opacity:0;
  transform-box:fill-box;
  transform-origin:center;
  animation:rtChartPartialDashIn 95ms var(--ease-out) both;
  animation-delay:calc(var(--dur-draw) + var(--dash-delay,0ms));
}
svg.rt-chart-draw .rt-chart-so-far{
  opacity:0;
  animation:rtChartFadeIn 160ms var(--ease-out) both;
  animation-delay:calc(var(--dur-draw) + 210ms);
}
svg.rt-chart-draw .rt-chart-col circle.rt-chart-partial-dot{
  animation-delay:calc(var(--dur-draw) + 280ms)!important;
}
"""
new_partial_css="""svg.rt-chart-draw .rt-chart-partial-dash{
  opacity:0;
  transform-box:fill-box;
  transform-origin:center;
  animation:rtChartPartialDashIn 125ms var(--ease-out) both;
  /* A small pause is the visual hand-off from actual history to "so far". */
  animation-delay:calc(var(--dur-draw) + 85ms + var(--dash-delay,0ms));
}
svg.rt-chart-draw .rt-chart-so-far{
  opacity:0;
  animation:rtChartFadeIn 160ms var(--ease-out) both;
  animation-delay:calc(var(--dur-draw) + 85ms + var(--partial-tail-ms,520ms) - 55ms);
}
svg.rt-chart-draw .rt-chart-col circle.rt-chart-partial-dot{
  animation-delay:calc(var(--dur-draw) + 85ms + var(--partial-tail-ms,520ms) + 20ms)!important;
}
"""
css=rep(css,old_partial_css,new_partial_css,label='slower partial motion CSS')

# ---------------------------------------------------------------------------
# 3) Dashboard render hot path: reuse the same item/event/breakdown work inside
#    one render and stop recalculating current-period stats for delta helpers.
# ---------------------------------------------------------------------------
app=rep(app,
"""    const stats=calcSummaryStats();
    const deltas=calcSummaryDeltas();
    const grossStats=calcSummaryGrossStats();
    const grossDeltas=calcSummaryGrossDeltas();
""",
"""    const stats=calcSummaryStats();
    const deltas=calcSummaryDeltas(stats);
    const grossStats=calcSummaryGrossStats();
    const grossDeltas=calcSummaryGrossDeltas(grossStats);
    const _summaryItems=allItems();
""",label='summary current stats reuse')
app=rep(app,"const _isFirstRunEmpty=allItems().length===0","const _isFirstRunEmpty=_summaryItems.length===0",label='summary empty items cache')
app=rep(app,"const activeStock=allItems().filter(function(i){","const activeStock=_summaryItems.filter(function(i){",label='summary active items cache')
app=rep(app,"const listedInPeriod=allItems().filter(i=>i.dateListed&&i.dateListed>=range.from&&i.dateListed<=range.to).length;","const listedInPeriod=_summaryItems.filter(i=>i.dateListed&&i.dateListed>=range.from&&i.dateListed<=range.to).length;",label='summary listed items cache')

app=rep(app,
"""    const sold=getSaleEventsInRange(range.from,range.to)
      .filter(function(ev){return !ev.isReturnAdjustment&&!ev.isReturned;})
      .map(function(ev){
        const b=_saleBreakdown(ev);
""",
"""    const _summaryRangeEvents=getSaleEventsInRange(range.from,range.to);
    const _summaryBreakdowns=new WeakMap();
    const _summaryBreakdown=function(ev){
      let b=_summaryBreakdowns.get(ev);
      if(!b){b=_saleBreakdown(ev);_summaryBreakdowns.set(ev,b);}
      return b;
    };
    const sold=_summaryRangeEvents
      .filter(function(ev){return !ev.isReturnAdjustment&&!ev.isReturned;})
      .map(function(ev){
        const b=_summaryBreakdown(ev);
""",label='summary event and breakdown cache')
app=rep(app,"const chartEvents=getSaleEventsInRange(range.from,range.to);","const chartEvents=_summaryRangeEvents;",label='summary rolling event reuse')
app=rep(app,"const salesRevenue=sales.reduce(function(sum,x){const sb=_saleBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0);","const salesRevenue=sales.reduce(function(sum,x){const sb=_summaryBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0);",count=1,label='summary FY revenue breakdown cache')
app=rep(app,"const salesProfit=sales.reduce(function(sum,x){return sum+(Number(_saleBreakdown(x).netProfit)||0);},0);","const salesProfit=sales.reduce(function(sum,x){return sum+(Number(_summaryBreakdown(x).netProfit)||0);},0);",count=1,label='summary FY profit breakdown cache')
app=rep(app,"rev:sales.reduce(function(sum,x){const sb=_saleBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0),","rev:sales.reduce(function(sum,x){const sb=_summaryBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0),",count=1,label='summary bucket revenue breakdown cache')
app=rep(app,"profit:sales.reduce(function(sum,x){return sum+(Number(_saleBreakdown(x).netProfit)||0);},0),","profit:sales.reduce(function(sum,x){return sum+(Number(_summaryBreakdown(x).netProfit)||0);},0),",count=1,label='summary bucket profit breakdown cache')

# ---------------------------------------------------------------------------
# 4) Calendar: one canonical all-event pass + one monthly-stat calculation per
#    month per render. Previously FY rollups, cards and chart recomputed the same
#    month 2–3 times and each call rescanned every item.
# ---------------------------------------------------------------------------
app=rep(app,"function renderMonthlyProfitabilityChart(){","function renderMonthlyProfitabilityChart(statsForMonth){",label='monthly chart optional stats cache')
app=rep(app,"    const ms=calcMonthStatsBySale(k);\n    const short=MONTH_NAMES[keyCode(k)].slice(0,3);","    const ms=(typeof statsForMonth==='function')?statsForMonth(k):calcMonthStatsBySale(k);\n    const short=MONTH_NAMES[keyCode(k)].slice(0,3);",count=1,label='monthly chart use stats cache')


def patch_grid(chunk):
    anchor="  const currentFY=_currentFYStart();\n"
    insert="""  const currentFY=_currentFYStart();

  // Per-render analytics index. getSaleEventsInMonth() scans every item, so
  // doing that independently for every FY rollup/card/chart was quadratic-ish
  // as history grew. Build the canonical Sale-N event set once, group by month,
  // and share it with calcMonthStatsBySale() for this render.
  const _calendarAllEvents=getSaleEventsInRange(null,null);
  const _calendarEventsByMonth=new Map();
  _calendarAllEvents.forEach(function(ev){
    const mk=_monthKeyFromDate(ev.saleDate);if(!mk)return;
    if(!_calendarEventsByMonth.has(mk))_calendarEventsByMonth.set(mk,[]);
    _calendarEventsByMonth.get(mk).push(ev);
  });
  const _calendarStatsCtx={eventsByMonth:_calendarEventsByMonth,tieredTrips:calcTieredTrips(DB.trips||[])};
  const _monthStatsCache=new Map();
  const monthStats=function(k){
    if(!_monthStatsCache.has(k))_monthStatsCache.set(k,calcMonthStatsBySale(k,_calendarStatsCtx));
    return _monthStatsCache.get(k);
  };
  const monthEvents=function(k){return _calendarEventsByMonth.get(k)||[];};
"""
    if chunk.count(anchor)!=1: raise RuntimeError('calendar cache anchor mismatch')
    chunk=chunk.replace(anchor,insert,1)
    if chunk.count('calcMonthStatsBySale(k)')!=2: raise RuntimeError('calendar stats call count mismatch')
    chunk=chunk.replace('calcMonthStatsBySale(k)','monthStats(k)')
    if chunk.count('getSaleEventsInMonth(k)')!=1: raise RuntimeError('calendar events call count mismatch')
    chunk=chunk.replace('getSaleEventsInMonth(k)','monthEvents(k)')
    if chunk.count('renderMonthlyProfitabilityChart();')!=1: raise RuntimeError('calendar chart call count mismatch')
    chunk=chunk.replace('renderMonthlyProfitabilityChart();','renderMonthlyProfitabilityChart(monthStats);',1)
    return chunk

app=replace_in_slice(app,'function renderMonthlyGrid(){','function toggleMonthPicker(){',patch_grid,'calendar per-render caches')

# ---------------------------------------------------------------------------
# 5) Month picker: activity labels do not need a full P&L calculation for every
#    month. Build lightweight sold/return counts in one pass, then only count
#    active listings in that month's own bucket.
# ---------------------------------------------------------------------------
old_picker="""              const curFY=_currentFYStart();
              const liveMonthKey=currentMonthKey();
              const fySet=new Set();
              allDBKeys().forEach(k=>{const code=keyCode(k);const yr=keyYear(k);const mo=MONTHS.indexOf(code);const fy=mo>=3?yr:yr-1;fySet.add(fy);});
              const fyYears=Array.from(fySet).sort((a,b)=>b-a);
              let out='';
              fyYears.forEach(fy=>{
                const keys=_fyKeys(fy);
                const isCur=fy===curFY;
                // Pre-filter the keys for this FY so we can skip empty FYs.
                const visibleEntries=keys.map(k=>{
                  const ms=calcMonthStatsBySale(k);
                  const hasActivity=ms.soldCount>0||ms.listedCount>0||ms.eventCount>0;
                  const isActiveSel=k===m;        // currently viewing this month
                  const isLiveMonth=k===liveMonthKey;
                  if(!hasActivity&&!isActiveSel&&!isLiveMonth)return null;
                  return {k,ms,hasActivity,isLiveMonth};
                }).filter(Boolean);
                if(visibleEntries.length===0)return; // skip empty FYs
                out+='<div class=\"month-picker-fy-header\">FY '+_getFYLabelHTML(fy)+(isCur?' · Current':'')+'</div>';
                visibleEntries.forEach(({k,ms,hasActivity,isLiveMonth})=>{
                  const sub=hasActivity
                    ?'<span class=\"month-picker-option-sub\">'+ms.soldCount+' sold · '+ms.listedCount+' active</span>'
                    :'<span class=\"month-picker-option-sub\" style=\"opacity:0.4\">'+(isLiveMonth?'this month':'no activity')+'</span>';
"""
new_picker="""              const curFY=_currentFYStart();
              const liveMonthKey=currentMonthKey();
              const fySet=new Set();
              const _pickerActivity=new Map();
              const _pickerSlot=function(k){
                if(!_pickerActivity.has(k))_pickerActivity.set(k,{soldCount:0,eventCount:0});
                return _pickerActivity.get(k);
              };
              // One lightweight history pass: no fees, P&L, trip tiers or expense
              // aggregation are needed just to label the month picker.
              allDBKeys().forEach(function(src){
                const code=keyCode(src),yr=keyYear(src),mo=MONTHS.indexOf(code);
                if(mo>=0)fySet.add(mo>=3?yr:yr-1);
                (DB[src]||[]).forEach(function(i){
                  if((i.item||'').trim().toUpperCase()==='MONTH END')return;
                  _saleCycleNumbers(i).forEach(function(n){
                    const c=_saleCycleSnapshot(i,n),mk=c&&c.date?_monthKeyFromDate(c.date):null;
                    if(!mk)return;const a=_pickerSlot(mk);a.soldCount++;a.eventCount++;
                  });
                  (i.returnHistory||[]).forEach(function(r){
                    const d=_returnEventDate(r),mk=d?_monthKeyFromDate(d):null;
                    if(mk)_pickerSlot(mk).eventCount++;
                  });
                });
              });
              const fyYears=Array.from(fySet).sort((a,b)=>b-a);
              let out='';
              fyYears.forEach(fy=>{
                const keys=_fyKeys(fy);
                const isCur=fy===curFY;
                // Pre-filter the keys for this FY so we can skip empty FYs.
                const visibleEntries=keys.map(k=>{
                  const a=_pickerActivity.get(k)||{soldCount:0,eventCount:0};
                  const listedCount=(DB[k]||[]).filter(function(i){
                    return (i.item||'').trim().toUpperCase()!=='MONTH END'&&!i.scrappedAt&&!i.isReturned&&!i.dateSold&&!i.resaleSalePrice;
                  }).length;
                  const hasActivity=a.soldCount>0||listedCount>0||a.eventCount>0;
                  const isActiveSel=k===m;        // currently viewing this month
                  const isLiveMonth=k===liveMonthKey;
                  if(!hasActivity&&!isActiveSel&&!isLiveMonth)return null;
                  return {k,soldCount:a.soldCount,listedCount,hasActivity,isLiveMonth};
                }).filter(Boolean);
                if(visibleEntries.length===0)return; // skip empty FYs
                out+='<div class=\"month-picker-fy-header\">FY '+_getFYLabelHTML(fy)+(isCur?' · Current':'')+'</div>';
                visibleEntries.forEach(({k,soldCount,listedCount,hasActivity,isLiveMonth})=>{
                  const sub=hasActivity
                    ?'<span class=\"month-picker-option-sub\">'+soldCount+' sold · '+listedCount+' active</span>'
                    :'<span class=\"month-picker-option-sub\" style=\"opacity:0.4\">'+(isLiveMonth?'this month':'no activity')+'</span>';
"""
app=rep(app,old_picker,new_picker,label='lightweight month picker analytics')

# ---------------------------------------------------------------------------
# 6) Cross-device refresh: full Supabase pulls can legitimately return identical
#    business state (focus/visibility/revision safety checks). Avoid rebuilding
#    the current page when nothing changed. Fingerprint covers items, returns via
#    item JSON, trips, expenses, cash, activity, runs, accounts, job lots and recon.
# ---------------------------------------------------------------------------
app=rep(app,
"""function _dbFingerprint(){
  const fp = {};
""",
"""function _dbFingerprint(){
  const fp = {};
""",label='fingerprint anchor noop')
# Insert equality helper immediately after fingerprint function using a stable tail.
fp_tail="""  if(_reconciliationSchemaAvailable)(_saleReconciliations||[]).forEach(r => { fp['recon:'+r.id] = JSON.stringify(r); });
  return fp;
}

async function _persistChangesPass(){
"""
fp_new="""  if(_reconciliationSchemaAvailable)(_saleReconciliations||[]).forEach(r => { fp['recon:'+r.id] = JSON.stringify(r); });
  return fp;
}
function _dbFingerprintsEqual(a,b){
  a=a||{};b=b||{};
  const ak=Object.keys(a),bk=Object.keys(b);
  if(ak.length!==bk.length)return false;
  for(let i=0;i<ak.length;i++){const k=ak[i];if(a[k]!==b[k])return false;}
  return true;
}

async function _persistChangesPass(){
"""
app=rep(app,fp_tail,fp_new,label='fingerprint equality helper')

app=rep(app,
"""    await loadFromSupabase();
    _dbSnapshot=_dbFingerprint();
    _initActivityShadow();
    _lastCloudRefreshAt=Date.now();
    refreshActivePage();
    if(typeof updateSyncStatus==='function')updateSyncStatus();
""",
"""    const _beforeSnapshot=_dbSnapshot||{};
    await loadFromSupabase();
    const _nextSnapshot=_dbFingerprint();
    const _dataChanged=!_dbFingerprintsEqual(_beforeSnapshot,_nextSnapshot);
    _dbSnapshot=_nextSnapshot;
    _initActivityShadow();
    _lastCloudRefreshAt=Date.now();
    if(_dataChanged)refreshActivePage();
    if(typeof updateSyncStatus==='function')updateSyncStatus();
""",label='no-op cloud render suppression')

# ---------------------------------------------------------------------------
# Accounting helpers accept optional precomputed context / current stats.
# Existing callers remain fully backward compatible.
# ---------------------------------------------------------------------------
acct=rep(acct,'function calcMonthStatsBySale(m){','function calcMonthStatsBySale(m,ctx){',label='month stats context signature')

def patch_month_stats(chunk):
    if chunk.count('const events=getSaleEventsInMonth(m);')!=1:
        raise RuntimeError('month stats events anchor mismatch')
    chunk=chunk.replace('const events=getSaleEventsInMonth(m);',"const events=(ctx&&ctx.eventsByMonth instanceof Map)?(ctx.eventsByMonth.get(m)||[]):getSaleEventsInMonth(m);",1)
    old='const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);'
    if chunk.count(old)!=1: raise RuntimeError('month stats tier anchor mismatch')
    chunk=chunk.replace(old,"const _allTrips=DB.trips||[],_tieredTrips=(ctx&&Array.isArray(ctx.tieredTrips))?ctx.tieredTrips:calcTieredTrips(_allTrips);",1)
    return chunk
acct=replace_in_slice(acct,'function calcMonthStatsBySale(m,ctx){','function calcSummaryStats()',patch_month_stats,'month stats context body')

acct=rep(acct,'function calcSummaryGrossDeltas(){\n  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);if(!prevKey)return null;\n  const cur=calcSummaryGrossStats(),prev=_grossSummaryForRange(_prevPeriodRange(prevKey));',
              'function calcSummaryGrossDeltas(currentStats){\n  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);if(!prevKey)return null;\n  const cur=currentStats||calcSummaryGrossStats(),prev=_grossSummaryForRange(_prevPeriodRange(prevKey));',label='gross delta current stats reuse')
acct=rep(acct,'function calcSummaryDeltas(){\n  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);',
              'function calcSummaryDeltas(currentStats){\n  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);',label='net delta signature')
acct=rep(acct,'  const cur=calcSummaryStats();\n  const prev=_statsForRange(_prevPeriodRange(prevKey));',
              '  const cur=currentStats||calcSummaryStats();\n  const prev=_statsForRange(_prevPeriodRange(prevKey));',count=1,label='net delta current stats reuse')

# Version/cache busting.
index=rep(index,'app.css?v=1.4.35','app.css?v=1.4.36',label='css cache bump')
index=rep(index,'app.js?v=1.4.35','app.js?v=1.4.36',label='app cache bump')
index=rep(index,'accounting.js?v=1.4.10','accounting.js?v=1.4.11',label='accounting cache bump')

css += "\n\n/* v1.4.36 — performance audit + deliberate current-period tail */\n"

app_path.write_text(app,encoding='utf-8')
css_path.write_text(css,encoding='utf-8')
acct_path.write_text(acct,encoding='utf-8')
index_path.write_text(index,encoding='utf-8')
