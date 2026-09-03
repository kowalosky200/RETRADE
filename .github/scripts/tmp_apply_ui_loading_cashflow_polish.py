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


def replace_top_function(text, signature, new_block, next_signature=None):
    start = text.find(signature)
    if start < 0:
        raise SystemExit(f'Could not find {signature}')
    if text.find(signature, start + len(signature)) >= 0:
        raise SystemExit(f'{signature} is not unique')
    if next_signature:
        end = text.find(next_signature, start + len(signature))
        if end < 0:
            raise SystemExit(f'Could not find next signature {next_signature}')
    else:
        match = re.search(r'\nfunction\s+[A-Za-z_$][\w$]*\s*\(', text[start + len(signature):])
        if not match:
            raise SystemExit(f'Could not locate function after {signature}')
        end = start + len(signature) + match.start() + 1
    return text[:start] + new_block.rstrip() + '\n\n' + text[end:]


# ---------------------------------------------------------------------------
# 1) Premium real-layout loading handoff.
# Keep the real responsive page mounted; only soften the transition from its
# data masks to hydrated values. No mimic/shell layout is introduced.
# ---------------------------------------------------------------------------
app = replace_once(
    app,
    'const remaining=Math.max(0,260-elapsed);',
    'const remaining=Math.max(0,440-elapsed);',
    'minimum real-layout loading duration',
)

clear_loading = r'''function _clearLoadingRegions(page){
  if(!page)return;
  page.removeAttribute('aria-busy');
  delete page.dataset.loading;

  let reduced=false;
  try{reduced=!!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(e){}

  const valueNodes=page.querySelectorAll('.rt-data-loading,.rt-label-loading');
  const chartNodes=page.querySelectorAll('.rt-chart-loading,.rt-chart-data-loading');
  const surfaceNodes=page.querySelectorAll('.rt-panel-list-loading,.rt-age-loading,.rt-neutral-loading-bar,.rt-hide-while-loading');
  const overlays=page.querySelectorAll('.rt-loading-list-overlay,.rt-loading-panel-overlay');

  if(reduced){
    valueNodes.forEach(function(el){el.classList.remove('rt-data-loading','rt-label-loading');});
    chartNodes.forEach(function(el){el.classList.remove('rt-chart-loading','rt-chart-data-loading');});
    surfaceNodes.forEach(function(el){el.classList.remove('rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');});
    overlays.forEach(function(el){el.remove();});
    document.body.classList.remove('rt-real-layout-revealing');
    return;
  }

  // v1.4.24 — real-layout crossfade. Hydrated content is revealed in the exact
  // same DOM geometry the skeleton occupied; nothing reflows or swaps layouts.
  document.body.classList.add('rt-real-layout-revealing');
  valueNodes.forEach(function(el){
    el.classList.add('rt-data-reveal');
    el.classList.remove('rt-data-loading','rt-label-loading');
  });
  chartNodes.forEach(function(el){
    el.classList.add('rt-chart-reveal');
    el.classList.remove('rt-chart-loading','rt-chart-data-loading');
  });
  surfaceNodes.forEach(function(el){
    el.classList.add('rt-data-reveal');
    el.classList.remove('rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');
  });
  overlays.forEach(function(el){el.classList.add('rt-loading-overlay-exit');});

  window.setTimeout(function(){
    overlays.forEach(function(el){if(el&&el.parentNode)el.remove();});
    page.querySelectorAll('.rt-data-reveal,.rt-chart-reveal').forEach(function(el){
      el.classList.remove('rt-data-reveal','rt-chart-reveal');
    });
    document.body.classList.remove('rt-real-layout-revealing');
  },340);
}'''

app = replace_top_function(
    app,
    'function _clearLoadingRegions(page){',
    clear_loading,
    'function _disableLoadingControls(){',
)

# ---------------------------------------------------------------------------
# 2) Donut/chart motion — slower, better damped return without cartoon bounce.
# Geometry invariant remains valid: len + rest === circumference.
# ---------------------------------------------------------------------------
app = replace_once(
    app,
    'const OVER=Math.min(RECOIL*0.22, g.rest*0.5);',
    'const OVER=Math.min(RECOIL*0.30, g.rest*0.5);',
    'donut overshoot geometry',
)

css = replace_once(css, '--dur-bounce: 440ms;', '--dur-bounce: 540ms;', 'donut bounce duration')
css = replace_once(css, '--dur-draw: 680ms;', '--dur-draw: 760ms;', 'chart/donut draw duration')
css = replace_once(css, 'transform:translateY(-0.35px) scale(1.010);', 'transform:translateY(-0.45px) scale(1.014);', 'donut first overshoot')
css = replace_once(css, 'transform:translateY(0.15px) scale(0.996);', 'transform:translateY(0.20px) scale(0.994);', 'donut recoil settle')
css = replace_once(css, 'transform:translateY(-0.08px) scale(1.002);', 'transform:translateY(-0.10px) scale(1.003);', 'donut second settle')

# ---------------------------------------------------------------------------
# 3) Cashflow management. All filters/exports operate on calcCashSummary().events
# so derived sales, returns, expenses and settlements stay included.
# ---------------------------------------------------------------------------
if 'v1.4.24 — high-volume Cashflow controls' in app:
    raise SystemExit('Cashflow v1.4.24 marker already exists')

cash_helpers_and_render = r'''// v1.4.24 — high-volume Cashflow controls.
// The view stays derived from calcCashSummary().events: filtering/exporting never
// creates a second ledger or drops generated sale/return/settlement movements.
let _cashflowSearch='';
let _cashflowDirection='all';
let _cashflowType='all';
let _cashflowRange='all';
let _cashflowSearchTimer=null;

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
function setCashflowFilter(key,value){
  if(key==='direction')_cashflowDirection=value||'all';
  else if(key==='type')_cashflowType=value||'all';
  else if(key==='range')_cashflowRange=value||'all';
  renderCash();
}
function cashflowSearchInput(el){
  _cashflowSearch=el&&el.value!=null?String(el.value):'';
  const start=el&&typeof el.selectionStart==='number'?el.selectionStart:_cashflowSearch.length;
  const end=el&&typeof el.selectionEnd==='number'?el.selectionEnd:start;
  if(_cashflowSearchTimer)clearTimeout(_cashflowSearchTimer);
  _cashflowSearchTimer=setTimeout(function(){
    _cashflowSearchTimer=null;
    renderCash();
    requestAnimationFrame(function(){
      const next=document.getElementById('cashflow-search');
      if(!next)return;
      next.focus({preventScroll:true});
      try{next.setSelectionRange(start,end);}catch(e){}
    });
  },120);
}
function clearCashflowFilters(){
  _cashflowSearch='';_cashflowDirection='all';_cashflowType='all';_cashflowRange='all';
  if(_cashflowSearchTimer){clearTimeout(_cashflowSearchTimer);_cashflowSearchTimer=null;}
  renderCash();
}
function _cashflowFileDate(){return new Date().toISOString().slice(0,10);}
function exportCashflowExcel(){
  const snap=_cashflowFilteredSnapshot();
  if(typeof XLSX==='undefined'||!XLSX.utils||typeof XLSX.writeFile!=='function'){
    if(typeof toast==='function')toast('Excel export is unavailable on this device.');
    return;
  }
  const rows=snap.rows;
  const inflow=rows.reduce(function(s,m){return s+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const outflow=rows.reduce(function(s,m){return s+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  const data=[
    ['RETRADE Cashflow'],
    ['Exported',new Date().toLocaleString('en-GB')],
    ['Rows',rows.length],
    ['Money in',inflow],
    ['Money out',outflow],
    ['Net',inflow-outflow],
    [],
    ['Date','Direction','Type','Description','Source','Amount','Signed amount','Item ID','Sale No']
  ];
  rows.forEach(function(m){
    const amount=Number(m.amount)||0;
    data.push([
      m.date||'',m.direction==='out'?'Out':'In',String(m.type||'cash').replace(/_/g,' '),
      m.description||'',m.source||'',amount,m.direction==='out'?-amount:amount,m.itemId||'',m.saleNo==null?'':m.saleNo
    ]);
  });
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:13},{wch:11},{wch:22},{wch:48},{wch:20},{wch:14},{wch:15},{wch:16},{wch:10}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Cashflow');
  XLSX.writeFile(wb,'RETRADE-cashflow-'+_cashflowFileDate()+'.xlsx');
  if(typeof toast==='function')toast('Cashflow Excel exported.');
}
function printCashflow(){
  const snap=_cashflowFilteredSnapshot();
  const rows=snap.rows;
  const inflow=rows.reduce(function(s,m){return s+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const outflow=rows.reduce(function(s,m){return s+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  const w=window.open('','_blank');
  if(!w){if(typeof toast==='function')toast('Allow pop-ups to print Cashflow.');return;}
  try{w.opener=null;}catch(e){}
  const tableRows=rows.map(function(m){
    const amount=Number(m.amount)||0;
    return '<tr><td>'+esc(m.date||'')+'</td><td>'+esc(m.direction==='out'?'Out':'In')+'</td><td>'+esc(String(m.type||'cash').replace(/_/g,' '))+'</td><td>'+esc(m.description||'')+'</td><td>'+esc(m.source||'')+'</td><td class="num">'+esc((m.direction==='out'?'-':'')+'£'+amount.toFixed(2))+'</td></tr>';
  }).join('');
  w.document.open();
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>RETRADE Cashflow</title><style>'+
    'body{font:12px system-ui,-apple-system,sans-serif;color:#111;margin:28px}h1{font-size:22px;margin:0 0 4px}p{color:#555;margin:0 0 18px}.summary{display:flex;gap:22px;margin:0 0 18px;padding:12px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd}.summary b{display:block;font-size:15px;margin-top:2px}.num{text-align:right;font-variant-numeric:tabular-nums}table{width:100%;border-collapse:collapse}th,td{padding:7px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#555}@media print{body{margin:12mm}.no-print{display:none}}'+
    '</style></head><body><h1>RETRADE Cashflow</h1><p>'+esc(rows.length+' of '+snap.all.length+' movements · '+new Date().toLocaleString('en-GB'))+'</p>'+
    '<div class="summary"><span>Money in<b>£'+inflow.toFixed(2)+'</b></span><span>Money out<b>£'+outflow.toFixed(2)+'</b></span><span>Net<b>'+((inflow-outflow)<0?'-':'')+'£'+Math.abs(inflow-outflow).toFixed(2)+'</b></span></div>'+
    '<table><thead><tr><th>Date</th><th>Direction</th><th>Type</th><th>Description</th><th>Source</th><th class="num">Amount</th></tr></thead><tbody>'+tableRows+'</tbody></table></body></html>');
  w.document.close();
  setTimeout(function(){try{w.focus();w.print();}catch(e){}},180);
}

function renderCash(){
  const el=document.getElementById('p-cash');if(!el)return;
  const c=calcCashSummary();
  const led=_cashflowSortedEvents(c);
  const filtered=_cashflowFilteredEvents(led);
  const kpi=function(label,val,foot,col){return '<div class="kpi-card"><div class="kpi-label">'+label+'</div><div class="kpi-value" style="color:'+col+'">'+fmt(val)+'</div><div class="kpi-foot">'+foot+'</div></div>';};
  const types=Array.from(new Set(led.map(function(m){return String(m.type||'cash');}))).sort(function(a,b){return a.localeCompare(b);});
  const filteredIn=filtered.reduce(function(s,m){return s+(m.direction==='in'?(Number(m.amount)||0):0);},0);
  const filteredOut=filtered.reduce(function(s,m){return s+(m.direction==='out'?(Number(m.amount)||0):0);},0);
  const filtersActive=!!(_cashflowSearch||_cashflowDirection!=='all'||_cashflowType!=='all'||_cashflowRange!=='all');

  let html='<div class="page-header"><div><div class="page-title">Cashflow</div><div class="page-subtitle">Every real cash movement across stock, sales, returns, expenses, settlements and owner money.</div></div></div>';
  html+='<div class="cash-balance-hero"><div><div class="cash-balance-label">Opening balance</div><div class="cash-balance-value">'+fmt(c.openingBalance||0)+'</div></div><div class="cash-balance-arrow">→</div><div><div class="cash-balance-label">Current cash</div><div class="cash-balance-value" style="color:'+(c.currentBalance>=0?'var(--green)':'var(--red)')+'">'+fmt(c.currentBalance||0)+'</div></div></div>';
  html+='<div class="kpi-grid">'+kpi('Money in',c.inflow,'All recorded inflows','var(--green)')+kpi('Money out',c.outflow,'All recorded outflows','var(--red)')+kpi('Net movement',c.net,'In less out',c.net>=0?'var(--green)':'var(--red)')+kpi('Owner drawings',c.drawings,'Withdrawals from the business','var(--text)')+'</div>';
  html+='<div class="cashflow-list-heading"><div><div class="sl">All cash movements</div><div class="cashflow-result-count">'+filtered.length+' of '+led.length+' movements</div></div></div>';

  html+='<div class="cashflow-manager">'+
    '<div class="cashflow-toolbar">'+
      '<label class="cashflow-search-field"><span class="cashflow-control-label">Search</span><input id="cashflow-search" class="cashflow-control cashflow-search" type="search" inputmode="search" autocomplete="off" placeholder="Description, type, source…" value="'+esc(_cashflowSearch)+'" oninput="cashflowSearchInput(this)"></label>'+
      '<label><span class="cashflow-control-label">Direction</span><select class="cashflow-control" onchange="setCashflowFilter(\'direction\',this.value)"><option value="all"'+(_cashflowDirection==='all'?' selected':'')+'>All directions</option><option value="in"'+(_cashflowDirection==='in'?' selected':'')+'>Money in</option><option value="out"'+(_cashflowDirection==='out'?' selected':'')+'>Money out</option></select></label>'+
      '<label><span class="cashflow-control-label">Type</span><select class="cashflow-control" onchange="setCashflowFilter(\'type\',this.value)"><option value="all">All types</option>'+types.map(function(t){return '<option value="'+esc(t)+'"'+(_cashflowType===t?' selected':'')+'>'+esc(t.replace(/_/g,' '))+'</option>';}).join('')+'</select></label>'+
      '<label><span class="cashflow-control-label">Period</span><select class="cashflow-control" onchange="setCashflowFilter(\'range\',this.value)"><option value="all"'+(_cashflowRange==='all'?' selected':'')+'>All time</option><option value="30"'+(_cashflowRange==='30'?' selected':'')+'>Last 30 days</option><option value="90"'+(_cashflowRange==='90'?' selected':'')+'>Last 90 days</option><option value="year"'+(_cashflowRange==='year'?' selected':'')+'>This year</option></select></label>'+
    '</div>'+
    '<div class="cashflow-manager-footer"><div class="cashflow-filter-totals"><span>In <b style="color:var(--green)">'+fmt(filteredIn)+'</b></span><span>Out <b style="color:var(--red)">'+fmt(filteredOut)+'</b></span><span>Net <b style="color:'+(filteredIn-filteredOut>=0?'var(--green)':'var(--red)')+'">'+fmt(filteredIn-filteredOut)+'</b></span></div>'+
      '<div class="cashflow-actions">'+(filtersActive?'<button class="cashflow-action-btn" onclick="clearCashflowFilters()">Clear filters</button>':'')+'<button class="cashflow-action-btn" onclick="printCashflow()">Print</button><button class="cashflow-action-btn cashflow-action-primary" onclick="exportCashflowExcel()">Excel</button></div></div>'+
    '</div>';

  if(!led.length){
    html+='<div class="empty-state"><b>No cash movements yet</b><span>Your stock, sale, return, expense and settlement activity will appear here automatically.</span></div>';
  }else if(!filtered.length){
    html+='<div class="empty-state"><b>No matching movements</b><span>Try changing the search or filters.</span><button class="cashflow-action-btn" style="margin-top:12px" onclick="clearCashflowFilters()">Clear filters</button></div>';
  }else{
    html+='<div class="section-card cashflow-ledger-list" style="padding:0;overflow:hidden;">';
    filtered.forEach(function(m){
      const isOut=m.direction==='out';
      const editable=!!m.editableId;
      html+='<div class="cash-ledger-row" style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);'+(editable?'cursor:pointer;':'')+'"'+(editable?' onclick="editCashMove(\''+m.editableId+'\')"':'')+'>'+
        '<div style="width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:'+(isOut?'var(--red-dim)':'var(--green-dim)')+';color:'+(isOut?'var(--red)':'var(--green)')+';font-weight:900;flex:none;">'+(isOut?'−':'+')+'</div>'+
        '<div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:750;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(m.description||m.type||'Cash movement')+'</div><div style="font-size:11px;color:var(--text-secondary);margin-top:2px">'+esc(String(m.type||'cash').replace(/_/g,' '))+' · '+esc(m.date||'Undated')+(editable?' · editable':' · from '+esc(m.source||'app'))+'</div></div>'+
        '<div class="num" style="font-size:14px;font-weight:850;color:'+(isOut?'var(--red)':'var(--green)')+';flex:none">'+(isOut?'−':'+')+fmt(Number(m.amount)||0)+'</div></div>';
    });
    html+='</div>';
  }
  el.innerHTML=html;
}'''

app = replace_top_function(app, 'function renderCash(){', cash_helpers_and_render)

# ---------------------------------------------------------------------------
# 4) CSS: premium hydrated reveal + high-volume Cashflow toolbar.
# ---------------------------------------------------------------------------
css_marker = '/* v1.4.24 — premium loading reveal + Cashflow management */'
if css_marker in css:
    raise SystemExit('CSS v1.4.24 marker already exists')
css += r'''

/* v1.4.24 — premium loading reveal + Cashflow management */
@keyframes rtHydratedReveal{
  0%{opacity:.18;filter:blur(.7px);transform:translateY(2px)}
  100%{opacity:1;filter:blur(0);transform:translateY(0)}
}
@keyframes rtHydratedChartReveal{
  0%{opacity:.08;filter:blur(1px);transform:translateY(2px) scale(.998)}
  100%{opacity:1;filter:blur(0);transform:translateY(0) scale(1)}
}
.rt-real-layout-revealing .rt-data-reveal{
  animation:rtHydratedReveal 320ms cubic-bezier(.22,.61,.36,1) both;
}
.rt-real-layout-revealing .rt-chart-reveal{
  animation:rtHydratedChartReveal 360ms cubic-bezier(.22,.61,.36,1) both;
}
.rt-real-layout-revealing .rt-loading-list-overlay,
.rt-real-layout-revealing .rt-loading-panel-overlay{
  position:absolute;z-index:30;inset:0;overflow:hidden;pointer-events:none;background:var(--surface);
}
.rt-real-layout-revealing .rt-loading-overlay-exit{
  opacity:0;transition:opacity 320ms cubic-bezier(.22,.61,.36,1);
}

.cashflow-list-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin:24px 0 10px;}
.cashflow-result-count{font-size:11px;color:var(--text-secondary);margin-top:3px;font-variant-numeric:tabular-nums;}
.cashflow-manager{margin:0 0 14px;padding:14px;border:1px solid var(--border);border-radius:var(--r-l,16px);background:color-mix(in srgb,var(--surface) 92%,var(--surface2));box-shadow:0 8px 28px rgba(0,0,0,.045);}
.cashflow-toolbar{display:grid;grid-template-columns:minmax(240px,1.55fr) repeat(3,minmax(132px,.65fr));gap:10px;align-items:end;}
.cashflow-toolbar label{display:flex;flex-direction:column;gap:5px;min-width:0;}
.cashflow-control-label{font-size:10px;font-weight:750;letter-spacing:.045em;text-transform:uppercase;color:var(--text-secondary);}
.cashflow-control{width:100%;height:40px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);color:var(--text);font:inherit;font-size:12px;padding:0 11px;outline:none;transition:border-color 160ms ease,box-shadow 160ms ease,background 160ms ease;}
.cashflow-control:focus{border-color:color-mix(in srgb,var(--brand) 72%,var(--border));box-shadow:0 0 0 3px color-mix(in srgb,var(--brand) 13%,transparent);background:var(--surface);}
.cashflow-search{-webkit-appearance:none;appearance:none;}
.cashflow-search::-webkit-search-cancel-button{opacity:.6;cursor:pointer;}
.cashflow-manager-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);}
.cashflow-filter-totals{display:flex;align-items:center;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--text-secondary);font-variant-numeric:tabular-nums;}
.cashflow-filter-totals b{font-size:12px;margin-left:3px;}
.cashflow-actions{display:flex;align-items:center;justify-content:flex-end;gap:7px;flex-wrap:wrap;}
.cashflow-action-btn{min-height:34px;padding:0 11px;border:1px solid var(--border);border-radius:9px;background:var(--surface2);color:var(--text);font:inherit;font-size:11px;font-weight:750;cursor:pointer;transition:transform 120ms ease,border-color 160ms ease,background 160ms ease;}
.cashflow-action-btn:hover{background:var(--surface3);border-color:var(--border-strong);}
.cashflow-action-btn:active{transform:translateY(1px);}
.cashflow-action-primary{background:color-mix(in srgb,var(--brand) 14%,var(--surface2));border-color:color-mix(in srgb,var(--brand) 38%,var(--border));color:var(--brand);}
.cashflow-ledger-list{content-visibility:auto;contain-intrinsic-size:800px;}
@media(max-width:900px){
  .cashflow-toolbar{grid-template-columns:minmax(220px,1.4fr) repeat(2,minmax(130px,.7fr));}
  .cashflow-toolbar label:last-child{grid-column:auto;}
}
@media(max-width:640px){
  .cashflow-manager{padding:12px;border-radius:14px;}
  .cashflow-toolbar{grid-template-columns:1fr 1fr;gap:9px;}
  .cashflow-search-field{grid-column:1/-1;}
  .cashflow-toolbar label:last-child{grid-column:auto;}
  .cashflow-manager-footer{align-items:stretch;flex-direction:column;}
  .cashflow-filter-totals{justify-content:space-between;gap:8px;}
  .cashflow-actions{justify-content:stretch;}
  .cashflow-action-btn{flex:1;min-width:78px;}
}
@media(max-width:390px){
  .cashflow-toolbar{grid-template-columns:1fr;}
  .cashflow-search-field{grid-column:auto;}
}
@media(prefers-reduced-motion:reduce){
  .rt-real-layout-revealing .rt-data-reveal,.rt-real-layout-revealing .rt-chart-reveal{animation:none!important;}
  .rt-real-layout-revealing .rt-loading-overlay-exit{transition:none!important;opacity:0!important;}
}
'''

# Cache-bust only the preserved production filenames.
index = replace_once(index, 'app.css?v=1.4.22', 'app.css?v=1.4.24', 'app.css cache version')
index = replace_once(index, 'app.js?v=1.4.22', 'app.js?v=1.4.24', 'app.js cache version')

# Final contract checks before writing.
checks = [
    ('app', 'const remaining=Math.max(0,440-elapsed);', app),
    ('app', 'v1.4.24 — high-volume Cashflow controls', app),
    ('app', 'function exportCashflowExcel(){', app),
    ('app', 'function printCashflow(){', app),
    ('app', 'function renderCash(){', app),
    ('css', css_marker, css),
    ('css', '--dur-bounce: 540ms;', css),
    ('css', '--dur-draw: 760ms;', css),
    ('index', 'app.css?v=1.4.24', index),
    ('index', 'app.js?v=1.4.24', index),
]
for label, needle, text in checks:
    if text.count(needle) != 1:
        raise SystemExit(f'{label} contract failed for {needle!r}: {text.count(needle)}')

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
print('Applied premium loading + Cashflow management patch successfully.')
