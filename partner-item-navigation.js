/* RETRADE partner item navigation v1.4.64
 * Partner/account item rows are primary navigation, not popup previews.
 *
 * Flow:
 *   Partners -> partner detail -> item row -> full item page -> Back -> same partner
 *
 * Selection mode keeps its existing bulk-select behaviour. Buttons inside a row
 * (settle, edit split, relist, etc.) keep their own actions and do not navigate.
 *
 * v1.4.64: Statement is an account-navigation action beside Back to accounts.
 * The account page can already exist before this late enhancement loads and can
 * also rebuild its DOM later, so a small page-scoped observer repairs the action
 * whenever the account detail surface changes. It never watches the whole app.
 */
(function(){
  'use strict';

  var returnContext=null;
  var statementLoader=null;
  var activeAccountId=null;
  var repairObserver=null;
  var repairQueued=false;

  function accountById(id){
    try{return (_accounts||[]).find(function(a){return a&&String(a.id)===String(id);})||null;}
    catch(_){return null;}
  }

  function isInteractiveTarget(target){
    if(!target||!target.closest)return false;
    return !!target.closest('button,a,input,select,textarea,[contenteditable="true"]');
  }

  function openAccountItemPage(month,itemId,accountId){
    var acct=accountById(accountId);
    if(!acct){
      try{toast('Partner not found','error');}catch(_){}
      return;
    }

    activeAccountId=acct.id;
    returnContext={
      accountId:acct.id,
      scrollY:window.scrollY||0
    };

    try{if(typeof closeSearchDropdown==='function')closeSearchDropdown();}catch(_){}
    try{if(typeof closeMoreSheet==='function')closeMoreSheet();}catch(_){}
    try{if(typeof window._resetNavScrollState==='function')window._resetNavScrollState();}catch(_){}

    // The partner detail and item detail intentionally reuse #p-item. Swap the
    // contents in-place so there is no intermediate list page or slide-over.
    _itemPageOrigin='p-account-detail';
    window.scrollTo(0,0);
    renderItemPage(month,itemId);
    try{if(typeof _syncFabVisibility==='function')_syncFabVisibility();}catch(_){}
  }
  window.openAccountItemPage=openAccountItemPage;

  function loadPartnerStatements(done){
    if(typeof window.openPartnerStatement==='function'){
      done();
      return;
    }
    if(statementLoader){
      statementLoader.then(done).catch(function(){try{toast('Could not load partner statements','error');}catch(_){}});
      return;
    }
    statementLoader=new Promise(function(resolve,reject){
      var existing=document.getElementById('rt-partner-statements-script');
      if(existing){
        existing.addEventListener('load',resolve,{once:true});
        existing.addEventListener('error',reject,{once:true});
        return;
      }
      var script=document.createElement('script');
      script.id='rt-partner-statements-script';
      script.src='./partner-statements.js?v=1.0.0';
      script.async=true;
      script.onload=resolve;
      script.onerror=reject;
      document.head.appendChild(script);
    });
    statementLoader.then(done).catch(function(err){
      statementLoader=null;
      console.warn('[RETRADE] partner statement module failed to load',err);
      try{toast('Could not load partner statements','error');}catch(_){}
    });
  }

  function findAccountBackControl(page){
    if(!page)return null;
    var controls=page.querySelectorAll('button,a');
    var fallback=null;
    for(var i=0;i<controls.length;i++){
      var el=controls[i];
      var txt=String(el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
      var meta=(txt+' '+String(el.getAttribute('aria-label')||'')+' '+String(el.getAttribute('title')||'')).toLowerCase();
      if(txt==='back to accounts'||txt==='back to account'||txt==='back to partners'||txt==='back to partner')return el;
      if(/\bback\b/.test(meta)&&/\b(account|accounts|partner|partners)\b/.test(meta)&&!fallback)fallback=el;
    }
    return fallback;
  }

  function isAccountDetailContext(page){
    if(!page||!page.classList.contains('on'))return false;
    try{if(typeof _itemPageOrigin!=='undefined'&&_itemPageOrigin==='p-account-detail')return false;}catch(_){}
    return !!findAccountBackControl(page);
  }

  function accountNavRow(back,page){
    if(!back||!page)return null;
    var node=back.parentElement;
    var fallback=node;
    for(var depth=0;node&&node!==page&&depth<4;depth++,node=node.parentElement){
      try{
        var display=window.getComputedStyle(node).display;
        if(display==='flex'||display==='inline-flex'||display==='grid'||display==='inline-grid')return node;
      }catch(_){}
    }
    return fallback;
  }

  function accountFromRenderedPage(page){
    var known=accountById(activeAccountId);
    if(known)return known;
    if(!page)return null;

    // Prefer an explicit account id if the current renderer exposes one.
    var tagged=page.querySelector('[data-account-id],[data-accountid]');
    if(tagged){
      var taggedId=tagged.getAttribute('data-account-id')||tagged.getAttribute('data-accountid');
      var taggedAcct=accountById(taggedId);if(taggedAcct)return taggedAcct;
    }

    // Existing account rows expose item id + month. Resolve the owning account
    // from the already-hydrated DB without depending on header wording.
    var itemLink=page.querySelector('.account-group .metric-k[data-itemid][data-month]');
    if(itemLink){
      try{
        var month=itemLink.getAttribute('data-month'),itemId=itemLink.getAttribute('data-itemid');
        var items=(typeof DB!=='undefined'&&DB&&Array.isArray(DB[month]))?DB[month]:[];
        var item=items.find(function(x){return x&&String(x.id)===String(itemId);});
        if(item&&item.accountId!=null){
          var itemAcct=accountById(item.accountId);if(itemAcct)return itemAcct;
        }
      }catch(_){}
    }

    // Covers an empty account detail page that has no item rows yet.
    var heading=page.querySelector('.page-title,h1,h2,h3');
    var headingText=String(heading&&heading.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
    if(headingText){
      try{
        var matches=(_accounts||[]).filter(function(a){
          var name=String(a&&a.name||'').replace(/\s+/g,' ').trim().toLowerCase();
          return !!name&&(headingText===name||headingText.indexOf(name)!==-1);
        });
        if(matches.length===1)return matches[0];
      }catch(_){}
    }
    return null;
  }

  function wireStatementButton(acct){
    var page=document.getElementById('p-item');
    if(!page||!acct||!isAccountDetailContext(page))return;
    var back=findAccountBackControl(page);
    var row=accountNavRow(back,page);
    if(!back||!row)return;

    var old=page.querySelector('.rt-partner-statement-btn');
    if(old){
      old.dataset.accountId=acct.id;
      if(old.parentElement!==row)row.appendChild(old);
      old.style.marginLeft='auto';
      return;
    }

    var btn=document.createElement('button');
    btn.type='button';
    btn.className='btn btn-secondary rt-partner-statement-btn';
    btn.dataset.accountId=acct.id;
    btn.title='Generate partner statement';
    btn.style.cssText='font-size:12px;padding:6px 10px;white-space:nowrap;margin-left:auto;';
    btn.innerHTML='<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M4 2.5h5l3 3V13.5H4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2.5v3h3M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>Statement';
    btn.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      var accountId=btn.dataset.accountId;
      loadPartnerStatements(function(){
        if(typeof window.openPartnerStatement==='function')window.openPartnerStatement(accountId);
        else try{toast('Partner statements are unavailable','error');}catch(_){}
      });
    });
    row.appendChild(btn);
  }

  function repairStatementButton(){
    repairQueued=false;
    var page=document.getElementById('p-item');
    if(!isAccountDetailContext(page))return;
    var acct=accountFromRenderedPage(page);
    if(!acct)return;
    activeAccountId=acct.id;
    wireStatementButton(acct);
  }

  function scheduleStatementRepair(){
    if(repairQueued)return;
    repairQueued=true;
    requestAnimationFrame(repairStatementButton);
  }

  function installStatementRepairObserver(){
    var page=document.getElementById('p-item');
    if(!page||repairObserver)return;
    try{
      repairObserver=new MutationObserver(function(){scheduleStatementRepair();});
      repairObserver.observe(page,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    }catch(_){}
    scheduleStatementRepair();
  }

  function wirePartnerRows(acct){
    var page=document.getElementById('p-item');
    if(!page||!acct)return;

    page.querySelectorAll('.account-group .metric-inline').forEach(function(row){
      var title=row.querySelector('.metric-k.clickable[data-itemid][data-month]');
      if(!title)return; // selection-mode rows intentionally have no clickable title

      var month=title.dataset.month;
      var itemId=title.dataset.itemid;
      if(!month||!itemId)return;

      // Remove the old preview/job-lot inline click. The whole visual row now
      // behaves as one item-navigation target, which is both faster and clearer.
      title.removeAttribute('onclick');
      title.style.cursor='inherit';
      row.style.cursor='pointer';
      row.setAttribute('role','button');
      row.setAttribute('tabindex','0');
      row.setAttribute('aria-label','Open '+(title.textContent||'item'));

      var navigate=function(ev){
        if(ev&&isInteractiveTarget(ev.target))return;
        openAccountItemPage(month,itemId,acct.id);
      };
      row.addEventListener('click',navigate);
      row.addEventListener('keydown',function(ev){
        if(ev.key!=='Enter'&&ev.key!==' ')return;
        if(isInteractiveTarget(ev.target)&&ev.target!==row)return;
        ev.preventDefault();
        openAccountItemPage(month,itemId,acct.id);
      });
    });
  }

  if(typeof _renderAccountPage==='function'){
    var baseRenderAccountPage=_renderAccountPage;
    _renderAccountPage=function(acct){
      if(acct&&acct.id!=null)activeAccountId=acct.id;
      var result=baseRenderAccountPage.apply(this,arguments);
      try{wireStatementButton(acct);}catch(err){console.warn('[RETRADE] partner statement button failed',err);}
      try{wirePartnerRows(acct);}catch(err){console.warn('[RETRADE] partner row navigation polish failed',err);}
      scheduleStatementRepair();
      return result;
    };
  }

  if(typeof exitItemPage==='function'){
    var baseExitItemPage=exitItemPage;
    exitItemPage=function(){
      if(returnContext&&_itemPageOrigin==='p-account-detail'){
        var ctx=returnContext;
        returnContext=null;
        var acct=accountById(ctx.accountId);
        if(acct){
          activeAccountId=acct.id;
          try{if(typeof window._resetNavScrollState==='function')window._resetNavScrollState();}catch(_){}
          try{if(typeof _deactivatePages==='function')_deactivatePages();}catch(_){}
          document.querySelectorAll('.tab,.bnt').forEach(function(el){el.classList.remove('on');});
          var page=document.getElementById('p-item');
          if(page)page.classList.add('on');
          _itemPageOrigin='p-accounts';
          _renderAccountPage(acct);
          requestAnimationFrame(function(){
            requestAnimationFrame(function(){window.scrollTo(0,ctx.scrollY||0);});
          });
          try{if(typeof handleNavResize==='function')handleNavResize();}catch(_){}
          try{if(typeof _syncFabVisibility==='function')_syncFabVisibility();}catch(_){}
          return;
        }
        // Account was removed while the item was open: safely fall back to the
        // normal Partners list rather than leaving an invalid synthetic origin.
        _itemPageOrigin='p-accounts';
      }
      return baseExitItemPage.apply(this,arguments);
    };
  }

  installStatementRepairObserver();
  console.info('[RETRADE] v1.4.64 partner item navigation + persistent statements loaded');
})();
