from pathlib import Path

# accounting.js
p=Path('accounting.js')
s=p.read_text(encoding='utf-8')
old="""    const ask=(Number(i.estSalePrice)>0)?Number(i.estSalePrice):Math.max(0,Number(i.salePrice)||0);
    if(ask<=0)return base;
    const platformId=_itemPlatform(i);
    const post=Math.max(0,Number(i.postage)||0);
    const sellerPostage=(typeof _sellerPostageIncome==='function')?_sellerPostageIncome(platformId,post):post;
    const bpf=Math.max(0,Number(calcPlatformBPF(i,ask,post,platformId))||0);
    const promo=Math.max(0,Number(_calcPromoFee(platformId,ask,post,Number(i.promoPercent)||0))||0);
    const sellerPays=(typeof _sellerPaysOutbound==='function')?_sellerPaysOutbound(platformId):(platformId!=='vinted'&&platformId!=='fb');
    const fulfilment=sellerPays?(Math.max(0,Number(i.shippingCost)||0)+Math.max(0,Number(i.packagingCost)||0)):0;
    // Any relist insertion fee already recorded on the return event is already
    // contained in calcGrossProfit(base), so never deduct it twice here.
    const nextCycle=ask+sellerPostage-bpf-promo-fulfilment;
    return +(base+nextCycle).toFixed(2);"""
new="""    // Once the returned unit has been relisted, salePrice is the live ask.
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
    return +(base+nextCycle).toFixed(2);"""
if old not in s: raise SystemExit('calcEstGrossProfit target not found')
s=s.replace(old,new,1)
anchor="""  const estGross=calcEstGrossProfit(i);
  check('Consignment estimate · partner split deducted once',calcEstProfit(i),estGross*0.5);

  // 14 — ordinary disposal permanently loses paid acquisition + parts cash."""
fixture="""  const estGross=calcEstGrossProfit(i);
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

  // 14 — ordinary disposal permanently loses paid acquisition + parts cash."""
if anchor not in s: raise SystemExit('regression anchor not found')
s=s.replace(anchor,fixture,1)
p.write_text(s,encoding='utf-8',newline='')

# app.js
p=Path('app.js')
s=p.read_text(encoding='utf-8')
reps=[
("if(_showFee)pb+=rcp(_feeLabel,'−'+fmt(bpf),'var(--red)');","if(_showFee)pb+=rcp(_feeLabel,'−'+fmt(_origBpfBeforeCredits),'var(--red)');"),
("if(_rcptPromo)pb+=rcp((_plat==='ebay'?'Promo fee ('+((_rcptPromo*100).toFixed(0))+'% +VAT)':'Boost fee ('+((_rcptPromo*100).toFixed(0))+'%)'),'−'+fmt(promoCost),'var(--red)');","if(_rcptPromo)pb+=rcp((_plat==='ebay'?'Promo fee ('+((_rcptPromo*100).toFixed(0))+'% +VAT)':'Boost fee ('+((_rcptPromo*100).toFixed(0))+'%)'),'−'+fmt(_origPromoBeforeCredits),'var(--red)');"),
("    const rlCost=rlShipping+rlPackaging+rlPromo;","    const rlItemCost=Math.max(0,Number(i.costPrice)||0);\n    const rlPartsCost=Math.max(0,Number(calcPartsCost(i))||0);\n    const rlStockBasis=rlItemCost+rlPartsCost;\n    const rlCost=rlShipping+rlPackaging+rlPromo+rlStockBasis;"),
("oninput=\"_recalcRelist(${profit},${rlSalePrice},${rlBPF},${rlShipping},${rlPackaging},${rlPostage})\"","oninput=\"_recalcRelist(${profit},${rlSalePrice},${rlBPF},${rlShipping},${rlPackaging},${rlPostage},'${_itemPlatform(i)}',${rlStockBasis})\""),
("        <div class=\"ip-receipt-row\"><span style=\"flex:1;color:var(--muted)\">Item cost (sunk)</span><span class=\"ip-receipt-val\" style=\"color:var(--muted)\">—</span></div>","        <div class=\"ip-receipt-row\"><span style=\"flex:1\">Item cost</span><span class=\"ip-receipt-val\" style=\"color:var(--red)\">−${fmt(rlItemCost)}</span></div>\n        ${rlPartsCost>0?`<div class=\"ip-receipt-row\"><span style=\"flex:1\">Parts & expenses</span><span class=\"ip-receipt-val\" style=\"color:var(--red)\">−${fmt(rlPartsCost)}</span></div>`:''}"),
("function _recalcRelist(currentPL,salePrice,bpf,shipping,packaging,postage){","function _recalcRelist(currentPL,salePrice,bpf,shipping,packaging,postage,platformId,stockBasis){"),
("  const promoCost=_calcPromoFee('ebay',salePrice,postage,promoInput/100);","  const promoCost=_calcPromoFee(platformId||'ebay',salePrice,postage,promoInput/100);"),
("  const cost=shipping+packaging+promoCost;","  const cost=shipping+packaging+promoCost+Math.max(0,Number(stockBasis)||0);")]
for old,new in reps:
    if old not in s: raise SystemExit('app target missing: '+old[:70])
    s=s.replace(old,new,1)
if 'const RECOIL=26;' not in s: raise SystemExit('recoil constant missing')
s=s.replace('const RECOIL=26;','const RECOIL=16;',1)
s=s.replace('// six slices, 26 user units always fits without data-dependent clamping.','// six slices, 16 user units gives a visible endpoint recoil without a lurch.',1)
p.write_text(s,encoding='utf-8',newline='')

# index.html
p=Path('index.html')
s=p.read_text(encoding='utf-8')
start=s.find('/* Keep the ring as one continuous sweep, then add the missing bounce on the')
end=s.find('@media(prefers-reduced-motion:reduce){',start)
if start<0 or end<0: raise SystemExit('index donut block missing')
block="""/* The ring itself never scales. It sweeps to a complete circle, then only the
   closing stroke endpoint recoils, overshoots and settles — like the drawn line
   physically meeting the start of the ring and bouncing off it. */
#p-summary svg.cat-donut-draw{--dur-donut-sweep:840ms;}
@keyframes rtDonutEndpointBounce{
  0%{stroke-dasharray:var(--seg-len) var(--seg-rest);animation-timing-function:cubic-bezier(.22,.75,.25,1);}
  30%{stroke-dasharray:var(--seg-len-r) var(--seg-rest-r);animation-timing-function:cubic-bezier(.45,0,.3,1);}
  64%{stroke-dasharray:var(--seg-len-o) var(--seg-rest-o);animation-timing-function:cubic-bezier(.25,.75,.3,1);}
  100%{stroke-dasharray:var(--seg-len) var(--seg-rest);}
}
#p-summary svg.cat-donut-draw circle.donut-seg-last{
  animation:
    donutSweep calc(var(--seg-t) * var(--dur-donut-sweep)) cubic-bezier(.35,.35,.72,1) calc(var(--seg-t0) * var(--dur-donut-sweep)) both,
    rtDonutEndpointBounce 300ms linear var(--dur-donut-sweep) forwards;
}

"""
s=s[:start]+block+s[end:]
s=s.replace("  #p-summary .cat-donut-chart:has(svg.cat-donut-draw){\n    animation:none!important;animation-delay:0ms!important;\n  }","  #p-summary svg.cat-donut-draw circle.donut-seg-last{\n    animation:none!important;animation-delay:0ms!important;\n  }",1)
s=s.replace("  #p-summary .cat-donut-chart:has(svg.cat-donut-draw){transform:none!important;}\n",'',1)
if 'rtDonutFinishBounce' in s: raise SystemExit('whole donut bounce remains')
p.write_text(s,encoding='utf-8',newline='')
