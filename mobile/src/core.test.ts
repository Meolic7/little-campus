import { describe,expect,it } from 'vitest';
import { clashes,initialData,occurs,parseWeeks,secondsLeft,settle,teachingWeek,validCourse } from './core';
import { copy,resolveLanguage,tr } from './i18n';
import { courseResults,endpoint,summaryResult,taskResults } from './ai';
import type { Course,Timer } from './types';
const c:Course={id:'a',name:'Math',teacher:'',location:'',day:1,start:'08:00',end:'09:00',weeks:'1-16',parity:'odd'};
describe('timetable semantics',()=>{
  it('expands explicit weeks without guessing',()=>{expect(parseWeeks('1-3,5,3',20)).toEqual([1,2,3,5]);expect(parseWeeks('1-99',20)).toEqual([]);expect(parseWeeks('',20)).toEqual([]);expect(parseWeeks('8-3',20)).toEqual([]);});
  it('checks parity, time and term boundaries',()=>{expect(occurs(c,1,20)).toBe(true);expect(occurs(c,2,20)).toBe(false);expect(validCourse(c,20)).toBe(true);expect(validCourse({...c,day:0},20)).toBe(false);expect(validCourse({...c,end:'07:00'},20)).toBe(false);expect(validCourse(c,10)).toBe(false);});
  it('only warns about real overlapping weeks and times',()=>{expect(clashes([{...c,id:'b'}],[c],20)).toHaveLength(1);expect(clashes([{...c,id:'b',parity:'even'}],[c],20)).toEqual([]);expect(clashes([{...c,id:'b',start:'09:00',end:'10:00'}],[c],20)).toEqual([]);});
  it('computes week at calendar day boundaries',()=>{expect(teachingWeek('2026-09-14',new Date(2026,8,20,23))).toBe(1);expect(teachingWeek('2026-09-14',new Date(2026,8,21))).toBe(2);});
});
describe('persistent timer',()=>{
  const timer:Timer={id:'once',phase:'focus',status:'running',focus:25,rest:5,remaining:1500,deadline:100000,task:''};
  it('completes once after reopening and does not duplicate plants',()=>{const d={...initialData(),timer};const once=settle(d,200000);expect(once.records).toHaveLength(1);expect(once.timer?.status).toBe('completed');expect(settle(once,300000).records).toHaveLength(1);});
  it('paused timers do not consume wall time; breaks give no reward',()=>{expect(secondsLeft({...timer,status:'paused',remaining:20},999999)).toBe(20);expect(settle({...initialData(),timer:{...timer,phase:'rest'}},999999).records).toEqual([]);});
});
describe('language and provider contracts',()=>{
  it('all UI strings have both translations',()=>{for(const pair of Object.values(copy)){expect(pair).toHaveLength(2);expect(pair[0].trim()).not.toBe('');expect(pair[1].trim()).not.toBe('');}});
  it('follows system language while respecting explicit selection',()=>{expect(resolveLanguage('system','zh-HK')).toBe('zh');expect(resolveLanguage('system','fr')).toBe('en');expect(resolveLanguage('en','zh-CN')).toBe('en');expect(tr('zh','schedule')).toBe('课表');});
  it('rejects credential-bearing or plaintext provider URLs',()=>{const p={url:'https://example.com/v1',model:'test',key:'secret',timeout:120};expect(endpoint(p,'/chat/completions')).toBe('https://example.com/v1/chat/completions');expect(()=>endpoint({...p,url:'https://user:pass@example.com'},'/x')).toThrow('invalidUrl');expect(()=>endpoint({...p,url:'http://example.com'},'/x')).toThrow('invalidUrl');});
  it('leaves unknown course fields for user correction',()=>{const result=courseResults({courses:[{name:'Math'}]});expect(result[0].day).toBe(0);expect(result[0].weeks).toBe('');expect(result[0].start).toBe('');});
  it('validates AI suggestions before saving',()=>{expect(()=>taskResults({tasks:[{title:''}]})).toThrow('invalidResponse');const tasks=taskResults({tasks:[{title:'Review',due:null}]});expect(tasks[0].due).toBe('');expect(tasks[0].done).toBe(false);expect(()=>summaryResult({abstract:'x',points:[4],review:[]})).toThrow('invalidResponse');});
});
