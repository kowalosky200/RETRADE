from pathlib import Path
import re
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE disposal save/flush timing audit','']
need=[
  r'function saveDB',
  r'saveDB\s*=\s*function',
  r'async function _persistChanges',
  r'function _persistChanges',
  r'_persistChanges\s*=\s*async',
  r'function confirmStockBulkDispose',
  r'function confirmScrap',
  r'function unScrap',
  r'realtime cross-device',
  r'_refreshCloudOnResume',
]
hits=[]
for i,line in enumerate(src):
    if any(re.search(p,line) for p in need): hits.append(i)
ranges=[]
for i in hits:
    a=max(0,i-30); b=min(len(src),i+75)
    if ranges and a<=ranges[-1][1]+8:
        ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:
        ranges.append((a,b))
for a,b in ranges:
    out.append(f'## app.js {a+1}-{b}')
    for n in range(a,b): out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-disposal-resurrection-audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('disposal save/flush timing audit emitted',len(ranges))
