from pathlib import Path
import re
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE bulk selection / platform handler audit','']
# Find every line likely involved in multi-select, bulk actions, platform menus, and inline handlers.
rx=re.compile(r'(bulk|selected|selection|platform|apply.*platform|change.*platform|onclick=.*platform|multi.?select)',re.I)
hits=[i for i,line in enumerate(src) if rx.search(line)]
# Merge nearby neighborhoods so the report stays readable.
ranges=[]
for i in hits:
    a=max(0,i-18); b=min(len(src),i+26)
    if ranges and a<=ranges[-1][1]+8:
        ranges[-1]=(ranges[-1][0],max(ranges[-1][1],b))
    else:
        ranges.append((a,b))
for a,b in ranges:
    out.append(f'## app.js {a+1}-{b}')
    for n in range(a,b):
        out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-bulk-platform-audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('matched neighborhoods:',len(ranges))
