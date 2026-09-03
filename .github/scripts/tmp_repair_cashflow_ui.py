from pathlib import Path

APP = Path('app.js')
app = APP.read_text(encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 occurrence, found {count}')
    return text.replace(old, new, 1)


# Preserve every loading marker the original immediate cleanup removed.
app = replace_once(
    app,
    "const surfaceNodes=page.querySelectorAll('.rt-panel-list-loading,.rt-age-loading,.rt-neutral-loading-bar,.rt-hide-while-loading');",
    "const surfaceNodes=page.querySelectorAll('.rt-list-loading,.rt-panel-list-loading,.rt-age-loading,.rt-neutral-loading-bar,.rt-hide-while-loading');",
    'loading surface selector',
)
app = replace_once(
    app,
    "el.classList.remove('rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');",
    "el.classList.remove('rt-list-loading','rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');",
    'reduced-motion loading cleanup',
)
app = replace_once(
    app,
    "el.classList.remove('rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');",
    "el.classList.remove('rt-list-loading','rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');",
    'animated loading cleanup',
)

# Older/mobile Safari does not universally accept focus({preventScroll:true}).
app = replace_once(
    app,
    "next.focus({preventScroll:true});\n      try{next.setSelectionRange(start,end);}catch(e){}",
    "try{next.focus({preventScroll:true});}catch(e){next.focus();}\n      try{next.setSelectionRange(start,end);}catch(e){}",
    'cashflow search focus fallback',
)

# Keep numeric money columns numeric in Excel-compatible CSV while continuing to
# neutralise formula-like user text such as descriptions beginning with =,+,-,@.
csv_start = app.find('function _cashflowCsvText(value){')
print_start = app.find('function printCashflow(){', csv_start)
if csv_start < 0 or print_start < 0 or print_start <= csv_start:
    raise SystemExit('Could not isolate Cashflow CSV export block')

csv_export = r'''function _cashflowCsvText(value){
  let s=value==null?'':String(value).replace(/\r?\n/g,' ');
  // Prevent spreadsheet formula execution from user-entered descriptions/sources.
  if(/^[=+\-@]/.test(s))s="'"+s;
  return '"'+s.replace(/"/g,'""')+'"';
}
function _cashflowCsvCell(value){
  if(typeof value==='number'&&isFinite(value))return String(value);
  return _cashflowCsvText(value);
}
function exportCashflowExcel(){
  const snap=_cashflowFilteredSnapshot();
  const rows=snap.rows;
  const inflow=rows.reduce(function(sum,m){return sum+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const outflow=rows.reduce(function(sum,m){return sum+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  const lines=[
    ['RETRADE Cashflow'],
    ['Exported',new Date().toLocaleString('en-GB')],
    ['Rows',rows.length],
    ['Money in',Number(inflow.toFixed(2))],
    ['Money out',Number(outflow.toFixed(2))],
    ['Net',Number((inflow-outflow).toFixed(2))],
    [],
    ['Date','Direction','Type','Description','Source','Amount','Signed amount','Item ID','Sale No']
  ];
  rows.forEach(function(m){
    const amount=Number(m.amount)||0;
    lines.push([
      m.date||'',m.direction==='out'?'Out':'In',String(m.type||'cash').replace(/_/g,' '),
      m.description||'',m.source||'',Number(amount.toFixed(2)),Number((m.direction==='out'?-amount:amount).toFixed(2)),m.itemId||'',m.saleNo==null?'':m.saleNo
    ]);
  });
  const csv=lines.map(function(row){return row.map(_cashflowCsvCell).join(',');}).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download='RETRADE-cashflow-'+_cashflowFileDate()+'.csv';
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
  if(typeof toast==='function')toast('Cashflow export ready for Excel.');
}
'''
app = app[:csv_start] + csv_export + app[print_start:]

# Replace only the Cashflow renderer. Preserve the production accounting UI and
# calculations verbatim; add the management layer immediately above the existing
# movement list and filter only the rows shown, printed or exported.
render_start = app.find('function renderCash(){')
render_end = app.find('function _cashMoveForm(', render_start)
if render_start < 0 or render_end < 0 or render_end <= render_start:
    raise SystemExit('Could not isolate renderCash function')
if app.find('function renderCash(){', render_start + 1, render_end) >= 0:
    raise SystemExit('Unexpected duplicate renderCash inside replacement range')

render = r'''function renderCash(){
  const el=document.getElementById('p-cash');if(!el)return;
  const c=calcCashSummary();
  const led=_cashflowSortedEvents(c);
  const filtered=_cashflowFilteredEvents(led);
  const kpi=function(label,val,foot,col){return '<div class="card kpi"><div class="kpi-label">'+esc(label)+'</div><div class="kpi-value num"'+(col?' style="color:'+col+'"':'')+'>'+fmt(val)+'</div>'+(foot?'<div class="kpi-foot">'+foot+'</div>':'')+'</div>';};
  const types=Array.from(new Set(led.map(function(m){return String(m.type||'cash');}))).sort(function(a,b){return a.localeCompare(b);});
  const filteredIn=filtered.reduce(function(s,m){return s+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const filteredOut=filtered.reduce(function(s,m){return s+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  const filtersActive=!!(_cashflowSearch||_cashflowDirection!=='all'||_cashflowType!=='all'||_cashflowRange!=='all');

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

  html+='<div class="cashflow-list-heading"><div><div class="sl">All cash movements</div><div class="cashflow-result-count">'+filtered.length+' of '+led.length+' movements</div></div></div>';
  html+='<div class="cashflow-manager">'
    +'<div class="cashflow-toolbar">'
      +'<label class="cashflow-search-field"><span class="cashflow-control-label">Search</span><input id="cashflow-search" class="cashflow-control cashflow-search" type="search" inputmode="search" autocomplete="off" placeholder="Description, type, source…" value="'+esc(_cashflowSearch)+'" oninput="cashflowSearchInput(this)"></label>'
      +'<label><span class="cashflow-control-label">Direction</span><select class="cashflow-control" onchange="setCashflowFilter(\'direction\',this.value)"><option value="all"'+(_cashflowDirection==='all'?' selected':'')+'>All directions</option><option value="in"'+(_cashflowDirection==='in'?' selected':'')+'>Money in</option><option value="out"'+(_cashflowDirection==='out'?' selected':'')+'>Money out</option></select></label>'
      +'<label><span class="cashflow-control-label">Type</span><select class="cashflow-control" onchange="setCashflowFilter(\'type\',this.value)"><option value="all"'+(_cashflowType==='all'?' selected':'')+'>All types</option>'+types.map(function(t){return '<option value="'+esc(t)+'"'+(_cashflowType===t?' selected':'')+'>'+esc(t.replace(/_/g,' '))+'</option>';}).join('')+'</select></label>'
      +'<label><span class="cashflow-control-label">Period</span><select class="cashflow-control" onchange="setCashflowFilter(\'range\',this.value)"><option value="all"'+(_cashflowRange==='all'?' selected':'')+'>All time</option><option value="30"'+(_cashflowRange==='30'?' selected':'')+'>Last 30 days</option><option value="90"'+(_cashflowRange==='90'?' selected':'')+'>Last 90 days</option><option value="year"'+(_cashflowRange==='year'?' selected':'')+'>This year</option></select></label>'
    +'</div>'
    +'<div class="cashflow-manager-footer"><div class="cashflow-filter-totals"><span>In <b style="color:#3b82f6">'+fmt(filteredIn)+'</b></span><span>Out <b style="color:var(--warn)">'+fmt(filteredOut)+'</b></span><span>Net <b style="color:'+(filteredIn-filteredOut>=0?'#3b82f6':'var(--warn)')+'">'+fmt(filteredIn-filteredOut)+'</b></span></div>'
      +'<div class="cashflow-actions">'+(filtersActive?'<button class="cashflow-action-btn" onclick="clearCashflowFilters()">Clear filters</button>':'')+'<button class="cashflow-action-btn" onclick="printCashflow()">Print</button><button class="cashflow-action-btn cashflow-action-primary" onclick="exportCashflowExcel()">Excel</button></div></div>'
    +'</div>';

  if(!led.length)html+='<div class="card" style="padding:18px;text-align:center;color:var(--text-secondary);line-height:1.5;">No cash movements yet. Add an opening balance or start recording stock/sales.</div>';
  else if(!filtered.length)html+='<div class="card" style="padding:18px;text-align:center;color:var(--text-secondary);line-height:1.5;"><b style="display:block;color:var(--text);margin-bottom:5px;">No matching movements</b>Try changing the search or filters.<div><button class="cashflow-action-btn" style="margin-top:12px" onclick="clearCashflowFilters()">Clear filters</button></div></div>';
  else{
    html+='<div class="section-card cashflow-ledger-list" style="padding:0;overflow:hidden;">';
    filtered.forEach(function(m){
      const isOut=m.direction==='out';const editable=!!m.editableId;
      html+='<div style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);'+(editable?'cursor:pointer;':'cursor:default;')+'"'+(editable?' onclick="editCashMove(\''+m.editableId+'\')"':'')+'><div style="flex:1;min-width:0;"><div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(m.description||m.type||'Cash movement')+'</div><div style="font-size:12px;color:var(--text-secondary);">'+esc((m.type||'cash').replace(/_/g,' '))+' · '+esc(m.date||'Undated')+(editable?' · editable':' · from '+esc(m.source||'app'))+'</div></div><div class="num" style="font-weight:700;flex-shrink:0;color:'+(isOut?'var(--warn)':'#3b82f6')+';">'+(isOut?'−':'+')+fmt(Number(m.amount)||0)+'</div></div>';
    });
    html+='</div>';
  }
  el.innerHTML=html;
}

'''
app = app[:render_start] + render + app[render_end:]

# Strong contracts: new management UI must coexist with every important original
# Cashflow capability/calculation and must not reference the accidental fields.
render_block = app[app.find('function renderCash(){'):app.find('function _cashMoveForm(', app.find('function renderCash(){'))]
required = [
    'openReconcile()',
    'addCashMove()',
    'Cash calculation audit',
    'c.cashAvailable',
    'c.inflows',
    'c.outflows',
    'c.stockTied',
    'c.grossProfit',
    'c.unpaidLiabilities.total',
    'c.profitRetained',
    'filtered.forEach',
    'cashflow-manager',
    'printCashflow()',
    'exportCashflowExcel()',
]
for needle in required:
    if needle not in render_block:
        raise SystemExit(f'renderCash preservation contract missing: {needle}')
for forbidden in ['c.currentBalance','c.openingBalance','c.drawings']:
    if forbidden in render_block:
        raise SystemExit(f'renderCash contains accidental replacement field: {forbidden}')
if app.count('function renderCash(){') != 1:
    raise SystemExit('renderCash must remain unique')
if 'rt-list-loading' not in app[app.find('function _clearLoadingRegions(page){'):app.find('function _disableLoadingControls(){')]:
    raise SystemExit('rt-list-loading cleanup contract failed')
if app.count('function _cashflowCsvCell(value){') != 1:
    raise SystemExit('CSV numeric-cell helper contract failed')

APP.write_text(app, encoding='utf-8')
print('Cashflow preservation and loading cleanup repair applied.')
