from pathlib import Path
p=Path('app.js')
js=p.read_text(encoding='utf-8')

for token in [
    "var VERSION='1.4.13-2026-09-02'",
    "v1.4.14 real-layout boot loading loaded",
    "Stable return-event persistence. item_returns are lifecycle events",
]:
    if token not in js:
        raise SystemExit('Expected production token missing: '+token)
if 'v1.4.15 stable return identity loaded' in js:
    raise SystemExit('v1.4.15 already applied')

patch=r'''

/* ========================================================================
 * RETRADE v1.4.15 — stable return identity hardening (2026-09-02)
 *
 * v1.4.9 correctly made item_returns append/update history instead of a
 * destructive array replacement. The serializer, however, does not include the
 * already-loaded DB row id. If a historical identifying field (saleNo, sold-date
 * snapshot, sale-price snapshot or return date) is corrected, v1.4.9's natural
 * key no longer matches and the corrected event can be inserted beside the old
 * one. That is how one lifecycle can acquire two full returns for Sale N.
 *
 * This layer keeps v1.4.9 authoritative and only restores identity before it
 * runs. Existing event ids are passed through; a full return missing its local
 * id may reuse the one existing full-return row for the same sale number; and a
 * genuinely new insert has its generated id hydrated back into live DB memory.
 * ======================================================================== */
(function(){
  'use strict';
  var VERSION='1.4.15-2026-09-02';
  if(typeof _replaceChildRowsSafe!=='function'){
    console.warn('[RETRADE] '+VERSION+' could not attach: child persistence unavailable');
    return;
  }
  var _baseReplace=_replaceChildRowsSafe;

  function _liveItem(id){
    try{
      var ks=allDBKeys();
      for(var a=0;a<ks.length;a++){
        var arr=DB[ks[a]]||[];
        for(var b=0;b<arr.length;b++)if(arr[b]&&String(arr[b].id)===String(id))return arr[b];
      }
    }catch(e){}
    return null;
  }
  function _d(v){return v?String(v).slice(0,10):'';}
  function _n(v){var x=Number(v);return Number.isFinite(x)?x.toFixed(2):'0.00';}
  function _dbKey(r){
    return [Number(r&&r.sale_no)||1,(r&&r.type)||'',_d(r&&r.logged_at),_d(r&&r.date_sold_at_return),_n(r&&r.sale_price_at_return),_n(r&&r.refund_amount)].join('|');
  }
  function _localKey(r){
    return [Number(r&&r.saleNo)||1,(r&&r.type)||'',_d(r&&r.loggedAt),_d(r&&r._dateSoldAtReturn),_n(r&&r._salePriceAtReturn),_n(r&&r.refundAmount)].join('|');
  }
  function _isFullType(t){return t==='full_seller'||t==='full_ebay';}

  _replaceChildRowsSafe=async function(table,itemId,rows,label){
    if(table!=='item_returns')return _baseReplace.apply(this,arguments);
    var uid=_currentUserId,live=_liveItem(itemId),history=live&&Array.isArray(live.returnHistory)?live.returnHistory:[];
    rows=Array.isArray(rows)?rows:[];

    // The serializer maps history in-order. Restore durable ids that were loaded
    // from Supabase but omitted from the snake_case row object.
    rows.forEach(function(row,idx){
      var ev=history[idx];
      if(row&&row.id==null&&ev&&ev.id!=null)row.id=ev.id;
    });

    // For events that still lack an id (normally a just-created return), consult
    // cloud once. A full return is unique per sale cycle by business definition:
    // if exactly one such row already exists for Sale N, this is that event being
    // corrected, not a second physical return. Partial refunds are not treated
    // this way because multiple partials for one sale are legitimate.
    var needLookup=rows.some(function(r){return r&&r.id==null;});
    var before=[];
    if(needLookup){
      var pre=await _sbCall(function(){return _sb.from('item_returns').select('*').eq('item_id',itemId).eq('user_id',uid);});
      if(pre&&pre.error)throw new Error('Load existing item_returns failed: '+pre.error.message);
      before=pre&&pre.data||[];
      rows.forEach(function(row,idx){
        if(!row||row.id!=null||!_isFullType(row.type))return;
        var n=Number(row.sale_no)||1;
        var candidates=before.filter(function(x){return _isFullType(x.type)&&(Number(x.sale_no)||1)===n;});
        if(candidates.length===1){
          row.id=candidates[0].id;
          if(history[idx]&&history[idx].id==null)history[idx].id=candidates[0].id;
        }
      });
    }

    var result=await _baseReplace.call(this,table,itemId,rows,label);

    // Hydrate generated ids for genuinely new events immediately. This removes
    // the old "stable only after reload" window. Match only when unambiguous;
    // otherwise leave it for the authoritative next cloud load rather than guess.
    if(history.length){
      var post=await _sbCall(function(){return _sb.from('item_returns').select('id,sale_no,type,logged_at,date_sold_at_return,sale_price_at_return,refund_amount').eq('item_id',itemId).eq('user_id',uid);});
      if(post&&post.error)throw new Error('Reload saved item_returns failed: '+post.error.message);
      var cloud=post&&post.data||[];
      history.forEach(function(ev){
        if(!ev||ev.id!=null)return;
        var key=_localKey(ev),matches=cloud.filter(function(r){return _dbKey(r)===key;});
        if(matches.length===1)ev.id=matches[0].id;
      });
    }
    return result;
  };

  window.RETRADE_V1415={
    version:VERSION,
    fullReturnDuplicates:function(){
      var out=[];
      try{allDBKeys().forEach(function(k){(DB[k]||[]).forEach(function(i){
        var seen={};(i.returnHistory||[]).forEach(function(r){if(!_isFullType(r&&r.type))return;var n=Number(r.saleNo)||1;seen[n]=(seen[n]||0)+1;});
        Object.keys(seen).forEach(function(n){if(seen[n]>1)out.push({itemId:i.id,gid:i.gid||null,item:i.item||'',saleNo:Number(n),count:seen[n]});});
      });});}catch(e){}
      return out;
    }
  };
  console.info('[RETRADE] v1.4.15 stable return identity loaded');
})();
'''

js=js.rstrip()+patch+'\n'
p.write_text(js,encoding='utf-8')

idx=Path('index.html')
s=idx.read_text(encoding='utf-8')
if './app.js?v=1.4.14' not in s:
    raise SystemExit('Expected app.js v1.4.14 asset ref missing')
s=s.replace('./app.js?v=1.4.14','./app.js?v=1.4.15',1)
idx.write_text(s,encoding='utf-8')
print('Applied v1.4.15 stable return identity hardening')
