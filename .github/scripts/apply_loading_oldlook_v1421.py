from pathlib import Path
import re

JS=Path('app.js'); CSS=Path('app.css'); IDX=Path('index.html')
js=JS.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')
idx=IDX.read_text(encoding='utf-8')

for token in [
  "var VERSION='1.4.13-2026-09-02'",
  'v1.4.15 stable return identity loaded',
  'v1.4.16 bulk platform editing loaded',
  'v1.4.17 terminal disposal durability loaded',
  'v1.4.18 polished real-layout loading loaded',
  'v1.4.19 Sales month-card loading loaded',
  'v1.4.20 populated real-layout loading shell loaded',
  'function _markLoadingRegions(root){',
  'function _clearLoadingRegions(page){',
]:
  if token not in js: raise SystemExit('missing production guard: '+token)
if 'v1.4.21 old-look real-layout skeleton loaded' in js:
  raise SystemExit('v1.4.21 already applied')

# Add old-style shimmer to real headings/labels, plus generic data-leaf masking.
needle="""  root.querySelectorAll([
    '[data-cv]','.kpi-value','.summary-hero-value','.metric-v','.inv-stat-v',
    '.snap-stat-v','.category-mini-val','.age-legend-count','.rh-profit',
    '.stat-num','.kcard-value','.run-kpi-value','.cash-balance-value',
    '.sales-kpi-value','.sales-kpi-sub','.kpi-foot','.summary-hero-sub',
    '.metric-sub','.item-row-profit','.item-row-roi','.money-value',
    '.mf-val','.mf-foot','.fy-stat-hide'
  ].join(',')).forEach(function(el){el.classList.add('rt-data-loading');});
"""
replacement="""  root.querySelectorAll([
    '[data-cv]','.kpi-value','.summary-hero-value','.metric-v','.inv-stat-v',
    '.snap-stat-v','.category-mini-val','.age-legend-count','.rh-profit',
    '.stat-num','.kcard-value','.run-kpi-value','.cash-balance-value',
    '.sales-kpi-value','.sales-kpi-sub','.kpi-foot','.summary-hero-sub',
    '.metric-sub','.item-row-profit','.item-row-roi','.money-value',
    '.mf-val','.mf-foot','.fy-stat-hide','.inv-stat-sub','.category-mini-meta',
    '.mcard .msub'
  ].join(',')).forEach(function(el){el.classList.add('rt-data-loading');});

  // Bring back the polished pre-v1.4.14 skeleton language without bringing back
  // its duplicate page DOM. These are the real current labels in the real cards.
  root.querySelectorAll([
    '.page-title','.page-subtitle','.summary-title','.summary-subtitle',
    '.kpi-label','.summary-panel > .sl','.summary-chart-head .sl',
    '.summary-cat-head .sl','.snap-strip-head .sl','.inv-age-title',
    '.monthly-profitability-card > .sl'
  ].join(',')).forEach(function(el){el.classList.add('rt-label-loading');});

  // Catch data leaves whose renderer does not expose a semantic value class.
  root.querySelectorAll('*').forEach(function(el){
    if(el.children&&el.children.length)return;
    const txt=(el.textContent||'').trim();
    if(!txt)return;
    if(
      /^[-+−]?£[\\d,.]+(?:\\s*[kKmM])?$/.test(txt) ||
      /^[-+−]?\\d+(?:[.,]\\d+)?(?:%|pp|d|x)?$/.test(txt) ||
      /^\\d+\\s+(?:sold|active)\\b/i.test(txt) ||
      /^No items yet\\b/i.test(txt) ||
      /^No completed sales\\b/i.test(txt) ||
      /^No sales yet\\b/i.test(txt)
    ) el.classList.add('rt-data-loading');
  });
"""
if js.count(needle)!=1: raise SystemExit('primary loading selector block not found once')
js=js.replace(needle,replacement,1)

# Expand chart skeleton regions to the real category donut area.
old="""    '.summary-hero-chart','.chart-wrap','.chart-container','.summary-chart-body',
    '.monthly-profitability-card .chart-area','.monthly-profitability-card svg',
    '#monthly-profitability-svg'"""
new="""    '.summary-hero-chart','.chart-wrap','.chart-container','.summary-chart-body',
    '.summary-categories .cat-donut-wrap',
    '.monthly-profitability-card .chart-area','.monthly-profitability-card svg',
    '#monthly-profitability-svg'"""
if js.count(old)!=1: raise SystemExit('chart selector block not found once')
js=js.replace(old,new,1)

# After normal list overlays are attached, add old-style rows inside Top Flips
# while keeping its real card/header geometry.
marker="""  listTargets.forEach(function(el){
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
"""
addition=marker+"""

  root.querySelectorAll('.summary-topflips').forEach(function(el){
    el.classList.add('rt-panel-list-loading');
    let overlay=null;
    try{overlay=el.querySelector(':scope > .rt-loading-list-overlay');}catch(e){overlay=el.querySelector('.rt-loading-list-overlay');}
    if(!overlay){
      overlay=document.createElement('div');
      overlay.className='rt-loading-list-overlay rt-loading-panel-overlay';
      overlay.setAttribute('aria-hidden','true');
      overlay.innerHTML=_loadingItemRows(3);
      el.appendChild(overlay);
    }
  });

  root.querySelectorAll('.inv-age').forEach(function(el){el.classList.add('rt-age-loading');});
  root.querySelectorAll([
    '.mf-bar','.mf-bar-fill','.mf-fill','.mf-track',
    '[role="progressbar"]','progress'
  ].join(',')).forEach(function(el){el.classList.add('rt-neutral-loading-bar');});
"""
if js.count(marker)!=1: raise SystemExit('list overlay block not found once')
js=js.replace(marker,addition,1)

# Ensure new classes clear at handoff.
old_clear="""  page.querySelectorAll('.rt-data-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-hide-while-loading')
    .forEach(function(el){el.classList.remove('rt-data-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-hide-while-loading');});"""
new_clear="""  page.querySelectorAll('.rt-data-loading,.rt-label-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-panel-list-loading,.rt-age-loading,.rt-neutral-loading-bar,.rt-hide-while-loading')
    .forEach(function(el){el.classList.remove('rt-data-loading','rt-label-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-panel-list-loading','rt-age-loading','rt-neutral-loading-bar','rt-hide-while-loading');});"""
if js.count(old_clear)!=1: raise SystemExit('clear loading selector block not found once')
js=js.replace(old_clear,new_clear,1)

# Console/version marker.
needle_console="console.info('[RETRADE] v1.4.20 populated real-layout loading shell loaded');"
if needle_console not in js: raise SystemExit('v1.4.20 console marker missing')
js=js.replace(needle_console,needle_console+"\nconsole.info('[RETRADE] v1.4.21 old-look real-layout skeleton loaded');",1)

css_add=r'''

/* v1.4.21 — old visual skeleton language, current production geometry. */
.rt-real-layout-loading .rt-data-loading,
.rt-real-layout-loading .rt-data-loading *{
  color:transparent!important;
  text-shadow:none!important;
}
.rt-real-layout-loading .rt-data-loading svg,
.rt-real-layout-loading .rt-data-loading img{opacity:0!important;}

.rt-real-layout-loading .rt-label-loading{
  position:relative!important;
  color:transparent!important;
  text-shadow:none!important;
}
.rt-real-layout-loading .rt-label-loading::after{
  content:'';
  position:absolute;
  left:0;
  top:50%;
  transform:translateY(-50%);
  height:.72em;
  border-radius:5px;
  background:linear-gradient(90deg,var(--surface2) 0%,var(--border) 46%,var(--surface2) 100%);
  background-size:240% 100%;
  animation:rt-data-shimmer 1.28s ease-in-out infinite;
  pointer-events:none;
}
.rt-real-layout-loading .page-title.rt-label-loading::after,
.rt-real-layout-loading .summary-title.rt-label-loading::after{width:min(180px,75%);height:.82em;}
.rt-real-layout-loading .page-subtitle.rt-label-loading::after,
.rt-real-layout-loading .summary-subtitle.rt-label-loading::after{width:min(280px,82%);height:.68em;}
.rt-real-layout-loading .kpi-label.rt-label-loading::after{width:62%;}
.rt-real-layout-loading .sl.rt-label-loading::after{width:min(118px,70%);}
.rt-real-layout-loading .inv-age-title.rt-label-loading::after{width:78px;}

/* Charts keep their true card dimensions but all seeded detail recedes behind shimmer. */
.rt-real-layout-loading .rt-chart-loading > *{opacity:.07!important;}
.rt-real-layout-loading .summary-categories .cat-donut-wrap.rt-chart-loading{
  min-height:150px;
  border-radius:var(--r-m);
}

/* Top Flips keeps its real header/card; only its dynamic body becomes old-style rows. */
.rt-real-layout-loading .rt-panel-list-loading{
  position:relative;
  overflow:hidden;
  min-height:220px;
}
.rt-real-layout-loading .rt-panel-list-loading > .rt-loading-panel-overlay{
  top:48px;
  left:16px;
  right:16px;
  bottom:12px;
  background:var(--surface);
  border-radius:0;
}
.rt-real-layout-loading .rt-panel-list-loading > .rt-loading-panel-overlay .rt-loading-row{
  min-height:48px;
}

/* Neutralise seeded progress/age colour so it reads as loading, not real data. */
.rt-real-layout-loading .rt-neutral-loading-bar{
  filter:grayscale(1)!important;
  opacity:.28!important;
}
.rt-real-layout-loading .rt-age-loading{
  position:relative;
}
.rt-real-layout-loading .rt-age-loading [style*="background"],
.rt-real-layout-loading .rt-age-loading [class*="bar"],
.rt-real-layout-loading .rt-age-loading [class*="seg"]{
  filter:grayscale(1)!important;
  opacity:.22!important;
}

/* Empty Sales month cards should look intentionally pending, not like empty account data. */
.rt-real-layout-loading .mcard-empty .msub.rt-data-loading{
  display:inline-block!important;
  width:72%;
  min-height:.72em;
  border-radius:5px;
}

@media(max-width:600px){
  .rt-real-layout-loading .page-title.rt-label-loading::after,
  .rt-real-layout-loading .summary-title.rt-label-loading::after{width:min(150px,72%);}
  .rt-real-layout-loading .page-subtitle.rt-label-loading::after,
  .rt-real-layout-loading .summary-subtitle.rt-label-loading::after{width:min(230px,86%);}
  .rt-real-layout-loading .rt-panel-list-loading > .rt-loading-panel-overlay{left:12px;right:12px;}
}
@media(prefers-reduced-motion:reduce){
  .rt-real-layout-loading .rt-label-loading::after{animation:none!important;}
}
'''
if 'v1.4.21 — old visual skeleton language' in css: raise SystemExit('v1.4.21 CSS already present')
css += css_add

if './app.js?v=1.4.20' not in idx: raise SystemExit('expected app.js v1.4.20 ref missing')
idx=idx.replace('./app.js?v=1.4.20','./app.js?v=1.4.21',1)
idx,ncss=re.subn(r'\./app\.css\?v=1\.4\.20','./app.css?v=1.4.21',idx,count=1)
if ncss!=1: raise SystemExit('expected app.css v1.4.20 ref missing')

JS.write_text(js,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.21 old-look real-layout skeleton polish')
