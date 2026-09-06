from pathlib import Path
import re
p=Path('scripts/apply_perf_v1436.py')
s=p.read_text(encoding='utf-8')
pattern=r"acct=rep\(acct,'function calcMonthStatsBySale\(m\)\{','function calcMonthStatsBySale\(m,ctx\)\{',label='month stats context signature'\)\ndef patch_month_stats\(chunk\):.*?acct=replace_in_slice\(acct,'function calcMonthStatsBySale\(m,ctx\)\{','function calcSummaryStats\(\)',patch_month_stats,'month stats context body'\)\n"
new="""acct=rep(acct,'function calcMonthStatsBySale(m){','function calcMonthStatsBySale(m,ctx){',label='month stats context signature')
_m0=acct.index('function calcMonthStatsBySale(m,ctx){')
_m1=acct.find('\\nfunction ',_m0+1)
if _m1<0: raise RuntimeError('month stats function end not found')
_mchunk=acct[_m0:_m1]
if _mchunk.count('const events=getSaleEventsInMonth(m);')!=1:
    raise RuntimeError('month stats events anchor mismatch')
_mchunk=_mchunk.replace(
    'const events=getSaleEventsInMonth(m);',
    \"const events=(ctx&&ctx.eventsByMonth instanceof Map)?(ctx.eventsByMonth.get(m)||[]):getSaleEventsInMonth(m);\",1)
_tier='const _allTrips=DB.trips||[],_tieredTrips=calcTieredTrips(_allTrips);'
if _mchunk.count(_tier)!=1:
    raise RuntimeError('month stats tier anchor mismatch inside function')
_mchunk=_mchunk.replace(
    _tier,
    \"const _allTrips=DB.trips||[],_tieredTrips=(ctx&&Array.isArray(ctx.tieredTrips))?ctx.tieredTrips:calcTieredTrips(_allTrips);\",1)
acct=acct[:_m0]+_mchunk+acct[_m1:]
"""
s2,n=re.subn(pattern,new,s,count=1,flags=re.S)
if n!=1:
    start=s.find("acct=rep(acct,'function calcMonthStatsBySale(m){'")
    end=s.find("acct=rep(acct,'function calcSummaryGrossDeltas",start)
    if start<0 or end<0:
        raise RuntimeError('could not locate accounting patch section')
    s2=s[:start]+new+'\n'+s[end:]
p.write_text(s2,encoding='utf-8')
