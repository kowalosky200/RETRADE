/* RETRADE partner item navigation v1.4.61
 * Partner/account item rows are primary navigation, not popup previews.
 *
 * Flow:
 *   Partners -> partner detail -> item row -> full item page -> Back -> same partner
 *
 * Selection mode keeps its existing bulk-select behaviour. Buttons inside a row
 * (settle, edit split, relist, etc.) keep their own actions and do not navigate.
 *
 * v1.4.61: adds the account-header Statement action. The statement/export module
 * is loaded only when requested so normal launch and non-partner pages stay lean.
 */
(function(){
  'use strict';

  var returnContext=null;
  var statementLoader=null;

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

  function wireStatementButton(acct){
    var page=document.getElementById('p-item');
    if(!page||!acct)return;
    var header=page.querySelector('.page-header');
    if(!header)return;
    var actions=header.lastElementChild;
    if(!actions)return;

    var old=actions.querySelector('.rt-partner-statement-btn');
    if(old){old.dataset.accountId=acct.id;return;}

    var btn=document.createElement('button');
    btn.type='button';
    btn.className='btn btn-secondary rt-partner-statement-btn';
    btn.dataset.accountId=acct.id;
    btn.title='Generate partner statement';
    btn.style.cssText='font-size:12px;padding:6px 10px;white-space:nowrap;';
    btn.innerHTML='<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><path d="M4 2.5h5l3 3V13.5H4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M9 2.5v3h3M6 8h4M6 10.5h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>Statement';
    btn.addEventListener('click',function(ev){
      ev.preventDefault();ev.stopPropagation();
      var accountId=btn.dataset.accountId;
      loadPartnerStatements(function(){
        if(typeof window.openPartnerStatement==='function')window.openPartnerStatement(accountId);
        else try{toast('Partner statements are unavailable','error');}catch(_){}
      });
    });
    actions.insertBefore(btn,actions.firstChild);
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
      var result=baseRenderAccountPage.apply(this,arguments);
      try{wireStatementButton(acct);}catch(err){console.warn('[RETRADE] partner statement button failed',err);}
      try{wirePartnerRows(acct);}catch(err){console.warn('[RETRADE] partner row navigation polish failed',err);}
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

  console.info('[RETRADE] v1.4.61 partner item navigation + statements loaded');
})();
