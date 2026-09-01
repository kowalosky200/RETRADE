/*
RETRADE REPORTING & EXPORT ENGINE

Owns generated statements and exports only:
- Monthly management statements
- Annual FY management P&L / HMRC working exports
- Stock snapshots
- Custom range reports
- Tax summary CSV
- Excel workbook styling and number formats

Accounting calculations live in accounting.js.
UI, navigation and data-entry behaviour remain in the main app script.
Keep source files LF-normalised.
*/

'use strict';

function downloadAnnualStatement(fyStart){
  const keys=_fyKeys(fyStart);
  const label=_getFYLabel(fyStart);
  const fyFrom0=fyStart+'-04-06', fyTo0=(fyStart+1)+'-04-05';
  const pnl=_buildPnLSummary(fyFrom0,fyTo0,'FY '+label);

  // Rows begin with P&L summary block
  const rows=[];
  pnl.rows.forEach(function(r){rows.push(r);});
  rows.push([]);
  // SA103 tax-return summary + expenses by category
  _buildSA103Rows(pnl).forEach(function(r){rows.push(r);});
  rows.push([]);
  const _byCatA=_expensesByCategoryRows(pnl);
  if(_byCatA.rows.length>2){
    rows.push(['EXPENSES BY CATEGORY']);
    _byCatA.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
  }
  rows.push(['MONTHLY BREAKDOWN']);

  // Monthly summary section
  rows.push(['Month','Revenue (£)','Costs (£)','Gross Profit (£)','Items Sold','Returns','Avg ROI %','Avg Margin %']);
  let totRev=0,totCost=0,totProfit=0,totSold=0,totRet=0,roiSum=0,roiCount=0,marginSum=0,marginCount=0;
  keys.forEach(function(k){
    const ms=calcMonthStatsBySale(k);
    const evs=getSaleEventsInMonth(k);
    const costs=ms.totalRev-ms.realisedProfit;
    const monthROI=ms.avgROI!==null?ms.avgROI.toFixed(1):'';
    const monthMargin=ms.avgMargin!==null&&ms.avgMargin!==undefined?ms.avgMargin.toFixed(1):'';
    if(ms.avgROI!==null){roiSum+=ms.avgROI;roiCount++;}
    if(ms.avgMargin!==null&&ms.avgMargin!==undefined){marginSum+=ms.avgMargin;marginCount++;}
    totRev+=ms.totalRev;totCost+=costs;totProfit+=ms.realisedProfit;
    totSold+=ms.soldCount;totRet+=ms.returnedCount||0;
    rows.push([keyName(k),ms.totalRev.toFixed(2),costs.toFixed(2),ms.realisedProfit.toFixed(2),
      ms.soldCount,ms.returnedCount||0,monthROI,monthMargin]);
  });
  rows.push([]);
  rows.push(['TOTAL FY '+label,totRev.toFixed(2),totCost.toFixed(2),totProfit.toFixed(2),
    totSold,totRet,roiCount>0?(roiSum/roiCount).toFixed(1):'',marginCount>0?(marginSum/marginCount).toFixed(1):'']);

  // Expenses & mileage section for the full FY
  const fyFrom=fyFrom0, fyTo=fyTo0;
  const inFY=function(dateStr){return dateStr&&dateStr>=fyFrom&&dateStr<=fyTo;};
  const fyTrips=(DB.trips||[]).filter(function(t){return inFY(t.date);});
  const fyExps=(DB.expenses||[]).filter(function(e){return inFY(e.date);});

  if(fyTrips.length||fyExps.length){
    rows.push([]);
    rows.push(['EXPENSES & MILEAGE — FY '+label+' — DETAILED']);
    rows.push(_EXPENSE_DETAIL_HEADERS);
    const expBreak=_expandedExpenseRowsCSV(pnl);
    expBreak.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
    rows.push(['EXPENSE TOTAL','','','','','','','','',expBreak.total.toFixed(2)]);
  }

  // Full transaction detail for every sale event in the FY
  if(pnl.events.length){
    rows.push([]);
    rows.push(['SALES — ALL TRANSACTIONS FY '+label]);
    rows.push(_SALE_DETAIL_HEADERS);
    pnl.events.forEach(function(ev){rows.push(_saleDetailRowCSV(ev));});
    let tSale=0,tPostIn=0,tBpf=0,tPromo=0,tShip=0,tPkg=0,tCost=0,tParts=0,tListing=0,tRefund=0,tRP=0,tPartial=0,tPart=0,tTotCosts=0,tNet=0;
    pnl.events.forEach(function(ev){
      const b=_saleBreakdown(ev);
      if(!ev.isReturned)tSale+=b.salePrice;
      tPostIn+=b.postage; tBpf+=b.bpf; tPromo+=b.promoFee;
      tShip+=b.shipping; tPkg+=b.packaging; tCost+=b.itemCost;
      tParts+=b.parts; tListing+=b.listingFee;
      tRefund+=b.returnRefund; tRP+=b.returnPostage; tPartial+=b.partialRefund;
      tPart+=b.partnerSplit; tTotCosts+=b.totalCosts; tNet+=b.netProfit;
    });
    rows.push([]);
    rows.push(['SALES TOTAL','','','','','',
      tSale.toFixed(2),tPostIn.toFixed(2),tBpf.toFixed(2),'',tPromo.toFixed(2),
      tShip.toFixed(2),tPkg.toFixed(2),tCost.toFixed(2),tParts.toFixed(2),tListing.toFixed(2),
      tRefund.toFixed(2),tRP.toFixed(2),tPartial.toFixed(2),tPart.toFixed(2),
      tTotCosts.toFixed(2),tNet.toFixed(2),'','']);
  }

  // Unsold stock sourced in this FY (cash tied up in inventory)
  if(pnl.stock.items.length){
    rows.push([]);
    rows.push(['UNSOLD STOCK SOURCED IN FY '+label]);
    rows.push(['Date Sourced','Item','GID','State','Cost (£)']);
    pnl.stock.items.forEach(function(s){
      const i=s.item;
      rows.push([s.dateSourced||'',(i.item||'').replace(/,/g,' '),i.gid||'',i.state||'',s.cost.toFixed(2)]);
    });
    rows.push([]);
    rows.push(['STOCK COST TIED UP','','','',pnl.stock.cost.toFixed(2)]);
  }

  const csv=_rowsToCsv(rows);
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='RETRADE_FY'+label.replace('/','-')+'_Annual.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);toast('Downloaded FY '+label+' annual statement');
}

// Launch hardening — one CSV encoder for every export. Prefix text cells that
// Excel/Sheets could interpret as formulas (=, +, -, @) while leaving genuine
// numeric values untouched. Quoting is RFC-style and also handles newlines.
function _csvCell(value){
  let s=String(value==null?'':value);
  if(/^[=+\-@]/.test(s))s="'"+s;
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function _rowsToCsv(rows,newline){
  const nl=newline||'\n';
  return rows.map(function(r){return r.map(_csvCell).join(',');}).join(nl);
}
function downloadStockSnapshot(){
  const today=new Date().toISOString().split('T')[0];
  const rows=[['Item','GID','State','Cost (£)','Parts Cost (£)','Total In (£)','Est Sale (£)','Est Profit (£)','Est ROI %','Days Held','Run ID','Source','Month']];
  let hasItems=false;
  const activeLotMemberIds=new Set();
  _activeJobLots().forEach(function(l){_jobLotMembers(l.id,false).forEach(function(x){activeLotMemberIds.add(x.item.id);});});
  allDBKeys().forEach(function(k){
    (DB[k]||[]).forEach(function(i){
      if((i.item||'').trim().toUpperCase()==='MONTH END') return;
      if(i.scrappedAt||activeLotMemberIds.has(i.id))return;
      const inHand=!!i.isReturned||(!i.dateSold&&!i.resaleSalePrice);
      if(!inHand)return;
      hasItems=true;
      const parts=calcPartsCost(i);
      const totalIn=(i.costPrice||0)+parts;
      const ask=i.isReturned?(i.estSalePrice!=null?i.estSalePrice:i.salePrice):(i.estSalePrice!=null?i.estSalePrice:i.salePrice);
      const estP=ask!=null?Number(ask)-(totalIn+(i.shippingCost||0)+(i.packagingCost||0)):'';
      const estROI=estP!==''&&totalIn>0?((estP/totalIn)*100).toFixed(1):'';
      const _fr=i.isReturned?(i.returnHistory||[]).slice().reverse().find(function(r){return r.type==='full_seller'||r.type==='full_ebay';}):null;
      const heldFrom=i.isReturned?((_fr&&_fr.loggedAt)||i.dateSold||i.dateSourced||i.dateListed):(i.dateSourced||i.dateListed);
      const days=heldFrom?daysBetween(heldFrom,today):'';
      rows.push([
        i.item||'',
        i.gid||'',
        i.isReturned?'returned':(i.state==='sourced'?'unlisted':'listed'),
        (i.costPrice||0).toFixed(2),
        parts.toFixed(2),
        totalIn.toFixed(2),
        ask!=null?Number(ask).toFixed(2):'',
        estP!==''?Number(estP).toFixed(2):'',
        estROI,
        days,
        i.sourcingRunId||'',
        i.source||'',
        k
      ]);
    });
  });
  _activeJobLots().forEach(function(lot){
    hasItems=true;
    const totalIn=_jobLotCost(lot.id,false),ask=Number(lot.salePrice)||0;
    const estP=ask>0?_jobLotEstimatedNetProfit(lot):'';
    const estROI=estP!==''&&estP!=null&&totalIn>0?((Number(estP)/totalIn)*100).toFixed(1):'';
    const days=lot.dateCreated?daysBetween(lot.dateCreated,today):'';
    rows.push([lot.name||'Job Lot','JL',lot.status==='listed'?'listed job lot':'unlisted job lot',totalIn.toFixed(2),'0.00',totalIn.toFixed(2),ask>0?ask.toFixed(2):'',estP!==''&&estP!=null?Number(estP).toFixed(2):'',estROI,days,'','Job Lot','JOB LOT']);
  });
  if(!hasItems){toast('No active stock to export','error');return;}
  const csv=_rowsToCsv(rows);
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='RETRADE_Stock_'+today+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);toast('Downloaded stock snapshot');
}

// ── Excel variants of the three download functions ───────────────────────────
function _csvRowsToExcel(rows, sheetName, filename, opts){
  if(!window.XLSX){
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.integrity='sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';s.crossOrigin='anonymous';s.referrerPolicy='no-referrer';
    s.onload=function(){_writeExcel(rows,sheetName,filename,opts);};
    s.onerror=function(){toast('Failed to load Excel library','error');};
    document.head.appendChild(s);
  }else{_writeExcel(rows,sheetName,filename,opts);}
}
// Apply one professional report style to every generated workbook sheet.
// SheetJS CE may ignore some visual style properties in older builds, but the
// structural polish (widths, freeze panes, number formats) still applies; newer
// compatible builds also retain the font/fill styling below.
function _styleReportSheet(ws,rows,opts){
  opts=opts||{}; rows=rows||[];
  if(!ws||!rows.length)return ws;
  const range=ws['!ref']?XLSX.utils.decode_range(ws['!ref']):null;
  if(!range)return ws;
  const headerRows=new Set(opts.headerRows||[]);
  const moneyCols=new Set(opts.moneyCols||[]);
  const pctCols=new Set(opts.pctCols||[]);
  for(let r=range.s.r;r<=range.e.r;r++){
    const label=String((rows[r]&&rows[r][0])==null?'':rows[r][0]).trim();
    const isSection=/^(INCOME|ALLOWABLE EXPENSES|TAXABLE PROFIT|ESTIMATED TAX|SELLING COSTS|OVERHEADS|MEMO|MONTHLY BREAKDOWN|EXPENSES BY CATEGORY|SA103)/i.test(label);
    const isNet=/^NET PROFIT(?: BEFORE TAX)?$/i.test(label)||/^NET PROFIT(?: BEFORE TAX)? \(£\)$/i.test(label)||/^Net profit \/ \(loss\)/i.test(label);
    const isTotal=/^(TOTAL|TOTALS|TOTAL FY|SALES TOTAL|EXPENSE TOTAL|STOCK COST TIED UP|TOTAL ALLOWABLE EXPENSES)/i.test(label);
    for(let c=range.s.c;c<=range.e.c;c++){
      const ref=XLSX.utils.encode_cell({r:r,c:c}),cell=ws[ref]; if(!cell)continue;
      if(headerRows.has(r)){cell.s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'273246'}},alignment:{vertical:'center'}};}
      else if(r===0){cell.s={font:{bold:true,sz:15,color:{rgb:'D4880A'}}};}
      else if(isNet){cell.s={font:{bold:true,sz:12,color:{rgb:'1A7A4A'}},fill:{fgColor:{rgb:'EAF4EE'}},border:{top:{style:'medium',color:{rgb:'1A7A4A'}},bottom:{style:'medium',color:{rgb:'1A7A4A'}}}};}
      else if(isTotal){cell.s={font:{bold:true},fill:{fgColor:{rgb:'F5EBD8'}},border:{top:{style:'thin',color:{rgb:'A09880'}}}};}
      else if(isSection){cell.s={font:{bold:true,color:{rgb:'5A5040'}},fill:{fgColor:{rgb:'F5F0E8'}}};}
      if(typeof cell.v==='number'){
        const _hdr=String((rows[opts.headerRows&&opts.headerRows[0]]||[])[c]||'');
        const _isPctLabel=/(margin|roi|refund rate|rate %|margin %|roi %)/i.test(label)||/%/.test(_hdr)||pctCols.has(c);
        const _isCountLabel=/(^|\b)(items sold|unsold items(?: sourced)?(?: in period)?|returns|sales count|item count|stock count|count)(\b|$)/i.test(label)||/(items sold|returns|count|days held)/i.test(_hdr);
        // Percent values in RETRADE reports are stored as percentage points
        // (e.g. 19.1 means 19.1%), not Excel fractions (0.191). Use a literal
        // percent sign so Excel never turns 19.1 into 1,910%.
        if(_isPctLabel)cell.z='0.0"%"';
        else if(_isCountLabel)cell.z='0';
        else if(moneyCols.has(c)||/£/.test(_hdr))cell.z='£#,##0.00;[Red]-£#,##0.00';
      }
    }
  }
  if(opts.freezeRow!=null)ws['!freeze']={xSplit:0,ySplit:opts.freezeRow};
  if(opts.autoFilterRow!=null)ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:opts.autoFilterRow,c:range.s.c},e:{r:opts.autoFilterRow,c:range.e.c}})};
  return ws;
}
function _writeExcel(rows,sheetName,filename,opts){
  opts=opts||{};
  // Prepend a metadata row so opened files have context — title, generation date, source app
  const today=new Date().toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'});
  const meta=[[opts.title||sheetName],['Exported '+today+' from RETRADE'],[]];
  const allRows=meta.concat(rows);
  const ws=XLSX.utils.aoa_to_sheet(allRows);
  // Auto-width: max char length per column, capped at 40
  const colCount=Math.max.apply(null,allRows.map(r=>r.length));
  const colWidths=[];
  for(let ci=0;ci<colCount;ci++){
    const maxLen=Math.max.apply(null,allRows.map(r=>String(r[ci]==null?'':r[ci]).length));
    colWidths.push({wch:Math.min(40,Math.max(10,maxLen+2))});
  }
  ws['!cols']=colWidths;
  // Freeze the header row (row 4 — after 3 meta rows: title + date + blank)
  ws['!freeze']={xSplit:0,ySplit:4};
  // Header row index in the sheet = 3 (0-indexed)
  const headerRowIdx=3;
  // Bold + bg for header cells
  for(let ci=0;ci<colCount;ci++){
    const cellRef=XLSX.utils.encode_cell({r:headerRowIdx,c:ci});
    if(ws[cellRef]){
      ws[cellRef].s={font:{bold:true,color:{rgb:'FFFFFF'}},fill:{fgColor:{rgb:'2A3340'}},alignment:{horizontal:'left'}};
    }
  }
  // Bold the title row
  const titleRef=XLSX.utils.encode_cell({r:0,c:0});
  if(ws[titleRef])ws[titleRef].s={font:{bold:true,sz:14,color:{rgb:'D4880A'}}};
  const dateRef=XLSX.utils.encode_cell({r:1,c:0});
  if(ws[dateRef])ws[dateRef].s={font:{italic:true,color:{rgb:'888888'},sz:10}};
  // Detect & bold the TOTALS row (last non-empty row matching /^TOTAL/i in col 0)
  for(let ri=allRows.length-1;ri>=0;ri--){
    const v=allRows[ri][0];
    if(typeof v==='string'&&/^TOTAL/i.test(v)){
      for(let ci=0;ci<colCount;ci++){
        const cellRef=XLSX.utils.encode_cell({r:ri,c:ci});
        if(ws[cellRef]){
          ws[cellRef].s={font:{bold:true},fill:{fgColor:{rgb:'F4E4C1'}},border:{top:{style:'thin',color:{rgb:'888888'}}}};
        }
      }
      break;
    }
  }
  _styleReportSheet(ws,allRows,{headerRows:[headerRowIdx],freezeRow:4,autoFilterRow:headerRowIdx});
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,sheetName);
  XLSX.writeFile(wb,filename);
  toast('Downloaded '+filename);
}
function downloadMonthlyExcel(m){
  const events=getSaleEventsInMonth(m);
  if(!events.length){toast('No sales in '+m,'error');return;}

  // Build P&L summary from calendar-month range
  const mYear3=keyYear(m), mIdx3=MONTHS.indexOf(keyCode(m));
  const _pad3=function(n){return(n<10?'0':'')+n;};
  const mFrom3=mYear3+'-'+_pad3(mIdx3+1)+'-01';
  const _last3=new Date(mYear3,mIdx3+1,0).getDate();
  const mTo3=mYear3+'-'+_pad3(mIdx3+1)+'-'+_pad3(_last3);
  const pnl=_buildPnLSummary(mFrom3,mTo3,keyName(m));

  const summaryRows=_pnlSummarySheetRows(pnl,'Profit & Loss — '+keyName(m));

  // Sales — full transaction breakdown
  const salesRows=[_SALE_DETAIL_HEADERS.slice()];
  let tSale=0,tPostIn=0,tBpf=0,tPromo=0,tShip=0,tPkg=0,tCost=0,tParts=0,tListing=0,tRefund=0,tRP=0,tPartial=0,tPart=0,tTotCosts=0,tNet=0;
  events.forEach(function(ev){
    salesRows.push(_saleDetailRow(ev,false));
    const b=_saleBreakdown(ev);
    if(!ev.isReturned)tSale+=b.salePrice;
    tPostIn+=b.postage; tBpf+=b.bpf; tPromo+=b.promoFee;
    tShip+=b.shipping; tPkg+=b.packaging; tCost+=b.itemCost;
    tParts+=b.parts; tListing+=b.listingFee;
    tRefund+=b.returnRefund; tRP+=b.returnPostage; tPartial+=b.partialRefund;
    tPart+=b.partnerSplit; tTotCosts+=b.totalCosts; tNet+=b.netProfit;
  });
  salesRows.push([]);
  salesRows.push(['TOTALS','','','','','',
    +tSale.toFixed(2),+tPostIn.toFixed(2),+tBpf.toFixed(2),'',+tPromo.toFixed(2),
    +tShip.toFixed(2),+tPkg.toFixed(2),+tCost.toFixed(2),+tParts.toFixed(2),+tListing.toFixed(2),
    +tRefund.toFixed(2),+tRP.toFixed(2),+tPartial.toFixed(2),+tPart.toFixed(2),
    +tTotCosts.toFixed(2),+tNet.toFixed(2),'','']);

  // Expenses sheet — trip sub-expenses expanded, "what for" preserved
  const expBreak=_expandedExpenseRows(pnl);
  const expRows=[_EXPENSE_DETAIL_HEADERS.slice()].concat(expBreak.rows);
  if(expBreak.rows.length){expRows.push([]);expRows.push(['TOTAL','','','','','','','','',+expBreak.total.toFixed(2)]);}

  // Build multi-sheet workbook
  if(!window.XLSX){
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.integrity='sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';s.crossOrigin='anonymous';s.referrerPolicy='no-referrer';
    s.onload=function(){_writeMonthlyExcelBook(m,salesRows,expRows,summaryRows,pnl);};
    s.onerror=function(){toast('Failed to load Excel library','error');};
    document.head.appendChild(s);
  }else{_writeMonthlyExcelBook(m,salesRows,expRows,summaryRows,pnl);}
}
function _writeMonthlyExcelBook(m,salesRows,expRows,summaryRows,pnl){
  const today=new Date().toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'});
  const wb=XLSX.utils.book_new();
  const meta=[['Monthly Statement — '+keyName(m)],['Exported '+today+' from RETRADE'],[]];
  // Sheet 0 — P&L summary (only if we were passed one; older callers still work)
  if(summaryRows&&summaryRows.length){
    const ws0=XLSX.utils.aoa_to_sheet(summaryRows);
    ws0['!cols']=[{wch:52},{wch:16}];
    _styleReportSheet(ws0,summaryRows,{headerRows:[3],freezeRow:4,moneyCols:[1]});
    XLSX.utils.book_append_sheet(wb,ws0,'P&L Summary');
  }
  if(pnl){
    // Calendar-month exports are management statements, not HMRC filing periods.
    // Do not include an SA103 sheet here: the dedicated Tax/FY export owns the
    // cash-basis working and prevents sale-matched management COGS leaking into tax.
    const bc=_expensesByCategoryRows(pnl).rows;
    if(bc.length>2){
      const wsBC=XLSX.utils.aoa_to_sheet(bc);
      wsBC['!cols']=[{wch:34},{wch:12},{wch:14},{wch:14}];
      _styleReportSheet(wsBC,bc,{headerRows:[2],freezeRow:3,moneyCols:[3]});
      XLSX.utils.book_append_sheet(wb,wsBC,'Expenses by Category');
    }
  }
  const salesAll=meta.concat(salesRows);
  const ws1=XLSX.utils.aoa_to_sheet(salesAll);
  ws1['!cols']=salesAll[0]?salesAll[0].map(function(){return{wch:18};}):[];
  _styleReportSheet(ws1,salesAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,10,11,12,13,14,15,16,17,18,19,20,21]});
  XLSX.utils.book_append_sheet(wb,ws1,'Sales');
  if(expRows.length>1){
    const expAll=meta.concat(expRows);
    const ws2=XLSX.utils.aoa_to_sheet(expAll);
    ws2['!cols']=expAll[0]?expAll[0].map(function(){return{wch:20};}):[];
    _styleReportSheet(ws2,expAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,9]});
    XLSX.utils.book_append_sheet(wb,ws2,'Expenses & Mileage');
  }
  // Unsold stock sourced in period
  if(pnl&&pnl.stock&&pnl.stock.items&&pnl.stock.items.length){
    const stockRows=[['Date Sourced','Item','GID','State','Cost (£)']];
    pnl.stock.items.forEach(function(s){
      stockRows.push([s.dateSourced||'',s.item.item||'',s.item.gid||'',s.item.state||'',s.cost]);
    });
    stockRows.push([]);
    stockRows.push(['TOTAL','','','',pnl.stock.cost]);
    const _stockAll=meta.concat(stockRows);
    const ws3=XLSX.utils.aoa_to_sheet(_stockAll);
    ws3['!cols']=[{wch:14},{wch:36},{wch:12},{wch:12},{wch:14}];
    _styleReportSheet(ws3,_stockAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[4]});
    XLSX.utils.book_append_sheet(wb,ws3,'Stock Tied Up');
  }
  const filename='RETRADE_'+m+'_Statement.xlsx';
  XLSX.writeFile(wb,filename);
  toast('Downloaded '+filename);
}
function downloadAnnualExcel(fyStart){
  const keys=_fyKeys(fyStart);
  const label=_getFYLabel(fyStart);
  const fyFrom0=fyStart+'-04-06', fyTo0=(fyStart+1)+'-04-05';
  const pnl=_buildPnLSummary(fyFrom0,fyTo0,'FY '+label);

  const summaryRows=_pnlSummarySheetRows(pnl,'Annual Profit & Loss — FY '+label);

  const salesRows=[['Month','Revenue (£)','Costs (£)','Gross Profit (£)','Items Sold','Returns','Avg ROI %','Avg Margin %']];
  let totRev=0,totCost=0,totProfit=0,totSold=0,totRet=0,roiSum=0,roiCount=0,marginSum=0,marginCount=0;
  keys.forEach(function(k){
    const ms=calcMonthStatsBySale(k);
    const costs=ms.totalRev-ms.realisedProfit;
    if(ms.avgROI!==null){roiSum+=ms.avgROI;roiCount++;}
    if(ms.avgMargin!==null&&ms.avgMargin!==undefined){marginSum+=ms.avgMargin;marginCount++;}
    totRev+=ms.totalRev;totCost+=costs;totProfit+=ms.realisedProfit;
    totSold+=ms.soldCount;totRet+=ms.returnedCount||0;
    salesRows.push([keyName(k),ms.totalRev,costs,ms.realisedProfit,ms.soldCount,ms.returnedCount||0,ms.avgROI!=null?Number(ms.avgROI.toFixed(1)):0,ms.avgMargin!=null?Number(ms.avgMargin.toFixed(1)):0]);
  });
  salesRows.push([]);
  salesRows.push(['TOTAL FY '+label,totRev,totCost,totProfit,totSold,totRet,roiCount>0?Number((roiSum/roiCount).toFixed(1)):0,marginCount>0?Number((marginSum/marginCount).toFixed(1)):0]);

  // Expenses sheet — detailed, trip sub-expenses expanded
  const fyFrom=fyFrom0, fyTo=fyTo0;
  const expBreak=_expandedExpenseRows(pnl);
  const expRows=[_EXPENSE_DETAIL_HEADERS.slice()].concat(expBreak.rows);
  if(expBreak.rows.length){expRows.push([]);expRows.push(['TOTAL','','','','','','','','',+expBreak.total.toFixed(2)]);}

  // Sales Detail sheet — every transaction with full economic breakdown
  const salesDetailRows=[_SALE_DETAIL_HEADERS.slice()];
  let dtSale=0,dtPostIn=0,dtBpf=0,dtPromo=0,dtShip=0,dtPkg=0,dtCost=0,dtParts=0,dtListing=0,dtRefund=0,dtRP=0,dtPartial=0,dtPart=0,dtTotCosts=0,dtNet=0;
  pnl.events.forEach(function(ev){
    salesDetailRows.push(_saleDetailRow(ev,false));
    const b=_saleBreakdown(ev);
    if(!ev.isReturned)dtSale+=b.salePrice;
    dtPostIn+=b.postage; dtBpf+=b.bpf; dtPromo+=b.promoFee;
    dtShip+=b.shipping; dtPkg+=b.packaging; dtCost+=b.itemCost;
    dtParts+=b.parts; dtListing+=b.listingFee;
    dtRefund+=b.returnRefund; dtRP+=b.returnPostage; dtPartial+=b.partialRefund;
    dtPart+=b.partnerSplit; dtTotCosts+=b.totalCosts; dtNet+=b.netProfit;
  });
  if(pnl.events.length){
    salesDetailRows.push([]);
    salesDetailRows.push(['TOTALS','','','','','',
      +dtSale.toFixed(2),+dtPostIn.toFixed(2),+dtBpf.toFixed(2),'',+dtPromo.toFixed(2),
      +dtShip.toFixed(2),+dtPkg.toFixed(2),+dtCost.toFixed(2),+dtParts.toFixed(2),+dtListing.toFixed(2),
      +dtRefund.toFixed(2),+dtRP.toFixed(2),+dtPartial.toFixed(2),+dtPart.toFixed(2),
      +dtTotCosts.toFixed(2),+dtNet.toFixed(2),'','']);
  }

  if(!window.XLSX){
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.integrity='sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';s.crossOrigin='anonymous';s.referrerPolicy='no-referrer';
    s.onload=function(){_writeAnnualExcelBook(fyStart,label,salesRows,expRows,summaryRows,pnl,salesDetailRows);};
    s.onerror=function(){toast('Failed to load Excel library','error');};
    document.head.appendChild(s);
  }else{_writeAnnualExcelBook(fyStart,label,salesRows,expRows,summaryRows,pnl,salesDetailRows);}
}
function _writeAnnualExcelBook(fyStart,label,salesRows,expRows,summaryRows,pnl,salesDetailRows){
  const today=new Date().toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'});
  const wb=XLSX.utils.book_new();
  const meta=[['Annual P&L Summary — FY '+label],['Exported '+today+' from RETRADE'],[]];
  // Sheet 0 — P&L summary (only if we were passed one; older callers still work)
  if(summaryRows&&summaryRows.length){
    const ws0=XLSX.utils.aoa_to_sheet(summaryRows);
    ws0['!cols']=[{wch:52},{wch:16}];
    _styleReportSheet(ws0,summaryRows,{headerRows:[3],freezeRow:4,moneyCols:[1]});
    XLSX.utils.book_append_sheet(wb,ws0,'P&L Summary');
  }
  if(pnl){
    const wsSA=XLSX.utils.aoa_to_sheet(_buildSA103Rows(pnl));
    wsSA['!cols']=[{wch:12},{wch:52},{wch:16},{wch:20}];
    _styleReportSheet(wsSA,_buildSA103Rows(pnl),{headerRows:[4],freezeRow:5,moneyCols:[2,3]});
    // HMRC filing column is deliberately whole pounds; the Books column retains pence.
    if(wsSA['!ref']){const _rg=XLSX.utils.decode_range(wsSA['!ref']);for(let _r=_rg.s.r;_r<=_rg.e.r;_r++){const _c=wsSA[XLSX.utils.encode_cell({r:_r,c:3})];if(_c&&typeof _c.v==='number')_c.z='£#,##0;[Red]-£#,##0';}}
    XLSX.utils.book_append_sheet(wb,wsSA,'SA103 Tax Summary');
    const bc=_expensesByCategoryRows(pnl).rows;
    if(bc.length>2){
      const wsBC=XLSX.utils.aoa_to_sheet(bc);
      wsBC['!cols']=[{wch:34},{wch:12},{wch:14},{wch:14}];
      _styleReportSheet(wsBC,bc,{headerRows:[2],freezeRow:3,moneyCols:[3]});
      XLSX.utils.book_append_sheet(wb,wsBC,'Expenses by Category');
    }
  }
  const rollupAll=meta.concat(salesRows);
  const ws1=XLSX.utils.aoa_to_sheet(rollupAll);
  ws1['!cols']=salesRows[0]?salesRows[0].map(function(){return{wch:18};}):[];
  _styleReportSheet(ws1,rollupAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[1,2,3]});
  XLSX.utils.book_append_sheet(wb,ws1,'Monthly Rollup');
  // Full transaction detail sheet
  if(salesDetailRows&&salesDetailRows.length>1){
    const detailAll=meta.concat(salesDetailRows);
    const wsD=XLSX.utils.aoa_to_sheet(detailAll);
    wsD['!cols']=salesDetailRows[0].map(function(){return{wch:14};});
    _styleReportSheet(wsD,detailAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,10,11,12,13,14,15,16,17,18,19,20,21]});
    XLSX.utils.book_append_sheet(wb,wsD,'Sales Detail');
  }
  if(expRows.length>1){
    const _expAll=meta.concat(expRows);
    const ws2=XLSX.utils.aoa_to_sheet(_expAll);
    ws2['!cols']=expRows[0]?expRows[0].map(function(){return{wch:20};}):[];
    _styleReportSheet(ws2,_expAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,9]});
    XLSX.utils.book_append_sheet(wb,ws2,'Expenses & Mileage');
  }
  // Unsold stock sourced in FY
  if(pnl&&pnl.stock&&pnl.stock.items&&pnl.stock.items.length){
    const stockRows=[['Date Sourced','Item','GID','State','Cost (£)']];
    pnl.stock.items.forEach(function(s){
      stockRows.push([s.dateSourced||'',s.item.item||'',s.item.gid||'',s.item.state||'',s.cost]);
    });
    stockRows.push([]);
    stockRows.push(['TOTAL','','','',pnl.stock.cost]);
    const _stockAll=meta.concat(stockRows);
    const ws3=XLSX.utils.aoa_to_sheet(_stockAll);
    ws3['!cols']=[{wch:14},{wch:36},{wch:12},{wch:12},{wch:14}];
    _styleReportSheet(ws3,_stockAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[4]});
    XLSX.utils.book_append_sheet(wb,ws3,'Stock Tied Up');
  }
  const filename='RETRADE_FY'+label.replace('/','-')+'_Annual.xlsx';
  XLSX.writeFile(wb,filename);
  toast('Downloaded '+filename);
}
function downloadStockExcel(){
  const today=new Date().toISOString().split('T')[0];
  const rows=[['Item','GID','State','Cost (£)','Parts Cost (£)','Total In (£)','Est Sale (£)','Est Profit (£)','Est ROI %','Days Held','Run ID','Source','Month']];
  let hasItems=false;
  const activeLotMemberIds=new Set();
  _activeJobLots().forEach(function(l){_jobLotMembers(l.id,false).forEach(function(x){activeLotMemberIds.add(x.item.id);});});
  allDBKeys().forEach(function(k){
    (DB[k]||[]).forEach(function(i){
      if((i.item||'').trim().toUpperCase()==='MONTH END')return;
      if(i.scrappedAt||activeLotMemberIds.has(i.id))return;
      const inHand=!!i.isReturned||(!i.dateSold&&!i.resaleSalePrice);
      if(!inHand)return;
      hasItems=true;
      const parts=calcPartsCost(i);
      const totalIn=(i.costPrice||0)+parts;
      const ask=i.isReturned?(i.estSalePrice!=null?i.estSalePrice:i.salePrice):(i.estSalePrice!=null?i.estSalePrice:i.salePrice);
      const estP=ask!=null?Number(ask)-(totalIn+(i.shippingCost||0)+(i.packagingCost||0)):null;
      const estROI=estP!=null&&totalIn>0?Number(((estP/totalIn)*100).toFixed(1)):null;
      const _fr=i.isReturned?(i.returnHistory||[]).slice().reverse().find(function(r){return r.type==='full_seller'||r.type==='full_ebay';}):null;
      const heldFrom=i.isReturned?((_fr&&_fr.loggedAt)||i.dateSold||i.dateSourced||i.dateListed):(i.dateSourced||i.dateListed);
      const days=heldFrom?daysBetween(heldFrom,today):null;
      rows.push([i.item||'',i.gid||'',i.isReturned?'returned':(i.state==='sourced'?'unlisted':'listed'),
        i.costPrice||0,parts,totalIn,
        ask!=null?Number(ask):'',estP!=null?Number(estP.toFixed(2)):'',estROI!=null?estROI:'',days!=null?days:'',
        i.sourcingRunId||'',i.source||'',k]);
    });
  });
  // Match the CSV snapshot: an active Job Lot is one operational stock row;
  // its child items are suppressed above so inventory is never double-counted.
  _activeJobLots().forEach(function(lot){
    hasItems=true;
    const totalIn=_jobLotCost(lot.id,false),ask=Number(lot.salePrice)||0;
    const estP=ask>0?_jobLotEstimatedNetProfit(lot):null;
    const estROI=estP!=null&&totalIn>0?Number(((Number(estP)/totalIn)*100).toFixed(1)):null;
    const days=lot.dateCreated?daysBetween(lot.dateCreated,today):null;
    rows.push([lot.name||'Job Lot','JL',lot.status==='listed'?'listed job lot':'unlisted job lot',totalIn,0,totalIn,
      ask>0?ask:'',estP!=null?Number(estP.toFixed(2)):'',estROI!=null?estROI:'',days!=null?days:'','','Job Lot','JOB LOT']);
  });
  if(!hasItems){toast('No active stock to export','error');return;}
  _csvRowsToExcel(rows,'Stock','RETRADE_Stock_'+today+'.xlsx',{title:'Stock Snapshot — '+today});
}

function downloadMonthlyStatement(m){
  const events=getSaleEventsInMonth(m);
  if(!events.length){toast('No sales in '+m,'error');return;}

  // ── P&L Summary block (built from calendar-month range) ──
  const mYear2=keyYear(m), mIdx2=MONTHS.indexOf(keyCode(m));
  const _pad=function(n){return(n<10?'0':'')+n;};
  const mFrom=mYear2+'-'+_pad(mIdx2+1)+'-01';
  const _last=new Date(mYear2,mIdx2+1,0).getDate();
  const mTo=mYear2+'-'+_pad(mIdx2+1)+'-'+_pad(_last);
  const pnl=_buildPnLSummary(mFrom,mTo,keyName(m));

  // Sales section — full transaction breakdown
  const rows=[];
  pnl.rows.forEach(function(r){rows.push(r);});
  rows.push([]);
  // SA103 tax-return summary + expenses by category
  _buildSA103Rows(pnl).forEach(function(r){rows.push(r);});
  rows.push([]);
  const _byCatM=_expensesByCategoryRows(pnl);
  if(_byCatM.rows.length>2){
    rows.push(['EXPENSES BY CATEGORY']);
    _byCatM.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
  }
  rows.push(['SALES — TRANSACTION BREAKDOWN']);
  rows.push(_SALE_DETAIL_HEADERS);
  events.forEach(function(ev){rows.push(_saleDetailRowCSV(ev));});
  // Totals across every numeric column
  let tSale=0,tPostIn=0,tBpf=0,tPromo=0,tShip=0,tPkg=0,tCost=0,tParts=0,tListing=0,tRefund=0,tRP=0,tPartial=0,tPart=0,tTotCosts=0,tNet=0;
  events.forEach(function(ev){
    const b=_saleBreakdown(ev);
    if(!ev.isReturned)tSale+=b.salePrice;
    tPostIn+=b.postage; tBpf+=b.bpf; tPromo+=b.promoFee;
    tShip+=b.shipping; tPkg+=b.packaging; tCost+=b.itemCost;
    tParts+=b.parts; tListing+=b.listingFee;
    tRefund+=b.returnRefund; tRP+=b.returnPostage; tPartial+=b.partialRefund;
    tPart+=b.partnerSplit; tTotCosts+=b.totalCosts; tNet+=b.netProfit;
  });
  rows.push([]);
  rows.push(['TOTALS','','','','','',
    tSale.toFixed(2),tPostIn.toFixed(2),tBpf.toFixed(2),'',tPromo.toFixed(2),
    tShip.toFixed(2),tPkg.toFixed(2),tCost.toFixed(2),tParts.toFixed(2),tListing.toFixed(2),
    tRefund.toFixed(2),tRP.toFixed(2),tPartial.toFixed(2),tPart.toFixed(2),
    tTotCosts.toFixed(2),tNet.toFixed(2),'','']);

  // Expenses section — detailed breakdown with trip sub-expenses expanded
  if(pnl.expenses.trips.length||pnl.expenses.expenses.length){
    rows.push([]);
    rows.push(['EXPENSES & MILEAGE — DETAILED']);
    rows.push(_EXPENSE_DETAIL_HEADERS);
    const expBreak=_expandedExpenseRowsCSV(pnl);
    expBreak.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
    rows.push(['EXPENSE TOTAL','','','','','','','','',expBreak.total.toFixed(2)]);
  }

  // Unsold stock sourced in this month (money out that hasn't come back yet)
  if(pnl.stock.items.length){
    rows.push([]);
    rows.push(['UNSOLD STOCK SOURCED IN PERIOD']);
    rows.push(['Date Sourced','Item','GID','State','Cost (£)']);
    pnl.stock.items.forEach(function(s){
      const i=s.item;
      rows.push([s.dateSourced||'',(i.item||'').replace(/,/g,' '),i.gid||'',i.state||'',s.cost.toFixed(2)]);
    });
    rows.push([]);
    rows.push(['STOCK COST TIED UP','','','',pnl.stock.cost.toFixed(2)]);
  }

  const csv=_rowsToCsv(rows);
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='RETRADE_'+m+'_Statement.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);toast('Downloaded '+m+' statement');
}
function downloadTaxSummary(){
  const d=window._taxExportData;
  if(!d){toast('Open the Tax page first');return;}
  const money=n=>(n<0?'-':'')+'£'+Math.abs(+n||0).toFixed(2);
  const rows=[];
  rows.push(['RETRADE — Self Assessment summary']);
  rows.push(['Tax year',d.year]);
  rows.push(['Generated',new Date().toLocaleString('en-GB')]);
  rows.push(['Method',d.method]);
  rows.push(['Tax region',d.taxRegion==='scotland'?'Scotland':'England, Wales & Northern Ireland']);
  rows.push([]);
  rows.push(['INCOME']);
  rows.push(['Turnover / gross receipts',money(d.box15)]);
  if((d.otherBusinessIncome||0)>0)rows.push(['Other business income',money(d.otherBusinessIncome)]);
  rows.push(['Number of sales',d.saleCount]);
  rows.push([]);
  rows.push(['ALLOWABLE EXPENSES']);
  d.expenseLines.filter(r=>r[1]>0).forEach(r=>rows.push([r[0],money(r[1])]));
  rows.push([d.method.indexOf('Trading')===0?'Trading income allowance':'Total allowable expenses',money(d.box16)]);
  rows.push([]);
  rows.push(['TAXABLE PROFIT — HMRC CASH BASIS']);
  rows.push(['Taxable profit / (loss)',money(d.box23)]);
  rows.push([]);
  rows.push(['ESTIMATED TAX (self-employment'+(d.otherIncome>0?' + £'+(+d.otherIncome).toFixed(0)+' other income':'')+')']);
  rows.push(['Income Tax',money(d.incomeTax)]);
  rows.push(['Class 2 NI',money(d.class2)]);
  rows.push(['Class 4 NI',money(d.class4)]);
  rows.push(['Total estimated tax',money(d.totalTax)]);
  rows.push([]);
  rows.push(['For reference only — verify with a qualified accountant before filing.']);
  const csv=_rowsToCsv(rows,'\r\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='RETRADE_Tax_'+d.year.replace('/','-')+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast('Tax summary downloaded');
}
// Update the user's other (employment) income used to stack the SE estimate, then re-render.
function _saleDetailRow(ev,forCSV){
  const i=ev.item;
  const b=_saleBreakdown(ev);
  const roi=ev.roi!=null?ev.roi:0;
  const margin=ev.margin!=null?ev.margin:0;
  const status=ev.isReturned?'Returned':((Math.max(1,Number(ev.sale)||1)>=2)?'Resold':'Sold');
  const itemName=forCSV?(i.item||'').replace(/,/g,' '):(i.item||'');
  return[
    ev.saleDate||'',b.saleNo,itemName,i.gid||'',b.platform,status,
    b.salePrice,b.postage,b.bpf,b.promoPct,b.promoFee,
    b.shipping,b.packaging,b.itemCost,b.parts,b.listingFee,
    b.returnRefund,b.returnPostage,b.partialRefund,b.partnerSplit,
    b.totalCosts,b.netProfit,
    forCSV?(roi.toFixed(1)+'%'):+roi.toFixed(1),
    forCSV?(margin.toFixed(1)+'%'):+margin.toFixed(1)
  ];
}
function _saleDetailRowCSV(ev){
  return _saleDetailRow(ev,true).map(function(v){return typeof v==='number'?v.toFixed(2):v;});
}

// Column set for expense detail — trip sub-expenses broken out as separate rows.
const _EXPENSE_DETAIL_HEADERS=[
  'Date','Type','Description','Category','Trip / Linked','Miles','HMRC Rate (£/mi)','Mileage Cost (£)','Amount (£)','Total (£)'
];
function _expandedExpenseRows(pnl){
  const rows=[];
  let total=0;
  (pnl.expenses.trips||[]).forEach(function(t){
    const miles=t.mileage||0, rate=t.ratePerMile||0.45;
    const mileageCost=+(miles*rate).toFixed(2);
    total+=mileageCost;
    rows.push([t.date||'','Mileage',(t.description||'Sourcing trip'),'Mileage',(t.description||''),
      miles,+rate.toFixed(2),mileageCost,'',mileageCost]);
    // Break out each sub-expense on this trip as its own row so "what for" is visible
    (Array.isArray(t.expenses)?t.expenses:[]).forEach(function(e){
      const amt=+((e.amount||0)).toFixed(2);
      total+=amt;
      rows.push([e.date||t.date||'','Trip expense',(e.description||'Sub-expense'),(e.category||'Trip cost'),(t.description||''),
        '','','',amt,amt]);
    });
  });
  (pnl.expenses.expenses||[]).forEach(function(e){
    const amt=+((e.amount||0)).toFixed(2);
    total+=amt;
    rows.push([e.date||'','Expense',(e.description||'Expense'),(e.category||''),'',
      '','','',amt,amt]);
  });
  return{rows:rows,total:+total.toFixed(2)};
}
function _expandedExpenseRowsCSV(pnl){
  const r=_expandedExpenseRows(pnl);
  const out=r.rows.map(function(row){
    return row.map(function(v,idx){
      if(typeof v==='number')return v.toFixed(2);
      return String(v||'').replace(/,/g,' ');
    });
  });
  return{rows:out,total:r.total};
}

// Builds the standard P&L summary block for any date range. Returns
// {rows, revenue, cogs, grossProfit, expenses, netProfit, stockCost, cashPosition}
// so callers can either splice `rows` into their output or reuse the numbers.
// Multi-tier P&L for any date range, built the way an accountant would lay out
// a sole-trader profit & loss account:
//
//   Turnover (gross receipts)
//     − Cost of goods sold  (Box 17: item cost + parts only)      ← calcCOGSOnly basis
//   = GROSS PROFIT
//     − Selling costs       (platform fees, promo, postage,
//                            packaging, advertising, returns,
//                            partner splits)
//   = OPERATING PROFIT (contribution)
//     − Overheads           (motor/mileage, rent, repairs, phone,
//                            software, professional fees, other)
//   = NET PROFIT BEFORE TAX
//
// Fees/postage/packaging are treated as SELLING COSTS below gross profit
// (Option B), which is the standard accounting shape. calcGrossProfit is
// unchanged — this view aggregates the per-sale component breakdown instead.
//
// Returns a rich object: legacy keys (rows/revenue/cogs/grossProfit/expenses/
// stock/netProfit/cashPosition/soldCount/returnCount/events) are all preserved
// so existing callers keep working; new keys (selling/overheads/operatingProfit/
// margins/sa103/byCategory/mileage/motorDoubleClaim) drive the new reporting.

// HMRC cash-basis bridge. The operational P&L deliberately matches stock cost to
// the sale/return lifecycle; HMRC cash basis instead recognises income when
// received and expenses when actually paid. This wrapper keeps those two useful
// views separate instead of labelling the management P&L as cash basis.

// Builds the SA103 tax-return summary block for an export: one row per HMRC
// expense box that actually has a value, plus turnover, total allowable
// expenses, and net profit — ready to type straight onto SA103F, or summed
// into the single SA103S box-20 figure. Returns an array of CSV/Excel rows.
function _buildSA103Rows(pnl){
  // SA103 rows are only meaningful on a UK tax-year range. Rebuild using the
  // cash-basis bridge so management COGS timing cannot leak into HMRC figures.
  if(pnl&&/^\d{4}-04-06$/.test(pnl.from||'')&&/^\d{4}-04-05$/.test(pnl.to||''))pnl=_buildTaxCashSummary(pnl.from,pnl.to,pnl.label);
  const boxes=[17,20,21,22,23,24,25,26,28,30];
  const rows=[];
  const incomeWhole=function(v){return Math.floor(Math.max(0,Number(v)||0));};
  const expenseWhole=function(v){return Math.ceil(Math.max(0,Number(v)||0));};
  rows.push(['SA103 TAX RETURN SUMMARY (cash basis)']);
  rows.push(['Books retain pence. HMRC filing column shows whole-pound entry values: income rounded down; expenses/reliefs rounded up.']);
  rows.push(['Latest published SA103 layout: turnover below £90,000 can use SA103S; total allowable expenses may be entered in short-form box 20.']);
  rows.push([]);
  rows.push(['SA103F Box','Heading','Books (£)','HMRC filing (£ whole)']);
  const turnover=Number(pnl.revenue)||0;
  const otherIncome=Number(pnl.otherBusinessIncome)||0;
  rows.push(['15 / S9','Turnover / gross receipts',turnover,incomeWhole(turnover)]);
  if(otherIncome>0)rows.push(['16 / S10','Other business income (e.g. supplier refunds)',otherIncome,incomeWhole(otherIncome)]);
  rows.push([]);
  let totalExp=0;
  boxes.forEach(function(bx){
    let amt=0;
    if(bx===17){amt=(pnl.box17!=null?pnl.box17:pnl.cogs);}
    else{amt=pnl.byBox[bx]||0;}
    if(bx===17||amt>0){
      amt=Number(amt)||0;
      rows.push([String(bx),SA103_BOX_LABELS[bx]||('Box '+bx),amt,expenseWhole(amt)]);
      totalExp+=amt;
    }
  });
  totalExp=+totalExp.toFixed(2);
  const filingIncome=incomeWhole(turnover)+incomeWhole(otherIncome);
  const filingExpenses=expenseWhole(totalExp);
  const filingProfit=Math.max(0,filingIncome-filingExpenses);
  const filingLoss=Math.max(0,filingExpenses-filingIncome);
  rows.push([]);
  rows.push(['','TOTAL ALLOWABLE EXPENSES',totalExp,filingExpenses]);
  rows.push(['','  → SA103S (short form) box 20 single figure',totalExp,filingExpenses]);
  rows.push([]);
  rows.push([pnl.netProfit>=0?'47 / S21':'48 / S22',pnl.netProfit>=0?'Net profit':'Net loss',Math.abs(Number(pnl.netProfit)||0),pnl.netProfit>=0?filingProfit:filingLoss]);
  rows.push(['76 / S31','Total taxable profit (before any personal loss/capital-allowance adjustments)',Math.max(0,Number(pnl.netProfit)||0),filingProfit]);
  if(pnl.mileage.miles>0){
    rows.push([]);
    rows.push(['Mileage note',pnl.mileage.miles+' business miles claimed at HMRC simplified rates','','']);
  }
  if(pnl.motorDoubleClaim){
    rows.push([]);
    rows.push(['Motor method',(pnl.motorMethod==='actual'?'Actual motor costs':'Simplified mileage')+' applied — '+pnl.motorExcludedLabel+' ('+pnl.motorExcluded.toFixed(2)+') excluded (one method per vehicle).','','']);
  }
  rows.push([]);
  rows.push(['Disclaimer','Prepared on a cash basis as a record-keeping aid. Review against the current HMRC return before filing. This is not tax advice.','','']);
  return rows;
}

// Manual + mileage expenses grouped by category with subtotals, for the
// "expenses broken out" block in statements. Returns {rows,total}.
function _expensesByCategoryRows(pnl){
  const rows=[];
  const cats=Object.keys(pnl.byCategory).map(function(k){return pnl.byCategory[k];});
  // Order: selling first then overhead, then by box within bucket
  cats.sort(function(a,b){
    if(a.bucket!==b.bucket)return a.bucket==='selling'?-1:1;
    return a.box-b.box;
  });
  rows.push(['Logged expenses & mileage by category']);
  rows.push(['(Per-sale platform fees & postage are shown in the sales breakdown, not here)']);
  rows.push(['Category','SA103 Box','Bucket','Amount (£)']);
  let total=0;
  cats.forEach(function(c){
    const label=c.isMileage?(c.label+' ('+c.miles+' mi)'):c.label;
    rows.push([label,'Box '+c.box,c.bucket==='selling'?'Selling cost':'Overhead',c.amount.toFixed(2)]);
    total+=c.amount;
  });
  rows.push(['TOTAL','','',total.toFixed(2)]);
  return{rows:rows,total:+total.toFixed(2)};
}

// Shared multi-tier P&L summary rows for Excel export (numeric values so cells
// format as numbers). Used by range, monthly and annual Excel generators.
function _pnlSummarySheetRows(pnl,title){
  const rows=[
    [title],
    ['Basis: management P&L — sale-matched stock costs'],[],
    ['Line','Value (£)'],
    ['Turnover — gross receipts',pnl.revenue],
    ['  of which: goods',pnl.goodsRev],
    ['  of which: postage recharged to buyers',pnl.postageIn],
    ['Less: Cost of goods sold (Box 17)',pnl.cogs],
    ['GROSS PROFIT',pnl.grossProfit],
    ['Gross margin %',pnl.grossMargin],
    [],
    ['Selling costs',''],
    ['  Platform & payment fees (Box 26)',(pnl.selling.platformFees!=null?pnl.selling.platformFees:pnl.selling.fees)],
    ['  Listing fees (Box 26)',pnl.selling.listingFees||0],
    ['  Postage & packaging on sales (Box 23)',pnl.selling.postPkg],
    ['  Advertising & marketing (Box 24)',(pnl.byCategory['Advertising & marketing']||{}).amount||0],
    ['  Other selling costs',+Math.max(0,(pnl.selling.manual||0)-(((pnl.byCategory['Advertising & marketing']||{}).amount)||0)).toFixed(2)],
    ['  Returns & refunds',pnl.selling.returns],
    ['  Partner / consignment splits',pnl.selling.partner],
    ['  Total selling costs',pnl.selling.total],
    ['OPERATING PROFIT',pnl.operatingProfit],
    ['Operating margin %',pnl.operatingMargin],
    [],
    ['Overheads',''],
    ['  Motor, van & travel (Box 20)',pnl.byBox[20]||0],
    ['  Rent, rates, power & insurance (Box 21)',pnl.byBox[21]||0],
    ['  Repairs & equipment (Box 22)',pnl.byBox[22]||0],
    ['  Phone, office & stationery (Box 23)',(pnl.byCategory['Phone, office & stationery']||{}).amount||0],
    ['  Accountancy, legal & professional (Box 28)',pnl.byBox[28]||0],
    ['  Software, subscriptions & other (Box 30)',+Math.max(0,(pnl.byBox[30]||0)-(pnl.selling.returns||0)-(pnl.archiveLoss||0)).toFixed(2)],
    ['  Removed stock / write-offs — management P&L',pnl.archiveLoss||0],
    ['  Total overheads',pnl.overheads.total],
    ['NET PROFIT BEFORE TAX',pnl.netProfit],
    ['Net margin %',pnl.netMargin],
    [],
    ['Memo — cash & stock',''],
    ['  Stock cost tied up (sourced in period, unsold)',pnl.stock.cost],
    ['  Indicative management cash position (profit − stock tied up)',pnl.cashPosition],
    [],
    ['Items sold',pnl.soldCount],
    ['Returns',pnl.returnCount],
    ['Unsold items sourced in period',pnl.stock.count]
  ];
  if(pnl.motorDoubleClaim){
    rows.push([]);
    rows.push(['Motor method: '+(pnl.motorMethod==='actual'?'Actual motor costs':'Simplified mileage')+' applied; '+pnl.motorExcludedLabel+' ('+pnl.motorExcluded.toFixed(2)+') excluded (one method per vehicle).','']);
  }
  return rows;
}

// ─── CUSTOM DATE RANGE STATEMENT ─────────────────────────────────────────
function downloadRangeStatement(from,to){
  if(!from||!to){toast('Pick a from and to date','error');return;}
  if(from>to){toast('"From" date must be before "To" date','error');return;}
  const pnl=_buildPnLSummary(from,to,from+' → '+to);
  const rows=[];
  // P&L summary block first
  pnl.rows.forEach(function(r){rows.push(r);});
  rows.push([]);
  // Custom ranges are management-only. HMRC cash-basis working belongs to the dedicated Tax/FY export.
  // Expenses grouped by category with subtotals (SA103 box + bucket)
  const _byCat=_expensesByCategoryRows(pnl);
  if(_byCat.rows.length>2){
    rows.push(['EXPENSES BY CATEGORY']);
    _byCat.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
  }
  // Sales detail — full transaction breakdown
  rows.push(['SALES — TRANSACTION BREAKDOWN']);
  rows.push(_SALE_DETAIL_HEADERS);
  pnl.events.forEach(function(ev){rows.push(_saleDetailRowCSV(ev));});
  rows.push([]);
  // Sales totals row (aligned to numeric columns of the detail headers)
  let tSale=0,tPostIn=0,tBpf=0,tPromo=0,tShip=0,tPkg=0,tCost=0,tParts=0,tListing=0,tRefund=0,tRP=0,tPartial=0,tPart=0,tTotCosts=0,tNet=0;
  pnl.events.forEach(function(ev){
    const b=_saleBreakdown(ev);
    if(!ev.isReturned)tSale+=b.salePrice;
    tPostIn+=b.postage; tBpf+=b.bpf; tPromo+=b.promoFee;
    tShip+=b.shipping; tPkg+=b.packaging; tCost+=b.itemCost;
    tParts+=b.parts; tListing+=b.listingFee;
    tRefund+=b.returnRefund; tRP+=b.returnPostage; tPartial+=b.partialRefund;
    tPart+=b.partnerSplit; tTotCosts+=b.totalCosts; tNet+=b.netProfit;
  });
  rows.push(['SALES TOTAL','','','','','',
    tSale.toFixed(2),tPostIn.toFixed(2),tBpf.toFixed(2),'',tPromo.toFixed(2),
    tShip.toFixed(2),tPkg.toFixed(2),tCost.toFixed(2),tParts.toFixed(2),tListing.toFixed(2),
    tRefund.toFixed(2),tRP.toFixed(2),tPartial.toFixed(2),tPart.toFixed(2),
    tTotCosts.toFixed(2),tNet.toFixed(2),'','']);
  // Expenses detail — trip sub-expenses broken out with "what for"
  if(pnl.expenses.rows.length){
    rows.push([]);
    rows.push(['EXPENSES & MILEAGE — DETAILED']);
    rows.push(_EXPENSE_DETAIL_HEADERS);
    const expBreak=_expandedExpenseRowsCSV(pnl);
    expBreak.rows.forEach(function(r){rows.push(r);});
    rows.push([]);
    rows.push(['EXPENSE TOTAL','','','','','','','','',expBreak.total.toFixed(2)]);
  }
  // Unsold-stock-in-period detail
  if(pnl.stock.items.length){
    rows.push([]);
    rows.push(['UNSOLD STOCK SOURCED IN PERIOD']);
    rows.push(['Date Sourced','Item','GID','State','Cost (£)']);
    pnl.stock.items.forEach(function(s){
      const i=s.item;
      rows.push([s.dateSourced||'',(i.item||'').replace(/,/g,' '),i.gid||'',i.state||'',s.cost.toFixed(2)]);
    });
    rows.push([]);
    rows.push(['STOCK COST TIED UP','','','',pnl.stock.cost.toFixed(2)]);
  }
  const csv=_rowsToCsv(rows);
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='RETRADE_Range_'+from+'_to_'+to+'.csv';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  URL.revokeObjectURL(a.href);toast('Downloaded range statement');
}
function downloadRangeExcel(from,to){
  if(!from||!to){toast('Pick a from and to date','error');return;}
  if(from>to){toast('"From" date must be before "To" date','error');return;}
  const pnl=_buildPnLSummary(from,to,from+' → '+to);
  // Sheet 1: P&L Summary (multi-tier, numeric so Excel formats correctly)
  const summaryRows=_pnlSummarySheetRows(pnl,'Profit & Loss — '+from+' → '+to);
  // Arbitrary date ranges are management reporting only. HMRC cash-basis
  // working is generated from the dedicated Tax/FY export for a full tax year.
  const byCatRows=_expensesByCategoryRows(pnl).rows;
  // Sheet 2: Sales — full transaction breakdown
  const salesRows=[_SALE_DETAIL_HEADERS.slice()];
  let tSale=0,tPostIn=0,tBpf=0,tPromo=0,tShip=0,tPkg=0,tCost=0,tParts=0,tListing=0,tRefund=0,tRP=0,tPartial=0,tPart=0,tTotCosts=0,tNet=0;
  pnl.events.forEach(function(ev){
    salesRows.push(_saleDetailRow(ev,false));
    const b=_saleBreakdown(ev);
    if(!ev.isReturned)tSale+=b.salePrice;
    tPostIn+=b.postage; tBpf+=b.bpf; tPromo+=b.promoFee;
    tShip+=b.shipping; tPkg+=b.packaging; tCost+=b.itemCost;
    tParts+=b.parts; tListing+=b.listingFee;
    tRefund+=b.returnRefund; tRP+=b.returnPostage; tPartial+=b.partialRefund;
    tPart+=b.partnerSplit; tTotCosts+=b.totalCosts; tNet+=b.netProfit;
  });
  salesRows.push([]);
  salesRows.push(['TOTALS','','','','','',
    +tSale.toFixed(2),+tPostIn.toFixed(2),+tBpf.toFixed(2),'',+tPromo.toFixed(2),
    +tShip.toFixed(2),+tPkg.toFixed(2),+tCost.toFixed(2),+tParts.toFixed(2),+tListing.toFixed(2),
    +tRefund.toFixed(2),+tRP.toFixed(2),+tPartial.toFixed(2),+tPart.toFixed(2),
    +tTotCosts.toFixed(2),+tNet.toFixed(2),'','']);
  // Sheet 3: Expenses — trip sub-expenses expanded
  const expBreak=_expandedExpenseRows(pnl);
  const expRows=[_EXPENSE_DETAIL_HEADERS.slice()].concat(expBreak.rows);
  if(expBreak.rows.length){expRows.push([]);expRows.push(['TOTAL','','','','','','','','',+expBreak.total.toFixed(2)]);}
  // Sheet 4: Unsold Stock (in period)
  const stockRows=[['Date Sourced','Item','GID','State','Cost (£)']];
  pnl.stock.items.forEach(function(s){
    stockRows.push([s.dateSourced||'',s.item.item||'',s.item.gid||'',s.item.state||'',s.cost]);
  });
  if(stockRows.length>1){stockRows.push([]);stockRows.push(['TOTAL','','','',pnl.stock.cost]);}

  const build=function(){
    const today=new Date().toLocaleDateString('en-GB',{year:'numeric',month:'short',day:'numeric'});
    const wb=XLSX.utils.book_new();
    const meta=[['Custom Range Statement — '+from+' → '+to],['Exported '+today+' from RETRADE'],[]];
    const ws0=XLSX.utils.aoa_to_sheet(summaryRows);
    ws0['!cols']=[{wch:52},{wch:16}];
    _styleReportSheet(ws0,summaryRows,{headerRows:[3],freezeRow:4,moneyCols:[1]});
    XLSX.utils.book_append_sheet(wb,ws0,'P&L Summary');
    if(byCatRows.length>2){
      const wsBC=XLSX.utils.aoa_to_sheet(byCatRows);
      wsBC['!cols']=[{wch:34},{wch:12},{wch:14},{wch:14}];
      _styleReportSheet(wsBC,byCatRows,{headerRows:[2],freezeRow:3,moneyCols:[3]});
      XLSX.utils.book_append_sheet(wb,wsBC,'Expenses by Category');
    }
    const salesAll=meta.concat(salesRows);
    const ws1=XLSX.utils.aoa_to_sheet(salesAll);
    ws1['!cols']=salesRows[0]?salesRows[0].map(function(){return{wch:18};}):[];
    _styleReportSheet(ws1,salesAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,10,11,12,13,14,15,16,17,18,19,20,21]});
    XLSX.utils.book_append_sheet(wb,ws1,'Sales');
    if(expRows.length>1){
      const expAll=meta.concat(expRows);
      const ws2=XLSX.utils.aoa_to_sheet(expAll);
      ws2['!cols']=expRows[0]?expRows[0].map(function(){return{wch:20};}):[];
      _styleReportSheet(ws2,expAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[6,7,8,9]});
      XLSX.utils.book_append_sheet(wb,ws2,'Expenses & Mileage');
    }
    if(stockRows.length>1){
      const stockAll=meta.concat(stockRows);
      const ws3=XLSX.utils.aoa_to_sheet(stockAll);
      ws3['!cols']=[{wch:14},{wch:36},{wch:12},{wch:12},{wch:14}];
      _styleReportSheet(ws3,stockAll,{headerRows:[3],freezeRow:4,autoFilterRow:3,moneyCols:[4]});
      XLSX.utils.book_append_sheet(wb,ws3,'Stock Tied Up');
    }
    const filename='RETRADE_Range_'+from+'_to_'+to+'.xlsx';
    XLSX.writeFile(wb,filename);
    toast('Downloaded '+filename);
  };
  if(!window.XLSX){
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.integrity='sha512-r22gChDnGvBylk90+2e/ycr3RVrDi8DIOkIGNhJlKfuyQM4tIRAI062MaV8sfjQKYVGjOBaZBOA87z+IhZE9DA==';s.crossOrigin='anonymous';s.referrerPolicy='no-referrer';
    s.onload=build;s.onerror=function(){toast('Failed to load Excel library','error');};
    document.head.appendChild(s);
  }else{build();}
}

// Sale-attributed month stats — drives the new Monthly KPIs.
//   totalRev          Sum of sale-event revenue (all completed numbered sale-cycle prices) landing in m
//   realisedProfit    Sum of sale-event profits (numbered sale-cycle economics plus dated return adjustments)
//   soldCount         Count of sale events in m; later returns do not rewrite the sale month
//   eventCount        Count of all sale and dated return-adjustment events in m
//   returnedCount     Count of return adjustments logged in m
//   avgROI            Average ROI across non-returned sale events
//   avgDays           Average days-to-sell across non-returned sale events
//   refundCount       Count of return events whose original sale (dateSoldAtReturn fallback) was in m
//   partialCount      Count of partial refund events whose original sale was in m
//   refundItemRate    refundCount / soldCount * 100 — items rate
//   refundedSalesRev  Sum of revenue from sale events in m that had any refund

// eBay UK BPF: iterative solve matches spreadsheet values exactly
// Pure number→number primitive. DO NOT change — financial rule.

// Platform fee stubs (Session D1 — Lean scope)
// Each takes (item, salePrice) and returns the platform's selling fee.
// Currently all non-eBay stubs delegate to calcEbayBPF as a safe placeholder
// until each platform's real fee structure is researched against actual sales.
// Replacing a stub with a real formula is a one-function change; the dispatcher
// and all callers continue to work unchanged.

// eBay Business UK category FVF rates (official UK fee schedule, verified 21 Aug 2026)
// Default 12.9% (Other) if category missing — safer to over-estimate than under.
// eBay UK Business Final Value Fees — verified against eBay's 12 Feb 2026
// rate card (via eBay Seller Centre + cross-checked May 2026). Each entry is
// EITHER a flat variable rate (number) OR a banded spec:
//   {rate, threshold, above}  → `rate` on the first `threshold` of the sale,
//                               then `above` on the remainder.
// Banding is how eBay keeps high-ticket categories competitive — a flat rate
// would massively over-state fees on expensive items. All rates are the
// variable FVF only; the formula adds per-order, 0.35% regulatory and 20% VAT.
// eBay UK Business Final Value Fees — verified against eBay official fee page
// https://www.ebay.co.uk/help/selling/fees-credits-invoices/fees-business-sellers-activated-managed-payments?id=4809
// Last checked: 21 Aug 2026. eBay fee page currently states last updated 12 February 2026.
//
// Formula on every sale (all fees + 20% VAT):
//   FVF (category rate × total sale incl. postage)
//   + Regulatory Operating Fee (0.35% of total sale)
//   + Per-order fee (£0.30 if order ≤£10; £0.40 if >£10; £0.10 in Home/Collectables ≤£10)
//   All three combined then × 1.20 (20% VAT)
//
// BANDED notation: {rate, threshold, above}
//   rate = FVF% on portion up to threshold
//   above = FVF% on portion above threshold
// Each RETRADE category maps to one official eBay category/rate. Where eBay's
// banded subcategories carry materially different rates (e.g. laptops vs general
// computing), they are split into their own RETRADE category so the FVF is right.
// Category names chosen to match how eBay auto-files the typical reseller item.
const EBAY_BIZ_FVF={
  // ── 9.9% flat (eBay parent rate for these top-level categories) ─────────────
  'Books, Comics & Magazines': 0.099, // #267
  'Films & TV':                0.099, // #11232
  'Music (CDs & Vinyl)':       0.099, // #11233
  'Camera Accessories':        0.099, // #625 general — tripods/bags/SD cards (Digital Cameras banded)
  'Computer Accessories & Parts':0.099,// #58058 general — mice/GPU/keyboards (Laptops banded)
  'Phone Accessories':         0.099, // #15032 general — cases/chargers (Handsets banded)
  'Audio & Video Accessories': 0.099, // #293 general — walkmans/radios (TVs banded)
  'Video Games':               0.099, // #1249 game SOFTWARE (consoles banded)

  // ── 10.9% flat ──────────────────────────────────────────────────────────────
  'Antiques':                  0.109, // #20081
  'Art':                       0.109, // #550
  'Baby':                      0.109, // #2984
  'Collectables':              0.109, // #1
  'Dolls & Bears':             0.109, // #237
  'Garden & Patio':            0.109, // #159912
  'Health & Beauty':           0.109, // #26395 general
  'Musical Instruments':       0.109, // #619
  'Pottery, Ceramics & Glass': 0.109, // #870
  'Sporting Goods':            0.109, // #888
  'Sports Memorabilia':        0.109, // #64482
  'Stamps':                    0.109, // #260
  'Toys & Games':              0.109, // #220 general
  'Trading Cards':             0.109, // #212 Sports Trading Cards / Non-Sport TCG — authenticity-checked ≥£150

  // ── 11.9% flat ────────────────────────────────────────────────────────────
  'Clothes, Shoes & Accessories':0.119,// #11450 general (bags/trainers handled separately)
  'Memorials & Funerals':      0.119, // #88739 (Everything Else exception)

  // ── 12.5% flat ──────────────────────────────────────────────────────────────
  'Business, Office & Industrial':0.125, // #12576

  // ── 12.9% flat ────────────────────────────────────────────────────────────
  'Crafts':                    0.129, // #14339
  'Event Tickets':             0.129, // #1305
  'Pet Supplies':              0.129, // #1281
  'Wholesale & Job Lots':      0.129, // #40005
  'Other':                     0.129, // #99 Everything Else / default catch-all

  // ── Banded high-value ───────────────────────────────────────────────────────
  // Computers banded: Desktops, Laptops, Tablets, Drives, Servers, Printers — 6.9%→3% @£1,000
  'Laptops, Desktops & Tablets':{rate:0.069, threshold:1000, above:0.03},
  // Sound & Vision banded: TVs, Headphones, Home Audio & HiFi, DVD/Blu-ray players — 6.9%→3% @£1,000
  'TVs, Headphones & HiFi':    {rate:0.069, threshold:1000, above:0.03},
  // Cameras banded: Camcorders, Digital Cameras, Film Photography, Lenses & Filters — 6.9%→3% @£1,000
  'Digital Cameras & Lenses':  {rate:0.069, threshold:1000, above:0.03},
  // Mobile Phones (handsets) — 6.9%→3% @£1,000
  'Mobile Phones (Handsets)':  {rate:0.069, threshold:1000, above:0.03},
  // Video Game Consoles hardware — 6.9%→2% @£400
  'Video Game Consoles':       {rate:0.069, threshold:400, above:0.02},
  // Home, Furniture & DIY general — 11.9%→7.9% @£500
  'Home, Furniture & DIY':     {rate:0.119, threshold:500, above:0.079},
  // Jewellery (rings/necklaces etc — NOT watches) — 14.9%→4% @£1,000 (2024 raise)
  'Jewellery':                 {rate:0.149, threshold:1000, above:0.04},
  // Watches, Parts & Accessories — 12.9%→3% @£750 (excluded from the 2024 Jewellery raise)
  'Watches':                   {rate:0.129, threshold:750, above:0.03},
  // Women's Bags & Handbags — 12.9%→7% @£800
  "Women's Bags & Handbags":   {rate:0.129, threshold:800, above:0.07},
  // Coins — 10.9%→3% @£450
  'Coins':                     {rate:0.109, threshold:450, above:0.03},
  // Vehicle Parts & Accessories general — 9.5%→3% @£750 (Feb 2026 threshold raise)
  'Vehicle Parts & Accessories':{rate:0.095, threshold:750, above:0.03},

  // ── Trainers: 11.9% general, flips to flat 7% when item price ≥ £100.
  //    The threshold flip is handled in calcEbayBizBPF, not the rate table.
  'Trainers':                  0.119,
};

// eBay UK Business FVF formula (verified against official eBay fee page, 21 Aug 2026):
// FVF (category rate × total sale incl. postage)
// + Regulatory Operating Fee (0.35% of total sale)
// + Per-order fee (£0.40 if >£10; £0.30 if ≤£10; £0.10 in Home/Collectables ≤£10)
// All three combined × 1.20 (20% VAT — reclaimable if VAT-registered)
// salePrice = item price + buyer-paid postage (FVF base per eBay rules)
// itemPriceOnly = item price WITHOUT postage (needed for Trainers ≥£100 threshold only)

// Returns the effective variable FVF rate for a category at a given sale price,
// for display in the fee label (e.g. "11.9%" or "6.9%→3%" for banded). Pure
// presentation helper — the real money comes from calcEbayBizBPF.

// Dispatcher: routes to the right platform fee primitive based on the item.
// All NEW code paths should use this. Existing calcEbayBPF callers remain
// valid (they operate on items that resolve to eBay either explicitly or by
// fallback), so this is additive — not a breaking refactor.
// Optional 3rd arg: buyerPostage. eBay BUSINESS FVF and Depop processing use
// item price + buyer-paid postage. eBay PRIVATE Buyer Protection is calculated
// on the item price only; postage is separate.

// Advertising / boost fee paid by the seller. RETRADE stores promoPercent as
// a decimal (e.g. 0.03 = 3%). eBay General ad fees are based on total sale
// amount incl. postage and VAT may be added; Depop's published 12% boosting
// rate is applied directly to item + seller-arranged shipping.









// Revenue for an item — reflects cash actually kept, not gross flow:
//   Fully returned, not yet relisted    → 0      (sale reversed, money went back)
//   Fully returned, relisted, no resale → 0      (original sale reversed, sale 2 hasn't happened)
//   Returned then resold                → resaleSalePrice only (original sale doesn't count)
//   Partial refund (any type)           → salePrice gross (partial doesn't reverse the sale)
//   Normal sold                         → salePrice
// Profit is calculated separately via calcGrossProfit which handles all fee/cost logic.

// calcNetProfit: gross profit minus the partner's agreed payment (if any).
// This is the number that represents what you actually keep after settling
// with the account — treat the partner payment as a direct cost of sale,
// same as fees or postage. Used on the dashboard, monthly totals, and SA103.
// calcGrossProfit is still the building block (and what _accountItemOwed uses
// to calculate the split on, so there's no circular dependency).


// Preview regression scheduling lives in app.js, after PREVIEW_MODE_ENABLED is defined.
