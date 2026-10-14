const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function backend(){
 const sheets={}; let locked=false;
 const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=sheet(),getSpreadsheetTimeZone:()=> 'Asia/Taipei'};
 function sheet(){return {rows:[],getDataRange(){return {getValues:()=>this.rows.length?this.rows:[[null]]}},getLastRow(){return this.rows.length},getMaxRows:()=>1000,getMaxColumns:()=>100,getRange(row,col,n,m){return {setValues:values=>{values.forEach((v,i)=>this.rows[row-1+i]=v.slice())},clearContent:()=>{this.rows.splice(row-1,n)}}}}}
 const ctx=vm.createContext({Date,SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true},hasLock:()=>locked,releaseLock(){locked=false}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>b.toString('base64url'),formatDate:(d,tz,format)=>d.toISOString().slice(0,format==='yyyy-MM'?7:10)},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('GAS','utf8'),ctx);
 return {ctx, seed:(name,rows)=>{sheets[name]=sheet();sheets[name].rows=rows}, read:()=>ctx.doGet(),post:p=>ctx.doPost({postData:{contents:JSON.stringify(p)}}),sheets};
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
module.exports={backend,frontend};
