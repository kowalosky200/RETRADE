from pathlib import Path
import re

src = Path('app.js').read_text(encoding='utf-8', errors='replace').splitlines()

GROUPS = {
  'dates': [
    r'item_returns', r'returnHistory', r'_dateSoldAtReturn', r'loggedAt',
    r'refundDate', r'dateReturned', r'returnDate', r'resaleDateSold',
    r'dateRelist', r'relistDate', r'relistedAt', r'dateSold',
    r'_repairSaleNoSequenceForItem', r'_migrateSaleNoTags', r'loadFromSupabase'
  ],
  'returned_stock': [
    r'dispos', r'scrap', r'donat', r'job.?lot', r'isReturned',
    r"state\s*[:=]\s*['\"]returned", r'returned.*filter', r'filter.*returned',
    r'returnHistory'
  ]
}

def extract(patterns, max_hits=220, radius=7):
    rx = re.compile('|'.join('(?:%s)' % p for p in patterns), re.I)
    hits = [i for i,line in enumerate(src) if rx.search(line)]
    # merge small contextual windows
    windows=[]
    for i in hits[:max_hits]:
        a,b=max(0,i-radius),min(len(src),i+radius+1)
        if windows and a <= windows[-1][1] + 1:
            windows[-1]=(windows[-1][0],max(windows[-1][1],b))
        else:
            windows.append((a,b))
    out=[f'app.js lines: {len(src)}; total matches: {len(hits)}; emitted windows: {len(windows)}','']
    for n,(a,b) in enumerate(windows,1):
        out.append(f'## Window {n}: app.js {a+1}-{b}')
        for j in range(a,b): out.append(f'{j+1:06d}: {src[j]}')
        out.append('')
    return '\n'.join(out)

Path('stage2-lifecycle-dates.txt').write_text(extract(GROUPS['dates']), encoding='utf-8')
Path('stage2-returned-stock.txt').write_text(extract(GROUPS['returned_stock']), encoding='utf-8')
