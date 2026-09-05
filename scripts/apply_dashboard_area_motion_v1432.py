from pathlib import Path
import sys

APP = Path('app.js')
CSS = Path('app.css')
INDEX = Path('index.html')

app = APP.read_text(encoding='utf-8')
css = CSS.read_text(encoding='utf-8')
index = INDEX.read_text(encoding='utf-8')

MARKER = '/* v1.4.32 — revenue area + sequenced partial-period motion */'
if MARKER in css:
    print('v1.4.32 already applied')
    sys.exit(0)

def rep(text, old, new, expected=1, label='replacement'):
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{label}: expected {expected}, found {count}')
    return text.replace(old, new)

# 1) Generic chart presentation controls: caller-specific area strength and a
#    current-period profit endpoint when persistent dots are otherwise hidden.
app = rep(
    app,
    "  const fillColor=opts.fillColor||secondaryColor;\n",
    "  const fillColor=opts.fillColor||secondaryColor;\n"
    "  const fillOpacity=opts.fillOpacity!=null?Math.max(0,Math.min(1,Number(opts.fillOpacity)||0)):0.5;\n"
    "  const fillEndOpacity=opts.fillEndOpacity!=null?Math.max(0,Math.min(1,Number(opts.fillEndOpacity)||0)):0;\n"
    "  const showLastProfitDot=opts.showLastProfitDot===true;\n",
    label='chart area options'
)

# 2) A partial period must not pre-fill the unfinished segment. The area ends
#    at the final completed observation and the dashed continuation owns the
#    unfinished portion visually.
old_area = '''  // Area path (filled, anchored to y=0). Defaults to the secondary series;
  // opts.fillData lets a caller shade a different series (v2.12.1 — the
  // monthly chart shades Net Profit, its bottom line, in gold).
  const fillData=Array.isArray(opts.fillData)?opts.fillData:profitData;
  let area='M '+sx(0).toFixed(1)+' '+sy(0).toFixed(1);
  for(let i=0;i<n;i++)area+=' L '+sx(i).toFixed(1)+' '+sy(fillData[i]||0).toFixed(1);
  area+=' L '+sx(n-1).toFixed(1)+' '+sy(0).toFixed(1)+' Z';

  // v2.21.13 — "so far today" marking. When the caller flags the final point as
  // an incomplete current period, solid lines stop at the last COMPLETE point and
  // a separate DASHED segment carries to today, so an in-progress day reads as
  // provisional rather than a real dip. Non-partial charts are unchanged (solid
  // runs full width, dash strings are empty).
  const _partial=opts.partialLast===true && n>1;
'''
new_area = '''  // Area path (filled, anchored to y=0). Defaults to the secondary series;
  // callers can shade a different series with opts.fillData. For an incomplete
  // final period, the fill stops at the last COMPLETE point so the provisional
  // continuation is represented only by the sequenced dashed segment.
  const _partial=opts.partialLast===true && n>1;
  const fillData=Array.isArray(opts.fillData)?opts.fillData:profitData;
  const _areaTo=_partial?n-1:n;
  let area='M '+sx(0).toFixed(1)+' '+sy(0).toFixed(1);
  for(let i=0;i<_areaTo;i++)area+=' L '+sx(i).toFixed(1)+' '+sy(fillData[i]||0).toFixed(1);
  area+=' L '+sx(_areaTo-1).toFixed(1)+' '+sy(0).toFixed(1)+' Z';

  // Incomplete current period: solid history stops at the final complete point.
  // The continuation is rendered as individual dash marks so motion can slow
  // down and reveal dash-by-dash after the historical line reaches the present.
'''
app = rep(app, old_area, new_area, label='partial area geometry')

old_partial = '''  const _solidTo=_partial?n-1:n; // solid covers indices 0.._solidTo-1
  const _mkLine=function(data,from,to){let d='';for(let i=from;i<to;i++)d+=(i===from?'M ':' L ')+sx(i).toFixed(1)+' '+sy(data[i]||0).toFixed(1);return d;};
  const _mkDash=function(data){return _partial?_mkLine(data,n-2,n):'';};

  // Profit line (soft green stroke above the area fill, below revenue line)
  const profitLine=_mkLine(profitData,0,_solidTo); const profitDash=_mkDash(profitData);

  // Tertiary line (e.g. Net Profit) — drawn above the area, below revenue.
  let tertLine='', tertDash='';
  if(tertiaryData){ tertLine=_mkLine(tertiaryData,0,_solidTo); tertDash=_mkDash(tertiaryData); }

  // Revenue line (primary visual)
  const line=_mkLine(revData,0,_solidTo); const revDash=_mkDash(revData);
  const _soFar=_partial?('<text x="'+sx(n-1).toFixed(1)+'" y="'+(pad.t+fontSize+1).toFixed(1)+'" font-size="'+Math.round(fontSize*0.92)+'" fill="var(--text-tertiary)" text-anchor="end" font-family="var(--font-body)" opacity="0.85">so far</text>'):'';
'''
new_partial = '''  const _solidTo=_partial?n-1:n; // solid covers indices 0.._solidTo-1
  const _mkLine=function(data,from,to){let d='';for(let i=from;i<to;i++)d+=(i===from?'M ':' L ')+sx(i).toFixed(1)+' '+sy(data[i]||0).toFixed(1);return d;};
  const _mkDashMarks=function(data,color,strokeWidth,opacity){
    if(!_partial)return '';
    const x1=sx(n-2),y1=sy(data[n-2]||0),x2=sx(n-1),y2=sy(data[n-1]||0);
    const dx=x2-x1,dy=y2-y1,dist=Math.sqrt(dx*dx+dy*dy);
    if(!isFinite(dist)||dist<=0.01)return '';
    const dashLen=4.2,gap=3.2,step=dashLen+gap;
    let out='<g class="rt-chart-partial-group" opacity="'+opacity+'">',di=0;
    for(let pos=0;pos<dist;pos+=step,di++){
      const end=Math.min(pos+dashLen,dist);
      const a=pos/dist,b=end/dist;
      const ax=x1+dx*a,ay=y1+dy*a,bx=x1+dx*b,by=y1+dy*b;
      out+='<line class="rt-chart-partial-dash" style="--dash-delay:'+(di*22)+'ms" x1="'+ax.toFixed(1)+'" y1="'+ay.toFixed(1)+'" x2="'+bx.toFixed(1)+'" y2="'+by.toFixed(1)+'" stroke="'+color+'" stroke-width="'+strokeWidth+'" stroke-linecap="round"/>';
    }
    return out+'</g>';
  };

  // Profit line (green trend above the area)
  const profitLine=_mkLine(profitData,0,_solidTo);
  const profitPartial=_mkDashMarks(profitData,secondaryColor,profitStroke,0.62);

  // Tertiary quantitative line when one is actually requested.
  let tertLine='',tertPartial='';
  if(tertiaryData){
    tertLine=_mkLine(tertiaryData,0,_solidTo);
    tertPartial=_mkDashMarks(tertiaryData,tertiaryColor,tertiaryStroke,0.58);
  }

  // Revenue line (primary visual)
  const line=_mkLine(revData,0,_solidTo);
  const revPartial=_mkDashMarks(revData,primaryColor,revStroke,0.68);
  const _soFar=_partial?('<text class="rt-chart-so-far" x="'+sx(n-1).toFixed(1)+'" y="'+(pad.t+fontSize+1).toFixed(1)+'" font-size="'+Math.round(fontSize*0.92)+'" fill="var(--text-tertiary)" text-anchor="end" font-family="var(--font-body)" opacity="0.85">so far</text>'):'';
'''
app = rep(app, old_partial, new_partial, label='partial dash markup')

# 3) Refund marks are semantic event ticks. Count belongs in the tooltip, never
#    in marker width, so every refund has identical visual weight.
app = rep(app, "      const w=count>1?8:6;\n", "      const w=7;\n", label='uniform refund tick')

# 4) Current-period endpoint circles share the delayed finish of the partial
#    continuation. Dashboard can suppress all historic point clutter while
#    retaining both provisional endpoints.
app = rep(
    app,
    "      +(hasP&&showDots?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(p).toFixed(1)+'\" r=\"'+profitDotR+'\" fill=\"'+_df(secondaryColor)+'\" stroke=\"'+_ds(secondaryColor)+'\" stroke-width=\"1.2\"/>':'')\n"
    "      +((hasR&&!primaryBars&&(showDots||_isLast))?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    "      +(hasP&&(showDots||(_isLast&&showLastProfitDot))?'<circle class=\"'+(_isLast?'rt-chart-partial-dot':'')+'\" cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(p).toFixed(1)+'\" r=\"'+profitDotR+'\" fill=\"'+_df(secondaryColor)+'\" stroke=\"'+_ds(secondaryColor)+'\" stroke-width=\"1.2\"/>':'')\n"
    "      +((hasR&&!primaryBars&&(showDots||_isLast))?'<circle class=\"'+(_isLast?'rt-chart-partial-dot':'')+'\" cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    label='partial endpoint dots'
)

# 5) Gradient opacity is caller-controlled; replace native always-visible dashed
#    paths with the sequenced dash-mark groups.
app = rep(app, "    +  '<stop offset=\"0%\" stop-color=\"'+fillColor+'\" stop-opacity=\"0.5\"/>'\n    +  '<stop offset=\"100%\" stop-color=\"'+fillColor+'\" stop-opacity=\"0\"/>'",
              "    +  '<stop offset=\"0%\" stop-color=\"'+fillColor+'\" stop-opacity=\"'+fillOpacity.toFixed(3)+'\"/>'\n    +  '<stop offset=\"100%\" stop-color=\"'+fillColor+'\" stop-opacity=\"'+fillEndOpacity.toFixed(3)+'\"/>'",
              label='gradient strength')
app = rep(app,
    "    +(profitDash?'<path class=\"rt-chart-partial\" d=\"'+profitDash+'\" fill=\"none\" stroke=\"'+secondaryColor+'\" stroke-width=\"'+profitStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.55\"/>':'')",
    "    +profitPartial",
    label='profit partial render')
app = rep(app,
    "    +(tertDash&&!tertiaryMarkersOnly&&!tertiaryBars?'<path class=\"rt-chart-partial\" d=\"'+tertDash+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.55\"/>':'')",
    "    +(!tertiaryMarkersOnly&&!tertiaryBars?tertPartial:'')",
    label='tertiary partial render')
app = rep(app,
    "    +(!primaryBars&&revDash?'<path class=\"rt-chart-partial\" d=\"'+revDash+'\" fill=\"none\" stroke=\"'+primaryColor+'\" stroke-width=\"'+revStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.6\"/>':'')",
    "    +(!primaryBars?revPartial:'')",
    label='revenue partial render')

# 6) Dashboard: Revenue owns the restrained blue area. Gross Profit becomes a
#    clean green line. Hide historic point markers; preserve both hollow current
#    endpoints. Desktop + mobile use the same hierarchy.
app = rep(app,
    "        profitDotR:2.5,revDotR:3,\n        profitStroke:1.8,revStroke:2,scrubDotR:4.5,\n        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',",
    "        profitDotR:2.5,revDotR:3,\n        profitStroke:2.0,revStroke:2.1,scrubDotR:4.5,\n        maxDotsN:0,showLastProfitDot:true,\n        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',",
    label='dashboard desktop line hierarchy')
app = rep(app,
    "        drawKey:SUMMARY_PERIOD,\n        gradientId:'rt-profit-fill',\n        partialLast:!!partialLast",
    "        drawKey:SUMMARY_PERIOD,\n        fillData:revData,fillColor:'var(--state-listed)',fillOpacity:0.16,\n        gradientId:'rt-revenue-fill',\n        partialLast:!!partialLast",
    label='dashboard desktop revenue area')
app = rep(app,
    "        maxDotsN:12,\n        profitDotR:3,revDotR:3.5,\n        profitStroke:2.2,revStroke:2.6,scrubDotR:5,\n        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',",
    "        maxDotsN:0,showLastProfitDot:true,\n        profitDotR:3,revDotR:3.5,\n        profitStroke:2.3,revStroke:2.4,scrubDotR:5,\n        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',",
    label='dashboard mobile line hierarchy')
app = rep(app,
    "        drawKey:SUMMARY_PERIOD,\n        gradientId:'rt-profit-fill-m',\n        partialLast:!!partialLast",
    "        drawKey:SUMMARY_PERIOD,\n        fillData:revData,fillColor:'var(--state-listed)',fillOpacity:0.14,\n        gradientId:'rt-revenue-fill-m',\n        partialLast:!!partialLast",
    label='dashboard mobile revenue area')

# 7) FY bars: keep the approved bar + line structure, but give completed revenue
#    columns enough fill to read as columns rather than outlines.
app = rep(app,
    "fill-opacity=\"'+(isPartial?'0.12':'0.20')+'\" stroke=\"'+primaryColor+'\" stroke-opacity=\"'+(isPartial?'0.52':'0.62')+'\"",
    "fill-opacity=\"'+(isPartial?'0.12':'0.30')+'\" stroke=\"'+primaryColor+'\" stroke-opacity=\"'+(isPartial?'0.52':'0.72')+'\"",
    label='FY bar visibility')

# 8) CSS: partial segment is deliberately a second phase. Historical line draws
#    first, then individual dashes arrive in sequence. "so far" and hollow
#    endpoints wait for that second phase. Reduced-motion removes every delay.
css += '''\n\n/* v1.4.32 — revenue area + sequenced partial-period motion */\n@keyframes rtChartPartialDashIn{\n  from{opacity:0;transform:translateX(-1px)}\n  to{opacity:1;transform:none}\n}\nsvg.rt-chart-draw .rt-chart-partial-dash{\n  opacity:0;\n  transform-box:fill-box;\n  transform-origin:center;\n  animation:rtChartPartialDashIn 95ms var(--ease-out) both;\n  animation-delay:calc(var(--dur-draw) + var(--dash-delay,0ms));\n}\nsvg.rt-chart-draw .rt-chart-so-far{\n  opacity:0!important;\n  animation:rtChartFadeIn 160ms var(--ease-out) both;\n  animation-delay:calc(var(--dur-draw) + 210ms);\n}\nsvg.rt-chart-draw .rt-chart-col circle.rt-chart-partial-dot{\n  animation-delay:calc(var(--dur-draw) + 280ms)!important;\n}\n@media(prefers-reduced-motion:reduce){\n  svg.rt-chart-draw .rt-chart-partial-dash,\n  svg.rt-chart-draw .rt-chart-so-far,\n  svg.rt-chart-draw .rt-chart-col circle.rt-chart-partial-dot{\n    animation:none!important;\n    animation-delay:0ms!important;\n    opacity:1!important;\n    transform:none!important;\n  }\n}\n'''

# Asset cache bump.
index = rep(index, './app.css?v=1.4.31', './app.css?v=1.4.32', label='CSS cache bump')
index = rep(index, './app.js?v=1.4.31', './app.js?v=1.4.32', label='JS cache bump')

# Guardrails.
checks = {
    'dashboard revenue fill desktop/mobile': app.count('fillData:revData') == 2,
    'uniform refund marker': 'const w=count>1?8:6;' not in app and 'const w=7;' in app,
    'dash marks generated': '_mkDashMarks=function' in app and 'rt-chart-partial-dash' in app,
    'native partial path removed': 'class="rt-chart-partial"' not in app,
    'historic dashboard dots hidden': app.count('maxDotsN:0') >= 2,
    'partial CSS': 'rtChartPartialDashIn' in css,
    'version bump': 'app.js?v=1.4.32' in index and 'app.css?v=1.4.32' in index,
}
failed=[k for k,v in checks.items() if not v]
if failed:
    raise RuntimeError('Post-patch checks failed: '+', '.join(failed))

APP.write_text(app, encoding='utf-8')
CSS.write_text(css, encoding='utf-8')
INDEX.write_text(index, encoding='utf-8')
print('Applied v1.4.32 dashboard revenue-area and partial-period motion patch.')
