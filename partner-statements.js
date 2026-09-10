/* RETRADE partner statements v1.0.0
 * Clear account statements for non-accountants.
 *
 * - Opened from the top-right Statement button on a partner account.
 * - Periods: month, calendar year, or custom date range.
 * - Excel: Statement + Sold Items + Payments & Adjustments worksheets.
 * - CSV: the same information as readable sections in one file.
 *
 * Financial values are derived from RETRADE's existing sale/return and partner
 * accounting helpers. This module does not persist or mutate accounting data.
 */
(function(){
  'use strict';

  var _psState={accountId:null,mode:'month'};

  function _psMoney(n){return +(Number(n)||0).toFixed(2);}
  function _psFmt(n){
    try{return typeof fmt==='function'?fmt(_psMoney(n)):'£'+_psMoney(n).toFixed(2);}
    catch(_){return '£'+_psMoney(n).toFixed(2);}
  }
  function _psEsc(s){
    if(typeof esc==='function')return esc(String(s==null?'':s));
    return String(s==null?'':s).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});
  }
  function _psAccount(id){
    try{return (_accounts||[]).find(function(a){return a&&String(a.id)===String(id);})||null;}
    catch(_){return null;}
  }
  function _psISO(d){
    var y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }
  function _psCurrentMonth(){
    var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
  }
  function _psMonthEnd(ym){
    var p=String(ym||'').split('-'),y=Number(p[0]),m=Number(p[1]);
    if(!y||!m)return null;
    return _psISO(new Date(y,m,0));
  }
  function _psSafeFilename(s){return String(s||'Partner').replace(/[^a-z0-9._-]+/gi,'_').replace(/^_+|_+$/g,'')||'Partner';}

  function _psAvailableYears(acct){
    var years=new Set([new Date().getFullYear()]);
    try{
      getSaleEventsInRange(null,null).forEach(function(ev){
        if(!ev||!ev.item||String(ev.item.accountId)!==String(acct.id)||!ev.saleDate)return;
        var y=Number(String(ev.saleDate).slice(0,4));if(y)years.add(y);
      });
    }catch(_){}
    (acct.settlements||[]).forEach(function(tx){var y=Number(String((tx&&tx.date)||'').slice(0,4));if(y)years.add(y);});
    return Array.from(years).sort(function(a,b){return b-a;});
  }

  function _psResolvedPeriod(){
    var mode=_psState.mode||'month',from='',to='',label='',slug='';
    if(mode==='month'){
      var ym=(document.getElementById('ps-month')||{}).value||_psCurrentMonth();
      if(!/^\d{4}-\d{2}$/.test(ym))throw new Error('Choose a month.');
      from=ym+'-01';to=_psMonthEnd(ym);
      var d=new Date(Number(ym.slice(0,4)),Number(ym.slice(5,7))-1,1);
      label=d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});slug=ym;
    }else if(mode==='year'){
      var y=Number((document.getElementById('ps-year')||{}).value)||new Date().getFullYear();
      from=y+'-01-01';to=y+'-12-31';label=String(y);slug=String(y);
    }else{
      from=(document.getElementById('ps-from')||{}).value||'';
      to=(document.getElementById('ps-to')||{}).value||'';
      if(!from||!to)throw new Error('Choose both a start and end date.');
      if(from>to)throw new Error('The start date must be before the end date.');
      label=new Date(from+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})+' – '+new Date(to+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
      slug=from+'_to_'+to;
    }
    return {from:from,to:to,label:label,slug:slug};
  }

  function _psSplitInfo(item,profitPool,partnerAmount,acct){
    var type='supplier';
    try{type=_itemAccountType(item);}catch(_){type=(item&&item.accountType)||(acct&&acct.accountType)||'supplier';}
    if(type==='supplier')return {partnerLabel:'Supplier cost',retradeLabel:'RETRADE profit',partnerPct:null,retradePct:null,isSupplier:true};
    if(item&&item.accountPaidAmount!=null){
      var ep=profitPool>0?_psMoney((Number(partnerAmount)||0)/profitPool*100):null;
      return {partnerLabel:ep!=null?'Fixed · '+ep.toFixed(1)+'% effective':'Fixed amount',retradeLabel:ep!=null?(100-ep).toFixed(1)+'% effective':'',partnerPct:ep,retradePct:ep!=null?100-ep:null,isFixed:true};
    }
    var pct=item&&item.accountSplitPercent!=null?Number(item.accountSplitPercent):null;
    if(pct==null&&acct&&acct.defaultSplitPercent!=null)pct=Number(acct.defaultSplitPercent);
    if(pct!=null&&isFinite(pct)){
      pct=Math.max(0,Math.min(100,pct));
      return {partnerLabel:pct.toFixed(pct%1?1:0)+'%',retradeLabel:(100-pct).toFixed((100-pct)%1?1:0)+'%',partnerPct:pct,retradePct:100-pct};
    }
    return {partnerLabel:'Not set',retradeLabel:'—',partnerPct:null,retradePct:null};
  }

  function _psSettlementForItem(acct,itemId,to){
    var paid=0,allocated=0,paidDate=null,legacy=false;
    (acct.settlements||[]).forEach(function(tx){
      if(!tx)return;
      (tx.items||[]).forEach(function(a){
        var id=a&&(a.id!=null?a.id:a.itemId);
        if(String(id)!==String(itemId))return;
        var amt=Math.max(0,Number(a.amount)||0);allocated+=amt;
        if(tx.paid===true&&tx.date&&tx.date<=to){paid+=amt;if(!paidDate||tx.date>paidDate)paidDate=tx.date;}
      });
    });
    if(paid===0){
      try{
        var rec=_accountItems(acct.id).find(function(i){return String(i.id)===String(itemId);});
        if(rec&&rec.accountSettled===true){legacy=true;}
      }catch(_){}
    }
    return {paid:_psMoney(paid),allocated:_psMoney(allocated),paidDate:paidDate,legacy:legacy};
  }

  function _psBuild(accountId,period){
    var acct=_psAccount(accountId);if(!acct)throw new Error('Partner account not found.');
    if(typeof getSaleEventsInRange!=='function'||typeof _saleBreakdown!=='function')throw new Error('Reporting engine is not available yet.');

    var events=getSaleEventsInRange(period.from,period.to).filter(function(ev){return ev&&ev.item&&String(ev.item.accountId)===String(acct.id);});
    events.sort(function(a,b){return String(a.saleDate||'').localeCompare(String(b.saleDate||''));});
    var saleEvents=events.filter(function(ev){return !ev.isReturnAdjustment;});
    var adjustmentEvents=events.filter(function(ev){return !!ev.isReturnAdjustment;});

    var t={goods:0,postageIncome:0,platformFees:0,advertising:0,delivery:0,packaging:0,itemCost:0,parts:0,returns:0,partnerShare:0};
    var soldRows=[];
    var pctKinds=[];

    saleEvents.forEach(function(ev){
      var b=_saleBreakdown(ev),revenue=_psMoney((b.salePrice||0)+(b.postage||0));
      var external=_psMoney((b.totalCosts||0)-(b.partnerSplit||0));
      var profitPool=_psMoney(revenue-external),profitShare=_psMoney(b.partnerSplit||0),retrade=_psMoney(b.netProfit||0);
      var split=_psSplitInfo(ev.item,profitPool,profitShare,acct),sett=_psSettlementForItem(acct,ev.item.id,period.to);
      var partner=split.isSupplier?Math.max(0,_psMoney(b.itemCost||0)):profitShare;
      var status='—';
      if(split.isSupplier){
        var supplierDue=Math.max(0,Number(b.itemCost)||0);
        if(supplierDue>0)status=(sett.paid>=supplierDue-0.009||sett.legacy)?'Paid':'To pay';
      }else if(partner>0){status=(sett.paid>=partner-0.009||sett.legacy)?'Paid':'To pay';}
      else if(split.partnerLabel==='Not set')status='Split not set';

      t.goods+=Number(b.salePrice)||0;t.postageIncome+=Number(b.postage)||0;
      t.platformFees+=(Number(b.bpf)||0)+(Number(b.listingFee)||0);
      t.advertising+=Number(b.promoFee)||0;t.delivery+=Number(b.shipping)||0;t.packaging+=Number(b.packaging)||0;
      t.itemCost+=Number(b.itemCost)||0;t.parts+=Number(b.parts)||0;t.partnerShare+=profitShare;
      if(!split.isSupplier)pctKinds.push(split.isFixed?'fixed':(split.partnerPct==null?'unset':'pct:'+split.partnerPct));
      soldRows.push({date:ev.saleDate||'',item:ev.item.item||'Untitled',saleNo:b.saleNo||('Sale '+ev.sale),salePrice:_psMoney(b.salePrice),postage:_psMoney(b.postage),revenue:revenue,costs:external,profit:profitPool,partnerPctLabel:split.partnerLabel,partnerPct:split.partnerPct,partner:partner,retradePctLabel:split.retradeLabel,retradePct:split.retradePct,retrade:retrade,status:status,paidDate:sett.paidDate||'',itemId:ev.item.id});
    });

    var adjustmentRows=[];
    adjustmentEvents.forEach(function(ev){
      var b=_saleBreakdown(ev),feeCredits=_psMoney(-((Number(b.bpf)||0)+(Number(b.promoFee)||0))),profitImpact=_psMoney(b.netProfit||0);
      t.platformFees+=(Number(b.bpf)||0)+(Number(b.listingFee)||0);
      t.advertising+=Number(b.promoFee)||0;t.delivery+=Number(b.shipping)||0;t.packaging+=Number(b.packaging)||0;
      t.itemCost+=Number(b.itemCost)||0;t.parts+=Number(b.parts)||0;
      t.returns+=(Number(b.returnRefund)||0)+(Number(b.returnPostage)||0)+(Number(b.partialRefund)||0);
      adjustmentRows.push({date:ev.saleDate||'',item:ev.item.item||'Untitled',type:'Return / refund',saleNo:(b.saleNo||'').replace(' return',''),refund:_psMoney(b.returnRefund||0),returnPostage:_psMoney(b.returnPostage||0),feeCredits:feeCredits,profitImpact:profitImpact});
    });

    Object.keys(t).forEach(function(k){t[k]=_psMoney(t[k]);});
    t.revenue=_psMoney(t.goods+t.postageIncome);
    t.totalCosts=_psMoney(t.platformFees+t.advertising+t.delivery+t.packaging+t.itemCost+t.parts+t.returns);
    t.profitPool=_psMoney(t.revenue-t.totalCosts);
    t.retradeShare=_psMoney(t.profitPool-t.partnerShare);

    var paidInPeriod=0,paymentRows=[];
    (acct.settlements||[]).slice().sort(function(a,b){return String(a.date||'').localeCompare(String(b.date||''));}).forEach(function(tx){
      if(!tx||!tx.date||tx.date<period.from||tx.date>period.to)return;
      var amount=_psMoney(tx.partnerAmount||0);if(tx.paid===true)paidInPeriod+=amount;
      paymentRows.push({date:tx.date,type:tx.paid===true?'Payment to partner':'Allocated / unpaid',amount:amount,status:tx.paid===true?'Paid':'Unpaid',items:(tx.items||[]).length,note:tx.note||''});
    });
    paidInPeriod=_psMoney(paidInPeriod);

    var dueOnStatement=0;
    soldRows.forEach(function(r){
      if(r.partner<=0)return;
      var sett=_psSettlementForItem(acct,r.itemId,period.to);
      var paidAgainst=sett.legacy?r.partner:Math.min(r.partner,sett.paid);
      dueOnStatement+=Math.max(0,r.partner-paidAgainst);
    });
    dueOnStatement=_psMoney(dueOnStatement);

    var exactPcts=[];var hasFixed=false,hasUnset=false;
    pctKinds.forEach(function(k){if(k==='fixed')hasFixed=true;else if(k==='unset')hasUnset=true;else if(k.indexOf('pct:')===0)exactPcts.push(Number(k.slice(4)));});
    var unique=Array.from(new Set(exactPcts.map(function(x){return _psMoney(x);})));var partnerPctLabel='—',retradePctLabel='—';
    if(acct.accountType==='supplier'){
      partnerPctLabel='Not a profit split';retradePctLabel='—';
    }else if(unique.length===1&&!hasFixed&&!hasUnset){
      partnerPctLabel=unique[0].toFixed(unique[0]%1?1:0)+'%';
      retradePctLabel=(100-unique[0]).toFixed((100-unique[0])%1?1:0)+'%';
    }else if(t.profitPool>0&&t.partnerShare>=0){
      var eff=Math.max(0,(t.partnerShare/t.profitPool)*100);
      partnerPctLabel=eff.toFixed(1)+'% effective';retradePctLabel=(100-eff).toFixed(1)+'% effective';
    }else if(acct.defaultSplitPercent!=null){
      var dp=Math.max(0,Math.min(100,Number(acct.defaultSplitPercent)||0));partnerPctLabel=dp+'% default';retradePctLabel=(100-dp)+'% default';
    }

    return {account:acct,period:period,events:events,sales:soldRows,adjustments:adjustmentRows,payments:paymentRows,totals:t,paidInPeriod:paidInPeriod,dueOnStatement:dueOnStatement,partnerPctLabel:partnerPctLabel,retradePctLabel:retradePctLabel};
  }

  function _psSummaryRows(s){
    var t=s.totals,acctType=s.account.accountType||'supplier';
    var rows=[
      ['RETRADE · PARTNER STATEMENT'],
      ['Partner',s.account.name||'Partner'],
      ['Period',s.period.label],
      ['Account type',acctType.charAt(0).toUpperCase()+acctType.slice(1)],
      ['Items sold',s.sales.length],
      [],
      ['REVENUE','Amount (£)'],
      ['Sales made',t.goods],
      ['Postage charged to customers',t.postageIncome],
      ['TOTAL REVENUE',t.revenue],
      [],
      ['COSTS','Amount (£)'],
      ['Selling & listing fees',t.platformFees],
      ['Advertising',t.advertising],
      ['Delivery postage',t.delivery],
      ['Packaging',t.packaging]
    ];
    if(Math.abs(t.itemCost)>0.009)rows.push([acctType==='hybrid'?'Agreed upfront / item cost':'Item / stock cost',t.itemCost]);
    if(Math.abs(t.parts)>0.009)rows.push(['Parts & repairs',t.parts]);
    if(Math.abs(t.returns)>0.009)rows.push(['Refunds & return postage',t.returns]);
    rows.push(['TOTAL COSTS',t.totalCosts],[],['WHO EARNED WHAT','Amount (£)']);
    if(acctType==='supplier'){
      rows.push(['Partner / supplier amount',t.itemCost]);
      rows.push(['RETRADE profit',t.retradeShare]);
      rows.push(['Partner share %','Not applicable · supplier cost arrangement']);
    }else{
      rows.push(['Profit to split',t.profitPool]);
      rows.push(['Partner share · '+s.partnerPctLabel,t.partnerShare]);
      rows.push(['RETRADE share · '+s.retradePctLabel,t.retradeShare]);
    }
    rows.push([],['PAYMENTS','Amount (£)'],['Paid to partner in this period',s.paidInPeriod],['Still owed on sales in this statement',s.dueOnStatement]);
    rows.push([],['Simple summary',s.sales.length+' item'+(s.sales.length===1?'':'s')+' sold · '+_psFmt(t.revenue)+' revenue · '+_psFmt(t.profitPool)+' profit'+(acctType==='supplier'?'':(' · Partner earned '+_psFmt(t.partnerShare)+' ('+s.partnerPctLabel+')'))]);
    rows.push(['Note','Costs and returns use the same sale/return calculations as the RETRADE accounting engine. Payments are based on settlement records dated in the selected period.']);
    return rows;
  }

  function _psSoldRows(s){
    var supplier=(s.account.accountType||'supplier')==='supplier';
    var rows=[['Date','Item','Sale','Sold for (£)','Customer postage (£)','Total revenue (£)','Costs (£)',supplier?'Profit after costs (£)':'Profit to split (£)',supplier?'Arrangement':'Partner share %',supplier?'Partner / supplier amount (£)':'Partner earned (£)',supplier?'':'RETRADE share %','RETRADE earned (£)','Payment status','Paid date']];
    s.sales.forEach(function(r){rows.push([r.date,r.item,r.saleNo,r.salePrice,r.postage,r.revenue,r.costs,r.profit,r.partnerPctLabel,r.partner,r.retradePctLabel,r.retrade,r.status,r.paidDate]);});
    if(s.sales.length){
      rows.push([]);rows.push(['TOTAL','','',s.totals.goods,s.totals.postageIncome,s.totals.revenue,
        _psMoney(s.sales.reduce(function(x,r){return x+r.costs;},0)),
        _psMoney(s.sales.reduce(function(x,r){return x+r.profit;},0)),'',
        _psMoney(s.sales.reduce(function(x,r){return x+r.partner;},0)),'',
        _psMoney(s.sales.reduce(function(x,r){return x+r.retrade;},0)),'','']);
    }
    return rows;
  }

  function _psPaymentAdjustmentRows(s){
    var rows=[['Date','Type','Item / details','Related sale','Amount / refund (£)','Return postage (£)','Fee credits (£)','Profit impact (£)','Status / note']];
    s.payments.forEach(function(p){rows.push([p.date,p.type,(p.items||0)+' item'+(p.items===1?'':'s'),' ',p.amount,'','','',p.status+(p.note?' · '+p.note:'')]);});
    s.adjustments.forEach(function(a){rows.push([a.date,a.type,a.item,a.saleNo,a.refund,a.returnPostage,a.feeCredits,a.profitImpact,'']);});
    if(rows.length===1)rows.push(['','No payments or adjustments in this period','','','','','','','']);
    return rows;
  }

  function _psCsvCell(value){
    if(typeof _csvCell==='function')return _csvCell(value);
    var s=String(value==null?'':value);if(/^[=+\-@]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
  }
  function _psRowsToCsv(rows){
    if(typeof _rowsToCsv==='function')return _rowsToCsv(rows);
    return rows.map(function(r){return r.map(_psCsvCell).join(',');}).join('\n');
  }
  function _psDownloadBlob(content,type,name){
    var blob=new Blob([content],{type:type}),a=document.createElement('a'),url=URL.createObjectURL(blob);
    a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},0);
  }

  function _psGenerateCsv(){
    try{
      var period=_psResolvedPeriod(),s=_psBuild(_psState.accountId,period),rows=[];
      _psSummaryRows(s).forEach(function(r){rows.push(r);});
      rows.push([],['SOLD ITEMS']);_psSoldRows(s).forEach(function(r){rows.push(r);});
      rows.push([],['PAYMENTS & ADJUSTMENTS']);_psPaymentAdjustmentRows(s).forEach(function(r){rows.push(r);});
      var filename='RETRADE_'+_psSafeFilename(s.account.name)+'_Statement_'+period.slug+'.csv';
      _psDownloadBlob('\uFEFF'+_psRowsToCsv(rows),'text/csv;charset=utf-8',filename);
      try{toast('Partner statement CSV downloaded');}catch(_){}
    }catch(err){try{toast(err.message||'Could not generate statement','error');}catch(_){alert(err.message||err);}}
  }

  function _psWriteWorkbook(s){
    var wb=XLSX.utils.book_new(),summaryRows=_psSummaryRows(s),soldRows=_psSoldRows(s),paRows=_psPaymentAdjustmentRows(s);
    var ws1=XLSX.utils.aoa_to_sheet(summaryRows),ws2=XLSX.utils.aoa_to_sheet(soldRows),ws3=XLSX.utils.aoa_to_sheet(paRows);
    ws1['!cols']=[{wch:38},{wch:30}];
    ws2['!cols']=[{wch:12},{wch:34},{wch:12},{wch:14},{wch:18},{wch:16},{wch:14},{wch:18},{wch:20},{wch:21},{wch:18},{wch:18},{wch:16},{wch:12}];
    ws3['!cols']=[{wch:12},{wch:20},{wch:34},{wch:14},{wch:18},{wch:18},{wch:16},{wch:16},{wch:30}];
    try{
      if(typeof _styleReportSheet==='function'){
        _styleReportSheet(ws1,summaryRows,{moneyCols:[1],freezeRow:0});
        _styleReportSheet(ws2,soldRows,{headerRows:[0],moneyCols:[3,4,5,6,7,9,11],freezeRow:1});
        _styleReportSheet(ws3,paRows,{headerRows:[0],moneyCols:[4,5,6,7],freezeRow:1});
      }
    }catch(_){}
    XLSX.utils.book_append_sheet(wb,ws1,'Statement');
    XLSX.utils.book_append_sheet(wb,ws2,'Sold Items');
    XLSX.utils.book_append_sheet(wb,ws3,'Payments & Adjustments');
    var filename='RETRADE_'+_psSafeFilename(s.account.name)+'_Statement_'+s.period.slug+'.xlsx';
    XLSX.writeFile(wb,filename);
    try{toast('Partner statement Excel downloaded');}catch(_){}
  }

  function _psGenerateExcel(){
    var period,s;try{period=_psResolvedPeriod();s=_psBuild(_psState.accountId,period);}catch(err){try{toast(err.message||'Could not generate statement','error');}catch(_){alert(err.message||err);}return;}
    if(window.XLSX){_psWriteWorkbook(s);return;}
    var existing=document.getElementById('rt-xlsx-lib');
    if(existing){
      existing.addEventListener('load',function(){_psWriteWorkbook(s);},{once:true});
      try{toast('Preparing Excel export…');}catch(_){}
      return;
    }
    var script=document.createElement('script');script.id='rt-xlsx-lib';
    script.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.integrity='sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';
    script.crossOrigin='anonymous';script.referrerPolicy='no-referrer';
    script.onload=function(){_psWriteWorkbook(s);};
    script.onerror=function(){try{toast('Could not load the Excel exporter. CSV is still available.','error');}catch(_){}};
    document.head.appendChild(script);
  }

  function _psSetMode(mode){
    if(['month','year','custom'].indexOf(mode)<0)return;_psState.mode=mode;
    ['month','year','custom'].forEach(function(m){
      var b=document.getElementById('ps-mode-'+m),box=document.getElementById('ps-fields-'+m);
      if(b){b.classList.toggle('btn-primary',m===mode);b.classList.toggle('btn-secondary',m!==mode);}
      if(box)box.style.display=m===mode?'':'none';
    });
  }

  function openPartnerStatement(accountId){
    var acct=_psAccount(accountId);if(!acct){try{toast('Partner not found','error');}catch(_){}return;}
    _psState.accountId=acct.id;_psState.mode='month';
    var now=new Date(),first=_psISO(new Date(now.getFullYear(),now.getMonth(),1)),today=_psISO(now),years=_psAvailableYears(acct);
    var yearOptions=years.map(function(y){return '<option value="'+y+'"'+(y===now.getFullYear()?' selected':'')+'>'+y+'</option>';}).join('');
    var html=''
      +'<div style="font-size:13px;color:var(--text-secondary);line-height:1.55;margin-bottom:14px;">Choose the period you want to explain to <strong style="color:var(--text);">'+_psEsc(acct.name)+'</strong>. The statement groups revenue, costs and who earned what, then lists every sale separately.</div>'
      +'<div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px;">'
        +'<button type="button" id="ps-mode-month" class="btn btn-primary" onclick="_partnerStatementSetMode(\'month\')">Month</button>'
        +'<button type="button" id="ps-mode-year" class="btn btn-secondary" onclick="_partnerStatementSetMode(\'year\')">Year</button>'
        +'<button type="button" id="ps-mode-custom" class="btn btn-secondary" onclick="_partnerStatementSetMode(\'custom\')">Custom</button>'
      +'</div>'
      +'<div id="ps-fields-month" class="fg"><label>Month</label><input type="month" id="ps-month" value="'+_psCurrentMonth()+'"></div>'
      +'<div id="ps-fields-year" class="fg" style="display:none;"><label>Year</label><select id="ps-year">'+yearOptions+'</select></div>'
      +'<div id="ps-fields-custom" style="display:none;">'
        +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
          +'<div class="fg"><label>From</label><input type="date" id="ps-from" value="'+first+'"></div>'
          +'<div class="fg"><label>To</label><input type="date" id="ps-to" value="'+today+'"></div>'
        +'</div>'
      +'</div>'
      +'<div style="padding:11px 12px;margin:12px 0 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface2);font-size:12px;line-height:1.5;color:var(--text-secondary);">'
        +'<strong style="color:var(--text);">Easy to read:</strong> the first sheet shows totals for Revenue, Costs and Who earned what. Partner share is shown as both a percentage and a £ amount. Excel also includes separate <strong>Sold Items</strong> and <strong>Payments & Adjustments</strong> sheets.'
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
        +'<button type="button" class="btn btn-primary" style="width:100%;" onclick="_partnerStatementExcel()">Generate Excel</button>'
        +'<button type="button" class="btn btn-secondary" style="width:100%;" onclick="_partnerStatementCsv()">Generate CSV</button>'
      +'</div>';
    if(typeof openPanel==='function')openPanel('Partner statement',html);
    else alert('Statement panel is unavailable.');
  }

  window.openPartnerStatement=openPartnerStatement;
  window._partnerStatementSetMode=_psSetMode;
  window._partnerStatementExcel=_psGenerateExcel;
  window._partnerStatementCsv=_psGenerateCsv;
  console.info('[RETRADE] partner statements v1.0.0 loaded');
})();
