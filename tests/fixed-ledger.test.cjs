const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
const header=['日期','項目','金額','分類','類型'];
const plain=x=>JSON.parse(JSON.stringify(x));
function old(api,start='2026-09',end=''){const rows=[Array.from(api.ctx.FIXED_EXPENSE_HEADERS),['phone',start,end,'電話費',500,'生活開銷',31]];api.seed('每月固定開銷',plain(rows));return rows;}
async function open(api){const f=frontend(api),a=f.app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();return {f,a};}
test('legacy schedules project monthly records through this month without GET mutating the sheet',()=>{
 const api=backend(),legacy=old(api),r=api.read();const cutoff=new Date().toISOString().slice(0,7);assert.equal(r.protocolVersion,11);assert.equal(r.fixedExpensesMigrationPending,true);assert.ok(r.transactions.length>=1);assert.equal(r.transactions[0].date,'2026-09-30');assert.ok(r.transactions.every(t=>t.date.slice(0,7)<=cutoff));assert.equal(api.sheets['明細'],undefined);assert.deepEqual(api.sheets['每月固定開銷'].rows,legacy);
});
test('unchanged explicit save migrates once and preserves legacy sheet plus header notes',async()=>{
 const api=backend(),legacy=old(api);api.seed('明細',[header,['2026-10-01','餐費',100,'生活開銷','expense']]);api.sheets['明細'].getRange(1,5).setNote('原始備註');const {a,f}=await open(api);const count=api.read().transactions.length;assert.equal(a.hasUnsavedChanges.value,false);assert.equal(await a.saveFixedExpenses(),true);assert.equal(f.posts(),1);assert.equal(a.fixedExpensesMigrationPending.value,false);assert.equal(api.read().transactions.length,count);assert.deepEqual(api.sheets['每月固定開銷'].rows,legacy);assert.match(api.sheets['明細'].getRange(1,5).getNote(),/原始備註/);await a.saveFixedExpenses();assert.equal(f.posts(),1);
});
test('deleting migrated fixed rows cannot resurrect old schedules',async()=>{
 const api=backend(),legacy=old(api,'2026-10');const {a}=await open(api);for(const row of [...a.currentFixedExpenses.value]) a.deleteFixedExpense(row.id);assert.equal(await a.saveFixedExpenses(),true);await a.fetchData();assert.equal(a.currentFixedExpenses.value.length,0);assert.equal(api.read().fixedExpensesMigrationPending,false);assert.deepEqual(api.sheets['每月固定開銷'].rows,legacy);
});
test('category-only existing fixed rows are ordinary records without expansion or pending conversion',async()=>{
 const api=backend();api.seed('明細',[header,['2026-10-10','停車費',500,'固定開銷','expense'],['2026-10-10','停車費',500,'固定開銷','expense']]);const {a}=await open(api);assert.equal(a.currentFixedExpenses.value.length,2);assert.equal(a.fixedExpensesMigrationPending.value,false);a.currentMonthNum.value=11;assert.equal(a.currentFixedExpenses.value.length,0);
});
test('encoded ledger schedules migrate and take precedence over same legacy series',async()=>{
 const api=backend();old(api,'2026-09');const meta={id:'phone',endMonth:'2026-10',category:'生活開銷',payDay:5};api.seed('明細',[header,['2026-10-05','新版電話費',600,'固定開銷','fixed-expense:v1:'+JSON.stringify(meta)]]);const {a}=await open(api);assert.equal(api.read().transactions.length,1);assert.equal(a.currentFixedExpenses.value[0].amount,600);assert.equal(await a.saveFixedExpenses(),true);assert.equal(api.sheets['明細'].rows[1][4],'expense');assert.equal(api.read().transactions.length,1);
});
test('old ledger migration marker skips superseded independent source',()=>{
 const api=backend();old(api);api.seed('明細',[header,['2026-10-03','獨立項目',50,'固定開銷','expense']]);api.sheets['明細'].getRange(1,5).setNote('SKY_MONEYBOOK_FIXED_IN_LEDGER_V1');assert.equal(api.read().transactions.length,1);assert.equal(api.read().fixedExpensesMigrationPending,false);
});
test('corrupt old metadata stops transaction writes and keeps original data; unrelated pages still save',async()=>{
 const api=backend();api.seed('明細',[header,['2026-10-01','餐費',100,'生活開銷','expense'],['2026-10-02','損壞',500,'固定開銷','fixed-expense:v1:broken']]);const before=plain(api.sheets['明細'].rows),{a}=await open(api);assert.equal(a.fixedExpensesReady.value,false);assert.match(a.syncError.value,/讀取失敗/);assert.equal(await a.saveFixedExpenses(),false);const r=api.read('transactions');assert.ok(r.datasetErrors.transactions);assert.equal(api.post({action:'saveTransactions',transactions:[],expectedRevision:r.revisions.transactions}).status,'error');assert.deepEqual(api.sheets['明細'].rows,before);a.currentAssetData.value.cash=5;assert.equal(await a.saveAssetsRecord(),true);
});
test('unparseable legacy table blocks migration and remains untouched',()=>{
 const api=backend();api.seed('每月固定開銷',[['未知'],['保留']]);const r=api.read('transactions');assert.ok(r.datasetErrors.transactions);assert.equal(api.post({action:'saveTransactions',transactions:[],expectedRevision:r.revisions.transactions}).status,'error');assert.equal(api.sheets['明細'],undefined);
});
test('lost migration confirmation retries without POST or duplicate occurrences',async()=>{
 const api=backend();old(api,'2026-10');const {a,f}=await open(api);f.setMode('lost-confirmation');assert.equal(await a.saveFixedExpenses(),false);const count=api.read().transactions.length;f.setMode('normal');assert.equal(await a.retrySave(),true);assert.equal(f.posts(),1);assert.equal(api.read().transactions.length,count);assert.equal(a.fixedExpensesMigrationPending.value,false);
});
test('failed migration note restores original rows so retry cannot duplicate old schedules',async()=>{
 const api=backend();old(api,'2026-10');api.seed('明細',[header,['2026-10-01','餐費',100,'生活開銷','expense']]);const sheet=api.sheets['明細'],before=plain(sheet.rows),range=sheet.getRange.bind(sheet);let fail=true;sheet.getRange=(...args)=>{const r=range(...args);if(args[0]===1&&args[1]===5){const set=r.setNote;r.setNote=v=>{if(fail)throw Error('note failed');return set(v);};}return r;};const {a}=await open(api);assert.equal(await a.saveFixedExpenses(),false);assert.deepEqual(sheet.rows,before);fail=false;assert.equal(await a.retrySave(),true);assert.equal(api.read().transactions.length,2);
});
test('stale unified revisions reject overwrite and deprecated fixed save is refused',()=>{
 const api=backend();const r=api.read('transactions'),tx={id:1,date:'2026-10-01',title:'費用',amount:10,category:'固定開銷',type:'expense'};assert.equal(api.post({action:'saveTransactions',transactions:[tx],expectedRevision:r.revisions.transactions}).status,'success');assert.equal(api.post({action:'saveTransactions',transactions:[],expectedRevision:r.revisions.transactions}).status,'conflict');assert.equal(api.read().transactions.length,1);assert.equal(api.post({action:'saveFixedExpenses',fixedExpenses:{},expectedRevision:api.read().revisions.fixedExpenses}).status,'error');
});
test('finite old periods end on their last month and explicit future start is retained once',()=>{
 const api=backend();old(api,'2024-01','2024-02');let r=api.read();assert.equal(r.transactions.length,2);assert.equal(r.transactions[1].date,'2024-02-29');old(api,'2099-02','');r=api.read();assert.equal(r.transactions.length,1);assert.equal(r.transactions[0].date,'2099-02-28');
});
