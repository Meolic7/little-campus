import { useContext, useEffect, useRef, useState } from 'react';
import { FileAudio, Mic, Plus, RefreshCw, Square, Trash2, Upload, Volume2 } from 'lucide-react';
import type { Data, Note, Providers, Segment, Summary, Task } from './types';
import { uid } from './types';
import type { Run, Update } from './App';
import { LocaleContext, useText } from './i18n';
import { chat, endpoint, summaryResult, taskResults, transcribe, transcriptionLimit } from './ai';
import { native, Campus, nativeAudioUrl, readAudio, removeAudio, saveData, storeAudio } from './platform';
import { fmt } from './core';
import { Button, Busy, Empty, Field, Header, Modal } from './ui';
import { SuggestionEditor } from './Tasks';
import { TranscriptReader } from './TranscriptReader';
type Job={note:string;segment:Segment};
export function Notes({data,update,providers,run,notify}:{data:Data;update:Update;providers:Providers;run:Run;notify:(s:string)=>void}) {
  const t=useText(),{language}=useContext(LocaleContext);
  const [selected,setSelected]=useState<string|null>(data.notes[0]?.id||null),[title,setTitle]=useState(''),[busy,setBusy]=useState(false),[importing,setImporting]=useState(false),[remove,setRemove]=useState<'all'|'audio'|null>(null),[suggestions,setSuggestions]=useState<Task[]|null>(null),[playing,setPlaying]=useState('');
  const [recording,setRecording]=useState(false),[draft,setDraft]=useState('');
  const latest=useRef(data),alive=useRef(true),queue=useRef<Job[]>([]),working=useRef(false),audioElement=useRef<HTMLAudioElement|null>(null),objectURL=useRef(''),listeners=useRef<{remove:()=>Promise<void>}[]>([]),audioSave=useRef<Promise<void>>(Promise.resolve()),activeId=useRef<string|null>(null),elapsed=useRef(0),[seconds,setSeconds]=useState(0);
  latest.current=data;
  const current=data.notes.find(n=>n.id===selected);
  useEffect(()=>{if(!selected&&data.notes.length)setSelected(data.notes[0].id);},[data.notes.length]);
  function change(fn:(d:Data)=>Data) {latest.current=fn(latest.current);update(fn);}
  function patch(id:string,fn:(n:Note)=>Note) {change(d=>({...d,notes:d.notes.map(n=>n.id===id?fn(n):n)}));}
  useEffect(()=>{if(current)setDraft(current.edited);},[selected]);
  useEffect(()=>{if(!recording)return;const id=setInterval(()=>setSeconds(Math.floor((Date.now()-elapsed.current)/1000)),1000);return()=>clearInterval(id);},[recording]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;audioElement.current?.pause();if(objectURL.current)URL.revokeObjectURL(objectURL.current);if(activeId.current)void Campus.stopRecording();for(const l of listeners.current)void l.remove();};},[]);
  async function processQueue() {
    if(working.current)return;working.current=true;
    try{while(queue.current.length&&alive.current){const job=queue.current.shift()!;
      patch(job.note,n=>({...n,segments:n.segments.map(s=>s.id===job.segment.id?{...s,status:'working',error:undefined}:s)}));
      try {const blob=await readAudio(job.segment.audio,transcriptionLimit(providers.speech));const text=await transcribe(providers.speech,blob);patch(job.note,n=>({...n,segments:n.segments.map(s=>s.id===job.segment.id?{...s,text,status:'done'}:s)}));}
      catch(e){patch(job.note,n=>({...n,segments:n.segments.map(s=>s.id===job.segment.id?{...s,status:'error',error:(e as Error).message}:s)}));}
    }}finally{working.current=false;}
  }
  const enqueue=(note:string,segment:Segment)=>{queue.current.push({note,segment});void processQueue();};
  const create=(recording=false):Note=>({id:uid(),title:title.trim()||t('untitled'),created:new Date().toISOString(),seconds:0,segments:[],edited:'',recording});
  async function begin() {
    if(!native)throw Error('nativeRecord');endpoint(providers.speech,'/audio/transcriptions');
    const note=create(true);change(d=>({...d,notes:[note,...d.notes]}));setSelected(note.id);activeId.current=note.id;
    await saveData(latest.current);
    for(const l of listeners.current)await l.remove();listeners.current=[];
    listeners.current.push(await Campus.addListener('recordingReady',recording=>{
      audioSave.current=audioSave.current.then(async()=>{
        const s:Segment={id:uid(),start:recording.start,end:recording.start+recording.seconds,text:'',status:'queued',audio:recording.audio};
        patch(note.id,n=>({...n,seconds:s.end,segments:n.segments.some(x=>x.audio===s.audio)?n.segments:[...n.segments,s]}));
        await saveData(latest.current);enqueue(note.id,s);
      }).catch(()=>notify(t('storageError')));
    }));
    listeners.current.push(await Campus.addListener('recordingStopped',event=>{
      setRecording(false);activeId.current=null;patch(note.id,n=>({...n,recording:false}));if(event.error)notify(t(event.error==='storageError'?'storageError':'micDenied'));
    }));
    try{await Campus.startRecording({id:note.id});if(activeId.current===note.id){setRecording(true);elapsed.current=Date.now();setSeconds(0);}}
    catch{patch(note.id,n=>({...n,recording:false}));activeId.current=null;throw Error('micDenied');}
  }
  async function stop(){await Campus.stopRecording();await audioSave.current;activeId.current=null;setRecording(false);}
  async function upload(file:File) {
    endpoint(providers.speech,'/audio/transcriptions');
    if(file.size>20*1024*1024)throw Error('fileTooLarge');
    const ext=file.name.split('.').pop()?.toLowerCase()||'';
    if(!['wav','mp3','m4a','webm'].includes(ext))throw Error('unsupported');
    setImporting(true);try{const note=create(),path=await storeAudio(note.id,file,ext);
      const s:Segment={id:uid(),start:0,end:0,text:'',status:'queued',audio:path};note.segments=[s];
      change(d=>({...d,notes:[note,...d.notes]}));await saveData(latest.current);setSelected(note.id);enqueue(note.id,s);
    }finally{setImporting(false);}
  }
  async function summarize() {
    if(!current)return;
    const text=(current.edited||current.segments.filter(s=>s.status==='done').map(s=>`[${fmt(s.start)}] ${s.text}`).join('\n')).trim();
    if(!text)throw Error('noText');setBusy(true);
    const prompt='Summarize this class material. Return {"abstract":"","points":[""],"review":[""],"tasks":[{"title":"","due":"YYYY-MM-DD or empty string"}]}. Do not invent facts or deadlines. Retain timestamps in points when provided. ';
    try{let level:Summary[]=[];
      for(let i=0;i<text.length;i+=14000){const s=summaryResult(await chat(providers.text,language,prompt+text.slice(i,i+14000)));level.push(s);const partials=[...level];patch(current.id,n=>({...n,partials}));}
      while(level.length>1){const next:Summary[]=[];for(let i=0;i<level.length;i+=3)next.push(summaryResult(await chat(providers.text,language,prompt+'Merge and deduplicate these partial summaries: '+JSON.stringify(level.slice(i,i+3)))));level=next;}
      patch(current.id,n=>({...n,summary:level[0]}));
    }finally{setBusy(false);}
  }
  async function listen(s:Segment) {
    if(playing===s.id){audioElement.current?.pause();setPlaying('');return;}
    audioElement.current?.pause();if(objectURL.current)URL.revokeObjectURL(objectURL.current);
    objectURL.current='';
    try{const url=native?await nativeAudioUrl(s.audio):(objectURL.current=URL.createObjectURL(await readAudio(s.audio)));const audio=new Audio(url);audioElement.current=audio;audio.onended=()=>setPlaying('');await audio.play();setPlaying(s.id);}catch{throw Error('audioMissing');}
  }
  async function deleteSelected() {
    if(!current)return;audioElement.current?.pause();setPlaying('');
    for(const s of current.segments)if(s.audio)await removeAudio(s.audio).catch(()=>{});
    if(native)await Campus.clearRecovery({id:current.id});
    if(remove==='all'){change(d=>({...d,notes:d.notes.filter(n=>n.id!==current.id)}));setSelected(null);}
    else patch(current.id,n=>({...n,segments:n.segments.map(s=>({...s,audio:''}))}));setRemove(null);
  }
  const transcript=current?.segments.filter(s=>s.status==='done').map(s=>s.text).join('\n\n')??'';
  const pending=current?.segments.some(s=>s.status==='queued'||s.status==='working');
  return <><Header title={t('notes')} subtitle={t('audioSending')}/><Field label={t('noteTitle')}><input value={title} placeholder={t('untitled')} onChange={e=>setTitle(e.target.value)}/></Field><div className="actions"><Button disabled={importing||busy} onClick={()=>run(recording?stop:begin)}>{recording?<Square size={16}/>:<Mic size={16}/>} {recording?`${t('stopRecord')} ${fmt(seconds)}`:t('record')}</Button><label className={`button secondary ${recording||importing?'disabled':''}`}><Upload size={16}/>{importing?<Busy/>:t('uploadAudio')}<input hidden type="file" disabled={recording||importing} accept=".wav,.mp3,.m4a,.webm" onChange={e=>{const f=e.target.files?.[0];if(f)void run(()=>upload(f));e.target.value='';}}/></label><button className="icon-button" disabled={recording} aria-label={t('add')} onClick={()=>{const n=create();change(d=>({...d,notes:[n,...d.notes]}));setSelected(n.id);}}><Plus size={20}/></button></div><p className="send-hint">{t('sendHint')} {providers.speech.url||t('configNeeded')}</p>{recording&&<p className="warning">{t('foreground')}</p>}
    <div className="note-selector">{data.notes.map(n=><button key={n.id} disabled={recording&&n.id!==selected||busy} className={selected===n.id?'selected':''} onClick={()=>setSelected(n.id)}><FileAudio size={15}/>{n.title}</button>)}</div>
    {current?<><section className="card"><Field label={t('noteTitle')}><input value={current.title} onChange={e=>patch(current.id,n=>({...n,title:e.target.value}))}/></Field><div className="section-heading"><h2>{t('segments')}</h2><span className="pill">{fmt(current.seconds)}</span></div>{pending&&<p className="send-hint">{t('queue')}</p>}{current.segments.map(s=><div className="transcript" key={s.id}><time>{fmt(s.start)}</time><div>{s.status==='done'?(!s.text?<p>{t('silence')}</p>:null):s.status==='error'?<div className="error-text">{t(s.error==='speechTooLarge'?'speechTooLarge':'error')} <Button secondary disabled={!s.audio} onClick={()=>{patch(current.id,n=>({...n,segments:n.segments.map(x=>x.id===s.id?{...x,status:'queued'}:x)}));enqueue(current.id,s);}}><RefreshCw size={13}/>{t('retry')}</Button></div>:<p>{t(s.status==='working'?'working':'queued')}</p>}{s.audio&&<button className="listen" onClick={()=>run(()=>listen(s))}><Volume2 size={14}/>{t('play')}</button>}</div></div>)}{transcript&&<TranscriptReader key={current.id} note={current} text={transcript} providers={providers} patch={fn=>patch(current.id,fn)} run={run}/>}{!current.segments.length&&<Empty>{t('emptyTranscript')}</Empty>}</section><section className="card"><div className="section-heading"><h2>{t('edited')}</h2><Button secondary onClick={()=>{patch(current.id,n=>({...n,edited:draft}));notify(t('saved'));}}>{t('save')}</Button></div><textarea className="editor" aria-label={t('edited')} value={draft} onChange={e=>setDraft(e.target.value)}/></section><section className="summary-panel card"><div className="section-heading"><h2>{t('summary')}</h2></div><p className="send-hint">{t('sendHint')} {providers.text.url||t('configNeeded')}</p><Button secondary disabled={busy||recording||!!pending} onClick={()=>run(summarize)}>{busy?<Busy/>:t('summarize')}</Button>{current.partials?.length&&!current.summary?<p className="footnote">{t('partialSummary')}</p>:null}{current.summary&&<><p>{current.summary.abstract}</p><h3>{t('keyPoints')}</h3><ul>{current.summary.points.map((x,i)=><li key={i}>{x}</li>)}</ul><h3>{t('reviewOutline')}</h3><ul>{current.summary.review.map((x,i)=><li key={i}>{x}</li>)}</ul>{current.summary.tasks.length>0&&<Button secondary onClick={()=>setSuggestions(taskResults(current.summary))}>{t('extractTasks')}</Button>}</>}</section><div className="actions"><Button secondary disabled={recording||!!pending||busy} onClick={()=>setRemove('audio')}>{t('deleteAudio')}</Button><Button secondary disabled={recording||!!pending||busy} onClick={()=>setRemove('all')}><Trash2 size={15}/>{t('delete')}</Button></div></>:<Empty>{t('emptyNotes')}</Empty>}
    {remove&&<Modal title={t(remove==='all'?'deleteNote':'deleteAudioConfirm')} close={()=>setRemove(null)}><div className="actions"><Button secondary onClick={()=>setRemove(null)}>{t('cancel')}</Button><Button onClick={()=>run(deleteSelected)}>{t('delete')}</Button></div></Modal>}
    {suggestions&&<SuggestionEditor tasks={suggestions} set={setSuggestions} close={()=>setSuggestions(null)} save={()=>{change(d=>({...d,tasks:[...suggestions,...d.tasks]}));setSuggestions(null);notify(t('saved'));}}/>}</>;
}
