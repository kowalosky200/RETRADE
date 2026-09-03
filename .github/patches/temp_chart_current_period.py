from pathlib import Path

path = Path('index.html')
text = path.read_text(encoding='utf-8')

needle = '''@media(max-width:760px){#sync-indicator.sync-float,#sync-indicator{left:14px!important;bottom:calc(76px + env(safe-area-inset-bottom))!important;}}
</style>
</head>'''

block = '''@media(max-width:760px){#sync-indicator.sync-float,#sync-indicator{left:14px!important;bottom:calc(76px + env(safe-area-inset-bottom))!important;}}
</style>

<style id="rt-chart-current-period-motion">
/* v1.4.28 — current/incomplete period is a deliberate final chart beat. */
@keyframes rtChartCurrentTailIn{
  0%{visibility:hidden;clip-path:inset(0 100% 0 0);stroke-dashoffset:10;}
  1%{visibility:visible;clip-path:inset(0 100% 0 0);stroke-dashoffset:10;}
  72%{visibility:visible;clip-path:inset(0 0 0 0);stroke-dashoffset:-2;}
  100%{visibility:visible;clip-path:inset(0 0 0 0);stroke-dashoffset:0;}
}
@keyframes rtChartCurrentLabelIn{
  0%{opacity:0;transform:translateY(3px);}
  68%{opacity:1;transform:translateY(-1px);}
  100%{opacity:.85;transform:translateY(0);}
}
/* Keep the live tail and its label out of sight during skeleton/reveal. */
#p-summary svg.rt-motion-hold .rt-chart-partial,
#p-summary svg.rt-motion-hold:has(.rt-chart-partial)>text:last-of-type{
  visibility:hidden!important;opacity:0!important;animation:none!important;
}
/* History line + donut finish at --dur-draw; the current-period tail then
   arrives left-to-right with a small dash settle to distinguish live data. */
#p-summary svg.rt-chart-draw .rt-chart-partial{
  visibility:hidden;
  transform-box:fill-box;
  animation:rtChartCurrentTailIn 220ms var(--ease-out) var(--dur-draw) both;
}
/* “so far” follows 55ms into the tail beat rather than appearing ahead of it. */
#p-summary svg.rt-chart-draw:has(.rt-chart-partial)>text:last-of-type{
  opacity:0;transform-box:fill-box;transform-origin:center;
  animation:rtChartCurrentLabelIn 180ms var(--ease-out) calc(var(--dur-draw) + 55ms) both;
}
@media(prefers-reduced-motion:reduce){
  #p-summary svg.rt-chart-draw .rt-chart-partial,
  #p-summary svg.rt-chart-draw:has(.rt-chart-partial)>text:last-of-type{
    animation-delay:0ms!important;
  }
}
</style>
</head>'''

if text.count(needle) != 1:
    raise SystemExit(f'Expected one chart-motion insertion anchor, found {text.count(needle)}')
if 'id="rt-chart-current-period-motion"' in text:
    raise SystemExit('Chart current-period motion block already exists')

updated = text.replace(needle, block, 1)
path.write_text(updated, encoding='utf-8')

check = path.read_text(encoding='utf-8')
assert check.count('id="rt-chart-current-period-motion"') == 1
assert 'animation:rtChartCurrentTailIn 220ms var(--ease-out) var(--dur-draw) both;' in check
assert 'calc(var(--dur-draw) + 55ms)' in check
# Guard the SVG paths that the whole-file API edit previously mutated.
assert check.count('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4') >= 2
print('Chart current-period motion patch applied cleanly')
