import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Clock3, Headphones, House, ListTodo, Settings as SettingsIcon, ArrowUpRight, Play, Sprout } from 'lucide-react';
import { LocaleContext, resolveLanguage, tr, copy, type Key, weekday } from './i18n';
import type { Data, LocaleChoice, Page, Providers } from './types';
import { emptyProviders } from './types';
import { App as NativeApp } from '@capacitor/app';
import { native, loadData, loadLocale, loadProviders, saveData, saveLocale, saveProviders } from './platform';
import { initialData, localDate, occurs, settle, teachingWeek } from './core';
import { Button, Empty, Tree } from './ui';
import { Schedule } from './Schedule';
import { Tasks } from './Tasks';
import { Focus } from './Focus';
import { Notes } from './Notes';
import { Settings } from './Settings';
export type Update=(fn:(previous:Data)=>Data)=>void;
export type Run=(fn:()=>Promise<void>)=>Promise<void>;
export default function App() {
  const [data,setData]=useState(initialData),[providers,setProviders]=useState<Providers>(emptyProviders),[choice,setChoice]=useState<LocaleChoice>('system'),[page,setPage]=useState<Page>('home');
  const [scheduleEntry,setScheduleEntry]=useState(0);
  const [ready,setReady]=useState(false),[fatal,setFatal]=useState(false),[notice,setNotice]=useState('');const hydrated=useRef(false);
  const language=resolveLanguage(choice),t=(key:Key)=>tr(language,key);
  const notify=(message:string)=>setNotice(message);
  const run:Run=async fn=>{try{await fn();}catch(e){const key=(e as Error).message;notify(key in copy?t(key as Key):t('requestFailed'));}};
  useEffect(()=>{Promise.all([loadData(),loadLocale(),loadProviders()]).then(([d,l,p])=>{setData(settle(d));setChoice(l);setProviders(p);hydrated.current=true;setReady(true);}).catch(()=>{setFatal(true);setReady(true);});},[]);
  useEffect(()=>{if(hydrated.current)saveData(data).catch(()=>notify(t('storageError')));},[data]);
  useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=t('brand');},[language]);
  useEffect(()=>{if(notice){const id=setTimeout(()=>setNotice(''),5500);return()=>clearTimeout(id);}},[notice]);
  useEffect(()=>{const tick=()=>setData(d=>settle(d));const id=setInterval(tick,1000);window.addEventListener('focus',tick);return()=>{clearInterval(id);window.removeEventListener('focus',tick);};},[]);
  const localeChange=(v:LocaleChoice)=>{setChoice(v);saveLocale(v).catch(()=>notify(t('storageError')));};
  const changeProviders=async(p:Providers)=>{await saveProviders(p);setProviders(p);};
  const activeRecording=data.notes.some(n=>n.recording);
  const navigate=(p:Page)=>{if(activeRecording&&p!=='notes'){notify(t('sessionBusy'));return;}if(p==='schedule')setScheduleEntry(n=>n+1);setPage(p);};
  useEffect(()=>{
    if(!native)return;
    const listener=NativeApp.addListener('backButton',()=>{
      const dialog=document.querySelector('dialog[open]');
      if(dialog){dialog.dispatchEvent(new Event('cancel',{cancelable:true}));return;}
      if(activeRecording){notify(t('sessionBusy'));return;}
      if(page!=='home')setPage('home');else void NativeApp.exitApp();
    });
    return()=>{void listener.then(l=>l.remove());};
  },[page,activeRecording,language]);
  if(!ready)return <div className="startup"><Tree/>{t('loading')}</div>;
  if(fatal)return <div className="startup"><Tree/>{t('invalidData')}</div>;
  return <LocaleContext.Provider value={{language,choice,setChoice:localeChange}}><div className="mobile-app">
    <header className="app-header"><a className="brand" href="#" onClick={e=>{e.preventDefault();navigate('home');}}><span className="brand-icon"><Sprout size={22}/></span><div>{t('brand')}<small>GROW AT YOUR OWN PACE</small></div></a><button className={`icon-button ${page==='settings'?'selected':''}`} aria-label={t('settings')} onClick={()=>navigate('settings')}><SettingsIcon size={21}/></button></header>
    <main>{page==='home'&&<><div className="date-line"><span>{new Date().toLocaleDateString(language==='zh'?'zh-CN':'en-US',{month:'long',day:'numeric',weekday:'long'})}</span><span className="live-dot"/> {t('localOnly').split(' · ')[0]}</div><section className="hero"><div className="hero-copy"><span className="eyebrow">YOUR LITTLE STUDY CORNER</span><h1>{t('hello')}<br/><em>{t('hero')}</em></h1><p>{t('heroDesc')}</p><Button onClick={()=>navigate('focus')}><Play size={16}/>{t('startFocus')}</Button></div><div className="pixel-garden"><span className="pixel-sun"/><span className="cloud c1"/><span className="cloud c2"/><div className="hills"/><div className="hero-tree big"><Tree/></div><div className="hero-tree small"><Tree growth={.4}/></div><div className="pixel-path"/><span className="garden-sign">+1 GROWTH</span></div></section>
    <div className="stats"><div><span><Clock3 size={16}/>{t('focusMinutes')}</span><b>{Math.floor(data.records.filter(r=>localDate(new Date(r.date))===localDate()).reduce((s,r)=>s+r.seconds,0)/60)}<small> min</small></b></div><div><span><Check size={16}/>{t('pending')}</span><b>{data.tasks.filter(x=>!x.done).length}</b></div><div><span><Sprout size={16}/>{t('plants')}</span><b>{data.records.filter(r=>r.completed).length}</b></div></div>
    <div className="section-heading"><h2>{t('todayClasses')}</h2><button onClick={()=>navigate('schedule')}>{t('all')}<ArrowUpRight size={15}/></button></div><div className="home-courses">{data.courses.filter(c=>c.day===(new Date().getDay()||7)&&occurs(c,teachingWeek(data.term.monday),data.term.weeks)).map(c=><article className="class-card" key={c.id}><time>{c.start}<small>{c.end}</small></time><div><b>{c.name}</b><p>{c.location||'—'} · {c.teacher||'—'}</p></div></article>)}{!data.courses.some(c=>c.day===(new Date().getDay()||7)&&occurs(c,teachingWeek(data.term.monday),data.term.weeks))&&<Empty>{t('noClasses')}</Empty>}</div>
    <div className="section-heading"><h2>{t('latest')}</h2><button onClick={()=>navigate('notes')}>{t('all')}<ArrowUpRight size={15}/></button></div>{data.notes.length?data.notes.slice(0,3).map(n=><button className="note-row" key={n.id} onClick={()=>navigate('notes')}><span className="note-icon"><Headphones size={19}/></span><div><b>{n.title}</b><small>{new Date(n.created).toLocaleDateString(language==='zh'?'zh-CN':'en-US')}</small></div><ArrowUpRight size={18}/></button>):<Empty>{t('emptyNotes')}</Empty>}</>}
    {page==='schedule'&&<Schedule entry={scheduleEntry} data={data} update={setData} providers={providers} run={run}/>}
    {page==='tasks'&&<Tasks data={data} update={setData} providers={providers} run={run} focusTask={id=>{sessionStorage.setItem('focusTask',id);navigate('focus');}}/>}
    {page==='focus'&&<Focus data={data} update={setData} notify={notify}/>}
    <div hidden={page!=='notes'}><Notes data={data} update={setData} providers={providers} run={run} notify={notify}/></div>
    {page==='settings'&&<Settings providers={providers} save={changeProviders} run={run} notify={notify}/>}
    </main><nav className="bottom-nav" aria-label={t('brand')}>{([['home',House],['schedule',CalendarDays],['focus',Clock3],['tasks',ListTodo],['notes',Headphones]] as const).map(([id,Icon])=><button key={id} className={page===id?'active':''} onClick={()=>navigate(id)}><Icon size={21}/><span>{t(id)}</span>{page===id&&<i/>}</button>)}</nav>
    {notice&&<div className="toast" role="status" onClick={()=>setNotice('')}>{notice}</div>}
  </div></LocaleContext.Provider>;
}
