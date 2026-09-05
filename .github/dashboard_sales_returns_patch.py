from pathlib import Path
import re

p=Path('app.js')
s=p.read_text()

def replace_once(old,new,label):
    global s
    n=s.count(old)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 exact match, found {n}')
    s=s.replace(old,new,1)

def sub_once(pattern,repl,label):
    global s
    s2,n=re.subn(pattern,repl,s,count=1,flags=re.S)
    if n!=1:
        raise SystemExit(f'{label}: expected 1 regex match, found {n}')
    s=s2

# Dashboard trend: operational sales performance gets three independent series.
# The accounting KPIs remain untouched: they still include dated return reversals.
sub_once(
    r"    let chartLabels=\[\], chartRev=\[\], chartProfit=\[\], chartClickHandlers=\[\];\n    if\(isFY\)\{.*?\n    window\.__chartClickHandlers=chartClickHandlers;",
    r"""    // Operational trend: sales stay on their sale date; later refunds do not
    // rewrite the sale or its profit. Refunds are a separate positive-magnitude
    // series. Headline KPIs/statements still use full accounting adjustments.
    let chartLabels=[], chartRev=[], chartProfit=[], chartReturns=[], chartClickHandlers=[];
    if(isFY){
      const keys=_fyKeys(SUMMARY_PERIOD==='current_fy'?_currentFYStart():_currentFYStart()-1);
      keys.forEach(k=>{
        const events=getSaleEventsInMonth(k);
        const sales=events.filter(function(x){return !x.isReturnAdjustment;});
        const returns=events.filter(function(x){return x.isReturnAdjustment;});
        const salesRevenue=sales.reduce(function(sum,x){const sb=_saleBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0);
        const salesProfit=sales.reduce(function(sum,x){return sum+(Number(_saleBreakdown(x).netProfit)||0);},0);
        const refunds=returns.reduce(function(sum,x){return sum+Math.max(0,-(Number(x.salePrice)||0));},0);
        chartLabels.push(MONTH_NAMES[keyCode(k)].slice(0,3));
        chartRev.push(+salesRevenue.toFixed(2));
        chartProfit.push(+salesProfit.toFixed(2));
        chartReturns.push(+refunds.toFixed(2));
        chartClickHandlers.push(events.length===0?null:{fn:'showMonthSnapshot',args:[k]});
      });
    } else {
      const buckets=[]; let cur=range.from;
      if(isDaily){
        while(cur<=range.to){buckets.push({from:cur,to:cur,label:fmtShort(cur)});cur=addDays(cur,1);}
      } else {
        const bucketDays = SUMMARY_PERIOD==='30d' ? 1 : 7;
        while(cur<=range.to){
          const end = addDays(cur,bucketDays-1)<=range.to ? addDays(cur,bucketDays-1) : range.to;
          buckets.push({from:cur,to:end,label:fmtShort(cur)});
          cur=addDays(cur,bucketDays);
        }
      }
      const chartEvents=getSaleEventsInRange(range.from,range.to);
      const bData=buckets.map(function(b){
        const inB=chartEvents.filter(function(x){return x.saleDate>=b.from&&x.saleDate<=b.to;});
        const sales=inB.filter(function(x){return !x.isReturnAdjustment;});
        const returns=inB.filter(function(x){return x.isReturnAdjustment;});
        return {...b,
          rev:sales.reduce(function(sum,x){const sb=_saleBreakdown(x);return sum+(Number(sb.salePrice)||0)+(Number(sb.postage)||0);},0),
          profit:sales.reduce(function(sum,x){return sum+(Number(_saleBreakdown(x).netProfit)||0);},0),
          refunds:returns.reduce(function(sum,x){return sum+Math.max(0,-(Number(x.salePrice)||0));},0),
          eventCount:inB.length};
      });
      bData.forEach(b=>{
        chartLabels.push(b.label);
        chartRev.push(+b.rev.toFixed(2));
        chartProfit.push(+b.profit.toFixed(2));
        chartReturns.push(+b.refunds.toFixed(2));
        chartClickHandlers.push(b.eventCount===0?null:{fn:'showRangeSnapshot',args:[b.label,b.from,b.to]});
      });
    }
    window.__chartClickHandlers=chartClickHandlers;""",
    'dashboard chart data split'
)

replace_once(
    "renderSummaryChart(chartLabels,chartRev,chartProfit,_chartPartialLast);",
    "renderSummaryChart(chartLabels,chartRev,chartProfit,chartReturns,_chartPartialLast);",
    'dashboard chart call'
)
replace_once(
    "function renderSummaryChart(labels,revData,profitData,partialLast){",
    "function renderSummaryChart(labels,revData,profitData,returnData,partialLast){",
    'dashboard chart signature'
)

replace_once(
"""        profitDotR:2.5,revDotR:3,
        profitStroke:1.8,revStroke:2,scrubDotR:4.5,
        drawKey:SUMMARY_PERIOD,""",
"""        profitDotR:2.5,revDotR:3,
        profitStroke:1.8,revStroke:2,scrubDotR:4.5,
        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',
        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:1.7,tertiaryDotR:2.5,
        drawKey:SUMMARY_PERIOD,""",
'desktop refund series options')
replace_once(
"""        profitDotR:3,revDotR:3.5,
        profitStroke:2.2,revStroke:2.6,scrubDotR:5,
        drawKey:SUMMARY_PERIOD,""",
"""        profitDotR:3,revDotR:3.5,
        profitStroke:2.2,revStroke:2.6,scrubDotR:5,
        primaryLabel:'Sales Revenue',secondaryLabel:'Gross Profit',
        tertiaryData:returnData,tertiaryColor:'var(--warn)',tertiaryLabel:'Refunds',tertiaryStroke:2.1,tertiaryDotR:3,
        drawKey:SUMMARY_PERIOD,""",
'mobile refund series options')

replace_once(
"""    const r=revData[i]||0;
    const p=profitData[i]||0;
    const has=r>0;
    const hasP=p!==0;
    const t=tertiaryData?(tertiaryData[i]||0):0;
    const hasT=tertiaryData&&t!==0;""",
"""    const r=revData[i]||0;
    const p=profitData[i]||0;
    const hasR=r>0;
    const hasP=p!==0;
    const t=tertiaryData?(tertiaryData[i]||0):0;
    const hasT=tertiaryData&&t!==0;
    const has=hasR||hasP||hasT;""",
'refund-only hit target')
replace_once(
    "+((has&&(showDots||_isLast))?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    "+((hasR&&(showDots||_isLast))?'<circle cx=\"'+cx.toFixed(1)+'\" cy=\"'+sy(r).toFixed(1)+'\" r=\"'+revDotR+'\" fill=\"'+_df(primaryColor)+'\" stroke=\"'+_ds(primaryColor)+'\" stroke-width=\"1.5\"/>':'')",
    'revenue dot gate')

# Make the distinction explicit in the dashboard copy: headline is net accounting
# revenue; the chart itself is sales revenue + sales gross profit + refunds.
replace_once(
    "<div class=\"kpi-label\">Revenue · ${(periods.find(p=>p.key===SUMMARY_PERIOD)||{}).label||''}</div>",
    "<div class=\"kpi-label\">Net revenue · ${(periods.find(p=>p.key===SUMMARY_PERIOD)||{}).label||''}</div>",
    'mobile net revenue label')
replace_once(
    "<div class=\"card kpi clickable\" onclick=\"showFilteredItems('revenue')\"><div class=\"kpi-label\">Total revenue</div>",
    "<div class=\"card kpi clickable\" onclick=\"showFilteredItems('revenue')\"><div class=\"kpi-label\">Net revenue</div>",
    'desktop net revenue label')
replace_once('<div class="sl">Revenue over time</div>','<div class="sl">Sales &amp; returns over time</div>','dashboard chart title')

mobile_legend='<div class="summary-chart-legend"><span class="legend-item"><span class="legend-dot" style="background:var(--state-listed)"></span>Revenue</span><span class="legend-item"><span class="legend-dot" style="background:var(--profit)"></span>Gross Profit</span></div>'
mobile_legend_new='<div class="summary-chart-legend"><span class="legend-item"><span class="legend-dot" style="background:var(--state-listed)"></span>Sales Revenue</span><span class="legend-item"><span class="legend-dot" style="background:var(--profit)"></span>Gross Profit</span><span class="legend-item"><span class="legend-dot" style="background:var(--warn)"></span>Refunds</span></div>'
replace_once(mobile_legend,mobile_legend_new,'mobile chart legend')
replace_once(
"""              <span class="legend-item"><span class="legend-dot" style="background:var(--state-listed)"></span>Revenue</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--profit)"></span>Gross Profit</span>""",
"""              <span class="legend-item"><span class="legend-dot" style="background:var(--state-listed)"></span>Sales Revenue</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--profit)"></span>Gross Profit</span>
              <span class="legend-item"><span class="legend-dot" style="background:var(--warn)"></span>Refunds</span>""",
'desktop chart legend')

aria='aria-label="Revenue and gross profit over time"'
if s.count(aria)!=2:
    raise SystemExit(f'chart aria: expected 2 matches, found {s.count(aria)}')
s=s.replace(aria,'aria-label="Sales revenue, gross profit and refunds over time"',2)
replace_once(
    "{label:'Total revenue',sub:active.length+' active month'+(active.length!==1?'s':''),val:fmt(totalRev),profit:'Profit: '+fmt(totalProfit)}",
    "{label:'Sales revenue',sub:active.length+' active month'+(active.length!==1?'s':''),val:fmt(totalRev),profit:'Gross profit: '+fmt(totalProfit)}",
    'mobile sales summary wording')
replace_once(
    "const titles={revenue:'Total Revenue',realised:'Gross Profit',unrealised:'Unrealised Profit',stock:'Stock Value',sourced:'Listed Value'};",
    "const titles={revenue:'Net Revenue',realised:'Gross Profit',unrealised:'Unrealised Profit',stock:'Stock Value',sourced:'Listed Value'};",
    'net revenue drill title')

# FY chart drill: sales/profit describe sales only; returns are shown separately.
month_snapshot=r"""function showMonthSnapshot(monthKey){
  const events=getSaleEventsInMonth(monthKey);
  const sold=events.filter(function(e){return !e.isReturnAdjustment;});
  const returned=events.filter(function(e){return e.isReturnAdjustment;});
  const listed=(DB[monthKey]||[]).filter(function(i){return (i.item||'').trim().toUpperCase()!=='MONTH END'&&!i.dateSold&&!i.isReturned&&!i.resaleSalePrice&&!i.scrappedAt;});
  const stockValue=listed.reduce(function(sum,i){return sum+(Number(i.salePrice)||0);},0);
  const saleRevenue=+sold.reduce(function(sum,e){const b=_saleBreakdown(e);return sum+(Number(b.salePrice)||0)+(Number(b.postage)||0);},0).toFixed(2);
  const saleProfit=+sold.reduce(function(sum,e){return sum+(Number(_saleBreakdown(e).netProfit)||0);},0).toFixed(2);
  const refundTotal=+returned.reduce(function(sum,e){return sum+Math.max(0,-(Number(e.salePrice)||0));},0).toFixed(2);
  const marginPct=saleRevenue>0?(saleProfit/saleRevenue*100).toFixed(1):null;
  const profColor=saleProfit>=0?'var(--green)':'var(--red)';
  const cell=function(label,value,color,sub){return '<div style="background:var(--surface2);border-radius:10px;padding:12px 14px"><div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">'+label+'</div><div style="font-size:22px;font-weight:700;font-family:\'Inter\',sans-serif;letter-spacing:-0.04em;color:'+color+'">'+value+'</div>'+(sub?'<div style="font-size:11px;color:var(--muted);margin-top:2px">'+sub+'</div>':'')+'</div>';};
  const kpis='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'
    +cell('Sales revenue',fmt(saleRevenue),'var(--blue)',marginPct!==null?marginPct+'% sale margin':'')
    +cell('Gross profit',fmt(saleProfit),profColor,'From sales in this month')
    +cell('Refunds',fmt(refundTotal),refundTotal>0?'var(--warn)':'var(--text)',returned.length+' return/refund event'+(returned.length===1?'':'s'))
    +cell('Sold',String(sold.length),'var(--text)',sold.length+' sale'+(sold.length===1?'':'s'))
    +'</div>';

  const renderEvent=function(e){
    const i=e.item,isReturn=!!e.isReturnAdjustment,b=_saleBreakdown(e);
    const p=Number(b.netProfit)||0,refund=isReturn?Math.max(0,-(Number(e.salePrice)||0)):0;
    const lineage=isReturn?'Returned':((Number(e.sale)||1)>=2?'Resold':'Sold');
    const saleReceipts=(Number(b.salePrice)||0)+(Number(b.postage)||0);
    const detail=isReturn
      ?fmt(refund)+' refund <span style="color:var(--muted);font-weight:400">· '+lineage+' '+(e.saleDate||'')+'</span>'
      :fmt(p)+(e.margin!==null&&e.margin!==undefined?' <span style="color:var(--muted);font-weight:400">· '+Number(e.margin).toFixed(1)+'% margin</span>':'')+'<span style="color:var(--muted);font-weight:400"> · '+lineage+' '+(e.saleDate||'')+'</span>';
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openItemDetail(\''+e.month+'\',\''+i.id+'\')"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(i.item)+'</div><div style="font-size:11px;color:'+(isReturn?'var(--warn)':(p>=0?'var(--green)':'var(--red)'))+';margin-top:2px;font-weight:600">'+detail+'</div></div><div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:'+(isReturn?'var(--warn)':'var(--text)')+';flex-shrink:0">'+fmt(isReturn?refund:saleReceipts)+'</div></div>';
  };
  const renderListed=function(i){return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openItemDetail(\''+monthKey+'\',\''+i.id+'\')"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(i.item)+'</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Listed '+(i.dateListed||'—')+'</div></div><div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:var(--text);flex-shrink:0">'+fmt(i.salePrice||0)+'</div></div>';};

  let itemsHTML='';
  if(sold.length)itemsHTML+='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin:14px 0 6px">Sales ('+sold.length+')</div>'+sold.map(renderEvent).join('');
  if(returned.length)itemsHTML+='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin:14px 0 6px">Returns / refunds ('+returned.length+')</div>'+returned.map(renderEvent).join('');
  if(listed.length)itemsHTML+='<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin:14px 0 6px">Listed in '+MONTH_NAMES[keyCode(monthKey)]+' · still active ('+listed.length+') · '+fmt(stockValue)+'</div>'+listed.map(renderListed).join('');
  const navBtn='<button onclick="closePanel();goToMonth(\''+monthKey+'\')" style="width:100%;padding:11px;background:transparent;border:1px solid var(--border);border-radius:8px;color:var(--text-secondary);font-family:\'Inter\',sans-serif;font-size:13px;font-weight:500;cursor:pointer;margin-top:14px;transition:all 0.15s">Open full month view →</button>';
  openPanel(keyName(monthKey),kpis+itemsHTML+navBtn,false);
}
"""
sub_once(r"function showMonthSnapshot\(monthKey\)\{.*?\n\}\n\n// dateRange snapshot for rolling period bars \(day/week buckets\)",month_snapshot+"\n// dateRange snapshot for rolling period bars (day/week buckets)",'month chart drill')

# Rolling chart drill follows the same operational semantics. Accounting reversals
# stay in the engine and full P&L views; this popup never labels one as sale profit.
range_snapshot=r"""function showRangeSnapshot(label, fromDate, toDate){
  const evs=getSaleEventsInRange(fromDate,toDate);
  const saleEvs=evs.filter(function(x){return !x.isReturnAdjustment;});
  const retEvs=evs.filter(function(x){return x.isReturnAdjustment;});
  if(!evs.length){openPanel(label,'<div style="text-align:center;padding:32px 0;color:var(--muted);font-size:14px">No sales or return activity in this period</div>',false);return;}
  let salesRevenue=0,salesProfit=0,refundTotal=0;
  saleEvs.forEach(function(ev){const b=_saleBreakdown(ev);salesRevenue+=(Number(b.salePrice)||0)+(Number(b.postage)||0);salesProfit+=Number(b.netProfit)||0;});
  retEvs.forEach(function(ev){refundTotal+=Math.max(0,-(Number(ev.salePrice)||0));});
  salesRevenue=+salesRevenue.toFixed(2);salesProfit=+salesProfit.toFixed(2);refundTotal=+refundTotal.toFixed(2);
  const margin=salesRevenue>0?(salesProfit/salesRevenue*100).toFixed(1):null,profColor=salesProfit>=0?'var(--green)':'var(--red)';
  const cell=function(label,value,color,sub){return '<div style="background:var(--surface2);border-radius:10px;padding:11px 12px"><div style="font-size:10px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:3px">'+label+'</div><div style="font-size:18px;font-weight:700;font-family:\'Inter\',sans-serif;letter-spacing:-0.04em;color:'+color+'">'+value+'</div>'+(sub?'<div style="font-size:10px;color:var(--muted);margin-top:2px">'+sub+'</div>':'')+'</div>';};
  const kpis='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">'
    +cell('Sales revenue',fmt(salesRevenue),'var(--blue)','Sales made in this period')
    +cell('Gross profit',fmt(salesProfit),profColor,margin?margin+'% sale margin':'From sales only')
    +cell('Refunds',fmt(refundTotal),refundTotal>0?'var(--warn)':'var(--text)',retEvs.length+' return/refund event'+(retEvs.length===1?'':'s'))
    +cell('Sold',String(saleEvs.length),'var(--text)',saleEvs.length+' sale'+(saleEvs.length===1?'':'s'))
    +'</div>';
  const saleRows=saleEvs.slice().sort(function(a,b){return (b.saleDate||'').localeCompare(a.saleDate||'');}).map(function(ev){
    const b=_saleBreakdown(ev),p=Number(b.netProfit)||0,m=(ev.margin!==null&&ev.margin!==undefined)?Number(ev.margin):null,n=Math.max(1,Number(ev.sale)||1),receipts=(Number(b.salePrice)||0)+(Number(b.postage)||0);
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openItemDetail(\''+ev.month+'\',\''+ev.item.id+'\')"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(ev.item.item)+'</div><div style="font-size:11px;color:'+(p>=0?'var(--green)':'var(--red)')+';margin-top:2px;font-weight:600">'+fmt(p)+(m!==null?' <span style="color:var(--muted);font-weight:400">· '+m.toFixed(1)+'% margin</span>':'')+'<span style="color:var(--muted);font-weight:400"> · Sale '+n+' · '+(ev.saleDate||'')+'</span></div></div><div style="font-size:13px;font-weight:600;font-family:var(--font-mono);flex-shrink:0">'+fmt(receipts)+'</div></div>';
  }).join('');
  const retRows=retEvs.slice().sort(function(a,b){return (b.saleDate||'').localeCompare(a.saleDate||'');}).map(function(ev){
    const n=Math.max(1,Number(ev.returnEntry&&ev.returnEntry.saleNo)||1),refund=Math.max(0,-(Number(ev.salePrice)||0));
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="openItemDetail(\''+ev.month+'\',\''+ev.item.id+'\')"><div style="flex:1;min-width:0"><div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(ev.item.item)+'</div><div style="font-size:11px;color:var(--warn);margin-top:2px;font-weight:600">'+fmt(refund)+' refund <span style="color:var(--muted);font-weight:400">· Sale '+n+' return · '+(ev.saleDate||'')+'</span></div></div><div style="font-size:13px;font-weight:600;font-family:var(--font-mono);color:var(--warn);flex-shrink:0">'+fmt(refund)+'</div></div>';
  }).join('');
  openPanel(label,kpis+(saleRows?'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">Sales ('+saleEvs.length+')</div>'+saleRows:'')+(retRows?'<div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin:14px 0 6px">Returns / refunds ('+retEvs.length+')</div>'+retRows:''),false);
}
"""
sub_once(r"function showRangeSnapshot\(label, fromDate, toDate\)\{.*?\n\}\n\nfunction goToMonth\(m\)\{",range_snapshot+"\nfunction goToMonth(m){",'range chart drill')

p.write_text(s)
