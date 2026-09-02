from pathlib import Path
import re

js=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE lifecycle persistence root-cause trace','',f'app.js lines: {len(js)}','']

ranges=[
 ('State migration',190,270),
 ('Supabase item load/to-row + return hydration',2700,2940),
 ('Child-row persistence',3160,3390),
 ('Dispose / restore stock',17340,17470),
 ('Return creation',21070,21240),
 ('Return undo / relist lifecycle',21420,21620),
 ('v1.4.9 return conflict persistence',25390,25790),
]
for title,a,b in ranges:
    out.append('## '+title)
    for n in range(max(0,a-1),min(len(js),b)):
        out.append(f'{n+1:06d}: {js[n]}')
    out.append('')

# Also show every declaration/call site for the child-row helper and return row id mapping.
rx=re.compile(r'_replaceChildRowsSafe|retRows|returnHistory|item_returns|returnDelete|_mergeReturnEvents|scrappedAt|state=.scrapped.|state:\s*.scrapped.',re.I)
out.append('## Key symbol index')
for n,line in enumerate(js):
    if rx.search(line): out.append(f'{n+1:06d}: {line}')

Path('stage2-lifecycle-rootcause.txt').write_text('\n'.join(out),encoding='utf-8')
