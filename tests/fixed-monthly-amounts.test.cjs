const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {backend,frontend}=require('./helpers.cjs');
async function create(){const api=backend();api.seed('明細',[['日期','項目','金額','分類','類型'],['2026-10-01','午餐',100,'生活開銷','expense'],['2026-10-02','電話費',500,'固定開銷','expense'],['2026-11-01','電話費',700,'固定開銷','expense'],['2026-10-03','保險',900,'保險開銷','expense']]);const a=frontend(api).app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();return {api,a};}
test('living expenses include fixed category exactly once and exclude unrelated categories',async()=>{
 const {a}=await create();assert.equal(a.getLivingExpenseTotalForMonth(2026,10),600);assert.equal(a.getLivingExpenseTotalForMonth(2026,11),700);assert.equal(a.getLivingExpenseTotalForMonth(2026,12),0);assert.equal(a.categoryTotals.value['生活開銷'],100);assert.equal(a.categoryTotals.value['固定開銷'],500);assert.equal(a.categoryTotals.value['保險開銷'],900);assert.equal(a.currentSummary.value.livingExpense,600);
});
test('staged fixed changes must be persisted before annual summary save',async()=>{
 const {a,api}=await create();a.openFixedExpenseForm(a.currentFixedExpenses.value[0]);a.fixedExpenseForm.value.amount=650;a.applyFixedExpenseForm();assert.equal(await a.saveAllSummaries(),false);assert.match(a.syncError.value,/先.*儲存開銷明細/);await a.saveFixedExpenses();assert.equal(await a.saveAllSummaries(),true);assert.equal(api.read().summaries[2026][10].livingExpense,750);assert.equal(api.read().summaries[2026][11].livingExpense,700);
});
test('bulk delete ordinary records preserves fixed transactions and other months',async()=>{
 const {a,api}=await create();a.toggleAllVisibleTransactions(true);await a.deleteSelectedTransactions();assert.equal(a.currentFixedExpenseTotal.value,500);assert.equal(api.read().transactions.length,2);assert.equal(a.getLivingExpenseTotalForMonth(2026,10),500);assert.equal(a.getLivingExpenseTotalForMonth(2026,11),700);
});
test('classification uses the exact fixed category and preserves duplicate independent rows',async()=>{
 const {a,api}=await create();api.sheets['明細'].rows.push(['2026-10-04','電話費',500,'固定開銷','expense'],['2026-10-04','其他',5,'固定開銷備註','expense']);await a.fetchData();assert.equal(a.currentFixedExpenses.value.length,2);assert.equal(a.currentFixedExpenseTotal.value,1000);assert.equal(a.getLivingExpenseTotalForMonth(2026,10),1100);assert.equal(a.monthlyTransactions.value.length,3);
});
test('fixed dialog retains its category while ordinary entry omits the fixed option',()=>{
 const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/<option value="固定開銷">固定開銷<\/option>/);assert.match(html,/<input value="固定開銷" readonly/);assert.match(html,/v-model="fixedExpenseForm.date" type="date"/);assert.doesNotMatch(html,/fixedExpenseForm\.(scope|payDay)/);assert.doesNotMatch(html,/FixedExpenseModel/);
});
