from pathlib import Path
import re
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE sale-cycle platform storage audit','']
need=[
  r'function _saleCycleSnapshot',
  r'function _saleCycleNumbers',
  r'function _saleEventForCycle',
  r'function _currentResaleSaleNo',
  r'rcpt-s1-platform-select',
  r'rcpt-s2-platform-select',
  r'resalePlatform=',
  r'salePlatform=',
]
hits=[]
for i,line in enumerate(src):
    if any(re.search(p,line) for p in need): hits.append(i)
ranges=[]
for i in hits:
    a=max(0,i-24);b=min(len(src),i+55)
    if ranges and a<=ranges[-1][1]+8:ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:ranges.append((a,b))
for a,b in ranges:
    out.append(f'## app.js {a+1}-{b}')
    for n in range(a,b):out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-bulk-platform-audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('sale-cycle platform audit emitted',len(ranges))
