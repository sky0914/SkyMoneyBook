const {test}=require('node:test'),assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
const sample=(fields={})=>({id:'stock-test-1',date:'2026-10-14',code:'0050',name:'元大台灣50',type:'買進',quantity:1000,price:30.5,fee:20,tax:0,dividend:0,note:'定期定額',...fields});
test('stock records use thirteen ordinary columns in the main workbook with stable IDs and formulas',()=>{
 const api=backend(),before=api.read();assert.deepEqual(before.stockRecords,[]);
 assert.equal(api.post({action:'saveStocks',stockRecords:[sample()],expectedRevision:before.revisions.stockRecords}).status,'success');
 const sheet=api.sheets['存股紀錄'];assert.equal(sheet.rows[0].length,13);assert.equal(sheet.rows[1][0],'stock-test-1');assert.equal(sheet.rows[1][2],'0050');assert.ok(sheet.rows[1][1] instanceof Date);assert.equal(typeof sheet.rows[1][5],'number');assert.equal(sheet.rows[1][7],'=ROUND(F2*G2,2)');assert.ok(sheet.rows[1][11].startsWith('=ROUND(IF('));
 const after=api.read('stockRecords');assert.equal(after.stockRecords[0].gross,30500);assert.equal(after.stockRecords[0].cashFlow,-30520);assert.ok(api.openedBooks.every(id=>id==='16JQJXIZXfkNsoIHOuuipvJaEah_Bbq2U0UdXo5n2HSA'));assert.ok(sheet.formats.some(f=>f.col===3&&f.format==='@'));
});
test('all four stock transaction types calculate cash flow correctly',()=>{
 const api=backend(),records=[sample(),sample({id:'sell',type:'賣出',quantity:100,price:40,fee:10,tax:12}),sample({id:'dividend',type:'現金股利',quantity:0,price:0,dividend:800,fee:0,tax:16}),sample({id:'bonus',type:'配股',quantity:10,price:0,fee:0})];
 assert.equal(api.post({action:'saveStocks',stockRecords:records,expectedRevision:api.read().revisions.stockRecords}).status,'success');
 const values=api.read().stockRecords;assert.deepEqual(values.map(r=>r.cashFlow),[-30520,3978,784,0]);assert.deepEqual(values.map(r=>r.gross),[30500,4000,0,0]);
});
test('stock validation and stale versions reject changes before touching the sheet',()=>{
 const api=backend(),rev=api.read().revisions.stockRecords;
 for(const record of [sample({date:'2026-02-30'}),sample({quantity:0}),sample({fee:-1}),sample({code:'=bad'}),sample({price:Infinity}),sample({type:'invalid'}),sample({type:'現金股利',quantity:0,price:0,dividend:0})])assert.equal(api.post({action:'saveStocks',stockRecords:[record],expectedRevision:rev}).status,'error');
 assert.equal(api.sheets['存股紀錄'],undefined);
 assert.equal(api.post({action:'saveStocks',stockRecords:[sample()],expectedRevision:rev}).status,'success');
 assert.equal(api.post({action:'saveStocks',stockRecords:[sample({quantity:2000})],expectedRevision:rev}).status,'conflict');assert.equal(api.read().stockRecords[0].quantity,1000);
});
test('stock CRUD saves, edits, deletes and retains other unsaved sections',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;a.currentYearSummaries.value[1].salary=123;
 a.openAddStockModal();a.stockForm.value=sample();await a.saveStockRecord();assert.equal(api.read().stockRecords.length,1);assert.ok(a.dirtySections.value.includes('summaries'));const id=api.read().stockRecords[0].id;
 a.openEditStockModal(a.stockRecords.value[0]);a.stockForm.value.quantity=2000;await a.saveStockRecord();assert.equal(api.read().stockRecords[0].id,id);assert.equal(api.read().stockRecords[0].cashFlow,-61020);
 await a.deleteStockRecord(id);assert.equal(api.read().stockRecords.length,0);assert.equal(a.pendingSave.value,null);assert.ok(a.dirtySections.value.includes('summaries'));
});
test('stock search and type filters leave annual totals intact; old stock years remain selectable',async()=>{
 const api=backend();api.post({action:'saveStocks',stockRecords:[sample(),sample({id:'div',type:'現金股利',quantity:0,price:0,dividend:1000,fee:0}),sample({id:'old',date:'2010-01-01',code:'2330'})],expectedRevision:api.read().revisions.stockRecords});
 const a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;assert.equal(a.stockTotals.value.count,2);assert.ok(a.availableYears.value.includes(2010));const totals=JSON.stringify(a.stockTotals.value);
 a.stockTypeFilter.value='現金股利';assert.equal(a.filteredStockRecords.value.length,1);a.stockQuery.value='元大';assert.equal(a.filteredStockRecords.value.length,1);a.stockQuery.value='找不到';assert.equal(a.filteredStockRecords.value.length,0);assert.equal(JSON.stringify(a.stockTotals.value),totals);assert.equal(a.hasUnsavedChanges.value,false);
});
test('failed stock writes retain local data and retry confirms without duplicating entries',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();f.setMode('lost-confirmation');a.openAddStockModal();a.stockForm.value=sample();await a.saveStockRecord();assert.ok(a.pendingSave.value);assert.equal(a.stockRecords.value.length,1);const posts=f.posts();f.setMode('normal');await a.retrySave();assert.equal(f.posts(),posts);assert.equal(api.read().stockRecords.length,1);assert.equal(a.hasUnsavedChanges.value,false);
});
test('stock modal cancellation and deleted-row conflicts preserve unsaved data',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.openAddStockModal();a.stockForm.value.code='0050';f.setConfirm(false);a.closeStockModal();assert.equal(a.showStockModal.value,true);f.setConfirm(true);a.closeStockModal();assert.equal(a.hasUnsavedChanges.value,false);
 a.openAddStockModal();a.stockForm.value=sample();await a.saveStockRecord();const remote=api.read();api.post({action:'saveStocks',stockRecords:[{...remote.stockRecords[0],quantity:3000}],expectedRevision:remote.revisions.stockRecords});await a.deleteStockRecord(a.stockRecords.value[0].id);assert.ok(a.pendingSave.value);assert.equal(api.read().stockRecords[0].quantity,3000);
});
test('stock text remains literal, wrong headers are preserved and external cell adapter is removed',()=>{
 const api=backend();const first=api.read();assert.equal(api.post({action:'saveStocks',stockRecords:[sample({name:'=1+1',note:"'文字"})],expectedRevision:first.revisions.stockRecords}).status,'success');assert.equal(api.read().stockRecords[0].name,'=1+1');assert.equal(api.read().stockRecords[0].note,"'文字");
 assert.equal(api.read('stockSheet').status,'error');assert.equal(api.post({action:'saveStockCells',sheetId:101,changes:[]}).status,'error');
 const broken=backend(),rows=[['自訂欄位'],['原資料']];broken.seed('存股紀錄',rows);assert.ok(broken.read().datasetErrors.stockRecords);assert.equal(broken.post({action:'saveStocks',stockRecords:[],expectedRevision:broken.read().revisions.stockRecords}).status,'error');assert.equal(JSON.stringify(broken.sheets['存股紀錄'].rows),JSON.stringify(rows));
});
