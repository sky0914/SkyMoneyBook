const test=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
test('cashflow grid stages edits, totals image values and submits ordinary columns once',async()=>{
 const api=backend(),h=frontend(api),a=h.app;await a.fetchData();assert.equal(a.cashflowReady.value,true);assert.equal(a.hasUnsavedChanges.value,false);
 const r=a.currentCashflow.value;r.months[1]={fundTWD:13763,fundUSD:6382,etfTWD:9713,allianzUSD:3388,insurance:''};r.months[7].insurance=40500;r.months[10].fundUSD=0;r.depositTWD=2758;r.depositUSD=670;
 assert.equal(a.cashflowMonthTotal(1),33246);assert.equal(a.cashflowAnnualTotal.value,77174);assert.equal(h.posts(),0);assert.ok(a.dirtySections.value.includes('cashflowRecords'));
 a.currentYearSummaries.value[1].salary=1;
 assert.equal(await a.saveCashflowRecord(),true);assert.equal(h.posts(),1);assert.ok(!a.dirtySections.value.includes('cashflowRecords'));assert.ok(a.dirtySections.value.includes('summaries'));
 const sheet=api.sheets['現金流配息記錄'];assert.equal(sheet.rows.length,14);assert.equal(sheet.rows[0].length,9);assert.equal(sheet.rows[1][1],0);assert.equal(sheet.rows[2][6],'');assert.equal(sheet.rows[11][3],0);
 const saved=api.read('cashflowRecords');assert.equal(saved.cashflowRecords[a.selectedYear.value].months[1].fundTWD,13763);assert.equal(saved.cashflowRecords[a.selectedYear.value].depositUSD,670);
 a.selectedYear.value=2035;a.currentCashflow.value;assert.ok(!a.dirtySections.value.includes('cashflowRecords'));
});
test('cashflow lost confirmation retries without duplicate POST and stale changes cannot overwrite',async()=>{
 const api=backend(),h=frontend(api),a=h.app;await a.fetchData();a.currentCashflow.value.months[1].etfTWD=123.45;h.setMode('lost-confirmation');assert.equal(await a.saveCashflowRecord(),false);assert.ok(a.pendingSave.value);h.setMode('normal');assert.equal(await a.retrySave(),true);assert.equal(h.posts(),1);
 const other=frontend(api).app;await other.fetchData();a.currentCashflow.value.months[1].etfTWD=200;await a.saveCashflowRecord();other.currentCashflow.value.months[1].etfTWD=300;assert.equal(await other.saveCashflowRecord(),false);assert.equal(api.read().cashflowRecords[a.selectedYear.value].months[1].etfTWD,200);
});
test('invalid cashflow values and unknown headers preserve stored data; targeted reads are isolated',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.currentCashflow.value.months[2].fundTWD=-1;assert.equal(a.saveCashflowRecord(),false);assert.equal(api.sheets['現金流配息記錄'],undefined);
 const data=JSON.parse(JSON.stringify(a.cashflowRecords.value)),rev=api.read().revisions.cashflowRecords;assert.equal(api.post({action:'saveCashflow',cashflowRecords:data,expectedRevision:rev}).status,'error');
 api.seed('現金流配息記錄',[['舊格式'],[123]]);await a.fetchData();assert.equal(a.cashflowReady.value,false);assert.ok(a.syncError.value.includes('配息'));assert.equal(await a.saveAllSummaries(),true);assert.deepEqual(api.sheets['現金流配息記錄'].rows,[['舊格式'],[123]]);
 api.resetReads();api.read('transactions');assert.equal(api.reads['現金流配息記錄'],undefined);
});
test('older backend leaves existing pages usable and disables cashflow writes',async()=>{
 const api=backend(),read=api.read;api.read=key=>{const data=read(key);data.protocolVersion=4;delete data.cashflowRecords;delete data.revisions.cashflowRecords;return data};
 const a=frontend(api).app;await a.fetchData();assert.equal(a.cashflowReady.value,false);assert.equal(a.syncError.value,'');assert.equal(await a.saveCashflowRecord(),false);a.currentYearSummaries.value[1].salary=42;assert.equal(await a.saveAllSummaries(),true);
});
