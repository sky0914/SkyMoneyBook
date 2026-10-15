const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../js/stocks/model.js');
const {createStockCalculations}=require('../js/stocks/calculations.js');
const {backend,frontend}=require('./helpers.cjs');
const plain=v=>JSON.parse(JSON.stringify(v));
const years=()=>({2024:model.emptyStockYear(),2025:model.emptyStockYear(),2026:model.emptyStockYear(),2027:model.emptyStockYear()});

test('agreed 2026 total uses 174701 plus 2026 income, current profit and only post-cutoff refunds',()=>{
 const data=years(),old=data[2025].stocks['00878'],current=data[2026].stocks['00878'];
 Object.assign(old.overview,{dividends:153481,profit:-3026,totalReturn:153970});
 Object.assign(old.monthlyRecords[1][0],{shares:1,price:1,fee:3516});
 Object.assign(current.overview,{profit:10000});
 Object.assign(current.dividends[0],{shares:10,perShare:0.5,transferFee:10});
 Object.assign(current.monthlyRecords[9][0],{shares:33,price:33.63,fee:20});
 const calc=createStockCalculations(()=>data),before=JSON.stringify(data);
 assert.deepEqual(calc.stockCumulativeTotals(2026),{dividends:179691,totalReturn:189710});
 assert.deepEqual(calc.stockCumulativeTotals(2025),{dividends:174701,totalReturn:171675});
 assert.equal(JSON.stringify(data),before);
 old.overview.totalReturn=9999999;old.overview.profit=-999999;old.overview.dividends=9999999;
 assert.deepEqual(calc.stockCumulativeTotals(2026),{dividends:179691,totalReturn:189710});
});

test('later years accumulate distributions and refunds but replace investment profit, and viewing 2026 excludes future data',()=>{
 const data=years(),first=data[2026].stocks['00878'],next=data[2027].stocks['00919'];
 Object.assign(first.overview,{profit:500,dividends:100});Object.assign(next.overview,{profit:300,dividends:200});
 Object.assign(first.monthlyRecords[1][0],{shares:1,price:20,fee:20});Object.assign(next.monthlyRecords[1][0],{shares:1,price:20,fee:30});
 const calc=createStockCalculations(()=>data);
 assert.deepEqual(calc.stockCumulativeTotals(2026),{dividends:174801,totalReturn:175320});
 assert.deepEqual(calc.stockCumulativeTotals(2027),{dividends:175001,totalReturn:175349});
 first.overview.profit=9000;assert.equal(calc.stockCumulativeTotals(2027).totalReturn,175349);
 next.overview.profit=-1000;assert.equal(calc.stockCumulativeTotals(2027).totalReturn,174049);
});

test('2025 closing holdings and cost carry into 2026 while all supplied historical snapshot fields stay unchanged',()=>{
 const data=years(),prior=data[2025].stocks['00878'],next=data[2026].stocks['00878'];
 Object.assign(prior.overview,{lots:43.128,cost:948764,price:21.71,netValue:934038,profit:-14726,dividends:64348,totalReturn:49622});
 Object.assign(next.monthlyRecords[9][0],{date:'9/1',shares:33,price:33.63,fee:20});
 Object.assign(next.manualRows[0],{date:'9/2',quantity:0.5,purchase:16000,fee:20});
 const before=JSON.stringify(prior),calc=createStockCalculations(()=>data);
 assert.equal(calc.stockCostForYear(2026,'00878'),965913);assert.equal(calc.stockLotsForYear(2026,'00878'),43.661);
 assert.equal(calc.stockOverviewValue(2025,'00878','totalReturn'),49622);assert.equal(JSON.stringify(prior),before);
});

test('all five stocks contribute current profit and net payouts once, with zero and negative profits supported',()=>{
 const data=years();
 model.stockCodes.forEach((code,i)=>{
  const r=data[2026].stocks[code];r.overview.profit=(i-2)*100;
  Object.assign(r.dividends[0],{shares:1,perShare:0.1,transferFee:10});
  Object.assign(r.monthlyRecords[1][0],{shares:1,price:20,fee:20});
 });
 const calc=createStockCalculations(()=>data);
 assert.deepEqual(calc.stockCumulativeTotals(2026),{dividends:175151,totalReturn:175246});
 assert.equal(calc.stockTotalReturn('00878',data[2026].stocks['00878'].overview,2026),-110); // Per-stock annual formula remains intact.
});

test('save and reload preserve historical inputs and calculate the same agreed 2026 totals',async()=>{
 const api=backend(),a=frontend(api).app;await a.fetchData();a.selectedYear.value=2026;a.selectedStockMonth.value=9;
 const prior=a.previousStockPortfolio.value.rows[0].overview;
 Object.assign(prior,{lots:43.128,cost:948764,price:21.71,netValue:934038,profit:-14726,dividends:64348,totalReturn:49622});
 a.stockOverview.value.price=30;Object.assign(a.stockDividendRows.value[0],{shares:1,perShare:0.5,transferFee:10});
 Object.assign(a.stockMonthlyRows.value[0],{date:'9/1',shares:33,price:33.63,fee:20});
 const expected=plain(a.stockCumulativeTotals.value),historical=plain(a.stockRecords.value[2025]);
 await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);
 const fresh=frontend(api).app;await fresh.fetchData();fresh.selectedYear.value=2026;
 assert.deepEqual(plain(fresh.stockCumulativeTotals.value),expected);assert.deepEqual(plain(fresh.stockRecords.value[2025]),historical);
 assert.equal(fresh.hasUnsavedChanges.value,false);fresh.selectedYear.value=2025;
 assert.deepEqual(plain(fresh.stockCumulativeTotals.value),{dividends:174701,totalReturn:171675});
});
