from pathlib import Path


def rep(text, old, new, count=1, label='replacement'):
    n = text.count(old)
    if n != count:
        raise RuntimeError(f'{label}: expected {count}, found {n}')
    return text.replace(old, new, count)

app_path = Path('app.js')
css_path = Path('app.css')
index_path = Path('index.html')
app = app_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')
index = index_path.read_text(encoding='utf-8')

# Dashboard: restore the original semantic hierarchy — revenue line, profit fill.
app = rep(app,
    "fillData:revData,fillColor:'var(--state-listed)',fillOpacity:0.16,\n        gradientId:'rt-revenue-fill',",
    "fillData:profitData,fillColor:'var(--profit)',fillOpacity:0.50,\n        gradientId:'rt-profit-fill',",
    label='desktop dashboard profit fill')
app = rep(app,
    "fillData:revData,fillColor:'var(--state-listed)',fillOpacity:0.14,\n        gradientId:'rt-revenue-fill-m',",
    "fillData:profitData,fillColor:'var(--profit)',fillOpacity:0.50,\n        gradientId:'rt-profit-fill-m',",
    label='mobile dashboard profit fill')

# Dashboard refund marks: compact red dots on a fixed rail INSIDE the plot.
app = rep(app, "tertiaryEvents:true,tertiaryEventDotR:4.2,", "tertiaryEvents:true,tertiaryEventDotR:3.2,", label='desktop refund dot size')
app = rep(app, "tertiaryEvents:true,tertiaryEventDotR:4.6,", "tertiaryEvents:true,tertiaryEventDotR:3.4,", label='mobile refund dot size')
app = rep(app,
    "// Refunds are annotations, not a third money series. Put them in the x-axis\n  // gutter below the plot so low-profit periods never collide with a marker.\n  const tertiaryEventY=H-pad.b+Math.max(5,Math.min(7,fontSize*0.48));",
    "// Semantic refund marks sit on a fixed rail just inside the plot. Their Y\n  // position does NOT encode amount; amount remains an on-demand tooltip value.\n  const tertiaryEventY=H-pad.b-Math.max(8,Math.min(12,fontSize*0.80));",
    label='refund rail placement')
app = rep(app,
    "const w=7;\n      return '<g class=\"rt-chart-refund-event\" data-refund-count=\"'+count+'\">'\n        +'<rect x=\"'+(cx-w/2).toFixed(1)+'\" y=\"'+(tertiaryEventY-1.5).toFixed(1)+'\" width=\"'+w+'\" height=\"3\" rx=\"1.5\" fill=\"'+tertiaryColor+'\" opacity=\"0.92\"/>'\n        +'<title>'+tertiaryLabel+' '+fmtMoney(t)+(count?' · '+count+' event'+(count===1?'':'s'):'')+'</title></g>';",
    "return '<g class=\"rt-chart-refund-event\" data-refund-count=\"'+count+'\">'\n        +'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+tertiaryEventY.toFixed(1)+'\" r=\"'+tertiaryEventDotR+'\" fill=\"'+tertiaryColor+'\" opacity=\"0.92\"/>'\n        +'<title>'+tertiaryLabel+' '+fmtMoney(t)+(count?' ('+count+')':'')+'</title></g>';",
    label='refund event dot svg')

# Keep counts concise everywhere: Refunds (£ / count) rather than “events”.
app = rep(app,
    "(tertiaryCounts&&tertiaryCounts[i]?' · '+tertiaryCounts[i]+' event'+(tertiaryCounts[i]===1?'':'s'):'')",
    "(tertiaryCounts&&tertiaryCounts[i]?' ('+tertiaryCounts[i]+')':'')",
    label='native chart title refund count')
app = rep(app,
    "+(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+((tertiaryCounts&&Number(tertiaryCounts[idx])===1)?'Refund':'Refunds')+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' · '+Number(tertiaryCounts[idx])+(Number(tertiaryCounts[idx])===1?' event':' events'):'')+'</strong></div>':'');",
    "+(tertiaryData&&tv!==0?'<div class=\"tip-row\"><span class=\"tip-dot\" style=\"background:'+tertiaryColor+'\"></span>'+tertiaryLabel+' <strong>−'+fmtMoneyTip(tv)+(tertiaryCounts&&Number(tertiaryCounts[idx])>0?' ('+Number(tertiaryCounts[idx])+')':'')+'</strong></div>':'');",
    label='scrub tooltip refund count')

# Dashboard legend: visible refund count in brackets, no “event” language.
old_legend = "${chartReturns.some(function(v){return Number(v)>0;})?'<span class=\"legend-item\"><span class=\"legend-event-mark\"></span>Refunds</span>':''}"
new_legend = "${chartReturns.some(function(v){return Number(v)>0;})?'<span class=\"legend-item\"><span class=\"legend-event-mark\"></span>Refunds ('+chartReturnCounts.reduce(function(s,v){return s+(Number(v)||0);},0)+')</span>':''}"
app = rep(app, old_legend, new_legend, count=2, label='dashboard refund legends')
app = rep(app, 'refund events over time', 'refunds over time', count=2, label='dashboard aria copy')

# FY chart: refunds are monthly quantitative data, so use a restrained red line.
app = rep(app,
    "const tertiaryStroke=opts.tertiaryStroke!=null?opts.tertiaryStroke:1.6;\n  const tertiaryDotR=opts.tertiaryDotR||2.5;",
    "const tertiaryStroke=opts.tertiaryStroke!=null?opts.tertiaryStroke:1.6;\n  const tertiaryLineOpacity=opts.tertiaryLineOpacity!=null?Math.max(0.15,Math.min(1,Number(opts.tertiaryLineOpacity)||0.58)):0.95;\n  const tertiaryDotR=opts.tertiaryDotR||2.5;",
    label='tertiary line opacity option')
app = rep(app,
    "(tertiaryData&&!tertiaryMarkersOnly&&!tertiaryBars?'<path class=\"rt-chart-line\" d=\"'+tertLine+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>':'')",
    "(tertiaryData&&!tertiaryMarkersOnly&&!tertiaryBars?'<path class=\"rt-chart-line rt-chart-tertiary-line\" d=\"'+tertLine+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"'+tertiaryLineOpacity.toFixed(2)+'\"/>':'')",
    label='tertiary line opacity render')

app = rep(app,
    "const currentIsLast=keys[keys.length-1]===currentMonthKey();\n  const refundLegend=document.getElementById('monthly-refund-legend');\n  if(refundLegend)refundLegend.style.display=refunds.some(function(v){return v>0;})?'inline-flex':'none';",
    "const currentIsLast=keys[keys.length-1]===currentMonthKey();\n  const refundTotalCount=refundCounts.reduce(function(s,v){return s+(Number(v)||0);},0);\n  const hasRefunds=refunds.some(function(v){return Number(v)>0;});\n  const refundLegend=document.getElementById('monthly-refund-legend');\n  if(refundLegend){\n    refundLegend.style.display=hasRefunds?'inline-flex':'none';\n    if(hasRefunds)refundLegend.innerHTML='<span class=\"monthly-legend-refund-line\"></span>Refunds ('+refundTotalCount+')';\n  }",
    label='FY refund legend count')
app = rep(app,
    "tertiaryData:refunds,\n    tertiaryCounts:refundCounts,\n    tertiaryColor:'var(--red)',\n    tertiaryLabel:'Refunds',\n    tertiaryStroke:0,\n    tertiaryMarkersOnly:true,\n    tertiaryAlwaysDots:true,\n    tertiaryEvents:true,",
    "tertiaryData:hasRefunds?refunds:null,\n    tertiaryCounts:hasRefunds?refundCounts:null,\n    tertiaryColor:'var(--red)',\n    tertiaryLabel:'Refunds',\n    tertiaryStroke:1.45,\n    tertiaryLineOpacity:0.58,\n    tertiaryDotR:_W<520?2.6:2.4,\n    tertiaryDotOpacity:0.78,\n    tertiaryMarkersOnly:false,\n    tertiaryAlwaysDots:true,\n    tertiaryEvents:false,",
    label='FY refund line options')

# Visual language: dot for dashboard refund events; line swatch for FY refunds.
css = rep(css,
    ".legend-event-mark{display:inline-block;width:10px;height:3px;border-radius:999px;background:var(--red);flex:none;}",
    ".legend-event-mark{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--red);flex:none;}\n.monthly-legend-refund-line{display:inline-block;width:12px;height:0;border-top:1.5px solid var(--red);border-radius:999px;opacity:.72;flex:none;position:relative;}\n.monthly-legend-refund-line::after{content:\"\";position:absolute;width:4px;height:4px;border-radius:50%;background:var(--red);left:4px;top:-2.75px;}",
    label='refund legend swatches')
css += "\n\n/* v1.4.34 — profit area + refund dot/line hierarchy */\n@keyframes rtRefundDotIn{from{opacity:0;transform:scale(.72)}to{opacity:1;transform:scale(1)}}\nsvg.rt-chart-draw .rt-chart-refund-event{animation:rtRefundDotIn 150ms var(--ease-out) both;animation-delay:calc(var(--dur-draw) * .84);}\n.rt-chart-tertiary-line{filter:none;}\n@media(prefers-reduced-motion:reduce){svg.rt-chart-draw .rt-chart-refund-event{animation:none!important;}}\n"

# Asset busting.
index = rep(index, 'app.css?v=1.4.33', 'app.css?v=1.4.34', label='css cache bump')
index = rep(index, 'app.js?v=1.4.33', 'app.js?v=1.4.34', label='js cache bump')

app_path.write_text(app, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
index_path.write_text(index, encoding='utf-8')
