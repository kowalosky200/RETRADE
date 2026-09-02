from pathlib import Path

app = Path('app.js')
s = app.read_text(encoding='utf-8')
marker = 'RETRADE v1.4.13-2026-09-02 — stale-device boot recovery guard'

if marker not in s:
    patch = r'''

/* ========================================================================
 * RETRADE v1.4.13-2026-09-02 — stale-device boot recovery guard
 *
 * A device that has been asleep/logged-out must never make an older local
 * snapshot authoritative merely because it still has durable outbox work.
 *
 * Boot recovery policy:
 *   - exact base revision / unchanged remote base => safe automatic replay;
 *   - new local entity with no prior cloud base => safe automatic replay;
 *   - cloud advanced/deleted since the local base => QUARANTINE local intent,
 *     remove it from the live outbox, and keep cloud authoritative;
 *   - legacy queued work with no trustworthy base is never auto-applied over
 *     an existing cloud row.
 *
 * Quarantined entries remain in localStorage for manual recovery. Nothing is
 * silently deleted. Normal in-session CAS conflict handling remains unchanged.
 * ======================================================================== */
(function(){
  'use strict';
  var VERSION='1.4.13-2026-09-02';
  var QUARANTINE_BASE='retrade_stale_recovery_v1413';
  if(typeof _recoverOutbox!=='function'||typeof _outboxRead!=='function'||typeof _outboxSave!=='function')return;

  function clone(v){try{return JSON.parse(JSON.stringify(v));}catch(e){return v;}}
  function eq(a,b){try{return JSON.stringify(a)===JSON.stringify(b);}catch(e){return a===b;}}
  function itemCloud(id){
    try{
      var ks=allDBKeys();
      for(var a=0;a<ks.length;a++){
        var arr=DB[ks[a]]||[];
        for(var b=0;b<arr.length;b++)if(arr[b]&&String(arr[b].id)===String(id))return arr[b];
      }
    }catch(e){}
    return null;
  }
  function entity(type,id){
    var arr=null;
    try{
      if(type==='trip')arr=DB.trips||[];
      else if(type==='exp')arr=DB.expenses||[];
      else if(type==='cash')arr=DB.cashLedger||[];
      else if(type==='log')arr=DB.activityLog||[];
      else if(type==='run')arr=_sourcingRuns||[];
      else if(type==='acct')arr=_accounts||[];
      else if(type==='jlot')arr=_jobLots||[];
      else if(type==='jmem')arr=_jobLotItems||[];
      else if(type==='recon')arr=_saleReconciliations||[];
      if(arr)return arr.find(function(x){return x&&String(x.id)===String(id);})||null;
    }catch(e){}
    return null;
  }
  function rev(id){
    try{return window.RETRADE_V14_REVISION?Number(window.RETRADE_V14_REVISION.revisionFor(id))||0:0;}
    catch(e){return 0;}
  }
  function quarantine(entries,reason){
    try{
      if(!entries||!Object.keys(entries).length)return null;
      var key=QUARANTINE_BASE+'_'+(_currentUserId||'anon')+'_'+Date.now();
      localStorage.setItem(key,JSON.stringify({version:VERSION,reason:reason,createdAt:new Date().toISOString(),entries:entries}));
      return key;
    }catch(e){
      console.error('[RETRADE] stale recovery quarantine failed:',e&&e.message);
      return null;
    }
  }

  var baseRecover=_recoverOutbox;
  _recoverOutbox=function(){
    try{
      var ob=_outboxRead()||{},blocked={},changed=false;
      Object.keys(ob).forEach(function(k){
        var e=ob[k];
        if(!e)return;
        var local=null,id=e.id;
        if(e.op==='save'){
          try{local=JSON.parse(e.json);id=local&&local.id;}catch(_e){return;}
        }

        if(e.type==='item'){
          var remote=itemCloud(id),cloudRev=remote?rev(id):0,baseRev=Number(e.baseRevision)||0;
          if(e.op==='save'){
            if(!remote){
              if(baseRev>0){blocked[k]=clone(e);delete ob[k];changed=true;}
              return;
            }
            if(baseRev===cloudRev&&baseRev>0)return;
            blocked[k]=clone(e);delete ob[k];changed=true;return;
          }
          if(e.op==='delete'){
            if(!remote){delete ob[k];changed=true;return;}
            if(baseRev>0&&baseRev===cloudRev)return;
            blocked[k]=clone(e);delete ob[k];changed=true;return;
          }
          return;
        }

        var remoteEntity=entity(e.type,id);
        if(e.op==='save'){
          if(!remoteEntity){
            if(e.baseJson){blocked[k]=clone(e);delete ob[k];changed=true;}
            return;
          }
          if(e.baseJson){
            var base=null;
            try{base=JSON.parse(e.baseJson);}catch(_e2){base=null;}
            if(base&&eq(remoteEntity,base))return;
            blocked[k]=clone(e);delete ob[k];changed=true;return;
          }
          if(local&&eq(local,remoteEntity)){delete ob[k];changed=true;return;}
          blocked[k]=clone(e);delete ob[k];changed=true;return;
        }
        if(e.op==='delete'){
          if(!remoteEntity){delete ob[k];changed=true;return;}
          if(e.baseJson){
            var baseDel=null;
            try{baseDel=JSON.parse(e.baseJson);}catch(_e3){baseDel=null;}
            if(baseDel&&eq(remoteEntity,baseDel))return;
          }
          blocked[k]=clone(e);delete ob[k];changed=true;
        }
      });

      if(Object.keys(blocked).length){
        var q=quarantine(blocked,'Cloud changed since this device staged the queued work. Automatic stale-device replay was blocked; cloud kept authoritative.');
        console.warn('[RETRADE] blocked '+Object.keys(blocked).length+' stale boot write(s); cloud kept authoritative'+(q?' - '+q:''));
        try{toast('Older device changes were isolated - latest cloud data kept','');}catch(e){}
      }
      if(changed)_outboxSave(ob);
    }catch(e){
      console.error('[RETRADE] stale-device recovery safety check failed; automatic replay blocked:',e&&e.message);
      return 0;
    }
    return baseRecover.apply(this,arguments);
  };

  window.RETRADE_V1413={version:VERSION,quarantinePrefix:QUARANTINE_BASE};
  console.info('[RETRADE] '+VERSION+' stale-device boot recovery guard loaded');
})();
'''
    if not s.endswith('\n'):
        s += '\n'
    app.write_text(s + patch.lstrip('\n'), encoding='utf-8', newline='\n')

idx = Path('index.html')
h = idx.read_text(encoding='utf-8')
if './app.js?v=1.4.12' in h:
    idx.write_text(h.replace('./app.js?v=1.4.12','./app.js?v=1.4.13',1),encoding='utf-8',newline='\n')
elif './app.js?v=1.4.13' not in h:
    raise SystemExit('Expected app.js v1.4.12/v1.4.13 cache key not found')
