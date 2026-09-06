from pathlib import Path
import re
p=Path('scripts/apply_perf_v1436.py')
s=p.read_text(encoding='utf-8')
pattern=r"acct=rep\(acct,'function calcMonthStatsBySale\(m\)\{','function calcMonthStatsBySale\(m,ctx\)\{',label='month stats context signature'\)\ndef patch_month_stats\(chunk\):.*?acct=replace_in_slice\(acct,'function calcMonthStatsBySale\(m,ctx\)\{','function calcSummaryStats\(\)',patch_month_stats,'month stats context body'\)\n"
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
s2,n=re.subn(pattern,new,s,count=1,flags=re.S)
if n!=1:
    # Fallback: surgically remove only the helper and replace_in_slice call,
    # leaving the already-correct signature replacement in place.
    start=s.find("def patch_month_stats(chunk):")
    end=s.find("acct=rep(acct,'function calcSummaryGrossDeltas",start)
    if start<0 or end<0:
        raise RuntimeError('could not locate accounting patch helper block')
    prefix=s[:start]
    suffix=s[end:]
    inject="""acct=rep(acct,
    'const events=getSaleEventsInMonth(m);',
    \"const events=(ctx&&ctx.eventsByMonth instanceof Map)?(ctx.eventsByMonth.get(m)||[]):getSaleEventsInMonth(m);\",
    count=1,label='month stats events context')
acct=rep(acct,
    'const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);',
    \"const _allTrips=DB.trips||[],_tieredTrips=(ctx&&Array.isArray(ctx.tieredTrips))?ctx.tieredTrips:calcTieredTrips(_allTrips);\",
    count=1,label='month stats tier context')

"""
    s2=prefix+inject+suffix
p.write_text(s2,encoding='utf-8')
