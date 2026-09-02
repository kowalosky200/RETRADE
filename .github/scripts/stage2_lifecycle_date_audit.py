from pathlib import Path
src=Path('app.js').read_text(encoding='utf-8',errors='replace').splitlines()
out=['# RETRADE return persistence focus','']
for title,a,b in [
 ('Core child persistence',3245,3380),
 ('v1.4.9 merge + stable return persistence',25230,25540),
 ('Dispose and restore',17290,17460),
 ('Return save + relist + undo',20980,21620),
]:
    out.append('## '+title)
    for n in range(max(0,a-1),min(len(src),b)):
        out.append(f'{n+1:06d}: {src[n]}')
    out.append('')
Path('stage2-lifecycle-focus2.txt').write_text('\n'.join(out),encoding='utf-8')
