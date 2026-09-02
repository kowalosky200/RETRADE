from pathlib import Path
import re

js = Path('app.js').read_text(encoding='utf-8', errors='replace').splitlines()
css = Path('app.css').read_text(encoding='utf-8', errors='replace').splitlines()
idx = Path('index.html').read_text(encoding='utf-8', errors='replace').splitlines()

out=[]
out.append('# RETRADE current loading implementation audit')
out.append('')
out.append(f'app.js lines: {len(js)}')
out.append('')

# Boot/init/loading implementation is concentrated here in the current live file.
out.append('## app.js boot/loading region')
for n in range(max(0,4550-1), min(len(js), 5150)):
    out.append(f'{n+1:06d}: {js[n]}')
out.append('')

# Dispatcher/render function declarations needed to map the real boot page safely.
out.append('## Renderer / dispatcher declarations')
rx=re.compile(r'^\s*(?:async\s+)?function\s+(render\w+|refreshActivePage|goToTab)\s*\(')
for n,line in enumerate(js):
    if rx.search(line): out.append(f'{n+1:06d}: {line}')
out.append('')

# Current CSS rules that participate in the duplicate skeleton system.
out.append('## app.css skeleton selector neighborhoods')
hits=[i for i,line in enumerate(css) if re.search(r'rt-skel|app-loading|rt-boot-shell',line,re.I)]
seen=[]
for i in hits:
    a,b=max(0,i-4),min(len(css),i+7)
    if seen and a<=seen[-1][1]: seen[-1]=(seen[-1][0],max(seen[-1][1],b))
    else: seen.append((a,b))
for a,b in seen:
    out.append(f'### app.css {a+1}-{b}')
    for n in range(a,b): out.append(f'{n+1:06d}: {css[n]}')
    out.append('')

out.append('## index asset references / boot shell')
for n,line in enumerate(idx):
    if re.search(r'app\.js|app\.css|rt-boot-shell|app-loading',line,re.I):
        out.append(f'{n+1:06d}: {line}')

Path('stage2-loading-audit.txt').write_text('\n'.join(out),encoding='utf-8')
