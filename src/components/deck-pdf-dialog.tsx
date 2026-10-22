'use client';
import { useRef, useState } from 'react';
import { X, Download } from 'lucide-react';
import type { Deck } from '@/lib/store';
import { buildDeckPrint, type PrintFormat } from '@/lib/deck-print';
import { useDialogAccessibility } from './use-dialog-accessibility';
export default function DeckPdfDialog({deck,close}:{deck:Deck;close:()=>void}){
  const [selected,setSelected]=useState(()=>deck.cards.map((_,index)=>index));
  const [format,setFormat]=useState<PrintFormat>('study');const [explanations,setExplanations]=useState(true);
  const [error,setError]=useState('');const [message,setMessage]=useState('');
  const ref=useRef<HTMLElement>(null);useDialogAccessibility(ref,true,close);
  function exportPdf(){
    setError('');setMessage('');
    let html:string;try{html=buildDeckPrint(deck,selected,format,explanations);}catch{setError('내보낼 카드를 선택해 주세요.');return;}
    const popup=window.open('','_blank');
    if(!popup){setError('인쇄 창을 열 수 없어요. 이 사이트의 팝업을 허용한 뒤 다시 시도해 주세요.');return;}
    try{
      popup.document.open();popup.document.write(html);popup.document.close();popup.opener=null;
      void popup.document.fonts.ready.then(()=>{if(!popup.closed){popup.focus();popup.print();}}).catch(()=>setError('인쇄를 시작하지 못했어요. 열린 창에서 브라우저 인쇄 메뉴를 사용해 주세요.'));
      setMessage('인쇄 창의 대상에서 “PDF로 저장”을 선택하세요. 페이지 여백·머리글 설정은 인쇄 미리보기에서 확인할 수 있어요.');
    }catch{popup.close();setError('인쇄 창을 준비하지 못했어요. 다시 시도해 주세요.');}
  }
  return <div className="overlay"><section ref={ref} className="modal pdf-export-modal" role="dialog" aria-modal="true" aria-labelledby="pdf-export-title">
    <button type="button" className="close" aria-label="PDF 내보내기 닫기" onClick={close}><X size={21}/></button>
    <h2 id="pdf-export-title">PDF로 내보내기</h2><p className="pdf-deck-title">{deck.title}</p>
    <label>출력 형식<select value={format} onChange={event=>setFormat(event.target.value as PrintFormat)}><option value="study">학습 자료형 · 질문·정답 함께</option><option value="exam">시험지형 · 질문 먼저, 정답은 뒤에</option></select></label>
    <label className="pdf-check"><input type="checkbox" checked={explanations} onChange={event=>setExplanations(event.target.checked)}/>해설 포함</label>
    <div className="pdf-selection-heading"><h3>내보낼 카드</h3><div><button type="button" className="text-button" onClick={()=>setSelected(deck.cards.map((_,i)=>i))}>전체 선택</button><button type="button" className="text-button" onClick={()=>setSelected([])}>전체 해제</button></div></div>
    <div className="pdf-card-list">{deck.cards.map((card,index)=><label className="pdf-card-option" key={card.id||index}><input type="checkbox" checked={selected.includes(index)} onChange={event=>setSelected(event.target.checked?[...selected,index]:selected.filter(item=>item!==index))}/><span><small>카드 {index+1}</small>{card.question}</span></label>)}</div>
    <p role="status">{selected.length} / {deck.cards.length}장 선택</p>
    <small>현재 화면의 카드를 사용합니다. 자료를 외부로 전송하지 않고 AI 횟수도 사용하지 않아요. 인쇄 창에서 PDF로 저장하거나 종이로 출력할 수 있어요.</small>
    {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    <button type="button" className="primary generate" disabled={!selected.length} onClick={exportPdf}><Download size={17}/>PDF 저장 / 인쇄</button>
  </section></div>;
}
