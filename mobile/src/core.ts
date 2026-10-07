import type { Course, Data, FocusRecord, Timer } from './types';
export function initialData(now = new Date()): Data {
  const monday = new Date(now); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return {version: 1, tasks: [], courses: [], notes: [], records: [], timer: null, term: {name: '', monday: localDate(monday), weeks: 20}};
}
export function localDate(date = new Date()): string { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
export function teachingWeek(monday: string, now = new Date()): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const [y,m,d] = monday.split('-').map(Number); return Math.floor((today-Date.UTC(y,m-1,d))/604800000)+1;
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
