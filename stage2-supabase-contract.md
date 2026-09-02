# RETRADE Stage 2 — Supabase client contract
Generated from current app.js. Line numbers are source locations.

## Tables
- accounts: 2981, 3643
- activity_log: 2983, 3459
- cash_ledger: 2982, 3436, 23965
- expenses: 2979, 3415
- item_parts: 2976, 24745
- item_returns: 2977, 24747
- items: 2975, 3370, 23946, 24151, 24208, 24472, 24488, 24593, 24741
- job_lot_items: 2985, 3496
- job_lots: 2984, 3486
- retrade_meta: 2936
- retrade_sync_clock: 4552, 25150
- sale_reconciliations: 2986, 3516
- sourcing_runs: 2980, 3577
- trips: 2978, 3403
- user_settings: 752, 755, 769, 25324, 25338, 25347, 25352, 25359

## RPC functions
- retrade_delete_my_account_record: 23933

## First-use contexts

### table: user_settings @ 752
```js
00750:       };
00751:       const uid=row.user_id;
00752:       const upd=await _sb.from('user_settings').update(row).eq('user_id',uid).select('user_id');
00753:       if(upd.error)throw upd.error;
00754:       if(!upd.data||upd.data.length===0){
00755:         const ins=await _sb.from('user_settings').insert(row);
```

### table: retrade_meta @ 2936
```js
02934: async function _verifySchemaVersion(){
02935:   if(ALLOW_SCHEMA_FALLBACK)return true;
02936:   const res=await _sbCall(()=>_sb.from('retrade_meta').select('value').eq('key','schema_version').single());
02937:   if(res.error)throw new Error('Database migration check failed. Run the current RETRADE Supabase migration before using this build. '+res.error.message);
02938:   if(!res.data||res.data.value!==RETRADE_SCHEMA_VERSION){
02939:     throw new Error('Database schema version mismatch. App expects '+RETRADE_SCHEMA_VERSION+' but Supabase reports '+((res.data&&res.data.value)||'none')+'.');
```

### table: items @ 2975
```js
02973:   // misconfigured policies from bleeding into the loaded DB.
02974:   const [itemsRes, partsRes, returnsRes, tripsRes, expensesRes, runsRes, accountsRes, cashRes, activityRes, jobLotsRes, jobLotItemsRes, reconcileRes] = await Promise.all([
02975:     _sb.from('items').select('*').eq('user_id', uid).order('date_listed', {ascending: true}),
02976:     _sb.from('item_parts').select('*').eq('user_id', uid),
02977:     _sb.from('item_returns').select('*').eq('user_id', uid).order('logged_at', {ascending: true}),
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
```

### table: item_parts @ 2976
```js
02974:   const [itemsRes, partsRes, returnsRes, tripsRes, expensesRes, runsRes, accountsRes, cashRes, activityRes, jobLotsRes, jobLotItemsRes, reconcileRes] = await Promise.all([
02975:     _sb.from('items').select('*').eq('user_id', uid).order('date_listed', {ascending: true}),
02976:     _sb.from('item_parts').select('*').eq('user_id', uid),
02977:     _sb.from('item_returns').select('*').eq('user_id', uid).order('logged_at', {ascending: true}),
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
```

### table: item_returns @ 2977
```js
02975:     _sb.from('items').select('*').eq('user_id', uid).order('date_listed', {ascending: true}),
02976:     _sb.from('item_parts').select('*').eq('user_id', uid),
02977:     _sb.from('item_returns').select('*').eq('user_id', uid).order('logged_at', {ascending: true}),
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
```

### table: trips @ 2978
```js
02976:     _sb.from('item_parts').select('*').eq('user_id', uid),
02977:     _sb.from('item_returns').select('*').eq('user_id', uid).order('logged_at', {ascending: true}),
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
```

### table: expenses @ 2979
```js
02977:     _sb.from('item_returns').select('*').eq('user_id', uid).order('logged_at', {ascending: true}),
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
```

### table: sourcing_runs @ 2980
```js
02978:     _sb.from('trips').select('*').eq('user_id', uid).order('date', {ascending: true}),
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
```

### table: accounts @ 2981
```js
02979:     _sb.from('expenses').select('*').eq('user_id', uid).order('date', {ascending: true}),
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
```

### table: cash_ledger @ 2982
```js
02980:     _sb.from('sourcing_runs').select('*').eq('user_id', uid).order('date_started', {ascending: false}),
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02985:     _sb.from('job_lot_items').select('*').eq('user_id', uid).order('added_at', {ascending: true}),
```

### table: activity_log @ 2983
```js
02981:     _sb.from('accounts').select('*').eq('user_id', uid).order('name', {ascending: true}),
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02985:     _sb.from('job_lot_items').select('*').eq('user_id', uid).order('added_at', {ascending: true}),
02986:     _sb.from('sale_reconciliations').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
```

### table: job_lots @ 2984
```js
02982:     _sb.from('cash_ledger').select('*').eq('user_id', uid).order('date', {ascending: true}),
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02985:     _sb.from('job_lot_items').select('*').eq('user_id', uid).order('added_at', {ascending: true}),
02986:     _sb.from('sale_reconciliations').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02987:   ]);
```

### table: job_lot_items @ 2985
```js
02983:     _sb.from('activity_log').select('*').eq('user_id', uid).order('ts', {ascending: true}),
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02985:     _sb.from('job_lot_items').select('*').eq('user_id', uid).order('added_at', {ascending: true}),
02986:     _sb.from('sale_reconciliations').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02987:   ]);
02988: 
```

### table: sale_reconciliations @ 2986
```js
02984:     _sb.from('job_lots').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02985:     _sb.from('job_lot_items').select('*').eq('user_id', uid).order('added_at', {ascending: true}),
02986:     _sb.from('sale_reconciliations').select('*').eq('user_id', uid).order('created_at', {ascending: true}),
02987:   ]);
02988: 
02989:   // Core financial data must load as a complete set. Showing an apparently
```

### table: retrade_sync_clock @ 4552
```js
04550:   try{
04551:     const uid=_currentUserId;
04552:     const res=await _sbCall(()=>_sb.from('retrade_sync_clock').select('revision,updated_at').eq('user_id',uid).maybeSingle());
04553:     if(res&&res.error){
04554:       const msg=String(res.error.message||res.error);
04555:       if(/retrade_sync_clock|does not exist|schema cache|PGRST205|42P01/i.test(msg))_syncClockAvailable=false;
```

### rpc: retrade_delete_my_account_record @ 23933
```js
23931: 
23932:         var res=await _sbCall(function(){
23933:           return _sb.rpc('retrade_delete_my_account_record',{p_account_id:accountId});
23934:         });
23935:         if(res&&res.error)throw new Error(res.error.message||'Partner delete failed.');
23936:         if(res&&Object.prototype.hasOwnProperty.call(res,'data')&&res.data!==true){
```
