const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const fixtures=[
 ['2026-10-14','午餐',100,'生活開銷','expense'],
 ['2026-10-13','晚餐',200,'生活開銷','expense'],
 ['2026-10-12','書籍',300,'其它','expense'],
 ['2026-09-01','午餐',400,'生活開銷','expense'],
 ['2025-10-01','午餐',500,'生活開銷','expense']
];
async function create(){
 const api=backend();api.seed('明細',[['日期','項目','金額','分類','類型'],...fixtures.map(row=>row.slice())]);
 const f=frontend(api),a=f.app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();return {api,f,a};
}

test('individual selection and visible select-all change neither amounts nor dirty state',async()=>{
 const {a,f}=await create(),before=JSON.stringify(a.categoryTotals.value);
 assert.equal(a.selectedTransactions.value.length,0);assert.equal(a.allVisibleTransactionsSelected.value,false);
 a.toggleTransactionSelection(1,true);assert.equal(a.selectedTransactions.value.length,1);assert.equal(a.selectedTransactionsAmount.value,100);
 assert.equal(a.allVisibleTransactionsSelected.value,false);a.toggleAllVisibleTransactions(true);
 assert.equal(a.selectedTransactions.value.length,3);assert.equal(a.allVisibleTransactionsSelected.value,true);assert.equal(a.selectedTransactionsAmount.value,600);
 a.toggleTransactionSelection(2,false);assert.equal(a.selectedTransactions.value.length,2);assert.equal(a.allVisibleTransactionsSelected.value,false);
 a.toggleAllVisibleTransactions(false);assert.equal(a.selectedTransactions.value.length,0);
 a.toggleTransactionSelection(4,true);a.toggleTransactionSelection(999,true);assert.equal(a.selectedTransactions.value.length,0);
 assert.equal(JSON.stringify(a.categoryTotals.value),before);assert.equal(a.hasUnsavedChanges.value,false);assert.equal(f.posts(),0);
});

test('filtered batch delete uses one write, preserves hidden rows and other months/years, and reloads correctly',async()=>{
 const {api,f,a}=await create();a.searchQuery.value='餐';a.toggleAllVisibleTransactions(true);
 assert.equal(a.selectedTransactions.value.length,2);assert.equal(a.selectedTransactionsAmount.value,300);
 assert.equal(await a.deleteSelectedTransactions(),true);assert.equal(f.posts(),1);assert.equal(a.pendingSave.value,null);
 assert.match(f.confirmations.at(-1),/2026 年 10 月/);assert.match(f.confirmations.at(-1),/2 筆/);assert.match(f.confirmations.at(-1),/300/);
 const remaining=api.read().transactions;assert.deepEqual(remaining.map(t=>t.title),['書籍','午餐','午餐']);
 assert.deepEqual(remaining.map(t=>t.date),['2026-10-12','2026-09-01','2025-10-01']);
 assert.equal(a.selectedTransactions.value.length,0);assert.equal(a.hasUnsavedChanges.value,false);assert.match(a.toastMessage.value,/2 筆/);
 const fresh=frontend(api).app;fresh.selectedYear.value=2026;fresh.currentMonthNum.value=10;await fresh.fetchData();
 assert.equal(fresh.monthlyTransactions.value.length,1);assert.equal(fresh.monthlyTransactions.value[0].title,'書籍');assert.equal(fresh.categoryTotals.value['其它'],300);
});

test('cancel and empty selection never delete or send a request',async()=>{
 const {api,f,a}=await create(),before=JSON.stringify(api.read().transactions);
 assert.equal(await a.deleteSelectedTransactions(),false);assert.equal(f.confirmations.length,0);
 a.toggleAllVisibleTransactions(true);f.setConfirm(false);assert.equal(await a.deleteSelectedTransactions(),false);
 assert.equal(a.selectedTransactions.value.length,3);assert.equal(a.monthlyTransactions.value.length,3);assert.equal(f.posts(),0);
 assert.equal(JSON.stringify(api.read().transactions),before);assert.equal(a.pendingSave.value,null);
});

test('changed search/month/year cannot target hidden selections',async()=>{
 const {f,a}=await create();a.toggleAllVisibleTransactions(true);a.searchQuery.value='書籍';
 assert.equal(a.selectedTransactions.value.length,0);assert.equal(await a.deleteSelectedTransactions(),false);
 a.toggleAllVisibleTransactions(true);assert.equal(a.selectedTransactions.value[0].title,'書籍');
 a.currentMonthNum.value=9;assert.equal(a.selectedTransactions.value.length,0);assert.equal(await a.deleteSelectedTransactions(),false);
 a.searchQuery.value='';a.toggleAllVisibleTransactions(true);assert.equal(a.selectedTransactionsAmount.value,400);
 a.selectedYear.value=2025;assert.equal(a.selectedTransactions.value.length,0);assert.equal(await a.deleteSelectedTransactions(),false);
 assert.equal(f.posts(),0);assert.equal(f.confirmations.length,0);
});

test('cloud reload and every confirmed transaction save clear selection before regenerated row IDs are reused',async()=>{
 const {a,api}=await create();a.toggleTransactionSelection(1,true);await a.fetchData();assert.equal(a.selectedTransactions.value.length,0);
 a.toggleTransactionSelection(1,true);a.toggleTransactionSelection(2,true);await a.deleteSelectedTransactions();
 assert.equal(a.filteredTransactions.value[0].title,'書籍');assert.equal(a.filteredTransactions.value[0].id,1);assert.equal(a.selectedTransactions.value.length,0);
 a.toggleTransactionSelection(1,true);a.openEditModal(a.filteredTransactions.value[0]);a.form.value.amount=333;await a.saveTransaction();assert.equal(a.selectedTransactions.value.length,0);
 a.toggleAllVisibleTransactions(true);await a.deleteSelectedTransactions();assert.equal(a.filteredTransactions.value.length,0);
 assert.deepEqual(api.read().transactions.map(t=>t.date),['2026-09-01','2025-10-01']);
});

test('lost confirmation retains a retryable delete and recovers with no duplicate write',async()=>{
 const {api,f,a}=await create();a.toggleTransactionSelection(1,true);f.setMode('lost-confirmation');
 assert.equal(await a.deleteSelectedTransactions(),false);assert.ok(a.pendingSave.value);assert.equal(a.showSuccessToast.value,false);assert.equal(api.read().transactions.length,4);
 assert.equal(a.selectedTransactions.value.length,0);a.toggleAllVisibleTransactions(true);assert.equal(a.selectedTransactions.value.length,0);
 assert.equal(await a.deleteSelectedTransactions(),false);const posts=f.posts();f.setMode('normal');await a.retrySave();
 assert.equal(f.posts(),posts);assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,4);assert.equal(a.selectedTransactions.value.length,0);
});

test('offline deletion stays pending and sync retry writes once; other page edits remain unsaved',async()=>{
 const {api,f,a}=await create();a.currentAssetData.value.cash=50;a.toggleAllVisibleTransactions(true);f.setMode('offline');
 assert.equal(await a.deleteSelectedTransactions(),false);assert.equal(a.monthlyTransactions.value.length,0);assert.equal(api.read().transactions.length,5);
 assert.ok(a.pendingSave.value);assert.equal(a.hasUnsavedChanges.value,true);f.setMode('normal');await a.retrySave();
 assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,2);assert.equal(f.posts(),1);
 assert.deepEqual(Array.from(a.dirtySections.value),['assetsRecords']);
});

test('concurrent remote changes refuse batch overwrite and keep remote records intact',async()=>{
 const {api,f,a}=await create();a.toggleAllVisibleTransactions(true);
 const cloud=api.read();cloud.transactions.push({id:999,date:'2026-10-15',title:'另一裝置新增',amount:10,category:'其它',type:'expense'});
 assert.equal(api.post({action:'saveTransactions',transactions:cloud.transactions,expectedRevision:cloud.revisions.transactions}).status,'success');
 const remote=plain(api.read().transactions);assert.equal(await a.deleteSelectedTransactions(),false);assert.ok(a.pendingSave.value);assert.match(a.syncError.value,/其他裝置/);
 assert.deepEqual(plain(api.read().transactions),remote);assert.equal(a.monthlyTransactions.value.length,0);
 const posts=f.posts();await a.deleteSelectedTransactions();assert.equal(f.posts(),posts);
});

test('busy or missing initial cloud load prevents batch deletion',async()=>{
 const {f,a}=await create();a.toggleAllVisibleTransactions(true);a.isSubmitting.value=true;
 a.toggleAllVisibleTransactions(false);assert.equal(await a.deleteSelectedTransactions(),false);assert.equal(f.posts(),0);assert.equal(a.selectedTransactions.value.length,3);
 const initial=frontend(backend());initial.setMode('offline');await initial.app.fetchData();assert.equal(await initial.app.deleteSelectedTransactions(),false);assert.equal(initial.posts(),0);
});
