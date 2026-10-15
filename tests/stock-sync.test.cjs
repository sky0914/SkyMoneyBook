const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {backend,frontend}=require('./helpers.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const codes=['00878','00919','0056','00982A','0050'];
const record=(a,year,code)=>{a.selectedYear.value=year;a.activeStockCode.value=code;a.stockOverview.value;return a.stockRecords.value[year].stocks[code]};

test('all five stocks and multiple years round trip every input, preserve blanks/zeros and rebuild formulas',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();assert.equal(a.stocksReady.value,true);
 for(const year of [2025,2026]) for(const [i,code] of codes.entries()){
  const r=record(a,year,code);
  Object.assign(r.overview,{price:30+i,estimatedFee:10,estimatedTax:5});
  Object.assign(r.monthlyRecords[10][0],{date:'10/1',shares:100+i,fee:20,price:20.123});
  Object.assign(r.monthlyRecords[12][14],{date:'12/31',shares:0,fee:0,price:0});
  Object.assign(r.manualRows[11],{date:'11/3',quantity:0.5,purchase:1000+i,fee:2,price:2});
  Object.assign(r.dividends[3],{exDate:'2/1',payDate:'3/1',shares:1.1,perShare:0.5,transferFee:10});
 }
 record(a,2025,'00878').overview.cost=5000;
 record(a,2025,'00878').overview.lots=2;
 record(a,2025,'00878').overview.profit=-20;
 record(a,2025,'00878').overview.totalReturn=-10;
 const source=plain(a.stockRecords.value),totals=plain(a.stockPortfolioTotals.value);
 assert.ok(a.dirtySections.value.includes('stockRecords'));
 await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);assert.equal(a.showSuccessToast.value,true);assert.equal(a.hasUnsavedChanges.value,false);
 const fresh=frontend(api).app;await fresh.fetchData();fresh.selectedYear.value=a.selectedYear.value;
 assert.deepEqual(plain(fresh.stockRecords.value),source);
 assert.deepEqual(plain(fresh.stockPortfolioTotals.value),totals);
 const r=record(fresh,2026,'00878');assert.equal(r.monthlyRecords[10][1].fee,null);assert.equal(r.monthlyRecords[12][14].fee,0);
 assert.equal(api.sheets['股票投資記錄'].rows[0].length,8);
 assert.ok(api.sheets['股票投資記錄'].rows.slice(1).every(row=>row[6]!==null && typeof row[7]==='string'));
 assert.equal(f.requests.at(-1).dataset,'stockRecords');
});

test('browsing empty years and calculated totals remains clean; save only stocks leaves other page dirty',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();
 a.stockPortfolioSections.value;a.stockCumulativeTotals.value;
 for(const y of [2025,2026,2027]) for(const code of codes){record(a,y,code);a.stockDisplayRows.value;a.stockDividendTotals.value;}
 assert.equal(a.hasUnsavedChanges.value,false);
 a.currentAssetData.value.cash=12;record(a,2026,'00878').overview.price=30;
 await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);assert.deepEqual(Array.from(a.dirtySections.value),['assetsRecords']);
 assert.deepEqual(Object.keys(api.read('stockRecords').stockRecords),['2026']);
});

test('stock deletion clears obsolete sheet rows; clearing final input reloads as empty dataset',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();const r=record(a,2026,'00919');r.overview.price=0;r.manualRows[0].date='1/1';await a.saveStocksRecord();
 assert.equal(api.sheets['股票投資記錄'].rows.length,3);r.manualRows[0].date='';await a.saveStocksRecord();assert.equal(api.sheets['股票投資記錄'].rows.length,2);
 r.overview.price='';await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);assert.equal(api.sheets['股票投資記錄'].rows.length,1);assert.deepEqual(plain(api.read('stockRecords').stockRecords),{});
});

test('lost stock confirmation retries with GET only, while later edits save the latest values',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();const r=record(a,2026,'0056');r.overview.price=50;
 f.setMode('lost-confirmation');await a.saveStocksRecord();assert.ok(a.pendingSave.value);assert.equal(a.showSuccessToast.value,false);assert.equal(r.overview.price,50);
 const posts=f.posts();f.setMode('normal');await a.retrySave();assert.equal(a.pendingSave.value,null);assert.equal(f.posts(),posts);
 f.setMode('lost-confirmation');r.overview.price=51;await a.saveStocksRecord();assert.ok(a.pendingSave.value);f.setMode('normal');r.overview.price=52;await a.retrySave();
 assert.equal(a.pendingSave.value,null);assert.equal(api.read().stockRecords[2026].stocks['0056'].overview.price,52);
});

test('concurrent stock edits cannot overwrite another device and local edits survive',async()=>{
 const api=backend(),one=frontend(api).app,two=frontend(api).app;await one.fetchData();await two.fetchData();
 record(one,2026,'00878').overview.price=30;record(two,2026,'00919').overview.price=40;
 await one.saveStocksRecord();await two.saveStocksRecord();assert.ok(two.pendingSave.value);assert.match(two.syncError.value,/其他裝置/);
 assert.equal(two.stockRecords.value[2026].stocks['00919'].overview.price,40);assert.equal(api.read().stockRecords[2026].stocks['00919'].overview.price,null);
});

test('invalid inputs, malformed/duplicate cloud rows and unknown headers never overwrite stock data',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();const r=record(a,2026,'0050');r.overview.price=100;await a.saveStocksRecord();
 const original=plain(api.sheets['股票投資記錄'].rows),rev=api.read().revisions.stockRecords;
 r.monthlyRecords[2][0].date='2/29';assert.equal(await a.saveStocksRecord(),false);assert.equal(a.pendingSave.value,null);
 r.monthlyRecords[2][0].date='';r.overview.price=-1;assert.equal(await a.saveStocksRecord(),false);
 assert.deepEqual(plain(api.sheets['股票投資記錄'].rows),original);
 for(const change of [d=>d[2026].stocks['0050'].overview.price='NaN',d=>d[2026].stocks['6757']={},d=>d[2026].stocks['0050'].monthlyRecords[13]=[],d=>d[2026].stocks['0050'].overview.typo=1]){
  const data=plain(api.read().stockRecords);change(data);assert.equal(api.post({action:'saveStocks',stockRecords:data,expectedRevision:rev}).status,'error');assert.deepEqual(plain(api.sheets['股票投資記錄'].rows),original);
 }
 const malformed=[...original,original[1].slice()];api.seed('股票投資記錄',malformed);assert.ok(api.read().datasetErrors.stockRecords);
 assert.equal(api.post({action:'saveStocks',stockRecords:{},expectedRevision:api.read().revisions.stockRecords}).status,'error');assert.deepEqual(api.sheets['股票投資記錄'].rows,malformed);
 api.seed('股票投資記錄',[['自訂欄位'],['保留']]);await a.fetchData();assert.equal(a.stocksReady.value,false);assert.equal(r.overview.price,-1);assert.equal(await a.saveStocksRecord(),false);
 assert.equal(api.post({action:'saveStocks',stockRecords:{},expectedRevision:api.read().revisions.stockRecords}).status,'error');assert.equal(api.sheets['股票投資記錄'].rows[1][0],'保留');
});

test('old backends allow other pages but block stock saves without discarding staged input',async()=>{
 for(const version of [3,4,6]){
  const api=backend(),f=frontend({post:api.post,read:key=>{const d=api.read(key);d.protocolVersion=version;delete d.stockRecords;delete d.revisions.stockRecords;return d;}}),a=f.app;
  await a.fetchData();assert.equal(a.stocksReady.value,false);record(a,2026,'00878').overview.price=30;assert.equal(await a.saveStocksRecord(),false);assert.equal(f.posts(),0);
  await a.fetchData();assert.equal(a.stockRecords.value[2026].stocks['00878'].overview.price,30);assert.ok(a.dirtySections.value.includes('stockRecords'));
  a.currentAssetData.value.cash=50;await a.saveAssetsRecord();assert.equal(a.pendingSave.value,null);
 }
});

test('stock edits warn before refresh/exit; offline retains edits and initial read failure blocks save',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();record(a,2026,'00982A').manualRows[0].purchase=500;
 f.setConfirm(false);const start=f.requests.length;await a.fetchData();assert.equal(f.requests.length,start);
 const event={preventDefault(){this.prevented=true;}};f.emit('beforeunload',event);assert.equal(event.prevented,true);
 f.setMode('offline');await a.saveStocksRecord();assert.ok(a.pendingSave.value);assert.equal(a.stockRecords.value[2026].stocks['00982A'].manualRows[0].purchase,500);
 f.setMode('normal');await a.retrySave();assert.equal(a.pendingSave.value,null);
 const initial=frontend(backend());initial.setMode('offline');await initial.app.fetchData();assert.equal(await initial.app.saveStocksRecord(),false);assert.equal(initial.posts(),0);
});

test('large annual stock data expands sheet and targeted reads isolate stock failures',()=>{
 const api=backend(),data={2026:{stocks:{}}};
 for(const code of codes){const r=api.ctx.emptyStockRecord_();for(const rows of Object.values(r.monthlyRecords))for(const row of rows)Object.assign(row,{shares:1,price:30,fee:20,date:'1/1'});data[2026].stocks[code]=r;}
 const out=api.post({action:'saveStocks',stockRecords:data,expectedRevision:api.read().revisions.stockRecords});assert.equal(out.status,'success');assert.ok(api.sheets['股票投資記錄'].getMaxRows()>1000);
 api.seed('基金投資明細',[['bad']]);api.resetReads();assert.equal(api.read('stockRecords').stockRecords[2026].stocks['00878'].monthlyRecords[1][0].shares,1);assert.equal(api.reads['基金投資明細']||0,0);
});

test('stock toolbar is shared across all views and inputs are disabled during saves',()=>{
 const html=fs.readFileSync('index.html','utf8');const block=html.split('<!-- ================= 頁籤：股票')[1].split('<!-- =================')[0];
 assert.equal((block.match(/@click="saveStocksRecord"/g)||[]).length,1);
 assert.ok(block.includes('isSubmitting || !stocksReady'));assert.ok([...block.matchAll(/<input\s[^>]+/g)].every(([tag])=>tag.includes(':disabled="isSubmitting"')));
});
