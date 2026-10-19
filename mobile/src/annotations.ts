import type { Annotation } from './types';

export type TextAnchor = {start:number;end:number;quote:string};
export function resolveAnchor(text:string,anchor:TextAnchor):TextAnchor|null {
  if(!anchor.quote)return null;
  if(text.slice(anchor.start,anchor.end)===anchor.quote)return anchor;
  // A retry can change preceding text. Relocate only an unambiguous quotation.
  const start=text.indexOf(anchor.quote);
  if(start<0||text.indexOf(anchor.quote,start+1)!==-1)return null;
  return {start,end:start+anchor.quote.length,quote:anchor.quote};
}
export function annotatedParts(text:string,annotations:Annotation[]) {
  const ranges=annotations.flatMap(annotation=>{
    const anchor=resolveAnchor(text,annotation);
    return anchor?[{...anchor,annotation}]:[];
  });
  const edges=[...new Set([0,text.length,...ranges.flatMap(r=>[r.start,r.end])])].sort((a,b)=>a-b);
  return edges.slice(0,-1).map((start,i)=>({start,text:text.slice(start,edges[i+1]),annotations:ranges.filter(r=>r.start<=start&&r.end>=edges[i+1]).map(r=>r.annotation)}));
}
