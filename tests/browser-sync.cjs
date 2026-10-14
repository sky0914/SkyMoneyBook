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
  const dialogs=[];page.on('dialog',dialog=>{dialogs.push(dialog.message());return dialog.accept()});
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
  assert.equal(dialogs.length,0,'initial blank grid must not prompt to discard changes');
  const state=async(fn)=>page.evaluate(fn);
  await state(()=>{const s=document.querySelector('#app').__vue_app__._container._vnode.component.setupState;s.selectedYear=2026;s.currentMonthNum=10;s.form={date:'2026-10-14',title:'瀏覽器測試',amount:100,category:'生活開銷'};return s.saveTransaction()});
  assert.equal(api.read().transactions[0].title,'瀏覽器測試');
  assert.equal(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.hasUnsavedChanges),false);
  const search=page.getByRole('searchbox',{name:'搜尋本月明細'});
  await search.fill('找不到');await page.getByText('找不到符合搜尋條件的明細。',{exact:true}).waitFor();
  const categoryBefore=await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.categoryTotals);
  await search.fill('生活開銷');assert.equal(await page.locator('.transaction-table tbody tr').count(),1);
  await page.getByRole('button',{name:'清除明細搜尋'}).click();assert.equal(await search.inputValue(),'');
  assert.deepEqual(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.categoryTotals),categoryBefore);
  await page.getByRole('button',{name:/年開銷總表/}).click();
  await page.locator('input[type=number]:visible').first().fill('123');
  await page.getByText(/尚未儲存：年度收支/).waitFor();
  await page.getByRole('button',{name:/基金投資/}).click();await page.getByText(/尚未儲存：年度收支/).waitFor();
  console.log('Search and retained cross-tab unsaved notice passed');
  for(const [tab,key,edit,button] of [
   ['年開銷總表','summaries',s=>{s.currentYearSummaries[1].salary=123},'儲存'],
   ['基金投資','fundsRecords',s=>{s.currentFundsData.allianz.baseValue=99},'儲存'],
   ['總資產','assetsRecords',s=>{s.currentAssetData.cash=50},'儲存']
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
  assert.equal(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.hasUnsavedChanges),false);
  await page.getByRole('button',{name:/日常開銷明細/}).click();
  await page.getByRole('button',{name:'記一筆',exact:true}).click();
  await page.getByPlaceholder('例如：午餐、加油').fill('尚未儲存的明細');
  page.removeAllListeners('dialog');let prompted=false;page.on('dialog',async dialog=>{prompted=true;await dialog.dismiss()});
  await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(prompted,true);
  assert.equal(await page.getByPlaceholder('例如：午餐、加油').isVisible(),true);
  assert.equal(await state(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented}),true);
  page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.hasUnsavedChanges),false);
  console.log('Modal discard confirmation and beforeunload protection passed');
  await page.getByRole('button',{name:'配息',exact:true}).click();
  const postsBefore=api.read().cashflowRecords;
  await page.getByRole('spinbutton',{name:'1 月 基金(台)',exact:true}).fill('13763');
  await page.getByRole('spinbutton',{name:'1 月 基金(美)',exact:true}).fill('6382');
  await page.getByRole('spinbutton',{name:'1 月 ETF(台)',exact:true}).fill('9713');
  await page.getByRole('spinbutton',{name:'1 月 安聯(美)',exact:true}).fill('3388');
  await page.getByRole('spinbutton',{name:'台幣定存利息',exact:true}).fill('2758');
  assert.deepEqual(api.read().cashflowRecords,postsBefore);
  assert.equal(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.cashflowAnnualTotal),36004);
  await page.getByRole('button',{name:'提交配息記錄',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#app').__vue_app__._container._vnode.component.setupState.isSubmitting);
  assert.equal(await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.syncError),'');
  await state(()=>document.querySelector('#app').__vue_app__._container._vnode.component.setupState.fetchData());
  assert.equal(await page.getByRole('spinbutton',{name:'1 月 ETF(台)',exact:true}).inputValue(),'9713');
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('Cashflow grid batch submit, totals, reload and mobile layout passed');
 }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
