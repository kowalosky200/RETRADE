from pathlib import Path
import re

app_p=Path('app.js'); css_p=Path('app.css'); html_p=Path('index.html')
app=app_p.read_text(encoding='utf-8')
css=css_p.read_text(encoding='utf-8')
html=html_p.read_text(encoding='utf-8')


def one_replace(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 exact match, got {n}')
    return text.replace(old,new,1)

# Shared interaction scheduler: let the pressed control / destination page paint
# before expensive local render work starts. One queue is intentional — a newer
# user action supersedes an older not-yet-started visual refresh.
anchor='function goToTab(name,sourceEl){'
if app.count(anchor)!=1:
    raise SystemExit('goToTab anchor mismatch')
scheduler="""let _interactionRenderFrame=0;
let _interactionRenderTimer=0;
let _interactionRenderToken=0;
function _queueInteractionRender(fn){
  if(typeof fn!=='function')return;
  const token=++_interactionRenderToken;
  if(_interactionRenderFrame){cancelAnimationFrame(_interactionRenderFrame);_interactionRenderFrame=0;}
  if(_interactionRenderTimer){clearTimeout(_interactionRenderTimer);_interactionRenderTimer=0;}
  // First frame commits the tap/nav state. The zero-delay task then performs the
  // heavier render after that paint instead of blocking the acknowledgement.
  _interactionRenderFrame=requestAnimationFrame(function(){
    _interactionRenderFrame=0;
    _interactionRenderTimer=setTimeout(function(){
      _interactionRenderTimer=0;
      if(token!==_interactionRenderToken)return;
      fn();
    },0);
  });
}

"""
if 'function _queueInteractionRender(fn)' not in app:
    app=app.replace(anchor,scheduler+anchor,1)

# Only modify render calls INSIDE goToTab. State changes / nav highlighting stay
# synchronous; render*() calls yield until the destination page has painted.
m=re.search(r'function goToTab\(name,sourceEl\)\{.*?\n\}\n(?=\n(?:function|const|let|var) )',app,re.S)
if not m:
    raise SystemExit('could not isolate goToTab')
block=m.group(0)
render_names=re.findall(r'\b(render[A-Z][A-Za-z0-9_]*)\(\);',block)
if len(render_names)<8:
    raise SystemExit(f'goToTab: expected >=8 direct render calls, got {len(render_names)} {render_names}')
new_block=re.sub(r'\b(render[A-Z][A-Za-z0-9_]*)\(\);',r'_queueInteractionRender(\1);',block)
app=app[:m.start()]+new_block+app[m.end():]

# Dashboard period switch: old double-rAF deliberately waited two frames. Use the
# shared acknowledgement-first queue: one committed paint, then latest-only render.
ms=re.search(r'let _summaryPeriodFrame=0;\nlet _summaryPeriodFrame2=0;\nfunction setSummaryPeriod\(p\)\{.*?\n\}',app,re.S)
if not ms:
    raise SystemExit('setSummaryPeriod block not found')
summary_new="""let _summaryPeriodFrame=0;
let _summaryPeriodFrame2=0;
function setSummaryPeriod(p){
  SUMMARY_PERIOD=p;
  _saveUIState();
  _queueInteractionRender(renderSummary);
}"""
app=app[:ms.start()]+summary_new+app[ms.end():]

# Cashflow filter refresh: replace nested rAFs with the same paint-first queue.
mc=re.search(r'function _scheduleCashflowResultsUpdate\(afterPaint\)\{.*?\n\}\nfunction setCashflowFilter',app,re.S)
if not mc:
    raise SystemExit('cashflow scheduler block not found')
cash_sched="""function _scheduleCashflowResultsUpdate(afterPaint){
  _queueInteractionRender(_updateCashflowResults);
}
function setCashflowFilter"""
app=app[:mc.start()]+cash_sched+app[mc.end():]

# High-frequency local filters: update their state immediately, then yield the full
# list rebuild until after the pressed chip/select has painted.
repls={
"function setStockSort(s){STOCK_SORT=s;renderStock();_saveUIState();}":"function setStockSort(s){STOCK_SORT=s;_saveUIState();_queueInteractionRender(renderStock);}",
"function setStockFilter(f){STOCK_FILTER=f;renderStock();_saveUIState();}":"function setStockFilter(f){STOCK_FILTER=f;_saveUIState();_queueInteractionRender(renderStock);}",
"function setStockSourcedFilter(f){STOCK_SOURCED_FILTER=f;renderStock();}":"function setStockSourcedFilter(f){STOCK_SOURCED_FILTER=f;_queueInteractionRender(renderStock);}",
"function setMonthSort(s){MONTH_SORT=s;renderMonth();}":"function setMonthSort(s){MONTH_SORT=s;_queueInteractionRender(renderMonth);}",
}
for old,new in repls.items():
    app=one_replace(app,old,new,old.split('{')[0])

old_month="""function setMonthFilter(f){
  MONTH_FILTER=f;
  // Session B: all monthly views are sale-history; default sort is date-sold.
  if(MONTH_SORT==='date-listed')MONTH_SORT='date-sold';
  renderMonth();
}"""
new_month="""function setMonthFilter(f){
  MONTH_FILTER=f;
  // Session B: all monthly views are sale-history; default sort is date-sold.
  if(MONTH_SORT==='date-listed')MONTH_SORT='date-sold';
  _queueInteractionRender(renderMonth);
}"""
app=one_replace(app,old_month,new_month,'setMonthFilter')

# Stock state filter has additional state hygiene, so only defer its terminal render.
msf=re.search(r'function setStockStateFilter\(f\)\{.*?\n\}',app,re.S)
if not msf:
    raise SystemExit('setStockStateFilter not found')
sf=msf.group(0)
if sf.count('renderStock();')!=1:
    raise SystemExit(f'setStockStateFilter render count {sf.count("renderStock();")}')
sf=sf.replace('renderStock();','_queueInteractionRender(renderStock);',1)
app=app[:msf.start()]+sf+app[msf.end():]

# Monthly FY/calendar period and section toggles are local-only UI work too.
mp=re.search(r'function setMonthlyPeriod\(v\)\{.*?\n\}',app,re.S)
if not mp:
    raise SystemExit('setMonthlyPeriod not found')
mpb=mp.group(0)
if mpb.count('renderMonthlyGrid();')!=1:
    raise SystemExit(f'setMonthlyPeriod render count {mpb.count("renderMonthlyGrid();")}')
mpb=mpb.replace('renderMonthlyGrid();','_queueInteractionRender(renderMonthlyGrid);',1)
app=app[:mp.start()]+mpb+app[mp.end():]
app=one_replace(app,"function toggleFYSection(fyStart){\n  _fyCollapsed[fyStart]=!_fyCollapsed[fyStart];\n  renderMonthlyGrid();\n}","function toggleFYSection(fyStart){\n  _fyCollapsed[fyStart]=!_fyCollapsed[fyStart];\n  _queueInteractionRender(renderMonthlyGrid);\n}",'toggleFYSection')

# Give Cashflow rows a stable class so the browser can skip painting/layout for
# off-screen rows on long histories without changing their markup/behaviour.
old_row="html+='<div style=\"display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);'+(editable?'cursor:pointer;':'cursor:default;')+'\"'"
new_row="html+='<div class=\"cashflow-ledger-row\" style=\"display:flex;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid var(--border);'+(editable?'cursor:pointer;':'cursor:default;')+'\"'"
app=one_replace(app,old_row,new_row,'cashflow row class')

# Page navigation should read as fast, not floaty. Keep one refined transition,
# just shorten it and reduce travel. Do not alter global --dur-medium.
old_page="""@keyframes pageFade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
/* v2.16.1 — the ONE page transition. Was --dur-base (200ms) + 5px travel, which
   measured as firing correctly on every switch but was imperceptible: ease-out
   front-loads, so ~80% of a 5px move completed inside 60ms. --dur-medium +10px
   is visible without feeling slow. */
.page.on{animation:pageFade var(--dur-medium) var(--ease-out) both;}"""
new_page="""@keyframes pageFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
/* v1.4.27 — navigation acknowledgement is immediate; keep the page motion short
   and refined so it confirms the switch without making the app feel delayed. */
.page.on{animation:pageFade 200ms var(--ease-out) both;}"""
css=one_replace(css,old_page,new_page,'page transition')

perf_css="""

/* v1.4.27 — interaction responsiveness */
/* Explicit manipulation removes any gesture arbitration delay on app chrome.
   Existing component-specific :active transforms remain the visual language. */
.rt .tab,.rt .nav-more-btn,.rt .side-nav-item,.rt .btn,.rt .chip,
.rt .mcard,.rt .kpi.clickable,.rt .cashflow-action-btn,.rt .clickable{
  touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
@media(hover:none) and (pointer:coarse){
  .rt .tab:active,.rt .nav-more-btn:active,.rt .side-nav-item:active,
  .rt .btn:active,.rt .cashflow-action-btn:active{opacity:.78;}
}
/* Large local ledgers/lists do not need off-screen rows painted on every filter
   or page refresh. Layout size is reserved so scroll position remains stable. */
.rt #p-stock .item-row,.rt #p-monthly .item-row,.rt .cashflow-ledger-row{
  content-visibility:auto;contain-intrinsic-size:auto 76px;
}
"""
if '/* v1.4.27 — interaction responsiveness */' not in css:
    css += perf_css

# Cache bust only the files changed by this pass.
html=one_replace(html,'./app.css?v=1.4.26','./app.css?v=1.4.27','app.css cache')
html=one_replace(html,'./app.js?v=1.4.26','./app.js?v=1.4.27','app.js cache')

# Contracts
checks=[
 ('scheduler','function _queueInteractionRender(fn)' in app),
 ('nav deferred',new_block.count('_queueInteractionRender(')>=8),
 ('summary deferred','function setSummaryPeriod(p){\n  SUMMARY_PERIOD=p;\n  _saveUIState();\n  _queueInteractionRender(renderSummary);' in app),
 ('cash deferred','function _scheduleCashflowResultsUpdate(afterPaint){\n  _queueInteractionRender(_updateCashflowResults);' in app),
 ('stock deferred','function setStockFilter(f){STOCK_FILTER=f;_saveUIState();_queueInteractionRender(renderStock);}' in app),
 ('month deferred','_queueInteractionRender(renderMonth);' in app),
 ('cash rows','class=\\"cashflow-ledger-row\\"' in app),
 ('page 200ms','animation:pageFade 200ms var(--ease-out) both' in css),
 ('content visibility','content-visibility:auto' in css),
 ('cache js','./app.js?v=1.4.27' in html),
 ('cache css','./app.css?v=1.4.27' in html),
]
failed=[name for name,ok in checks if not ok]
if failed:
    raise SystemExit('contract failures: '+', '.join(failed))

app_p.write_text(app,encoding='utf-8')
css_p.write_text(css,encoding='utf-8')
html_p.write_text(html,encoding='utf-8')
print('interaction responsiveness patch applied')
print('goToTab deferred renders:', render_names)
