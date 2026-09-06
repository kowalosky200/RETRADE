from pathlib import Path
p=Path('app.js')
s=p.read_text(encoding='utf-8')
a=s.index('function renderSummary(){')
b=s.index('function renderMonthlyPage(){',a)
chunk=s[a:b]
old='''      if(isDaily){
        while(cur<=range.to){buckets.push({from:cur,to:cur,label:fmtShort(cur)});cur=addDays(cur,1);}
      } else {
        const _summarySpanDays=Math.max(1,Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1);
        let bucketDays=_summarySpanDays<=65?7:(_summarySpanDays<=100?14:30);'''
new='''      const _summarySpanDays=Math.max(1,Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1);
      if(_summarySpanDays<=10){
        while(cur<=range.to){buckets.push({from:cur,to:cur,label:fmtShort(cur)});cur=addDays(cur,1);}
      } else {
        let bucketDays=_summarySpanDays<=65?7:(_summarySpanDays<=100?14:30);'''
if chunk.count(old)!=1:
    raise SystemExit(f'expected Dashboard bucket block once, found {chunk.count(old)}')
chunk=chunk.replace(old,new,1)
s=s[:a]+chunk+s[b:]
p.write_text(s,encoding='utf-8')
print('Dashboard range bucketing fixed')
