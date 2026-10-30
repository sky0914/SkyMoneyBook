const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
async function create(){const api=backend(),f=frontend(api),a=f.app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();return {api,f,a};}
function add(a,title='電話費',amount=500,date='2026-10-05'){assert.equal(a.openFixedExpenseForm(),true);Object.assign(a.fixedExpenseForm.value,{title,amount,date});assert.equal(a.applyFixedExpenseForm(),true);return a.currentFixedExpenses.value.find(r=>r.title===title);}

test('fixed expenses belong only to the selected month and use the ordinary transaction dataset',async()=>{
 const {a}=await create();add(a);assert.equal(a.currentFixedExpenseTotal.value,500);assert.equal(a.currentFixedExpenses.value.length,1);assert.equal(a.currentFixedExpenses.value[0].category,'固定開銷');assert.equal(a.monthlyTransactions.value.length,0);assert.ok(a.dirtySections.value.includes('transactions'));
 a.currentMonthNum.value=11;assert.equal(a.currentFixedExpenses.value.length,0);a.currentMonthNum.value=9;assert.equal(a.currentFixedExpenses.value.length,0);a.currentMonthNum.value=10;assert.equal(a.currentFixedExpenseTotal.value,500);
});
test('each month can have different amounts and editing or deleting one month leaves the other unchanged',async()=>{
 const {a}=await create();const row=add(a);a.currentMonthNum.value=11;add(a,'電話費',800,'2026-11-06');a.currentMonthNum.value=10;a.openFixedExpenseForm(row);a.fixedExpenseForm.value.amount=600;a.applyFixedExpenseForm();assert.equal(a.currentFixedExpenseTotal.value,600);a.currentMonthNum.value=11;assert.equal(a.currentFixedExpenseTotal.value,800);a.deleteFixedExpense(a.currentFixedExpenses.value[0].id);a.currentMonthNum.value=10;assert.equal(a.currentFixedExpenseTotal.value,600);
});
test('category dropdown transactions appear in the fixed section and changing category moves them back',async()=>{
 const {a}=await create();a.form.value={title:'網路費',amount:400,date:'2026-10-02',category:'固定開銷'};await a.saveTransaction();assert.equal(a.currentFixedExpenses.value.length,1);assert.equal(a.monthlyTransactions.value.length,0);
 a.openEditModal(a.currentFixedExpenses.value[0]);a.form.value.category='生活開銷';await a.saveTransaction();assert.equal(a.currentFixedExpenses.value.length,0);assert.equal(a.monthlyTransactions.value.length,1);
});
test('save and reload use original five-column ledger and do not create a fixed expense sheet',async()=>{
 const {api,a}=await create();add(a);assert.equal(await a.saveFixedExpenses(),true);assert.equal(api.sheets['明細'].rows.length,2);assert.deepEqual(JSON.parse(JSON.stringify(api.sheets['明細'].rows[1])),['2026-10-05','電話費',500,'固定開銷','expense']);assert.equal(api.sheets['每月固定開銷'],undefined);
 const fresh=frontend(api).app;fresh.selectedYear.value=2026;fresh.currentMonthNum.value=10;await fresh.fetchData();assert.equal(fresh.currentFixedExpenseTotal.value,500);assert.equal(fresh.hasUnsavedChanges.value,false);fresh.currentMonthNum.value=11;assert.equal(fresh.currentFixedExpenseTotal.value,0);
});
test('invalid amounts or dates and stale month forms do not mutate transactions',async()=>{
 const {a}=await create();a.openFixedExpenseForm();Object.assign(a.fixedExpenseForm.value,{title:'測試',amount:-1});assert.equal(a.applyFixedExpenseForm(),false);a.fixedExpenseForm.value.amount=10;a.fixedExpenseForm.value.date='2026-10-32';assert.equal(a.applyFixedExpenseForm(),false);a.fixedExpenseForm.value.date='2026-09-30';assert.equal(a.applyFixedExpenseForm(),false);a.fixedExpenseForm.value.date='2026-10-01';a.currentMonthNum.value=11;assert.equal(a.applyFixedExpenseForm(),false);assert.equal(a.currentFixedExpenses.value.length,0);assert.equal(a.monthlyTransactions.value.length,0);
});
test('unsaved drafts and staged deletions are guarded; cancel preserves data',async()=>{
 const {a,f}=await create();a.openFixedExpenseForm();a.fixedExpenseForm.value.title='草稿';f.setConfirm(false);assert.equal(a.closeFixedExpenseForm(),false);assert.equal(await a.saveFixedExpenses(),false);const e={preventDefault(){this.prevented=true;}};f.emit('beforeunload',e);assert.equal(e.prevented,true);f.setConfirm(true);a.closeFixedExpenseForm();const row=add(a);f.setConfirm(false);assert.equal(a.deleteFixedExpense(row.id),false);assert.equal(a.currentFixedExpenses.value.length,1);f.setConfirm(true);a.deleteFixedExpense(row.id);assert.equal(a.currentFixedExpenses.value.length,0);
});
test('lost confirmation retries with GET and no duplicate records',async()=>{
 const {a,f,api}=await create();add(a);f.setMode('lost-confirmation');assert.equal(await a.saveFixedExpenses(),false);assert.ok(a.pendingSave.value);f.setMode('normal');await a.retrySave();assert.equal(f.posts(),1);assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,1);
});
test('another device changing ordinary records conflicts with a stale fixed save',async()=>{
 const {a,api}=await create(),b=frontend(api).app;b.selectedYear.value=2026;b.currentMonthNum.value=10;await b.fetchData();add(a);await a.saveFixedExpenses();b.form.value={title:'晚餐',amount:100,date:'2026-10-10',category:'生活開銷'};await b.saveTransaction();assert.ok(b.pendingSave.value);assert.match(b.syncError.value,/其他裝置/);assert.equal(api.read().transactions.length,1);
});
test('older backend keeps unrelated pages available but fixed editing is disabled',async()=>{
 const api=backend(),read=api.read;api.read=k=>{const r=read(k);r.protocolVersion=8;return r;};const a=frontend(api).app;await a.fetchData();assert.equal(a.fixedExpensesReady.value,false);assert.equal(a.openFixedExpenseForm(),false);assert.equal(await a.saveFixedExpenses(),false);assert.equal(a.depositsReady.value,true);
});
test('version 10 cannot write unified monthly transactions to the old recurring backend',async()=>{
 const api=backend(),read=api.read;api.read=k=>{const r=read(k);r.protocolVersion=10;return r;};const f=frontend(api),a=f.app;await a.fetchData();a.form.value={title:'測試',amount:10,date:'2026-10-01',category:'固定開銷'};await a.saveTransaction();assert.equal(f.posts(),0);assert.match(a.syncError.value,/版本 11/);
});
test('fixed date validation respects month ends and leap years',async()=>{
 const {a}=await create();a.currentMonthNum.value=2;a.openFixedExpenseForm();Object.assign(a.fixedExpenseForm.value,{title:'費用',amount:10,date:'2026-02-29'});assert.equal(a.applyFixedExpenseForm(),false);a.closeFixedExpenseForm();a.selectedYear.value=2024;a.openFixedExpenseForm();Object.assign(a.fixedExpenseForm.value,{title:'費用',amount:10,date:'2024-02-29'});assert.equal(a.applyFixedExpenseForm(),true);assert.equal(a.currentFixedExpenses.value[0].date,'2024-02-29');
});
