import { describe,expect,it } from 'vitest';
import { clashes,courseDate,initialData,localDate,occurs,parseWeeks,secondsLeft,settle,teachingDays,teachingWeek,validCourse } from './core';
import { copy,resolveLanguage,tr } from './i18n';
import { courseResults,endpoint,summaryResult,taskResults,transcribe } from './ai';
import { annotatedParts,resolveAnchor } from './annotations';
import type { Course,Timer } from './types';
const c:Course={id:'a',name:'Math',teacher:'',location:'',day:1,start:'08:00',end:'09:00',weeks:'1-16',parity:'odd'};
describe('timetable semantics',()=>{
  it('expands explicit weeks without guessing',()=>{expect(parseWeeks('1-3,5,3',20)).toEqual([1,2,3,5]);expect(parseWeeks('1-99',20)).toEqual([]);expect(parseWeeks('',20)).toEqual([]);expect(parseWeeks('8-3',20)).toEqual([]);});
  it('checks parity, time and term boundaries',()=>{expect(occurs(c,1,20)).toBe(true);expect(occurs(c,2,20)).toBe(false);expect(validCourse(c,20)).toBe(true);expect(validCourse({...c,day:0},20)).toBe(false);expect(validCourse({...c,end:'07:00'},20)).toBe(false);expect(validCourse(c,10)).toBe(false);});
  it('only warns about real overlapping weeks and times',()=>{expect(clashes([{...c,id:'b'}],[c],20)).toHaveLength(1);expect(clashes([{...c,id:'b',parity:'even'}],[c],20)).toEqual([]);expect(clashes([{...c,id:'b',start:'09:00',end:'10:00'}],[c],20)).toEqual([]);});
  it('computes week at calendar day boundaries',()=>{expect(teachingWeek('2026-09-14',new Date(2026,8,20,23))).toBe(1);expect(teachingWeek('2026-09-14',new Date(2026,8,21))).toBe(2);});
  it('starts week 8 on Sunday at midnight for Sunday-first schools',()=>{
    const monday='2026-08-31';
    expect(teachingWeek(monday,new Date(2026,9,17,23,59,59),7)).toBe(7);
    expect(teachingWeek(monday,new Date(2026,9,18),7)).toBe(8);
    expect(teachingWeek(monday,new Date(2026,9,18,23,59,59),7)).toBe(8);
    expect(teachingWeek(monday,new Date(2026,9,19),7)).toBe(8);
    expect(teachingWeek(monday,new Date(2026,9,24,23,59,59),7)).toBe(8);
    expect(teachingWeek(monday,new Date(2026,9,25),7)).toBe(9);
    expect(teachingWeek(monday,new Date(2026,9,18))).toBe(7);
    expect(occurs({...c,day:7,weeks:'8',parity:'even'},teachingWeek(monday,new Date(2026,9,18),7),20)).toBe(true);
  });
  it('keeps weekday IDs and dates aligned for all seven first days',()=>{
    const term={name:'Fall',monday:'2026-08-31',weeks:20};
    expect(teachingDays()).toEqual([1,2,3,4,5,6,7]);
    expect(teachingDays(7)).toEqual([7,1,2,3,4,5,6]);
    expect(localDate(courseDate(term,8,7))).toBe('2026-10-25');
    expect(localDate(courseDate({...term,weekStartsOn:7},8,7))).toBe('2026-10-18');
    expect(localDate(courseDate({...term,weekStartsOn:7},8,1))).toBe('2026-10-19');
    for(const weekStartsOn of teachingDays()) for(const week of [1,8,20]) for(const day of teachingDays(weekStartsOn)) {
      const date=courseDate({...term,weekStartsOn},week,day);
      expect(date.getDay()||7).toBe(day);
      expect(teachingWeek(term.monday,date,weekStartsOn)).toBe(week);
    }
  });
  it.each([
    {day:1 as const,start:'2026-10-19',winter:'2027-01-04'},
    {day:2 as const,start:'2026-10-13',winter:'2026-12-29'},
    {day:3 as const,start:'2026-10-14',winter:'2026-12-30'},
    {day:4 as const,start:'2026-10-15',winter:'2026-12-31'},
    {day:5 as const,start:'2026-10-16',winter:'2027-01-01'},
    {day:6 as const,start:'2026-10-17',winter:'2027-01-02'},
    {day:7 as const,start:'2026-10-18',winter:'2027-01-03'}
  ])('advances weeks at midnight on weekday $day, including year boundaries',({day,start,winter})=>{
    const term={name:'Fall',monday:'2026-08-31',weeks:20,weekStartsOn:day};
    expect(localDate(courseDate(term,8,day))).toBe(start);
    const first=new Date(`${start}T00:00:00`);
    const before=new Date(first);before.setSeconds(-1);
    const last=new Date(first);last.setDate(last.getDate()+6);last.setHours(23,59,59);
    const next=new Date(first);next.setDate(next.getDate()+7);
    expect(teachingWeek(term.monday,before,day)).toBe(7);
    expect(teachingWeek(term.monday,first,day)).toBe(8);
    expect(teachingWeek(term.monday,last,day)).toBe(8);
    expect(teachingWeek(term.monday,next,day)).toBe(9);
    expect(occurs({...c,day,parity:'even'},teachingWeek(term.monday,first,day),20)).toBe(true);
    expect(occurs({...c,day,parity:'odd'},teachingWeek(term.monday,first,day),20)).toBe(false);
    expect(localDate(courseDate({...term,monday:'2027-01-04'},1,day))).toBe(winter);
    expect(teachingWeek('2027-01-04',new Date(`${winter}T00:00:00`),day)).toBe(1);
  });
  it('handles Sunday-first term and year boundaries',()=>{
    expect(teachingWeek('2026-08-31',new Date(2026,7,29,23,59,59),7)).toBe(0);
    expect(teachingWeek('2026-08-31',new Date(2026,7,30),7)).toBe(1);
    expect(teachingWeek('2026-08-31',new Date(2027,0,16,23,59,59),7)).toBe(20);
    expect(teachingWeek('2026-08-31',new Date(2027,0,17),7)).toBe(21);
    const term={name:'Winter',monday:'2027-01-04',weeks:20,weekStartsOn:7 as const};
    expect(localDate(courseDate(term,1,7))).toBe('2027-01-03');
    expect(teachingWeek(term.monday,new Date(2027,0,2),7)).toBe(0);
    expect(teachingWeek(term.monday,new Date(2027,0,3),7)).toBe(1);
  });
});
describe('persistent timer',()=>{
  const timer:Timer={id:'once',phase:'focus',status:'running',focus:25,rest:5,remaining:1500,deadline:100000,task:''};
  it('completes once after reopening and does not duplicate plants',()=>{const d={...initialData(),timer};const once=settle(d,200000);expect(once.records).toHaveLength(1);expect(once.timer?.status).toBe('completed');expect(settle(once,300000).records).toHaveLength(1);});
  it('paused timers do not consume wall time; breaks give no reward',()=>{expect(secondsLeft({...timer,status:'paused',remaining:20},999999)).toBe(20);expect(settle({...initialData(),timer:{...timer,phase:'rest'}},999999).records).toEqual([]);});
});
describe('transcript anchors',()=>{
  it('relocates quotations after transcription corrections without guessing repeated text',()=>{
    expect(resolveAnchor('Updated intro. The answer.',{start:0,end:11,quote:'The answer.'})).toEqual({start:15,end:26,quote:'The answer.'});
    expect(resolveAnchor('same / same',{start:99,end:103,quote:'same'})).toBeNull();
    expect(resolveAnchor('changed',{start:0,end:4,quote:'gone'})).toBeNull();
  });
  it('renders overlapping notes and questions without duplicating source text',()=>{
    const base={kind:'note' as const,text:'my note',saved:true,created:'2026-10-19'};
    const parts=annotatedParts('abcdef',[
      {...base,id:'one',start:1,end:4,quote:'bcd'},
      {...base,id:'two',kind:'question',start:3,end:6,quote:'def'}
    ]);
    expect(parts.map(p=>p.text).join('')).toBe('abcdef');
    expect(parts.find(p=>p.text==='d')?.annotations.map(a=>a.id)).toEqual(['one','two']);
  });
  it('retains whole recordings when they exceed a single-request transcription limit',async()=>{
    const provider={url:'https://example.com/v1',model:'mimo-v2.5-asr',key:'',timeout:120};
    await expect(transcribe(provider,new Blob([new Uint8Array(7_500_001)],{type:'audio/wav'}))).rejects.toThrow('speechTooLarge');
  });
});
describe('language and provider contracts',()=>{
  it('all UI strings have both translations',()=>{for(const pair of Object.values(copy)){expect(pair).toHaveLength(2);expect(pair[0].trim()).not.toBe('');expect(pair[1].trim()).not.toBe('');}});
  it('follows system language while respecting explicit selection',()=>{expect(resolveLanguage('system','zh-HK')).toBe('zh');expect(resolveLanguage('system','fr')).toBe('en');expect(resolveLanguage('en','zh-CN')).toBe('en');expect(tr('zh','schedule')).toBe('课表');});
  it('rejects credential-bearing or plaintext provider URLs',()=>{const p={url:'https://example.com/v1',model:'test',key:'secret',timeout:120};expect(endpoint(p,'/chat/completions')).toBe('https://example.com/v1/chat/completions');expect(()=>endpoint({...p,url:'https://user:pass@example.com'},'/x')).toThrow('invalidUrl');expect(()=>endpoint({...p,url:'http://example.com'},'/x')).toThrow('invalidUrl');});
  it('leaves unknown course fields for user correction',()=>{const result=courseResults({courses:[{name:'Math'}]});expect(result[0].day).toBe(0);expect(result[0].weeks).toBe('');expect(result[0].start).toBe('');});
  it('validates AI suggestions before saving',()=>{expect(()=>taskResults({tasks:[{title:''}]})).toThrow('invalidResponse');const tasks=taskResults({tasks:[{title:'Review',due:null}]});expect(tasks[0].due).toBe('');expect(tasks[0].done).toBe(false);expect(()=>summaryResult({abstract:'x',points:[4],review:[]})).toThrow('invalidResponse');});
});
