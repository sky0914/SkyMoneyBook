const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseMonthlyPaste}=require('../js/stocks/import.js');
const {backend,frontend}=require('./helpers.cjs');
const target={year:2026,code:'00878',month:9};
const sample=[
 ['9/1',33,1109,20,33.63],['9/3',33,1121,20,33.97],['9/7',32,1095,20,34.22],['9/7',32,1095,20,34.23],
 ['9/9',33,1128,20,34.20],['9/11',32,1082,20,33.82],['9/14',33,1115,20,33.8],['9/15',32,1096,20,34.27],
 ['9/17',32,1112,20,34.76],['9/21',32,1117,20,34.93],['9/21',32,1118,20,34.95],['9/23',31,1095,20,35.34],
 ['9/28',32,1123,20,35.11],['9/28',32,1121,20,35.05],['9/29',32,1121,20,35.05]
];
const tsv=rows=>rows.map(row=>row.join('\t')).join('\n');
const plain=v=>JSON.parse(JSON.stringify(v));
function open(a,code='00878',year=2026,month=9){a.selectedYear.value=year;a.activeStockCode.value=code;a.selectedStockMonth.value=month;a.openStockImport();}

test('image-format paste handles optional title, header, blank rows and final totals without merging duplicate dates',()=>{
 const input=tsv([['定期定額00878 (1/3/5/7/9/11/13/15/17/19/21/23/25/27/29)'],['','股數','購入價格','手續費','單價'],...sample,['','','','',''],['',483,16648,300,'']]);
 const out=parseMonthlyPaste(input,target);
 assert.equal(out.rows.length,15);assert.deepEqual(out.totals,{shares:483,purchase:16648,fee:300});assert.equal(out.sawFooter,true);assert.equal(out.warnings.length,0);
 assert.equal(out.rows[2].date,'9/7');assert.equal(out.rows[3].date,'9/7');assert.notEqual(out.rows[2].price,out.rows[3].price);
});

test('five columns without headers normalize dates and thousand separators, retain zero and blank fees',()=>{
 const out=parseMonthlyPaste('2026/09/01\t1,000\t20,000\t0\t20\r\n09/03\t33\t\t\t33.63\r\n',target);
 assert.deepEqual(out.rows[0],{date:'9/1',shares:1000,fee:0,price:20});assert.equal(out.rows[1].fee,null);
 assert.equal(out.monthlyRows.length,15);assert.equal(out.monthlyRows[2].shares,null);
 assert.notEqual(out.monthlyRows[2],out.monthlyRows[3]);
});

test('source purchase and total differences warn and always use established purchase formula',()=>{
 const out=parseMonthlyPaste('日期\t股數\t購入價格\t手續費\t單價\n9/1\t33\t1110\t20\t33.63\n合計\t33\t1110\t20\t',target);
 assert.equal(out.totals.purchase,1109);assert.equal(out.warnings.length,2);assert.equal(out.rows[0].purchase,undefined);
});

test('wrong targets, invalid dates, non-numeric values, partial trades and too many rows are rejected',()=>{
 const invalid=[
  ['8/1\t33\t1109\t20\t33.63',/月份|月/],['2025/9/1\t33\t1109\t20\t33.63',/年份/],
  ['9/31\t33\t1109\t20\t33.63',/日期/],['9/1\t33.2\t1109\t20\t33.63',/整數/],
  ['9/1\t-1\t1109\t20\t33.63',/數字/],['9/1\t33\t1109\t=20\t33.63',/數字/],
  ['9/1\t33\t1109\t20\t',/股數與單價/],['9/1\t33\t1109\t20',/五欄/],
  ['定期定額00919 (1/3)\n9/1\t33\t1109\t20\t33.63',/來源是 00919/],
  [tsv([...sample,sample[0]]),/15 筆/],['\t\t\n',/貼上/]
 ];
 for(const [text,error] of invalid)assert.throws(()=>parseMonthlyPaste(text,target),error);
 assert.throws(()=>parseMonthlyPaste(tsv(sample),{...target,code:'6757'}),/有效/);
 const leap='2/29\t1\t20\t0\t20';assert.doesNotThrow(()=>parseMonthlyPaste(leap,{...target,year:2024,month:2}));assert.throws(()=>parseMonthlyPaste(leap,{...target,month:2}),/日期/);
});

test('preview and cancel never write inputs or call cloud; apply replaces just the target month and saves through normal sync',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();open(a);a.stockMonthlyRows.value[14].fee=99;
 a.selectedStockMonth.value=8;a.stockMonthlyRows.value[0].fee=88;open(a);
 const before=JSON.stringify(a.stockRecords.value),posts=f.posts();a.stockImportDialog.value.text=tsv(sample.slice(0,2));
 assert.equal(a.previewStockImport(),true);assert.equal(JSON.stringify(a.stockRecords.value),before);assert.equal(a.stockImportDialog.value.existingCount,1);
 a.closeStockImport();assert.equal(JSON.stringify(a.stockRecords.value),before);assert.equal(f.posts(),posts);
 open(a);a.stockImportDialog.value.text=tsv(sample.slice(0,2));a.previewStockImport();assert.equal(a.applyStockImport(),true);
 assert.equal(a.stockMonthlyRows.value[0].shares,33);assert.equal(a.stockMonthlyRows.value[14].fee,null);assert.equal(a.stockRecords.value[2026].stocks['00878'].monthlyRecords[8][0].fee,88);
 assert.equal(a.stockRecords.value[2026].stocks['00919'].monthlyRecords[9][0].shares,null);assert.equal(f.posts(),posts);
 assert.ok(a.dirtySections.value.includes('stockRecords'));await a.saveStocksRecord();assert.equal(a.pendingSave.value,null);
 const fresh=frontend(api).app;await fresh.fetchData();fresh.selectedYear.value=2026;fresh.selectedStockMonth.value=9;
 assert.equal(fresh.stockMonthlyTotals.value.purchase,2230);assert.equal(fresh.stockMonthlyTotals.value.shares,66);
});

test('each supported stock, year and month imports independently with the same flow',async()=>{
 const a=frontend(backend()).app;await a.fetchData();
 for(const [i,code] of Array.from(a.stockCodes).entries()){
  const month=i+1,year=2025+i;open(a,code,year,month);a.stockImportDialog.value.text=`${month}/1\t${i+1}\t\t0\t20`;
  assert.equal(a.previewStockImport(),true);assert.equal(a.applyStockImport(),true);
  assert.equal(a.stockRecords.value[year].stocks[code].monthlyRecords[month][0].shares,i+1);
 }
});

test('changed text, selected target or current month data requires another preview and never partially imports',async()=>{
 const a=frontend(backend()).app;await a.fetchData();open(a);const initial=JSON.stringify(a.stockRecords.value);
 a.stockImportDialog.value.text=tsv(sample);a.previewStockImport();a.stockImportDialog.value.text='invalid';assert.equal(a.applyStockImport(),false);assert.equal(JSON.stringify(a.stockRecords.value),initial);
 open(a);a.stockImportDialog.value.text=tsv(sample);a.previewStockImport();a.selectedStockMonth.value=10;assert.equal(a.applyStockImport(),false);assert.equal(JSON.stringify(a.stockRecords.value),initial);
 open(a);a.stockImportDialog.value.text=tsv(sample);a.previewStockImport();a.stockMonthlyRows.value[0].fee=12;
 const edited=JSON.stringify(a.stockRecords.value);assert.equal(a.applyStockImport(),false);assert.equal(JSON.stringify(a.stockRecords.value),edited);
 a.stockImportDialog.value.text='9/1\t33\t1109\t20\t33.63\n8/1\t33\t1109\t20\t33.63';assert.equal(a.previewStockImport(),false);assert.equal(JSON.stringify(a.stockRecords.value),edited);
});

test('unfinished paste warns before leaving and synchronization blocks import actions',async()=>{
 const api=backend(),f=frontend(api),a=f.app;await a.fetchData();open(a);a.stockImportDialog.value.text=tsv(sample);
 assert.equal(a.hasUnsavedChanges.value,true);const event={preventDefault(){this.prevented=true;}};f.emit('beforeunload',event);assert.equal(event.prevented,true);
 a.isSubmitting.value=true;assert.equal(a.previewStockImport(),false);a.isSubmitting.value=false;a.previewStockImport();
 a.isSubmitting.value=true;assert.equal(a.applyStockImport(),false);a.isSubmitting.value=false;
 a.closeStockImport();assert.equal(a.hasUnsavedChanges.value,false);assert.deepEqual(plain(api.read().stockRecords),{});
});
