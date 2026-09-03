from pathlib import Path
import re

APP = Path('app.js')
CSS = Path('app.css')
INDEX = Path('index.html')
app = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 occurrence, found {count}')
    return text.replace(old, new, 1)


# 1) Dashboard period selector: let the native select visibly settle before the
# expensive dashboard render. The data/calculation path is unchanged.
app = replace_once(
    app,
    "function setSummaryPeriod(p){SUMMARY_PERIOD=p;renderSummary();_saveUIState();}",
    """let _summaryPeriodFrame=0;
let _summaryPeriodFrame2=0;
function setSummaryPeriod(p){
  SUMMARY_PERIOD=p;
  _saveUIState();
  if(_summaryPeriodFrame){cancelAnimationFrame(_summaryPeriodFrame);_summaryPeriodFrame=0;}
  if(_summaryPeriodFrame2){cancelAnimationFrame(_summaryPeriodFrame2);_summaryPeriodFrame2=0;}
  // Give the native selector one paint to acknowledge the new choice before
  // rebuilding the full dashboard. This removes the apparent 60/90-day lag.
  _summaryPeriodFrame=requestAnimationFrame(function(){
    _summaryPeriodFrame=0;
    _summaryPeriodFrame2=requestAnimationFrame(function(){
      _summaryPeriodFrame2=0;
      renderSummary();
    });
  });
}""",
    'dashboard period setter',
)

# 2) Restore local UI state before the real-layout skeleton is rendered. This is
# the cause-level Sales fix: a hard refresh in monthly detail must skeletonise
# monthly detail immediately, not grid first and detail after Supabase returns.
startup_old = """    const _safeTab = ['summary','monthly','stock','expenses','cash','returns','scrapped','tax','data','runs','activity'].includes(_lastTab) ? _lastTab : 'summary';
    showRealLayoutLoading(_safeTab, 'Loading your data…');"""
startup_new = """    const _safeTab = ['summary','monthly','stock','expenses','cash','returns','scrapped','tax','data','runs','activity'].includes(_lastTab) ? _lastTab : 'summary';
    // Local UI state is synchronous and must be restored BEFORE the loading
    // renderer so its geometry/subview is the exact page the user left.
    _loadUIState();
    showRealLayoutLoading(_safeTab, 'Loading your data…');"""
app = replace_once(app, startup_old, startup_new, 'pre-skeleton UI-state restore')
app = replace_once(
    app,
    """    try{ _initActivityShadow(); }catch(e){ console.warn('[RETRADE] shadow seed failed',e); }
    _loadUIState();
    // Render the remembered destination into the already-mounted real page.""",
    """    try{ _initActivityShadow(); }catch(e){ console.warn('[RETRADE] shadow seed failed',e); }
    // Render the remembered destination into the already-mounted real page.""",
    'remove late UI-state restore',
)

# 3) Donut: keep the visual ranking/legend stable but rotate physical ring order
# so the largest slice closes the ring. With <=6 slices the largest arc is always
# long enough for the same fixed 26-unit recoil, making bounce extent independent
# of a tiny tail category. The bounce then finishes on the same overall clock as
# the slightly slower line chart.
donut_start = app.find('function buildCategoryDonut(byCat){')
donut_end = app.find('\nfunction showAllCategoriesModal', donut_start)
if donut_start < 0 or donut_end < 0:
    raise SystemExit('Could not isolate buildCategoryDonut')
new_donut = r'''function buildCategoryDonut(byCat){
  if(!byCat||!byCat.length)return null;
  // Weight by revenue (falls back to sold count if no revenue recorded).
  const useRev=byCat.some(c=>(c.totalRev||0)>0);
  const weighted=byCat.map(c=>({cat:c.cat,val:useRev?(c.totalRev||0):(c.sold||0)}))
    .filter(c=>c.val>0).sort((a,b)=>b.val-a.val);
  if(!weighted.length)return null;
  const total=weighted.reduce((s,c)=>s+c.val,0);

  // Top 5 + Other. Rank drives colour/legend order; physical ring order is
  // rotated so rank 0 (the largest arc) is always the closing segment.
  const TOP=5;
  let slices=weighted.slice(0,TOP);
  const rest=weighted.slice(TOP);
  if(rest.length)slices.push({cat:'Other',val:rest.reduce((s,c)=>s+c.val,0)});
  const ranked=slices.map(function(s,i){return {cat:s.cat,val:s.val,rank:i};});
  const ringSlices=ranked.length>1?ranked.slice(1).concat(ranked[0]):ranked.slice();

  const size=132, cx=size/2, cy=size/2, r=52, sw=18;
  const C=2*Math.PI*r;
  let offset=0;
  const geo=ringSlices.map(function(s){
    const frac=s.val/total, len=frac*C;
    const g={len:len,rest:C-len,off:offset,t0:offset/C,t:frac};
    offset+=len;
    return g;
  });
  const n2=function(v){return Math.round(v*100)/100;};
  const n4=function(v){return Math.round(v*10000)/10000;};

  const arcs=ringSlices.map(function(s,i){
    const g=geo[i];
    const dash=g.len+' '+g.rest;
    const isLast=(i===ringSlices.length-1);
    let extra='';
    if(isLast){
      // Fixed visual recoil. Because the closing arc is the largest of at most
      // six slices, 26 user units always fits without data-dependent clamping.
      const RECOIL=26;
      // Overshoot is physically bounded only by the remaining circumference;
      // the visible backwards kick remains the same for every category mix.
      const OVER=Math.min(RECOIL*0.30,g.rest*0.5);
      extra=';--seg-len-r:'+n2(g.len-RECOIL)+';--seg-rest-r:'+n2(g.rest+RECOIL)
           +';--seg-len-o:'+n2(g.len+OVER)+';--seg-rest-o:'+n2(g.rest-OVER);
    }
    return '<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" '
      +(isLast?'class="donut-seg-last" ':'')
      +'stroke="'+_DONUT_COLORS[s.rank%_DONUT_COLORS.length]+'" stroke-width="'+sw+'" '
      +'stroke-dasharray="'+dash+'" stroke-dashoffset="'+(-g.off)+'" '
      +'style="--seg-len:'+n2(g.len)+';--seg-rest:'+n2(g.rest)+';--seg-c:'+n2(C)
      +';--seg-t0:'+n4(g.t0)+';--seg-t:'+n4(g.t)+extra+'" '
      +'transform="rotate(-90 '+cx+' '+cy+')"/>';
  }).join('');

  const svg='<svg class="cat-donut-svg" viewBox="0 0 '+size+' '+size+'" width="'+size+'" height="'+size+'">'+arcs+'</svg>';
  const legend=slices.map(function(s,i){
    const pct=Math.round((s.val/total)*100);
    return '<div class="cat-legend-row" data-cat="'+esc(s.cat)+'">'
      +'<span class="cat-legend-dot" style="background:'+_DONUT_COLORS[i%_DONUT_COLORS.length]+'"></span>'
      +'<span class="cat-legend-name" title="'+esc(s.cat)+'">'+esc(s.cat)+'</span>'
      +'<span class="cat-legend-pct num" data-cv="'+pct+'" data-cv-fmt="pct0" data-cv-key="sum-catpct-'+i+'">'+pct+'%</span></div>';
  }).join('');
  return {svg:svg,legend:legend,count:weighted.length};
}
'''
app = app[:donut_start] + new_donut + app[donut_end:]

# 4) Cashflow: cache the canonical event list on a full Cashflow render, then
# update only the filter totals/count/results for search and selectors. Export
# and print still recalculate from calcCashSummary() at action time.
manager_start = app.find("let _cashflowSearch='';")
filedate_start = app.find('function _cashflowFileDate()', manager_start)
if manager_start < 0 or filedate_start < 0:
    raise SystemExit('Could not isolate Cashflow manager state')
new_manager = r'''let _cashflowSearch='';
let _cashflowDirection='all';
let _cashflowType='all';
let _cashflowRange='all';
let _cashflowSearchTimer=null;
let _cashflowUpdateFrame=0;
let _cashflowUpdateFrame2=0;
let _cashflowViewEvents=[];

function _cashflowSortedEvents(summary){
  return ((summary&&summary.events)||[]).slice().sort(function(a,b){
    return (b.date||'').localeCompare(a.date||'')||String(b.id||'').localeCompare(String(a.id||''));
  });
}
function _cashflowMatchesRange(m,range){
  if(!range||range==='all')return true;
  const raw=String((m&&m.date)||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))return false;
  const d=new Date(raw+'T00:00:00');
  if(!isFinite(d.getTime()))return false;
  const now=new Date();now.setHours(0,0,0,0);
  if(range==='year')return d.getFullYear()===now.getFullYear();
  const days=range==='30'?30:range==='90'?90:0;
  if(!days)return true;
  const cutoff=new Date(now);cutoff.setDate(cutoff.getDate()-(days-1));
  return d>=cutoff&&d<=now;
}
function _cashflowFilteredEvents(events){
  const q=String(_cashflowSearch||'').trim().toLowerCase();
  return (events||[]).filter(function(m){
    const direction=String((m&&m.direction)||'').toLowerCase();
    const type=String((m&&m.type)||'cash');
    if(_cashflowDirection!=='all'&&direction!==_cashflowDirection)return false;
    if(_cashflowType!=='all'&&type!==_cashflowType)return false;
    if(!_cashflowMatchesRange(m,_cashflowRange))return false;
    if(!q)return true;
    const hay=[m.description,m.type,m.source,m.date,m.itemId,m.saleNo,m.amount]
      .map(function(v){return v==null?'':String(v);}).join(' ').toLowerCase();
    return hay.indexOf(q)!==-1;
  });
}
function _cashflowFilteredSnapshot(){
  const summary=calcCashSummary();
  const all=_cashflowSortedEvents(summary);
  const rows=_cashflowFilteredEvents(all);
  return {summary:summary,all:all,rows:rows};
}
function _cashflowFilterState(events){
  const filtered=_cashflowFilteredEvents(events||[]);
  const filteredIn=filtered.reduce(function(s,m){return s+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const filteredOut=filtered.reduce(function(s,m){return s+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  return {
    filtered:filtered,
    filteredIn:filteredIn,
    filteredOut:filteredOut,
    filtersActive:!!(_cashflowSearch||_cashflowDirection!=='all'||_cashflowType!=='all'||_cashflowRange!=='all')
  };
}
function _cashflowLedgerHTML(led,filtered){
  if(!led.length)return '<div class="card" style="padding:18px;text-align:center;color:var(--text-secondary);line-height:1.5;">No cash movements yet. Add an opening balance or start recording stock/sales.</div>';
  if(!filtered.length)return '<div class="card" style="padding:18px;text-align:center;color:var(--text-secondary);line-height:1.5;"><b style="display:block;color:var(--text);margin-bottom:5px;">No matching movements</b>Try changing the search or filters.<div><button class="cashflow-action-btn" style="margin-top:12px" onclick="clearCashflowFilters()">Clear filters</button></div></div>';
  let html='<div class="section-card cashflow-ledger-list" style="padding:0;overflow:hidden;">';
  filtered.forEach(function(m){
    const isOut=m.direction==='out';const editable=!!m.editableId;
    html+='<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);'+(editable?'cursor:pointer;':'cursor:default;')+'"'+(editable?' onclick="editCashMove(\''+m.editableId+'\')"':'')+'><div style="flex:1;min-width:0;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(m.description||m.type||'Cash movement')+'</div><div style="font-size:12px;color:var(--text-secondary);">'+esc((m.type||'cash').replace(/_/g,' '))+' · '+esc(m.date||'Undated')+(editable?' · editable':' · from '+esc(m.source||'app'))+'</div></div><div class="num" style="font-weight:700;flex-shrink:0;color:'+(isOut?'var(--warn)':'#3b82f6')+';">'+(isOut?'−':'+')+fmt(Number(m.amount)||0)+'</div></div>';
  });
  return html+'</div>';
}
function _updateCashflowResults(){
  const led=_cashflowViewEvents||[];
  const state=_cashflowFilterState(led);
  const net=state.filteredIn-state.filteredOut;
  const countEl=document.getElementById('cashflow-result-count');
  if(countEl)countEl.textContent=state.filtered.length+' of '+led.length+' movements';
  const inEl=document.getElementById('cashflow-filter-in');
  const outEl=document.getElementById('cashflow-filter-out');
  const netEl=document.getElementById('cashflow-filter-net');
  if(inEl)inEl.textContent=fmt(state.filteredIn);
  if(outEl)outEl.textContent=fmt(state.filteredOut);
  if(netEl){netEl.textContent=fmt(net);netEl.style.color=net>=0?'#3b82f6':'var(--warn)';}
  const clearSlot=document.getElementById('cashflow-clear-slot');
  if(clearSlot)clearSlot.innerHTML=state.filtersActive?'<button class="cashflow-action-btn" onclick="clearCashflowFilters()">Clear filters</button>':'';
  const results=document.getElementById('cashflow-results');
  if(results)results.innerHTML=_cashflowLedgerHTML(led,state.filtered);
}
function _scheduleCashflowResultsUpdate(afterPaint){
  if(_cashflowUpdateFrame){cancelAnimationFrame(_cashflowUpdateFrame);_cashflowUpdateFrame=0;}
  if(_cashflowUpdateFrame2){cancelAnimationFrame(_cashflowUpdateFrame2);_cashflowUpdateFrame2=0;}
  _cashflowUpdateFrame=requestAnimationFrame(function(){
    _cashflowUpdateFrame=0;
    if(afterPaint){
      _cashflowUpdateFrame2=requestAnimationFrame(function(){
        _cashflowUpdateFrame2=0;
        _updateCashflowResults();
      });
    }else _updateCashflowResults();
  });
}
function setCashflowFilter(key,value){
  if(key==='direction')_cashflowDirection=value||'all';
  else if(key==='type')_cashflowType=value||'all';
  else if(key==='range')_cashflowRange=value||'all';
  // One paint first lets the native select close/acknowledge immediately.
  _scheduleCashflowResultsUpdate(true);
}
function cashflowSearchInput(el){
  _cashflowSearch=el&&el.value!=null?String(el.value):'';
  if(_cashflowSearchTimer)clearTimeout(_cashflowSearchTimer);
  _cashflowSearchTimer=setTimeout(function(){
    _cashflowSearchTimer=null;
    // The search input stays mounted; only results/totals are replaced.
    _scheduleCashflowResultsUpdate(false);
  },70);
}
function clearCashflowFilters(){
  _cashflowSearch='';_cashflowDirection='all';_cashflowType='all';_cashflowRange='all';
  if(_cashflowSearchTimer){clearTimeout(_cashflowSearchTimer);_cashflowSearchTimer=null;}
  const search=document.getElementById('cashflow-search');if(search)search.value='';
  const direction=document.getElementById('cashflow-direction');if(direction)direction.value='all';
  const type=document.getElementById('cashflow-type');if(type)type.value='all';
  const range=document.getElementById('cashflow-range');if(range)range.value='all';
  _scheduleCashflowResultsUpdate(false);
}
'''
app = app[:manager_start] + new_manager + app[filedate_start:]

render_start = app.find('function renderCash(){')
render_end = app.find('\nfunction _cashMoveForm(', render_start)
if render_start < 0 or render_end < 0:
    raise SystemExit('Could not isolate renderCash')
new_render = r'''function renderCash(){
  const el=document.getElementById('p-cash');if(!el)return;
  const c=calcCashSummary();
  const led=_cashflowSortedEvents(c);
  _cashflowViewEvents=led;
  const state=_cashflowFilterState(led);
  const filtered=state.filtered,filteredIn=state.filteredIn,filteredOut=state.filteredOut,filtersActive=state.filtersActive;
  const kpi=function(label,val,foot,col){return '<div class="card kpi"><div class="kpi-label">'+esc(label)+'</div><div class="kpi-value num"'+(col?' style="color:'+col+'"':'')+'>'+fmt(val)+'</div>'+(foot?'<div class="kpi-foot">'+foot+'</div>':'')+'</div>';};
  const types=Array.from(new Set(led.map(function(m){return String(m.type||'cash');}))).sort(function(a,b){return a.localeCompare(b);});

  let html='<div class="page-header"><div><div class="page-title">Cashflow</div><div class="page-subtitle">Every real cash movement across stock, sales, returns, expenses, settlements and owner money.</div></div>'
    +'<div style="display:flex;gap:8px;flex-shrink:0;"><button class="btn btn-secondary" onclick="openReconcile()">Reconcile</button><button class="btn btn-primary" onclick="addCashMove()">'+icon('expense',15)+' Add</button></div></div>';
  html+='<div class="card" style="padding:20px 22px;margin-bottom:18px;"><div class="kpi-label">Business cash available</div>'
    +'<div class="num" style="font-size:clamp(28px,7vw,40px);font-weight:800;line-height:1.05;margin-top:4px;'+(c.cashAvailable<0?'color:var(--red);':'')+'">'+fmt(c.cashAvailable)+'</div>'
    +'<div class="kpi-foot" style="margin-top:8px;line-height:1.5;">'+fmt(c.inflows)+' cash in − '+fmt(c.outflows)+' cash out. Includes platform balances as business cash; moving eBay/Vinted money to bank is an internal transfer, not new income.</div></div>';
  html+='<details class="card" style="padding:0;margin:-6px 0 18px;overflow:hidden;"><summary style="cursor:pointer;padding:12px 15px;font-size:12px;font-weight:700;color:var(--text-secondary);list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px;"><span>Cash calculation audit</span><span class="num" style="color:var(--text);">'+fmt(c.cashAvailable)+'</span></summary>'
    +'<div style="padding:0 15px 13px;border-top:1px solid var(--border);"><div class="pnl-row"><span>Opening balance</span><strong>+'+fmt(c.opening)+'</strong></div>'
    +'<div class="pnl-row"><span>Trading / operating cash movements</span><strong>'+(c.operatingCash<0?'−':'+')+fmt(Math.abs(c.operatingCash))+'</strong></div>'
    +'<div class="pnl-row"><span>Owner contributions</span><strong>+'+fmt(c.contrib)+'</strong></div><div class="pnl-row"><span>Owner withdrawals</span><strong>−'+fmt(c.draw)+'</strong></div>'
    +'<div class="pnl-row"><span>Manual / reconcile adjustments</span><strong>'+(c.adjust<0?'−':'+')+fmt(Math.abs(c.adjust))+'</strong></div><div class="pnl-row total"><span>Business cash available</span><strong>'+fmt(c.cashAvailable)+'</strong></div>'
    +'<div style="font-size:11px;color:var(--text-secondary);line-height:1.45;margin-top:8px;">This total is event-ledger based: stock purchases and parts leave cash when bought; sales add cash; fees/shipping/refunds/expenses/settlements remove it; supplier refunds add it back. COGS restoration and HMRC mileage allowance do not move cash.</div></div></details>';
  html+='<div class="sl" style="margin:20px 0 10px;">Cash</div><div class="kgrid">'
    +kpi('Cash in',c.inflows,'All recorded inflows','#3b82f6')+kpi('Cash out',c.outflows,'All recorded outflows','var(--warn)')+kpi('Cash tied up in stock',c.stockTied,'Paid acquisition + parts still held')+kpi('Gross profit (all-time)',c.grossProfit,'Accounting profit — shown for comparison only')+'</div>';
  if(c.unpaidLiabilities.total>0)html+='<div class="card" style="padding:13px 15px;margin-top:-6px;margin-bottom:16px;border-style:dashed;"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><div><div style="font-size:12px;font-weight:700;color:var(--text);">Still to be paid</div><div style="font-size:11px;color:var(--text-secondary);margin-top:3px;line-height:1.45;">Supplier '+fmt(c.unpaidLiabilities.supplier)+' · partner shares '+fmt(c.unpaidLiabilities.partner)+'. These do not leave cash until a paid settlement exists.</div></div><strong class="num" style="white-space:nowrap;color:var(--accent);">'+fmt(c.unpaidLiabilities.total)+'</strong></div></div>';
  html+='<div class="sl" style="margin:22px 0 10px;">Owner</div><div class="kgrid">'+kpi('You took out',c.draw,'This tax year '+fmt(c.drawFY),c.draw>0?'var(--warn)':'')+kpi('You added',c.contrib,'This tax year '+fmt(c.contribFY),c.contrib>0?'#3b82f6':'')+kpi('Net taken by you',c.netOwner,c.netOwner>=0?'More out than in':'More in than out')+kpi('Profit kept in business',c.profitRetained,'Accounting net profit − drawings + added')+'</div>';

  html+='<div class="cashflow-list-heading"><div><div class="sl">All cash movements</div><div id="cashflow-result-count" class="cashflow-result-count">'+filtered.length+' of '+led.length+' movements</div></div></div>';
  html+='<div class="cashflow-manager">'
    +'<div class="cashflow-toolbar">'
      +'<label class="cashflow-search-field"><span class="cashflow-control-label">Search</span><input id="cashflow-search" class="cashflow-control cashflow-search" type="search" inputmode="search" autocomplete="off" placeholder="Description, type, source…" value="'+esc(_cashflowSearch)+'" oninput="cashflowSearchInput(this)"></label>'
      +'<label><span class="cashflow-control-label">Direction</span><select id="cashflow-direction" class="cashflow-control" onchange="setCashflowFilter(\'direction\',this.value)"><option value="all"'+(_cashflowDirection==='all'?' selected':'')+'>All directions</option><option value="in"'+(_cashflowDirection==='in'?' selected':'')+'>Money in</option><option value="out"'+(_cashflowDirection==='out'?' selected':'')+'>Money out</option></select></label>'
      +'<label><span class="cashflow-control-label">Type</span><select id="cashflow-type" class="cashflow-control" onchange="setCashflowFilter(\'type\',this.value)"><option value="all"'+(_cashflowType==='all'?' selected':'')+'>All types</option>'+types.map(function(t){return '<option value="'+esc(t)+'"'+(_cashflowType===t?' selected':'')+'>'+esc(t.replace(/_/g,' '))+'</option>';}).join('')+'</select></label>'
      +'<label><span class="cashflow-control-label">Period</span><select id="cashflow-range" class="cashflow-control" onchange="setCashflowFilter(\'range\',this.value)"><option value="all"'+(_cashflowRange==='all'?' selected':'')+'>All time</option><option value="30"'+(_cashflowRange==='30'?' selected':'')+'>Last 30 days</option><option value="90"'+(_cashflowRange==='90'?' selected':'')+'>Last 90 days</option><option value="year"'+(_cashflowRange==='year'?' selected':'')+'>This year</option></select></label>'
    +'</div>'
    +'<div class="cashflow-manager-footer"><div class="cashflow-filter-totals"><span>In <b id="cashflow-filter-in" style="color:#3b82f6">'+fmt(filteredIn)+'</b></span><span>Out <b id="cashflow-filter-out" style="color:var(--warn)">'+fmt(filteredOut)+'</b></span><span>Net <b id="cashflow-filter-net" style="color:'+(filteredIn-filteredOut>=0?'#3b82f6':'var(--warn)')+'">'+fmt(filteredIn-filteredOut)+'</b></span></div>'
      +'<div class="cashflow-actions"><div id="cashflow-clear-slot" style="display:contents">'+(filtersActive?'<button class="cashflow-action-btn" onclick="clearCashflowFilters()">Clear filters</button>':'')+'</div><button class="cashflow-action-btn" onclick="printCashflow()">Print</button><button class="cashflow-action-btn cashflow-action-primary" onclick="exportCashflowExcel()">Excel</button></div></div>'
    +'</div>';
  html+='<div id="cashflow-results">'+_cashflowLedgerHTML(led,filtered)+'</div>';
  el.innerHTML=html;
}
'''
app = app[:render_start] + new_render + app[render_end:]

# 5) Motion clocks: modestly slower line, while donut sweep + recoil add up to
# exactly the same 840ms endpoint. The donut remains a sequential clockwise pen.
token_pattern = re.compile(r"  --dur-bounce: 540ms;.*?  --dur-draw: 760ms;.*?\n\n  /\* Type \*/", re.S)
if len(token_pattern.findall(css)) != 1:
    raise SystemExit('motion token block not unique')
css = token_pattern.sub(
    """  --dur-bounce: 350ms;      /* closing recoil/overshoot */
  --dur-donut-sweep: 490ms; /* clockwise ring build */
  --dur-draw: 840ms;        /* line chart; donut sweep + bounce ends on this same frame */

  /* Type */""",
    css,
    count=1,
)

sweep_comment_start = css.find('/* v2.19.15 -- the category donut sweeps clockwise.')
sweep_keyframes = css.find('@keyframes donutSweep{', sweep_comment_start)
if sweep_comment_start < 0 or sweep_keyframes < 0:
    raise SystemExit('donut sweep comment block not found')
css = css[:sweep_comment_start] + """/* v1.4.25 — category ring and line share one visual endpoint. The ring itself
   sweeps clockwise on --dur-donut-sweep; its fixed closing recoil then occupies
   --dur-bounce. 490ms + 350ms = the line's 840ms --dur-draw. Slice timings stay
   proportional so colour boundaries move at one constant angular speed. */
""" + css[sweep_keyframes:]

css = replace_once(
    css,
    """svg.cat-donut-draw circle{
  animation:donutSweep calc(var(--seg-t) * var(--dur-draw)) linear both;
  animation-delay:calc(var(--seg-t0) * var(--dur-draw));
}""",
    """svg.cat-donut-draw circle{
  animation:donutSweep calc(var(--seg-t) * var(--dur-donut-sweep)) linear both;
  animation-delay:calc(var(--seg-t0) * var(--dur-donut-sweep));
}""",
    'donut sweep timing',
)

bounce_comment_start = css.find('/* v2.19.16 -- the ring recoils as it closes:')
bounce_keyframes = css.find('@keyframes donutClose{', bounce_comment_start)
if bounce_comment_start < 0 or bounce_keyframes < 0:
    raise SystemExit('donut bounce comment block not found')
css = css[:bounce_comment_start] + """/* v1.4.25 — the largest physical slice now closes the ring, so the recoil can
   be a fixed visual distance instead of shrinking with the smallest category.
   The bounce starts exactly when the 490ms sweep completes and settles exactly
   when the 840ms line draw completes. */
""" + css[bounce_keyframes:]

css = replace_once(
    css,
    """svg.cat-donut-draw circle.donut-seg-last{
  animation:
    donutSweep calc(var(--seg-t) * var(--dur-draw)) linear calc(var(--seg-t0) * var(--dur-draw)) both,
    donutClose var(--dur-bounce) linear var(--dur-draw) forwards;
}""",
    """svg.cat-donut-draw circle.donut-seg-last{
  animation:
    donutSweep calc(var(--seg-t) * var(--dur-donut-sweep)) linear calc(var(--seg-t0) * var(--dur-donut-sweep)) both,
    donutClose var(--dur-bounce) linear var(--dur-donut-sweep) forwards;
}""",
    'donut close timing',
)

# Cache bump for the production PWA/browser path.
index = replace_once(index, 'app.css?v=1.4.24', 'app.css?v=1.4.25', 'app.css cache version')
index = replace_once(index, 'app.js?v=1.4.24', 'app.js?v=1.4.25', 'app.js cache version')

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
print('Applied dashboard filter, Sales boot, donut timing, and Cashflow responsiveness patch')
