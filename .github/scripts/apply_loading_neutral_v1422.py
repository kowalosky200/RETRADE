from pathlib import Path
import re
JS=Path('app.js'); CSS=Path('app.css'); IDX=Path('index.html')
js=JS.read_text(encoding='utf-8'); css=CSS.read_text(encoding='utf-8'); idx=IDX.read_text(encoding='utf-8')
for token in [
  "var VERSION='1.4.13-2026-09-02'",
  'v1.4.15 stable return identity loaded',
  'v1.4.16 bulk platform editing loaded',
  'v1.4.17 terminal disposal durability loaded',
  'v1.4.20 populated real-layout loading shell loaded',
  'v1.4.21 old-look real-layout skeleton loaded',
]:
  if token not in js: raise SystemExit('missing production guard: '+token)
if 'v1.4.22 neutral loading visuals loaded' in js: raise SystemExit('already applied')
needle="console.info('[RETRADE] v1.4.21 old-look real-layout skeleton loaded');"
if needle not in js: raise SystemExit('v1.4.21 marker missing')
js=js.replace(needle,needle+"\nconsole.info('[RETRADE] v1.4.22 neutral loading visuals loaded');",1)
css += r'''

/* v1.4.22 — remove the last seeded data colours from the loading presentation. */
.rt-real-layout-loading .age-bar-seg,
.rt-real-layout-loading .age-legend-dot,
.rt-real-layout-loading .legend-dot{
  background:var(--border)!important;
  border-color:var(--border)!important;
  opacity:.62!important;
}
.rt-real-layout-loading #p-summary .summary-hero-card svg{
  opacity:0!important;
}
.rt-real-layout-loading .rt-chart-loading > *{
  opacity:0!important;
}
'''
if './app.js?v=1.4.21' not in idx: raise SystemExit('app.js v1.4.21 ref missing')
idx=idx.replace('./app.js?v=1.4.21','./app.js?v=1.4.22',1)
idx,n=re.subn(r'\./app\.css\?v=1\.4\.21','./app.css?v=1.4.22',idx,count=1)
if n!=1: raise SystemExit('app.css v1.4.21 ref missing')
JS.write_text(js,encoding='utf-8'); CSS.write_text(css,encoding='utf-8'); IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.22 neutral loading visuals')
