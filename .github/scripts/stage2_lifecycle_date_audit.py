from pathlib import Path
import re
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE disposal resurrection audit','']
need=[
  r'function _migrateItemStates',
  r'function renderStock',
  r'function _stock',
  r'openStockBulkDispose',
  r'confirmStockBulkDispose',
  r'scrappedAt',
  r'scrapped_at',
  r'scrapReason',
  r'isReturned',
  r"state==='returned'",
  r"state === 'returned'",
  r"state==='scrapped'",
  r'returned_supplier',
  r'function _scrappedItems',
]
hits=[]
for i,line in enumerate(src):
    if any(re.search(p,line) for p in need): hits.append(i)
ranges=[]
for i in hits:
    a=max(0,i-20); b=min(len(src),i+45)
    if ranges and a<=ranges[-1][1]+10:
        ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:
        ranges.append((a,b))
for a,b in ranges:
    out.append(f'## app.js {a+1}-{b}')
    for n in range(a,b): out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-disposal-resurrection-audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('disposal resurrection audit emitted',len(ranges))
