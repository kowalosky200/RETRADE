from pathlib import Path

JS=Path('app.js')
IDX=Path('index.html')
js=JS.read_text(encoding='utf-8')
idx=IDX.read_text(encoding='utf-8')

for token in [
    "var VERSION='1.4.13-2026-09-02'",
    'v1.4.14 real-layout boot loading loaded',
    'v1.4.15 stable return identity loaded',
    'v1.4.16 bulk platform editing loaded',
    'v1.4.17 terminal disposal durability loaded',
    'v1.4.18 polished real-layout loading loaded',
]:
    if token not in js:
        raise SystemExit('Expected production token missing: '+token)
if 'v1.4.19 Sales month-card loading loaded' in js:
    raise SystemExit('v1.4.19 already applied')

old=r'''  root.querySelectorAll('.fy-section span').forEach(function(el){
    if(/^[-+−]?£[\d,.]+$/.test((el.textContent||'').trim()))el.classList.add('rt-data-loading');
  });'''
new=r'''  // Sales/FY rows have several dynamic leaf values without semantic classes.
  // Mask only leaf text that represents loaded data; keep month/FY labels visible.
  root.querySelectorAll('.fy-section *').forEach(function(el){
    if(el.children&&el.children.length)return;
    const txt=(el.textContent||'').trim();
    if(/^[-+−]?£[\d,.]+$/.test(txt)||/^\d+\s+sold\b/i.test(txt))el.classList.add('rt-data-loading');
  });'''
if js.count(old)!=1:
    raise SystemExit('Expected v1.4.18 FY mask block exactly once; found '+str(js.count(old)))
js=js.replace(old,new,1)

marker="console.info('[RETRADE] v1.4.18 polished real-layout loading loaded');"
js=js.replace(marker,marker+"\nconsole.info('[RETRADE] v1.4.19 Sales month-card loading loaded');",1)

if './app.js?v=1.4.18' not in idx:
    raise SystemExit('Expected app.js v1.4.18 ref missing')
idx=idx.replace('./app.js?v=1.4.18','./app.js?v=1.4.19',1)

JS.write_text(js,encoding='utf-8')
IDX.write_text(idx,encoding='utf-8')
print('Applied v1.4.19 Sales month-card loading refinement')
