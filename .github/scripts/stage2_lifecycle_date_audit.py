from pathlib import Path
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE focused bulk platform audit','']
for title,a,b in [
  ('Monthly selection toolbar',14380,14435),
  ('Bulk platform handler',16090,16175),
  ('Stock selection toolbar',16715,16755),
]:
    out.append('## '+title)
    for n in range(max(0,a-1),min(len(src),b)):
        out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-bulk-platform-audit.txt').write_text('\n'.join(out),encoding='utf-8')
print('focused bulk platform audit emitted')
