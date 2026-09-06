from pathlib import Path
import re

APP=Path('app.js')
CSS=Path('app.css')
INDEX=Path('index.html')
app=APP.read_text(encoding='utf-8')
css=CSS.read_text(encoding='utf-8')
index=INDEX.read_text(encoding='utf-8')


def rep_once(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 exact match, found {n}')
    return text.replace(old,new,1)


def re_once(text, pattern, repl, label, flags=0):
    out,n=re.subn(pattern,repl,text,count=1,flags=flags)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 regex match, found {n}')
    return out

# ---------------------------------------------------------------------------
# Generic chart engine: allow Dashboard primary revenue bars to contain a
# narrower profit bar. Revenue still owns the full height; the inner bar makes
# the retained gross-profit portion immediately legible without a second line.
# ---------------------------------------------------------------------------
app=rep_once(app,
"  const primaryBars=!!opts.primaryBars;\n  const primaryBarMaxW=opts.primaryBarMaxW!=null?Math.max(10,Number(opts.primaryBarMaxW)||30):30;",
"  const primaryBars=!!opts.primaryBars;\n  const primaryBarMaxW=opts.primaryBarMaxW!=null?Math.max(10,Number(opts.primaryBarMaxW)||30):30;\n  const secondaryBarsInPrimary=!!opts.secondaryBarsInPrimary;",
'chart secondary-bars option')

primary_pat=r"(  const primaryBarsHTML=primaryBars\?revData\.map\(function\(raw,i\)\{.*?\n  \}\)\.join\(''\):'';\n)"
primary_add=r'''\1\n  const secondaryBarW=Math.max(6,primaryBarW*0.62);\n  const secondaryBarsHTML=(primaryBars&&secondaryBarsInPrimary)?profitData.map(function(raw,i){\n    const p=Number(raw)||0;if(Math.abs(p)<0.005)return '';\n    const cx=sx(i),y0=sy(0),yp=sy(p),h=Math.max(1.5,Math.abs(y0-yp)),y=Math.min(y0,yp);\n    const isPartial=_partial&&i===n-1;\n    const innerColor=p>=0?secondaryColor:'var(--red)';\n    const cls='rt-chart-primary-bar rt-chart-profit-bar'+(p<0?' rt-chart-primary-bar--negative':'')+(isPartial?' rt-chart-primary-bar--partial':'');\n    return '<rect class="'+cls+'" style="--bar-i:'+i+'" x="'+(cx-secondaryBarW/2).toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+secondaryBarW.toFixed(1)+'" height="'+h.toFixed(1)+'" rx="'+Math.min(3,secondaryBarW/3).toFixed(1)+'" fill="'+innerColor+'" fill-opacity="'+(isPartial?'0.42':'0.90')+'" stroke="'+innerColor+'" stroke-opacity="'+(isPartial?'0.60':'0.95')+'" stroke-width="0.8"'+(isPartial?' stroke-dasharray="3 2"':'')+'/>';\n  }).join(''):'';\n'''
app=re_once(app,primary_pat,primary_add,'insert contained profit bars',re.S)

app=rep_once(app,
"      +(hasP&&(showDots||(_isLast&&showLastProfitDot))?'<circle class=\"'+(_isLast?'rt-chart-partial-dot':'')+'\" cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(p).toFixed(1)+'\" r=\"'+profitDotR+'\" fill=\"'+_df(secondaryColor)+'\" stroke=\"'+_ds(secondaryColor)+'\" stroke-width=\"1.2\"/>':'')",
"      +(hasP&&!secondaryBarsInPrimary&&(showDots||(_isLast&&showLastProfitDot))?'<circle class=\"'+(_isLast?'rt-chart-partial-dot':'')+'\" cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(p).toFixed(1)+'\" r=\"'+profitDotR+'\" fill=\"'+_df(secondaryColor)+'\" stroke=\"'+_ds(secondaryColor)+'\" stroke-width=\"1.2\"/>':'')",
'hide profit dots for contained bars')

app=rep_once(app,
"    +primaryBarsHTML\n    +'<path class=\"rt-chart-line\" d=\"'+profitLine+'\" fill=\"none\" stroke=\"'+secondaryColor+'\" stroke-width=\"'+profitStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>'\n    +profitPartial",
"    +primaryBarsHTML\n    +secondaryBarsHTML\n    +(secondaryBarsInPrimary?'':'<path class=\"rt-chart-line\" d=\"'+profitLine+'\" fill=\"none\" stroke=\"'+secondaryColor+'\" stroke-width=\"'+profitStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>')\n    +(secondaryBarsInPrimary?'':profitPartial)",
'hide profit line for contained bars')

# ---------------------------------------------------------------------------
# Dashboard chart renderer: primary = Gross Revenue column, secondary = narrower
# Gross Profit portion. Refunds stay as the existing small red event dots.
# ---------------------------------------------------------------------------
r0=app.index('function renderSummaryChart(')
r1=app.index('function _renderChartInto(',r0)
rchart=app[r0:r1]

for scrub,maxw,label in [('4.5','42','desktop'),('5','34','mobile')]:
    pat=rf'(?m)^(\s*)profitStroke:[^,\n]+,revStroke:[^,\n]+,scrubDotR:{re.escape(scrub)},'
    def repl(m,maxw=maxw):
        ind=m.group(1)
        return (ind+f'profitStroke:0,revStroke:0,scrubDotR:{scrub},\n'
                +ind+f'primaryBars:true,primaryBarMaxW:{maxw},secondaryBarsInPrimary:true,showArea:false,')
    rchart,n=re.subn(pat,repl,rchart,count=1)
    if n!=1:
        raise RuntimeError(f'dashboard {label} bars: expected 1 renderer option match, found {n}')

rchart=rchart.replace('maxDotsN:0,showLastProfitDot:true','maxDotsN:0,showLastProfitDot:false')
app=app[:r0]+rchart+app[r1:]

# ---------------------------------------------------------------------------
# Dashboard data: reduce noisy daily points into meaningful operating buckets.
# 30/60 days -> weekly; ~90 days -> fortnightly; FY remains monthly.
# ---------------------------------------------------------------------------
s0=app.index('function renderSummary(){')
s1=app.index('function renderMonthlyPage(){',s0)
summary=app[s0:s1]

bucket_match=list(re.finditer(r'(?m)^(\s*)(?:let|const)\s+bucketDays\s*=\s*[^;]+;',summary))
if len(bucket_match)!=1:
    raise RuntimeError(f'dashboard bucketDays: expected 1 match inside renderSummary, found {len(bucket_match)}')
m=bucket_match[0]
indent=m.group(1)
new_bucket=(indent+"const _summarySpanDays=Math.max(1,Math.round((Date.parse(range.to)-Date.parse(range.from))/86400000)+1);\n"
            +indent+"let bucketDays=_summarySpanDays<=65?7:(_summarySpanDays<=100?14:30);")
summary=summary[:m.start()]+new_bucket+summary[m.end():]

if '<svg class="summary-hero-spark"' not in summary:
    raise RuntimeError('summary sparkline anchor missing')
summary=summary.replace('<svg class="summary-hero-spark"','<svg class="summary-hero-spark" style="display:none"')
app=app[:s0]+summary+app[s1:]

# ---------------------------------------------------------------------------
# Yearly Sales: line trend view. Net Revenue = blue line; Net Profit = green
# line + subtle fill; Refunds = faint red line. Existing current-month dotted
# reveal remains active because primaryBars becomes false.
# ---------------------------------------------------------------------------
app=rep_once(app,
"    +'<span class=\"legend-item\"><span class=\"monthly-legend-bar\"></span>Net Revenue</span>'",
"    +'<span class=\"legend-item\"><span class=\"monthly-legend-line monthly-legend-line--revenue\"></span>Net Revenue</span>'",
'FY revenue legend line')
app=app.replace('aria-label="Monthly net revenue columns, net profit trend and refund events"','aria-label="Monthly net revenue, net profit and refunds over time"')

c0=app.index('function renderMonthlyProfitabilityChart(')
c1=app.index('function renderMonthlyGrid(){',c0)
cal=app[c0:c1]
cal=re_once(cal,r'(?m)^(\s*)profitDotR:[^\n]+,revDotR:[^\n]+,$',r'\1profitDotR:_W<520?2.8:2.6,revDotR:_W<520?3.0:2.8,','FY line dots')
cal=re_once(cal,r'(?m)^(\s*)profitStroke:[^\n]+,revStroke:[^\n]+,scrubDotR:([^\n]+),$',r'\1profitStroke:_W<520?2.4:2.1,revStroke:_W<520?2.4:2.1,scrubDotR:\2,','FY line strokes')
cal=rep_once(cal,'    primaryBars:true,','    primaryBars:false,','FY disable bars')
cal=rep_once(cal,'    showArea:false,','    showArea:true,\n    fillData:netProfit,\n    fillColor:\'var(--profit)\',\n    fillOpacity:0.24,','FY profit area')
app=app[:c0]+cal+app[c1:]

# ---------------------------------------------------------------------------
# Styling + cache bump.
# ---------------------------------------------------------------------------
css += """\n\n/* v1.4.37 — Dashboard bars / FY trend trial */\n.rt #p-monthly .monthly-legend-line--revenue{border-top-color:var(--state-listed);}\n.rt-chart-profit-bar{filter:none;}\nsvg.rt-chart-draw .rt-chart-profit-bar{animation-delay:calc(var(--bar-i) * 26ms + 90ms);}\n@media(prefers-reduced-motion:reduce){svg.rt-chart-draw .rt-chart-profit-bar{animation:none!important;}}\n"""

index=rep_once(index,'./app.css?v=1.4.36','./app.css?v=1.4.37','CSS cache bump')
index=rep_once(index,'./app.js?v=1.4.36','./app.js?v=1.4.37','JS cache bump')

APP.write_text(app,encoding='utf-8')
CSS.write_text(css,encoding='utf-8')
INDEX.write_text(index,encoding='utf-8')
print('v1.4.37 chart swap patch applied')
