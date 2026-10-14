const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function backend(){
 const sheets={}; let locked=false;
 const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=sheet(),getSpreadsheetTimeZone:()=> 'Asia/Taipei'};
 function sheet(){return {rows:[],getDataRange(){return {getValues:()=>this.rows.length?this.rows:[[null]]}},getLastRow(){return this.rows.length},getMaxRows:()=>1000,getMaxColumns:()=>100,getRange(row,col,n,m){return {setValues:values=>{values.forEach((v,i)=>this.rows[row-1+i]=v.slice())},clearContent:()=>{this.rows.splice(row-1,n)}}}}}
 const ctx=vm.createContext({SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true},hasLock:()=>locked,releaseLock(){locked=false}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>b.toString('base64url'),formatDate:d=>d.toISOString().slice(0,10)},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('GAS','utf8'),ctx);
 return {read:()=>ctx.doGet(),post:p=>ctx.doPost({postData:{contents:JSON.stringify(p)}}),sheets};
}
function frontend(api){
 let app; let mode='normal'; let posts=0;
 const ref=value=>({value});
 const ctx=vm.createContext({Vue:{ref,computed:f=>({get value(){return typeof f==='function'?f():f.get()}}),watch(){},onMounted(){},createApp:opts=>({mount(){app=opts.setup()}})},localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener(){}},confirm:()=>true,AbortController,console,setTimeout:(fn,ms)=>ms===15000?1:setTimeout(fn,0),clearTimeout(){},fetch:async(_,opts)=>{
 if(mode==='offline') throw new Error('offline');
 if(opts.method==='POST'){posts++; if(mode==='drop')return {type:'opaque'}; api.post(JSON.parse(opts.body));return {type:'opaque'};}
 return {ok:true,json:async()=>api.read()};
 }});
 const html=fs.readFileSync('index_fund_06.html','utf8');
 vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],ctx);
 return {app,setMode:m=>mode=m,posts:()=>posts};
}
test('backend round trips all four datasets and keeps transaction IDs',()=>{
 const api=backend();
 const fixtures={transactions:[{id:777,date:'2026-10-14',title:'test',amount:100,category:'其它',type:'expense'}],summaries:{2026:{1:{month:1,salary:100,note:'test'}}},assetsRecords:{'2026-10':{date:'2026-10-14',cash:50}},fundsRecords:{2026:{allianz:{months:{1:{value:50}}}}}};
 for(const [action,key] of Object.entries({saveTransactions:'transactions',saveSummary:'summaries',saveAssets:'assetsRecords',saveFunds:'fundsRecords'})){
 const out=api.post({action,[key]:fixtures[key],expectedRevision:api.read().revisions[key]});assert.equal(out.status,'success');assert.ok(api.read()[key]);
 }
 assert.equal(api.read().transactions[0].id,777);assert.equal(api.read().fundsRecords[2026].allianz.months[1].value,50);
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
 f.setMode('normal');await a.fetchData();const remote=api.read();api.post({action:'saveFunds',fundsRecords:{2020:{note:'other device'}},expectedRevision:remote.revisions.fundsRecords});
 await a.saveFundsRecord();assert.equal(f.posts(),0);assert.ok(a.syncError.value.includes('其他裝置'));assert.ok(a.pendingSave.value);
});
