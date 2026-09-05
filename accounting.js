/*
 * RETRADE ACCOUNTING ENGINE
 * Step 3 modularisation — financial calculation logic only.
 *
 * This file owns calculation rules for:
 * - management P&L and sale/return event reconciliation
 * - cashflow
 * - supplier / consignment / hybrid partner accounting
 * - platform and promotional fees
 * - HMRC cash-basis bridge and tax estimation primitives
 * - mileage and stock-age financial metrics
 *
 * UI rendering, forms and report/download generation stay outside this file.
 * Keep this file free of DOM rendering code.
 */

function calcTieredTrips(trips){
  const _tyOf=function(ds){
    if(!ds)return null;
    const d=new Date(ds);
    const y=d.getFullYear();
    return (d.getMonth()<3||(d.getMonth()===3&&d.getDate()<6))?y-1:y;
  }
  // Build tax-year buckets, each sorted by date asc to preserve walk order.
  const byYear={};
  trips.forEach(function(t,idx){
    const ty=_tyOf(t.date);
    if(ty===null) return;
    (byYear[ty]=byYear[ty]||[]).push({t:t,idx:idx});
  });
  Object.keys(byYear).forEach(function(ty){
    byYear[ty].sort(function(a,b){return (a.t.date||'').localeCompare(b.t.date||'');});
  });
  // Output array indexed by original trip position.
  const out=trips.map(function(t){
    const expensesCost=Array.isArray(t.expenses)?t.expenses.reduce(function(s,e){return s+(Number(e.amount)||0);},0):0;
    return {
      id:t.id,
      mileageCost:0, expensesCost:+expensesCost.toFixed(2),
      totalCost:+expensesCost.toFixed(2),
      tier1Miles:0, tier2Miles:0,
      tier1Cost:0, tier2Cost:0,
      ratePerMile:_hmrcMileageFirstTierRate(_tyOf(t.date)),
      isSplit:false
    };
  });
  // Walk each tax year in date order.
  Object.keys(byYear).forEach(function(ty){
    let used=0;
    byYear[ty].forEach(function(entry){
      const t=entry.t;
      const m=Math.max(0,Number(t.mileage)||0);
      const rate=_hmrcMileageFirstTierRate(Number(ty));
      let tier1=0, tier2=0;
      if(used+m<=10000){
        tier1=m;
      }else if(used>=10000){
        tier2=m;
      }else{
        tier1=10000-used;
        tier2=m-tier1;
      }
      const tier1Cost=+(tier1*rate).toFixed(2);
      const tier2Cost=+(tier2*0.25).toFixed(2);
      const mileageCost=+(tier1Cost+tier2Cost).toFixed(2);
      const o=out[entry.idx];
      o.mileageCost=mileageCost;
      o.tier1Miles=tier1;
      o.tier2Miles=tier2;
      o.tier1Cost=tier1Cost;
      o.tier2Cost=tier2Cost;
      o.totalCost=+(mileageCost+o.expensesCost).toFixed(2);
      o.isSplit=tier1>0&&tier2>0;
      used+=m;
    });
  });
  return out;
}

function _cashLedger(){return Array.isArray(DB.cashLedger)?DB.cashLedger:(DB.cashLedger=[]);}

function _cashOverheadsAllTime(){
  let o=0;
  (DB.expenses||[]).forEach(function(e){o+=Number(e.amount)||0;});
  // v2.21.9: the flat per-mile mileage allowance is a TAX deduction, NOT a cash
  // outflow. Fuel is paid from personal funds and reclaimed via the 45p rate, so
  // no business cash ever leaves the pot for it — it stays in the tax path
  // (_buildPnLSummary byBox[20]) but must not reduce available cash here. Real
  // motor spend actually paid FROM the business is logged as a trip/DB expense
  // and IS counted (both below). (Reverses v2.21.6, which wrongly booked the
  // mileage allowance as cash and only reconciled by masking another overage.)
  (DB.trips||[]).forEach(function(t){
    (Array.isArray(t.expenses)?t.expenses:[]).forEach(function(x){o+=Number(x.amount)||0;});
  });
  return +o.toFixed(2);
}

function _cashStockTied(){
  let c=0;
  (typeof allDBKeys==='function'?allDBKeys():[]).forEach(function(k){
    (DB[k]||[]).forEach(function(i){
      if(!i)return;
      if((i.item||'').trim().toUpperCase()==='MONTH END')return;
      // On-hand = anything unsold you still hold: sourced, listed, OR returned-and-back.
      // (Excludes scrapped/donated even if state==='sourced' — the old sourced branch leaked those.)
      const onHand = !i.dateSold && !i.resaleSalePrice && !i.scrappedAt;
      if(!onHand)return;
      c += (typeof calcPartsCost==='function'?(Number(calcPartsCost(i))||0):0); // parts: your cash regardless

      // Acquisition cash follows the ACCOUNT TYPE, not one generic settled flag:
      // - own stock: cost was paid when bought
      // - supplier: cost only leaves cash once that supplier debt is settled
      // - consignment: acquisition cost should be £0; partner share is handled on sale
      // - hybrid: any costPrice is the agreed upfront cash component, so it is paid
      //   independently of whether the later profit-share settlement is still open.
      const typ=(typeof _itemAccountType==='function')?_itemAccountType(i):(i.accountId?'supplier':'supplier');
      let acquisitionPaid=!i.accountId;
      if(i.accountId){
        if(typ==='supplier') acquisitionPaid=(i.accountSettled===true);
        else if(typ==='hybrid') acquisitionPaid=true;
        else acquisitionPaid=false; // consignment
      }
      if(acquisitionPaid){
        const acquisition=(typ==='supplier'&&i.accountPaidAmount!=null)
          ? (Number(i.accountPaidAmount)||0)
          : (Number(i.costPrice)||0);
        c += acquisition;
      }
    });
  });
  return +c.toFixed(2);
}

function _cashUnpaidSoldLiabilities(){
  let supplier=0,partner=0,count=0;
  (typeof allDBKeys==='function'?allDBKeys():[]).forEach(function(k){
    (DB[k]||[]).forEach(function(i){
      if(!i||!i.accountId||i.accountSettled===true||i.scrappedAt)return;
      if((i.item||'').trim().toUpperCase()==='MONTH END')return;
      if(typeof _accountItemIsSold==='function'&&!_accountItemIsSold(i))return;
      const typ=(typeof _itemAccountType==='function')?_itemAccountType(i):'supplier';
      if(typ==='supplier'){
        const debt=(typeof _accountItemDebt==='function')?_accountItemDebt(i):((Number(i.costPrice)||0));
        if(debt!=null&&Number(debt)>0){supplier+=Number(debt)||0;count++;}
      }else{
        const owed=(typeof _accountItemOwed==='function')?_accountItemOwed(i):null;
        if(owed!=null&&Number(owed)>0){partner+=Number(owed)||0;count++;}
      }
    });
  });
  return {supplier:+supplier.toFixed(2),partner:+partner.toFixed(2),total:+(supplier+partner).toFixed(2),count:count};
}

function _cashRemovedItemNet(i){
  if(!i||!i.scrappedAt)return 0;
  if((i.item||'').trim().toUpperCase()==='MONTH END')return 0;
  let paidCost=(typeof calcPartsCost==='function'?(Number(calcPartsCost(i))||0):0);
  const typ=(typeof _itemAccountType==='function')?_itemAccountType(i):(i.accountId?'supplier':'supplier');
  let acquisitionPaid=!i.accountId;
  if(i.accountId){
    if(typ==='supplier')acquisitionPaid=(i.accountSettled===true);
    else if(typ==='hybrid')acquisitionPaid=true;
    else acquisitionPaid=false;
  }
  if(acquisitionPaid){
    paidCost += (typ==='supplier'&&i.accountPaidAmount!=null)
      ? (Number(i.accountPaidAmount)||0)
      : (Number(i.costPrice)||0);
  }
  const recovered=(i.scrapReason==='supplier_return')?Math.max(0,Number(i.supplierRefund)||0):0;
  // Positive = cash permanently lost; negative = more cash recovered than paid.
  return +(paidCost-recovered).toFixed(2);
}

function _cashCapitalNetLost(){
  let lost=0;
  (typeof allDBKeys==='function'?allDBKeys():[]).forEach(function(k){
    (DB[k]||[]).forEach(function(i){ lost+=_cashRemovedItemNet(i); });
  });
  return +lost.toFixed(2);
}

function _cashEventsAll(){
  const out=[];
  const push=function(ev){
    if(!ev)return;const amt=+Math.max(0,Number(ev.amount)||0).toFixed(2);if(!amt)return;
    out.push(Object.assign({id:'cash_evt_'+out.length,date:null,type:'other',direction:'out',description:'Cash movement',source:'derived'},ev,{amount:amt}));
  };
  // Manual/non-trading ledger. Linked system rows are display mirrors only and
  // are deliberately ignored here because their authoritative source below is
  // settlements/items.
  _cashLedger().forEach(function(m){
    if(!m||m.type==='partner_settlement'||m.type==='supplier_refund'||m.systemEvent)return;
    const dir=(m.type==='owner_draw')?'out':(m.type==='adjustment'?(m.direction==='out'?'out':'in'):'in');
    push({id:'manual:'+m.id,date:m.date||null,type:m.type||'adjustment',direction:dir,amount:m.amount,
      description:m.description||(m.type==='owner_draw'?'Owner withdrawal':m.type==='owner_contribution'?'Owner contribution':m.type==='opening_balance'?'Opening balance':'Adjustment'),source:'manual',editableId:m.id});
  });
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if(!i||(i.item||'').trim().toUpperCase()==='MONTH END')return;
    const typ=i.accountId&&typeof _itemAccountType==='function'?_itemAccountType(i):'own';
    const sourced=i.dateSourced||i.dateListed||null;
    // Acquisition cash: own stock and hybrid upfront component are paid when sourced.
    if((!i.accountId||typ==='hybrid')&&Number(i.costPrice)>0)push({id:'stock:'+i.id,date:sourced,type:'stock_purchase',direction:'out',amount:i.costPrice,description:'Stock sourced · '+(i.item||'Item'),source:'item',itemId:i.id});
    (i.parts||[]).forEach(function(p,idx){if(Number(p.cost)>0)push({id:'part:'+i.id+':'+(p.id||idx),date:p.date||sourced,type:'part_purchase',direction:'out',amount:p.cost,description:'Part / repair · '+(p.description||p.desc||i.item||'Item'),source:'item',itemId:i.id});});
    // Original insertion fee occurs when first listed.
    if(Number(i.listingFee)>0)push({id:'listing:'+i.id,date:i.dateListed||sourced,type:'listing_fee',direction:'out',amount:i.listingFee,description:'Listing fee · '+(i.item||'Item'),source:'item',itemId:i.id});
    // Every return-driven relist carries its own dated insertion fee snapshot.
    (i.returnHistory||[]).forEach(function(r,idx){
      if(r&&r._relistedAt&&Number(r._listingFeeAtRelist)>0)push({id:'relistfee:'+i.id+':'+idx,date:String(r._relistedAt).slice(0,10),type:'listing_fee',direction:'out',amount:r._listingFeeAtRelist,description:'Relist fee · '+(i.item||'Item')+' · next sale',source:'item',itemId:i.id});
    });
    // Sale cycles: gross cash in, then the actual selling cash outflows.
    _saleCycleNumbers(i).forEach(function(n){
      const cyc=_saleCycleSnapshot(i,n);if(!cyc||!cyc.date)return;
      const gross=+(Math.max(0,Number(cyc.price)||0)+_sellerPostageIncome(cyc.platformId,cyc.postage)).toFixed(2);
      push({id:'sale:'+i.id+':'+n,date:cyc.date,type:'sale_receipt',direction:'in',amount:gross,description:'Sale '+n+' receipt · '+(i.item||'Item'),source:'sale',itemId:i.id,saleNo:n});
      const fee=calcPlatformBPF(i,cyc.price||0,cyc.postage||0,cyc.platformId);if(fee>0)push({id:'fee:'+i.id+':'+n,date:cyc.date,type:'platform_fee',direction:'out',amount:fee,description:'Platform fee · Sale '+n+' · '+(i.item||'Item'),source:'sale',itemId:i.id,saleNo:n});
      const promo=_calcPromoFee(cyc.platformId,cyc.price||0,cyc.postage||0,cyc.promoPercent||0);if(promo>0)push({id:'promo:'+i.id+':'+n,date:cyc.date,type:'promo_fee',direction:'out',amount:promo,description:'Promoted listing · Sale '+n+' · '+(i.item||'Item'),source:'sale',itemId:i.id,saleNo:n});
      if(Number(cyc.shipping)>0)push({id:'ship:'+i.id+':'+n,date:cyc.date,type:'shipping',direction:'out',amount:cyc.shipping,description:'Shipping · Sale '+n+' · '+(i.item||'Item'),source:'sale',itemId:i.id,saleNo:n});
      if(Number(cyc.packaging)>0)push({id:'pkg:'+i.id+':'+n,date:cyc.date,type:'packaging',direction:'out',amount:cyc.packaging,description:'Packaging · Sale '+n+' · '+(i.item||'Item'),source:'sale',itemId:i.id,saleNo:n});
    });
    // Refunds/returns are dated independently of the sale. Fee credits are real
    // cash returned by the platform; COGS restoration is inventory, not cash.
    (i.returnHistory||[]).forEach(function(r,idx){
      const d=_returnEventDate(r);if(!d)return;const impact=_returnEventImpact(i,r);
      if(impact.refund>0)push({id:'refund:'+i.id+':'+idx,date:d,type:'customer_refund',direction:'out',amount:impact.refund,description:'Customer refund · Sale '+(Math.max(1,Number(r.saleNo)||1))+' · '+(i.item||'Item'),source:'return',itemId:i.id,saleNo:Math.max(1,Number(r.saleNo)||1)});
      if(impact.feeCredit>0)push({id:'refundcredit:'+i.id+':'+idx,date:d,type:'fee_refund',direction:'in',amount:impact.feeCredit,description:'Platform fee credit · Sale '+(Math.max(1,Number(r.saleNo)||1))+' · '+(i.item||'Item'),source:'return',itemId:i.id,saleNo:Math.max(1,Number(r.saleNo)||1)});
      if(impact.postage>0)push({id:'returnpost:'+i.id+':'+idx,date:d,type:'return_postage',direction:'out',amount:impact.postage,description:'Return postage · Sale '+(Math.max(1,Number(r.saleNo)||1))+' · '+(i.item||'Item'),source:'return',itemId:i.id,saleNo:Math.max(1,Number(r.saleNo)||1)});
    });
    if(i.scrapReason==='supplier_return'&&Number(i.supplierRefund)>0)push({id:'supplierrefund:'+i.id,date:i.supplierRefundDate||(i.scrappedAt?String(i.scrappedAt).slice(0,10):null),type:'supplier_refund',direction:'in',amount:i.supplierRefund,description:'Supplier return refund · '+(i.item||'Item'),source:'item',itemId:i.id});
  });});
  // Real business expenses. Mileage allowance itself is not cash.
  (DB.expenses||[]).forEach(function(e){if(Number(e.amount)>0)push({id:'expense:'+e.id,date:e.date||null,type:'expense',direction:'out',amount:e.amount,description:e.description||e.category||'Business expense',source:'expense'});});
  (DB.trips||[]).forEach(function(t){(Array.isArray(t.expenses)?t.expenses:[]).forEach(function(e,idx){if(Number(e.amount)>0)push({id:'tripexp:'+t.id+':'+idx,date:e.date||t.date||null,type:'trip_expense',direction:'out',amount:e.amount,description:e.description||('Trip expense · '+(t.description||'Sourcing trip')),source:'expense'});});});
  // Paid account settlements are the authoritative supplier/partner cash outflow.
  (typeof _accounts!=='undefined'?_accounts:[]).forEach(function(acct){(acct.settlements||[]).forEach(function(tx){if(!tx||!tx.paid)return;const amt=Math.max(0,Number(tx.partnerAmount)||0);if(amt>0)push({id:'settlement:'+tx.id,date:tx.date||null,type:'partner_settlement',direction:'out',amount:amt,description:'Settlement paid · '+(acct.name||'Partner')+' · '+((tx.items||[]).length)+' item'+((tx.items||[]).length===1?'':'s'),source:'settlement'});});});
  return out.sort(function(a,b){return (a.date||'').localeCompare(b.date||'')||String(a.id).localeCompare(String(b.id));});
}
function calcCashSummary(){
  const events=_cashEventsAll();
  let opening=0,contrib=0,draw=0,adjust=0,contribFY=0,drawFY=0,inflows=0,outflows=0,operatingCash=0;
  const fyS=(typeof _currentFYStart==='function')?_currentFYStart():new Date().getFullYear();const fyFrom=fyS+'-04-06',fyTo=(fyS+1)+'-04-05';
  const inFY=function(d){return d&&d>=fyFrom&&d<=fyTo;};
  events.forEach(function(e){const amt=Number(e.amount)||0;const signed=e.direction==='out'?-amt:amt;if(e.direction==='out')outflows+=amt;else inflows+=amt;
    if(e.type==='opening_balance')opening+=amt;else if(e.type==='owner_contribution'){contrib+=amt;if(inFY(e.date))contribFY+=amt;}else if(e.type==='owner_draw'){draw+=amt;if(inFY(e.date))drawFY+=amt;}else if(e.type==='adjustment')adjust+=signed;else operatingCash+=signed;});
  const cashAvailable=+(inflows-outflows).toFixed(2);
  const s=(typeof calcYearlyStats==='function')?calcYearlyStats('all'):{realisedProfit:0,netProfit:0};
  const unpaidLiabilities=_cashUnpaidSoldLiabilities();
  const stockTied=_cashStockTied();
  const netProfit=+(Number(s.netProfit)||0).toFixed(2),grossProfit=+(Number(s.realisedProfit)||0).toFixed(2);
  return {events:events,opening:+opening.toFixed(2),contrib:+contrib.toFixed(2),draw:+draw.toFixed(2),adjust:+adjust.toFixed(2),contribFY:+contribFY.toFixed(2),drawFY:+drawFY.toFixed(2),
    inflows:+inflows.toFixed(2),outflows:+outflows.toFixed(2),operatingCash:+operatingCash.toFixed(2),cashAvailable:cashAvailable,
    unpaidLiabilities:unpaidLiabilities,stockTied:stockTied,cashOverheads:_cashOverheadsAllTime(),capitalLost:_cashCapitalNetLost(),
    netProfit:netProfit,grossProfit:grossProfit,accruedTradingProfit:grossProfit,tradingCashMargin:+operatingCash.toFixed(2),
    netOwner:+(draw-contrib).toFixed(2),profitRetained:+(netProfit-draw+contrib).toFixed(2)};
}

const UK_TAX_RATES={
  2026:{pa:12570,paTaperStart:100000,c2weekly:3.65,c2spt:7105,c2mandatory:false,c4low:0.06,c4high:0.02,c4upper:50270,
    rUK:[[37700,0.20],[125140,0.40],[Infinity,0.45]],
    scotland:[[3967,0.19],[16956,0.20],[31092,0.21],[62430,0.42],[125140,0.45],[Infinity,0.48]]},
  2025:{pa:12570,paTaperStart:100000,c2weekly:3.50,c2spt:6845,c2mandatory:false,c4low:0.06,c4high:0.02,c4upper:50270,
    rUK:[[37700,0.20],[125140,0.40],[Infinity,0.45]],
    scotland:[[2827,0.19],[14921,0.20],[31092,0.21],[62430,0.42],[125140,0.45],[Infinity,0.48]]},
  2024:{pa:12570,paTaperStart:100000,c2weekly:3.45,c2spt:6725,c2mandatory:false,c4low:0.06,c4high:0.02,c4upper:50270,
    rUK:[[37700,0.20],[125140,0.40],[Infinity,0.45]],
    scotland:[[2306,0.19],[13991,0.20],[31092,0.21],[62430,0.42],[125140,0.45],[Infinity,0.48]]},
  2023:{pa:12570,paTaperStart:100000,c2weekly:3.45,c2spt:6725,c2chargeAt:12570,c2mandatory:true,c4low:0.09,c4high:0.02,c4upper:50270,
    rUK:[[37700,0.20],[125140,0.40],[Infinity,0.45]],
    scotland:[[2162,0.19],[13118,0.20],[31092,0.21],[125140,0.42],[Infinity,0.47]]}
};

function _taxRateConfig(year){return UK_TAX_RATES[year]||UK_TAX_RATES[2025];}

function _taxRegion(){
  let v=DB._taxRegion;
  if(!v){try{v=localStorage.getItem('retrade_tax_region');}catch(e){}}
  return v==='scotland'?'scotland':'rUK';
}

function _personalAllowanceForIncome(gross,rate){
  const g=Math.max(0,+gross||0), base=rate.pa||12570, start=rate.paTaperStart||100000;
  return Math.max(0,base-Math.max(0,g-start)/2);
}

function _incomeTaxForGross(gross,year,region){
  const rate=_taxRateConfig(year), g=Math.max(0,+gross||0);
  const pa=_personalAllowanceForIncome(g,rate);
  let taxable=Math.max(0,g-pa), prev=0, tax=0;
  const bands=rate[region==='scotland'?'scotland':'rUK']||rate.rUK;
  for(const band of bands){
    const top=band[0], pct=band[1];
    const amount=Math.max(0,Math.min(taxable,top)-prev);
    tax+=amount*pct;
    if(taxable<=top)break;
    prev=top;
  }
  return +tax.toFixed(2);
}

function _selfEmploymentIncomeTax(seProfit,otherIncome,year,region){
  const se=Math.max(0,+seProfit||0), other=Math.max(0,+otherIncome||0);
  return +Math.max(0,_incomeTaxForGross(other+se,year,region)-_incomeTaxForGross(other,year,region)).toFixed(2);
}

function _taxOtherIncome(){
  let v=+DB._taxOtherIncome||0;
  if(!v){try{v=+localStorage.getItem('retrade_tax_other_income')||0;}catch(e){}}
  return Math.max(0,v);
}

function _periodDateRange(period){
  const today=new Date();
  const todayStr=today.toISOString().split('T')[0];
  const daysAgo=function(n){const d=new Date(today);d.setDate(d.getDate()-n);return d.toISOString().split('T')[0];}
  if(period==='7d')  return{from:daysAgo(6),  to:todayStr};
  if(period==='30d') return{from:daysAgo(29), to:todayStr};
  if(period==='60d') return{from:daysAgo(59), to:todayStr};
  if(period==='90d') return{from:daysAgo(89), to:todayStr};
  if(period==='current_fy'||!period){
    const fy=_currentFYStart();
    return{from:fy+'-04-06',to:(fy+1)+'-04-05'}; // UK tax year 6 Apr–5 Apr (matches Tax Return / _buildPnLSummary)
  }
  if(period==='prev_fy'){
    const fy=_currentFYStart()-1;
    return{from:fy+'-04-06',to:(fy+1)+'-04-05'}; // UK tax year 6 Apr–5 Apr
  }
  return{from:null,to:null}; // all time
}

function _originalSale1Date(i){
  if(!i)return null;
  if(i.dateSold)return i.dateSold;
  const full=(i.returnHistory||[]).find(function(r){
    return (r.type==='full_seller'||r.type==='full_ebay')&&(Number(r.saleNo)||1)===1;
  });
  return (full&&full._dateSoldAtReturn)
    ||(full&&full.loggedAt?String(full.loggedAt).slice(0,10):null)
    ||null;
}

function calcYearlyStats(period){
  const range=_periodDateRange(period||SUMMARY_PERIOD);
  const inRange=function(ds){if(!ds)return false;if(!range.from)return true;return ds>=range.from&&ds<=range.to;};
  const events=getSaleEventsInRange(range.from,range.to);
  const sales=events.filter(function(e){return !e.isReturnAdjustment;});
  const returns=events.filter(function(e){return e.isReturnAdjustment;});
  let totalRev=0,realisedProfit=0;
  sales.forEach(function(ev){const b=_saleBreakdown(ev);totalRev+=(Number(b.salePrice)||0)+(Number(b.postage)||0);realisedProfit+=Number(ev.profit)||0;});
  returns.forEach(function(ev){totalRev+=Number(ev.salePrice)||0;realisedProfit+=Number(ev.profit)||0;});
  totalRev=+totalRev.toFixed(2);realisedProfit=+realisedProfit.toFixed(2);

  const soldCount=sales.length;
  const saleTransactions=sales.map(function(ev){return Number(ev.salePrice)||0;});
  const roiVals=sales.map(function(ev){return ev.roi;}).filter(function(v){return v!==null&&v!==undefined&&Number.isFinite(Number(v));}).map(Number);
  const marginVals=sales.map(function(ev){return ev.margin;}).filter(function(v){return v!==null&&v!==undefined&&Number.isFinite(Number(v));}).map(Number);
  const dayVals=sales.map(function(ev){return ev.daysToSell;}).filter(function(v){return v!==null&&v!==undefined&&Number.isFinite(Number(v));}).map(Number);
  const avgROI=roiVals.length?roiVals.reduce(function(a,b){return a+b;},0)/roiVals.length:0;
  const avgMargin=marginVals.length?marginVals.reduce(function(a,b){return a+b;},0)/marginVals.length:0;
  const avgSale=saleTransactions.length?saleTransactions.reduce(function(a,b){return a+b;},0)/saleTransactions.length:0;
  const saleProfitOnly=sales.reduce(function(sum,ev){return sum+(Number(ev.profit)||0);},0);
  const avgProfit=sales.length?saleProfitOnly/sales.length:0;
  const avgDays=dayVals.length?Math.round(dayVals.reduce(function(a,b){return a+b;},0)/dayVals.length):0;
  const avgCostPrice=sales.length?sales.reduce(function(sum,ev){return sum+(Number(ev.item&&ev.item.costPrice)||0);},0)/sales.length:0;

  // Refund-rate cohort: among sale transactions made IN this period, how many
  // were eventually affected by a refund? Refund cash itself remains dated to
  // the actual return event for revenue/profit and cashflow.
  let fullRefundCount=0,partialOnlyCount=0;
  sales.forEach(function(ev){
    const n=Math.max(1,Number(ev.sale)||1),rh=(ev.item&&ev.item.returnHistory)||[];
    const cycle=rh.filter(function(r){return Math.max(1,Number(r.saleNo)||1)===n;});
    if(cycle.some(function(r){return r.type==='full_seller'||r.type==='full_ebay';}))fullRefundCount++;
    else if(cycle.some(function(r){return r.type==='partial_seller'||r.type==='partial_ebay';}))partialOnlyCount++;
  });
  const refundedItemCount=fullRefundCount+partialOnlyCount,refundedSalesItemCount=refundedItemCount;
  const refundDenom=soldCount;
  const refundItemRate=refundDenom?refundedItemCount/refundDenom*100:0;
  const returnCount=returns.filter(function(ev){const r=ev.returnEntry||{};return r.type==='full_seller'||r.type==='full_ebay';}).length;
  const returnRate=refundDenom?fullRefundCount/refundDenom*100:0;
  const partialRefundCount=partialOnlyCount;
  const partialRefundRate=refundDenom?partialOnlyCount/refundDenom*100:0;
  const totalAffected=refundedItemCount;
  const refundMoneyTotal=returns.reduce(function(sum,ev){return sum+Math.max(0,-(Number(ev.salePrice)||0));},0);
  const refundMoneyDenom=sales.reduce(function(sum,ev){const b=_saleBreakdown(ev);return sum+(Number(b.salePrice)||0)+(Number(b.postage)||0);},0);
  const refundMoneyRate=refundMoneyDenom?refundMoneyTotal/refundMoneyDenom*100:0;

  // Physical stock snapshot is independent of the selected sales period. KPIs
  // need to know what is on hand NOW, while stale/listed-in-period metrics are
  // date-scoped below.
  let listedCount=0,totalItems=0,stockValue=0,unrealisedProfit=0;
  const stale=[],today=new Date().toISOString().split('T')[0];
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if((i.item||'').trim().toUpperCase()==='MONTH END')return;totalItems++;
    const onHand=!i.scrappedAt&&(i.isReturned||(!i.dateSold&&!i.resaleSalePrice));
    if(!onHand)return;
    if(!i.isReturned){listedCount++;stockValue+=Number(i.estSalePrice!=null?i.estSalePrice:i.salePrice)||0;unrealisedProfit+=Number(calcEstProfit(i))||0;}
    const listedAt=i._lastRelistAt||i.dateListed||i.dateSourced;
    if(!i.isReturned&&listedAt&&daysBetween(listedAt,today)>=90&&(!range.from||inRange(listedAt)))stale.push(i);
  });});

  // Sell-through and velocity are listing-cycle metrics. Each Sale-N carries its
  // own listedDate snapshot, so repeat returns do not collapse into one item.
  let stItems=0,stSold=0;const eligible14=[];
  sales.forEach(function(ev){
    const cyc=ev.snapshot||_saleCycleSnapshot(ev.item,ev.sale);const listed=cyc&&cyc.listedDate;
    if((listed&&inRange(listed))||inRange(ev.saleDate)){stItems++;stSold++;}
    if(ev.daysToSell!==null&&ev.daysToSell!==undefined)eligible14.push({sold14:Number(ev.daysToSell)<=14});
  });
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if((i.item||'').trim().toUpperCase()==='MONTH END'||i.scrappedAt||i.isReturned||i.dateSold||i.resaleSalePrice)return;
    const listed=i._lastRelistAt||i.dateListed;if(!listed||!inRange(listed))return;
    stItems++;
    const d=daysBetween(listed,today);if(d>=14)eligible14.push({sold14:false});
  });});
  const sellThrough=stItems?stSold/stItems*100:0;
  const sold14Count=eligible14.filter(function(x){return x.sold14;}).length;
  const sellThrough14=eligible14.length?sold14Count/eligible14.length*100:0;

  // Category analytics consume the same transaction cycles as the headline.
  const catMap={};
  const catEnsure=function(cat){return catMap[cat]||(catMap[cat]={sold:0,total:0,daysSum:0,stale:0,fast:0,avgS:0,slow:0,profitSum:0,revSum:0});};
  sales.forEach(function(ev){const cat=(ev.item&&ev.item.category)||'Uncategorised',v=catEnsure(cat),b=_saleBreakdown(ev);v.total++;v.sold++;if(ev.daysToSell!==null&&ev.daysToSell!==undefined){const d=Number(ev.daysToSell)||0;v.daysSum+=d;if(d<=14)v.fast++;else if(d<=30)v.avgS++;else v.slow++;}v.profitSum+=Number(ev.profit)||0;v.revSum+=(Number(b.salePrice)||0)+(Number(b.postage)||0);});
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){if((i.item||'').trim().toUpperCase()==='MONTH END'||i.scrappedAt||i.isReturned||i.dateSold||i.resaleSalePrice)return;const listed=i._lastRelistAt||i.dateListed;if(!listed||!inRange(listed))return;const v=catEnsure(i.category||'Uncategorised');v.total++;if(daysBetween(listed,today)>=90)v.stale++;});});
  const byCat=Object.keys(catMap).map(function(cat){const v=catMap[cat];return{cat:cat,sold:v.sold,total:v.total,pct:v.total?Math.round(v.sold/v.total*100):0,avgDays:v.sold?Math.round(v.daysSum/v.sold):null,avgProfit:v.sold?+(v.profitSum/v.sold).toFixed(2):null,totalProfit:+v.profitSum.toFixed(2),totalRev:+v.revSum.toFixed(2),fast:v.fast,avgS:v.avgS,slow:v.slow,stale:v.stale};}).sort(function(a,b){if(b.total!==a.total)return b.total-a.total;return(a.avgDays===null?999:a.avgDays)-(b.avgDays===null?999:b.avgDays);});
  const totalStaleCount=byCat.reduce(function(sum,c){return sum+(c.stale||0);},0);

  const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);let tripsCostInPeriod=0,expensesCostInPeriod=0;
  _allTrips.forEach(function(t,idx){if(inRange(t.date))tripsCostInPeriod+=(_tieredTrips[idx]?_tieredTrips[idx].totalCost:0);});
  (DB.expenses||[]).forEach(function(e){if(inRange(e.date))expensesCostInPeriod+=(Number(e.amount)||0);});
  const overheadsInPeriod=+(tripsCostInPeriod+expensesCostInPeriod).toFixed(2);
  const grossProfit=+realisedProfit.toFixed(2),grossMargin=avgMargin;
  const netProfit=+(grossProfit-overheadsInPeriod).toFixed(2),netMargin=totalRev?+((netProfit/totalRev)*100).toFixed(1):0;
  return{totalRev:totalRev,realisedProfit:grossProfit,unrealisedProfit:+unrealisedProfit.toFixed(2),stockValue:+stockValue.toFixed(2),soldCount:soldCount,listedCount:listedCount,totalItems:totalItems,
    fullRefundCount:fullRefundCount,partialOnlyCount:partialOnlyCount,refundedItemCount:refundedItemCount,refundedSalesItemCount:refundedSalesItemCount,refundItemRate:refundItemRate,refundDenom:refundDenom,
    returnCount:returnCount,returnRate:returnRate,partialRefundCount:partialRefundCount,partialRefundRate:partialRefundRate,totalAffected:totalAffected,
    refundMoneyRate:refundMoneyRate,refundMoneyTotal:+refundMoneyTotal.toFixed(2),refundMoneyDenom:+refundMoneyDenom.toFixed(2),avgROI:avgROI,avgMargin:avgMargin,avgSale:avgSale,avgProfit:avgProfit,avgCostPrice:avgCostPrice,
    sellThrough:sellThrough,sellThrough14:sellThrough14,sold14Count:sold14Count,eligible14Count:eligible14.length,avgDays:avgDays,stale:stale,byCat:byCat,totalStaleCount:totalStaleCount,
    grossProfit:grossProfit,grossMargin:grossMargin,netProfit:netProfit,netMargin:netMargin,tripsCostInPeriod:+tripsCostInPeriod.toFixed(2),expensesCostInPeriod:+expensesCostInPeriod.toFixed(2),overheadsInPeriod:overheadsInPeriod};
}

function calcSummaryStats(){ return calcYearlyStats(SUMMARY_PERIOD); }

function getSummaryDateRange(){ return _periodDateRange(SUMMARY_PERIOD); }

function _prevPeriodKey(period){
  // Rolling windows: compare to the window of equal length immediately before.
  // FY: compare to previous FY. All-time: no comparison.
  const map={ '7d':'_prev7d', '30d':'_prev30d', '60d':'_prev60d', '90d':'_prev90d',
              'current_fy':'prev_fy', 'prev_fy':null, 'all':null };
  return map[period||'current_fy'];
}

function _prevPeriodRange(period){
  // For the synthetic "_prevNNd" keys, build the preceding equal-length window.
  const m=/^_prev(\d+)d$/.exec(period||'');
  if(m){
    const n=parseInt(m[1],10);
    const today=new Date();
    const daysAgo=function(x){const d=new Date(today);d.setDate(d.getDate()-x);return d.toISOString().split('T')[0];};
    return { from:daysAgo(n*2), to:daysAgo(n+1) };  // the window before the current one
  }
  return _periodDateRange(period);
}

function _statsForRange(range){
  const evs=getSaleEventsInRange(range&&range.from,range&&range.to),sales=evs.filter(function(e){return !e.isReturnAdjustment;}),rets=evs.filter(function(e){return e.isReturnAdjustment;});
  let totalRev=0,realised=0;evs.forEach(function(e){if(e.isReturnAdjustment)totalRev+=Number(e.salePrice)||0;else{const b=_saleBreakdown(e);totalRev+=(Number(b.salePrice)||0)+(Number(b.postage)||0);}realised+=Number(e.profit)||0;});
  let fullRef=0,partialOnly=0;sales.forEach(function(ev){const n=Math.max(1,Number(ev.sale)||1),rh=(ev.item&&ev.item.returnHistory)||[],cy=rh.filter(function(r){return Math.max(1,Number(r.saleNo)||1)===n;});if(cy.some(function(r){return r.type==='full_seller'||r.type==='full_ebay';}))fullRef++;else if(cy.some(function(r){return r.type==='partial_seller'||r.type==='partial_ebay';}))partialOnly++;});
  const refundItemRate=sales.length?((fullRef+partialOnly)/sales.length*100):0,netMargin=totalRev?(realised/totalRev*100):0,avgProfit=sales.length?(sales.reduce(function(sum,e){return sum+(Number(e.profit)||0);},0)/sales.length):0;
  return{totalRev:+totalRev.toFixed(2),grossProfit:+realised.toFixed(2),grossMargin:netMargin,netProfit:+realised.toFixed(2),netMargin:netMargin,soldCount:sales.length,refundItemRate:refundItemRate,avgProfit:avgProfit};
}

function calcSummaryDeltas(){
  const prevKey=_prevPeriodKey(SUMMARY_PERIOD);
  if(!prevKey)return null;  // all-time / prev_fy → no baseline
  const cur=calcSummaryStats();
  const prev=_statsForRange(_prevPeriodRange(prevKey));
  // % change helper. Returns null when prior baseline is ~0 (a % is meaningless
  // / would read as +∞). For refund rate, lower is better → invert "good".
  const pct=function(c,p){
    if(p===null||p===undefined||Math.abs(p)<0.005)return null;
    return ((c-p)/Math.abs(p))*100;
  };
  const periodLabel=(SUMMARY_PERIOD==='current_fy')?'vs last FY'
    :(/^\d+d$/.test(SUMMARY_PERIOD)?('vs prev '+SUMMARY_PERIOD.replace('d',' days')):'vs prev period');
  return {
    label: periodLabel,
    totalRev:    pct(cur.totalRev,    prev.totalRev),
    grossProfit: pct(cur.grossProfit, prev.grossProfit),
    grossMargin: (prev.grossMargin!==undefined? (cur.grossMargin-prev.grossMargin):null), // pp change
    netProfit:   pct(cur.netProfit,   prev.netProfit),
    netMargin:   (prev.netMargin!==undefined? (cur.netMargin-prev.netMargin):null), // pp change
    soldCount:   pct(cur.soldCount,   prev.soldCount),
    refundItemRate: (cur.refundItemRate-prev.refundItemRate), // pp change; lower better
    avgProfit:   pct(cur.avgProfit,   prev.avgProfit)
  };
}

function allItems(){ const r=[]; allDBKeys().forEach(function(k){ if(k==='trips'||k==='expenses'||k==='_userOwned'||k==='_taxYear')return; (DB[k]||[]).forEach(function(i){ r.push(i); }); }); return r; }

function _monthKeyFromDate(ds){
  if(!ds)return null;
  // Tolerate both 'YYYY-MM-DD' (ISO) and dates with time. Avoid Date() parse drift.
  const parts=String(ds).slice(0,10).split('-');
  if(parts.length<3)return null;
  const yr=parseInt(parts[0],10);
  const mo=parseInt(parts[1],10);
  if(!yr||!mo||mo<1||mo>12)return null;
  return MONTHS[mo-1]+'-'+String(yr).slice(-2);
}

function _returnEventDate(r){
  return r&&r.loggedAt?String(r.loggedAt).slice(0,10):null;
}

function _currentResaleCycleNo(i){
  const relisted=((i&&i.returnHistory)||[]).filter(function(r){
    return (r.type==='full_seller'||r.type==='full_ebay')&&r._relistedAt;
  });
  let max=1;
  relisted.forEach(function(r){max=Math.max(max,Number(r.saleNo)||1);});
  return Math.max(2,max+1);
}
function _archivedResaleFullReturns(i){
  return ((i&&i.returnHistory)||[]).filter(function(r){
    return (r.type==='full_seller'||r.type==='full_ebay')&&(Number(r.saleNo)||1)>=2&&!!r._relistedAt;
  });
}
function _failedCycleLoss(i,r){
  const saleNo=Math.max(1,Number(r&&r.saleNo)||1);
  const isResale=saleNo>=2;
  const price=Math.max(0,Number(r&&r._salePriceAtReturn)||Number(r&&r._salePriceAtRelist)||0);
  const post=Math.max(0,Number(r&&r._postageAtReturn)!=null?Number(r._postageAtReturn):Number(r&&r._postageAtRelist)||0);
  const platformId=(r&&r._platformAtReturn)||(isResale?(i.resalePlatform||_itemPlatform(i)):_s1Platform(i));
  const promoPct=Math.max(0,Number(r&&r._promoPercentAtReturn)!=null?Number(r._promoPercentAtReturn):Number(r&&r._promoPercentAtRelist)||0);
  // Freeze fulfilment against the completed sale. Newer return rows carry
  // *_AtReturn; legacy rows may only have the pre-relist snapshot, and very
  // old Sale 1 rows fall back to the item's original fulfilment values.
  const _maxFullSale=((i&&i.returnHistory)||[]).reduce(function(mx,x){return (x&&(x.type==='full_seller'||x.type==='full_ebay'))?Math.max(mx,Math.max(1,Number(x.saleNo)||1)):mx;},0);
  const _liveReturnedResale=(saleNo>=2&&i&&i.isReturned&&i.resaleSalePrice&&saleNo===_maxFullSale);
  const ship=Math.max(0,Number(r&&r._shippingCostAtReturn!=null?r._shippingCostAtReturn:(r&&r._shippingCostAtRelist!=null?r._shippingCostAtRelist:(_liveReturnedResale?(i.resaleShippingCost!=null?i.resaleShippingCost:i.shippingCost):(saleNo===1?i.shippingCost:0))))||0);
  const pkg=Math.max(0,Number(r&&r._packagingCostAtReturn!=null?r._packagingCostAtReturn:(r&&r._packagingCostAtRelist!=null?r._packagingCostAtRelist:(_liveReturnedResale?(i.resalePackagingCost!=null?i.resalePackagingCost:i.packagingCost):(saleNo===1?i.packagingCost:0))))||0);
  const fee=_netPlatformFeeAfterRefunds(i,saleNo,platformId,price,post);
  const promo=_netPromoFeeAfterRefunds(i,saleNo,platformId,price,post,promoPct);
  const outbound=_sellerPaysOutbound(platformId)?ship+pkg:0;
  const retPost=Math.max(0,Number(r&&r.returnPostage)||0);
  return +(fee+promo+outbound+retPost).toFixed(2);
}

function _refundCreditsForEntry(i,r){
  const saleNo=Math.max(1,Number(r&&r.saleNo)||1);
  const is2=saleNo>=2;
  const price=Math.max(0,Number((r&&r._salePriceAtReturn)||(is2?i.resaleSalePrice:i.salePrice))||0);
  const post=Math.max(0,Number((r&&r._postageAtReturn)!=null?r._postageAtReturn:(is2?(i.resalePostage!=null?i.resalePostage:i.postage):i.postage))||0);
  const platformId=(r&&r._platformAtReturn)||(is2?(i.resalePlatform||_itemPlatform(i)):_s1Platform(i));
  const promoPct=Math.max(0,Number((r&&r._promoPercentAtReturn)!=null?r._promoPercentAtReturn:(is2?i.resalePromoPercent:i.promoPercent))||0);
  const amount=Math.max(0,Number(r&&r.refundAmount)||0);
  const full=!!(r&&(r.type==='full_seller'||r.type==='full_ebay'));
  const sellerHandled=!!(r&&(r.type==='full_seller'||r.type==='partial_seller'));
  const orderTotal=Math.max(0.01,price+post);
  const ratio=full?1:Math.max(0,Math.min(1,amount/orderTotal));
  let platformCredit=0,promoCredit=0;

  if(platformId==='ebay'){
    // Private-eBay Buyer Protection is paid by the buyer. When a buyer-facing
    // refund is logged, reverse the corresponding BPF portion on that SAME
    // refund event so it never becomes a phantom seller cash outflow.
    const itemRatio=full?1:Math.max(0,Math.min(1,amount/Math.max(0.01,price)));
    platformCredit=calcEbayBPF(price)*itemRatio;
    if(sellerHandled)promoCredit=_calcPromoFee(platformId,price,post,promoPct)*ratio;
  }else if(platformId==='ebay_biz'){
    if(sellerHandled){
      const c=_calcEbayBizFeeComponents(price+post,i&&i.category,price);
      platformCredit=c.eligibleRefundableGross*ratio;
      promoCredit=_calcPromoFee(platformId,price,post,promoPct)*ratio;
    }
  }else if(platformId==='depop'){
    // Depop refunds are modelled proportionally in RETRADE. Keep the credit on
    // the refund date rather than rewriting the original sale event.
    platformCredit=calcPlatformBPF(i,price,post,platformId)*ratio;
    promoCredit=_calcPromoFee(platformId,price,post,promoPct)*ratio;
  }
  return {
    saleNo:saleNo,platformId:platformId,price:price,postage:post,
    platformCredit:+Math.max(0,platformCredit).toFixed(2),
    promoCredit:+Math.max(0,promoCredit).toFixed(2)
  };
}

function _returnEventImpact(i,r){
  const refund=Number(r&&r.refundAmount)||0;
  const postage=Number(r&&r.returnPostage)||0;
  const credits=_refundCreditsForEntry(i,r||{});
  const feeCredit=credits.platformCredit+credits.promoCredit;
  const profitImpact=-(refund+postage)+feeCredit;
  return {
    refund:+refund.toFixed(2),postage:+postage.toFixed(2),
    platformCredit:credits.platformCredit,promoCredit:credits.promoCredit,
    feeCredit:+feeCredit.toFixed(2),profit:+profitImpact.toFixed(2)
  };
}

function _fullReturnEntryForSale(i,saleNo){
  const target=Math.max(1,Number(saleNo)||1);
  return ((i&&i.returnHistory)||[]).slice().reverse().find(function(r){
    return (r.type==='full_seller'||r.type==='full_ebay')&&(Math.max(1,Number(r.saleNo)||1)===target);
  })||null;
}
function _priorRelistEntryForSale(i,saleNo){
  const n=Math.max(1,Number(saleNo)||1);if(n<=1)return null;
  return _fullReturnEntryForSale(i,n-1);
}
function _saleCycleSnapshot(i,saleNo){
  const n=Math.max(1,Number(saleNo)||1);
  if(!i)return null;
  if(n===1){
    const fr=_fullReturnEntryForSale(i,1);
    const date=i.dateSold||(fr&&fr._dateSoldAtReturn)||null;
    if(!date)return null;
    const price=Math.max(0,Number(fr&&fr._salePriceAtReturn!=null?fr._salePriceAtReturn:(fr&&fr._salePriceAtRelist!=null?fr._salePriceAtRelist:i.salePrice))||0);
    const postage=Math.max(0,Number(fr&&fr._postageAtReturn!=null?fr._postageAtReturn:(fr&&fr._postageAtRelist!=null?fr._postageAtRelist:i.postage))||0);
    const platformId=(fr&&fr._platformAtReturn)||i.salePlatform||_s1Platform(i);
    const promoPercent=Math.max(0,Number(fr&&fr._promoPercentAtReturn!=null?fr._promoPercentAtReturn:(fr&&fr._promoPercentAtRelist!=null?fr._promoPercentAtRelist:i.promoPercent))||0);
    const shipping=Math.max(0,Number(fr&&fr._shippingCostAtReturn!=null?fr._shippingCostAtReturn:(fr&&fr._shippingCostAtRelist!=null?fr._shippingCostAtRelist:i.shippingCost))||0);
    const packaging=Math.max(0,Number(fr&&fr._packagingCostAtReturn!=null?fr._packagingCostAtReturn:(fr&&fr._packagingCostAtRelist!=null?fr._packagingCostAtRelist:i.packagingCost))||0);
    return {saleNo:1,date:date,price:price,postage:postage,platformId:platformId,promoPercent:promoPercent,
      shipping:shipping,packaging:packaging,listingFee:Math.max(0,Number(i.listingFee)||0),listedDate:i.dateListed||null,
      bundleId:(fr&&fr._bundleIdAtReturn)||i.bundleId||null,bundleRef:(fr&&fr._bundleRefAtReturn)||i.bundleRef||'',bundleTotal:Number(fr&&fr._bundleTotalAtReturn!=null?fr._bundleTotalAtReturn:i.bundleTotal)||0,
      fullReturnEntry:fr,isReturned:!!fr};
  }
  const archived=_fullReturnEntryForSale(i,n);
  const liveNo=(i.resaleSalePrice&&i.resaleDateSold)?_currentResaleCycleNo(i):null;
  const live=liveNo===n;
  if(!archived&&!live)return null;
  const prior=_priorRelistEntryForSale(i,n);
  const date=archived?(archived._dateSoldAtReturn||null):(i.resaleDateSold||null);
  if(!date)return null;
  const platformId=(archived&&archived._platformAtReturn)||(live?(i.resalePlatform||_itemPlatform(i)):null)||(prior&&prior._platformAtRelist)||_itemPlatform(i);
  const price=Math.max(0,Number(archived&&archived._salePriceAtReturn!=null?archived._salePriceAtReturn:(archived&&archived._salePriceAtRelist!=null?archived._salePriceAtRelist:i.resaleSalePrice))||0);
  const postage=Math.max(0,Number(archived&&archived._postageAtReturn!=null?archived._postageAtReturn:(archived&&archived._postageAtRelist!=null?archived._postageAtRelist:(i.resalePostage!=null?i.resalePostage:i.postage)))||0);
  const shipping=Math.max(0,Number(archived&&archived._shippingCostAtReturn!=null?archived._shippingCostAtReturn:(archived&&archived._shippingCostAtRelist!=null?archived._shippingCostAtRelist:(i.resaleShippingCost!=null?i.resaleShippingCost:i.shippingCost)))||0);
  const packaging=Math.max(0,Number(archived&&archived._packagingCostAtReturn!=null?archived._packagingCostAtReturn:(archived&&archived._packagingCostAtRelist!=null?archived._packagingCostAtRelist:(i.resalePackagingCost!=null?i.resalePackagingCost:i.packagingCost)))||0);
  const promoPercent=Math.max(0,Number(archived&&archived._promoPercentAtReturn!=null?archived._promoPercentAtReturn:(archived&&archived._promoPercentAtRelist!=null?archived._promoPercentAtRelist:(i.resalePromoPercent!=null?i.resalePromoPercent:i.promoPercent)))||0);
  let listingFee=0;
  if(archived&&archived._listingFeeAtReturn!=null)listingFee=Math.max(0,Number(archived._listingFeeAtReturn)||0);
  else if(prior&&prior._listingFeeAtRelist!=null)listingFee=Math.max(0,Number(prior._listingFeeAtRelist)||0);
  else if(live)listingFee=Math.max(0,Number(i.resaleListingFee)||0); // live Sale 2/3/4+ fallback
  return {saleNo:n,date:date,price:price,postage:postage,platformId:platformId,promoPercent:promoPercent,
    shipping:shipping,packaging:packaging,listingFee:listingFee,listedDate:(prior&&prior._relistedAt)||null,
    bundleId:(archived&&archived._bundleIdAtReturn)||(live?i.resaleBundleId:null)||null,bundleRef:(archived&&archived._bundleRefAtReturn)||(live?i.resaleBundleRef:'')||'',bundleTotal:Number(archived&&archived._bundleTotalAtReturn!=null?archived._bundleTotalAtReturn:(live?i.resaleBundleTotal:0))||0,
    fullReturnEntry:archived,isReturned:!!archived};
}
function _saleCycleNumbers(i){
  const nums=new Set();
  if(_saleCycleSnapshot(i,1))nums.add(1);
  ((i&&i.returnHistory)||[]).forEach(function(r){
    const n=Math.max(1,Number(r.saleNo)||1);
    if((r.type==='full_seller'||r.type==='full_ebay')&&r._dateSoldAtReturn)nums.add(n);
  });
  if(i&&i.resaleSalePrice&&i.resaleDateSold)nums.add(_currentResaleCycleNo(i));
  return Array.from(nums).sort(function(a,b){return a-b;});
}
function _saleCycleItemSnapshot(i,cycle){
  if(!cycle)return null;
  return Object.assign({},i,{
    salePrice:cycle.price,dateSold:cycle.date,postage:cycle.postage,shippingCost:cycle.shipping,
    packagingCost:cycle.packaging,promoPercent:cycle.promoPercent,listingFee:cycle.listingFee,
    defaultPlatform:cycle.platformId,soldOnPlatform:cycle.platformId,salePlatform:cycle.platformId,
    isReturned:false,state:'sold',returnHistory:[],resaleSalePrice:null,resaleDateSold:null,
    resalePlatform:null,resalePostage:null,resaleShippingCost:null,resalePackagingCost:null,resalePromoPercent:null,resaleListingFee:0
  });
}
function _sale1EventSnapshot(i){
  const c=_saleCycleSnapshot(i,1);return {item:c?_saleCycleItemSnapshot(i,c):Object.assign({},i),date:c&&c.date,price:c?c.price:0,cycle:c};
}
function _sale2EventSnapshot(i){
  const c=_saleCycleSnapshot(i,2);return {item:c?_saleCycleItemSnapshot(i,c):Object.assign({},i),date:c&&c.date,price:c?c.price:0,cycle:c};
}
function _saleEventForCycle(i,k,cycle){
  const snapItem=_saleCycleItemSnapshot(i,cycle);
  const ev={item:i,month:k,sale:String(cycle.saleNo),saleDate:cycle.date,salePrice:cycle.price,snapshot:cycle,
    roi:snapItem?calcROI(snapItem):null,margin:snapItem?calcMargin(snapItem):null,
    daysToSell:(cycle.listedDate&&cycle.date)?daysBetween(cycle.listedDate,cycle.date):null,
    isReturned:false,isReturnAdjustment:false};
  try{ev.profit=_saleBreakdown(ev).netProfit;}catch(e){ev.profit=0;}
  return ev;
}
function _returnEventsForItem(i,k,predicate){
  const out=[];
  (i.returnHistory||[]).forEach(function(r,idx){
    const d=_returnEventDate(r);if(!d||!predicate(d))return;
    const impact=_returnEventImpact(i,r);
    const ev={item:i,month:k,sale:'R',saleDate:d,salePrice:-impact.refund,profit:0,roi:null,margin:null,daysToSell:null,isReturned:true,
      isReturnAdjustment:true,returnEntry:r,returnIndex:idx};
    try{ev.profit=_saleBreakdown(ev).netProfit;}catch(e){ev.profit=impact.profit;}
    out.push(ev);
  });
  return out;
}
function _saleEventMonthKeys(){
  const set=new Set();
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if((i.item||'').trim().toUpperCase()==='MONTH END')return;
    _saleCycleNumbers(i).forEach(function(n){const c=_saleCycleSnapshot(i,n);const mk=c&&c.date?_monthKeyFromDate(c.date):null;if(mk)set.add(mk);});
    (i.returnHistory||[]).forEach(function(r){const d=_returnEventDate(r);const mk=d?_monthKeyFromDate(d):null;if(mk)set.add(mk);});
  });});
  return set;
}
function getSaleEventsInMonth(m){
  const out=[];
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if((i.item||'').trim().toUpperCase()==='MONTH END')return;
    _saleCycleNumbers(i).forEach(function(n){const c=_saleCycleSnapshot(i,n);if(c&&_monthKeyFromDate(c.date)===m)out.push(_saleEventForCycle(i,k,c));});
    _returnEventsForItem(i,k,function(d){return _monthKeyFromDate(d)===m;}).forEach(function(ev){out.push(ev);});
  });});
  return out;
}
function getSaleEventsInRange(from,to){
  const out=[];const inR=function(d){return d&&(!from||d>=from)&&(!to||d<=to);};
  allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
    if((i.item||'').trim().toUpperCase()==='MONTH END')return;
    _saleCycleNumbers(i).forEach(function(n){const cyc=_saleCycleSnapshot(i,n);if(cyc&&inR(cyc.date))out.push(_saleEventForCycle(i,k,cyc));});
    _returnEventsForItem(i,k,inR).forEach(function(ev){out.push(ev);});
  });});
  return out;
}

function _expensesInRange(from,to){
  const inR=function(d){return d && d>=from && d<=to;};
  const trips=(DB.trips||[]).filter(function(t){return inR(t.date);});
  const exps=(DB.expenses||[]).filter(function(e){return inR(e.date);});
  const rows=[]; let total=0;
  trips.forEach(function(t){
    const miles=t.mileage||0, rate=t.ratePerMile||0.45;
    const mileageCost=+(miles*rate).toFixed(2);
    const extraExps=(Array.isArray(t.expenses)?t.expenses:[]).reduce(function(s,e){return s+(e.amount||0);},0);
    const rowTotal=+(mileageCost+extraExps).toFixed(2);
    total+=rowTotal;
    rows.push([t.date||'',(t.description||'Sourcing trip').replace(/,/g,' '),'Mileage','',miles,rate.toFixed(2),mileageCost.toFixed(2),rowTotal.toFixed(2)]);
  });
  exps.forEach(function(e){
    const amt=e.amount||0; total+=amt;
    rows.push([e.date||'',(e.description||'Expense').replace(/,/g,' '),e.category||'',amt.toFixed(2),'','','',amt.toFixed(2)]);
  });
  return{trips:trips,expenses:exps,total:+total.toFixed(2),rows:rows};
}

function _unsoldStockCostInRange(from,to){
  const inR=function(d){return d && d>=from && d<=to;};
  let cost=0, count=0;
  const items=[];
  allDBKeys().forEach(function(k){
    (DB[k]||[]).forEach(function(i){
      if((i.item||'').trim().toUpperCase()==='MONTH END')return;
      // Fully returned stock is physically back in the business and its
      // acquisition/parts cost is tied up again. Only completed sales that are
      // NOT currently returned are excluded from the stock memo.
      if(i.scrappedAt)return;
      if(!i.isReturned&&(i.dateSold||i.resaleSalePrice))return;
      const st=i.isReturned?'returned':(i.state||'listed');
      if(st!=='sourced'&&st!=='listed'&&st!=='returned')return;
      const dSrc=i.dateSourced||i.dateListed||null;
      if(!inR(dSrc))return;
      const parts=calcPartsCost(i);
      const itemCost=(i.costPrice||0)+parts;
      cost+=itemCost; count++;
      items.push({item:i,month:k,dateSourced:dSrc,cost:+itemCost.toFixed(2)});
    });
  });
  return{cost:+cost.toFixed(2),count:count,items:items};
}

function _saleBreakdown(ev){
  const i=ev.item;
  if(ev.isReturnAdjustment){
    const r=ev.returnEntry||{};
    const impact=_returnEventImpact(i,r);
    const cr=_refundCreditsForEntry(i,r);
    const isFull=(r.type==='full_seller'||r.type==='full_ebay');
    // A full return physically restores the inventory basis. This is an
    // accounting COGS credit, not a cash inflow; Cashflow handles only refund,
    // fee-credit and return-postage movements.
    const itemCost=isFull?-(Number(i.costPrice)||0):0;
    const parts=isFull?-calcPartsCost(i):0;
    const totalCosts=+(impact.refund+impact.postage-impact.platformCredit-impact.promoCredit+itemCost+parts).toFixed(2);
    return{saleNo:'Sale '+Math.max(1,Number(r.saleNo)||1)+' return',platform:(PLATFORMS[cr.platformId]&&PLATFORMS[cr.platformId].short)||cr.platformId,
      salePrice:-impact.refund,postage:0,bpf:-impact.platformCredit,promoPct:0,promoFee:-impact.promoCredit,
      shipping:0,packaging:0,itemCost:+itemCost.toFixed(2),parts:+parts.toFixed(2),listingFee:0,
      returnRefund:impact.refund,returnPostage:impact.postage,partialRefund:0,partnerSplit:0,
      totalCosts:totalCosts,netProfit:+(-totalCosts).toFixed(2)};
  }
  const saleNo=Math.max(1,Number(ev.sale)||1);
  const cyc=ev.snapshot||_saleCycleSnapshot(i,saleNo);
  if(!cyc)return{saleNo:'Sale '+saleNo,platform:'',salePrice:0,postage:0,bpf:0,promoPct:0,promoFee:0,shipping:0,packaging:0,itemCost:0,parts:0,listingFee:0,returnRefund:0,returnPostage:0,partialRefund:0,partnerSplit:0,totalCosts:0,netProfit:0};
  const salePrice=Math.max(0,Number(cyc.price)||0);
  const postageIncome=_sellerPostageIncome(cyc.platformId,cyc.postage);
  const shipping=Math.max(0,Number(cyc.shipping)||0);
  const packaging=Math.max(0,Number(cyc.packaging)||0);
  const promoPct=Math.max(0,Number(cyc.promoPercent)||0);
  const bpf=calcPlatformBPF(i,salePrice,cyc.postage||0,cyc.platformId);
  const promoFee=_calcPromoFee(cyc.platformId,salePrice,cyc.postage||0,promoPct);
  const itemCost=Math.max(0,Number(i.costPrice)||0),parts=Math.max(0,calcPartsCost(i));
  const listingFee=Math.max(0,Number(cyc.listingFee)||0);
  // Partner economic cost belongs to one sale cycle only. If the current sale
  // survives, attach it there. If the partner was already paid before a full
  // return, keep that sunk payout on the latest failed cycle instead of making
  // it disappear or charging it again on every resale.
  let partnerSplit=0,targetPartnerSale=null;
  try{
    const owed=_accountItemOwed(i);
    if(owed!=null&&Number(owed)>0){
      if(!i.isReturned){targetPartnerSale=(i.resaleSalePrice&&i.resaleDateSold)?_currentResaleCycleNo(i):1;}
      else if(i.accountSettled===true){const ns=_saleCycleNumbers(i);targetPartnerSale=ns.length?ns[ns.length-1]:1;}
      if(targetPartnerSale===saleNo)partnerSplit=Math.max(0,Number(owed)||0);
    }
  }catch(e){}
  const totalCosts=+(bpf+promoFee+shipping+packaging+itemCost+parts+listingFee+partnerSplit).toFixed(2);
  const revenueRecognised=+(salePrice+postageIncome).toFixed(2);
  const netProfit=+(revenueRecognised-totalCosts).toFixed(2);
  return{saleNo:'Sale '+saleNo,platform:(PLATFORMS[cyc.platformId]&&PLATFORMS[cyc.platformId].short)||cyc.platformId,
    salePrice:+salePrice.toFixed(2),postage:+postageIncome.toFixed(2),bpf:+bpf.toFixed(2),promoPct:+(promoPct*100).toFixed(1),promoFee:+promoFee.toFixed(2),
    shipping:+shipping.toFixed(2),packaging:+packaging.toFixed(2),itemCost:+itemCost.toFixed(2),parts:+parts.toFixed(2),listingFee:+listingFee.toFixed(2),
    returnRefund:0,returnPostage:0,partialRefund:0,partnerSplit:+partnerSplit.toFixed(2),totalCosts:totalCosts,netProfit:netProfit};
}

function _buildPnLSummary(from,to,label){
  const events=getSaleEventsInRange(from,to);
  const soldCount=events.filter(function(e){return!e.isReturned;}).length;
  const retCount=events.filter(function(e){return e.isReturned;}).length;

  // ── Aggregate the per-sale component breakdown ──
  // Turnover = gross receipts = goods sold + postage recharged to buyers (the
  // full amount the buyer paid). Shipping paid out to couriers is then a
  // deductible selling cost. This is the correct HMRC "turnover" figure and
  // makes net profit reconcile exactly to the sum of per-sale net profits.
  let goodsRev=0, postageIn=0, cogs=0, feesSell=0, listingFeeSell=0, postPkgSell=0, returnsSell=0, partnerSell=0;
  events.forEach(function(ev){
    const b=_saleBreakdown(ev);
    if(!ev.isReturned){goodsRev+=b.salePrice; postageIn+=b.postage;}
    cogs+=b.itemCost+b.parts;                       // Box 17
    feesSell+=b.bpf+b.promoFee+b.listingFee;         // Box 26 (platform/payment)
    listingFeeSell+=b.listingFee;                    // display split only (subset of the Box-26 total)
    postPkgSell+=b.shipping+b.packaging;             // Box 23 (postage/packaging on sale)
    returnsSell+=b.returnRefund+b.returnPostage+b.partialRefund;
    partnerSell+=b.partnerSplit;
  });
  const revenue=+(goodsRev+postageIn).toFixed(2);   // turnover (gross receipts)
  postageIn=+postageIn.toFixed(2); goodsRev=+goodsRev.toFixed(2); cogs=+cogs.toFixed(2);

  // ── Manual expenses + mileage, categorised by SA103 box and P&L bucket ──
  const exp=_expensesInRange(from,to);
  // Mileage (trips) is always Box 20 / overhead. Sum the tiered mileage cost.
  const _pnlTiered=calcTieredTrips(exp.trips||[]);
  const mileageCost=_pnlTiered.reduce(function(s,r){return s+(r.mileageCost||0);},0);
  const totalMiles=(exp.trips||[]).reduce(function(s,t){return s+(t.mileage||0);},0);
  // Trip-attached sub-expenses (parking, entry fees…) → their own category, default 'Other'.
  const byBox={};       // box → £ total (manual expenses + mileage only, not sale-level)
  const byCategory={};  // canonical label → {label,box,bucket,amount}
  let manualSelling=0, manualOverhead=0;
  const _addCat=function(cat,amt){
    const d=_resolveExpenseCat(cat);
    byBox[d.box]=+(((byBox[d.box]||0)+amt)).toFixed(2);
    if(!byCategory[d.label])byCategory[d.label]={label:d.label,box:d.box,bucket:d.bucket,amount:0};
    byCategory[d.label].amount=+((byCategory[d.label].amount+amt)).toFixed(2);
    if(d.bucket==='selling')manualSelling+=amt; else manualOverhead+=amt;
  };
  // Mileage → Box 20 (its own pseudo-category so it shows as a distinct line)
  if(mileageCost>0){
    byBox[20]=+(((byBox[20]||0)+mileageCost)).toFixed(2);
    byCategory['Mileage allowance']={label:'Mileage allowance',box:20,bucket:'overhead',amount:+mileageCost.toFixed(2),isMileage:true,miles:totalMiles};
    manualOverhead+=mileageCost;
  }
  (exp.trips||[]).forEach(function(t){
    (Array.isArray(t.expenses)?t.expenses:[]).forEach(function(e){_addCat(e.category,e.amount||0);});
  });
  (exp.expenses||[]).forEach(function(e){_addCat(e.category,e.amount||0);});

  // Sale-level selling costs also belong to SA103 boxes — fold them into byBox
  // so the SA103 summary reconciles to real filings (fees→26, post/pkg→23).
  if(feesSell>0)byBox[26]=+(((byBox[26]||0)+feesSell)).toFixed(2);
  if(postPkgSell>0)byBox[23]=+(((byBox[23]||0)+postPkgSell)).toFixed(2);
  // Returns/refunds → Box 30 (other allowable). Partner/consignment splits are a
  // direct cost of the goods sold → fold into Box 17. This makes the SA103 box
  // total reconcile exactly to (turnover − net profit) — without it, returns and
  // partner splits reduce net profit but appear in no box.
  if(returnsSell>0)byBox[30]=+(((byBox[30]||0)+returnsSell)).toFixed(2);
  const box17=+(cogs+partnerSell).toFixed(2);

  // ── Motor expense method (F7): mileage OR actual, never both per vehicle ──
  // HMRC simplified mileage (45p/25p) already covers fuel, insurance, servicing,
  // repairs & depreciation — you can't ALSO deduct actual motor running costs
  // for the same vehicle. When both are present, honour the chosen method
  // (DB._motorMethod, default 'mileage') and drop the OTHER from the TAXABLE
  // total (overheads → net profit → Box 20 → every export, in lockstep). This
  // touches taxable profit only; the Money/cash model counts real motor spend
  // separately as genuine cash out, so it is unaffected by this choice.
  const motorActual=+(((byCategory['Motor, van & travel']||{}).amount)||0).toFixed(2);
  const motorMethod=(typeof DB!=='undefined'&&DB._motorMethod==='actual')?'actual':'mileage';
  const motorDoubleClaim=(mileageCost>0&&motorActual>0);
  let motorExcluded=0, motorExcludedLabel='';
  if(motorDoubleClaim){
    if(motorMethod==='actual'){
      byBox[20]=+(((byBox[20]||0)-mileageCost)).toFixed(2);
      manualOverhead-=mileageCost;
      if(byCategory['Mileage allowance'])byCategory['Mileage allowance'].excluded=true;
      motorExcluded=+mileageCost.toFixed(2); motorExcludedLabel='mileage allowance';
    } else {
      byBox[20]=+(((byBox[20]||0)-motorActual)).toFixed(2);
      manualOverhead-=motorActual;
      if(byCategory['Motor, van & travel'])byCategory['Motor, van & travel'].excluded=true;
      motorExcluded=motorActual; motorExcludedLabel='actual motor costs';
    }
  }

  // Removed stock is an operational loss when it leaves inventory. This is a
  // MANAGEMENT-P&L write-off only: HMRC cash basis already claims paid stock
  // when purchased, so _buildTaxCashSummary adds this line back before applying
  // its payment-timed Box 17 figure. Supplier returns are net of any refund.
  let archiveLoss=0,archiveCount=0;
  allItems().forEach(function(i){
    if(i&&i.scrappedAt&&i.scrappedAt>=from&&i.scrappedAt<=to){
      const loss=(typeof _cashRemovedItemNet==='function')?_cashRemovedItemNet(i):Math.max(0,(Number(i.costPrice)||0)+calcPartsCost(i)-(Number(i.supplierRefund)||0));
      if(loss>0){archiveLoss+=loss;archiveCount++;}
    }
  });
  archiveLoss=+archiveLoss.toFixed(2);
  if(archiveLoss>0)byBox[30]=+(((byBox[30]||0)+archiveLoss)).toFixed(2);

  // ── Tiers ──
  const grossProfit=+(revenue-cogs).toFixed(2);
  const sellingCosts=+(feesSell+postPkgSell+returnsSell+partnerSell+manualSelling).toFixed(2);
  const operatingProfit=+(grossProfit-sellingCosts).toFixed(2);
  const overheads=+(manualOverhead+archiveLoss).toFixed(2);
  const netProfit=+(operatingProfit-overheads).toFixed(2);
  const stock=_unsoldStockCostInRange(from,to);
  const cashPosition=+(netProfit-stock.cost).toFixed(2);

  const gm=revenue>0?+((grossProfit/revenue)*100).toFixed(1):0;
  const om=revenue>0?+((operatingProfit/revenue)*100).toFixed(1):0;
  const nm=revenue>0?+((netProfit/revenue)*100).toFixed(1):0;

  const money=function(n){return (+n).toFixed(2);};
  const rows=[
    ['PROFIT & LOSS'+(label?' — '+label:'')],
    ['Period',from+' → '+to],
    ['Basis','Management P&L — sale-matched stock costs'],
    [],
    ['Turnover — gross receipts (£)',money(revenue)],
    ['  of which: goods (£)',money(goodsRev)],
    ['  of which: postage recharged to buyers (£)',money(postageIn)],
    ['Less: Cost of goods sold — Box 17 (£)',money(cogs)],
    ['GROSS PROFIT (£)',money(grossProfit)],
    ['Gross margin %',gm.toFixed(1)+'%'],
    [],
    ['Selling costs',''],
    ['  Platform & payment fees — Box 26 (£)',money(+(feesSell-listingFeeSell).toFixed(2))],
    ['  Listing fees — Box 26 (£)',money(listingFeeSell)],
    ['  Postage & packaging on sales — Box 23 (£)',money(postPkgSell)],
    ['  Advertising & marketing — Box 24 (£)',money((byCategory['Advertising & marketing']||{}).amount||0)],
    ['  Returns & refunds (£)',money(returnsSell)],
    ['  Partner / consignment splits (£)',money(partnerSell)],
    ['  Other selling costs (£)',money(Math.max(0,manualSelling-(((byCategory['Advertising & marketing']||{}).amount)||0)))],
    ['  Total selling costs (£)',money(sellingCosts)],
    ['OPERATING PROFIT (£)',money(operatingProfit)],
    ['Operating margin %',om.toFixed(1)+'%'],
    [],
    ['Overheads',''],
    ['  Motor, van & travel — Box 20 (£)',money((byBox[20]||0))],
    ['  Rent, rates, power & insurance — Box 21 (£)',money((byBox[21]||0))],
    ['  Repairs & equipment — Box 22 (£)',money((byBox[22]||0))],
    ['  Phone, office & stationery — Box 23 (£)',money(((byCategory['Phone, office & stationery']||{}).amount)||0)],
    ['  Accountancy, legal & professional — Box 28 (£)',money((byBox[28]||0))],
    ['  Software, subscriptions & other — Box 30 (£)',money(Math.max(0,(byBox[30]||0)-returnsSell-archiveLoss))],
    ['  Removed stock / write-offs — management P&L (£)',money(archiveLoss)],
    ['  Total overheads (£)',money(overheads)],
    ['NET PROFIT BEFORE TAX (£)',money(netProfit)],
    ['Net margin %',nm.toFixed(1)+'%'],
    [],
    ['Memo — cash & stock',''],
    ['  Stock cost tied up (sourced in period, still unsold) (£)',money(stock.cost)],
    ['  Indicative management cash position (profit − stock tied up) (£)',money(cashPosition)],
    [],
    ['Items sold',soldCount],
    ['Returns',retCount],
    ['Unsold items sourced in period',stock.count]
  ];
  if(motorDoubleClaim){
    rows.push([]);
    rows.push(['Motor method',(motorMethod==='actual'?'Actual motor costs':'Simplified mileage')+' applied — '+money(motorMethod==='actual'?motorActual:mileageCost)+' claimed; '+motorExcludedLabel+' ('+money(motorExcluded)+') excluded (one method per vehicle).']);
  }

  return{
    rows:rows, events:events,
    // legacy keys (unchanged contract)
    revenue:revenue, cogs:cogs, grossProfit:grossProfit, expenses:exp, stock:stock,
    netProfit:netProfit, cashPosition:cashPosition, soldCount:soldCount, returnCount:retCount,
    // new: tiers, margins, categorisation, compliance
    postageIn:postageIn, goodsRev:goodsRev,
    selling:{fees:+feesSell.toFixed(2),platformFees:+(feesSell-listingFeeSell).toFixed(2),listingFees:+listingFeeSell.toFixed(2),postPkg:+postPkgSell.toFixed(2),returns:+returnsSell.toFixed(2),partner:+partnerSell.toFixed(2),manual:+manualSelling.toFixed(2),total:sellingCosts},
    overheads:{total:overheads},
    archiveLoss:archiveLoss,archiveCount:archiveCount,
    operatingProfit:operatingProfit,
    grossMargin:gm, operatingMargin:om, netMargin:nm,
    mileage:{cost:+mileageCost.toFixed(2),miles:totalMiles},
    byBox:byBox, byCategory:byCategory, box17:box17,
    motorDoubleClaim:motorDoubleClaim, motorMethod:motorMethod, motorMileage:+mileageCost.toFixed(2), motorActual:motorActual, motorExcluded:motorExcluded, motorExcludedLabel:motorExcludedLabel,
    from:from, to:to, label:label
  };
}

function _findPaidSettlementForItem(itemId){
  let found=null;
  (_accounts||[]).some(function(acct){
    return (acct.settlements||[]).some(function(tx){
      if(!tx||!tx.paid)return false;
      const hit=(tx.items||[]).some(function(a){return a&&((a.id||a.itemId)===itemId);});
      if(hit){found={tx:tx,acct:acct};return true;} return false;
    });
  });
  return found;
}

function _taxCashStockAndPartner(from,to){
  let goodsPaid=0, partnerPaid=0, supplierRefundIncome=0;
  const inR=function(d){return !!d&&d>=from&&d<=to;};
  allItems().forEach(function(i){
    if(!i||!i.id)return;
    const typ=_itemAccountType(i);
    const sourceDate=i.dateSourced||i.dateListed||null;
    const parts=calcPartsCost(i);
    // Parts are business purchases. RETRADE does not yet store a separate parts
    // payment date, so the stock/source date is the documented fallback.
    if(parts>0&&inR(sourceDate))goodsPaid+=parts;
    let acquisition=0,payDate=null;
    if(typ==='consignment') acquisition=0;
    else if(typ==='supplier'){
      if(i.accountSettled===true){
        acquisition=i.accountPaidAmount!=null?Number(i.accountPaidAmount)||0:Number(i.costPrice)||0;
        const st=_findPaidSettlementForItem(i.id); payDate=(st&&st.tx&&st.tx.date)||sourceDate;
      }
    } else { // hybrid: upfront stock cost is paid when acquired; later split is settlement-based
      acquisition=Number(i.costPrice)||0; payDate=sourceDate;
    }
    if(acquisition>0&&inR(payDate))goodsPaid+=acquisition;
    if(i.scrapReason==='supplier_return'&&inR(i.scrappedAt))supplierRefundIncome+=Math.max(0,Number(i.supplierRefund)||0);
  });
  (_accounts||[]).forEach(function(acct){
    (acct.settlements||[]).forEach(function(tx){
      if(!tx||!tx.paid||!inR(tx.date))return;
      const allocs=tx.items||[];
      if(allocs.length&&allocs.some(function(x){return x&&x.kind;})){
        partnerPaid+=allocs.reduce(function(sum,x){return sum+((x&&x.kind!=='supplier')?Math.max(0,Number(x.amount)||0):0);},0);
      }else{
        const kind=tx.kind||acct.accountType||'supplier';
        if(kind!=='supplier')partnerPaid+=Math.max(0,Number(tx.partnerAmount)||0);
      }
    });
  });
  return{goodsPaid:+goodsPaid.toFixed(2),partnerPaid:+partnerPaid.toFixed(2),supplierRefundIncome:+supplierRefundIncome.toFixed(2)};
}

function _buildTaxCashSummary(from,to,label){
  const p=_buildPnLSummary(from,to,label);
  const cash=_taxCashStockAndPartner(from,to);
  // Remove sale-matched acquisition/partner costs, then insert amounts actually paid.
  const netProfit=+(p.netProfit+p.cogs+(p.selling.partner||0)+(p.archiveLoss||0)-cash.goodsPaid-cash.partnerPaid+cash.supplierRefundIncome).toFixed(2);
  const byBox=Object.assign({},p.byBox);
  if((p.archiveLoss||0)>0)byBox[30]=+Math.max(0,(byBox[30]||0)-(p.archiveLoss||0)).toFixed(2);
  const box17=+(cash.goodsPaid+cash.partnerPaid).toFixed(2);
  return Object.assign({},p,{
    basis:'HMRC cash basis', netProfit:netProfit, box17:box17, byBox:byBox,
    otherBusinessIncome:cash.supplierRefundIncome,
    cashGoodsPaid:cash.goodsPaid,cashPartnerPaid:cash.partnerPaid,
    totalBusinessIncome:+(p.revenue+cash.supplierRefundIncome).toFixed(2)
  });
}

function calcMonthStatsBySale(m){
  const events=getSaleEventsInMonth(m);
  let totalRev=0,realisedProfit=0,soldCount=0,eventCount=0,returnedCount=0,grossRev=0,returnsAmt=0;
  let roiSum=0,roiCount=0,daysSum=0,daysCount=0,marginSum=0,marginCount=0;
  const saleEvents=[];
  events.forEach(function(e){
    eventCount++;
    const b=_saleBreakdown(e);
    // Use the canonical sale breakdown so buyer-paid postage is turnover and
    // every refund is a dated negative revenue event. This is the exact same
    // revenue contract used by calcYearlyStats and statement P&L.
    const evRev=e.isReturnAdjustment?(Number(e.salePrice)||0):((Number(b.salePrice)||0)+(Number(b.postage)||0));
    totalRev+=evRev;
    if(e.isReturnAdjustment){returnsAmt+=Math.max(0,-evRev);returnedCount++;}
    else{
      grossRev+=Math.max(0,evRev);soldCount++;saleEvents.push(e);
      if(e.roi!==null&&e.roi!==undefined&&Number.isFinite(Number(e.roi))){roiSum+=Number(e.roi);roiCount++;}
      if(e.margin!==null&&e.margin!==undefined&&Number.isFinite(Number(e.margin))){marginSum+=Number(e.margin);marginCount++;}
      if(e.daysToSell!==null&&e.daysToSell!==undefined&&Number.isFinite(Number(e.daysToSell))){daysSum+=Number(e.daysToSell);daysCount++;}
    }
    realisedProfit+=Number(b.netProfit)||0;
  });

  // Refund-rate cohort mirrors calcYearlyStats: of sales MADE this month, how
  // many were eventually affected by a refund? The cash/profit effect itself
  // remains on the actual refund date above.
  let fullRefundCount=0,partialOnlyCount=0;
  saleEvents.forEach(function(ev){
    const n=Math.max(1,Number(ev.sale)||1),rh=(ev.item&&ev.item.returnHistory)||[];
    const cycle=rh.filter(function(r){return Math.max(1,Number(r.saleNo)||1)===n;});
    if(cycle.some(function(r){return r.type==='full_seller'||r.type==='full_ebay';}))fullRefundCount++;
    else if(cycle.some(function(r){return r.type==='partial_seller'||r.type==='partial_ebay';}))partialOnlyCount++;
  });
  const refundedItemCount=fullRefundCount+partialOnlyCount,refundDenom=soldCount;
  const refundItemRate=refundDenom>0?(refundedItemCount/refundDenom*100):0;
  const refundCount=fullRefundCount,partialCount=partialOnlyCount;
  const avgROI=roiCount>0?roiSum/roiCount:null,avgMargin=marginCount>0?marginSum/marginCount:null,avgDays=daysCount>0?Math.round(daysSum/daysCount):null;

  // Monthly Net Profit = item-level gross profit (including dated returns and
  // partner splits) minus trips and standalone expenses dated in this month.
  const _monthCode=keyCode(m),_monthYear=keyYear(m),_monthIndex=MONTHS.indexOf(_monthCode);
  const _monthStart=String(_monthYear)+'-'+String(_monthIndex+1).padStart(2,'0')+'-01';
  const _monthEnd=new Date(_monthYear,_monthIndex+1,0).toISOString().split('T')[0];
  const _inMonth=function(ds){return !!ds&&ds>=_monthStart&&ds<=_monthEnd;};
  const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);let tripsCost=0,expensesCost=0;
  _allTrips.forEach(function(t,idx){if(_inMonth(t.date))tripsCost+=(_tieredTrips[idx]?_tieredTrips[idx].totalCost:0);});
  (DB.expenses||[]).forEach(function(e){if(_inMonth(e.date))expensesCost+=(Number(e.amount)||0);});
  const grossProfit=+realisedProfit.toFixed(2),overheads=+(tripsCost+expensesCost).toFixed(2),netProfit=+(grossProfit-overheads).toFixed(2);
  return {totalRev:+totalRev.toFixed(2),grossRev:+grossRev.toFixed(2),returnsAmt:+returnsAmt.toFixed(2),realisedProfit:grossProfit,grossProfit:grossProfit,netProfit:netProfit,
          tripsCost:+tripsCost.toFixed(2),expensesCost:+expensesCost.toFixed(2),overheads:overheads,
          soldCount:soldCount,eventCount:eventCount,returnedCount:returnedCount,avgROI:avgROI,avgMargin:avgMargin,avgDays:avgDays,
          fullRefundCount:fullRefundCount,partialOnlyCount:partialOnlyCount,refundedItemCount:refundedItemCount,refundDenom:refundDenom,refundItemRate:refundItemRate,
          refundCount:refundCount,partialCount:partialCount,
          listedCount:(DB[m]||[]).filter(function(i){return !i.dateSold&&!i.isReturned&&!i.resaleSalePrice&&!i.scrappedAt&&((i.item||'').trim().toUpperCase()!=='MONTH END');}).length};
}

function calcEbayBPF(salePrice){
  if(!salePrice||salePrice<=0)return 0;
  const feeOnNet=function(net){
    let f=0.10;
    f+=0.07*Math.min(net,20);
    if(net>20)f+=0.04*Math.min(net-20,280);
    if(net>300)f+=0.02*Math.min(net-300,3700);
    // eBay UK private Buyer Protection is capped at the £4,000 band.
    // Any portion of the seller's item price above £4,000 adds no further BPF.
    return f;
  }
  let net=salePrice;
  for(let j=0;j<10;j++)net=salePrice-feeOnNet(net);
  return+feeOnNet(net).toFixed(2);
}

function calcVintedBPF(item,salePrice){
  // Vinted: seller fee is £0. Buyer pays a separate Buyer Protection Fee on top.
  return 0;
}

function calcDepopBPF(item,salePrice,buyerPostage){
  // UK Depop: no selling commission. Depop Payments processing is 2.9% + £0.30
  // on item price + seller-arranged shipping (+ taxes, which RETRADE does not model).
  // Boosting is separate and handled by _calcPromoFee when a Boost % is entered.
  const base=Math.max(0,Number(salePrice)||0)+Math.max(0,Number(buyerPostage)||0);
  if(base<=0)return 0;
  return+(base*0.029+0.30).toFixed(2);
}

function calcFbBPF(item,salePrice){
  // Facebook Marketplace local/P2P tracking: RETRADE assumes £0 platform fee.
  return 0;
}

function calcAmazonUKBPF(item,salePrice){
  // Amazon is locked for NEW items until category + selling-plan fees are modelled.
  // Preserve the legacy approximation for already-saved Amazon records so this
  // launch hardening pass does not silently rewrite historical P&L.
  if(!salePrice||salePrice<=0)return 0;
  return+(salePrice*0.15+0.75).toFixed(2);
}

function _calcEbayBizFeeComponents(salePrice, category, itemPriceOnly){
  if(!salePrice||salePrice<=0)return {fvf:0,reg:0,perOrder:0,eligibleRefundableGross:0,total:0};
  // Backward-compat map: items saved under any earlier category naming scheme
  // still calculate correctly without requiring a data migration. Maps old
  // RETRADE category names → current eBay-aligned keys.
  const _legacyMap={
    // Pre-Feb-2026 names (renamed once already)
    'Electronics & Tech':       'Laptops, Desktops & Tablets',
    'Electronics (banded)':     'Laptops, Desktops & Tablets',
    'Audio & Music':            'Audio & Video Accessories',
    'Books & Media':            'Books, Comics & Magazines',
    'Video Games & Consoles':   'Video Games',
    'Clothing & Fashion':       'Clothes, Shoes & Accessories',
    'Sneakers & Trainers':      'Trainers',
    'Home & Garden':            'Home, Furniture & DIY',
    'Collectibles & Vintage':   'Collectables',
    'Business & Industrial':    'Business, Office & Industrial',
    // v2.09.3 renames — general-vs-banded name-clash cleanup
    'Cameras & Photography':    'Camera Accessories',
    'Computers & Tablets':      'Computer Accessories & Parts',
    'Mobile Phones & Accessories':'Phone Accessories',
    'Sound & Vision':           'Audio & Video Accessories',
    'Mobile & Smart Phones':    'Mobile Phones (Handsets)',
    'Jewellery & Watches':      'Jewellery',
  };
  const _cat=_legacyMap[category]||category;
  let spec=EBAY_BIZ_FVF[_cat];
  if(spec===undefined&&_cat){
    console.warn('[RETRADE] eBay Biz: unknown category "'+_cat+'" — defaulting to 12.9%');
    spec=0.129;
  }
  if(spec===undefined)spec=0.129;

  // Trainers special: if the ITEM price (excl. postage) is >= £100, the WHOLE
  // transaction flips to a flat 7% (no band) — a clean threshold flip.
  if(_cat==='Trainers'){
    const itemPx=(itemPriceOnly!=null)?itemPriceOnly:salePrice;
    spec=(itemPx>=100)?0.07:0.119;
  }

  // Variable FVF — flat number, or banded {rate, threshold, above}.
  let fvf;
  if(typeof spec==='object'&&spec){
    if(salePrice<=spec.threshold){
      fvf=salePrice*spec.rate;
    }else{
      fvf=spec.threshold*spec.rate+(salePrice-spec.threshold)*spec.above;
    }
  }else{
    fvf=salePrice*spec;
  }

  const reg=salePrice*0.0035;          // 0.35% regulatory operating fee
  // Per-order fee: £0.40 over £10, else £0.30 — reduced to £0.10 (orders ≤£10)
  // in selected Collectables categories and Home, Furniture & DIY.
  const lowPerOrderCat=(_cat==='Collectables'||_cat==='Antiques'||_cat==='Art'||
    _cat==='Coins'||_cat==='Dolls & Bears'||_cat==='Pottery, Ceramics & Glass'||
    _cat==='Sports Memorabilia'||_cat==='Stamps'||_cat==='Home, Furniture & DIY');
  const perOrder=salePrice>10?0.40:(lowPerOrderCat?0.10:0.30);
  const subtotal=fvf+reg+perOrder;
  const vat=1.20;
  return {
    fvf:+fvf.toFixed(4),
    reg:+reg.toFixed(4),
    perOrder:+perOrder.toFixed(2),
    // eBay credits the variable FVF + regulatory fee proportionally on
    // eligible seller-handled refunds. The fixed per-order amount is kept
    // conservative here because its credit depends on the refund reason.
    eligibleRefundableGross:+((fvf+reg)*vat).toFixed(2),
    total:+(subtotal*vat).toFixed(2)
  };
}

function calcEbayBizBPF(salePrice, category, itemPriceOnly){
  return _calcEbayBizFeeComponents(salePrice,category,itemPriceOnly).total;
}

function _ebayBizRateLabel(category, salePrice, itemPriceOnly){
  const _legacyMap={
    'Electronics & Tech':'Laptops, Desktops & Tablets',
    'Electronics (banded)':'Laptops, Desktops & Tablets',
    'Audio & Music':'Audio & Video Accessories',
    'Books & Media':'Books, Comics & Magazines',
    'Video Games & Consoles':'Video Games',
    'Clothing & Fashion':'Clothes, Shoes & Accessories',
    'Sneakers & Trainers':'Trainers',
    'Home & Garden':'Home, Furniture & DIY',
    'Collectibles & Vintage':'Collectables',
    'Business & Industrial':'Business, Office & Industrial',
    // v2.09.3 renames
    'Cameras & Photography':'Camera Accessories',
    'Computers & Tablets':'Computer Accessories & Parts',
    'Mobile Phones & Accessories':'Phone Accessories',
    'Sound & Vision':'Audio & Video Accessories',
    'Mobile & Smart Phones':'Mobile Phones (Handsets)',
    'Jewellery & Watches':'Jewellery',
  };
  const _cat=_legacyMap[category]||category;
  let spec=EBAY_BIZ_FVF[_cat];
  if(spec===undefined)spec=0.129;
  if(_cat==='Trainers'){
    const itemPx=(itemPriceOnly!=null)?itemPriceOnly:(salePrice||0);
    return (itemPx>=100)?'7.0%':'11.9%';
  }
  if(typeof spec==='object'&&spec){
    return (spec.rate*100).toFixed(1)+'%→'+(spec.above*100).toFixed(1)+'% over £'+spec.threshold;
  }
  return (spec*100).toFixed(1)+'%';
}

function calcPlatformBPF(item,salePrice,buyerPostage,platformOverride){
  const p=platformOverride||_itemPlatform(item);
  const post=buyerPostage||0;
  switch(p){
    case 'ebay':      return calcEbayBPF(salePrice);
    case 'ebay_biz':  return calcEbayBizBPF(salePrice+post,item.category,salePrice);
    case 'vinted':    return calcVintedBPF(item,salePrice);
    case 'depop':     return calcDepopBPF(item,salePrice,post);
    case 'fb':        return calcFbBPF(item,salePrice);
    case 'amazon_uk': return calcAmazonUKBPF(item,salePrice);
    default:          return calcEbayBPF(salePrice+post);
  }
}

function _calcPromoFee(platformId,itemPrice,buyerPostage,promoPercent){
  const pct=Math.max(0,Number(promoPercent)||0);
  if(!pct)return 0;
  const price=Math.max(0,Number(itemPrice)||0);
  const post=Math.max(0,Number(buyerPostage)||0);
  let base=price;
  if(platformId==='ebay'||platformId==='ebay_biz'||platformId==='depop')base+=post;
  let fee=base*pct;
  if(platformId==='ebay'||platformId==='ebay_biz')fee*=1.20;
  return +fee.toFixed(2);
}

function _sellerRefundCreditRatio(item,saleNo,salePrice,buyerPostage){
  const entries=(item&&item.returnHistory)||[];
  const target=Math.max(1,Number(saleNo)||1);
  // A seller-handled FULL refund represents a complete reversal for fee-credit
  // purposes. eBay-stepped-in refunds deliberately do not qualify.
  if(entries.some(function(r){
    const rs=Math.max(1,Number(r.saleNo)||1);
    return rs===target&&r.type==='full_seller';
  }))return 1;
  const refunded=entries.filter(function(r){
    const rs=Math.max(1,Number(r.saleNo)||1);
    return rs===target&&r.type==='partial_seller';
  }).reduce(function(sum,r){return sum+(Number(r.refundAmount)||0);},0);
  const total=Math.max(0,Number(salePrice)||0)+Math.max(0,Number(buyerPostage)||0);
  if(total<=0||refunded<=0)return 0;
  return Math.max(0,Math.min(1,refunded/total));
}

function _netEbayBizFeeAfterRefunds(item,saleNo,salePrice,buyerPostage){
  const total=Math.max(0,Number(salePrice)||0)+Math.max(0,Number(buyerPostage)||0);
  const c=_calcEbayBizFeeComponents(total,item&&item.category,salePrice);
  const ratio=_sellerRefundCreditRatio(item,saleNo,salePrice,buyerPostage);
  const credit=c.eligibleRefundableGross*ratio;
  return +Math.max(0,c.total-credit).toFixed(2);
}

function _allRefundRatio(item,saleNo,salePrice,buyerPostage){
  const target=Math.max(1,Number(saleNo)||1);
  const total=Math.max(0,Number(salePrice)||0)+Math.max(0,Number(buyerPostage)||0);
  if(total<=0)return 0;
  const refunded=((item&&item.returnHistory)||[]).filter(function(r){
    const rs=Math.max(1,Number(r.saleNo)||1);
    return rs===target&&(r.type==='full_seller'||r.type==='full_ebay'||r.type==='partial_seller'||r.type==='partial_ebay');
  }).reduce(function(sum,r){return sum+(Number(r.refundAmount)||0);},0);
  return Math.max(0,Math.min(1,refunded/total));
}

function _netPlatformFeeAfterRefunds(item,saleNo,platformId,salePrice,buyerPostage){
  const original=calcPlatformBPF(item,salePrice,buyerPostage,platformId);
  if(!original)return 0;
  if(platformId==='ebay_biz')return _netEbayBizFeeAfterRefunds(item,saleNo,salePrice,buyerPostage);
  if(platformId==='depop'){
    // Depop Payments reverses selling/payment/boost fees when a refund is
    // processed. Partial refunds therefore receive the proportional share.
    const ratio=_allRefundRatio(item,saleNo,salePrice,buyerPostage);
    return +Math.max(0,original*(1-ratio)).toFixed(2);
  }
  // eBay Private BPF is paid by the BUYER, not the seller. RETRADE subtracts
  // it only because private-eBay salePrice is stored as the buyer-facing item
  // amount. Refunds do not turn it into a seller fee, so keep the original BPF
  // conversion here; the buyer's prorated BPF refund is handled separately.
  return original;
}

function _netPromoFeeAfterRefunds(item,saleNo,platformId,salePrice,buyerPostage,promoPercent){
  const original=_calcPromoFee(platformId,salePrice,buyerPostage,promoPercent);
  if(!original)return 0;
  let ratio=0;
  if(platformId==='ebay'||platformId==='ebay_biz'){
    ratio=_sellerRefundCreditRatio(item,saleNo,salePrice,buyerPostage);
  }else if(platformId==='depop'){
    ratio=_allRefundRatio(item,saleNo,salePrice,buyerPostage);
  }
  return +Math.max(0,original*(1-ratio)).toFixed(2);
}

function _sellerPaysOutbound(platformId){
  // Kept as a compatibility helper for older display code. The canonical P&L
  // deducts any shippingCost the user actually entered regardless of platform;
  // a non-zero "your shipping cost" is a real cash outflow.
  return platformId!=='vinted'&&platformId!=='fb';
}

function _sellerPostageIncome(platformId,buyerPostage){
  const p=PLATFORMS[platformId];
  // seller_receives platforms (Vinted / FB in RETRADE's current model) store
  // salePrice as the amount the seller receives. Buyer delivery/protection is
  // paid on top and is not seller revenue.
  if(p&&p.pattern==='seller_receives')return 0;
  return Math.max(0,Number(buyerPostage)||0);
}

function _saleRefundTotals(item,saleNo){
  const target=Math.max(1,Number(saleNo)||1);
  const out={partialSeller:0,partialPlatform:0,fullSeller:0,fullPlatform:0,returnPostage:0,hasFull:false};
  ((item&&item.returnHistory)||[]).forEach(function(r){
    const rs=Math.max(1,Number(r.saleNo)||1);
    if(rs!==target)return;
    const amt=Math.max(0,Number(r.refundAmount)||0);
    out.returnPostage+=Math.max(0,Number(r.returnPostage)||0);
    if(r.type==='partial_seller')out.partialSeller+=amt;
    else if(r.type==='partial_ebay')out.partialPlatform+=amt;
    else if(r.type==='full_seller'){out.fullSeller+=amt;out.hasFull=true;}
    else if(r.type==='full_ebay'){out.fullPlatform+=amt;out.hasFull=true;}
  });
  Object.keys(out).forEach(function(k){if(typeof out[k]==='number')out[k]=+out[k].toFixed(2);});
  return out;
}

function _privateEbayBuyerFeeRefund(item,saleNo,salePrice,buyerPostage){
  const bpf=calcEbayBPF(salePrice);
  if(!bpf)return 0;
  const target=Math.max(1,Number(saleNo)||1);
  const refunded=((item&&item.returnHistory)||[]).filter(function(r){
    const rs=Math.max(1,Number(r.saleNo)||1);
    return rs===target&&(r.type==='full_seller'||r.type==='full_ebay'||r.type==='partial_seller'||r.type==='partial_ebay');
  }).reduce(function(sum,r){return sum+(Number(r.refundAmount)||0);},0);
  if(refunded<=0||salePrice<=0)return 0;
  // eBay says the private Buyer Protection fee is refunded pro-rata with the
  // item-price refund. It is eBay's money, not a seller cost. RETRADE's return
  // form historically stores the buyer-facing refund amount, so remove the
  // BPF share before treating that refund as seller cash outflow.
  const ratio=Math.max(0,Math.min(1,refunded/Math.max(0.01,Number(salePrice)||0)));
  return +(bpf*ratio).toFixed(2);
}

function calcPartsCost(i){
  return (i.parts||[]).reduce(function(s,p){return s+(p.cost||0);},0);
}

function calcItemRevenue(i){
  if(!i.salePrice)return 0;
  // Returned and not yet resold — revenue = 0
  if(i.isReturned)return 0;
  // Returned then resold — only the resale price counts as revenue
  const _hadFullReturn=(i.returnHistory||[]).some(r=>r.type==='full_seller'||r.type==='full_ebay');
  const _wasReturnedThenResold=i.resaleSalePrice&&_hadFullReturn;
  if(_wasReturnedThenResold)return+(i.resaleSalePrice||0).toFixed(2);
  // BUGFIX (Session E1): fully-returned-then-relisted-but-not-yet-resold —
  // original sale was reversed; sale 2 hasn't happened. Revenue = 0.
  if(_hadFullReturn&&!i.resaleSalePrice)return 0;
  // Normal sold (including partial refunds — partial doesn't reverse the sale).
  // F9 guard: resaleSalePrice only ever counts via the returned-then-resold path
  // above; a non-returned item's revenue is its single sale price. Returning
  // salePrice alone prevents a double-count if resaleSalePrice is ever set here
  // without a full return (a latent/corrupt state).
  return+(i.salePrice||0).toFixed(2);
}

function calcGrossProfit(i){
  if(!i.salePrice)return null;
  // v1.3 — once an item has a real completed sale, realised item P&L is the
  // chronological sum of immutable Sale-N and return events. This removes the
  // old Sale-1/Sale-2 ceiling and stops a later relist from rewriting an older
  // cycle. _saleBreakdown includes partner share for statement purposes, so add
  // it back here: calcGrossProfit remains PRE-partner and calcNetProfit owns the
  // single partner deduction contract.
  const _actualCycles=(typeof _saleCycleNumbers==='function')?_saleCycleNumbers(i):[];
  if(_actualCycles.length){
    let _actualGross=0;
    _actualCycles.forEach(function(n){
      const cyc=_saleCycleSnapshot(i,n);if(!cyc)return;
      const b=_saleBreakdown({item:i,sale:String(n),saleDate:cyc.date,salePrice:cyc.price,snapshot:cyc,isReturnAdjustment:false,isReturned:false});
      _actualGross+=(Number(b.netProfit)||0)+(Number(b.partnerSplit)||0);
    });
    (i.returnHistory||[]).forEach(function(r){
      const b=_saleBreakdown({item:i,sale:'R',saleDate:_returnEventDate(r),isReturnAdjustment:true,isReturned:true,returnEntry:r});
      _actualGross+=(Number(b.netProfit)||0);
    });
    // A relisted-but-not-yet-resold item has incurred the NEXT insertion fee,
    // but no Sale-N event exists yet to carry it. Recognise that sunk fee once.
    if(!i.isReturned&&!i.dateSold&&!i.resaleSalePrice){
      const pending=(i.returnHistory||[]).slice().reverse().find(function(r){return (r.type==='full_seller'||r.type==='full_ebay')&&r._relistedAt;});
      if(pending&&pending._listingFeeAtRelist!=null)_actualGross-=Math.max(0,Number(pending._listingFeeAtRelist)||0);
    }
    return +_actualGross.toFixed(2);
  }
  // F4 — a sale marked fully returned with NO return record (empty returnHistory)
  // and no resale has zero revenue; without an entry to reverse it the code below
  // reports phantom profit. Force 0 to match calcItemRevenue's isReturned rule.
  if(i.isReturned && !i.resaleSalePrice && !(i.returnHistory||[]).length)return 0;
  // ── Multi-cycle full returns ────────────────────────────────────────────
  // When the item is physically back in stock after a full return, acquisition
  // cost/parts remain recoverable stock. Lifetime realised P&L is therefore the
  // sunk selling cost of each failed completed sale cycle. Sale 2+ cycles are
  // frozen on their return rows before the live resale slot is reused.
  const _fullRets=(i.returnHistory||[]).filter(function(r){return r.type==='full_seller'||r.type==='full_ebay';});
  if(i.isReturned&&_fullRets.length){
    let failed=0;
    _fullRets.forEach(function(r){failed+=_failedCycleLoss(i,r);});
    const listing=(Number(i.listingFee)||0)+(Number(i.resaleListingFee)||0);
    return +(-(failed+listing)).toFixed(2);
  }
  // Partial refund handling for fees:
  //   partial_seller (seller agreed): eBay refunds the fee difference — recalc BPF/promo on net sale price
  //   partial_ebay (eBay stepped in): eBay keeps the original fee — BPF/promo stay on full sale price
  //   Full returns are handled separately below (fee fully refunded on relist path)
  // v2.19.31 — Sale-1 partial refunds only. saleNo===2 belongs to the resale
  // branch below; untagged (legacy) entries are Sale 1 by default.
  const partialSellerRefund=(i.returnHistory||[]).filter(r=>r.type==='partial_seller'&&(Number(r.saleNo)||1)===1)
    .reduce((s,r)=>s+(r.refundAmount||0),0);
  // E3 P0 #1 — Resolve sale 1 economics. For items that were relisted then
  // resold, confirmRelist overwrites i.shippingCost/postage/packaging/promo
  // with sale 2 values. The pre-relist snapshot is stored on the latest full-
  // return entry (_*AtRelist fields). When present, prefer the snapshot for
  // sale 1 cost/fee calculations. Older items without snapshot fall back to
  // current values (slightly wrong but no worse than before).
  const _hasResale=!!i.resaleSalePrice;
  const _fullReturnEntry=(i.returnHistory||[]).slice().reverse().find(r=>(r.type==='full_seller'||r.type==='full_ebay')&&(Number(r.saleNo)||1)===1);
  const _snap=(_hasResale&&_fullReturnEntry)?_fullReturnEntry:null;
  const _s1SalePrice=_snap?(_fullReturnEntry._salePriceAtRelist||_fullReturnEntry._salePriceAtReturn||i.salePrice||0):(i.salePrice||0);
  const _s1Postage=(_snap&&_fullReturnEntry._postageAtRelist!==undefined)?_fullReturnEntry._postageAtRelist:(i.postage||0);
  const _s1Shipping=(_snap&&_fullReturnEntry._shippingCostAtRelist!==undefined)?_fullReturnEntry._shippingCostAtRelist:(i.shippingCost||0);
  const _s1Packaging=(_snap&&_fullReturnEntry._packagingCostAtRelist!==undefined)?_fullReturnEntry._packagingCostAtRelist:(i.packagingCost||0);
  const _s1Promo=(_snap&&_fullReturnEntry._promoPercentAtRelist!==undefined)?_fullReturnEntry._promoPercentAtRelist:(i.promoPercent||0);
  const _baseSale=_snap?_s1SalePrice:i.salePrice;
  const _s1PlatformId=_s1Platform(i);
  // Canonical fee path: keep the ORIGINAL sale base intact, then apply any
  // eligible refund credit to the fee itself. This is essential for banded
  // eBay Business categories: recalculating a fictitious lower sale can move
  // money between bands and produce the wrong credit.
  const bpf=_netPlatformFeeAfterRefunds(i,1,_s1PlatformId,_baseSale,_s1Postage);
  // Advertising uses the same refund-credit rules as the platform fee. A seller-
  // handled eligible refund can credit some/all of the ad charge; an eBay-
  // stepped-in refund keeps the original charge. Never special-case "full" to 0.
  const promoCost=_netPromoFeeAfterRefunds(i,1,_s1PlatformId,_baseSale,_s1Postage,_s1Promo);
  // Determine if this item has been relisted after a full return
  // (isReturned=false but returnHistory has a full return entry, and no dateSold / resaleSalePrice)
  // Full returns only: eBay refunds BPF back to seller (transaction fully reversed)
  // Partial returns: fee treatment depends on refund type (see above)
  const _wasRelisted = !i.isReturned && !i.dateSold && !i.resaleSalePrice &&
    (i.returnHistory||[]).some(r=>r.type==='full_seller'||r.type==='full_ebay');
  // Refund principal is a cash outflow regardless of who handled it. Fee relief
  // is modelled separately above, so revenue is never distorted by changing the
  // original transaction base.
  const partialEbayRefund=(i.returnHistory||[]).filter(r=>r.type==='partial_ebay'&&(Number(r.saleNo)||1)===1)
    .reduce((s,r)=>s+(r.refundAmount||0),0);
  // Private eBay's stored sale/refund amounts are buyer-facing and include the
  // Buyer Protection component. eBay returns that component itself, so add its
  // prorated reversal back before treating a partial refund as seller cash out.
  const _s1PrivateBpfRefund=(_s1PlatformId==='ebay')?(i.returnHistory||[])
    .filter(function(r){return (Number(r.saleNo)||1)===1&&(r.type==='partial_seller'||r.type==='partial_ebay');})
    .reduce(function(sum,r){return sum+_refundCreditsForEntry(i,r).platformCredit;},0):0;
  // When a full-returned item has been relisted, its sale revenue is gone. Any
  // seller fee that was NOT credited remains a real loss. Private-eBay BPF is
  // buyer-funded rather than a seller fee, so it must not become a phantom cost.
  const _platformFeeIsSellerCost=(_s1PlatformId!=='ebay');
  const rev=_wasRelisted
    ? (_platformFeeIsSellerCost?-bpf:0)
    : _baseSale+_s1Postage-bpf-partialSellerRefund-partialEbayRefund+_s1PrivateBpfRefund;
  const returnCost=(i.returnHistory||[]).reduce(function(s,r){
    const fullReturn=(r.type==='full_seller'||r.type==='full_ebay');
    const _rSale=(r.saleNo===2)?2:1;
    if(fullReturn&&_rSale===1){
      if(_wasRelisted){
        // Sale principal already removed above; only return postage remains here.
        return s+(r.returnPostage||0);
      }
      const refund=Math.max(0,Number(r.refundAmount)||0);
      if(_s1PlatformId==='ebay'){
        // Private eBay: the refund field is buyer-facing. eBay refunds its own
        // Buyer Protection share, so only the seller-funded portion is cash out.
        const buyerFeeRefund=_privateEbayBuyerFeeRefund(i,1,_baseSale,_s1Postage);
        return s+Math.max(0,refund-buyerFeeRefund)+(r.returnPostage||0);
      }
      // Seller-fee platforms: fee credits are already reflected by `bpf` above;
      // the refund principal itself is still paid back in full.
      return s+refund+(r.returnPostage||0);
    }
    // Partial refunds: refund principal handled via revenue adjustment above.
    // Only charge return postage here (refund amount itself is already netted out).
    return s+(r.returnPostage||0);
  },0);
  const partsCost=calcPartsCost(i);
  // Vinted (and any future buyer-pays-postage-only platform): seller pays nothing to ship
  const _platForCost=_itemPlatform(i);
  const _sellerPaysShipping=(_platForCost!=='vinted'&&_platForCost!=='fb');
  // v2.19.26 — both listings' insertion fees. resaleListingFee is added here
  // rather than inside the resale branch below so a relisted-but-unsold item
  // still carries the fee it has already been charged.
  const listingFee=(i.listingFee||0)+(i.resaleListingFee||0);
  // v2.21.45 — a fully-returned item that hasn't been resold is BACK IN STOCK: its cost
  // (buy + parts) is recoverable capital, not a realised loss. Only the sunk selling costs
  // (shipping/pkg/promo/return/fees/listing) count. Resold items keep the cost (consumed by
  // the resale, v2.21.16). Display-only — calcGrossProfit does NOT feed SA103.
  const _backInStock=!!i.isReturned&&(i.returnHistory||[]).some(function(r){return r.type==='full_seller'||r.type==='full_ebay';});
  const cost=(_backInStock?0:(i.costPrice||0))+(_sellerPaysShipping?_s1Shipping:0)+(_sellerPaysShipping?_s1Packaging:0)+promoCost+returnCost+(_backInStock?0:partsCost)+listingFee;
  let profit=rev-cost;
  // Second sale (resold after return)
  if(i.resaleSalePrice){
    const rPostage=i.resalePostage!=null?i.resalePostage:(i.postage||0);
    const _rPlatformId=i.resalePlatform||_itemPlatform(i);
    const _liveResaleNo=_currentResaleCycleNo(i);
    const rBPF=_netPlatformFeeAfterRefunds(i,_liveResaleNo,_rPlatformId,i.resaleSalePrice,rPostage);
    const rPromoCost=_netPromoFeeAfterRefunds(i,_liveResaleNo,_rPlatformId,i.resaleSalePrice,rPostage,i.resalePromoPercent||0);
    // v2.19.31 — partial refunds tagged to Sale 2. Principal is deducted here;
    // any eligible fee/boost credit is already reflected in the canonical net
    // fee helpers above.
    const rPartialSeller=(i.returnHistory||[]).filter(r=>r.type==='partial_seller'&&(Number(r.saleNo)||1)===_liveResaleNo).reduce((s,r)=>s+(r.refundAmount||0),0);
    const rPartialEbay=(i.returnHistory||[]).filter(r=>r.type==='partial_ebay'&&(Number(r.saleNo)||1)===_liveResaleNo).reduce((s,r)=>s+(r.refundAmount||0),0);
    const _rPrivateBpfRefund=(_rPlatformId==='ebay')?(i.returnHistory||[])
      .filter(function(r){return (Number(r.saleNo)||1)===_liveResaleNo&&(r.type==='partial_seller'||r.type==='partial_ebay');})
      .reduce(function(sum,r){return sum+_refundCreditsForEntry(i,r).platformCredit;},0):0;
    const _rFull=(i.returnHistory||[]).slice().reverse().find(function(r){return (Number(r.saleNo)||1)===_liveResaleNo&&(r.type==='full_seller'||r.type==='full_ebay');});
    let _rFullSellerCash=0;
    if(_rFull){
      _rFullSellerCash=Math.max(0,Number(_rFull.refundAmount)||0);
      if(_rPlatformId==='ebay')_rFullSellerCash=Math.max(0,_rFullSellerCash-_refundCreditsForEntry(i,_rFull).platformCredit);
    }
    const rRev=i.resaleSalePrice+rPostage-rBPF-(i.resaleShippingCost||0)-(i.resalePackagingCost||0)-rPromoCost
      -rPartialSeller-rPartialEbay+_rPrivateBpfRefund-_rFullSellerCash;
    profit+=rRev;
  }
  return+profit.toFixed(2);
}

function calcNetProfit(i){
  const gross=calcGrossProfit(i);
  if(gross===null)return null;
  const owed=_accountItemOwed(i); // null if no split set, or item unsold
  if(owed===null)return gross;
  return+(gross-owed).toFixed(2);
}

function runFinancialRegressionTests(){
  const near=function(a,b){return Math.abs((Number(a)||0)-(Number(b)||0))<0.011;};
  const results=[];
  const check=function(name,actual,expected){
    const ok=near(actual,expected);
    results.push({name:name,ok:ok,actual:+Number(actual).toFixed(2),expected:+Number(expected).toFixed(2)});
    return ok;
  };
  const base=function(platform){return{
    id:'TEST',item:'Regression item',defaultPlatform:platform,soldOnPlatform:platform,
    salePlatform:platform,state:'sold',dateSold:'2026-08-01',salePrice:100,postage:0,
    costPrice:40,shippingCost:4,packagingCost:1,promoPercent:0.02,
    parts:[],listingFee:0,returnHistory:[]
  };};

  // 1 — eBay private normal sale: buyer-facing item amount less BPF, costs + ad.
  let i=base('ebay');
  let expected=100-calcPlatformBPF(i,100,0,'ebay')-_calcPromoFee('ebay',100,0,0.02)-40-4-1;
  check('eBay private · normal sale',calcGrossProfit(i),expected);

  // 2 — eBay Business normal sale: FVF includes buyer-paid postage.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;
  expected=105-calcPlatformBPF(i,100,5,'ebay_biz')-_calcPromoFee('ebay_biz',100,5,0.02)-40-4-1;
  check('eBay Business · normal sale',calcGrossProfit(i),expected);

  // 3 — seller-handled partial refund: principal out, eligible fee/ad credit in.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;
  i.returnHistory=[{type:'partial_seller',saleNo:1,refundAmount:20,loggedAt:'2026-08-02'}];
  expected=105-_netPlatformFeeAfterRefunds(i,1,'ebay_biz',100,5)
    -_netPromoFeeAfterRefunds(i,1,'ebay_biz',100,5,0.02)-20-40-4-1;
  check('eBay Business · seller partial refund',calcGrossProfit(i),expected);

  // 4 — eBay-decided partial refund: principal out, no eligible fee/ad credit.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;
  i.returnHistory=[{type:'partial_ebay',saleNo:1,refundAmount:20,loggedAt:'2026-08-02'}];
  expected=105-calcPlatformBPF(i,100,5,'ebay_biz')-_calcPromoFee('ebay_biz',100,5,0.02)-20-40-4-1;
  check('eBay Business · eBay partial refund',calcGrossProfit(i),expected);

  // 5 — Depop: current UK processing fee + optional boost, no legacy 10% seller fee.
  i=base('depop');
  expected=100-calcPlatformBPF(i,100,0,'depop')-_calcPromoFee('depop',100,0,0.02)-40-4-1;
  check('Depop UK · normal sale',calcGrossProfit(i),expected);

  // 6 — eBay Business full seller-handled return: stock cost is recoverable;
  // only retained fee + fulfilment/return costs remain as lifetime loss.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;i.isReturned=true;i.dateSold=null;
  i.returnHistory=[{type:'full_seller',saleNo:1,refundAmount:105,returnPostage:2,loggedAt:'2026-08-03',_salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:5,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.02}];
  expected=-(_netPlatformFeeAfterRefunds(i,1,'ebay_biz',100,5)+_netPromoFeeAfterRefunds(i,1,'ebay_biz',100,5,0.02)+4+1+2);
  check('eBay Business · full seller return',calcGrossProfit(i),expected);

  // 7 — eBay stepped in: no eligible eBay fee/ad credit, so those charges stay lost.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;i.isReturned=true;i.dateSold=null;
  i.returnHistory=[{type:'full_ebay',saleNo:1,refundAmount:105,returnPostage:2,loggedAt:'2026-08-03',_salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:5,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.02}];
  expected=-(calcPlatformBPF(i,100,5,'ebay_biz')+_calcPromoFee('ebay_biz',100,5,0.02)+4+1+2);
  check('eBay Business · eBay stepped-in full return',calcGrossProfit(i),expected);

  // 8 — multiple seller partials combine proportionally without double credit.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;
  i.returnHistory=[
    {type:'partial_seller',saleNo:1,refundAmount:10,loggedAt:'2026-08-02'},
    {type:'partial_seller',saleNo:1,refundAmount:15,loggedAt:'2026-08-03'}
  ];
  expected=105-_netPlatformFeeAfterRefunds(i,1,'ebay_biz',100,5)
    -_netPromoFeeAfterRefunds(i,1,'ebay_biz',100,5,0.02)-25-40-4-1;
  check('eBay Business · two partial refunds',calcGrossProfit(i),expected);

  // 9 — chronological P&L: sale + full return must reconcile to lifetime GP,
  // including the COGS credit when the stock comes back.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=5;i.isReturned=true;i.dateSold=null;
  const r1={type:'full_seller',saleNo:1,refundAmount:105,returnPostage:2,loggedAt:'2026-08-03',_salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:5,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.02};
  i.returnHistory=[r1];
  const sale1Ev={item:i,sale:'1',isReturnAdjustment:false};
  const ret1Ev={item:i,sale:'R',isReturnAdjustment:true,returnEntry:r1};
  expected=_saleBreakdown(sale1Ev).netProfit+_saleBreakdown(ret1Ev).netProfit;
  check('Statement events · full return reconcile',expected,calcGrossProfit(i));

  // 10 — return → resale: COGS is charged, reversed, then charged once more.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.postage=4;i.dateSold=null;i.salePrice=90;
  i.resaleSalePrice=90;i.resaleDateSold='2026-08-10';i.resalePlatform='ebay_biz';i.resalePostage=4;i.resaleShippingCost=3.5;i.resalePackagingCost=1;i.resalePromoPercent=0.01;
  const rr={type:'full_seller',saleNo:1,refundAmount:105,returnPostage:2,loggedAt:'2026-08-03',_salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:5,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.02,_salePriceAtRelist:100,_postageAtRelist:5,_shippingCostAtRelist:4,_packagingCostAtRelist:1,_promoPercentAtRelist:0.02,_relistedAt:'2026-08-05'};
  i.returnHistory=[rr];
  const evs=[{item:i,sale:'1',isReturnAdjustment:false},{item:i,sale:'R',isReturnAdjustment:true,returnEntry:rr},{item:i,sale:'2',isReturnAdjustment:false}];
  expected=evs.reduce(function(sum,ev){return sum+_saleBreakdown(ev).netProfit;},0);
  check('Statement events · return + resale reconcile',expected,calcGrossProfit(i));

  // 11 — Sale 2 full return: the second COGS is credited and the item is stock again.
  i.isReturned=true;
  const r2={type:'full_seller',saleNo:2,refundAmount:94,returnPostage:2.5,loggedAt:'2026-08-12',_salePriceAtReturn:90,_dateSoldAtReturn:'2026-08-10',_postageAtReturn:4,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.01};
  i.returnHistory=[rr,r2];
  const evs2=[{item:i,sale:'1',isReturnAdjustment:false},{item:i,sale:'R',isReturnAdjustment:true,returnEntry:rr},{item:i,sale:'2',isReturnAdjustment:false},{item:i,sale:'R',isReturnAdjustment:true,returnEntry:r2}];
  expected=evs2.reduce(function(sum,ev){return sum+_saleBreakdown(ev).netProfit;},0);
  check('Statement events · Sale 2 full return reconcile',expected,calcGrossProfit(i));

  // 12 — supplier account tracking must never deduct supplier cost twice.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.accountId='SUP';i.accountType='supplier';i.accountPaidAmount=40;i.accountSettled=true;
  check('Supplier account · no double deduction',calcNetProfit(i),calcGrossProfit(i));

  // 13 — consignment split is deducted once from gross profit.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.costPrice=0;i.accountId='CON';i.accountType='consignment';i.accountSplitPercent=50;
  expected=calcGrossProfit(i)*0.5;
  check('Consignment account · 50% split once',calcNetProfit(i),expected);

  // 13b — pre-sale estimate deducts the partner share exactly once while
  // costPrice stays at £0.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.state='listed';i.dateSold=null;i.costPrice=0;i.accountId='CON';i.accountType='consignment';i.accountSplitPercent=50;
  const estGross=calcEstGrossProfit(i);
  check('Consignment estimate · partner split deducted once',calcEstProfit(i),estGross*0.5);

  // 13c — returned + relisted stock: live listing price wins over a stale
  // sourcing estimate, and recovered stock basis is consumed exactly once.
  i=base('ebay_biz');
  i.category='Digital Cameras & Lenses';i.state='listed';i.dateSold=null;i.isReturned=false;
  i.salePrice=189.99;i.estSalePrice=270;i.costPrice=121.49;i.shippingCost=3.65;i.packagingCost=0;i.promoPercent=0.03;
  i.listingFee=0.72;i.resaleListingFee=0.36;
  i.returnHistory=[{type:'full_seller',saleNo:1,refundAmount:189.99,returnPostage:0,loggedAt:'2026-09-05',
    _salePriceAtReturn:189.99,_dateSoldAtReturn:'2026-08-23',_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.03,
    _salePriceAtRelist:189.99,_postageAtRelist:0,_shippingCostAtRelist:3.65,_packagingCostAtRelist:0,_promoPercentAtRelist:0.03,
    _listingFeeAtReturn:0.72,_listingFeeAtRelist:0.36,_platformAtRelist:'ebay_biz',_relistedAt:'2026-09-05'}];
  const returnedBase=calcGrossProfit(i);
  const nextSale=189.99-calcPlatformBPF(i,189.99,0,'ebay_biz')-_calcPromoFee('ebay_biz',189.99,0,0.03)-3.65-121.49;
  check('Relist estimate · live ask + stock basis once',calcEstGrossProfit(i),returnedBase+nextSale);

  // 14 — ordinary disposal permanently loses paid acquisition + parts cash.
  i={id:'CASH-SCRAP',item:'Cash scrap',scrappedAt:'2026-08-20',scrapReason:'scrapped',costPrice:40,parts:[{cost:5}]};
  check('Cash · scrapped stock capital loss',_cashRemovedItemNet(i),45);

  // 15 — supplier return restores the refunded cash, while unrecovered parts remain lost.
  i={id:'CASH-RET',item:'Supplier return',scrappedAt:'2026-08-20',scrapReason:'supplier_return',supplierRefund:40,costPrice:40,parts:[{cost:5}]};
  check('Cash · supplier refund nets unrecovered parts',_cashRemovedItemNet(i),5);

  // 16 — unpaid SOLD supplier debt is recognised in profit but must remain in cash.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.accountId='SUP';i.accountType='supplier';i.accountSettled=false;i.costPrice=40;
  const _oldKeys=typeof allDBKeys==='function'?allDBKeys:null;
  const _oldDB=DB;
  try{
    DB={TEST:[i],expenses:[],trips:[],cashLedger:[]};
    window.allDBKeys=function(){return ['TEST'];};
    check('Cash · unpaid sold supplier liability stays in cash',_cashUnpaidSoldLiabilities().supplier,40);
    i.accountSettled=true;
    check('Cash · settled sold supplier liability leaves cash',_cashUnpaidSoldLiabilities().supplier,0);
  }finally{
    DB=_oldDB;
    if(_oldKeys)window.allDBKeys=_oldKeys;
  }

  // 17 — unpaid consignment split likewise remains cash until settlement.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.accountId='CON';i.accountType='consignment';i.accountSettled=false;i.costPrice=0;i.accountSplitPercent=50;
  try{
    DB={TEST:[i],expenses:[],trips:[],cashLedger:[]};
    window.allDBKeys=function(){return ['TEST'];};
    const owe=_accountItemOwed(i)||0;
    check('Cash · unpaid consignment share stays in cash',_cashUnpaidSoldLiabilities().partner,owe);
    i.accountSettled=true;
    check('Cash · settled consignment share leaves cash',_cashUnpaidSoldLiabilities().partner,0);
  }finally{
    DB=_oldDB;
    if(_oldKeys)window.allDBKeys=_oldKeys;
  }

  // 18 — consignment already paid, then returned: the partner payout stays a
  // sunk lifetime cost and must not disappear while the unit is back in stock.
  i=base('ebay_biz');i.category='Laptops, Desktops & Tablets';i.costPrice=0;i.accountId='CON';i.accountType='consignment';
  i.accountSettled=true;i.accountPaidAmount=30;i.isReturned=true;i.dateSold=null;
  i.returnHistory=[{type:'full_seller',saleNo:1,refundAmount:100,returnPostage:2,loggedAt:'2026-08-03',_salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0.02}];
  check('Consignment · paid share survives return',calcNetProfit(i),+(calcGrossProfit(i)-30).toFixed(2));

  // 19 — when that same unit resells, the already-paid partner amount is still
  // deducted exactly once, not charged again for Sale 2.
  i.resaleSalePrice=90;i.resaleDateSold='2026-08-10';i.resalePlatform='ebay_biz';i.resalePostage=0;i.resaleShippingCost=3;i.resalePackagingCost=1;i.resalePromoPercent=0;
  i.isReturned=false;
  check('Consignment · paid share not doubled on resale',calcNetProfit(i),+(calcGrossProfit(i)-30).toFixed(2));

  const failed=results.filter(function(r){return !r.ok;});
  if(failed.length)console.error('[RETRADE financial regression] FAILED',failed);
  else console.info('[RETRADE financial regression] '+results.length+' checks passed');
  return {ok:failed.length===0,passed:results.length-failed.length,failed:failed.length,results:results};
}

function runStockLifecycleRegressionTests(){
  const results=[];
  const check=function(name,ok,detail){results.push({name:name,ok:!!ok,detail:detail||''});};
  const cents=function(xs){return Math.round((xs||[]).reduce(function(s,v){return s+(Number(v)||0);},0)*100);};

  let a=_jobLotAllocation(99.99,4.25,6.17,1.03,[10,20,30]);
  check('Job Lot · sale allocation exact',cents(a.sale)===9999,a.sale.join(', '));
  check('Job Lot · buyer postage allocation exact',cents(a.postage)===425,a.postage.join(', '));
  check('Job Lot · shipping allocation exact',cents(a.shipping)===617,a.shipping.join(', '));
  check('Job Lot · packaging allocation exact',cents(a.packaging)===103,a.packaging.join(', '));

  const first={
    id:'JL-FIRST',item:'First-sale child',state:'listed',salePrice:80,costPrice:30,
    dateSold:null,isReturned:false,returnHistory:[],parts:[],defaultPlatform:'ebay_biz',
    shippingCost:0,packagingCost:0,postage:0,promoPercent:0
  };
  _applyJobLotSaleLeg(first,{date:'2026-08-23',salePrice:55,postage:2,shipping:3,packaging:.5,promo:0,platform:'ebay_biz',bundleId:'B1',bundleRef:'JOB-1',bundleTotal:95});
  check('Job Lot · first-sale child uses Sale 1',first.dateSold==='2026-08-23'&&first.salePrice===55&&!first.resaleSalePrice,
    JSON.stringify({dateSold:first.dateSold,salePrice:first.salePrice,resaleSalePrice:first.resaleSalePrice||0}));

  const returned={
    id:'JL-RETURN',item:'Returned child',state:'returned',salePrice:100,costPrice:40,
    dateSold:null,isReturned:true,parts:[],defaultPlatform:'ebay_biz',soldOnPlatform:'ebay_biz',
    shippingCost:4,packagingCost:1,postage:5,promoPercent:0,
    returnHistory:[{type:'full_seller',saleNo:1,refundAmount:105,returnPostage:2,loggedAt:'2026-08-10',
      _salePriceAtReturn:100,_dateSoldAtReturn:'2026-08-01',_postageAtReturn:5,_platformAtReturn:'ebay_biz',
      _salePriceAtRelist:100,_postageAtRelist:5,_shippingCostAtRelist:4,_packagingCostAtRelist:1,_promoPercentAtRelist:0}]
  };
  _applyJobLotSaleLeg(returned,{date:'2026-08-23',salePrice:40,postage:1,shipping:2,packaging:.5,promo:0,platform:'ebay_biz',bundleId:'B1',bundleRef:'JOB-1',bundleTotal:95});
  check('Job Lot · returned child preserves Sale 1',returned.salePrice===100&&returned.resaleSalePrice===40&&returned.resaleDateSold==='2026-08-23'&&!returned.isReturned,
    JSON.stringify({sale1:returned.salePrice,sale2:returned.resaleSalePrice,resaleDate:returned.resaleDateSold}));
  check('Job Lot · Sale 2 bundle identity isolated',!returned.bundleId&&returned.resaleBundleId==='B1',
    JSON.stringify({sale1Bundle:returned.bundleId||null,sale2Bundle:returned.resaleBundleId||null}));

  check('Bundle helpers · mixed resale price',_bundleMemberSalePrice(returned,'B1')===40,'price '+_bundleMemberSalePrice(returned,'B1'));
  check('Bundle helpers · mixed resale postage',_bundleMemberPostage(returned,'B1')===1,'postage '+_bundleMemberPostage(returned,'B1'));
  const oldSaleEvent={item:returned,sale:'1',isReturned:false,isReturnAdjustment:false};
  const newSaleEvent={item:returned,sale:'2',isReturned:false,isReturnAdjustment:false};
  check('Bundle events · old Sale 1 not regrouped',_eventBundleId(oldSaleEvent)===null,'bundle '+(_eventBundleId(oldSaleEvent)||'none'));
  check('Bundle events · Sale 2 groups correctly',_eventBundleId(newSaleEvent)==='B1','bundle '+(_eventBundleId(newSaleEvent)||'none'));
  const legacyBundle={bundleId:'OLD',salePrice:75,postage:3,resaleSalePrice:90,resalePostage:4,returnHistory:[{type:'full_seller',saleNo:1}]};
  check('Bundle events · old bundle stays Sale 1 after later standalone resale',_bundleMemberSalePrice(legacyBundle,'OLD')===75&&_bundleMemberPostage(legacyBundle,'OLD')===3,
    JSON.stringify({price:_bundleMemberSalePrice(legacyBundle,'OLD'),postage:_bundleMemberPostage(legacyBundle,'OLD')}));

  // v1.3 — repeat-return lifecycle must not stop at Sale 2. A Sale 2 full
  // return that has been relisted advances the single live resale slot to Sale 3.
  const cycle3={
    salePrice:100,dateSold:null,resaleSalePrice:null,resaleDateSold:null,isReturned:false,
    returnHistory:[
      {type:'full_seller',saleNo:1,_dateSoldAtReturn:'2026-08-01',_salePriceAtReturn:100,_relistedAt:'2026-08-05'},
      {type:'full_seller',saleNo:2,_dateSoldAtReturn:'2026-08-10',_salePriceAtReturn:90,_relistedAt:'2026-08-15'}
    ]
  };
  check('Lifecycle · Sale 2 return advances to Sale 3',typeof _currentResaleSaleNo==='function'&&_currentResaleSaleNo(cycle3)===3,
    'next '+(typeof _currentResaleSaleNo==='function'?_currentResaleSaleNo(cycle3):'helper unavailable'));

  const failed=results.filter(function(r){return !r.ok;});
  if(failed.length)console.error('[RETRADE stock lifecycle regression] FAILED',failed);
  else console.info('[RETRADE stock lifecycle regression] '+results.length+' checks passed');
  return {ok:failed.length===0,passed:results.length-failed.length,failed:failed.length,results:results};
}


// Launch Audit v1.3 — deterministic cash-ledger coverage. These checks model
// the real event ledger rather than the old profit-to-cash bridge.
function runCashLedgerRegressionTests(){
  const results=[];
  const near=function(a,b){return Math.abs((Number(a)||0)-(Number(b)||0))<0.011;};
  const check=function(name,ok,detail){results.push({name:name,ok:!!ok,detail:detail||''});};
  const oldDB=DB;
  const oldAccounts=(typeof _accounts!=='undefined')?_accounts.slice():[];
  const baseLedger=function(){return [{id:'OPEN',type:'opening_balance',amount:1000,direction:'in',date:'2026-08-01',description:'Opening'}];};
  const baseItem=function(){return {id:'C1',item:'Cash test',state:'listed',dateSourced:'2026-08-01',dateListed:'2026-08-02',salePrice:180,costPrice:100,shippingCost:5,packagingCost:1,postage:0,promoPercent:0,parts:[{id:'P1',description:'Repair',cost:10,date:'2026-08-01'}],listingFee:0,defaultPlatform:'ebay_biz',salePlatform:'ebay_biz',returnHistory:[]};};
  const reset=function(items){
    DB={trips:[],expenses:[],cashLedger:baseLedger(),'AUG-26':items||[]};
    if(typeof _accounts!=='undefined'){_accounts.length=0;}
  };
  try{
    reset([]);
    DB.cashLedger.push({id:'CON',type:'owner_contribution',amount:50,direction:'in',date:'2026-08-02'});
    DB.cashLedger.push({id:'DRAW',type:'owner_draw',amount:20,direction:'out',date:'2026-08-03'});
    DB.cashLedger.push({id:'ADJ',type:'adjustment',amount:10,direction:'out',date:'2026-08-04'});
    let c=calcCashSummary();
    check('Cash ledger · manual movements exact',near(c.cashAvailable,1020),'cash '+c.cashAvailable);

    let i=baseItem();reset([i]);c=calcCashSummary();
    check('Cash ledger · sourced own stock leaves cash',near(c.cashAvailable,890),'cash '+c.cashAvailable);
    check('Cash ledger · stock + part each occur once',c.events.filter(function(e){return e.type==='stock_purchase';}).length===1&&c.events.filter(function(e){return e.type==='part_purchase';}).length===1,JSON.stringify(c.events.map(function(e){return e.type;})));

    i.dateSold='2026-08-03';i.state='sold';reset([i]);c=calcCashSummary();
    const saleEvents=c.events.filter(function(e){return e.itemId===i.id&&['sale_receipt','platform_fee','shipping','packaging'].includes(e.type);});
    const expectedSale=1000-100-10+saleEvents.reduce(function(sum,e){return sum+(e.direction==='out'?-e.amount:e.amount);},0);
    check('Cash ledger · sale receipt and selling cash reconcile',near(c.cashAvailable,expectedSale),'cash '+c.cashAvailable+' expected '+expectedSale.toFixed(2));
    check('Cash ledger · one sale receipt',saleEvents.filter(function(e){return e.type==='sale_receipt';}).length===1,'receipts '+saleEvents.filter(function(e){return e.type==='sale_receipt';}).length);

    const fr={type:'full_seller',saleNo:1,refundAmount:180,returnPostage:4,loggedAt:'2026-08-05',_dateSoldAtReturn:'2026-08-03',_salePriceAtReturn:180,_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0,_shippingCostAtReturn:5,_packagingCostAtReturn:1};
    i.returnHistory=[fr];i.dateSold=null;i.isReturned=true;i.state='returned';reset([i]);c=calcCashSummary();
    check('Cash ledger · full return creates refund once',c.events.filter(function(e){return e.type==='customer_refund';}).length===1,'refunds '+c.events.filter(function(e){return e.type==='customer_refund';}).length);
    check('Cash ledger · return postage creates outflow',c.events.some(function(e){return e.type==='return_postage'&&near(e.amount,4);}),JSON.stringify(c.events.filter(function(e){return /refund|return/.test(e.type);}).map(function(e){return [e.type,e.amount,e.direction];})));

    // Repeat lifecycle: two full returns followed by Sale 3. The ledger must
    // contain exactly three receipts and two customer refunds — never overwrite.
    i=baseItem();i.costPrice=40;i.parts=[{id:'P1',cost:5,date:'2026-08-01'}];i.salePrice=100;i.dateSold=null;i.state='sold';
    i.returnHistory=[
      {type:'full_seller',saleNo:1,refundAmount:100,returnPostage:3,loggedAt:'2026-08-05',_dateSoldAtReturn:'2026-08-03',_salePriceAtReturn:100,_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0,_shippingCostAtReturn:4,_packagingCostAtReturn:1,_relistedAt:'2026-08-06',_platformAtRelist:'ebay_biz',_listingFeeAtRelist:0},
      {type:'full_seller',saleNo:2,refundAmount:110,returnPostage:3,loggedAt:'2026-08-10',_dateSoldAtReturn:'2026-08-08',_salePriceAtReturn:110,_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0,_shippingCostAtReturn:4,_packagingCostAtReturn:1,_relistedAt:'2026-08-11',_platformAtRelist:'ebay_biz',_listingFeeAtRelist:0}
    ];
    i.shippingCost=4;i.packagingCost=1;i.resaleSalePrice=120;i.resaleDateSold='2026-08-13';i.resalePlatform='ebay_biz';i.resalePostage=0;i.resaleShippingCost=4;i.resalePackagingCost=1;i.resalePromoPercent=0;i.isReturned=false;
    reset([i]);c=calcCashSummary();
    check('Cash ledger · Sale 3 keeps all three receipts',c.events.filter(function(e){return e.type==='sale_receipt'&&e.itemId===i.id;}).length===3,'receipts '+c.events.filter(function(e){return e.type==='sale_receipt'&&e.itemId===i.id;}).length);
    check('Cash ledger · Sale 3 keeps both historic refunds',c.events.filter(function(e){return e.type==='customer_refund'&&e.itemId===i.id;}).length===2,'refunds '+c.events.filter(function(e){return e.type==='customer_refund'&&e.itemId===i.id;}).length);

    // Supplier stock does not leave cash at receipt; its paid settlement does.
    const sup=baseItem();sup.id='SUPITEM';sup.item='Supplier stock';sup.costPrice=60;sup.parts=[];sup.accountId='SUP';sup.accountType='supplier';sup.dateSold=null;sup.salePrice=100;
    reset([sup]);
    if(typeof _accounts!=='undefined')_accounts.push({id:'SUP',name:'Supplier',type:'supplier',settlements:[]});
    let ev=_cashEventsAll();
    check('Cash ledger · unpaid supplier stock is not a purchase outflow',!ev.some(function(e){return e.itemId===sup.id&&e.type==='stock_purchase';}),JSON.stringify(ev.filter(function(e){return e.itemId===sup.id;})));
    if(typeof _accounts!=='undefined')_accounts[0].settlements.push({id:'ST1',date:'2026-08-06',paid:true,partnerAmount:60,items:[{itemId:sup.id,amount:60}]});
    c=calcCashSummary();
    check('Cash ledger · paid supplier settlement leaves cash once',c.events.filter(function(e){return e.type==='partner_settlement'&&e.id==='settlement:ST1';}).length===1&&near(c.cashAvailable,940),'cash '+c.cashAvailable);

    // Business expense and trip sub-expense are cash; HMRC mileage allowance is not.
    reset([]);DB.expenses=[{id:'E1',date:'2026-08-07',amount:25,description:'Tape'}];DB.trips=[{id:'T1',date:'2026-08-08',mileage:100,expenses:[{amount:6,description:'Parking'}]}];
    c=calcCashSummary();
    check('Cash ledger · real expenses reduce cash, mileage allowance does not',near(c.cashAvailable,969),'cash '+c.cashAvailable);
  }finally{
    DB=oldDB;
    if(typeof _accounts!=='undefined'){_accounts.length=0;oldAccounts.forEach(function(a){_accounts.push(a);});}
  }
  const failed=results.filter(function(r){return !r.ok;});
  if(failed.length)console.error('[RETRADE cash ledger regression] FAILED',failed);else console.info('[RETRADE cash ledger regression] '+results.length+' checks passed');
  return {ok:failed.length===0,passed:results.length-failed.length,failed:failed.length,results:results};
}

// Launch Audit v1.3 — Summary must count each sale cycle, not only the final
// item state. Sale 1/2 returns and Sale 3 remain separate dated transactions.
function runSummaryCycleRegressionTests(){
  const results=[];
  const near=function(a,b){return Math.abs((Number(a)||0)-(Number(b)||0))<0.011;};
  const check=function(name,ok,detail){results.push({name:name,ok:!!ok,detail:detail||''});};
  const oldDB=DB;
  const oldAccounts=(typeof _accounts!=='undefined')?_accounts.slice():[];
  try{
    if(typeof _accounts!=='undefined')_accounts.length=0;
    const i={id:'SUM3',item:'Summary Sale 3',category:'Laptops, Desktops & Tablets',state:'sold',dateSourced:'2026-08-01',dateListed:'2026-08-02',salePrice:100,costPrice:40,shippingCost:4,packagingCost:1,postage:0,promoPercent:0,parts:[],listingFee:0,defaultPlatform:'ebay_biz',salePlatform:'ebay_biz',dateSold:null,isReturned:false,
      returnHistory:[
        {type:'full_seller',saleNo:1,refundAmount:100,returnPostage:3,loggedAt:'2026-08-05',_dateSoldAtReturn:'2026-08-03',_salePriceAtReturn:100,_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0,_shippingCostAtReturn:4,_packagingCostAtReturn:1,_relistedAt:'2026-08-06',_salePriceAtRelist:110,_postageAtRelist:0,_shippingCostAtRelist:4,_packagingCostAtRelist:1,_promoPercentAtRelist:0,_platformAtRelist:'ebay_biz',_listingFeeAtRelist:0},
        {type:'full_seller',saleNo:2,refundAmount:110,returnPostage:3,loggedAt:'2026-08-10',_dateSoldAtReturn:'2026-08-08',_salePriceAtReturn:110,_postageAtReturn:0,_platformAtReturn:'ebay_biz',_promoPercentAtReturn:0,_shippingCostAtReturn:4,_packagingCostAtReturn:1,_relistedAt:'2026-08-11',_salePriceAtRelist:120,_postageAtRelist:0,_shippingCostAtRelist:4,_packagingCostAtRelist:1,_promoPercentAtRelist:0,_platformAtRelist:'ebay_biz',_listingFeeAtRelist:0}
      ],resaleSalePrice:120,resaleDateSold:'2026-08-13',resalePlatform:'ebay_biz',resalePostage:0,resaleShippingCost:4,resalePackagingCost:1,resalePromoPercent:0,resaleListingFee:0};
    DB={trips:[],expenses:[],cashLedger:[],'AUG-26':[i]};
    const ev=getSaleEventsInRange('2026-08-01','2026-08-31');
    const sales=ev.filter(function(x){return !x.isReturnAdjustment;});
    const returns=ev.filter(function(x){return x.isReturnAdjustment;});
    check('Summary Sale-N · three sales retained',sales.length===3&&sales.map(function(x){return Number(x.sale);}).join(',')==='1,2,3','sales '+sales.map(function(x){return x.sale;}).join(','));
    check('Summary Sale-N · two returns retained',returns.length===2&&returns.map(function(x){return Number(x.returnEntry.saleNo);}).join(',')==='1,2','returns '+returns.map(function(x){return x.returnEntry.saleNo;}).join(','));
    const s=calcYearlyStats('all');
    check('Summary Sale-N · sold count is transactions',s.soldCount===3,'sold '+s.soldCount);
    check('Summary Sale-N · refund cohort counts two full refunds',s.fullRefundCount===2&&s.refundDenom===3,'refunds '+s.fullRefundCount+' / '+s.refundDenom);
    check('Summary Sale-N · refund rate is 66.7%',Math.abs(s.refundItemRate-66.6667)<0.1,'rate '+s.refundItemRate);
    check('Summary Sale-N · average sale uses all cycles',near(s.avgSale,110),'avg '+s.avgSale);
    const eventProfit=ev.reduce(function(sum,x){return sum+_saleBreakdown(x).netProfit;},0);
    check('Summary Sale-N · realised profit reconciles to events',near(s.realisedProfit,eventProfit),'summary '+s.realisedProfit+' events '+eventProfit.toFixed(2));
    check('Summary Sale-N · current revenue is net of dated full refunds',near(s.totalRev,120),'revenue '+s.totalRev);
    check('Summary Sale-N · days-to-sell uses each listing cycle',s.avgDays===2,'days '+s.avgDays);
    const cat=(s.byCat||[]).find(function(x){return x.cat==='Laptops, Desktops & Tablets';});
    check('Summary Sale-N · category analytics retain all cycles',!!cat&&cat.sold===3,'cat '+JSON.stringify(cat||null));
    const late=_statsForRange({from:'2026-08-12',to:'2026-08-31'});
    check('Summary Sale-N · later range sees Sale 3 only',late.soldCount===1&&near(late.totalRev,120),'late '+JSON.stringify(late));
    const aug=calcMonthStatsBySale('AUG-26');
    check('Summary Sale-N · monthly sold count retains all cycles',aug.soldCount===3,'monthly sold '+aug.soldCount);
    check('Summary Sale-N · monthly revenue reconciles Sale-N returns',near(aug.totalRev,120),'monthly revenue '+aug.totalRev);
    check('Summary Sale-N · legacy days helper is Sale-N aware',calcDaysToSell(i)===2,'days helper '+calcDaysToSell(i));
  }finally{
    DB=oldDB;
    if(typeof _accounts!=='undefined'){_accounts.length=0;oldAccounts.forEach(function(a){_accounts.push(a);});}
  }
  const failed=results.filter(function(r){return !r.ok;});
  if(failed.length)console.error('[RETRADE summary cycle regression] FAILED',failed);else console.info('[RETRADE summary cycle regression] '+results.length+' checks passed');
  return {ok:failed.length===0,passed:results.length-failed.length,failed:failed.length,results:results};
}

function calcCOGSOnly(i){
  return +((i.costPrice||0)+calcPartsCost(i)).toFixed(2);
}

function _estimatedPartnerCutFromProfit(i,profit){
  if(i==null||profit==null)return 0;
  if(_itemAccountType(i)==='supplier')return 0;
  if(i.accountPaidAmount!=null)return +Math.max(0,Number(i.accountPaidAmount)||0).toFixed(2);
  let pct=i.accountSplitPercent;
  if(pct==null&&i.accountId){
    const acct=(_accounts||[]).find(function(a){return a.id===i.accountId;});
    if(acct&&acct.defaultSplitPercent!=null)pct=acct.defaultSplitPercent;
  }
  if(pct==null)return 0;
  pct=Math.max(0,Math.min(100,Number(pct)||0));
  return +(Math.max(0,Number(profit)||0)*(pct/100)).toFixed(2);
}

// v1.4.10 — Expected profit is an operational stock metric, not merely the
// current realised P&L. If a physical item is back in hand after one or more
// full-return cycles, show what its LIFETIME P&L would become if the next sale
// completes at the current expected ask. Acquisition cost stays sunk/recoverable
// exactly once; the hypothetical next cycle only adds its incremental economics.
function calcEstGrossProfit(i){
  if(!i)return null;
  const onHand=!i.scrappedAt&&(!!i.isReturned||(!i.dateSold&&!i.resaleSalePrice));
  const hasCompletedReturn=(i.returnHistory||[]).some(function(r){return r&&(r.type==='full_seller'||r.type==='full_ebay');});

  if(onHand&&hasCompletedReturn){
    const base=calcGrossProfit(i);
    if(base===null)return null;
    // Once the returned unit has been relisted, salePrice is the live ask.
    // estSalePrice is a sourcing-era estimate and may legitimately remain higher;
    // never let that stale estimate replace the price the item is actually listed at.
    const ask=(Number(i.salePrice)>0)?Number(i.salePrice):Math.max(0,Number(i.estSalePrice)||0);
    if(ask<=0)return base;
    const platformId=_itemPlatform(i);
    const post=Math.max(0,Number(i.postage)||0);
    const sellerPostage=(typeof _sellerPostageIncome==='function')?_sellerPostageIncome(platformId,post):post;
    const bpf=Math.max(0,Number(calcPlatformBPF(i,ask,post,platformId))||0);
    const promo=Math.max(0,Number(_calcPromoFee(platformId,ask,post,Number(i.promoPercent)||0))||0);
    const sellerPays=(typeof _sellerPaysOutbound==='function')?_sellerPaysOutbound(platformId):(platformId!=='vinted'&&platformId!=='fb');
    const fulfilment=sellerPays?(Math.max(0,Number(i.shippingCost)||0)+Math.max(0,Number(i.packagingCost)||0)):0;
    // A full return restores buy cost + parts to stock, so calcGrossProfit(base)
    // correctly does NOT realise them as a loss while the unit is back in hand.
    // The hypothetical next successful sale consumes that stock basis once as COGS.
    const stockBasis=Math.max(0,Number(i.costPrice)||0)+Math.max(0,Number(calcPartsCost(i))||0);
    // Any relist insertion fee already recorded on the return event is already
    // contained in calcGrossProfit(base), so never deduct it twice here.
    const nextCycle=ask+sellerPostage-bpf-promo-fulfilment-stockBasis;
    return +(base+nextCycle).toFixed(2);
  }

  // Fresh listed stock keeps the established estimate semantics.
  if(!i.salePrice)return null;
  const base=calcGrossProfit(i);
  if(base===null)return null;
  return +base.toFixed(2);
}

function calcEstProfit(i){
  const gross=calcEstGrossProfit(i);
  if(gross===null)return null;
  return +(gross-_estimatedPartnerCutFromProfit(i,gross)).toFixed(2);
}

function calcROI(i){
  if(!i.dateSold&&!i.isReturned&&!i.resaleSalePrice&&!i.scrappedAt)return null;
  // ROI denominator = capital actually outlaid to acquire and prep the item.
  // eBay fees (BPF) and promo fees are deductions from revenue, not investments —
  // they do not belong in the denominator. This keeps ROI honest:
  //   e.g. £15 cost → £39 net profit = 260% ROI (not 135%).
  let totalInvested=(i.costPrice||0)+(i.shippingCost||0)+(i.packagingCost||0)+calcPartsCost(i);
  // For resold items: add resale shipping/packaging (real outlay on the second go).
  if(i.resaleSalePrice){
    totalInvested+=(i.resaleShippingCost||0)+(i.resalePackagingCost||0);
  }
  if(totalInvested<=0)return null;
  return+((calcNetProfit(i)/totalInvested)*100).toFixed(1);
}

function calcMargin(i){
  if(!i.dateSold&&!i.isReturned&&!i.resaleSalePrice&&!i.scrappedAt)return null;
  const rev=calcItemRevenue(i);
  if(!rev||rev<=0)return null;
  const profit=calcNetProfit(i);
  if(profit===null)return null;
  return+((profit/rev)*100).toFixed(1);
}

function daysBetween(d1,d2){
  // E3 P2 #10 — Null/empty inputs previously yielded ~20,000 days
  // (Unix epoch fallthrough), bucketing null-dateListed items into
  // 'stale'. Return -1 sentinel; filter call sites should guard on
  // i.dateListed before calling rather than relying on the sentinel,
  // because no single sentinel value can be excluded from all bucket
  // ranges simultaneously (fresh=<=30 includes -1, stale=>=90 doesn't).
  if(!d1||!d2)return -1;
  const a=new Date(d1);
  const b=new Date(d2);
  if(isNaN(a)||isNaN(b))return -1;
  const diff=Math.abs(b-a);
  return Math.floor(diff/(1000*60*60*24));
}

function _effectiveListDate(i){
  if(!i)return null;
  if(!i.dateSold&&!i.resaleSalePrice){
    // Most recent relist wins. confirmRelist and markRelisted both maintain
    // _lastRelistAt, so this is the authoritative clock-reset point.
    if(i._lastRelistAt)return i._lastRelistAt;
    // v2.15.0 legacy fallback — items relisted BEFORE this version have a
    // _relistedAt on their return entry but no maintenance record. The old
    // guard here was `i.isReturned && !i.resaleSalePrice`, which could never
    // be true for a relisted item because confirmRelist sets isReturned=false
    // when it restores the item to active stock. The branch was therefore dead
    // and those items silently kept their ORIGINAL dateListed age.
    const r=(i.returnHistory||[]).slice().reverse().find(function(r){return(r.type==='full_seller'||r.type==='full_ebay')&&r._relistedAt;});
    if(r&&r._relistedAt)return r._relistedAt;
    // v2.21.48 — returned-and-back item is fresh again; clock from the return date.
    const _rd=(typeof _returnedToStockDate==='function')?_returnedToStockDate(i):null;
    if(_rd)return _rd;
  }
  return i.dateListed||null;
}

function _lifetimeListDays(i){
  if(!i||!i.dateListed)return null;
  const end=i.dateSold||i.resaleDateSold||new Date().toISOString().split('T')[0];
  return daysBetween(i.dateListed,end);
}

function _timeToList(i){
  if(!i || !i.dateSourced || !i.dateListed) return null;
  const d=daysBetween(i.dateSourced,i.dateListed);
  return d<0 ? null : d;
}

function _daysInStock(i){
  if(!i) return null;
  // v2.21.48 — a returned item that's back in stock restarts its clock from the
  // return date (fresh repost time), not the original sourcing date.
  const start=(typeof _returnedToStockDate==='function' && _returnedToStockDate(i)) || i.dateSourced;
  if(!start) return null;
  const today=new Date().toISOString().split('T')[0];
  const d=daysBetween(start,today);
  return d<0 ? null : d;
}

function calcDaysToSell(i){
  if(!i)return null;
  // Sale-N aware average listing velocity. Every completed cycle owns its
  // frozen listing date and sale date; failed cycles therefore remain in the
  // average after Sale 3/4+ instead of collapsing into the latest resale.
  if(typeof _saleCycleNumbers==='function'&&typeof _saleCycleSnapshot==='function'){
    const vals=[];
    _saleCycleNumbers(i).forEach(function(n){
      const cyc=_saleCycleSnapshot(i,n);
      if(!cyc||!cyc.listedDate||!cyc.date)return;
      const d=daysBetween(cyc.listedDate,cyc.date);
      if(d>=0&&Number.isFinite(Number(d)))vals.push(Number(d));
    });
    if(vals.length)return Math.round(vals.reduce(function(a,b){return a+b;},0)/vals.length);
  }
  if(i.dateSold&&i.dateListed){const d=daysBetween(i.dateListed,i.dateSold);return d>=0?d:null;}
  return null;
}
