const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const model=require('../js/stocks/model.js');
const {createStockCalculations}=require('../js/stocks/calculations.js');
const freeze=value=>{if(value && typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

test('model factories isolate stocks, years and rows without shared default objects',()=>{
 const first=model.emptyStockYear(),second=model.emptyStockYear();
 first.stocks['00878'].monthlyRecords[1][0].shares=100;
 assert.equal(first.stocks['00878'].monthlyRecords[1][1].shares,null);
 assert.equal(first.stocks['00878'].monthlyRecords[2][0].shares,null);
 assert.equal(first.stocks['00919'].monthlyRecords[1][0].shares,null);
 assert.equal(second.stocks['00878'].monthlyRecords[1][0].shares,null);
});

test('normalization is idempotent, preserves zero, excludes empty years and leaves inputs intact',()=>{
 const input={2025:model.emptyStockYear(),2026:model.emptyStockYear()};
 Object.assign(input[2026].stocks['00878'].overview,{price:'30.5',estimatedFee:0,estimatedTax:''});
 input[2026].stocks['00919'].dividends[0].exDate='2/1';
 const before=JSON.stringify(input);freeze(input);
 const snapshot=model.stockSnapshot(input);
 assert.deepEqual(Object.keys(snapshot),['2026']);assert.equal(snapshot[2026].stocks['00878'].overview.price,30.5);
 assert.equal(snapshot[2026].stocks['00878'].overview.estimatedFee,0);assert.equal(snapshot[2026].stocks['00878'].overview.estimatedTax,null);
 assert.deepEqual(model.stockSnapshot(snapshot),snapshot);assert.equal(JSON.stringify(input),before);
 snapshot[2026].stocks['00919'].dividends[0].exDate='3/1';assert.equal(input[2026].stocks['00919'].dividends[0].exDate,'2/1');
});

test('validation depends on owning year and preserves signed closing profit rules',()=>{
 const input={2024:model.emptyStockYear()};const r=input[2024].stocks['0050'];
 r.dividends[0].exDate='2/29';r.overview.profit=-100;r.overview.totalReturn=-50;
 assert.doesNotThrow(()=>model.validateStockInputs(input));
 assert.throws(()=>model.validateStockInputs({2025:input[2024]}),/日期/);
 r.overview.estimatedFee=-1;assert.throws(()=>model.validateStockInputs(input),/數值/);
 r.overview.estimatedFee=0;r.manualRows[0].purchase=Infinity;assert.throws(()=>model.validateStockInputs(input),/數值/);
});

test('standalone engine calculates cross-year cost, holdings, payouts and refunds without mutating frozen inputs',()=>{
 const data={2025:model.emptyStockYear(),2026:model.emptyStockYear()};
 Object.assign(data[2025].stocks['00878'].overview,{cost:10000,lots:1,profit:300,dividends:100,totalReturn:400});
 const r=data[2026].stocks['00878'];Object.assign(r.overview,{price:30,estimatedFee:10,estimatedTax:5});
 Object.assign(r.monthlyRecords[10][0],{date:'10/1',shares:500,price:20.123,fee:20});
 Object.assign(r.manualRows[0],{quantity:0.25,purchase:6000,fee:5});
 Object.assign(r.dividends[0],{shares:1,perShare:0.5,transferFee:10});
 const before=JSON.stringify(data);freeze(data);const calc=createStockCalculations(()=>data);
 const expected={cost:26086,lots:1.75,marketValue:52500,netValue:52485,profit:26399,dividends:490,totalReturn:26889};
 for(const [key,value] of Object.entries(expected))assert.equal(calc.stockOverviewValue(2026,'00878',key),value,key);
 assert.equal(calc.stockAnnualRows(r)[9].averagePrice,20.12);
 assert.equal(calc.stockAnnualTotals(2026).totalReturn,26908);
 assert.deepEqual(calc.stockCumulativeTotals(2026),{dividends:175191,totalReturn:201609});
 calc.stockAnnualTotals(2027);assert.equal(data[2027],undefined);assert.equal(JSON.stringify(data),before);
});

test('engine follows replacement cloud records and edits without caching stale source data',()=>{
 let records={2026:model.emptyStockYear()};const calc=createStockCalculations(()=>records);
 Object.assign(records[2026].stocks['00919'].overview,{lots:1,price:20});assert.equal(calc.stockOverviewValue(2026,'00919','marketValue'),20000);
 records={2026:model.emptyStockYear()};Object.assign(records[2026].stocks['00919'].overview,{lots:2,price:30});
 assert.equal(calc.stockOverviewValue(2026,'00919','marketValue'),60000);
 records[2026].stocks['00919'].overview.price=31;assert.equal(calc.stockOverviewValue(2026,'00919','marketValue'),62000);
 const other=createStockCalculations(()=>({}));assert.equal(other.stockOverviewValue(2026,'00919','marketValue'),null);
});

test('ordinary browser scripts load in HTML order without Vue or module loader dependencies',()=>{
 const html=fs.readFileSync('index.html','utf8'),context=vm.createContext({});
 const scripts=[...html.matchAll(/<script src="(js\/stocks\/[^\"]+)"><\/script>/g)].map(match=>match[1]);
 assert.deepEqual(scripts,['js/stocks/model.js','js/stocks/calculations.js','js/stocks/import.js']);
 assert.ok(html.indexOf('src="js/stocks/calculations.js"')<html.indexOf('createApp({'));
 for(const source of scripts)vm.runInContext(fs.readFileSync(source,'utf8'),context,{filename:source});
 assert.equal(context.StockModel.stockCodes.length,5);
 const calc=context.StockCalculations.createStockCalculations(()=>({}));assert.equal(calc.stockPurchase({shares:32,price:34.84}),1114);
});
