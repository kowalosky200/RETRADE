from pathlib import Path
import re

JS=Path('app.js'); CSS=Path('app.css'); IDX=Path('index.html')
js=JS.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')
idx=IDX.read_text(encoding='utf-8')

required=[
    "var VERSION='1.4.13-2026-09-02'",
    "v1.4.14 real-layout boot loading loaded",
    "v1.4.15 stable return identity loaded",
    "v1.4.16 bulk platform editing loaded",
    "v1.4.17 terminal disposal durability loaded",
    "function showRealLayoutLoading(tab,msg){",
    "function finishRealLayoutLoading(tab){",
    "function _markLoadingRegions(root){",
]
for token in required:
    if token not in js:
        raise SystemExit('Expected current production token missing: '+token)
if 'v1.4.18 polished real-layout loading loaded' in js:
    raise SystemExit('v1.4.18 already applied')

old="""let _realLayoutLoading=false;\nlet _realLayoutLoadingTab=null;"""
new="""let _realLayoutLoading=false;\nlet _realLayoutLoadingTab=null;\nlet _realLayoutLoadingStartedAt=0;\nlet _realLayoutFinishTimer=null;"""
if js.count(old)!=1: raise SystemExit('loader state block not found exactly once')
js=js.replace(old,new,1)

pat=re.compile(r"function _markLoadingRegions\(root\)\{.*?\n\}\n\nfunction _disableLoadingControls\(\)\{",re.S)
replacement=r'''function _markLoadingRegions(root){
  if(!root)return;
  root.setAttribute('aria-busy','true');
  root.dataset.loading='true';

  // Keep real labels/titles visible. Only values that depend on loaded data shimmer.
  root.querySelectorAll([
    '[data-cv]','.kpi-value','.summary-hero-value','.metric-v','.inv-stat-v',
    '.snap-stat-v','.category-mini-val','.age-legend-count','.rh-profit',
    '.stat-num','.kcard-value','.run-kpi-value','.cash-balance-value',
    '.sales-kpi-value','.sales-kpi-sub','.kpi-foot','.summary-hero-sub',
    '.metric-sub','.item-row-profit','.item-row-roi','.money-value',
    // Current V2 Sales markup
    '.mf-val','.mf-foot','.fy-stat-hide'
  ].join(',')).forEach(function(el){el.classList.add('rt-data-loading');});

  // FY accordion profit values currently have no semantic value class. Scope the
  // fallback tightly to FY sections and only mask text that is actually currency.
  root.querySelectorAll('.fy-section span').forEach(function(el){
    if(/^[-+−]?£[\d,.]+$/.test((el.textContent||'').trim()))el.classList.add('rt-data-loading');
  });

  root.querySelectorAll([
    '.summary-hero-chart','.chart-wrap','.chart-container','.summary-chart-body',
    '.monthly-profitability-card .chart-area','.monthly-profitability-card svg',
    '#monthly-profitability-svg'
  ].join(',')).forEach(function(el){el.classList.add('rt-chart-loading');});
  root.querySelectorAll('svg[id*="chart"],canvas,#monthly-profitability-svg').forEach(function(el){el.classList.add('rt-chart-data-loading');});

  // Lists use an overlay INSIDE the production container. Never replace innerHTML.
  const listTargets=root.querySelectorAll([
    '.item-table','.run-history-list','.activity-list','.cash-list','.expense-list',
    '.returns-list','.return-list','.scrapped-list','.data-list',
    '.monthly-list','.sales-list'
  ].join(','));
  listTargets.forEach(function(el){
    el.classList.add('rt-list-loading');
    let overlay=null;
    try{overlay=el.querySelector(':scope > .rt-loading-list-overlay');}catch(e){overlay=el.querySelector('.rt-loading-list-overlay');}
    if(!overlay){
      overlay=document.createElement('div');
      overlay.className='rt-loading-list-overlay';
      overlay.setAttribute('aria-hidden','true');
      overlay.innerHTML=_loadingItemRows(Math.max(5,Math.ceil(((window.innerHeight||800)-360)/58)));
      el.appendChild(overlay);
    }
  });

  root.querySelectorAll('.empty-state,.empty-state-v2,.no-data,.empty-list').forEach(function(el){el.classList.add('rt-hide-while-loading');});
}

function _clearLoadingRegions(page){
  if(!page)return;
  page.removeAttribute('aria-busy');
  delete page.dataset.loading;
  page.querySelectorAll('.rt-data-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-hide-while-loading')
    .forEach(function(el){el.classList.remove('rt-data-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-hide-while-loading');});
  page.querySelectorAll('.rt-loading-list-overlay').forEach(function(el){el.remove();});
}

function _disableLoadingControls(){'''
js,n=pat.subn(replacement,js,count=1)
if n!=1: raise SystemExit('Could not replace _markLoadingRegions block')

old_err="""  page.removeAttribute('aria-busy');\n  delete page.dataset.loading;\n  page.querySelectorAll('.rt-data-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-hide-while-loading')\n    .forEach(function(el){el.classList.remove('rt-data-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-hide-while-loading');});"""
if old_err not in js: raise SystemExit('load error cleanup block missing')
js=js.replace(old_err,"  _clearLoadingRegions(page);",1)

show_marker="""function showRealLayoutLoading(tab,msg){\n  const safe=_activateBootPage(tab);\n  _realLayoutLoading=true;\n  _realLayoutLoadingTab=safe;"""
show_new="""function showRealLayoutLoading(tab,msg){\n  const safe=_activateBootPage(tab);\n  _realLayoutLoading=true;\n  _realLayoutLoadingTab=safe;\n  _realLayoutLoadingStartedAt=(window.performance&&performance.now)?performance.now():Date.now();\n  if(_realLayoutFinishTimer){clearTimeout(_realLayoutFinishTimer);_realLayoutFinishTimer=null;}"""
if js.count(show_marker)!=1: raise SystemExit('showRealLayoutLoading marker missing')
js=js.replace(show_marker,show_new,1)

finish_pat=re.compile(r"function finishRealLayoutLoading\(tab\)\{.*?\n\}\n\nconsole\.info\('\[RETRADE\] v1\.4\.14 real-layout boot loading loaded'\);",re.S)
finish_new=r'''function finishRealLayoutLoading(tab){
  const safe=tab||_realLayoutLoadingTab||'summary';
  const page=document.getElementById('p-'+safe);

  // initDB has just rendered the hydrated page and therefore replaced parts of the
  // initial loading DOM. Mask the NEW real DOM once more so the handoff is 1:1.
  if(page)_markLoadingRegions(page);

  const now=(window.performance&&performance.now)?performance.now():Date.now();
  const elapsed=Math.max(0,now-_realLayoutLoadingStartedAt);
  const remaining=Math.max(0,260-elapsed);

  const finalize=function(){
    _clearLoadingRegions(page);
    _enableLoadingControls();
    document.body.classList.remove('rt-real-layout-loading','rt-boot-shell');
    const status=document.getElementById('real-layout-loading-status');
    if(status)status.remove();
    _realLayoutLoading=false;
    _realLayoutLoadingTab=null;
    _realLayoutFinishTimer=null;
    if(typeof _syncFabVisibility==='function')_syncFabVisibility();
  };

  requestAnimationFrame(function(){requestAnimationFrame(function(){
    _realLayoutFinishTimer=setTimeout(finalize,remaining);
  });});
}

console.info('[RETRADE] v1.4.14 real-layout boot loading loaded');
console.info('[RETRADE] v1.4.18 polished real-layout loading loaded');'''
js,n=finish_pat.subn(finish_new,js,count=1)
if n!=1: raise SystemExit('Could not replace finishRealLayoutLoading')

css_anchor="""@media(prefers-reduced-motion:reduce){\n  .rt-real-layout-loading .rt-data-loading,\n  .rt-real-layout-loading .rt-chart-loading::after{animation:none!important;}\n}"""
if css_anchor not in css: raise SystemExit('real-layout CSS anchor missing')
polish=r'''

/* v1.4.18 — polished in-place skeleton. Geometry belongs to the real components;
   these rules only paint data placeholders inside them. */
.rt-real-layout-loading .rt-data-loading{
  position:relative;overflow:hidden;
  color:transparent!important;
  text-shadow:none!important;
  border-radius:6px;
  background:linear-gradient(90deg,
    color-mix(in srgb,var(--surface2) 88%,var(--border)) 0%,
    color-mix(in srgb,var(--border) 76%,var(--surface2)) 44%,
    color-mix(in srgb,var(--surface2) 88%,var(--border)) 100%);
  background-size:240% 100%;
  animation:rt-data-shimmer 1.28s ease-in-out infinite;
  box-decoration-break:clone;-webkit-box-decoration-break:clone;
}
.rt-real-layout-loading .kpi-value.rt-data-loading,
.rt-real-layout-loading .summary-hero-value.rt-data-loading,
.rt-real-layout-loading .metric-v.rt-data-loading,
.rt-real-layout-loading .inv-stat-v.rt-data-loading,
.rt-real-layout-loading .snap-stat-v.rt-data-loading,
.rt-real-layout-loading .sales-kpi-value.rt-data-loading,
.rt-real-layout-loading .stat-num.rt-data-loading,
.rt-real-layout-loading .kcard-value.rt-data-loading,
.rt-real-layout-loading .run-kpi-value.rt-data-loading,
.rt-real-layout-loading .cash-balance-value.rt-data-loading,
.rt-real-layout-loading .mf-val.rt-data-loading{
  display:inline-block!important;min-width:5.2ch;min-height:.92em;vertical-align:middle;
}
.rt-real-layout-loading .kpi-foot.rt-data-loading,
.rt-real-layout-loading .summary-hero-sub.rt-data-loading,
.rt-real-layout-loading .metric-sub.rt-data-loading,
.rt-real-layout-loading .sales-kpi-sub.rt-data-loading,
.rt-real-layout-loading .item-row-roi.rt-data-loading,
.rt-real-layout-loading .mf-foot.rt-data-loading,
.rt-real-layout-loading .fy-stat-hide.rt-data-loading{
  display:inline-block!important;min-width:9ch;min-height:.78em;border-radius:5px;
}
.rt-real-layout-loading .rt-chart-loading{
  position:relative;overflow:hidden;
  min-height:inherit;background:color-mix(in srgb,var(--surface2) 42%,transparent);
}
.rt-real-layout-loading .rt-chart-data-loading{opacity:.10!important;}
.rt-real-layout-loading .rt-chart-loading::after{
  content:'';position:absolute;inset:0;z-index:5;pointer-events:none;
  background:
    linear-gradient(110deg,transparent 18%,color-mix(in srgb,var(--border) 72%,transparent) 42%,transparent 66%),
    linear-gradient(to top right,transparent 46%,color-mix(in srgb,var(--border) 46%,transparent) 48%,color-mix(in srgb,var(--border) 46%,transparent) 51%,transparent 53%);
  background-size:240% 100%,100% 100%;
  animation:rt-data-shimmer 1.28s ease-in-out infinite;
}
.rt-real-layout-loading .rt-list-loading{position:relative;overflow:hidden;min-height:240px;}
.rt-real-layout-loading .rt-loading-list-overlay{
  position:absolute;z-index:30;inset:0;overflow:hidden;pointer-events:none;
  background:var(--surface);
}
.rt-real-layout-loading .rt-loading-list-overlay .rt-loading-row{
  min-height:58px;padding-left:inherit;padding-right:inherit;border-bottom:1px solid var(--border);
}
.rt-real-layout-loading .rt-loading-line{
  background:linear-gradient(90deg,var(--surface2) 0%,var(--border) 46%,var(--surface2) 100%);
  background-size:240% 100%;animation:rt-data-shimmer 1.28s ease-in-out infinite;
}
.rt-real-layout-loading .rt-loading-line-main{width:min(46%,320px);height:12px;}
.rt-real-layout-loading .rt-loading-line-sub{width:min(29%,210px);height:9px;}
.rt-real-layout-loading .rt-loading-line-value{width:64px;height:15px;margin-right:12px;}
@media(max-width:600px){
  .rt-real-layout-loading .rt-list-loading{min-height:220px;}
  .rt-real-layout-loading .rt-loading-line-main{width:58%;}
  .rt-real-layout-loading .rt-loading-line-sub{width:38%;}
  .rt-real-layout-loading .rt-loading-line-value{width:52px;margin-right:8px;}
}
@media(prefers-reduced-motion:reduce){
  .rt-real-layout-loading .rt-data-loading,
  .rt-real-layout-loading .rt-loading-line,
  .rt-real-layout-loading .rt-chart-loading::after{animation:none!important;}
}
'''
css=css.replace(css_anchor,css_anchor+polish,1)

if './app.js?v=1.4.17' not in idx: raise SystemExit('expected v1.4.17 JS ref missing')
idx=idx.replace('./app.js?v=1.4.17','./app.js?v=1.4.18',1)
idx,ncss=re.subn(r'\./app\.css\?v=1\.4\.(?:14|15|16|17)', './app.css?v=1.4.18', idx, count=1)
if ncss!=1: raise SystemExit('could not bump app.css asset ref')

JS.write_text(js,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.18 polished real-layout loading')
