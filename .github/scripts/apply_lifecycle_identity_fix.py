from pathlib import Path
import re

p=Path('app.js')
js=p.read_text(encoding='utf-8')

for token in [
    "var VERSION='1.4.13-2026-09-02'",
    "v1.4.14 real-layout boot loading loaded",
    "v1.4.15 stable return identity loaded",
    "async function bulkChangePlatform(platId, source){",
]:
    if token not in js:
        raise SystemExit('Expected production token missing: '+token)
if 'v1.4.16 bulk platform editing loaded' in js:
    raise SystemExit('v1.4.16 already applied')

old_month='''<select class="bulk-ctrl bulk-plat-sel" data-source="month" onchange="if(this.value){bulkChangePlatform(this.value,'month');this.value=''}"><option value="">Platform</option>${Object.values(PLATFORMS).filter(p=>p.live).map(p=>`<option value="${p.id}">${p.short}</option>`).join('')}</select>'''
new_month='''<select class="bulk-ctrl bulk-plat-sel" data-source="month"><option value="">Platform</option>${Object.values(PLATFORMS).filter(p=>p.live).map(p=>`<option value="${p.id}">${p.short}</option>`).join('')}</select>'''
old_stock='''<select class="bulk-ctrl bulk-plat-sel" data-source="stock" onchange="if(this.value){bulkChangePlatform(this.value,'stock');this.value=''}"><option value="">Platform</option>${Object.values(PLATFORMS).filter(p=>p.live).map(p=>`<option value="${p.id}">${p.short}</option>`).join('')}</select>'''
new_stock='''<select class="bulk-ctrl bulk-plat-sel" data-source="stock"><option value="">Platform</option>${Object.values(PLATFORMS).filter(p=>p.live).map(p=>`<option value="${p.id}">${p.short}</option>`).join('')}</select>'''

if js.count(old_month)!=1:
    raise SystemExit('Expected exactly one monthly inline platform handler, found '+str(js.count(old_month)))
if js.count(old_stock)!=1:
    raise SystemExit('Expected exactly one stock inline platform handler, found '+str(js.count(old_stock)))
js=js.replace(old_month,new_month,1).replace(old_stock,new_stock,1)

new_func=r'''async function bulkChangePlatform(platId, source){
  if(!platId||!PLATFORMS[platId])return;
  const label=PLATFORMS[platId].label;

  // Sales History edits the ACTUAL sale-cycle platform, matching the individual
  // receipt platform pickers. Selection is item-id based today, so if two rows
  // for the same item are visibly selected (e.g. Sale 1 + current resale), each
  // visible sale cycle is corrected once. Return-adjustment rows resolve back to
  // their parent sale cycle rather than carrying an independent platform.
  if(source==='month'){
    const ids=new Set([...SELECTED_ITEMS].map(function(id){return String(id);}));
    if(!ids.size)return;
    const events=(window.__monthItems||[]).filter(function(ev){
      return ev&&ev.item&&ids.has(String(ev.item.id));
    });
    if(!events.length){toast('No selected sale events to update','err');return;}

    const seen=new Set();
    let changed=0,historicalSkipped=0;
    events.forEach(function(ev){
      const item=ev.item;
      const saleNo=ev.isReturnAdjustment
        ?Math.max(1,Number(ev.returnEntry&&ev.returnEntry.saleNo)||1)
        :Math.max(1,Number(ev.sale)||1);
      const key=String(item.id)+'|'+saleNo;
      if(seen.has(key))return;
      seen.add(key);

      if(saleNo===1){
        item.salePlatform=platId;
        item.listingFee=_listingFeeFor(_s1Platform(item));
        changed++;
        return;
      }

      const liveSaleNo=item.resaleSalePrice
        ?(typeof _currentResaleSaleNo==='function'?_currentResaleSaleNo(item):2)
        :null;
      if(liveSaleNo===saleNo){
        item.resalePlatform=platId;
        item.resaleListingFee=_listingFeeFor(item.resalePlatform||_itemPlatform(item));
        changed++;
      }else{
        // Historical Sale 2/3/etc. cycles are reconstructed from immutable
        // return snapshots and are read-only in the individual receipt too.
        historicalSkipped++;
      }
    });

    if(changed)await saveDB();
    SELECTED_ITEMS.clear();
    SELECTION_MODE=false;
    renderMonth();
    let msg=changed+' sale cycle'+(changed===1?'':'s')+' → '+label;
    if(historicalSkipped)msg+=' · '+historicalSkipped+' frozen historical cycle'+(historicalSkipped===1?'':'s')+' unchanged';
    toast(msg,changed?'':'err');
    return;
  }

  // Inventory/Stock keeps its original meaning: change the platform the active
  // listing is currently offered on. Completed sales are never repriced here.
  const ids=[...STOCK_SELECTED];
  if(!ids.length)return;
  let count=0,skippedSold=0;
  ids.forEach(function(id){
    allDBKeys().forEach(function(k){
      const item=(DB[k]||[]).find(function(i){return i.id===id;});
      if(!item)return;
      if(item.dateSold||item.resaleSalePrice){skippedSold++;return;}
      item.defaultPlatform=platId;
      _stampListingFee(item);
      if(platId==='ebay_biz')item._postageMode='custom';
      else if(platId==='ebay')item._postageMode='simple';
      count++;
    });
  });
  if(count)await saveDB();
  STOCK_SELECTED.clear();
  STOCK_SELECTION_MODE=false;
  renderStock();
  toast(count+' item'+(count===1?'':'s')+' → '+label+(skippedSold?' · '+skippedSold+' sold item'+(skippedSold===1?'':'s')+' left unchanged':''),count?'':'err');
}

// v1.4.16 — event delegation replaces the generated inline onchange string.
// This removes the `(index):1 Invalid or unexpected token` failure mode and
// keeps one handler for both responsive Sales and Inventory toolbars.
document.addEventListener('change',function(e){
  const el=e.target;
  if(!el||!el.classList||!el.classList.contains('bulk-plat-sel'))return;
  const platId=el.value;
  const source=el.dataset.source||'stock';
  if(!platId)return;
  el.value='';
  Promise.resolve(bulkChangePlatform(platId,source)).catch(function(err){
    console.error('[RETRADE] bulk platform change failed:',err);
    toast('Platform change failed: '+(err&&err.message?err.message:String(err)),'err');
  });
});
console.info('[RETRADE] v1.4.16 bulk platform editing loaded');

function renderStockRow'''

pat=re.compile(r"async function bulkChangePlatform\(platId, source\)\{.*?\n\}\n\nfunction renderStockRow",re.S)
js2,n=pat.subn(new_func,js,count=1)
if n!=1:
    raise SystemExit('Could not replace bulkChangePlatform exactly once; matches='+str(n))
js=js2

p.write_text(js,encoding='utf-8')

idx=Path('index.html')
s=idx.read_text(encoding='utf-8')
if './app.js?v=1.4.15' not in s:
    raise SystemExit('Expected app.js v1.4.15 asset ref missing')
s=s.replace('./app.js?v=1.4.15','./app.js?v=1.4.16',1)
idx.write_text(s,encoding='utf-8')

print('Applied v1.4.16 bulk platform correction')
