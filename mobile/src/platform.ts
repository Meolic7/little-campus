import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { emptyProviders, type Data, type LocaleChoice, type Providers } from './types';
import { initialData } from './core';
export const native = Capacitor.isNativePlatform();
interface CampusPlugin {
  getSecrets(): Promise<{value: string}>;
  setSecrets(options: {value:string}): Promise<void>;
  startRecording(options:{id:string}): Promise<void>;
  stopRecording(): Promise<void>;
  getRecovery(): Promise<{id?:string;segments?:{audio:string;start:number;seconds:number}[]}>;
  clearRecovery(options:{id:string}): Promise<void>;
  addListener(event:'audioChunk', fn:(data:{audio:string;seconds:number;start:number})=>void): Promise<PluginListenerHandle>;
  addListener(event:'recordingStopped', fn:(data:{error?:string})=>void): Promise<PluginListenerHandle>;
}
export const Campus = registerPlugin<CampusPlugin>('Campus');
let writes: Promise<unknown> = Promise.resolve();
export function saveData(data:Data) {
  const value=JSON.stringify(data);
  writes=writes.catch(()=>{}).then(()=>Preferences.set({key:'campus.data.v1',value}));
  return writes;
}
export async function loadData():Promise<Data> {
  const {value}=await Preferences.get({key:'campus.data.v1'});
  const d=value?JSON.parse(value) as Data:initialData();
  if(d.version!==1||!Array.isArray(d.tasks)||!Array.isArray(d.courses)||!Array.isArray(d.notes)||!Array.isArray(d.records)||!d.term) throw Error('invalidData');
  const recovered:Data={...d,notes:d.notes.map(n=>({...n,recording:false,segments:n.segments.map(s=>({...s,status:s.status==='working'||s.status==='queued'?'error':s.status}))}))};
  if(native){const journal=await Campus.getRecovery();const note=recovered.notes.find(n=>n.id===journal.id);if(note){for(const s of journal.segments||[]){if(!note.segments.some(x=>x.audio===s.audio))note.segments.push({id:crypto.randomUUID(),start:s.start,end:s.start+s.seconds,text:'',status:'error',audio:s.audio});note.seconds=Math.max(note.seconds,s.start+s.seconds);}}}
  return recovered;
}
export async function loadLocale():Promise<LocaleChoice> {const {value}=await Preferences.get({key:'campus.locale'});return value==='zh'||value==='en'?value:'system';}
export const saveLocale=(value:LocaleChoice)=>Preferences.set({key:'campus.locale',value});
export async function loadProviders():Promise<Providers> {
  if(native){const {value}=await Campus.getSecrets();return value?JSON.parse(value):emptyProviders();}
  const {value}=await Preferences.get({key:'campus.providers.public'});
  return value?JSON.parse(value):emptyProviders();
}
export async function saveProviders(providers:Providers) {
  if(native) await Campus.setSecrets({value:JSON.stringify(providers)});
  else await Preferences.set({key:'campus.providers.public',value:JSON.stringify(Object.fromEntries(Object.entries(providers).map(([k,p])=>[k,{...p,key:''}])))});
}
export async function storeAudio(id:string, data:Blob|string, extension='wav'):Promise<string> {
  const base64=typeof data==='string'?data:await blobBase64(data);
  const path=`audio/${id}.${extension}`;
  await Filesystem.writeFile({path,data:base64,directory:Directory.Data,recursive:true});
  return path;
}
export async function readAudio(path:string):Promise<Blob> {
  const r=await Filesystem.readFile({path,directory:Directory.Data});
  if(r.data instanceof Blob)return r.data;
  const bytes=Uint8Array.from(atob(r.data),c=>c.charCodeAt(0));
  return new Blob([bytes],{type:path.endsWith('.wav')?'audio/wav':path.endsWith('.mp3')?'audio/mpeg':path.endsWith('.m4a')?'audio/mp4':'audio/webm'});
}
export const removeAudio=(path:string)=>Filesystem.deleteFile({path,directory:Directory.Data});
export function blobBase64(blob:Blob):Promise<string> {return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(blob);});}
