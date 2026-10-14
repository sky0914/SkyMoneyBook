// Run with VUE_BROWSER_BUILD pointing to a local Vue 3 global build.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {backend}=require('./helpers.cjs');
(async()=>{
 const api=backend();
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  const html=fs.readFileSync('index.html','utf8');
  await page.route('**/*',async route=>{
   const req=route.request(),url=req.url();
   if(url.includes('/macros/s/')) {
    const data=req.method()==='POST'?api.post(JSON.parse(req.postData())):api.read(new URL(url).searchParams.get('dataset'));
    return route.fulfill({contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(data)});
   }
   if(url.includes('unpkg.com'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(process.env.VUE_BROWSER_BUILD,'utf8')});
   if(url.includes('cdn.tailwindcss.com'))return route.fulfill({contentType:'application/javascript',body:'window.tailwind={};'});
   if(url.includes('cdnjs.cloudflare.com'))return route.fulfill({contentType:'text/css',body:''});
   if(url==='http://skymoneybook.test/')return route.fulfill({contentType:'text/html',body:html});
   return route.abort();
  });
  await page.goto('http://skymoneybook.test/');
  await page.waitForFunction(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.syncStatus==='雲端資料讀取完成');
  const state=async(fn)=>page.evaluate(fn);
  await state(()=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;s.selectedYear=2026;s.currentMonthNum=10;s.form={date:'2026-10-14',title:'瀏覽器測試',amount:100,category:'生活開銷'};return s.saveTransaction()});
  assert.equal(api.read().transactions[0].title,'瀏覽器測試');
  for(const [tab,key,edit,button] of [
   ['年收支摘要總表','summaries',s=>{s.currentYearSummaries[1].salary=123},'儲存'],
   ['年基金投資記錄','fundsRecords',s=>{s.currentFundsData.allianz.baseValue=99},'儲存'],
   ['資產負債紀錄','assetsRecords',s=>{s.currentAssetData.cash=50},'儲存']
  ]){
   await page.getByRole('button',{name:new RegExp(tab)}).click();
   await page.evaluate(source=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;eval('('+source+')(s)')},edit.toString());
   await page.getByRole('button',{name:new RegExp(button)}).click();
   await page.waitForFunction(()=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;return !s.isSubmitting});
   const outcome=await state(()=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;return {error:s.syncError,pending:!!s.pendingSave}});
   assert.equal(outcome.error,'');assert.equal(outcome.pending,false);assert.ok(Object.keys(api.read()[key]).length);
   console.log('Browser save/read passed:',key);
  }
  await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.fetchData());
  assert.equal(errors.length,0,errors.join('\n'));
  const data=await state(()=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;return {salary:s.currentYearSummaries[1].salary,fund:s.currentFundsData.allianz.baseValue,cash:s.currentAssetData.cash,living:s.currentYearSummaries[10].livingExpense}});
  assert.deepEqual(data,{salary:123,fund:99,cash:50,living:100});
  console.log('Browser reload preserved all values; no page errors');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
