import {test,expect} from '@playwright/test';
test('Chinese and English navigation, task persistence and focus restoration',async({page})=>{
  await page.goto('/');
  await expect(page.getByRole('link',{name:/拾光校园/})).toBeVisible();
  await page.getByRole('button',{name:'待办',exact:true}).click();
  await page.getByRole('button',{name:'添加',exact:true}).click();
  await page.getByLabel('想完成什么？').fill('复习线性代数');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByText('复习线性代数',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Settings',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link',{name:/Pixel Campus/})).toBeVisible();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await expect(page.getByText('复习线性代数',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Focus',exact:true}).click();
  await page.getByRole('button',{name:'Start focusing',exact:true}).click();
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'Focus',exact:true}).click();
  await expect(page.getByText('Paused',{exact:true})).toBeVisible();
  await page.screenshot({path:'test-results/focus-en.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('manual course and class notes work without AI setup',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'课表',exact:true}).click();
  await page.getByRole('button',{name:'手动添加课程',exact:true}).click();
  await page.getByLabel('课程名称',{exact:true}).fill('高等数学');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.getByText('高等数学',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'课堂',exact:true}).click();
  await page.getByRole('button',{name:'添加',exact:true}).click();
  await page.getByRole('textbox',{name:'编辑稿',exact:true}).fill('这是今天的课堂笔记。');
  await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'课堂',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'编辑稿',exact:true})).toHaveValue('这是今天的课堂笔记。');
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.screenshot({path:'test-results/home-zh.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('AI task drafts require confirmation; summary follows language; audio failure can retry',async({page})=>{
  let speechRequests=0;
  const languages:string[]=[];
  await page.route('https://campus-test.invalid/**',async route=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    if(route.request().url().endsWith('/audio/transcriptions')){
      speechRequests++;
      await route.fulfill({status:speechRequests===1?503:200,headers,contentType:'application/json',body:JSON.stringify({text:'Today we reviewed derivatives.'})});return;
    }
    const body=route.request().postDataJSON();languages.push(body.messages[0].content);
    const summary=body.messages[1].content.includes('Summarize');
    const content=summary?{abstract:'Derivatives overview',points:['The derivative measures change.'],review:['Review the definition.'],tasks:[{title:'Practice derivatives',due:''}]}:{tasks:[{title:'Review definitions',due:''}]};
    await route.fulfill({headers,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]})});
  });
  await page.goto('/');await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();
  for(const section of ['Language model','Cloud speech recognition']){
    const card=page.locator('section.provider').filter({has:page.getByRole('heading',{name:section,exact:true})});
    await card.getByLabel('Service URL (include /v1)').fill('https://campus-test.invalid/v1');
    await card.getByLabel('Model name').fill('mock-model');
    await card.getByLabel('API key',{exact:true}).fill('not-a-real-secret');
  }
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('button',{name:'Tasks',exact:true}).click();
  await page.getByRole('textbox',{name:'Enter a learning goal…'}).fill('Learn derivatives');
  await page.getByRole('button',{name:'Suggest tasks',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await page.getByRole('button',{name:'Add these tasks',exact:true}).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.getByRole('button',{name:'Notes',exact:true}).click();
  const wav=Buffer.alloc(32044);wav.write('RIFF');wav.writeUInt32LE(32036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
  await page.locator('input[type=file]').setInputFiles({name:'class.wav',mimeType:'audio/wav',buffer:wav});
  await expect(page.getByRole('button',{name:'Retry',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByText('Today we reviewed derivatives.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Summarize',exact:true}).click();
  await expect(page.getByText('Derivatives overview',{exact:true})).toBeVisible();
  expect(languages.every(x=>x.includes('Respond in English'))).toBeTruthy();
  const saved=await page.evaluate(()=>JSON.stringify(localStorage));
  expect(saved).not.toContain('not-a-real-secret');
});
test('MiMo ASR uses chat completions audio input',async({page})=>{
  let requestBody:any;
  await page.route('https://api.xiaomimimo.com/**',async route=>{
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
    if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
    requestBody=route.request().postDataJSON();
    await route.fulfill({status:200,headers,contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'silence'}}]})});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();
  const card=page.locator('section.provider').filter({has:page.getByRole('heading',{name:'Cloud speech recognition',exact:true})});
  await card.getByLabel('Service URL (include /v1)').fill('https://api.xiaomimimo.com/v1');
  await card.getByLabel('Model name').fill('mimo-v2.5-asr');
  await card.getByLabel('API key',{exact:true}).fill('not-a-real-secret');
  await card.getByRole('button',{name:'Save & test',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('accepted a silence test');
  expect(requestBody.model).toBe('mimo-v2.5-asr');
  expect(requestBody.messages[0].content[0].type).toBe('input_audio');
  expect(requestBody.messages[0].content[0].input_audio.format).toBe('wav');
  expect(requestBody.messages[0].content[0].input_audio.data).toMatch(/^data:audio\/wav;base64,/);
});
