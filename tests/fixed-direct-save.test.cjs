const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
async function setup(){const api=backend(),f=frontend(api),a=f.app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();a.openFixedExpenseForm();Object.assign(a.fixedExpenseForm.value,{title:'電話費',amount:500,date:'2026-10-05'});return {api,f,a};}
test('confirm adds fixed expense directly and closes the dialog only after confirmed persistence',async()=>{
 const {api,f,a}=await setup();const saving=a.submitFixedExpenseForm();assert.notEqual(a.fixedExpenseForm.value,null);assert.equal(a.isSubmitting.value,true);assert.equal(a.closeFixedExpenseForm(),false);assert.equal(await a.submitFixedExpenseForm(),false);assert.equal(await saving,true);assert.equal(f.posts(),1);assert.equal(a.fixedExpenseForm.value,null);assert.equal(api.read().transactions[0].category,'固定開銷');assert.equal(a.currentFixedExpenseTotal.value,500);assert.equal(a.dirtySections.value.includes('transactions'),false);
});
test('confirm editing updates an existing row and delete confirmation persists directly',async()=>{
 const {api,a}=await setup();await a.submitFixedExpenseForm();a.openFixedExpenseForm(a.currentFixedExpenses.value[0]);a.fixedExpenseForm.value.amount=650;assert.equal(await a.submitFixedExpenseForm(),true);assert.equal(api.read().transactions.length,1);assert.equal(api.read().transactions[0].amount,650);assert.equal(await a.deleteAndSaveFixedExpense(a.currentFixedExpenses.value[0].id),true);assert.equal(api.read().transactions.length,0);
});
test('offline submission retains dialog input and retries without creating another row',async()=>{
 const {api,f,a}=await setup();f.setMode('offline');assert.equal(await a.submitFixedExpenseForm(),false);assert.ok(a.fixedExpenseForm.value);assert.equal(a.fixedExpenseForm.value.title,'電話費');assert.ok(a.fixedExpenseFormError.value);assert.equal(a.showSuccessToast.value,false);assert.equal(api.read().transactions.length,0);f.setMode('normal');assert.equal(await a.submitFixedExpenseForm(),true);assert.equal(a.fixedExpenseForm.value,null);assert.equal(api.read().transactions.length,1);
});
test('lost confirmation retry reads persisted result without resending; global retry closes the form',async()=>{
 const {api,f,a}=await setup();f.setMode('lost-confirmation');assert.equal(await a.submitFixedExpenseForm(),false);assert.ok(a.fixedExpenseForm.value);assert.equal(api.read().transactions.length,1);assert.equal(f.posts(),1);f.setMode('normal');assert.equal(await a.retrySave(),true);assert.equal(a.fixedExpenseForm.value,null);assert.equal(f.posts(),1);assert.equal(api.read().transactions.length,1);
});
test('invalid form does not POST and keeps the dialog available for correction',async()=>{
 const {api,f,a}=await setup();a.fixedExpenseForm.value.amount=-1;assert.equal(await a.submitFixedExpenseForm(),false);assert.equal(f.posts(),0);assert.ok(a.fixedExpenseForm.value);assert.equal(api.read().transactions.length,0);
});
