import type { Course, Data, FocusRecord, Term, Timer, WeekStart } from './types';
export function initialData(now = new Date()): Data {
  const monday = new Date(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return {version: 1, tasks: [], courses: [], notes: [], records: [], timer: null, term: {name: '', monday: localDate(monday), weeks: 20, weekStartsOn: 1}};
}
export function localDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
// The stored Monday belongs to week 1; its first day is on or before that Monday.
export function weekStartOffset(weekStartsOn: WeekStart = 1): number {
  return -((8-weekStartsOn)%7);
}
export function teachingWeek(monday: string, now = new Date(), weekStartsOn: WeekStart = 1): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y,m,d] = monday.split('-').map(Number);
  const start = Date.UTC(y,m-1,d) + weekStartOffset(weekStartsOn)*86400000;
  return Math.floor((today-start)/604800000)+1;
}
export function teachingDays(weekStartsOn: WeekStart = 1): WeekStart[] {
  return Array.from({length:7},(_,i)=>((weekStartsOn-1+i)%7+1) as WeekStart);
}
export function courseDate(term: Term, week: number, day: number): Date {
  const date = new Date(`${term.monday}T12:00:00`);
  const firstDay = term.weekStartsOn??1;
  const offset = weekStartOffset(firstDay)+(day-firstDay+7)%7;
  date.setDate(date.getDate()+(week-1)*7+offset);
  return date;
}
export function parseWeeks(value: string, max: number): number[] {
  const weeks = new Set<number>();
  for (const part of value.replaceAll('，',',').split(',')) {
    if (!/^\s*\d{1,2}(\s*-\s*\d{1,2})?\s*$/.test(part)) return [];
    const [start,end = start] = part.split('-').map(Number);
    if (start < 1 || end < start || end > max) return [];
    for(let n=start;n<=end;n++) weeks.add(n);
  } return [...weeks].sort((a,b)=>a-b);
}
export function occurs(c: Course, week: number, max: number) { return parseWeeks(c.weeks, max).includes(week) && (c.parity==='all'||week%2===(c.parity==='odd'?1:0)); }
export function validCourse(c: Course, max: number) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  return !!c.name.trim() && c.day>=1 && c.day<=7 && time.test(c.start) && time.test(c.end) && c.end>c.start && parseWeeks(c.weeks,max).length>0 && parseWeeks(c.weeks,max).some(w=>occurs(c,w,max));
}
export function clashes(drafts: Course[], existing: Course[], max: number): string[] {
  const out = new Set<string>();
  drafts.forEach((c,i)=>{ for (const other of [...existing,...drafts.slice(0,i)]) {
    if(c.id===other.id || c.day!==other.day || c.start>=other.end || c.end<=other.start) continue;
    if(parseWeeks(c.weeks,max).some(w=>occurs(c,w,max)&&occurs(other,w,max))) out.add(`${c.name} ↔ ${other.name}`);
  }}); return [...out];
}
export function secondsLeft(timer: Timer, now=Date.now()) {return timer.status==='running'?Math.max(0,Math.ceil((timer.deadline-now)/1000)):timer.remaining;}
export function settle(data: Data, now=Date.now()): Data {
  const timer=data.timer;
  if(!timer||timer.status!=='running'||now<timer.deadline) return data;
  const record: FocusRecord={id:timer.id,seconds:timer.focus*60,completed:true,date:new Date(timer.deadline).toISOString(),task:timer.task};
  return {...data,timer:{...timer,status:'completed',remaining:0},records:timer.phase==='focus'&&!data.records.some(r=>r.id===timer.id)?[...data.records,record]:data.records};
}
export function fmt(seconds: number) { const n=Math.max(0,Math.floor(seconds)); return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`; }
