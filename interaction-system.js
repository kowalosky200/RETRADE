/* RETRADE interaction system v1.4.67
 *
 * One gesture language across touch surfaces:
 * - item rows: swipe left = Delete, swipe right = lifecycle-primary action
 * - other actionable rows: swipe right = primary/open; swipe left = destructive action when one exists
 * - press and hold = contextual action sheet using the same canonical app actions
 * - edge-origin swipe right = back/dismiss for nested pages and panels
 *
 * Gestures are additive input methods only. Existing buttons/menus remain the
 * authoritative accessible alternatives. Vertical scrolling always wins when
 * direction is ambiguous. No accounting, lifecycle rules, persistence or sync
 * semantics are duplicated here.
 */
(function(){
  'use strict';

  var ROW_SELECTOR=[
    '.item-row',
    '.run-history-row',
    '.ar-item-row',
    '.activity-row',
    '.act-row',
    '.job-lot-row',
    '.settlement-row',
    '.run-row',
    '.mcard',
    '.cost-cat-card'
  ].join(',');
  var INTERACTIVE='button,input,select,textarea,a,[contenteditable="true"],[role="button"],.ddmenu,.rt-swipe-actions';
  var AXIS_LOCK=9;
  var HOLD_MS=430;
  var HOLD_SLOP=8;
  var REVEAL_PX=76;
  var FULL_COMMIT_PX=136;
  var EDGE_PX=34;
  var BACK_COMMIT_PX=82;
  var MAX_DRAG=118;
  var EASE='cubic-bezier(.22,.61,.36,1)';

  var gesture=null;
  var openRow=null;
  var holdTimer=0;
  var suppressClickUntil=0;
  var allowSyntheticClick=false;
  var contextOpen=false;
  var backIndicator=null;

  function reducedMotion(){
    try{return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}catch(_){return false;}
  }
  function now(){return (window.performance&&performance.now)?performance.now():Date.now();}
  function visible(el){
    if(!el||!el.isConnected)return false;
    var r;try{r=el.getBoundingClientRect();}catch(_){return false;}
    var cs;try{cs=getComputedStyle(el);}catch(_){cs=null;}
    return !!(r.width&&r.height&&(!cs||cs.display!=='none')&&(!cs||cs.visibility!=='hidden'));
  }
  function cleanText(s){return String(s||'').replace(/\s+/g,' ').trim();}
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function pointerIsTouch(e){return e.pointerType==='touch'||e.pointerType==='pen';}
  function iconHtml(name){
    try{if(typeof icon==='function')return icon(name,18);}catch(_){}
    if(name==='trash')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 3h6l1 4H8l1-4Zm-2 4 1 14h8l1-14"/></svg>';
    if(name==='back')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 18-6-6 6-6"/></svg>';
    if(name==='sold')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12 12 20 4 12V4h8l8 8Z"/><circle cx="9" cy="9" r="1"/></svg>';
    if(name==='relist')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15m0 5v-5h5"/></svg>';
    if(name==='return')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 14-4-4 4-4M5 10h9a5 5 0 0 1 5 5v3"/></svg>';
    if(name==='list')return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
    return '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m9 18 6-6-6-6"/></svg>';
  }

  function installStyles(){
    var old=document.getElementById('rt-interaction-system-css');if(old)old.remove();
    var s=document.createElement('style');s.id='rt-interaction-system-css';
    s.textContent='\
'+ROW_SELECTOR+'{touch-action:pan-y pinch-zoom;-webkit-tap-highlight-color:transparent}\
.rt-gesture-row{position:relative!important;overflow:hidden!important;--rt-swipe-x:0px}\
.rt-gesture-row.rt-swipe-dragging>*:not(.rt-swipe-actions){transition:none!important}\
.rt-gesture-row>*:not(.rt-swipe-actions){translate:var(--rt-swipe-x) 0;transition:translate 185ms '+EASE+';will-change:translate}\
.rt-swipe-actions{position:absolute;inset:0;z-index:8;pointer-events:none;border-radius:inherit;overflow:hidden}\
.rt-swipe-action{position:absolute;top:0;bottom:0;width:82px;border:0;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;font:700 11px/1.1 var(--font-body);letter-spacing:.01em;opacity:0;pointer-events:none;transition:opacity 90ms ease-out,filter 110ms ease-out;user-select:none;-webkit-user-select:none}\
.rt-swipe-action svg{flex:none}\
.rt-swipe-action.leading{left:0;background:var(--accent);color:#111}\
.rt-swipe-action.trailing{right:0;background:var(--red);color:#fff}\
.rt-gesture-row.rt-swipe-open-leading .rt-swipe-action.leading,.rt-gesture-row.rt-swipe-open-trailing .rt-swipe-action.trailing{opacity:1;pointer-events:auto}\
.rt-gesture-row.rt-swipe-committing .rt-swipe-action{filter:brightness(1.08)}\
#rt-gesture-context-backdrop{position:fixed;inset:0;z-index:11990;background:rgba(7,10,16,.34);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);opacity:0;pointer-events:none;transition:opacity 140ms ease-out}\
#rt-gesture-context-backdrop.on{opacity:1;pointer-events:auto}\
#rt-gesture-context{position:fixed;z-index:12000;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom,0px));max-width:520px;margin:0 auto;padding:7px;background:color-mix(in srgb,var(--surface) 96%,transparent);border:1px solid var(--border);border-radius:18px;box-shadow:0 18px 54px rgba(0,0,0,.28);transform:translate3d(0,18px,0) scale(.985);opacity:0;pointer-events:none;transition:transform 185ms '+EASE+',opacity 130ms ease-out}\
#rt-gesture-context.on{transform:translate3d(0,0,0) scale(1);opacity:1;pointer-events:auto}\
.rt-context-handle{width:34px;height:4px;border-radius:3px;background:var(--border2);margin:2px auto 7px;opacity:.8}\
.rt-context-title{padding:6px 11px 8px;font-size:12px;font-weight:700;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\
.rt-context-action{width:100%;min-height:46px;padding:10px 12px;border:0;border-radius:11px;background:transparent;color:var(--text);display:flex;align-items:center;gap:11px;text-align:left;font:650 13px/1.2 var(--font-body);cursor:pointer}\
.rt-context-action:active{background:var(--surface2)}\
.rt-context-action.destructive{color:var(--red)}\
.rt-context-action+.rt-context-action{border-top:1px solid color-mix(in srgb,var(--border) 68%,transparent)}\
#rt-edge-back-indicator{position:fixed;left:8px;top:50%;z-index:11800;width:38px;height:38px;margin-top:-19px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--surface) 92%,transparent);border:1px solid var(--border);box-shadow:0 6px 24px rgba(0,0,0,.18);color:var(--text);opacity:0;translate:-12px 0;scale:.9;pointer-events:none;transition:opacity 100ms ease-out,translate 100ms ease-out,scale 100ms ease-out}\
#rt-edge-back-indicator.on{opacity:1;translate:0 0;scale:1}\
.rt-back-dragging{transition:none!important;will-change:translate,opacity}\
.rt-back-settling{transition:translate 170ms '+EASE+',opacity 140ms ease-out!important}\
@media(min-width:760px){#rt-gesture-context{left:50%;right:auto;bottom:auto;top:50%;width:min(420px,calc(100vw - 40px));margin:0;transform:translate3d(-50%,-46%,0) scale(.985)}#rt-gesture-context.on{transform:translate3d(-50%,-50%,0) scale(1)}}\
@media(prefers-reduced-motion:reduce){.rt-gesture-row>*:not(.rt-swipe-actions),#rt-gesture-context,#rt-gesture-context-backdrop,#rt-edge-back-indicator,.rt-back-settling{transition:none!important}}';
    document.head.appendChild(s);
  }
  installStyles();

  function rowFromTarget(target){
    if(!target||!target.closest)return null;
    var row=target.closest(ROW_SELECTOR);
    if(!row)return null;
    if(target.closest(INTERACTIVE)&&!target.closest('.item-row-name,.item-name'))return null;
    return row;
  }

  function parseItemIdentity(row){
    if(!row||!row.classList.contains('item-row'))return null;
    var id='',month='';
    var dd=row.querySelector('.ddwrap[id^="dd-"],[id^="dd-"]');
    if(dd&&dd.id.indexOf('dd-')===0)id=dd.id.slice(3);
    var code=String(row.getAttribute('onclick')||'');
    var m=code.match(/openItemPage\(['\"]([^'\"]+)['\"],['\"]([^'\"]+)['\"]/);
    if(m){month=m[1];if(!id)id=m[2];}
    var rec=null;
    try{if(id&&typeof _findItemRecordById==='function')rec=_findItemRecordById(id);}catch(_){}
    if(rec){month=rec.month||month;return {id:id,month:month,item:rec.item,row:row};}
    if(id&&month){
      var item=null;try{item=(DB[month]||[]).find(function(x){return x.id===id;})||null;}catch(_){}
      return {id:id,month:month,item:item,row:row};
    }
    return null;
  }

  function invokeSynthetic(el){
    if(!el)return;
    allowSyntheticClick=true;
    try{el.click();}catch(_){}
    setTimeout(function(){allowSyntheticClick=false;},0);
  }
  function itemState(info){
    if(!info||!info.item)return '';
    try{if(typeof _itemLifecycleState==='function')return _itemLifecycleState(info.item);}catch(_){}
    var i=info.item;
    if(i.isReturned)return 'returned';
    if(i.dateSold||i.resaleSalePrice)return 'sold';
    return i.state==='sourced'?'sourced':'listed';
  }
  function primaryItemAction(info){
    if(!info||!info.item)return null;
    var state=itemState(info),m=info.month,id=info.id;
    if(state==='sourced'&&typeof openListFromSourced==='function')return {label:'List Item',icon:'list',tone:'accent',run:function(){openListFromSourced(m,id);}};
    if(state==='listed'&&typeof markSold==='function')return {label:'Mark Sold',icon:'sold',tone:'accent',run:function(){markSold(m,id);}};
    if(state==='sold'&&typeof openReturn==='function')return {label:'Log Return',icon:'return',tone:'accent',run:function(){openReturn(m,id);}};
    if(state==='returned'&&typeof openRelist==='function')return {label:'Relist',icon:'relist',tone:'accent',run:function(){openRelist(m,id);}};
    return null;
  }
  function deleteItemAction(info){
    if(!info||!info.id||typeof deleteItem!=='function')return null;
    return {label:'Delete',icon:'trash',destructive:true,run:function(){deleteItem(info.month,info.id);}};
  }
  function openItemAction(info){
    if(!info||!info.id||typeof openItemPage!=='function')return null;
    return {label:'Open Details',icon:'open',run:function(){var p=document.querySelector('.page.on');openItemPage(info.month,info.id,p?p.id:'p-stock');}};
  }

  function genericRowPrimary(row){
    if(!row)return null;
    var b=Array.prototype.find.call(row.querySelectorAll('.btn-primary,button.primary'),function(el){return visible(el)&&!el.disabled;});
    if(b)return {label:cleanText(b.textContent)||'Open',icon:'open',run:function(){invokeSynthetic(b);}};
    if(row.getAttribute('onclick')||typeof row.onclick==='function')return {label:'Open',icon:'open',run:function(){invokeSynthetic(row);}};
    return null;
  }
  function genericRowDanger(row){
    if(!row)return null;
    var b=Array.prototype.find.call(row.querySelectorAll('button.danger,.btn-danger,.btn-destructive,[data-action="delete"]'),function(el){return !el.disabled;});
    if(!b)return null;
    return {label:cleanText(b.textContent)||'Delete',icon:'trash',destructive:true,run:function(){invokeSynthetic(b);}};
  }
  function swipeActionsForRow(row){
    var info=parseItemIdentity(row);
    if(info)return {leading:primaryItemAction(info),trailing:deleteItemAction(info),info:info};
    return {leading:genericRowPrimary(row),trailing:genericRowDanger(row),info:null};
  }

  function ensureRails(row,actions){
    if(!row)return null;
    row.classList.add('rt-gesture-row');
    var layer=row.querySelector(':scope > .rt-swipe-actions');
    if(!layer){layer=document.createElement('div');layer.className='rt-swipe-actions';row.appendChild(layer);}
    layer.innerHTML='';
    var out={layer:layer,leading:null,trailing:null};
    function add(action,side){
      if(!action)return null;
      var b=document.createElement('button');b.type='button';b.className='rt-swipe-action '+side+(action.destructive?' destructive':'');
      b.innerHTML=iconHtml(action.icon)+(action.label?'<span>'+action.label+'</span>':'');
      b.setAttribute('aria-label',action.label||'Action');
      b.addEventListener('click',function(e){e.stopPropagation();closeRow(row,true);setTimeout(function(){action.run();},20);});
      layer.appendChild(b);return b;
    }
    out.leading=add(actions.leading,'leading');out.trailing=add(actions.trailing,'trailing');
    return out;
  }

  function setRowOffset(row,x,rails){
    if(!row)return;
    row.style.setProperty('--rt-swipe-x',x.toFixed(1)+'px');
    if(rails&&rails.leading)rails.leading.style.opacity=String(clamp(x/REVEAL_PX,0,1));
    if(rails&&rails.trailing)rails.trailing.style.opacity=String(clamp((-x)/REVEAL_PX,0,1));
  }
  function closeRow(row,immediate){
    if(!row)return;
    row.classList.remove('rt-swipe-dragging','rt-swipe-open-leading','rt-swipe-open-trailing','rt-swipe-committing');
    if(immediate||reducedMotion()){
      row.style.setProperty('--rt-swipe-x','0px');
    }else{
      requestAnimationFrame(function(){row.style.setProperty('--rt-swipe-x','0px');});
    }
    var layer=row.querySelector(':scope > .rt-swipe-actions');
    if(layer)Array.prototype.forEach.call(layer.children,function(b){b.style.opacity='0';b.style.pointerEvents='none';});
    if(openRow===row)openRow=null;
  }
  function openRowAt(row,dir,rails){
    if(openRow&&openRow!==row)closeRow(openRow,false);
    openRow=row;
    row.classList.remove('rt-swipe-dragging','rt-swipe-open-leading','rt-swipe-open-trailing');
    var x=dir==='leading'?REVEAL_PX:-REVEAL_PX;
    row.classList.add(dir==='leading'?'rt-swipe-open-leading':'rt-swipe-open-trailing');
    setRowOffset(row,x,rails);
    var b=rails&&(dir==='leading'?rails.leading:rails.trailing);if(b){b.style.opacity='1';b.style.pointerEvents='auto';}
  }
  function commitSwipe(row,action,dir,rails){
    if(!action)return closeRow(row,false);
    suppressClickUntil=Date.now()+500;
    row.classList.remove('rt-swipe-dragging');row.classList.add('rt-swipe-committing');
    var x=dir==='leading'?96:-96;setRowOffset(row,x,rails);
    setTimeout(function(){closeRow(row,true);try{action.run();}catch(e){console.warn('[RETRADE] gesture action failed',e);}},reducedMotion()?0:90);
  }

  function contextActionsForRow(row){
    var info=parseItemIdentity(row),out=[];
    if(info){
      var open=openItemAction(info),primary=primaryItemAction(info);
      if(open)out.push(open);if(primary)out.push(primary);
      if(typeof editItem==='function')out.push({label:'Edit',icon:'open',run:function(){editItem(info.month,info.id);}});
      if(itemState(info)==='returned'&&typeof moveReturnedToUnlisted==='function')out.push({label:'Move to Unlisted',icon:'return',run:function(){moveReturnedToUnlisted(info.month,info.id);}});
      if(typeof confirmDupeItem==='function')out.push({label:'Duplicate',icon:'open',run:function(){confirmDupeItem(info.month,info.id);}});
      var del=deleteItemAction(info);if(del)out.push(del);
      return {title:(info.item&&info.item.item)||'Item actions',actions:out.slice(0,6)};
    }
    var primaryGeneric=genericRowPrimary(row);if(primaryGeneric)out.push(primaryGeneric);
    var buttons=Array.prototype.slice.call(row.querySelectorAll('button')).filter(function(b){return visible(b)&&!b.disabled&&!b.closest('.rt-swipe-actions')&&!b.classList.contains('ddbtn');});
    buttons.forEach(function(b){
      var label=cleanText(b.textContent);if(!label||out.some(function(a){return a.label===label;}))return;
      out.push({label:label,icon:b.classList.contains('danger')?'trash':'open',destructive:b.classList.contains('danger')||b.classList.contains('btn-destructive'),run:function(){invokeSynthetic(b);}});
    });
    var danger=genericRowDanger(row);if(danger&&!out.some(function(a){return a.destructive;}))out.push(danger);
    return {title:'Actions',actions:out.slice(0,6)};
  }

  function ensureContextUI(){
    var backdrop=document.getElementById('rt-gesture-context-backdrop'),sheet=document.getElementById('rt-gesture-context');
    if(!backdrop){backdrop=document.createElement('div');backdrop.id='rt-gesture-context-backdrop';document.body.appendChild(backdrop);backdrop.addEventListener('click',closeContext);}
    if(!sheet){sheet=document.createElement('div');sheet.id='rt-gesture-context';sheet.setAttribute('role','menu');sheet.setAttribute('aria-modal','true');document.body.appendChild(sheet);}
    return {backdrop:backdrop,sheet:sheet};
  }
  function closeContext(){
    var ui=ensureContextUI();contextOpen=false;ui.backdrop.classList.remove('on');ui.sheet.classList.remove('on');ui.sheet.setAttribute('aria-hidden','true');
  }
  function openContext(row){
    var model=contextActionsForRow(row);if(!model.actions.length)return;
    if(openRow)closeRow(openRow,true);
    var ui=ensureContextUI();contextOpen=true;suppressClickUntil=Date.now()+650;
    ui.sheet.innerHTML='<div class="rt-context-handle" aria-hidden="true"></div><div class="rt-context-title">'+escapeHtml(model.title)+'</div>';
    model.actions.forEach(function(action){
      var b=document.createElement('button');b.type='button';b.className='rt-context-action'+(action.destructive?' destructive':'');b.setAttribute('role','menuitem');
      b.innerHTML=iconHtml(action.icon)+(action.label?'<span>'+escapeHtml(action.label)+'</span>':'');
      b.addEventListener('click',function(){closeContext();setTimeout(function(){action.run();},20);});ui.sheet.appendChild(b);
    });
    ui.sheet.setAttribute('aria-hidden','false');requestAnimationFrame(function(){ui.backdrop.classList.add('on');ui.sheet.classList.add('on');var first=ui.sheet.querySelector('button');if(first)first.focus({preventScroll:true});});
    try{if(navigator.vibrate)navigator.vibrate(8);}catch(_){}
  }
  function escapeHtml(s){
    var d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;
  }

  function findBackTarget(){
    if(contextOpen)return {surface:null,run:closeContext};
    var sheet=document.getElementById('more-sheet');
    if(sheet&&sheet._msOpen&&typeof closeMoreSheet==='function')return {surface:sheet,run:function(){closeMoreSheet();}};
    var panel=document.getElementById('slide-panel');
    if(panel&&panel.classList.contains('on')&&typeof closePanel==='function')return {surface:panel,run:function(){closePanel();}};
    var page=document.querySelector('.page.on');if(!page)return null;
    var btns=page.querySelectorAll('.ip-back,button[onclick*="exitItemPage"],button[onclick*="backToMonthlyGrid"],button[onclick*="backToAccountsList"],button[onclick*="backTo"],button[aria-label^="Back" i]');
    var btn=Array.prototype.find.call(btns,function(b){return visible(b)&&!b.disabled;});
    if(btn)return {surface:page,run:function(){invokeSynthetic(btn);}};
    try{if(page.id==='p-monthly'&&typeof MONTHLY_VIEW!=='undefined'&&MONTHLY_VIEW==='detail'&&typeof backToMonthlyGrid==='function')return {surface:page,run:function(){backToMonthlyGrid();}};}catch(_){}
    try{if(page.id==='p-item'&&typeof exitItemPage==='function')return {surface:page,run:function(){exitItemPage();}};}catch(_){}
    return null;
  }
  function ensureBackIndicator(){
    if(backIndicator&&backIndicator.isConnected)return backIndicator;
    backIndicator=document.createElement('div');backIndicator.id='rt-edge-back-indicator';backIndicator.innerHTML=iconHtml('back');document.body.appendChild(backIndicator);return backIndicator;
  }
  function updateBackVisual(state,dx){
    var ind=ensureBackIndicator(),p=clamp(dx/BACK_COMMIT_PX,0,1);ind.classList.toggle('on',dx>4);ind.style.opacity=String(.2+.8*p);ind.style.scale=String(.88+.12*p);
    if(state.surface&&state.surface.classList&&state.surface.classList.contains('page')){
      state.surface.classList.add('rt-back-dragging');state.surface.style.translate=(Math.min(112,dx*.58)).toFixed(1)+'px 0';state.surface.style.opacity=String(1-.08*p);
    }
  }
  function resetBackVisual(state,commit){
    var ind=ensureBackIndicator();ind.classList.remove('on');ind.style.removeProperty('opacity');ind.style.removeProperty('scale');
    if(!state||!state.surface||!state.surface.classList||!state.surface.classList.contains('page'))return;
    var surface=state.surface;surface.classList.remove('rt-back-dragging');surface.classList.add('rt-back-settling');
    if(commit&&!reducedMotion()){surface.style.translate=Math.min(window.innerWidth*.22,120)+'px 0';surface.style.opacity='.92';}
    else{surface.style.translate='0px 0';surface.style.opacity='1';}
    setTimeout(function(){surface.classList.remove('rt-back-settling');surface.style.removeProperty('translate');surface.style.removeProperty('opacity');},reducedMotion()?0:190);
  }

  function clearHold(){if(holdTimer){clearTimeout(holdTimer);holdTimer=0;}}
  function cancelGesture(){
    clearHold();
    if(gesture&&gesture.kind==='row'&&gesture.row){gesture.row.classList.remove('rt-swipe-dragging');if(!gesture.keptOpen)closeRow(gesture.row,false);}
    if(gesture&&gesture.kind==='back')resetBackVisual(gesture.back,false);
    gesture=null;
  }

  function beginRowGesture(e,row){
    var actions=swipeActionsForRow(row);if(!actions.leading&&!actions.trailing&&!row.classList.contains('item-row'))return;
    if(openRow&&openRow!==row)closeRow(openRow,false);
    var rails=ensureRails(row,actions);
    gesture={kind:'row',id:e.pointerId,row:row,actions:actions,rails:rails,x0:e.clientX,y0:e.clientY,t0:now(),lastX:e.clientX,lastT:now(),mode:'pending',held:false,keptOpen:false};
    clearHold();holdTimer=setTimeout(function(){
      if(!gesture||gesture.kind!=='row'||gesture.mode!=='pending')return;
      gesture.held=true;openContext(row);
    },HOLD_MS);
  }
  function beginBackGesture(e,back){
    gesture={kind:'back',id:e.pointerId,x0:e.clientX,y0:e.clientY,t0:now(),lastX:e.clientX,lastT:now(),mode:'pending',back:back};
  }

  document.addEventListener('pointerdown',function(e){
    if(!pointerIsTouch(e)||e.isPrimary===false)return;
    if(contextOpen)return;
    var back=findBackTarget();
    if(back&&e.clientX<=EDGE_PX){beginBackGesture(e,back);return;}
    var row=rowFromTarget(e.target);if(row)beginRowGesture(e,row);
  },true);

  document.addEventListener('pointermove',function(e){
    if(!gesture||e.pointerId!==gesture.id)return;
    var dx=e.clientX-gesture.x0,dy=e.clientY-gesture.y0,ax=Math.abs(dx),ay=Math.abs(dy);
    if(gesture.kind==='row'){
      if(gesture.held)return;
      if(gesture.mode==='pending'){
        if(ax<HOLD_SLOP&&ay<HOLD_SLOP)return;
        clearHold();
        if(ay>ax*1.12){gesture=null;return;}
        if(ax>ay*1.12&&ax>=AXIS_LOCK){gesture.mode='swipe';gesture.row.classList.add('rt-swipe-dragging');try{gesture.row.setPointerCapture(e.pointerId);}catch(_){} }
        else return;
      }
      if(gesture.mode!=='swipe')return;
      if(e.cancelable)e.preventDefault();
      if(dx>0&&!gesture.actions.leading)dx=0;if(dx<0&&!gesture.actions.trailing)dx=0;
      var abs=Math.abs(dx),resisted=abs>REVEAL_PX?REVEAL_PX+(abs-REVEAL_PX)*.38:abs;dx=(dx<0?-1:1)*Math.min(MAX_DRAG,resisted);
      setRowOffset(gesture.row,dx,gesture.rails);
      gesture.lastX=e.clientX;gesture.lastT=now();
      return;
    }
    if(gesture.kind==='back'){
      if(gesture.mode==='pending'){
        if(ax<AXIS_LOCK&&ay<AXIS_LOCK)return;
        if(dy!==0&&ay>ax*1.08){gesture=null;return;}
        if(dx>0&&ax>ay*1.08){gesture.mode='swipe';}
        else if(dx<=0){gesture=null;return;}else return;
      }
      if(gesture.mode==='swipe'){
        if(e.cancelable)e.preventDefault();dx=Math.max(0,dx);updateBackVisual(gesture.back,dx);gesture.lastX=e.clientX;gesture.lastT=now();
      }
    }
  },{capture:true,passive:false});

  document.addEventListener('pointerup',function(e){
    if(!gesture||e.pointerId!==gesture.id)return;
    clearHold();var g=gesture;gesture=null;
    if(g.kind==='row'){
      if(g.held){suppressClickUntil=Date.now()+650;return;}
      if(g.mode!=='swipe'){closeRow(g.row,false);return;}
      var dx=e.clientX-g.x0,elapsed=Math.max(1,now()-g.t0),velocity=dx/elapsed,abs=Math.abs(dx),dir=dx>0?'leading':'trailing',action=dir==='leading'?g.actions.leading:g.actions.trailing;
      g.row.classList.remove('rt-swipe-dragging');suppressClickUntil=Date.now()+420;
      if(action&&(abs>=FULL_COMMIT_PX||(abs>=92&&Math.abs(velocity)>.72))){commitSwipe(g.row,action,dir,g.rails);return;}
      if(action&&abs>=52){g.keptOpen=true;openRowAt(g.row,dir,g.rails);return;}
      closeRow(g.row,false);return;
    }
    if(g.kind==='back'){
      if(g.mode!=='swipe'){resetBackVisual(g.back,false);return;}
      var bdx=Math.max(0,e.clientX-g.x0),belapsed=Math.max(1,now()-g.t0),bvel=bdx/belapsed,commit=bdx>=BACK_COMMIT_PX||(bdx>=48&&bvel>.68);
      suppressClickUntil=Date.now()+350;resetBackVisual(g.back,commit);
      if(commit)setTimeout(function(){try{g.back.run();}catch(err){console.warn('[RETRADE] back gesture failed',err);}},reducedMotion()?0:105);
    }
  },true);

  document.addEventListener('pointercancel',cancelGesture,true);

  document.addEventListener('click',function(e){
    if(allowSyntheticClick)return;
    if(Date.now()<suppressClickUntil&&e.target.closest&&e.target.closest(ROW_SELECTOR)){e.preventDefault();e.stopImmediatePropagation();return;}
    if(openRow&&!e.target.closest('.rt-gesture-row'))closeRow(openRow,false);
  },true);

  document.addEventListener('contextmenu',function(e){
    var row=e.target.closest&&e.target.closest(ROW_SELECTOR);if(!row)return;
    var model=contextActionsForRow(row);if(!model.actions.length)return;
    e.preventDefault();openContext(row);
  },true);

  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&contextOpen){e.preventDefault();closeContext();return;}
    if((e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))&&document.activeElement&&document.activeElement.closest){
      var row=document.activeElement.closest(ROW_SELECTOR);if(row){e.preventDefault();openContext(row);}
    }
  },true);

  window.addEventListener('scroll',function(){if(openRow&&!gesture)closeRow(openRow,false);},{capture:true,passive:true});

  window.__rtInteractionSystem={
    version:'1.4.67',
    closeOpenRow:function(){if(openRow)closeRow(openRow,false);},
    closeContext:closeContext,
    openContextForRow:openContext
  };
})();
