const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../js/deposits/model.js');
const {backend,frontend}=require('./helpers.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));

test('manual deposit fields round trip ordinary spreadsheet cells without calculating interest or changing text',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.selectedYear.value=2026;
 assert.equal(a.depositsReady.value,true);assert.equal(a.currentDeposits.value.length,3);assert.equal(a.hasUnsavedChanges.value,false);
 Object.assign(a.currentDeposits.value[0],{amount:170000,rate:'1.50%',interest:2758,date:'無限期',status:'21號配息',note:'Line口袋'});
 Object.assign(a.currentDeposits.value[1],{amount:0,rate:'0%',interest:0,date:'2026/10/15',status:'到期',note:'手動備註'});
 assert.equal(f.posts(),0);assert.ok(a.dirtySections.value.includes('depositRecords'));
 a.currentAssetData.value.cash=1;assert.equal(await a.saveDepositRecords(),true);assert.equal(f.posts(),1);assert.equal(a.pendingSave.value,null);
 assert.deepEqual(Array.from(a.dirtySections.value),['assetsRecords']);
 const sheet=api.sheets['定存記錄-台幣'];assert.equal(sheet.rows[0].length,8);assert.equal(sheet.rows[1][3],'1.50%');assert.equal(sheet.rows[1][5],'無限期');assert.equal(sheet.rows[1][4],2758);
 const fresh=frontend(api).app;await fresh.fetchData();fresh.selectedYear.value=2026;assert.deepEqual(plain(fresh.currentDeposits.value),plain(a.currentDeposits.value));assert.equal(fresh.currentDeposits.value[2].amount,'');
});

test('years stay isolated, empty default years remain clean and add/remove rows persist',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;
 a.currentDeposits.value;assert.equal(a.hasUnsavedChanges.value,false);a.addDepositRow();assert.equal(a.hasUnsavedChanges.value,false);
 Object.assign(a.currentDeposits.value[3],{amount:10,rate:'1.5',interest:9,date:'11/1',status:'續存',note:'末列'});await a.saveDepositRecords();
 a.selectedYear.value=2027;assert.equal(a.currentDeposits.value[0].amount,'');assert.equal(a.hasUnsavedChanges.value,false);a.currentDeposits.value[0].amount=20;await a.saveDepositRecords();
 a.selectedYear.value=2026;assert.equal(a.currentDeposits.value.length,4);assert.equal(a.removeDepositRow(3),true);assert.equal(a.currentDeposits.value.length,3);await a.saveDepositRecords();
 assert.equal(api.read().depositRecords[2026],undefined);assert.equal(api.read().depositRecords[2027][0].amount,20);
});

test('cancelled row removal and invalid fields preserve saved data while validation remains renderable',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.currentDeposits.value[0].amount=10;await a.saveDepositRecords();const before=JSON.stringify(api.sheets['定存記錄-台幣'].rows);
 f.setConfirm(false);assert.equal(a.removeDepositRow(0),false);assert.equal(a.currentDeposits.value[0].amount,10);
 a.currentDeposits.value[0].amount=-1;assert.doesNotThrow(()=>a.hasUnsavedChanges.value);assert.equal(a.hasUnsavedChanges.value,true);assert.equal(await a.saveDepositRecords(),false);
 a.currentDeposits.value[0].amount=10;a.currentDeposits.value[0].rate='abc';assert.equal(a.hasUnsavedChanges.value,true);assert.equal(await a.saveDepositRecords(),false);
 assert.equal(JSON.stringify(api.sheets['定存記錄-台幣'].rows),before);
 assert.equal(api.post({action:'saveDeposits',depositRecords:{2026:[{amount:-1}]},expectedRevision:api.read().revisions.depositRecords}).status,'error');
});

test('lost confirmation retries without duplicate writes and concurrent changes cannot overwrite deposits',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.currentDeposits.value[0].amount=10;f.setMode('lost-confirmation');assert.equal(await a.saveDepositRecords(),false);assert.ok(a.pendingSave.value);
 f.setMode('normal');await a.retrySave();assert.equal(a.pendingSave.value,null);assert.equal(f.posts(),1);
 const other=frontend(api).app;await other.fetchData();a.currentDeposits.value[0].interest=2;await a.saveDepositRecords();other.currentDeposits.value[0].interest=3;
 assert.equal(await other.saveDepositRecords(),false);assert.match(other.syncError.value,/其他裝置/);assert.equal(api.read().depositRecords[a.selectedYear.value][0].interest,2);
});

test('unknown headers or duplicate sequence block deposit writes while other pages keep working',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.currentDeposits.value[0].amount=100;
 api.seed('定存記錄-台幣',[['自訂欄位'],['保留']]);await a.fetchData();assert.equal(a.depositsReady.value,false);assert.equal(a.currentDeposits.value[0].amount,100);assert.equal(await a.saveDepositRecords(),false);
 assert.equal(await a.saveAllSummaries(),true);assert.deepEqual(api.sheets['定存記錄-台幣'].rows,[['自訂欄位'],['保留']]);
 api.seed('定存記錄-台幣',[Array.from(api.ctx.DEPOSIT_HEADERS),[2026,1,1,'1%','','','',''],[2026,1,2,'1%','','','','']]);
 assert.ok(api.read().datasetErrors.depositRecords);const before=JSON.stringify(api.sheets['定存記錄-台幣'].rows);
 assert.equal(api.post({action:'saveDeposits',depositRecords:{},expectedRevision:api.read().revisions.depositRecords}).status,'error');assert.equal(JSON.stringify(api.sheets['定存記錄-台幣'].rows),before);
 api.resetReads();api.read('transactions');assert.equal(api.reads['定存記錄-台幣'],undefined);
});

test('legacy backend preserves staged deposits and blocks writes without breaking existing stock and cashflow',async()=>{
 const api=backend(),read=api.read;api.read=key=>{const r=read(key);r.protocolVersion=7;delete r.depositRecords;delete r.revisions.depositRecords;return r;};
 const f=frontend(api),a=f.app;await a.fetchData();assert.equal(a.depositsReady.value,false);assert.equal(a.stocksReady.value,true);assert.equal(a.cashflowReady.value,true);
 a.currentDeposits.value[0].amount=5;assert.equal(await a.saveDepositRecords(),false);assert.equal(f.posts(),0);await a.fetchData();assert.equal(a.currentDeposits.value[0].amount,5);assert.ok(a.dirtySections.value.includes('depositRecords'));
});

test('offline writes retain edits and show pending state; a cancelled refresh keeps input',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.currentDeposits.value[0].amount=170000;
 f.setConfirm(false);await a.fetchData();assert.equal(a.currentDeposits.value[0].amount,170000);
 const event={preventDefault(){this.prevented=true;}};f.emit('beforeunload',event);assert.equal(event.prevented,true);
 f.setMode('offline');assert.equal(await a.saveDepositRecords(),false);assert.ok(a.pendingSave.value);assert.equal(a.showSuccessToast.value,false);f.setMode('normal');await a.retrySave();assert.equal(a.pendingSave.value,null);
});

test('deposit model normalizes blanks and zero without mutating input, retaining row positions and free date/status text',()=>{
 const input={2026:[{amount:'0',rate:'1.50%',interest:'2758',date:'無限期',status:'21號配息',note:'Line口袋'}],2027:model.emptyYear()};const before=JSON.stringify(input),out=model.validateSnapshot(input);
 assert.deepEqual(Object.keys(out),['2026']);assert.equal(out[2026][0].amount,0);assert.equal(out[2026][0].interest,2758);assert.equal(out[2026].length,3);assert.equal(JSON.stringify(input),before);assert.notEqual(out[2026][1],out[2026][2]);
 assert.throws(()=>model.validateSnapshot({2026:[{interest:'Infinity'}]}),/非負/);assert.throws(()=>model.validateSnapshot({2026:[{unknown:1}]}),/欄位/);
});
