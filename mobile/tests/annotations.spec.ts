import {test,expect,type Page} from '@playwright/test';

const transcript='The derivative measures the rate of change. The derivative can be positive or negative.';
async function seed(page:Page,configured=true) {
  await page.addInitScript(({transcript,configured})=>{
    localStorage.setItem('CapacitorStorage.campus.locale','en');
    const provider={url:configured?'https://reader-test.invalid/v1':'',model:configured?'reader-model':'',key:'',timeout:120};
    localStorage.setItem('CapacitorStorage.campus.providers.public',JSON.stringify({text:provider,vision:provider,speech:provider}));
    if(localStorage.getItem('CapacitorStorage.campus.data.v1'))return;
    localStorage.setItem('CapacitorStorage.campus.data.v1',JSON.stringify({
      version:1,tasks:[],courses:[],records:[],timer:null,term:{name:'Fall',monday:'2026-08-31',weeks:20},
      notes:[{id:'lecture',title:'Calculus',created:'2026-10-19',seconds:60,recording:false,edited:'',segments:[{id:'recording',start:0,end:60,text:transcript,status:'done',audio:''}]}]
    }));
  },{transcript,configured});
  await page.goto('/');
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('.selectable-transcript')).toHaveText(transcript);
}
async function select(page:Page,start:number,end:number) {
  await page.locator('.selectable-transcript').evaluate((el,{start,end})=>{
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const range=document.createRange();let cursor=0,started=false,node;
    while(node=walker.nextNode()) {
      const size=node.textContent?.length??0;
      if(!started&&start<cursor+size){range.setStart(node,start-cursor);started=true;}
      if(started&&end<=cursor+size){range.setEnd(node,end-cursor);break;}
      cursor+=size;
    }
    window.getSelection()!.removeAllRanges();window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  },{start,end});
  await expect(page.getByRole('toolbar',{name:'Selected passage actions'})).toBeVisible();
}
async function annotations(page:Page) {
  return page.evaluate(()=>JSON.parse(localStorage.getItem('CapacitorStorage.campus.data.v1')!).notes[0].annotations??[]);
}

test('selected transcript accepts an offline note, dashed mark, edit and deletion after reload',async({page})=>{
  await seed(page,false);
  await select(page,4,14);
  await page.getByRole('button',{name:'Add note',exact:true}).click();
  await expect(page.locator('.annotation-context')).toHaveText('derivative');
  await page.getByLabel('Note content').fill('Review this definition before class.');
  await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.annotation-card')).toContainText('Review this definition before class.');
  await expect(page.locator('.annotation-mark')).toHaveText('derivative');
  expect(await page.locator('.annotation-mark').evaluate(el=>getComputedStyle(el).textDecorationStyle)).toBe('dashed');
  await expect.poll(async()=>(await annotations(page)).length).toBe(1);
  await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();
  await page.locator('.annotation-mark').click();
  await expect(page.getByLabel('Note content')).toHaveValue('Review this definition before class.');
  await page.getByLabel('Note content').fill('Rate of change is the key idea.');
  await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.annotation-body')).toHaveText('Rate of change is the key idea.');
  await expect(page.locator('.selectable-transcript')).toHaveText(transcript);
  await page.getByRole('button',{name:'Delete note or question',exact:true}).click();
  await expect(page.locator('.annotation-mark,.annotation-card')).toHaveCount(0);
});

test('AI answer can remain in question history and joins notes only on request',async({page})=>{
  let requests=0,body:any;
  await page.route('https://reader-test.invalid/**',async route=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    requests++;body=route.request().postDataJSON();
    await route.fulfill({status:requests===1?503:200,headers,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'A positive derivative means the function is increasing locally.'}}]})});
  });
  await seed(page);
  const start=transcript.indexOf('positive');await select(page,start,start+8);
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();
  await page.getByLabel('Your question').fill('What does positive mean here?');
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Model request failed');
  await expect(page.getByLabel('Your question')).toHaveValue('What does positive mean here?');
  await page.getByRole('button',{name:'Send question',exact:true}).click();
  await expect(page.locator('.ai-answer')).toContainText('function is increasing');
  expect(body.messages[0].content).toContain('Respond in English');
  expect(body.messages[1].content).toContain('Selected passage: "positive"');
  await expect.poll(async()=>(await annotations(page))[0]?.saved).toBe(false);
  await page.screenshot({path:'test-results/reader-ai-answer.png',fullPage:true});
  await page.getByRole('button',{name:'Keep in question history',exact:true}).click();
  await expect(page.locator('.question-mark')).toHaveText('positive');
  await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();
  await expect(page.locator('.annotation-card-heading')).not.toContainText('Added to notes');
  await page.locator('.question-mark').click();
  await page.getByRole('dialog').getByRole('button',{name:'Add to notes',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Added to notes',exact:true})).toBeDisabled();
  await expect.poll(async()=>(await annotations(page))[0]?.saved).toBe(true);
  expect((await annotations(page))[0].text).toContain('function is increasing');
  expect(requests).toBe(2);
});

test('overlapping selections and repeated quotations retain their exact source positions',async({page})=>{
  await seed(page);
  for(const [start,end,value] of [[4,14,'First mention'],[8,23,'Overlapping explanation'],[47,57,'Second mention']] as const) {
    await select(page,start,end);
    await page.getByRole('button',{name:'Add note',exact:true}).click();
    await page.getByLabel('Note content').fill(value);
    await page.getByRole('dialog').getByRole('button',{name:'Save',exact:true}).click();
  }
  await expect(page.locator('.annotation-card')).toHaveCount(3);
  await expect(page.locator('.selectable-transcript')).toHaveText(transcript);
  await expect.poll(async()=>(await annotations(page)).map((a:any)=>a.start)).toEqual([4,8,47]);
  await page.screenshot({path:'test-results/reader-annotations.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('button',{name:'Delete note or question',exact:true}).nth(1).click();
  await expect(page.locator('.annotation-card')).toHaveCount(2);
  await expect(page.locator('.annotation-mark')).toHaveCount(2);
  await expect(page.locator('.selectable-transcript')).toHaveText(transcript);
});
