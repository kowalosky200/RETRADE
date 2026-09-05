from pathlib import Path

p=Path('app.js')
s=p.read_text(encoding='utf-8')

def rep(old,new,label,count=1):
    global s
    n=s.count(old)
    if n!=count:
        raise SystemExit(f'{label}: expected {count} match(es), found {n}')
    s=s.replace(old,new,count)

rep(
"        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryDotR:2.4,tertiaryMarkersOnly:true,tertiaryAlwaysDots:true,tertiaryDotOpacity:0.72,",
"        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryBars:true,tertiaryBarMaxW:6,tertiaryBarOpacity:0.22,",
'desktop refund options')

rep(
"        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryDotR:2.7,tertiaryMarkersOnly:true,tertiaryAlwaysDots:true,tertiaryDotOpacity:0.72,",
"        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:0,tertiaryBars:true,tertiaryBarMaxW:6.5,tertiaryBarOpacity:0.22,",
'mobile refund options')

old_vars="""  const tertiaryMarkersOnly=!!opts.tertiaryMarkersOnly;
  const tertiaryAlwaysDots=!!opts.tertiaryAlwaysDots;
  const tertiaryDotOpacity=opts.tertiaryDotOpacity!=null?Math.max(0,Math.min(1,Number(opts.tertiaryDotOpacity)||0)):1;
  const fillColor=opts.fillColor||secondaryColor;"""
new_vars="""  const tertiaryMarkersOnly=!!opts.tertiaryMarkersOnly;
  const tertiaryAlwaysDots=!!opts.tertiaryAlwaysDots;
  const tertiaryDotOpacity=opts.tertiaryDotOpacity!=null?Math.max(0,Math.min(1,Number(opts.tertiaryDotOpacity)||0)):1;
  const tertiaryBars=!!opts.tertiaryBars;
  const tertiaryBarMaxW=opts.tertiaryBarMaxW!=null?Math.max(3,Number(opts.tertiaryBarMaxW)||6):6;
  const tertiaryBarOpacity=opts.tertiaryBarOpacity!=null?Math.max(0.08,Math.min(0.5,Number(opts.tertiaryBarOpacity)||0.22)):0.22;
  const fillColor=opts.fillColor||secondaryColor;"""
rep(old_vars,new_vars,'tertiary bar options')

old_hits="""  const colW=n>1?xStep:innerW;
  const fmtMoney=v=>'£'+(v||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  const hits=labels.map((l,i)=>{"""
new_hits="""  const colW=n>1?xStep:innerW;
  const fmtMoney=v=>'£'+(v||0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
  // Refunds are discrete events, not a continuous trend. Render them as slim,
  // low-emphasis columns from the zero baseline so sales/profit stay dominant.
  const tertiaryBarW=Math.max(3.5,Math.min(tertiaryBarMaxW,(n>1?xStep:innerW)*0.22));
  const tertBars=(tertiaryData&&tertiaryBars)?tertiaryData.map(function(raw,i){
    const t=Math.max(0,Number(raw)||0);
    if(t<=0)return '';
    const cx=sx(i), y0=sy(0), yt=sy(t);
    const h=Math.max(2.4,Math.abs(y0-yt));
    const y=Math.min(y0,yt);
    const isPartial=_partial&&i===n-1;
    const op=isPartial?Math.max(0.10,tertiaryBarOpacity*0.6):tertiaryBarOpacity;
    const strokeOp=isPartial?0.58:0.28;
    return '<rect class=\"rt-chart-refund-bar\" x=\"'+(cx-tertiaryBarW/2).toFixed(1)+'\" y=\"'+y.toFixed(1)+'\" width=\"'+tertiaryBarW.toFixed(1)+'\" height=\"'+h.toFixed(1)+'\" rx=\"'+Math.min(2.4,tertiaryBarW/2).toFixed(1)+'\" fill=\"'+tertiaryColor+'\" opacity=\"'+op.toFixed(2)+'\" stroke=\"'+tertiaryColor+'\" stroke-opacity=\"'+strokeOp+'\" stroke-width=\"0.8\"/>';
  }).join(''):'';
  const hits=labels.map((l,i)=>{"""
rep(old_hits,new_hits,'refund bar renderer')

rep(
"      +(hasT&&(showDots||tertiaryAlwaysDots)?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(t).toFixed(1)+'\" r=\"'+tertiaryDotR+'\" fill=\"'+_df(tertiaryColor)+'\" stroke=\"'+_ds(tertiaryColor)+'\" stroke-width=\"1.1\" opacity=\"'+tertiaryDotOpacity+'\"/>':'')",
"      +(hasT&&!tertiaryBars&&(showDots||tertiaryAlwaysDots)?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(t).toFixed(1)+'\" r=\"'+tertiaryDotR+'\" fill=\"'+_df(tertiaryColor)+'\" stroke=\"'+_ds(tertiaryColor)+'\" stroke-width=\"1.1\" opacity=\"'+tertiaryDotOpacity+'\"/>':'')",
'suppress refund dots when bars active')

rep(
"    +'<path class=\"rt-chart-area\" d=\"'+area+'\" fill=\"url(#'+gradientId+')\" stroke=\"none\"/>'\n    +'<path class=\"rt-chart-line\" d=\"'+profitLine+'\" fill=\"none\" stroke=\"'+secondaryColor+'\" stroke-width=\"'+profitStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>'",
"    +'<path class=\"rt-chart-area\" d=\"'+area+'\" fill=\"url(#'+gradientId+')\" stroke=\"none\"/>'\n    +tertBars\n    +'<path class=\"rt-chart-line\" d=\"'+profitLine+'\" fill=\"none\" stroke=\"'+secondaryColor+'\" stroke-width=\"'+profitStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>'",
'draw refund bars behind lines')

rep(
"    +(tertiaryData&&!tertiaryMarkersOnly?'<path class=\"rt-chart-line\" d=\"'+tertLine+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>':'')",
"    +(tertiaryData&&!tertiaryMarkersOnly&&!tertiaryBars?'<path class=\"rt-chart-line\" d=\"'+tertLine+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-linejoin=\"round\" stroke-linecap=\"round\" opacity=\"0.95\"/>':'')",
'suppress refund line when bars active')

rep(
"    +(tertDash&&!tertiaryMarkersOnly?'<path class=\"rt-chart-partial\" d=\"'+tertDash+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.55\"/>':'')",
"    +(tertDash&&!tertiaryMarkersOnly&&!tertiaryBars?'<path class=\"rt-chart-partial\" d=\"'+tertDash+'\" fill=\"none\" stroke=\"'+tertiaryColor+'\" stroke-width=\"'+tertiaryStroke+'\" stroke-dasharray=\"4 3\" stroke-linecap=\"round\" opacity=\"0.55\"/>':'')",
'suppress partial refund line when bars active')

p.write_text(s,encoding='utf-8')
Path('.github/refund_bars_patch.py').unlink()
Path('.github/workflows/refund-bars.yml').unlink()
