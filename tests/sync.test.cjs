const {test}=require('node:test');
const assert=require('node:assert/strict');
const {backend,frontend}=require('./helpers.cjs');
test('backend round trips all datasets using original five-column transactions',()=>{
 const api=backend();
 const fixtures={transactions:[{id:777,date:'2026-10-14',title:'test',amount:100,category:'其它',type:'expense'}],summaries:{2026:{1:{month:1,salary:100,note:'test'}}},assetsRecords:{'2026-10':{date:'2026-10-14',cash:50}},fundsRecords:{2026:{allianz:{months:{1:{value:50}}}}}};
 for(const [action,key] of Object.entries({saveTransactions:'transactions',saveSummary:'summaries',saveAssets:'assetsRecords',saveFunds:'fundsRecords'})){
 const out=api.post({action,[key]:fixtures[key],expectedRevision:api.read().revisions[key]});assert.equal(out.status,'success');assert.ok(api.read()[key]);
 }
 assert.equal(api.read().transactions[0].id,1);assert.equal(api.sheets['明細'].rows[0].length,5);assert.equal(api.read().fundsRecords[2026].allianz.months[1].value,50);
});
test('backend rejects stale revisions, invalid amounts and unknown actions without changes',()=>{
 const api=backend();const before=JSON.stringify(api.read());
 assert.equal(api.post({action:'saveTransactions',transactions:[],expectedRevision:'stale'}).status,'conflict');
 assert.equal(api.post({action:'saveTransactions',transactions:[{id:1,date:'2026-10-14',title:'bad',amount:-1}],expectedRevision:api.read().revisions.transactions}).status,'error');
 assert.equal(api.post({action:'unknown',expectedRevision:'x'}).status,'error');assert.equal(JSON.stringify(api.read()),before);
});
test('frontend verifies writes, normalizes summaries, saves funds and assets',async()=>{
 const api=backend(), f=frontend(api),a=f.app;await a.fetchData();
 a.form.value={date:'2026-10-14',title:'test',amount:100,category:'其它'};await a.saveTransaction();
 assert.equal(a.showSuccessToast.value,true);assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,1);
 a.currentYearSummaries.value[1].salary=123;await a.saveAllSummaries();assert.equal(a.pendingSave.value,null);assert.equal(api.read().summaries[a.selectedYear.value][1].salary,123);
 a.currentAssetData.value.cash=50;await a.saveAssetsRecord();assert.equal(a.pendingSave.value,null);
 a.currentFundsData.value.allianz.baseValue=99;await a.saveFundsRecord();assert.equal(a.pendingSave.value,null);
});
test('opaque response alone never reports success; retry retains the same transaction',async()=>{
 const api=backend(), f=frontend(api),a=f.app;await a.fetchData();f.setMode('drop');
 a.form.value={date:'2026-10-14',title:'test',amount:100,category:'其它'};await a.saveTransaction();
 assert.equal(a.showSuccessToast.value,false);assert.ok(a.pendingSave.value);assert.ok(a.syncError.value);
 f.setMode('normal');await a.retrySave();assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,1);
});
test('failed initial load blocks writes, and concurrent cloud changes block overwrite',async()=>{
 const api=backend(),f=frontend(api),a=f.app;f.setMode('offline');await a.fetchData();await a.saveFundsRecord();assert.equal(f.posts(),0);
 f.setMode('normal');await a.fetchData();const remote=api.read();api.post({action:'saveFunds',fundsRecords:{2020:{allianz:{baseValue:42}}},expectedRevision:remote.revisions.fundsRecords});
 await a.saveFundsRecord();assert.equal(f.posts(),1);assert.equal(api.read().fundsRecords[2020].allianz.baseValue,42);assert.ok(a.syncError.value.includes('其他裝置'));assert.ok(a.pendingSave.value);
});
test('funds use named ordinary cells; empty and zero values round trip',()=>{
 const api=backend();
 const funds={2026:{entieTWD:{baseTotalInv:1000,baseValue:0,baseNote:'期初',months:{1:{interest:0,investment:100,fee:'',totalInvestment:1100,value:1150,note:'一月'}}},entieUSD:{months:{2:{interest:2.5,value:200}}},allianz:{months:{3:{interestUSD:3.5,rate:32.1,value:500,note:'安聯'}}}}};
 assert.equal(api.post({action:'saveFunds',fundsRecords:funds,expectedRevision:api.read().revisions.fundsRecords}).status,'success');
 const rows=api.sheets['基金投資明細'].rows;
 assert.equal(rows.length,40);assert.equal(rows[0].includes('JSON'),false);
 const base=rows.find(r=>r[1]==='安泰台幣'&&r[2]===0),jan=rows.find(r=>r[1]==='安泰台幣'&&r[2]===1),march=rows.find(r=>r[1]==='安聯'&&r[2]===3);
 assert.equal(base[8],1000);assert.equal(base[9],0);assert.equal(jan[3],0);assert.equal(jan[7],'');assert.equal(march[4],3.5);assert.equal(march[5],32.1);
 const read=api.read().fundsRecords[2026];assert.equal(read.entieTWD.months[1].fee,'');assert.equal(read.allianz.months[3].note,'安聯');
});
test('existing JSON fund data is read only; new saves create ordinary cells without touching it',()=>{
 const api=backend(),legacy=[['年份','JSON'],[2026,JSON.stringify({allianz:{baseValue:80,months:{1:{value:100}}}})]];
 api.seed('基金投資',legacy);
 const before=api.read();assert.equal(before.fundsRecords[2026].allianz.baseValue,80);
 assert.equal(api.post({action:'saveFunds',fundsRecords:before.fundsRecords,expectedRevision:before.revisions.fundsRecords}).status,'success');
 assert.equal(JSON.stringify(api.sheets['基金投資'].rows),JSON.stringify(legacy));
 assert.ok(api.sheets['基金投資明細']);assert.equal(api.read().fundsRecords[2026].allianz.months[1].value,100);
});
test('original asset and summary column order is preserved including zeros, notes and Date month cells',()=>{
 const api=backend();
 api.seed('資產負債',[['記錄年月','備註日期'],[new Date('2026-01-01T00:00:00Z'),new Date('2026-01-02T00:00:00Z')]]);
 const read=api.read();assert.equal(read.assetsRecords['2026-01'].date,'2026-01-02');
 // Full original header obtained from a fresh save, then preserve it on another save.
 const fresh=backend();const asset={date:'2026-01-02',cash:99,rateJPY:0,note:'測試'};
 assert.equal(fresh.post({action:'saveAssets',assetsRecords:{'2026-01':asset},expectedRevision:fresh.read().revisions.assetsRecords}).status,'success');
 const header=fresh.sheets['資產負債'].rows[0].slice();assert.equal(header.length,42);assert.equal(header[0],'記錄年月');assert.equal(header[41],'備註');
 const next=fresh.read();next.assetsRecords['2026-01'].cash=100;
 assert.equal(fresh.post({action:'saveAssets',assetsRecords:next.assetsRecords,expectedRevision:next.revisions.assetsRecords}).status,'success');
 assert.deepEqual(Array.from(fresh.sheets['資產負債'].rows[0]),Array.from(header));assert.equal(fresh.read().assetsRecords['2026-01'].rateJPY,0);assert.equal(fresh.read().assetsRecords['2026-01'].note,'測試');
 assert.equal(fresh.post({action:'saveSummary',summaries:{2026:{12:{salary:100,insurance:2,extraIncome:3,livingExpense:4,insuranceExpense:5,otherExpense:6,familyExpense:7,note:'年底'}}},expectedRevision:fresh.read().revisions.summaries}).status,'success');
 assert.deepEqual(Array.from(fresh.sheets['年度摘要'].rows[1]),['2026',12,100,2,3,4,5,6,7,'年底']);
});
test('partial summary and fund records initialize every page without losing existing fields',async()=>{
 const api=backend();api.seed('年度摘要',[['年份','月份','薪資收入','勞健保等','額外收入','生活開銷','保險開銷','其它開銷','家庭開銷','備註'],[2026,1,10,0,0,0,0,0,0,'保留']]);
 const f=frontend(api),a=f.app;a.selectedYear.value=2026;await a.fetchData();
 assert.equal(a.currentYearSummaries.value[1].salary,10);assert.equal(a.currentYearSummaries.value[12].salary,0);
 assert.equal(a.currentFundsData.value.allianz.months[12].value,'');assert.equal(a.currentFundsData.value.entieUSD.months[1].interest,'');
 await a.saveAllSummaries();assert.equal(a.pendingSave.value,null);assert.equal(api.read().summaries[2026][1].note,'保留');
});
test('editing and deleting synchronize regenerated row IDs without extra sheet columns',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();
 for(const title of ['first','second']){a.isEditing.value=false;a.form.value={date:'2026-10-14',title,amount:10,category:'其它'};await a.saveTransaction();assert.equal(a.pendingSave.value,null)}
 a.currentMonthNum.value=10;a.selectedYear.value=2026;
 const tx=a.filteredTransactions.value.find(t=>t.title==='first');a.openEditModal(tx);a.form.value.amount=20;await a.saveTransaction();assert.equal(api.read().transactions.find(t=>t.title==='first').amount,20);
 await a.deleteTransaction(a.filteredTransactions.value.find(t=>t.title==='second').id);assert.equal(api.read().transactions.length,1);assert.equal(api.read().transactions[0].title,'first');assert.equal(api.sheets['明細'].rows[0].length,5);
});
test('unrecognized fund sheet blocks only fund writes and preserves existing sheet data',async()=>{
 const api=backend(),rows=[['自訂基金欄位'],['keep me']];api.seed('基金投資',rows);
 const data=api.read();assert.ok(data.datasetErrors.fundsRecords);assert.ok(Array.isArray(data.transactions));
 assert.equal(api.post({action:'saveFunds',fundsRecords:{},expectedRevision:data.revisions.fundsRecords}).status,'error');
 assert.equal(JSON.stringify(api.sheets['基金投資'].rows),JSON.stringify(rows));
 const a=frontend(api).app;await a.fetchData();assert.ok(a.syncError.value.includes('基金'));
 a.form.value={date:'2026-10-14',title:'其他頁面',amount:10,category:'其它'};await a.saveTransaction();assert.equal(a.pendingSave.value,null);assert.equal(api.read().transactions.length,1);
});
test('unexpected existing headers refuse replacement without changing worksheet contents',()=>{
 const api=backend(),rows=[['日期','金額','項目','分類','類型'],['2026-10-14',100,'original','其它','expense']];api.seed('明細',rows);
 const data=api.read();const out=api.post({action:'saveTransactions',transactions:[{id:1,date:'2026-10-14',title:'new',amount:10,category:'其它',type:'expense'}],expectedRevision:data.revisions.transactions});
 assert.equal(out.status,'error');assert.equal(JSON.stringify(api.sheets['明細'].rows),JSON.stringify(rows));
});
test('normal changed save uses two requests and reads only the selected worksheet',async()=>{
 const api=backend();
 api.seed('明細',[['日期','項目','金額','分類','類型']]);
 api.seed('年度摘要',[['年份','月份','薪資收入','勞健保等','額外收入','生活開銷','保險開銷','其它開銷','家庭開銷','備註']]);
 api.seed('基金投資明細',[Array.from(api.ctx.FUND_HEADERS)]);
 const f=frontend(api),a=f.app;await a.fetchData();a.currentAssetData.value.cash=12;
 const start=f.requests.length;api.resetReads();await a.saveAssetsRecord();
 assert.equal(a.pendingSave.value,null);assert.deepEqual(f.requests.slice(start),[{method:'POST',dataset:null},{method:'GET',dataset:'assetsRecords'}]);
 assert.equal(api.reads['明細']||0,0);assert.equal(api.reads['年度摘要']||0,0);assert.equal(api.reads['基金投資明細']||0,0);
 a.currentAssetData.value.cash=20;await a.saveAssetsRecord();assert.equal(a.pendingSave.value,null);assert.equal(api.read('assetsRecords').assetsRecords[a.currentYM.value].cash,20);
});
test('dataset GET returns only requested data and does not read unrelated tables',()=>{
 const api=backend();api.seed('明細',[['日期','項目','金額','分類','類型'],['2026-10-14','test',10,'其它','expense']]);
 api.seed('年度摘要',[['年份','月份']]);api.resetReads();
 const data=api.read('transactions');assert.equal(data.transactions.length,1);assert.equal(data.summaries,undefined);assert.equal(data.fundsRecords,undefined);assert.equal(data.protocolVersion,4);
 assert.deepEqual(Object.keys(data.revisions),['transactions']);assert.equal(api.reads['明細'],1);assert.equal(api.reads['年度摘要']||0,0);
 assert.equal(api.read('not-a-dataset').status,'error');
});
test('lost confirmation is recovered with one GET and no duplicate POST',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();f.setMode('lost-confirmation');
 a.form.value={date:'2026-10-14',title:'saved once',amount:10,category:'其它'};await a.saveTransaction();
 assert.ok(a.pendingSave.value);assert.equal(a.showSuccessToast.value,false);assert.equal(api.read().transactions.length,1);
 f.setMode('normal');const start=f.requests.length,posts=f.posts();await a.retrySave();
 assert.equal(a.pendingSave.value,null);assert.equal(f.posts(),posts);assert.deepEqual(f.requests.slice(start),[{method:'GET',dataset:'transactions'}]);assert.equal(api.read().transactions.length,1);
});
test('optimized frontend remains compatible with the full-read version 3 API',async()=>{
 const api=backend(),compat={post:api.post,read:()=>{const data=api.read();data.protocolVersion=3;return data}};
 const f=frontend(compat),a=f.app;await a.fetchData();a.currentAssetData.value.cash=32;await a.saveAssetsRecord();assert.equal(a.pendingSave.value,null);assert.equal(api.read().assetsRecords[a.currentYM.value].cash,32);
});
test('opening new years and default asset records does not trigger unsaved warnings',async()=>{
 const a=frontend(backend()).app;await a.fetchData();assert.equal(a.hasUnsavedChanges.value,false);
 a.currentAssetData.value;a.currentFundsData.value;a.currentYearSummaries.value;assert.equal(a.hasUnsavedChanges.value,false);
 a.selectedYear.value+=1;a.currentAssetData.value;a.currentFundsData.value;a.currentYearSummaries.value;
 assert.equal(a.hasUnsavedChanges.value,false);a.currentYearSummaries.value[1].salary=12;assert.ok(a.dirtySections.value.includes('summaries'));
 a.currentYearSummaries.value[1].salary=0;assert.equal(a.hasUnsavedChanges.value,false);
});
test('saving one page clears only that page and derived values do not count as edits',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.currentAssetData.value;
 a.currentYearSummaries.value[1].salary=10;a.currentFundsData.value.allianz.baseValue=20;a.currentAssetData.value.cash=30;
 assert.deepEqual(Array.from(a.dirtySections.value).sort(),['assetsRecords','fundsRecords','summaries']);
 await a.saveFundsRecord();assert.deepEqual(Array.from(a.dirtySections.value).sort(),['assetsRecords','summaries']);
 await a.saveAssetsRecord();assert.deepEqual(Array.from(a.dirtySections.value),['summaries']);
 await a.saveAllSummaries();assert.equal(a.hasUnsavedChanges.value,false);
 a.currentYearSummaries.value[1].livingExpense=123;a.currentAssetData.value.currUSD=456;assert.equal(a.hasUnsavedChanges.value,false);
});
test('refresh cancels without losing changes, and leaving warns only for actual edits',async()=>{
 const f=frontend(backend()),a=f.app;await a.fetchData();const cleanEvent={preventDefault(){this.prevented=true}};f.emit('beforeunload',cleanEvent);assert.equal(cleanEvent.prevented,undefined);
 a.currentYearSummaries.value[1].salary=100;f.setConfirm(false);const start=f.requests.length;await a.fetchData();assert.equal(f.requests.length,start);assert.equal(a.currentYearSummaries.value[1].salary,100);
 const dirtyEvent={preventDefault(){this.prevented=true}};f.emit('beforeunload',dirtyEvent);assert.equal(dirtyEvent.prevented,true);assert.equal(dirtyEvent.returnValue,'');
 f.setConfirm(true);await a.fetchData();assert.equal(a.currentYearSummaries.value[1].salary,0);assert.equal(a.hasUnsavedChanges.value,false);
});
test('new and edited transaction forms prompt on cancellation only after modification',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();a.openAddModal();assert.equal(a.hasUnsavedForm.value,false);
 a.appendItemTitle('午餐');assert.equal(a.hasUnsavedChanges.value,true);f.setConfirm(false);a.closeModal();assert.equal(a.showModal.value,true);
 f.setConfirm(true);a.closeModal();assert.equal(a.hasUnsavedChanges.value,false);
 a.openAddModal();a.form.value.title='午餐';a.form.value.amount=100;await a.saveTransaction();assert.equal(a.hasUnsavedChanges.value,false);
 a.openEditModal(api.read().transactions[0]);assert.equal(a.hasUnsavedForm.value,false);a.form.value.amount=200;assert.equal(a.hasUnsavedForm.value,true);
 f.setConfirm(false);a.closeModal();assert.equal(a.showModal.value,true);assert.equal(api.read().transactions[0].amount,100);
});
test('search handles name/category, case and whitespace without changing month totals or dirty state',async()=>{
 const api=backend();api.seed('明細',[['日期','項目','金額','分類','類型'],['2026-10-14','飲料/咖啡、加油',500,'生活開銷','expense'],['2026-10-13','Online Shopping',800,'其它','expense'],['2026-09-01','加油',200,'生活開銷','expense']]);
 const a=frontend(api).app;a.selectedYear.value=2026;a.currentMonthNum.value=10;await a.fetchData();const totals=JSON.stringify(a.categoryTotals.value);
 a.searchQuery.value=' 加油 ';assert.equal(a.filteredTransactions.value.length,1);assert.equal(a.monthlyTransactions.value.length,2);
 a.searchQuery.value='生活開銷';assert.equal(a.filteredTransactions.value.length,1);
 a.searchQuery.value='ｏｎｌｉｎｅ';assert.equal(a.filteredTransactions.value[0].title,'Online Shopping');
 a.searchQuery.value='飲料 加油';assert.equal(a.filteredTransactions.value.length,1);a.searchQuery.value='找不到';assert.equal(a.filteredTransactions.value.length,0);
 assert.equal(JSON.stringify(a.categoryTotals.value),totals);assert.equal(a.hasUnsavedChanges.value,false);
 a.searchQuery.value='  ';assert.equal(a.filteredTransactions.value.length,2);a.searchQuery.value='';assert.equal(a.filteredTransactions.value.length,2);
});
