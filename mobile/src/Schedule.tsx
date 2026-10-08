import { useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Grid2X2, List, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Course, Data, Providers } from './types';
import { uid } from './types';
import type { Run, Update } from './App';
import { LocaleContext, useText, weekday } from './i18n';
import { clashes, localDate, occurs, teachingWeek, validCourse } from './core';
import { chat, cleanHtml, courseResults, readMaterial } from './ai';
import { Button, Busy, Empty, Field, Header, Modal } from './ui';
const freshCourse=():Course=>({id:uid(),name:'',teacher:'',location:'',day:1,start:'08:00',end:'08:45',weeks:'1-16',parity:'all'});
function CourseFields({course,set}:{course:Course;set:(c:Course)=>void}) {
  const t=useText(),{language}=useContext(LocaleContext);
  return <><Field label={t('courseName')}><input value={course.name} onChange={e=>set({...course,name:e.target.value})}/></Field><div className="two-col"><Field label={t('teacher')}><input value={course.teacher} onChange={e=>set({...course,teacher:e.target.value})}/></Field><Field label={t('location')}><input value={course.location} onChange={e=>set({...course,location:e.target.value})}/></Field></div><div className="three-col"><Field label={t('day')}><select value={course.day} onChange={e=>set({...course,day:+e.target.value})}><option value={0}>—</option>{Array.from({length:7},(_,i)=><option key={i} value={i+1}>{weekday(language,i+1)}</option>)}</select></Field><Field label={t('start')}><input type="time" value={course.start} onChange={e=>set({...course,start:e.target.value})}/></Field><Field label={t('end')}><input type="time" value={course.end} onChange={e=>set({...course,end:e.target.value})}/></Field></div><div className="two-col"><Field label={t('weeks')}><input placeholder="1-16,18" value={course.weeks} onChange={e=>set({...course,weeks:e.target.value})}/></Field><Field label={t('week')}><select value={course.parity} onChange={e=>set({...course,parity:e.target.value as Course['parity']})}><option value="all">{t('allWeeks')}</option><option value="odd">{t('odd')}</option><option value="even">{t('even')}</option></select></Field></div></>;
}
export function Schedule({entry,data,update,providers,run}:{entry:number;data:Data;update:Update;providers:Providers;run:Run}) {
  const t=useText(),{language}=useContext(LocaleContext);
  const [now,setNow]=useState(()=>new Date());
  const today=localDate(now),currentDay=now.getDay()||7;
  const actualWeek=teachingWeek(data.term.monday,now);
  const currentWeek=Math.min(data.term.weeks,Math.max(1,actualWeek));
  useEffect(()=>{
    const refresh=()=>setNow(new Date());
    const timer=setInterval(refresh,60000);
    window.addEventListener('focus',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
  },[]);
  const [week,setWeek]=useState(currentWeek),[mode,setMode]=useState<'grid'|'list'>('grid'),[edit,setEdit]=useState<Course|null>(null),[term,setTerm]=useState<Data['term']|null>(null),[importing,setImporting]=useState(false),[accept,setAccept]=useState(false);
  useEffect(()=>setWeek(currentWeek),[entry,currentWeek,data.term.monday,data.term.weeks]);
  const warnings=edit?clashes([edit],data.courses,data.term.weeks):[];
  const save=()=>run(async()=>{if(!edit||!validCourse(edit,data.term.weeks))throw Error('courseInvalid');if(warnings.length&&!accept)return;update(d=>({...d,courses:[...d.courses.filter(c=>c.id!==edit.id),edit]}));setEdit(null);});
  const weekDays=Array.from({length:7},(_,i)=>i+1);
  const weekStart=new Date(`${data.term.monday}T12:00:00`);weekStart.setDate(weekStart.getDate()+(week-1)*7);
  const dateForDay=(day:number)=>{const date=new Date(weekStart);date.setDate(date.getDate()+day-1);return date;};
  const dateRange=`${localDate(dateForDay(1)).slice(5)} – ${localDate(dateForDay(7)).slice(5)}`;
  const openCourse=(course:Course)=>{setEdit({...course});setAccept(false);};
  const renderList=()=> <div className="week-agenda">{weekDays.map(day=>{const list=data.courses.filter(c=>c.day===day&&occurs(c,week,data.term.weeks)).sort((a,b)=>a.start.localeCompare(b.start));return <section key={day} className={`day-section ${localDate(dateForDay(day))===today?'today-section':''}`}><h3 aria-current={localDate(dateForDay(day))===today?'date':undefined}>{weekday(language,day)} <small>{localDate(dateForDay(day)).slice(5)}</small></h3><div>{list.map(c=><button className={`class-card ${localDate(dateForDay(day))===today?'today-course':''}`} key={c.id} onClick={()=>openCourse(c)}><time>{c.start}<small>{c.end}</small></time><div><b>{c.name}</b><p>{c.location||'—'} · {c.teacher||'—'}</p></div></button>)}{!list.length&&<span className="no-class">—</span>}</div></section>;})}</div>;
  const renderGrid=()=> <TimetableGrid courses={data.courses} maxWeeks={data.term.weeks} week={week} weekDays={weekDays} currentDay={currentDay} activeWeek={week===actualWeek} dateForDay={dateForDay} language={language} openCourse={openCourse}/>;
  return <section className="schedule-page"><Header title={t('schedule')} subtitle={`${data.term.name||t('tagline')} · ${t('week')} ${week} · ${dateRange}`}><button className="icon-button" aria-label={t('term')} onClick={()=>setTerm({...data.term})}><CalendarDays size={21}/></button></Header><div className="actions schedule-actions"><div className="schedule-mode" role="group" aria-label={t('scheduleMode')}><button className={mode==='grid'?'selected':''} aria-pressed={mode==='grid'} onClick={()=>setMode('grid')}><Grid2X2 size={15}/>{t('gridView')}</button><button className={mode==='list'?'selected':''} aria-pressed={mode==='list'} onClick={()=>setMode('list')}><List size={15}/>{t('listView')}</button></div><Button onClick={()=>setImporting(true)}><Sparkles size={16}/>{t('import')}</Button><button className="button secondary" aria-label={t('addCourse')} onClick={()=>{setEdit(freshCourse());setAccept(false);}}><Plus size={16}/>{t('add')}</button></div><div className="week-picker"><button aria-label={t('prev')} disabled={week===1} onClick={()=>setWeek(week-1)}><ChevronLeft/></button><button className="week-current" aria-label={t('returnCurrentWeek')} onClick={()=>setWeek(currentWeek)}>{t('week')} {week}<small>{week===actualWeek?t('currentWeek'):dateRange}</small></button><button aria-label={t('next')} disabled={week===data.term.weeks} onClick={()=>setWeek(week+1)}><ChevronRight/></button></div>
    {mode==='grid'?renderGrid():renderList()}
    {edit&&<Modal title={t('edit')} close={()=>setEdit(null)}><CourseFields course={edit} set={setEdit}/>{warnings.length>0&&<div className="warning">{t('conflicts')}{warnings.join(' / ')}<label><input type="checkbox" checked={accept} onChange={e=>setAccept(e.target.checked)}/>{t('acceptConflicts')}</label></div>}<div className="actions"><Button disabled={warnings.length>0&&!accept} onClick={save}>{t('save')}</Button>{data.courses.some(c=>c.id===edit.id)&&<Button secondary onClick={()=>{update(d=>({...d,courses:d.courses.filter(c=>c.id!==edit.id)}));setEdit(null);}}><Trash2 size={16}/>{t('delete')}</Button>}</div></Modal>}
    {term&&<Modal title={t('term')} close={()=>setTerm(null)}><Field label={t('termName')}><input value={term.name} onChange={e=>setTerm({...term,name:e.target.value})}/></Field><Field label={t('monday')}><input type="date" value={term.monday} onChange={e=>setTerm({...term,monday:e.target.value})}/></Field><Field label={t('termWeeks')}><input type="number" min="1" max="60" value={term.weeks} onChange={e=>setTerm({...term,weeks:+e.target.value})}/></Field><Button onClick={()=>run(async()=>{if(new Date(term.monday+'T12:00:00').getDay()!==1||!Number.isInteger(term.weeks)||term.weeks<1||term.weeks>60)throw Error('mondayInvalid');if(data.courses.some(c=>!validCourse(c,term.weeks)))throw Error('courseInvalid');update(d=>({...d,term}));setWeek(Math.min(week,term.weeks));setTerm(null);})}>{t('save')}</Button></Modal>}
    {importing&&<Import data={data} providers={providers} run={run} close={()=>setImporting(false)} save={courses=>{update(d=>({...d,courses:[...d.courses,...courses]}));setImporting(false);}}/>}</section>;
}

function TimetableGrid({courses,maxWeeks,week,weekDays,currentDay,activeWeek,dateForDay,language,openCourse}:{courses:Course[];maxWeeks:number;week:number;weekDays:number[];currentDay:number;activeWeek:boolean;dateForDay:(day:number)=>Date;language:'zh'|'en';openCourse:(course:Course)=>void}) {
  const scroll=useRef<HTMLDivElement>(null);
  const [gridHeight,setGridHeight]=useState(0);
  useEffect(()=>{
    const container=scroll.current;
    if(!container)return;
    const observer=new ResizeObserver(()=>setGridHeight(container.clientHeight));
    observer.observe(container);
    return()=>observer.disconnect();
  },[]);
  const visible=courses.filter(c=>occurs(c,week,maxWeeks));
  const toMinutes=(value:string)=>{const [h,m]=value.split(':').map(Number);return h*60+m;};
  const minTime=visible.length?Math.min(...visible.map(c=>toMinutes(c.start))):8*60;
  const maxTime=visible.length?Math.max(...visible.map(c=>toMinutes(c.end))):18*60;
  const slotMinutes=30;
  const start=Math.max(0,Math.floor((minTime-30)/slotMinutes)*slotMinutes);
  const end=Math.min(24*60,Math.ceil((maxTime+30)/slotMinutes)*slotMinutes);
  const slots=Array.from({length:Math.max(1,Math.ceil((end-start)/slotMinutes))},(_,i)=>start+i*slotMinutes);
  // Fit a normal teaching day; retain readable cards with only a short scroll on small screens.
  const slotHeight=Math.max(16,Math.min(60,((gridHeight||window.innerHeight-238)-39)/slots.length));
  const label=(minutes:number)=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
  return <div className="schedule-grid-scroll" ref={scroll} tabIndex={0} role="region" aria-label={language==='zh'?'周视图课程表':'Weekly timetable'}><div className="schedule-grid" style={{'--slot-height':`${slotHeight}px`} as CSSProperties}><div className="schedule-grid-header"><span className="schedule-corner"/><div className="schedule-day-heads">{weekDays.map(day=><div key={day} aria-current={activeWeek&&day===currentDay?'date':undefined} className={activeWeek&&day===currentDay?'today-day':''}><b>{weekday(language,day)}</b><small>{localDate(dateForDay(day)).slice(5)}</small></div>)}</div></div><div className="schedule-grid-body"><div className="schedule-time-rail">{slots.map(minutes=><span key={minutes}>{label(minutes)}</span>)}</div><div className="schedule-day-columns">{weekDays.map(day=>{const list=courses.filter(c=>c.day===day&&occurs(c,week,maxWeeks));return <div key={day} className={`schedule-day-column ${activeWeek&&day===currentDay?'today-column':''}`}><div className="schedule-slots">{slots.map(minutes=><span key={minutes}/>)}</div>{list.map(course=>{const top=(toMinutes(course.start)-start)/slotMinutes*slotHeight;const height=(toMinutes(course.end)-toMinutes(course.start))/slotMinutes*slotHeight;return <button key={course.id} className={`schedule-course ${activeWeek&&day===currentDay?'today-course':''}`} style={{top,height}} aria-label={`${course.name} · ${course.start}–${course.end} · ${course.location} · ${course.teacher}`} title={`${course.name} · ${course.start}–${course.end} · ${course.location} · ${course.teacher}`} onClick={()=>openCourse(course)}><b>{course.name}</b><small className="schedule-course-time">{course.start}–{course.end}</small>{course.location&&<small className="schedule-course-meta">{course.location}</small>}{course.teacher&&<small className="schedule-course-meta">{course.teacher}</small>}</button>;})}</div>;})}</div></div></div></div>;
}
function Import({data,providers,run,close,save}:{data:Data;providers:Providers;run:Run;close:()=>void;save:(courses:Course[])=>void}) {
  const t=useText(),{language}=useContext(LocaleContext);const [file,setFile]=useState<File|null>(null),[pasted,setPasted]=useState(''),[busy,setBusy]=useState(false),[drafts,setDrafts]=useState<Course[]|null>(null),[accept,setAccept]=useState(false);
  const warnings=clashes(drafts||[],data.courses,data.term.weeks);
  const parse=()=>run(async()=>{setBusy(true);try{const source=file?await readMaterial(file):{text:cleanHtml(pasted),images:[]};const prompt=`Extract all timetable entries. Return {"courses":[{"name":"","teacher":"","location":"","day":1,"start":"HH:MM","end":"HH:MM","weeks":"1-16,18","parity":"all|odd|even"}]}. Day 1=Monday. Each separate meeting is one entry. Do not guess absent dates or periods; leave missing strings empty and day=0 when unknown. Term: ${JSON.stringify(data.term)}. Source: ${source.text.slice(0,60000)}`;setDrafts(courseResults(await chat(source.images.length?providers.vision:providers.text,language,prompt,source.images)));}finally{setBusy(false);}});
  return <Modal title={drafts?t('review'):t('import')} close={()=>{if(!busy)close();}}>{drafts?<><p className="footnote">{t('importHint')}</p>{drafts.map((c,i)=><section className="draft" key={c.id}><div className="section-heading"><b>#{i+1}</b><button onClick={()=>setDrafts(drafts.filter(x=>x.id!==c.id))}>{t('remove')}</button></div><CourseFields course={c} set={next=>{setDrafts(drafts.map(x=>x.id===c.id?next:x));setAccept(false);}}/></section>)}{warnings.length>0&&<div className="warning">{t('conflicts')}{warnings.join(' / ')}<label><input type="checkbox" checked={accept} onChange={e=>setAccept(e.target.checked)}/>{t('acceptConflicts')}</label></div>}<Button disabled={!drafts.length||warnings.length>0&&!accept} onClick={()=>run(async()=>{if(drafts.some(c=>!validCourse(c,data.term.weeks)))throw Error('courseInvalid');save(drafts);})}>{t('importConfirm')}</Button></>:<><p>{t('importHint')}</p><label className="upload-box"><Sparkles/><span>{file?.name||t('chooseFile')}</span><input type="file" accept=".html,.htm,.txt,.png,.jpg,.jpeg,.pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/></label><textarea aria-label={t('paste')} placeholder={t('paste')} value={pasted} onChange={e=>setPasted(e.target.value)}/><p className="send-hint">{t('sendHint')} {providers.text.url||t('configNeeded')} / {providers.vision.url||t('visionModel')}</p><Button disabled={busy||!file&&!pasted.trim()} onClick={parse}>{busy?<Busy/>:t('parse')}</Button></>}</Modal>;
}
