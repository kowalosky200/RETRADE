from pathlib import Path

p=Path('app.js')
js=p.read_text(encoding='utf-8')

for token in [
    "var VERSION='1.4.13-2026-09-02'",
    "v1.4.14 real-layout boot loading loaded",
    "v1.4.15 stable return identity loaded",
    "v1.4.16 bulk platform editing loaded",
    "async function confirmStockBulkDispose(){",
    "function confirmScrap(m,id){",
    "function unScrap(m,id){",
    "async function _persistChanges(){",
]:
    if token not in js:
        raise SystemExit('Expected production token missing: '+token)
if 'v1.4.17 terminal disposal durability loaded' in js:
    raise SystemExit('v1.4.17 already applied')

patch=r'''

/* ========================================================================
 * RETRADE v1.4.17 — terminal disposal durability (2026-09-02)
 *
 * saveDB() stages every mutation into the durable local outbox immediately but
 * intentionally waits 200ms before starting the Supabase writer. That debounce
 * is desirable for typing/batch edits, but a terminal inventory action should
 * not leave a cloud-acknowledgement window. Dispose / supplier-return / restore
 * now start the existing serialized CAS writer immediately after saveDB.
 *
 * No lifecycle or accounting fields are changed here. scrappedAt remains the
 * authoritative terminal overlay and returnHistory remains intact for audit.
 * ======================================================================== */
(function(){
  'use strict';
  var VERSION='1.4.17-2026-09-02';

  async function _flushTerminalMutation(){
    if(!_currentUserId||typeof _persistChanges!=='function')return;
    clearTimeout(_saveTimer);
    _saveTimer=null;
    await _persistChanges();
  }

  if(typeof confirmStockBulkDispose==='function'){
    var _baseConfirmStockBulkDispose=confirmStockBulkDispose;
    confirmStockBulkDispose=async function(){
      var result=await _baseConfirmStockBulkDispose.apply(this,arguments);
      await _flushTerminalMutation();
      return result;
    };
  }

  if(typeof confirmScrap==='function'){
    var _baseConfirmScrap=confirmScrap;
    confirmScrap=async function(){
      var result=_baseConfirmScrap.apply(this,arguments);
      await _flushTerminalMutation();
      return result;
    };
  }

  if(typeof unScrap==='function'){
    var _baseUnScrap=unScrap;
    unScrap=async function(){
      var result=_baseUnScrap.apply(this,arguments);
      await _flushTerminalMutation();
      return result;
    };
  }

  window.RETRADE_V1417={version:VERSION,flushTerminal:_flushTerminalMutation};
  console.info('[RETRADE] v1.4.17 terminal disposal durability loaded');
})();
'''

js=js.rstrip()+patch+'\n'
p.write_text(js,encoding='utf-8')

idx=Path('index.html')
s=idx.read_text(encoding='utf-8')
if './app.js?v=1.4.16' not in s:
    raise SystemExit('Expected app.js v1.4.16 asset ref missing')
s=s.replace('./app.js?v=1.4.16','./app.js?v=1.4.17',1)
idx.write_text(s,encoding='utf-8')
print('Applied v1.4.17 terminal disposal durability')
