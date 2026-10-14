const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const crypto=require('node:crypto');
function backend(){
 const sheets={}; const openedBooks=[]; let locked=false; const reads={};
 const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=sheet(n),getSpreadsheetTimeZone:()=> 'Asia/Taipei'};
 function values(name, rows){return rows.map((row,index)=>row.map((value,col)=>{
  if(name!=='存股紀錄'||index===0||typeof value!=='string'||!value.startsWith('='))return value;
  const money=v=>Math.sign(v)*Math.round((Math.abs(v)+Number.EPSILON)*100)/100;
  const gross=money(Number(row[5])*Number(row[6])),fees=Number(row[8])+Number(row[9]);
  if(col===7)return gross;
  if(col===11)return money(row[4]==='買進'?-gross-fees:row[4]==='賣出'?gross-fees:row[4]==='現金股利'?Number(row[10])-fees:-fees);
  return value;
 }))}
 function sheet(name){return {rows:[],formats:[],getDataRange(){return {getValues:()=>{reads[name]=(reads[name]||0)+1;return this.rows.length?values(name,this.rows):[[null]]}}},getLastRow(){return this.rows.length},getMaxRows:()=>1000,getMaxColumns:()=>100,getRange(row,col,n,m){return {setNumberFormat:format=>this.formats.push({row,col,n,m,format}),getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>this.rows[row-1+i]?.[col-1+j]??'')),setValues:values=>{values.forEach((v,i)=>this.rows[row-1+i]=v.map(value=>typeof value==='string'&&value.startsWith("'")?value.slice(1):value))},clearContent:()=>{this.rows.splice(row-1,n)}}}}}
 const ctx=vm.createContext({Date,SpreadsheetApp:{openById:id=>{openedBooks.push(id);return ss},flush(){}},LockService:{getScriptLock:()=>({waitLock(){assert.equal(locked,false);locked=true},hasLock:()=>locked,releaseLock(){locked=false}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>b.toString('base64url'),formatDate:(d,tz,format)=>format==='HH:mm:ss.SSS'?d.toISOString().slice(11,23):d.toISOString().slice(0,format==='yyyy-MM'?7:10),parseDate:text=>new Date(text.includes(' ')?text.replace(' ','T')+'Z':text+'T00:00:00Z')},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}});
 vm.runInContext(fs.readFileSync('GAS','utf8'),ctx);
 return {ctx, openedBooks, seed:(name,rows)=>{sheets[name]=sheet(name);sheets[name].rows=rows}, reads,resetReads:()=>{for(const name in reads) delete reads[name]}, read:(key,params={})=>ctx.doGet({parameter:{dataset:key,...params}}),post:p=>ctx.doPost({postData:{contents:JSON.stringify(p)}}),sheets};
}
function frontend(api){
 let app; let mode='normal'; let posts=0; const requests=[]; const listeners={}; const confirmations=[]; let confirmAnswer=true;
 const ref=value=>({value});
 const ctx=vm.createContext({Vue:{ref,computed:f=>({get value(){return typeof f==='function'?f():f.get()}}),watch(){},onMounted(){},createApp:opts=>({mount(){app=opts.setup()}})},localStorage:{getItem:()=>null,setItem(){}},window:{addEventListener:(name,handler)=>listeners[name]=handler},confirm:message=>{confirmations.push(message);return confirmAnswer},URLSearchParams,AbortController,console,setTimeout:(fn,ms)=>ms===15000||ms===60000?1:setTimeout(fn,0),clearTimeout(){},fetch:async(url,opts)=>{
 requests.push({method:opts.method,dataset:new URL(url).searchParams.get('dataset')});
 if(mode==='offline' || (mode==='lost-confirmation' && posts > 0 && opts.method==='GET')) throw new Error('offline');
 if(opts.method==='POST'){posts++; if(mode==='drop')return {type:'opaque'}; api.post(JSON.parse(opts.body));return {type:'opaque'};}
 return {ok:true,json:async()=>api.read(new URL(url).searchParams.get('dataset'),Object.fromEntries(new URL(url).searchParams))};
 }});
 const html=fs.readFileSync('index.html','utf8');
 vm.runInContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1],ctx);
 return {app,setMode:m=>mode=m,posts:()=>posts,requests,confirmations,setConfirm:value=>confirmAnswer=value,emit:(name,event)=>listeners[name]?.(event)};
}
module.exports={backend,frontend};
