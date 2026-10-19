import {test,expect,type Page} from '@playwright/test';
import type { WeekStart } from '../src/types';

test.use({timezoneId:'Asia/Shanghai'});

async function seed(page:Page,weekStartsOn?:WeekStart,time='2026-10-18T12:00:00+08:00') {
  await page.clock.install({time:new Date(time)});
  await page.addInitScript(({weekStartsOn})=>{
    localStorage.setItem('CapacitorStorage.campus.locale','en');
    if(localStorage.getItem('CapacitorStorage.campus.data.v1'))return;
    const course={teacher:'',location:'A101',start:'08:00',end:'09:00',day:7};
    localStorage.setItem('CapacitorStorage.campus.data.v1',JSON.stringify({
      version:1,tasks:[],notes:[],records:[],timer:null,
      term:{name:'Fall',monday:'2026-08-31',weeks:20,weekStartsOn},
      courses:[
        {...course,id:'even',name:'Sunday week eight',weeks:'8',parity:'even'},
        {...course,id:'odd',name:'Sunday week seven',weeks:'7',parity:'odd'},
        {...course,id:'monday',name:'Monday week eight',day:1,weeks:'8',parity:'all'}
      ]
    }));
  },{weekStartsOn});
  await page.goto('/');
}

test('Sunday of week 8 agrees across home, grid, list, browsing and reload',async({page})=>{
  await seed(page,7);
  await expect(page.locator('.home-courses')).toContainText('Sunday week eight');
  await expect(page.locator('.home-courses')).not.toContainText('Sunday week seven');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 8');
  await expect(page.locator('.schedule-day-heads>div').first()).toHaveText('Sun10-18');
  await expect(page.locator('.schedule-day-heads>div').last()).toHaveText('Sat10-24');
  await expect(page.locator('.schedule-course.today-course')).toContainText('Sunday week eight');
  await page.getByRole('button',{name:'Previous week',exact:true}).click();
  await expect(page.locator('.schedule-day-heads>div').first()).toHaveText('Sun10-11');
  await expect(page.locator('.schedule-course')).toContainText('Sunday week seven');
  await expect(page.locator('.today-day,.today-course')).toHaveCount(0);
  await page.getByRole('button',{name:'Return to current week',exact:true}).click();
  await page.getByRole('button',{name:'List',exact:true}).click();
  await expect(page.locator('.week-agenda .day-section').first().locator('h3')).toHaveText('Sun 10-18');
  await expect(page.locator('.today-section .today-course')).toContainText('Sunday week eight');
  await page.reload();
  await expect(page.locator('.home-courses')).toContainText('Sunday week eight');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 8');
});

test('legacy terms default to Monday and can persist either first day',async({page})=>{
  await seed(page);
  await expect(page.locator('.home-courses')).toContainText('Sunday week seven');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 7');
  await expect(page.locator('.schedule-day-heads>div').first()).toHaveText('Mon10-12');
  await page.getByRole('button',{name:'Term settings',exact:true}).click();
  await expect(page.getByLabel('First day of the week')).toHaveValue('1');
  await page.getByLabel('First day of the week').selectOption('7');
  await expect(page.getByLabel('First day of teaching week 1 (Sun)')).toHaveValue('2026-08-30');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 8');
  await expect(page.locator('.schedule-course.today-course')).toContainText('Sunday week eight');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('CapacitorStorage.campus.data.v1')!).term.weekStartsOn)).toBe(7);
  await page.reload();
  await expect(page.locator('.home-courses')).toContainText('Sunday week eight');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.getByRole('button',{name:'Term settings',exact:true}).click();
  await expect(page.getByLabel('First day of the week')).toHaveValue('7');
  await page.getByLabel('First day of the week').selectOption('1');
  await expect(page.getByLabel('First day of teaching week 1 (Mon)')).toHaveValue('2026-08-31');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 7');
  await expect(page.locator('.schedule-course.today-course')).toContainText('Sunday week seven');
});

test('Sunday-first date input validates weekdays and updates the anchor',async({page})=>{
  await seed(page,7);
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await page.getByRole('button',{name:'Term settings',exact:true}).click();
  const date=page.getByLabel('First day of teaching week 1 (Sun)');
  await date.fill('');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('The date must match');
  await date.fill('2026-09-01');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await date.fill('2026-09-06');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.week-current')).toContainText('Week 7');
  await expect(page.locator('.schedule-course.today-course')).toContainText('Sunday week seven');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('CapacitorStorage.campus.data.v1')!).term.monday)).toBe('2026-09-07');
});

test('Saturday to Sunday advances the week and refreshes highlighted classes',async({page})=>{
  await seed(page,7,'2026-10-17T23:59:30+08:00');
  await page.getByRole('button',{name:'Schedule',exact:true}).click();
  await expect(page.locator('.week-current')).toContainText('Week 7');
  await expect(page.locator('.today-day')).toHaveText('Sat10-17');
  await page.clock.fastForward(60000);
  await expect(page.locator('.week-current')).toContainText('Week 8');
  await expect(page.locator('.today-day')).toHaveText('Sun10-18');
  await expect(page.locator('.schedule-course.today-course')).toContainText('Sunday week eight');
});

for(const first of [
  {day:1,label:'Mon',start:'2026-08-31',weekStart:'10-19',last:'Sun10-25'},
  {day:2,label:'Tue',start:'2026-08-25',weekStart:'10-13',last:'Mon10-19'},
  {day:3,label:'Wed',start:'2026-08-26',weekStart:'10-14',last:'Tue10-20'},
  {day:4,label:'Thu',start:'2026-08-27',weekStart:'10-15',last:'Wed10-21'},
  {day:5,label:'Fri',start:'2026-08-28',weekStart:'10-16',last:'Thu10-22'},
  {day:6,label:'Sat',start:'2026-08-29',weekStart:'10-17',last:'Fri10-23'},
  {day:7,label:'Sun',start:'2026-08-30',weekStart:'10-18',last:'Sat10-24'}
]) {
  test(`${first.label} can be selected, dated, saved and restored as the first day`,async({page})=>{
    await seed(page,undefined,'2026-10-19T12:00:00+08:00');
    await page.getByRole('button',{name:'Schedule',exact:true}).click();
    await page.getByRole('button',{name:'Term settings',exact:true}).click();
    await expect(page.getByLabel('First day of the week').locator('option')).toHaveCount(7);
    await page.getByLabel('First day of the week').selectOption(String(first.day));
    const date=page.getByLabel(`First day of teaching week 1 (${first.label})`);
    await expect(date).toHaveValue(first.start);
    // Exercise both directions of date conversion instead of relying on a prefilled value.
    await date.fill('2026-09-02');
    if(first.day!==3) {
      await page.getByRole('button',{name:'Save',exact:true}).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('status')).toContainText('The date must match');
    }
    await date.fill(first.start);
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.week-current')).toContainText('Week 8');
    await expect(page.locator('.schedule-day-heads>div').first()).toHaveText(`${first.label}${first.weekStart}`);
    await expect(page.locator('.schedule-day-heads>div').last()).toHaveText(first.last);
    await expect(page.locator('.today-day')).toHaveText('Mon10-19');
    await expect(page.locator('.schedule-course.today-course')).toContainText('Monday week eight');
    await page.getByRole('button',{name:'List',exact:true}).click();
    await expect(page.locator('.week-agenda .day-section').first().locator('h3')).toHaveText(`${first.label} ${first.weekStart}`);
    await expect(page.locator('.today-section .today-course')).toContainText('Monday week eight');
    await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('CapacitorStorage.campus.data.v1')!).term.weekStartsOn)).toBe(first.day);
    await page.reload();
    await expect(page.locator('.home-courses')).toContainText('Monday week eight');
    await page.getByRole('button',{name:'Schedule',exact:true}).click();
    await expect(page.locator('.schedule-day-heads>div').first()).toHaveText(`${first.label}${first.weekStart}`);
    await page.getByRole('button',{name:'Term settings',exact:true}).click();
    await expect(page.getByLabel('First day of the week')).toHaveValue(String(first.day));
    await expect(page.getByLabel(`First day of teaching week 1 (${first.label})`)).toHaveValue(first.start);
  });
}
