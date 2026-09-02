from pathlib import Path
import re

src = Path('app.js').read_text(encoding='utf-8', errors='replace').splitlines()
patterns = [
    r'item_returns', r'returnHistory', r'resaleDateSold', r'dateSold',
    r'_dateSoldAtReturn', r'loggedAt', r'refundDate', r'dateRelist',
    r'relist', r'_itemReturn', r'ItemReturn', r'return.*ToRow',
    r'row.*return', r'loadFromSupabase', r'_migrateSaleNoTags',
    r'_repairSaleNoSequenceForItem', r'new Date\('
]
rx = re.compile('|'.join('(?:%s)' % p for p in patterns), re.I)

# Capture merged windows around all lifecycle/date-related hits.
hits = [i for i, line in enumerate(src) if rx.search(line)]
windows = []
for i in hits:
    a, b = max(0, i-18), min(len(src), i+19)
    if windows and a <= windows[-1][1] + 4:
        windows[-1] = (windows[-1][0], max(windows[-1][1], b))
    else:
        windows.append((a,b))

# Keep the report bounded while retaining the most relevant lifecycle regions.
# Prioritise windows containing normalized-return/save/load identifiers.
def score(w):
    text='\n'.join(src[w[0]:w[1]]).lower()
    keys=['item_returns','returnhistory','resaledatesold','_datesoldatreturn','loadfromsupabase','loggedat','refunddate','relist']
    return sum(text.count(k) for k in keys)
windows = sorted(windows, key=lambda w:(-score(w), w[0]))[:40]
windows = sorted(windows)

out=[]
out.append('# RETRADE lifecycle date audit extraction')
out.append('')
out.append(f'app.js lines: {len(src)}; matched lines: {len(hits)}; windows: {len(windows)}')
out.append('')
for n,(a,b) in enumerate(windows,1):
    out.append(f'## Window {n}: lines {a+1}-{b}')
    for j in range(a,b):
        out.append(f'{j+1:06d}: {src[j]}')
    out.append('')
Path('stage2-lifecycle-date-audit.txt').write_text('\n'.join(out), encoding='utf-8')
