from pathlib import Path
import re

JS=Path('app.js'); IDX=Path('index.html')
js=JS.read_text(encoding='utf-8')
idx=IDX.read_text(encoding='utf-8')

for token in [
    "var VERSION='1.4.13-2026-09-02'",
    'v1.4.15 stable return identity loaded',
    'v1.4.16 bulk platform editing loaded',
    'v1.4.17 terminal disposal durability loaded',
    'v1.4.18 polished real-layout loading loaded',
    'v1.4.19 Sales month-card loading loaded',
    'function showRealLayoutLoading(tab,msg){',
]:
    if token not in js: raise SystemExit('missing production guard: '+token)
if 'v1.4.20 populated real-layout loading shell loaded' in js:
    raise SystemExit('v1.4.20 already applied')

helper=r'''
// v1.4.20 — populated real-layout loading shell.
// Render the ACTUAL page components with a tiny temporary in-memory dataset so an
// empty pre-cloud DB never falls into onboarding/empty-state UI. The real DB is
// restored synchronously before any async cloud work continues; nothing here is
// persisted or staged to the outbox.
function _withRealLoadingSeed(renderFn){
  if(typeof renderFn!=='function')return;
  if(typeof DB!=='object'||!DB)return renderFn();

  const monthRe=/^[A-Z]{3}-\d{2}$/;
  const savedMonths={};
  const savedFields={};
  const fieldNames=['expenses','trips','cashLedger','sourcingRuns'];

  Object.keys(DB).forEach(function(k){
    if(monthRe.test(k)){
      savedMonths[k]=DB[k];
      try{delete DB[k];}catch(e){DB[k]=[];}
    }
  });
  fieldNames.forEach(function(k){
    savedFields[k]={had:Object.prototype.hasOwnProperty.call(DB,k),value:DB[k]};
    DB[k]=[];
  });

  const mons=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const now=new Date();
  const curKey=mons[now.getMonth()]+'-'+String(now.getFullYear()).slice(-2);
  const prev=new Date(now.getFullYear(),now.getMonth()-1,1);
  const prevKey=mons[prev.getMonth()]+'-'+String(prev.getFullYear()).slice(-2);
  const iso=function(d){return d.toISOString().slice(0,10);};
  const curStart=new Date(now.getFullYear(),now.getMonth(),1);
  const prevStart=new Date(prev.getFullYear(),prev.getMonth(),1);

  DB[prevKey]=[
    {
      id:'__loading_sold__',gid:'R-LOAD1',item:'Loading item',state:'sold',
      dateSourced:iso(prevStart),dateListed:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),3)),
      dateSold:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),18)),salePrice:79.99,costPrice:20,
      postage:0,shippingCost:3.65,packagingCost:0,promoPercent:.05,listingFee:.36,isReturned:false,
      returnHistory:[],parts:[],defaultPlatform:'ebay_biz',salePlatform:'ebay_biz'
    },
    {
      id:'__loading_return__',gid:'R-LOAD2',item:'Loading returned item',state:'returned',
      dateSourced:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),2)),
      dateListed:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),4)),dateSold:null,
      salePrice:49.99,costPrice:12,postage:0,shippingCost:3.65,packagingCost:0,promoPercent:.05,
      listingFee:.36,isReturned:true,parts:[],defaultPlatform:'ebay_biz',
      returnHistory:[{id:-9001,saleNo:1,type:'full_seller',loggedAt:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),24)),refundAmount:49.99,returnPostage:0,_dateSoldAtReturn:iso(new Date(prevStart.getFullYear(),prevStart.getMonth(),16)),_salePriceAtReturn:49.99,_relistedAt:null}]
    }
  ];
  DB[curKey]=[
    {
      id:'__loading_listed__',gid:'R-LOAD3',item:'Loading listed item',state:'listed',
      dateSourced:iso(curStart),dateListed:iso(curStart),dateSold:null,salePrice:39.99,costPrice:8,
      postage:0,shippingCost:3.65,packagingCost:0,promoPercent:.05,listingFee:.36,isReturned:false,
      returnHistory:[],parts:[],defaultPlatform:'ebay_biz'
    },
    {
      id:'__loading_sourced__',gid:'R-LOAD4',item:'Loading unlisted item',state:'sourced',
      dateSourced:iso(new Date(curStart.getFullYear(),curStart.getMonth(),2)),dateListed:null,dateSold:null,
      salePrice:0,estSalePrice:55,costPrice:10,postage:0,shippingCost:0,packagingCost:0,promoPercent:0,
      listingFee:0,isReturned:false,returnHistory:[],parts:[],defaultPlatform:'ebay_biz'
    }
  ];

  try{
    return renderFn();
  }finally{
    Object.keys(DB).forEach(function(k){if(monthRe.test(k)){try{delete DB[k];}catch(e){DB[k]=[];}}});
    Object.keys(savedMonths).forEach(function(k){DB[k]=savedMonths[k];});
    fieldNames.forEach(function(k){
      const s=savedFields[k];
      if(s.had)DB[k]=s.value;
      else try{delete DB[k];}catch(e){DB[k]=s.value;}
    });
  }
}

'''
marker='function showRealLayoutLoading(tab,msg){'
if js.count(marker)!=1: raise SystemExit('showRealLayoutLoading marker count != 1')
js=js.replace(marker,helper+marker,1)

old="""    if(typeof _ensureDBShape==='function')_ensureDBShape();
    _bootRendererForTab(safe)();"""
new="""    if(typeof _ensureDBShape==='function')_ensureDBShape();
    _withRealLoadingSeed(_bootRendererForTab(safe));"""
if js.count(old)!=1: raise SystemExit('boot render call not found exactly once')
js=js.replace(old,new,1)

needle="console.info('[RETRADE] v1.4.19 Sales month-card loading loaded');"
if needle in js:
    js=js.replace(needle,needle+"\nconsole.info('[RETRADE] v1.4.20 populated real-layout loading shell loaded');",1)
else:
    needle="console.info('[RETRADE] v1.4.18 polished real-layout loading loaded');"
    if needle not in js: raise SystemExit('loading console marker missing')
    js=js.replace(needle,needle+"\nconsole.info('[RETRADE] v1.4.20 populated real-layout loading shell loaded');",1)

if './app.js?v=1.4.19' not in idx: raise SystemExit('expected app.js v1.4.19 ref missing')
idx=idx.replace('./app.js?v=1.4.19','./app.js?v=1.4.20',1)
# CSS behavior is unchanged from v1.4.19; bump it anyway to prevent mixed cached loader styling.
idx=re.sub(r'\./app\.css\?v=1\.4\.19','./app.css?v=1.4.20',idx,count=1)

JS.write_text(js,encoding='utf-8')
IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.20 populated real-layout loading shell')
