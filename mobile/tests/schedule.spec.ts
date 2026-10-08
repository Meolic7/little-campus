import {test,expect,type Page} from '@playwright/test';

test.use({timezoneId:'Asia/Shanghai'});
const today='2026-10-08T12:00:00+08:00';

async function seed(page:Page,monday='2026-08-31',weeks=20) {
  await page.clock.install({time:new Date(today)});
  await page.addInitScript(({monday,weeks})=>{
    localStorage.setItem('CapacitorStorage.campus.locale','zh');
    localStorage.setItem('CapacitorStorage.campus.data.v1',JSON.stringify({
      version:1,tasks:[],notes:[],records:[],timer:null,term:{name:'秋季学期',monday,weeks},
      courses:[
        {id:'thu',name:'今日数学',teacher:'李老师',location:'A101',day:4,start:'08:00',end:'08:45',weeks:`1-${weeks}`,parity:'all'},
        {id:'mon',name:'周一英语',teacher:'王老师',location:'B202',day:1,start:'10:00',end:'10:45',weeks:`1-${weeks}`,parity:'all'},
        {id:'odd',name:'单周实验',teacher:'',location:'实验室',day:4,start:'11:00',end:'11:45',weeks:`1-${weeks}`,parity:'odd'}
      ]
    }));
  },{monday,weeks});
  await page.goto('/');
  await page.getByRole('button',{name:'课表',exact:true}).click();
}

test('opens current week, highlights today, switches views and edits a grid course',async({page})=>{
  await seed(page);
  await expect(page.locator('.week-current')).toContainText('教学周 6');
  await expect(page.getByRole('button',{name:'周视图',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.today-day')).toContainText('10-08');
  await expect(page.locator('.schedule-day-heads [aria-current="date"]')).toHaveCount(1);
  await expect(page.locator('.schedule-course.today-course')).toHaveCount(1);
  await expect(page.locator('.schedule-course.today-course')).toContainText('今日数学');
  await expect(page.getByText('单周实验',{exact:true})).toHaveCount(0);
  const aligned=await page.evaluate(()=>{
    const head=document.querySelector('.today-day')!.getBoundingClientRect();
    const column=document.querySelector('.today-column')!.getBoundingClientRect();
    const viewport=document.querySelector('.schedule-grid-scroll')!.getBoundingClientRect();
    return Math.abs(head.left-column.left)<1&&Math.abs(head.width-column.width)<1&&column.left>=viewport.left&&column.right<=viewport.right;
  });
  expect(aligned).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.locator('.schedule-course.today-course').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('课程名称',{exact:true})).toHaveValue('今日数学');
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await expect(page.locator('.week-agenda .day-section')).toHaveCount(7);
  await expect(page.locator('.today-section .today-course')).toContainText('今日数学');
  await expect(page.locator('.schedule-grid')).toHaveCount(0);
  await page.getByRole('button',{name:'周视图',exact:true}).click();
  await expect(page.locator('.schedule-grid')).toBeVisible();
  const rail=page.locator('.schedule-time-rail');
  const header=page.locator('.schedule-grid-header');
  const container=page.getByRole('region',{name:'周视图课程表'});
  const bounds=await container.boundingBox();
  const railBounds=await rail.boundingBox();
  expect(Math.abs(railBounds!.x-bounds!.x)).toBeLessThan(2);
  await container.evaluate(el=>{el.scrollTop=200;});
  const headerBounds=await header.boundingBox();
  expect(Math.abs(headerBounds!.y-bounds!.y)).toBeLessThan(2);
  await container.evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:'test-results/schedule-week-zh.png',fullPage:true});
});

test('browsing another week clears today; return and re-entry select current week',async({page})=>{
  await seed(page);
  await page.getByRole('button',{name:'上一周',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('教学周 5');
  await expect(page.getByText('单周实验',{exact:true})).toBeVisible();
  await expect(page.locator('.today-day,.today-course')).toHaveCount(0);
  await page.getByRole('button',{name:'回到当前教学周',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('教学周 6');
  await page.getByRole('button',{name:'下一周',exact:true}).click();
  await page.getByRole('button',{name:'今天',exact:true}).click();
  await page.getByRole('button',{name:'课表',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('教学周 6');
  await expect(page.locator('.today-course')).toHaveCount(1);
  await page.getByRole('button',{name:'列表',exact:true}).click();
  await page.getByRole('button',{name:'下一周',exact:true}).click();
  await page.getByRole('button',{name:'课表',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('教学周 6');
  await expect(page.getByRole('button',{name:'列表',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.today-section .today-course')).toContainText('今日数学');
});

for(const term of [
  {name:'before term',monday:'2026-10-12',weeks:20,expected:1,disabled:'上一周'},
  {name:'after term',monday:'2026-08-31',weeks:2,expected:2,disabled:'下一周'}
]){
  test(`${term.name} clamps browsing without falsely highlighting today`,async({page})=>{
    await seed(page,term.monday,term.weeks);
    await expect(page.locator('.week-current')).toContainText(`教学周 ${term.expected}`);
    await expect(page.getByRole('button',{name:term.disabled,exact:true})).toBeDisabled();
    await expect(page.locator('[aria-current="date"],.today-course')).toHaveCount(0);
    await page.getByRole('button',{name:'列表',exact:true}).click();
    await expect(page.locator('.today-section,.today-course')).toHaveCount(0);
  });
}

test('English view labels and updated term locate current week',async({page})=>{
  await seed(page);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('button',{name:'English',exact:true}).click();
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(page.getByRole('button',{name:'Week grid',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Term settings',exact:true}).click();
  await page.getByLabel('Monday of teaching week 1').fill('2026-09-07');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 5');
  await expect(page.locator('.today-day')).toContainText('10-08');
  await expect(page.locator('.schedule-course.today-course')).toHaveCount(2);
  await page.getByRole('button',{name:'List',exact:true}).click();
  await expect(page.locator('.week-agenda')).toBeVisible();
});
