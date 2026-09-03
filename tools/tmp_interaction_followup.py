from pathlib import Path
import re

p=Path('app.js')
s=p.read_text(encoding='utf-8')

m=re.search(r'function goToTab\(name,sourceEl\)\{.*?\n\}\n(?=\n(?:function|const|let|var) )',s,re.S)
if not m: raise SystemExit('goToTab not found')
b=m.group(0)
anchor="  if(typeof window._resetNavScrollState==='function')window._resetNavScrollState();\n"
if b.count(anchor)!=1: raise SystemExit('nav reset anchor mismatch')
insert=anchor+"  const _renderTab=function(fn){\n    _queueInteractionRender(function(){\n      fn();\n      _restoreTabScroll(name);\n    });\n  };\n"
b=b.replace(anchor,insert,1)
# Only the tab switch render calls should use _renderTab so scroll restoration
# remains after the destination DOM exists.
n=b.count('_queueInteractionRender(render')
if n<8: raise SystemExit(f'expected >=8 queued tab renders, got {n}')
b=b.replace('_queueInteractionRender(render','_renderTab(render')
if b.count('  _restoreTabScroll(name);')!=1:
    # one occurrence should be inside the helper, plus old terminal one if still present
    pass
old_terminal="  _restoreTabScroll(name);\n  // Patch A — FAB visibility per page"
if b.count(old_terminal)!=1: raise SystemExit('terminal restore anchor mismatch')
b=b.replace(old_terminal,"  // Patch A — FAB visibility per page",1)
s=s[:m.start()]+b+s[m.end():]

old="function toggleStockGrouped(){STOCK_GROUPED=!STOCK_GROUPED;renderStock();_saveUIState();}"
new="function toggleStockGrouped(){STOCK_GROUPED=!STOCK_GROUPED;_saveUIState();_queueInteractionRender(renderStock);}"
if s.count(old)!=1: raise SystemExit('toggleStockGrouped mismatch')
s=s.replace(old,new,1)

old="  if(MONTHLY_VIEW==='grid')_queueInteractionRender(renderMonthlyGrid);\n  else renderMonthlyProfitabilityChart();"
new="  if(MONTHLY_VIEW==='grid')_queueInteractionRender(renderMonthlyGrid);\n  else _queueInteractionRender(renderMonthlyProfitabilityChart);"
if s.count(old)!=1: raise SystemExit('setMonthlyPeriod detail branch mismatch')
s=s.replace(old,new,1)

# Contracts
if '_renderTab(renderSummary);' not in s: raise SystemExit('summary tab not wrapped')
if '_renderTab(renderMonthlyPage);' not in s: raise SystemExit('monthly tab not wrapped')
if '_renderTab(renderCash);' not in s: raise SystemExit('cash tab not wrapped')
if 'fn();\n      _restoreTabScroll(name);' not in s: raise SystemExit('post-render scroll restore missing')
if 'toggleStockGrouped(){STOCK_GROUPED=!STOCK_GROUPED;_saveUIState();_queueInteractionRender(renderStock);}' not in s: raise SystemExit('stock grouped defer missing')
if "else _queueInteractionRender(renderMonthlyProfitabilityChart);" not in s: raise SystemExit('monthly detail defer missing')

p.write_text(s,encoding='utf-8')
print('interaction ordering repair applied')
