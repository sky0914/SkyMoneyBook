function stockFixture(){
 const writes=[];
 const rows=[['日期','股票代碼','股數','單價','殖利率','備註','成本'],[new Date('2026-10-14T00:00:00Z'),'0050',1000,30.5,.05,'第一筆',30500],[new Date('2026-10-13T00:00:00Z'),'2330',100,1000,.02,'第二筆',100000],['小計','','','','','','']];
 const formulas={ '2:7':'=C2*D2','3:7':'=C3*D3' };
 const formats=['yyyy/mm/dd','@','#,##0','0.00','0.00%','@','#,##0'];
 const merged=[{row:4,column:1,rows:1,columns:2}];
 function mergedRange(m){return {getRow:()=>m.row,getColumn:()=>m.column,getNumRows:()=>m.rows,getNumColumns:()=>m.columns,getCell:()=>({getDisplayValue:()=>String(rows[m.row-1][m.column-1])})}}
 function range(row,col,n=1,m=1){
  const matrix=fn=>Array.from({length:n},(_,r)=>Array.from({length:m},(_,c)=>fn(row+r,col+c)));
  const value=(r,c)=>formulas[r+':'+c]?Number(rows[r-1][2])*Number(rows[r-1][3]):rows[r-1]?.[c-1]??'';
  return {getValues:()=>matrix(value),getFormulas:()=>matrix((r,c)=>formulas[r+':'+c]||''),getNumberFormats:()=>matrix((r,c)=>formats[c-1]),
   getDisplayValues:()=>matrix((r,c)=>{const v=value(r,c);if(v instanceof Date)return v.toISOString().slice(0,10).replaceAll('-','/');if(typeof v==='number'){if(c===5)return (v*100).toFixed(2)+'%';if(c===4)return v.toFixed(2);return v.toLocaleString('en-US')}return String(v)}),
   getBackgrounds:()=>matrix((r)=>r===1?'#243740':'#ffffff'),getFontColors:()=>matrix(r=>r===1?'#ffffff':'#000000'),getFontWeights:()=>matrix(r=>r===1?'bold':'normal'),getFontFamilies:()=>matrix(()=> 'Arial'),getFontSizes:()=>matrix(()=>11),getFontStyles:()=>matrix(()=> 'normal'),getHorizontalAlignments:()=>matrix(()=>null),getVerticalAlignments:()=>matrix(()=> 'middle'),getWraps:()=>matrix(()=>false),
   getMergedRanges:()=>merged.filter(v=>v.row+v.rows>row&&v.row<row+n&&v.column+v.columns>col&&v.column<col+m).map(mergedRange),
   setValues:values=>{writes.push({row,col,values});values.forEach((data,r)=>data.forEach((v,c)=>{rows[row+r-1][col+c-1]=typeof v==='string'&&v.startsWith("'")?v.slice(1):v}))}
  };
 }
 const sheet={getName:()=> 'ETF 存股',getSheetId:()=>101,isSheetHidden:()=>false,getLastRow:()=>rows.length,getLastColumn:()=>7,getMaxRows:()=>1000,getMaxColumns:()=>200,getFrozenRows:()=>1,getRange:range,getColumnWidth:c=>c===6?180:100,getRowHeight:r=>r===1?32:28};
 const second={...sheet,getName:()=> '股票存股',getSheetId:()=>202};
 const hidden={...sheet,getName:()=> '隱藏資料',getSheetId:()=>303,isSheetHidden:()=>true};
 return {workbook:{getName:()=> '存股紀錄',getSpreadsheetTimeZone:()=> 'Etc/UTC',getSheets:()=>[sheet,second,hidden]},rows,formulas,formats,merged,writes,sheet};
}
module.exports={stockFixture};
