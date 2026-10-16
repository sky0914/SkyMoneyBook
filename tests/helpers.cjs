const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function backend(){
 const sheets={}; let locked=false; const reads={};
 const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=sheet(n),getSpreadsheetTimeZone:()=> 'Asia/Taipei'};
 function sheet(name){return {rows:[],getDataRange(){return {getValues:()=>{reads[name]=(reads[name]||0)+1;return this.rows.length?this.rows:[[null]]}}},getLastRow(){return this.rows.length},maxRows:1000,maxColumns:100,getMaxRows(){return this.maxRows},getMaxColumns(){return this.maxColumns},insertRowsAfter(after,n){this.maxRows+=n},insertColumnsAfter(after,n){this.maxColumns+=n},getRange(row,col,n,m){return {setNumberFormat(){return this},getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j]??'')),setValues:values=>{values.forEach((v,i)=>this.rows[row-1+i]=v.slice())},clearContent:()=>{this.rows.splice(row-1,n)}}}}}
 const ctx=vm.createContext({Date,SpreadsheetApp:{openById:()=>ss,flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true},hasLock:()=>locked,releaseLock(){locked=false}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>b.toString('base64url'),formatDate:(d,tz,format)=>d.toISOString().slice(0,format==='yyyy-MM'?7:10)},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('GAS','utf8'),ctx);
 return {ctx, seed:(name,rows)=>{sheets[name]=sheet(name);sheets[name].rows=rows}, reads,resetReads:()=>{for(const name in reads) delete reads[name]}, read:key=>ctx.doGet({parameter:{dataset:key}}),post:p=>ctx.doPost({postData:{contents:JSON.stringify(p)}}),sheets};
}
function frontend(api){
 let app; let mode='normal'; let posts=0; const requests=[]; const listeners={}; const confirmations=[]; let confirmAnswer=true;
 const ref=value=>({value});
 const ctx=vm.createContext({Vue:{ref,computed:f=>({get value(){return typeof f==='function'?f():f.get()}}),watch(){},onMounted(){},createApp:opts=>({mount(){app=opts.setup()}})},localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener:(name,handler)=>listeners[name]=handler},confirm:message=>{confirmations.push(message);return confirmAnswer},AbortController,console,setTimeout:(fn,ms)=>ms===15000?1:setTimeout(fn,0),clearTimeout(){},fetch:async(url,opts)=>{
 requests.push({method:opts.method,dataset:new URL(url).searchParams.get('dataset')});
 if(mode==='offline' || (mode==='lost-confirmation' && posts > 0 && opts.method==='GET')) throw new Error('offline');
 if(opts.method==='POST'){posts++; if(mode==='drop')return {type:'opaque'}; api.post(JSON.parse(opts.body));return {type:'opaque'};}
 return {ok:true,json:async()=>api.read(new URL(url).searchParams.get('dataset'))};
 }});
 const html=fs.readFileSync('index.html','utf8');
 for (const [,source] of html.matchAll(/<script src="(js\/(?:stocks|deposits)\/[^"]+)"><\/script>/g)) vm.runInContext(fs.readFileSync(source,'utf8'),ctx,{filename:source});
 vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],ctx);
 return {app,setMode:m=>mode=m,posts:()=>posts,requests,confirmations,setConfirm:value=>confirmAnswer=value,emit:(name,event)=>listeners[name]?.(event)};
}
module.exports={backend,frontend};
