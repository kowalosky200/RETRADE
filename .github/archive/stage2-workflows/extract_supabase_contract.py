from pathlib import Path
import re

text = Path('app.js').read_text(encoding='utf-8')
lines = text.splitlines()

tables = {}
rpcs = {}

for i, line in enumerate(lines, 1):
    for m in re.finditer(r"\.from\(\s*['\"]([^'\"]+)['\"]\s*\)", line):
        tables.setdefault(m.group(1), []).append(i)
    for m in re.finditer(r"\.rpc\(\s*['\"]([^'\"]+)['\"]", line):
        rpcs.setdefault(m.group(1), []).append(i)

out = []
out.append('# RETRADE Stage 2 — Supabase client contract\n')
out.append('Generated from current app.js. Line numbers are source locations.\n\n')
out.append('## Tables\n')
for name in sorted(tables):
    out.append(f'- {name}: {", ".join(map(str, tables[name]))}\n')
out.append('\n## RPC functions\n')
for name in sorted(rpcs):
    out.append(f'- {name}: {", ".join(map(str, rpcs[name]))}\n')

# Include compact source context around first occurrence of each table/RPC.
out.append('\n## First-use contexts\n')
entries = [('table', n, locs[0]) for n, locs in tables.items()] + [('rpc', n, locs[0]) for n, locs in rpcs.items()]
for kind, name, ln in sorted(entries, key=lambda x: x[2]):
    a = max(1, ln - 2); b = min(len(lines), ln + 3)
    out.append(f'\n### {kind}: {name} @ {ln}\n```js\n')
    for j in range(a, b + 1):
        out.append(f'{j:05d}: {lines[j-1]}\n')
    out.append('```\n')

Path('stage2-supabase-contract.md').write_text(''.join(out), encoding='utf-8')
print(f'Found {len(tables)} tables and {len(rpcs)} RPCs')
