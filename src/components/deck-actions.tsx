'use client';
import { useEffect, useRef } from 'react';
import { Ellipsis, Download, Pencil, Trash2 } from 'lucide-react';
export default function DeckActions({title,editDisabled,edit,exportPdf,remove}:{title:string;editDisabled:boolean;edit?:()=>void;exportPdf:()=>void;remove:()=>void}){
  const ref=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(ref.current&&!ref.current.contains(event.target as Node))ref.current.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&ref.current?.open){event.preventDefault();ref.current.open=false;ref.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  function run(action:()=>void){if(ref.current)ref.current.open=false;action();}
  return <details ref={ref} className="deck-actions"><summary aria-label={`${title} 메뉴`}><Ellipsis size={21} aria-hidden="true"/></summary><div className="deck-actions-popup" role="group" aria-label={`${title} 작업`}>
    <button type="button" onClick={()=>run(exportPdf)}><Download size={16}/>PDF 내보내기</button>
    {edit&&<button type="button" disabled={editDisabled} onClick={()=>run(edit)}><Pencil size={16}/>카드 수정</button>}
    <button type="button" className="deck-action-danger" onClick={()=>run(remove)}><Trash2 size={16}/>학습 덱 삭제</button>
  </div></details>;
}
