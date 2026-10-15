const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../js/stocks/model.js');
const {backend,frontend}=require('./helpers.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));

test('opening stocks fills both supplied historical tables and omits assets not held in each year',async()=>{
 const a=frontend(backend()).app;await a.fetchData();a.selectedYear.value=2026;a.openStocksTab();
 const sections=a.stockPortfolioSections.value;
 assert.deepEqual(Array.from(sections,s=>s.year),[2026,2025,2024]);
 assert.deepEqual(Array.from(sections.find(s=>s.year===2024).rows,r=>r.code),['00878','00919','0056']);
 assert.deepEqual(Array.from(sections.find(s=>s.year===2025).rows,r=>r.code),['00878','00919','0056','00982A']);
 assert.deepEqual(Array.from(a.stockPortfolioRows.value,r=>r.code),['00878','00919','0056','00982A']);
 assert.deepEqual(Array.from(a.stockCodes),['00878','00919','0056','00982A','0050']);
 assert.equal(a.stockRecords.value[2024].stocks['00878'].overview.cost,558670);
 assert.equal(a.stockRecords.value[2025].stocks['00878'].overview.lots,43.128);
 assert.equal(a.stockOverview.value.cost,948764);assert.equal(a.stockOverview.value.lots,43.128);
 assert.ok(a.dirtySections.value.includes('stockRecords'));
});

test('historical totals reproduce provided year-end tables without inventing 2024 refund',async()=>{
 const a=frontend(backend()).app;await a.fetchData();a.selectedYear.value=2026;a.openStocksTab();
 const prior=a.stockPortfolioSections.value.find(s=>s.year===2025),first=a.stockPortfolioSections.value.find(s=>s.year===2024);
 assert.deepEqual(plain(first.totals),{cost:841027,netValue:836250,profit:-4777,dividends:21220,totalReturn:16443});
 assert.deepEqual(plain(prior.totals),{cost:2053727,netValue:2050701,profit:-3026,dividends:153481,totalReturn:153970});
 assert.equal(prior.refund,3515);assert.equal(a.stockHistoricalYears[2024].refund,null);
 a.selectedYear.value=2025;assert.deepEqual(plain(a.stockCumulativeTotals.value),{dividends:174701,totalReturn:171675});
});

test('existing historical input, explicit zero and transaction data are preserved on every entry',()=>{
 const input={2024:model.emptyStockYear(),2025:model.emptyStockYear()};
 Object.assign(input[2025].stocks['00878'].overview,{cost:123,lots:0});
 input[2024].stocks['00919'].monthlyRecords[1][0].fee=1;
 const before=JSON.stringify(input),result=model.initializeStockHistory(input);
 assert.equal(JSON.stringify(input),before);
 assert.equal(result[2025].stocks['00878'].overview.cost,123);assert.equal(result[2025].stocks['00878'].overview.lots,0);
 assert.equal(result[2024].stocks['00919'].monthlyRecords[1][0].fee,1);assert.equal(result[2024].stocks['00919'].overview.cost,null);
 assert.equal(result[2025].stocks['0056'].overview.cost,614503);
 assert.deepEqual(model.initializeStockHistory(result),result);
 result[2025].stocks['0056'].overview.cost=2;assert.equal(model.stockHistoricalYears[2025].stocks['0056'].cost,614503);
});

test('new holdings appear in their purchase year only while inactive years and empty historical sections stay hidden',async()=>{
 const a=frontend(backend()).app;await a.fetchData();a.selectedYear.value=2026;a.openStocksTab();a.activeStockCode.value='0050';
 a.stockOverview.value.price=100;assert.equal(a.stockPortfolioRows.value.some(r=>r.code==='0050'),false);
 Object.assign(a.stockManualDisplayRows.value[0],{date:'1/1',quantity:1,purchase:100000,fee:20});
 assert.equal(a.stockPortfolioRows.value.some(r=>r.code==='0050'),true);
 assert.equal(a.stockPortfolioSections.value.find(s=>s.year===2025).rows.some(r=>r.code==='0050'),false);
 a.selectedYear.value=2024;assert.deepEqual(Array.from(a.stockPortfolioSections.value,s=>s.year),[2024]);
 assert.deepEqual(Array.from(a.stockPortfolioRows.value,r=>r.code),['00878','00919','0056']);
});

test('historical initialization saves through existing GAS and reloads without duplicate insertion or new unsaved state',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;a.openStocksTab();
 await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);assert.equal(a.hasUnsavedChanges.value,false);
 const saved=plain(api.read().stockRecords),fresh=frontend(api).app;await fresh.fetchData();fresh.selectedYear.value=2026;fresh.openStocksTab();
 assert.deepEqual(plain(fresh.stockRecords.value),saved);assert.equal(fresh.hasUnsavedChanges.value,false);
 assert.equal(fresh.stockPortfolioSections.value.find(s=>s.year===2025).refund,3515);
 fresh.activeStockCode.value='00878';fresh.stockOverview.value.price=30;
 assert.equal(fresh.stockOverview.value.cost,948764);assert.equal(fresh.stockCumulativeTotals.value.totalReturn,519777);
});

test('cloud reload while viewing stocks restores missing history and preserves changed saved historical values',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;a.openStocksTab();
 a.stockRecords.value[2025].stocks['00878'].overview.cost=999999;await a.saveStocksRecord();await a.fetchData();
 assert.equal(a.stockRecords.value[2025].stocks['00878'].overview.cost,999999);assert.equal(a.hasUnsavedChanges.value,false);
 assert.equal(a.stockPortfolioSections.value.find(s=>s.year===2024).rows.length,3);
});
