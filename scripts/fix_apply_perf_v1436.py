from pathlib import Path
p=Path('scripts/apply_perf_v1436.py')
s=p.read_text(encoding='utf-8')
old="""acct=rep(acct,'function calcMonthStatsBySale(m){','function calcMonthStatsBySale(m,ctx){',label='month stats context signature')
def patch_month_stats(chunk):
    if chunk.count('const events=getSaleEventsInMonth(m);')!=1:
        raise RuntimeError('month stats events anchor mismatch')
    chunk=chunk.replace('const events=getSaleEventsInMonth(m);',\"const events=(ctx&&ctx.eventsByMonth instanceof Map)?(ctx.eventsByMonth.get(m)||[]):getSaleEventsInMonth(m);\",1)
    old='const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);'
    if chunk.count(old)!=1: raise RuntimeError('month stats tier anchor mismatch')
    chunk=chunk.replace(old,\"const _allTrips=DB.trips||[],_tieredTrips=(ctx&&Array.isArray(ctx.tieredTrips))?ctx.tieredTrips:calcTieredTrips(_allTrips);\",1)
    return chunk
acct=replace_in_slice(acct,'function calcMonthStatsBySale(m,ctx){','function calcSummaryStats()',patch_month_stats,'month stats context body')
"""
new="""acct=rep(acct,'function calcMonthStatsBySale(m){','function calcMonthStatsBySale(m,ctx){',label='month stats context signature')
acct=rep(acct,
    'const events=getSaleEventsInMonth(m);',
    \"const events=(ctx&&ctx.eventsByMonth instanceof Map)?(ctx.eventsByMonth.get(m)||[]):getSaleEventsInMonth(m);\",
    count=1,label='month stats events context')
acct=rep(acct,
    'const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);',
    \"const _allTrips=DB.trips||[],_tieredTrips=(ctx&&Array.isArray(ctx.tieredTrips))?ctx.tieredTrips:calcTieredTrips(_allTrips);\",
    count=1,label='month stats tier context')
"""
if s.count(old)!=1:
    raise RuntimeError(f'expected one accounting patch block, found {s.count(old)}')
p.write_text(s.replace(old,new,1),encoding='utf-8')
