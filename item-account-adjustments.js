/*
 * RETRADE item adjustments + per-item partner terms
 * 2026-09-11
 *
 * Keeps the existing data model intact:
 * - item.parts[].cost > 0  => expense / cash out / adds to cost basis
 * - item.parts[].cost < 0  => purchase refund / credit / cash in / reduces cost basis
 * - accountSplitPercent    => partner percentage for this item
 * - accountPaidAmount      => fixed partner amount / supplier amount override
 */
(function(){
  'use strict';

  if(window.__rtItemAccountAdjustmentsLoaded)return;
  window.__rtItemAccountAdjustmentsLoaded=true;

  function moneyAbs(n){
    n=Math.abs(Number(n)||0);
    try{return typeof fmt==='function'?fmt(n):('£'+n.toFixed(2));}
    catch(_){return '£'+n.toFixed(2);}
  }
  function html(s){
    try{return typeof esc==='function'?esc(String(s==null?'':s)):String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});}
    catch(_){return String(s==null?'':s);}
  }
  function today(){return new Date().toISOString().slice(0,10);}
  function partId(){
    try{if(typeof uid==='function')return uid();}catch(_){}
    try{if(window.crypto&&typeof window.crypto.randomUUID==='function')return window.crypto.randomUUID();}catch(_){}
    return 'part_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
  }
  function findItem(m,id){
    try{return (DB[m]||[]).find(function(x){return x&&x.id===id;})||null;}catch(_){return null;}
  }
  function refreshPartsContext(m,id,context){
    try{_sourcedPartsCost=calcPartsCost(findItem(m,id)||{});}catch(_){}
    if(context==='page'){
      try{if(typeof renderItemPage==='function')renderItemPage(m,id);else if(typeof _renderStockItemPage==='function')_renderStockItemPage(m,findItem(m,id));}catch(_){}
      return;
    }
    if(context==='list-form'){
      try{if(typeof _refreshListFormParts==='function')_refreshListFormParts(m,id);}catch(_){}
      return;
    }
    try{if(typeof refreshPanelParts==='function')refreshPanelParts(m,id);}catch(_){}
  }

  /* ---------------------------------------------------------------------- */
  /* Item adjustments: explicit Expense vs Refund / Credit                  */
  /* ---------------------------------------------------------------------- */
  function injectStyles(){
    if(document.getElementById('rt-item-adjustment-styles'))return;
    var s=document.createElement('style');
    s.id='rt-item-adjustment-styles';
    s.textContent=[
      '.rt-adjust-kind{display:flex;gap:4px;padding:3px;border:1px solid var(--border);background:var(--surface2);border-radius:9px;margin:0 0 9px;max-width:310px}',
      '.rt-adjust-kind button{flex:1;border:0;background:transparent;color:var(--text-secondary);border-radius:7px;padding:7px 9px;font:600 11.5px var(--font-body);cursor:pointer}',
      '.rt-adjust-kind button.on{background:var(--surface);color:var(--text);box-shadow:0 1px 3px var(--shadow)}',
      '.rt-adjust-kind button[data-kind="refund"].on{color:var(--green)}',
      '.rt-adjust-hint{font-size:10.5px;color:var(--text-secondary);margin:-3px 0 8px;line-height:1.35}',
      '.rt-part-type{font-size:9.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-tertiary);white-space:nowrap}',
      '.rt-part-refund .part-cost{color:var(--green)!important}',
      '.rt-net-adjustment{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;font-weight:700;padding-top:8px;border-top:1px solid var(--border);margin-top:6px}',
      '.rt-partner-terms{margin-top:10px;padding:11px 12px;border:1px solid var(--border);background:var(--surface2);border-radius:10px}',
      '.rt-partner-terms-title{font-size:11px;font-weight:700;color:var(--text);margin-bottom:8px}',
      '.rt-partner-mode{display:flex;gap:4px;padding:3px;border:1px solid var(--border);background:var(--surface);border-radius:9px;margin-bottom:9px}',
      '.rt-partner-mode button{flex:1;border:0;background:transparent;color:var(--text-secondary);border-radius:7px;padding:7px 8px;font:600 11px var(--font-body);cursor:pointer}',
      '.rt-partner-mode button.on{background:var(--accent-dim);color:var(--accent)}',
      '.rt-partner-term-hint{font-size:10.5px;color:var(--text-secondary);margin-top:5px;line-height:1.35}',
      '.rt-partner-term-row{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}',
      '.rt-partner-term-row input{width:100%}',
      '@media(max-width:430px){.rt-adjust-kind{max-width:none;width:100%}.rt-partner-terms{padding:10px}.rt-partner-mode button{padding:7px 5px;font-size:10.5px}}'
    ].join('\n');
    document.head.appendChild(s);
  }
  injectStyles();

  window.rtSetPartKind=function(context,kind){
    kind=kind==='refund'?'refund':'expense';
    var hidden=document.getElementById('part-kind-'+context);
    if(hidden)hidden.value=kind;
    document.querySelectorAll('[data-rt-part-kind-context="'+CSS.escape(context)+'"]').forEach(function(btn){
      btn.classList.toggle('on',btn.getAttribute('data-kind')===kind);
      btn.setAttribute('aria-pressed',btn.getAttribute('data-kind')===kind?'true':'false');
    });
    var hint=document.getElementById('part-kind-hint-'+context);
    if(hint)hint.textContent=kind==='refund'
      ? 'Refund / credit records cash back from a seller or marketplace and reduces this item’s cost basis.'
      : 'Expense records extra spend on this item and increases its cost basis.';
  };

  var originalPartsHTML=(typeof partsHTML==='function')?partsHTML:null;
  if(originalPartsHTML){
    partsHTML=function(m,id,context){
      context=context||'panel';
      var i=findItem(m,id);
      if(!i)return '';
      var parts=Array.isArray(i.parts)?i.parts:[];
      var total=(typeof calcPartsCost==='function')?Number(calcPartsCost(i)||0):parts.reduce(function(s,p){return s+(Number(p&&p.cost)||0);},0);
      var rows=parts.map(function(p,idx){
        p=p||{};
        var amount=Number(p.cost)||0;
        var isRefund=amount<0;
        var desc=p.description||p.desc||p.name||'Adjustment';
        var editFn='editPart(\''+m+'\',\''+id+'\','+idx+',\''+context+'\')';
        var delFn=context==='page'
          ?'deletePart(\''+m+'\',\''+id+'\','+idx+')'
          :'deletePart(\''+m+'\',\''+id+'\','+idx+',\''+context+'\')';
        return '<div class="part-row '+(isRefund?'rt-part-refund':'')+'" style="cursor:pointer;" onclick="'+editFn+'" title="Tap to edit">'
          +'<span class="part-desc">'+html(desc)+'</span>'
          +(p.date?'<span class="part-date">'+html(p.date)+'</span>':'')
          +'<span class="rt-part-type">'+(isRefund?'Refund':'Expense')+'</span>'
          +'<span class="part-cost" style="color:'+(isRefund?'var(--green)':'var(--red)')+'">'+(isRefund?'+':'−')+moneyAbs(amount)+'</span>'
          +'<button type="button" class="part-del" aria-label="Remove adjustment" title="Remove" onclick="event.stopPropagation();'+delFn+'">×</button>'
          +'</div>';
      }).join('');

      var totalRow='<div class="rt-net-adjustment"><span>Net cost adjustment</span><span style="color:'+(total<0?'var(--green)':total>0?'var(--red)':'var(--text-secondary)')+'">'
        +(total>0?'+':total<0?'−':'')+moneyAbs(total)+'</span></div>';

      var addFn='addPart(\''+m+'\',\''+id+'\',\''+context+'\')';
      var addForm=''
        +'<input type="hidden" id="part-kind-'+context+'" value="expense">'
        +'<div class="rt-adjust-kind" role="group" aria-label="Adjustment type">'
          +'<button type="button" class="on" data-kind="expense" data-rt-part-kind-context="'+html(context)+'" aria-pressed="true" onclick="rtSetPartKind(\''+context+'\',\'expense\')">Expense</button>'
          +'<button type="button" data-kind="refund" data-rt-part-kind-context="'+html(context)+'" aria-pressed="false" onclick="rtSetPartKind(\''+context+'\',\'refund\')">Refund / Credit</button>'
        +'</div>'
        +'<div class="rt-adjust-hint" id="part-kind-hint-'+context+'">Expense records extra spend on this item and increases its cost basis.</div>'
        +'<div class="add-part-row">'
          +'<div class="fg" style="margin-bottom:0"><input type="text" id="part-desc-'+context+'" placeholder="e.g. Charging cable, Vinted partial refund…"></div>'
          +'<div class="fg" style="margin-bottom:0"><input type="number" id="part-cost-'+context+'" min="0" step="0.01" inputmode="decimal" placeholder="£0.00" style="width:90px"></div>'
          +'<button type="button" class="btn btn-s" style="padding:9px 12px;font-size:13px" onclick="'+addFn+'">+ Add</button>'
        +'</div>';

      return '<div class="parts-list" id="parts-list-'+id+'-'+context+'">'+rows+totalRow+'</div>'+addForm;
    };

    addPart=function(m,id,context){
      context=context||'panel';
      var descEl=document.getElementById('part-desc-'+context);
      var costEl=document.getElementById('part-cost-'+context);
      var kindEl=document.getElementById('part-kind-'+context);
      if(!descEl||!costEl)return;
      var desc=(descEl.value||'').trim();
      var amount=Math.abs(Number(costEl.value)||0);
      var kind=kindEl&&kindEl.value==='refund'?'refund':'expense';
      if(!desc||!(amount>0)){
        try{toast('Enter a description and amount','err');}catch(_){}
        return;
      }
      var i=findItem(m,id);
      if(!i)return;
      if(!Array.isArray(i.parts))i.parts=[];
      i.parts.push({id:partId(),description:desc,cost:kind==='refund'?-amount:amount,date:today()});
      try{saveDB();}catch(_){}
      descEl.value='';costEl.value='';
      refreshPartsContext(m,id,context);
      try{toast(kind==='refund'?'Refund / credit recorded':'Expense recorded');}catch(_){}
    };

    /* Edit keeps refund amounts positive in the input and preserves the type. */
    editPart=function(m,id,idx,context){
      context=context||'panel';
      var i=findItem(m,id);
      if(!i||!Array.isArray(i.parts)||!i.parts[idx])return;
      var p=i.parts[idx];
      var amount=Number(p.cost)||0;
      var kind=amount<0?'refund':'expense';
      var rowId='part-edit-row-'+id+'-'+idx+'-'+context;
      if(document.getElementById(rowId))return;
      var list=document.getElementById('parts-list-'+id+'-'+context);
      if(!list)return;
      var rowEl=list.querySelectorAll('.part-row')[idx];
      if(!rowEl)return;
      var saveFn='savePartEdit(\''+m+'\',\''+id+'\','+idx+',\''+context+'\')';
      var cancelFn='cancelPartEdit(\''+id+'\','+idx+',\''+context+'\')';
      rowEl.outerHTML='<div class="add-part-row" id="'+rowId+'" style="background:var(--accent-dim);border-radius:8px;padding:6px 4px;">'
        +'<select id="part-edit-kind-'+idx+'-'+context+'" aria-label="Adjustment type" style="min-height:38px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 8px;">'
          +'<option value="expense"'+(kind==='expense'?' selected':'')+'>Expense</option>'
          +'<option value="refund"'+(kind==='refund'?' selected':'')+'>Refund / Credit</option>'
        +'</select>'
        +'<div class="fg" style="margin-bottom:0"><input type="text" id="part-edit-desc-'+idx+'-'+context+'" value="'+html(p.description||p.desc||p.name||'')+'" placeholder="Description"></div>'
        +'<div class="fg" style="margin-bottom:0"><input type="number" id="part-edit-cost-'+idx+'-'+context+'" min="0" step="0.01" inputmode="decimal" value="'+Math.abs(amount)+'" style="width:90px"></div>'
        +'<button type="button" class="btn btn-p" style="padding:9px 12px;font-size:13px" onclick="'+saveFn+'">✓</button>'
        +'<button type="button" class="btn btn-s" style="padding:9px 10px;font-size:13px" onclick="'+cancelFn+'">✕</button>'
        +'</div>';
    };

    savePartEdit=function(m,id,idx,context){
      context=context||'panel';
      var i=findItem(m,id);
      if(!i||!Array.isArray(i.parts)||!i.parts[idx])return;
      var descEl=document.getElementById('part-edit-desc-'+idx+'-'+context);
      var costEl=document.getElementById('part-edit-cost-'+idx+'-'+context);
      var kindEl=document.getElementById('part-edit-kind-'+idx+'-'+context);
      var desc=descEl?(descEl.value||'').trim():'';
      var amount=costEl?Math.abs(Number(costEl.value)||0):0;
      var kind=kindEl&&kindEl.value==='refund'?'refund':'expense';
      if(!desc||!(amount>0)){
        try{toast('Enter a description and amount','err');}catch(_){}
        return;
      }
      i.parts[idx].description=desc;
      i.parts[idx].cost=kind==='refund'?-amount:amount;
      if(!i.parts[idx].date)i.parts[idx].date=today();
      try{saveDB();}catch(_){}
      refreshPartsContext(m,id,context);
      try{toast('Adjustment updated');}catch(_){}
    };
  }

  /* Add negative item adjustments to the derived cash ledger as inflows. */
  if(typeof _cashEventsAll==='function'&&!_cashEventsAll.__rtPurchaseCredits){
    var baseCashEvents=_cashEventsAll;
    var wrappedCashEvents=function(){
      var out=baseCashEvents.apply(this,arguments)||[];
      var seen=new Set(out.map(function(e){return String(e&&e.id||'');}));
      try{
        (typeof allDBKeys==='function'?allDBKeys():[]).forEach(function(m){
          (DB[m]||[]).forEach(function(i){
            if(!i||(i.item||'').trim().toUpperCase()==='MONTH END')return;
            var sourced=i.dateSourced||i.dateListed||null;
            (Array.isArray(i.parts)?i.parts:[]).forEach(function(p,idx){
              var cost=Number(p&&p.cost)||0;
              if(!(cost<0))return;
              var id='partrefund:'+i.id+':'+(p.id||idx);
              if(seen.has(id))return;
              seen.add(id);
              out.push({
                id:id,
                date:(p&&p.date)||sourced,
                type:'supplier_refund',
                direction:'in',
                amount:+Math.abs(cost).toFixed(2),
                description:'Purchase refund / credit · '+((p&&(p.description||p.desc||p.name))||i.item||'Item'),
                source:'item',
                itemId:i.id
              });
            });
          });
        });
      }catch(_){}
      return out.sort(function(a,b){return (a.date||'').localeCompare(b.date||'')||String(a.id).localeCompare(String(b.id));});
    };
    wrappedCashEvents.__rtPurchaseCredits=true;
    _cashEventsAll=wrappedCashEvents;
  }

  /* ---------------------------------------------------------------------- */
  /* Per-item partner split / fixed amount in List + Add Stock forms        */
  /* ---------------------------------------------------------------------- */
  function accountById(id){
    if(!id)return null;
    try{return (_accounts||[]).find(function(a){return a&&a.id===id;})||null;}catch(_){return null;}
  }
  function termsHTML(accountId){
    var a=accountById(accountId);
    if(!a)return '';
    var type=a.accountType||'supplier';
    if(type==='supplier'){
      return '<div class="rt-partner-terms" id="rt-partner-terms" data-account-id="'+html(a.id)+'" data-account-type="supplier">'
        +'<div class="rt-partner-terms-title">Partner terms for this item</div>'
        +'<div class="rt-partner-term-row"><label style="font-size:11px;color:var(--text-secondary);">Amount owed override (£) <span style="font-weight:400;">optional</span></label>'
        +'<input type="number" id="rt-partner-fixed" min="0" step="0.01" inputmode="decimal" placeholder="Uses item buy price by default"></div>'
        +'<div class="rt-partner-term-hint">Leave blank to use the item buy price as the supplier amount owed.</div>'
        +'<input type="hidden" id="rt-partner-mode" value="fixed">'
        +'</div>';
    }
    var def=a.defaultSplitPercent!=null?Math.max(0,Math.min(100,Number(a.defaultSplitPercent)||0)):'';
    return '<div class="rt-partner-terms" id="rt-partner-terms" data-account-id="'+html(a.id)+'" data-account-type="'+html(type)+'">'
      +'<div class="rt-partner-terms-title">Partner terms for this item</div>'
      +'<input type="hidden" id="rt-partner-mode" value="percent">'
      +'<div class="rt-partner-mode" role="group" aria-label="Partner payment method">'
        +'<button type="button" class="on" data-mode="percent" aria-pressed="true" onclick="rtSetPartnerTermMode(\'percent\')">Profit split %</button>'
        +'<button type="button" data-mode="fixed" aria-pressed="false" onclick="rtSetPartnerTermMode(\'fixed\')">Fixed £ amount</button>'
      +'</div>'
      +'<div id="rt-partner-percent-wrap" class="rt-partner-term-row"><label style="font-size:11px;color:var(--text-secondary);">Partner share of profit (%)</label>'
        +'<input type="number" id="rt-partner-split" min="0" max="100" step="0.1" inputmode="decimal" value="'+def+'" placeholder="e.g. 50"></div>'
      +'<div id="rt-partner-fixed-wrap" class="rt-partner-term-row" style="display:none;"><label style="font-size:11px;color:var(--text-secondary);">Fixed amount to partner (£)</label>'
        +'<input type="number" id="rt-partner-fixed" min="0" step="0.01" inputmode="decimal" placeholder="e.g. 40.00"></div>'
      +'<div class="rt-partner-term-hint">Set the agreement for this item now. It overrides the account default for this item only.</div>'
      +'</div>';
  }

  window.rtSetPartnerTermMode=function(mode){
    mode=mode==='fixed'?'fixed':'percent';
    var modeEl=document.getElementById('rt-partner-mode');if(modeEl)modeEl.value=mode;
    var p=document.getElementById('rt-partner-percent-wrap');if(p)p.style.display=mode==='percent'?'grid':'none';
    var f=document.getElementById('rt-partner-fixed-wrap');if(f)f.style.display=mode==='fixed'?'grid':'none';
    document.querySelectorAll('.rt-partner-mode button[data-mode]').forEach(function(b){
      var on=b.getAttribute('data-mode')===mode;b.classList.toggle('on',on);b.setAttribute('aria-pressed',on?'true':'false');
    });
  };

  function renderTermsIntoPicker(accountId){
    var slot=document.getElementById('rt-qa-partner-terms-slot');
    if(slot)slot.innerHTML=termsHTML(accountId);
  }

  if(typeof _quickAddPartnerPickerHTML==='function'){
    var basePickerHTML=_quickAddPartnerPickerHTML;
    _quickAddPartnerPickerHTML=function(){
      var base=basePickerHTML.apply(this,arguments)||'';
      var current=null;try{current=_quickAddAccountId||null;}catch(_){}
      // In a partner-context form the banner owns the terms UI; avoid duplicate IDs.
      if(current)return base;
      return base+'<div id="rt-qa-partner-terms-slot"></div>';
    };
  }

  if(typeof _quickAddPartnerPicked==='function'){
    var basePartnerPicked=_quickAddPartnerPicked;
    _quickAddPartnerPicked=function(val){
      var result=basePartnerPicked.apply(this,arguments);
      var id=null;try{id=_quickAddAccountId||null;}catch(_){}
      renderTermsIntoPicker(id);
      return result;
    };
  }

  if(typeof _quickAddAccountBanner==='function'){
    var baseAccountBanner=_quickAddAccountBanner;
    _quickAddAccountBanner=function(accountId){
      return (baseAccountBanner.apply(this,arguments)||'')+termsHTML(accountId);
    };
  }

  if(typeof _applyQuickAddAccount==='function'){
    var baseApplyQuickAddAccount=_applyQuickAddAccount;
    _applyQuickAddAccount=function(item,accountId){
      item=baseApplyQuickAddAccount.apply(this,arguments)||item;
      var a=accountById(accountId);
      if(!item||!a)return item;
      var terms=document.getElementById('rt-partner-terms');
      if(!terms||terms.getAttribute('data-account-id')!==String(a.id))return item;
      var type=a.accountType||'supplier';
      var fixedEl=document.getElementById('rt-partner-fixed');
      var fixedRaw=fixedEl?(fixedEl.value||'').trim():'';
      var fixed=fixedRaw===''?null:Number(fixedRaw);

      if(type==='supplier'){
        item.accountSplitPercent=null;
        if(fixed!==null&&isFinite(fixed)&&fixed>=0)item.accountPaidAmount=+fixed.toFixed(2);
        else item.accountPaidAmount=null;
        return item;
      }

      var modeEl=document.getElementById('rt-partner-mode');
      var mode=modeEl&&modeEl.value==='fixed'?'fixed':'percent';
      if(mode==='fixed'){
        item.accountSplitPercent=null;
        item.accountPaidAmount=(fixed!==null&&isFinite(fixed)&&fixed>=0)?+fixed.toFixed(2):null;
      }else{
        item.accountPaidAmount=null;
        var splitEl=document.getElementById('rt-partner-split');
        var raw=splitEl?(splitEl.value||'').trim():'';
        if(raw!==''){
          var pct=Number(raw);
          item.accountSplitPercent=isFinite(pct)?+Math.max(0,Math.min(100,pct)).toFixed(2):null;
        }else item.accountSplitPercent=null;
      }
      return item;
    };
  }
})();
