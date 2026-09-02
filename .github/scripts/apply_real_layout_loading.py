from pathlib import Path
import re

JS=Path('app.js')
CSS=Path('app.css')
IDX=Path('index.html')
js=JS.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')
idx=IDX.read_text(encoding='utf-8')

# Safety: this patch must land on top of the current Stage-1 sync-hardened build.
required=[
    "var VERSION='1.4.13-2026-09-02'",
    "showLoadingScreen('Loading your data…', _safeTab);",
    "function _showLoadError(msg){",
    "// v2.17.0 — Boot skeleton.",
    "function refreshActivePage(){",
]
for token in required:
    if token not in js:
        raise SystemExit('Expected current-live token missing: '+token)

# 1) initDB: real page is the loading surface; keep every other sync/migration line intact.
js=js.replace("showLoadingScreen('Loading your data…', _safeTab);",
              "showRealLayoutLoading(_safeTab, 'Loading your data…');",1)
js=js.replace("    // Destination is now rendered + active underneath the overlay; cross-fade only now.\n    hideLoadingScreen();",
              "    // Destination is already the same real page; reveal live data in-place.\n    finishRealLayoutLoading(_safeTab);",1)
js=js.replace("    // Keep the boot surface in place. A failed load/render must never expose a\n    // blank app canvas; _showLoadError converts the skeleton into a retry state.",
              "    // Keep the real page mounted. Load errors render inside that same layout.",1)

# 2) Replace the overlay-dependent error/retry handler.
err_start=js.index('function _showLoadError(msg){')
boot_start=js.index('// v2.17.0 — Boot skeleton.',err_start)
error_block=r'''function _showLoadError(msg){
  const tab=_realLayoutLoadingTab||'summary';
  const page=document.getElementById('p-'+tab);

  _enableLoadingControls();
  document.body.classList.remove('rt-real-layout-loading');

  if(!page)return;
  page.removeAttribute('aria-busy');
  delete page.dataset.loading;
  page.querySelectorAll('.rt-data-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-hide-while-loading')
    .forEach(function(el){el.classList.remove('rt-data-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-hide-while-loading');});

  const old=page.querySelector('.rt-load-error');
  if(old)old.remove();

  const box=document.createElement('div');
  box.className='rt-load-error';
  box.innerHTML='<div class="rt-load-error-icon">!</div>'
    +'<div class="rt-load-error-copy"><strong>Couldn\'t load your data</strong><span class="rt-load-error-message"></span></div>'
    +'<button class="btn btn-primary" onclick="retryAppLoad()">Retry</button>';
  const message=box.querySelector('.rt-load-error-message');
  if(message)message.textContent=String(msg||'Failed to load data.');
  page.prepend(box);
}
function retryAppLoad(){
  document.querySelectorAll('.rt-load-error').forEach(function(el){el.remove();});
  initDB();
}

'''
js=js[:err_start]+error_block+js[boot_start:]

# 3) Remove the duplicate boot skeleton implementation wholesale and replace it
# with a controller that renders the current production renderer for the tab.
boot_start=js.index('// v2.17.0 — Boot skeleton.')
refresh_start=js.index('function refreshActivePage(){',boot_start)
controller=r'''// ============================================================================
// v1.4.14 — REAL-LAYOUT BOOT LOADING
// The production page/component tree IS the loading UI. Static structure renders
// immediately at the real responsive breakpoint; only dynamic values/rows/charts
// are masked while Supabase hydrates. There is no duplicate boot page.
// ============================================================================
let _realLayoutLoading=false;
let _realLayoutLoadingTab=null;

function _bootRendererForTab(tab){
  const renderers={
    summary:function(){renderSummary();},
    monthly:function(){renderMonthlyPage();},
    stock:function(){renderStock();},
    runs:function(){renderRunsPage();},
    expenses:function(){renderExpenses();},
    cash:function(){renderCash();},
    returns:function(){renderReturns();},
    scrapped:function(){renderScrapped();},
    activity:function(){renderActivity();},
    tax:function(){renderTax();},
    data:function(){renderData();}
  };
  return renderers[tab]||renderers.summary;
}

function _activateBootPage(tab){
  const safe=['summary','monthly','stock','runs','expenses','cash','returns','scrapped','activity','tax','data'].includes(tab)?tab:'summary';
  if(typeof _deactivatePages==='function')_deactivatePages();
  else document.querySelectorAll('.page').forEach(function(page){page.classList.remove('on','rt-boot-noanim');});

  document.querySelectorAll('.tab,.bnt,.side-nav-item').forEach(function(el){el.classList.remove('on');});
  const page=document.getElementById('p-'+safe);
  if(page)page.classList.add('on','rt-boot-noanim');
  document.querySelectorAll('[data-tab="'+safe+'"]').forEach(function(el){el.classList.add('on');});

  if(typeof handleNavResize==='function')handleNavResize();
  if(typeof _syncFabVisibility==='function')_syncFabVisibility();
  return safe;
}

function _loadingItemRows(count){
  count=count||6;
  let html='';
  for(let n=0;n<count;n++){
    html+='<div class="item-row rt-loading-row" aria-hidden="true">'
      +'<div class="rt-loading-row-main"><span class="skeleton rt-loading-line rt-loading-line-main"></span>'
      +'<span class="skeleton rt-loading-line rt-loading-line-sub"></span></div>'
      +'<span class="skeleton rt-loading-line rt-loading-line-value"></span>'
      +'</div>';
  }
  return html;
}

function _markLoadingRegions(root){
  if(!root)return;
  root.setAttribute('aria-busy','true');
  root.dataset.loading='true';

  root.querySelectorAll([
    '[data-cv]','.kpi-value','.summary-hero-value','.metric-v','.inv-stat-v',
    '.snap-stat-v','.category-mini-val','.age-legend-count','.rh-profit',
    '.stat-num','.kcard-value','.run-kpi-value','.cash-balance-value'
  ].join(',')).forEach(function(el){el.classList.add('rt-data-loading');});

  root.querySelectorAll('.summary-hero-chart,.chart-wrap,.chart-container,.summary-chart-body,.monthly-profitability-card .chart-area')
    .forEach(function(el){el.classList.add('rt-chart-loading');});
  root.querySelectorAll('svg[id*="chart"],canvas').forEach(function(el){el.classList.add('rt-chart-data-loading');});

  // Only dynamic rows are substituted. The surrounding real page/card/table is
  // untouched, so its mobile/tablet/desktop geometry remains production CSS.
  const listTargets=root.querySelectorAll([
    '.item-table','.run-history-list','.activity-list','.cash-list','.expense-list',
    '.returns-list','.return-list','.scrapped-list','.data-list'
  ].join(','));
  listTargets.forEach(function(el){
    el.classList.add('rt-list-loading');
    el.innerHTML=_loadingItemRows(Math.max(5,Math.ceil(((window.innerHeight||800)-360)/58)));
  });

  // Do not briefly claim that an account has no data while it is still loading.
  root.querySelectorAll('.empty-state,.empty-state-v2,.no-data,.empty-list').forEach(function(el){el.classList.add('rt-hide-while-loading');});
}

function _disableLoadingControls(){
  document.body.classList.add('rt-data-loading-active');
  document.querySelectorAll([
    '.page.on button','.page.on input','.page.on select','.page.on textarea',
    '#fab-dial button','#side-nav button','#side-nav input','nav#nav button','nav#nav input',
    '#bottom-nav button','#mobile-top-bar button','#nav-search-expand input','#search-fab'
  ].join(',')).forEach(function(el){
    if(el.dataset.rtLoadingDisabled==='1')return;
    el.dataset.rtLoadingWasDisabled=el.disabled?'1':'0';
    el.dataset.rtLoadingDisabled='1';
    el.disabled=true;
    el.setAttribute('aria-disabled','true');
  });
}

function _enableLoadingControls(){
  document.querySelectorAll('[data-rt-loading-disabled="1"]').forEach(function(el){
    if(el.dataset.rtLoadingWasDisabled!=='1')el.disabled=false;
    el.removeAttribute('aria-disabled');
    delete el.dataset.rtLoadingDisabled;
    delete el.dataset.rtLoadingWasDisabled;
  });
  document.body.classList.remove('rt-data-loading-active');
}

function showRealLayoutLoading(tab,msg){
  const safe=_activateBootPage(tab);
  _realLayoutLoading=true;
  _realLayoutLoadingTab=safe;

  // Remove a stale overlay left by an older cached build; never create one.
  const oldOverlay=document.getElementById('app-loading');
  if(oldOverlay)oldOverlay.remove();
  document.body.classList.remove('rt-boot-shell');
  document.body.classList.add('rt-real-layout-loading');

  try{
    if(typeof _ensureDBShape==='function')_ensureDBShape();
    _bootRendererForTab(safe)();
  }catch(err){
    console.warn('[RETRADE] initial real-layout loading render failed:',err);
  }

  const page=document.getElementById('p-'+safe);
  _markLoadingRegions(page);
  _disableLoadingControls();

  try{if('scrollRestoration' in history)history.scrollRestoration='manual';}catch(e){}
  window.scrollTo(0,0);

  let status=document.getElementById('real-layout-loading-status');
  if(!status){
    status=document.createElement('div');
    status.id='real-layout-loading-status';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    status.className='rt-sr-only';
    document.body.appendChild(status);
  }
  status.textContent=msg||'Loading your data…';
}

function finishRealLayoutLoading(tab){
  const safe=tab||_realLayoutLoadingTab||'summary';
  const page=document.getElementById('p-'+safe);
  if(page){
    page.removeAttribute('aria-busy');
    delete page.dataset.loading;
    page.querySelectorAll('.rt-data-loading,.rt-chart-loading,.rt-chart-data-loading,.rt-list-loading,.rt-hide-while-loading')
      .forEach(function(el){el.classList.remove('rt-data-loading','rt-chart-loading','rt-chart-data-loading','rt-list-loading','rt-hide-while-loading');});
  }
  _enableLoadingControls();
  document.body.classList.remove('rt-real-layout-loading','rt-boot-shell');
  const status=document.getElementById('real-layout-loading-status');
  if(status)status.remove();
  _realLayoutLoading=false;
  _realLayoutLoadingTab=null;
  if(typeof _syncFabVisibility==='function')_syncFabVisibility();
}

console.info('[RETRADE] v1.4.14 real-layout boot loading loaded');

'''
js=js[:boot_start]+controller+js[refresh_start:]

# Modernise the boot comments left in initDB so maintenance documentation matches reality.
js=js.replace('Resolve the boot tab BEFORE the load so the skeleton can be',
              'Resolve the boot tab BEFORE the load so the real loading layout can be',1)
js=js.replace('resolve differently from the skeleton already on screen. Resolved ONCE and',
              'resolve differently from the loading page already on screen. Resolved ONCE and',1)
js=js.replace('reused below, the skeleton and the rendered page cannot disagree.',
              'reused below, the loading and hydrated page cannot disagree.',1)
js=js.replace('Render the remembered destination BEFORE dissolving the skeleton. Previously',
              'Render the remembered destination into the already-mounted real page. Previously',1)
js=js.replace('successfully render before the loading surface is allowed to leave.',
              'successfully render before loading state is removed.',1)

# 4) CSS: remove overlay/mimic-specific rules while preserving production rules.
# Update the no-animation comment, which remains useful for initial render.
css=re.sub(r'/\* v2\.19\.14 -- §8\.1\..*?\*/\n\.page\.on\.rt-boot-noanim\{animation:none;\}',
'''/* Boot hydration uses the real page from the first frame. Suppress pageFade
   while that page is being hydrated; _deactivatePages removes the class before
   normal navigation, so subsequent page switches keep the standard motion. */
.page.on.rt-boot-noanim{animation:none;}''',css,flags=re.S,count=1)

cross_start=css.find('/* Boot cross-fade (v2.19.0 -- 7C)')
chart_start=css.find('/* Chart draw-in (v2.19.2 -- 7A)',cross_start)
if cross_start<0 or chart_start<0:
    raise SystemExit('Could not locate old boot CSS block')
real_css=r'''/* ========================================================================== 
   v1.4.14 — REAL-LAYOUT LOADING
   Production layout stays mounted. Only data-bearing surfaces load.
   ========================================================================== */
.rt-word-accent{color:var(--brand);}

.rt-sr-only{
  position:absolute!important;width:1px!important;height:1px!important;padding:0!important;
  margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;
  white-space:nowrap!important;border:0!important;
}
@keyframes rt-data-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.rt-real-layout-loading .rt-data-loading{
  color:transparent!important;text-shadow:none!important;border-radius:6px;min-width:2.5ch;
  background:linear-gradient(90deg,var(--surface2) 0%,var(--border) 45%,var(--surface2) 100%);
  background-size:220% 100%;animation:rt-data-shimmer 1.3s ease-in-out infinite;user-select:none;
}
.rt-real-layout-loading .kpi-value.rt-data-loading,
.rt-real-layout-loading .summary-hero-value.rt-data-loading,
.rt-real-layout-loading .metric-v.rt-data-loading,
.rt-real-layout-loading .inv-stat-v.rt-data-loading,
.rt-real-layout-loading .snap-stat-v.rt-data-loading{display:inline-block;min-width:4.5ch;}

.rt-real-layout-loading .rt-chart-loading{position:relative;overflow:hidden;}
.rt-real-layout-loading .rt-chart-loading>*{opacity:0;}
.rt-real-layout-loading .rt-chart-loading::after{
  content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:linear-gradient(90deg,transparent 0%,color-mix(in srgb,var(--border) 60%,transparent) 50%,transparent 100%);
  background-size:220% 100%;animation:rt-data-shimmer 1.4s ease-in-out infinite;
}
.rt-real-layout-loading .rt-chart-data-loading{opacity:.08!important;}

.rt-real-layout-loading .rt-list-loading{min-height:180px;position:relative;}
.rt-real-layout-loading .rt-hide-while-loading{display:none!important;}
.rt-loading-row{pointer-events:none!important;cursor:default!important;display:flex;align-items:center;gap:12px;}
.rt-loading-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;}
.rt-loading-line{display:block!important;border-radius:6px!important;}
.rt-loading-line-main{width:42%;height:11px;}
.rt-loading-line-sub{width:24%;height:9px;}
.rt-loading-line-value{width:58px;height:14px;flex:none;}

.rt-data-loading-active button:disabled,
.rt-data-loading-active input:disabled,
.rt-data-loading-active select:disabled,
.rt-data-loading-active textarea:disabled{cursor:not-allowed!important;}
.rt-data-loading-active .page.on button:disabled,
.rt-data-loading-active .page.on input:disabled,
.rt-data-loading-active .page.on select:disabled,
.rt-data-loading-active .page.on textarea:disabled{opacity:.62;}
.rt-data-loading-active #side-nav button:disabled,
.rt-data-loading-active nav#nav button:disabled,
.rt-data-loading-active #bottom-nav button:disabled,
.rt-data-loading-active #mobile-top-bar button:disabled{opacity:1;}
.rt-data-loading-active #fab-dial{pointer-events:none;}

.rt-load-error{display:flex;align-items:center;gap:12px;padding:14px 16px;margin-bottom:18px;border:1px solid color-mix(in srgb,var(--red) 50%,var(--border));background:var(--red-dim);border-radius:12px;}
.rt-load-error-icon{width:32px;height:32px;flex:none;display:grid;place-items:center;border-radius:50%;background:var(--red);color:#fff;font-weight:800;}
.rt-load-error-copy{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;}
.rt-load-error-copy strong{font-size:13px;}
.rt-load-error-message{font-size:12px;color:var(--text-secondary);}

@media(prefers-reduced-motion:reduce){
  .rt-real-layout-loading .rt-data-loading,
  .rt-real-layout-loading .rt-chart-loading::after{animation:none!important;}
}

'''
css=css[:cross_start]+real_css+css[chart_start:]

# Remove the now-unneeded monthly-only mimic rules.
css=re.sub(r'/\* v2\.19\.44 — Sales History boot skeleton.*?(?=\.rt \.summary-categories-empty)', '', css, flags=re.S, count=1)

# Remove partner selectors that existed only so fake roots could borrow ID-scoped geometry.
css=css.replace(',.rt .rt-skel-summary.page','')
css=css.replace(', .rt .rt-skel-summary.page','')
css=css.replace(',.rt .rt-skel-monthly.page','')
css=css.replace(', .rt .rt-skel-monthly.page','')

# Remove the desktop fixed-overlay offset rule + its dedicated explanatory comment.
css=re.sub(r'\n\s*/\* v2\.19\.18 -- 8\.9\. The boot overlay.*?\*/\n\s*#app-loading\{padding-left:var\(--sidebar-w\);\}\n', '\n', css, flags=re.S, count=1)

# 5) Cache-bust only the changed front-end assets; service worker is network-first.
idx=idx.replace('<link rel="stylesheet" href="./app.css">','<link rel="stylesheet" href="./app.css?v=1.4.14">',1)
idx=idx.replace('<script src="./app.js?v=1.4.13"></script>','<script src="./app.js?v=1.4.14"></script>',1)

# Assertions: old mimic implementation is gone; Stage-1 sync guard remains untouched.
for dead in ['function _sk(', 'function _skelSummary(', 'function _skelStock(', 'function _skelGeneric(',
             'function _bootSkeletonHTML(', 'function showLoadingScreen(', 'function hideLoadingScreen(',
             'let _bootFadeTimer']:
    if dead in js: raise SystemExit('Old skeleton implementation survived: '+dead)
if 'rt-skel' in css: raise SystemExit('Old rt-skel CSS survived cleanup')
if '#app-loading' in css: raise SystemExit('Old #app-loading CSS survived cleanup')
if "var VERSION='1.4.13-2026-09-02'" not in js:
    raise SystemExit('v1.4.13 stale-device sync guard was altered')
if "showRealLayoutLoading(_safeTab, 'Loading your data…');" not in js or 'finishRealLayoutLoading(_safeTab);' not in js:
    raise SystemExit('initDB was not switched to real-layout loading')
if './app.js?v=1.4.14' not in idx or './app.css?v=1.4.14' not in idx:
    raise SystemExit('Asset cache-bust failed')

JS.write_text(js,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.14 real-layout loading patch')
