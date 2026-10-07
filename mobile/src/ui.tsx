import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { X, LoaderCircle } from 'lucide-react';
import { useText } from './i18n';
export function Button({children,onClick,disabled=false,secondary=false,type='button'}:{children:ReactNode;onClick?:()=>void;disabled?:boolean;secondary?:boolean;type?:'button'|'submit'}) { return <button type={type} disabled={disabled} className={secondary?'button secondary':'button'} onClick={onClick}>{children}</button>; }
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="field"><span>{label}</span>{children}</label>;}
export function Modal({title,children,close}:{title:string;children:ReactNode;close:()=>void}) {
  const t=useText(),ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
  return <dialog ref={ref} onCancel={e=>{e.preventDefault();close();}} className="sheet"><header><h2>{title}</h2><button className="icon-button" aria-label={t('close')} onClick={close}><X/></button></header>{children}</dialog>;
}
export function Empty({children}:{children:ReactNode}) {return <div className="empty"><span>✦</span><p>{children}</p></div>;}
export function Busy(){const t=useText();return <span className="busy"><LoaderCircle className="spin" size={16}/>{t('working')}</span>;}
export function Tree({growth=1}:{growth?:number}) {return <svg className="tree" viewBox="0 0 80 92" aria-hidden="true" shapeRendering="crispEdges"><path d="M8 80h64v8H8z" fill="#709250"/><path d="M35 48h10v32H35z" fill="#936a47"/>{growth>.6?<><path d="M24 8h32v8h8v8h8v32h-8v8H16v-8H8V32h8V16h8z" fill="#4c8056"/><path d="M24 16h24v8h8v24H16V32h8z" fill="#85b168"/><path d="M48 32h8v8h-8zM24 40h8v8h-8z" fill="#b4ce7f"/></>:growth>.2?<><path d="M11 37h24v8h10v12H21V49H11zM45 23h24v18H57v12H45z" fill="#74a864"/></>:<path d="M26 52h12v10h10V47h14v14H48v9H36V62H26z" fill="#88b76b"/>}</svg>;}
export function Header({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}){return <div className="page-title"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div>{children}</div>;}
