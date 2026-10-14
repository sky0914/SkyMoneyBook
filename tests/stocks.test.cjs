const {test}=require('node:test'),assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs'),{stockFixture}=require('./stock-fixture.cjs');
function setup(){const api=backend(),fixture=stockFixture();api.setStockWorkbook(fixture.workbook);return {api,fixture}}
const cell=(data,key)=>data.stockSheet.rows.flatMap(r=>r.cells).find(c=>c.key===key);
test('stock sheet reads source headers, types, formatted values and merged cells without modifying source',()=>{
 const {api,fixture}=setup(),data=api.read('stockSheet');assert.equal(data.stockWorkbook.sheets.length,2);assert.equal(data.stockSheet.name,'ETF 存股');
 assert.equal(cell(data,'2:2').input,'0050');assert.equal(cell(data,'2:5').text,'5.00%');assert.equal(cell(data,'2:5').input,'5');assert.equal(cell(data,'2:1').kind,'date');assert.equal(cell(data,'2:7').editable,false);assert.equal(cell(data,'1:1').editable,false);
 assert.equal(cell(data,'4:1').colspan,2);assert.equal(cell(data,'4:1').editable,false);assert.equal(cell(data,'4:2'),undefined);assert.equal(fixture.writes.length,0);
});
test('stock patch preserves original columns, number formats, leading zeros and formulas',()=>{
 const {api,fixture}=setup(),data=api.read('stockSheet');
 const changes=[['2:3','2000'],['2:5','4.5'],['2:1','2026-10-15'],['2:2','00050']].map(([key,value])=>{const c=cell(data,key);return {row:c.row,column:c.column,expectedRevision:c.revision,value}});
 assert.equal(api.post({action:'saveStockCells',sheetId:101,changes}).status,'success');
 assert.equal(fixture.rows[1][2],2000);assert.equal(fixture.rows[1][4],.045);assert.equal(fixture.rows[1][1],'00050');assert.equal(fixture.rows[1][0].toISOString().slice(0,10),'2026-10-15');
 const after=api.read('stockSheet');assert.equal(cell(after,'2:7').text,'61,000');assert.equal(fixture.formulas['2:7'],'=C2*D2');assert.equal(fixture.formats[4],'0.00%');assert.equal(fixture.rows[0][2],'股數');
});
test('stock conflicts reject the entire patch before writing, and retries are idempotent',()=>{
 const {api,fixture}=setup(),data=api.read('stockSheet');
 const changes=[['2:3','2000'],['2:4','40']].map(([key,value])=>{const c=cell(data,key);return {row:c.row,column:c.column,expectedRevision:c.revision,value}});
 fixture.rows[1][3]=31;
 assert.equal(api.post({action:'saveStockCells',sheetId:101,changes}).status,'error');assert.equal(fixture.rows[1][2],1000);assert.equal(fixture.writes.length,0);
 fixture.rows[1][3]=30.5;assert.equal(api.post({action:'saveStockCells',sheetId:101,changes}).status,'success');const writes=fixture.writes.length;
 assert.equal(api.post({action:'saveStockCells',sheetId:101,changes}).status,'success');assert.equal(fixture.writes.length,writes);
});
test('stock header/formula/merged/hidden positions cannot be overwritten',()=>{
 const {api,fixture}=setup(),data=api.read('stockSheet');
 for(const key of ['1:1','2:7','4:1']){const c=cell(data,key);assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[{row:c.row,column:c.column,expectedRevision:c.revision,value:'123'}]}).status,'error')}
 assert.equal(api.read('stockSheet',{sheetId:303}).status,'error');assert.equal(fixture.writes.length,0);
});
test('stock text that starts with equals stays literal rather than creating a formula',()=>{
 const {api,fixture}=setup(),c=cell(api.read('stockSheet'),'2:6');assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[{row:2,column:6,expectedRevision:c.revision,value:'=1+1'}]}).status,'success');
 assert.equal(fixture.rows[1][5],'=1+1');assert.equal(cell(api.read('stockSheet'),'2:6').formula,false);
});
test('stock tab loads lazily, edits save back and do not clear unsaved changes in other pages',async()=>{
 const {api,fixture}=setup(),f=frontend(api),a=f.app;await a.fetchData();assert.equal(f.requests.some(r=>r.dataset==='stockSheet'),false);await a.loadStockSheet();
 a.currentYearSummaries.value[1].salary=123;const c=cell({stockSheet:a.stockSheet.value},'2:3');a.beginStockEdit(c);a.stockBuffer.value='2000';assert.equal(a.hasStockUnsavedChanges.value,true);a.commitStockEdit();await a.saveStockChanges();
 assert.equal(a.stockError.value,'');assert.equal(fixture.rows[1][2],2000);assert.equal(a.hasStockUnsavedChanges.value,false);assert.equal(a.dirtySections.value.includes('summaries'),true);
});
test('stock read-back failures retain edits; retry confirms without duplicate writes',async()=>{
 const {api,fixture}=setup(),f=frontend(api),a=f.app;await a.fetchData();await a.loadStockSheet();a.beginStockEdit(cell({stockSheet:a.stockSheet.value},'2:3'));a.stockBuffer.value='2000';a.commitStockEdit();f.setMode('lost-confirmation');await a.saveStockChanges();
 assert.equal(a.hasStockUnsavedChanges.value,true);assert.ok(a.stockError.value);const writes=fixture.writes.length;f.setMode('normal');await a.saveStockChanges();assert.equal(a.hasStockUnsavedChanges.value,false);assert.equal(fixture.writes.length,writes);
});
test('stock worksheet switch asks before discarding and does not lose edits on cancellation',async()=>{
 const {api}=setup(),f=frontend(api),a=f.app;await a.loadStockSheet();a.beginStockEdit(cell({stockSheet:a.stockSheet.value},'2:3'));a.stockBuffer.value='2000';a.commitStockEdit();f.setConfirm(false);await a.loadStockSheet(202);assert.equal(a.stockSheet.value.id,101);assert.equal(a.hasStockUnsavedChanges.value,true);
 f.setConfirm(true);await a.loadStockSheet(202);assert.equal(a.stockSheet.value.id,202);assert.equal(a.hasStockUnsavedChanges.value,false);
});
test('stock date edits preserve existing time and detect concurrent time changes',()=>{
 const {api,fixture}=setup();fixture.rows[1][0]=new Date('2026-10-14T08:30:00Z');
 let c=cell(api.read('stockSheet'),'2:1');fixture.rows[1][0]=new Date('2026-10-14T09:30:00Z');
 assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[{row:2,column:1,expectedRevision:c.revision,value:'2026-10-15'}]}).status,'error');
 c=cell(api.read('stockSheet'),'2:1');assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[{row:2,column:1,expectedRevision:c.revision,value:'2026-10-15'}]}).status,'success');
 assert.equal(fixture.rows[1][0].toISOString(),'2026-10-15T09:30:00.000Z');
});
test('invalid stock dates and numbers are rejected before any updates',()=>{
 const {api,fixture}=setup(),data=api.read('stockSheet');
 for(const [key,value] of [['2:1','2026-02-30'],['2:3','Infinity'],['2:5','abc']]){const c=cell(data,key);assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[{row:c.row,column:c.column,expectedRevision:c.revision,value}]}).status,'error')}
 assert.equal(fixture.writes.length,0);
});
test('stock type/format changes cannot produce a false saved confirmation',async()=>{
 const {api,fixture}=setup(),a=frontend(api).app;await a.loadStockSheet();a.beginStockEdit(cell({stockSheet:a.stockSheet.value},'2:5'));a.stockBuffer.value='50';a.commitStockEdit();
 fixture.formats[4]='0.00';fixture.rows[1][4]=50;await a.saveStockChanges();assert.ok(a.stockError.value);assert.equal(a.hasStockUnsavedChanges.value,true);assert.equal(fixture.writes.length,0);
});
test('stock percentage floating point conversion is confirmed without losing the intended value',async()=>{
 const {api,fixture}=setup(),a=frontend(api).app;await a.loadStockSheet();a.beginStockEdit(cell({stockSheet:a.stockSheet.value},'2:5'));a.stockBuffer.value='33.33333333333333';a.commitStockEdit();await a.saveStockChanges();
 assert.equal(a.stockError.value,'');assert.equal(a.hasStockUnsavedChanges.value,false);assert.ok(Math.abs(fixture.rows[1][4] - 1/3) <= Number.EPSILON);
});
test('stock pagination preserves absolute cell positions and clips merged ranges correctly',()=>{
 const {api,fixture}=setup();
 while(fixture.rows.length<95)fixture.rows.push([new Date('2026-10-14T00:00:00Z'),'0050',1000,30.5,.05,'延伸紀錄',30500]);
 fixture.rows[78][0]='跨頁標題';fixture.merged.push({row:79,column:1,rows:4,columns:1});
 const first=api.read('stockSheet');assert.equal(first.stockSheet.endRow,80);assert.equal(first.stockSheet.totalRows,95);
 const second=api.read('stockSheet',{sheetId:101,startRow:81});assert.equal(second.stockSheet.startRow,81);assert.equal(second.stockSheet.endRow,95);
 const c=cell(second,'81:1');assert.equal(c.text,'跨頁標題');assert.equal(c.rowspan,2);assert.equal(c.editable,false);assert.equal(cell(second,'82:1'),undefined);
});
test('stock clearing the last value can still be verified after the used range shrinks',async()=>{
 const {api,fixture}=setup();fixture.formulas['2:7']='';fixture.formulas['3:7']='';fixture.rows.splice(2);fixture.rows[1]=['','','','','','最後備註',''];
 fixture.sheet.getLastRow=()=>fixture.rows[1].some(v=>v!=='')?2:1;
 const a=frontend(api).app;await a.loadStockSheet();a.beginStockEdit(cell({stockSheet:a.stockSheet.value},'2:6'));a.stockBuffer.value='';a.commitStockEdit();await a.saveStockChanges();
 assert.equal(a.stockError.value,'');assert.equal(fixture.rows[1][5],'');assert.equal(a.hasStockUnsavedChanges.value,false);
});
test('stock merged headings that extend beyond content columns are represented completely',()=>{
 const {api,fixture}=setup();fixture.merged.push({row:1,column:1,rows:1,columns:9});
 const data=api.read('stockSheet');assert.equal(data.stockSheet.columnWidths.length,9);assert.equal(cell(data,'1:1').colspan,9);assert.equal(cell(data,'2:9').editable,false);
});
