'use client';
import { useEffect, useRef, useState } from 'react';
import {useDialogAccessibility} from './use-dialog-accessibility';
import { X } from 'lucide-react';
import type { CardMetadata } from '@/lib/card-content';
import { STUDY_CATEGORIES } from '@/lib/categories';
import type { Card, CardAction, Deck } from '@/lib/store';
export default function CardEditor({ deck, save, manage, regenerate, close }: {
  deck: Deck; save: (index: number, question: string, answer: string, original?:Card,metadata?:CardMetadata) => Promise<void>;
  manage?:(action:CardAction)=>Promise<void>;regenerate?:(index:number)=>void;close: () => void;
}) {
  const [metadata,setMetadata]=useState<CardMetadata>({explanation:deck.cards[0]?.explanation||'',category:deck.cards[0]?.category,tags:deck.cards[0]?.tags,difficulty:deck.cards[0]?.difficulty});
  const [tagsText,setTagsText]=useState((deck.cards[0]?.tags||[]).join(', '));
  function selectMetadata(card?:Card){setMetadata({explanation:card?.explanation||'',category:card?.category,tags:card?.tags,difficulty:card?.difficulty});setTagsText((card?.tags||[]).join(', '));}
  const [index,setIndex]=useState(0);const [adding,setAdding]=useState(false);
  const [question,setQuestion]=useState(deck.cards[0]?.question||'');const [answer,setAnswer]=useState(deck.cards[0]?.answer||'');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [message,setMessage]=useState('');const lock=useRef(false);
  const dialogRef=useRef<HTMLElement>(null);useDialogAccessibility(dialogRef,true,close,busy);
  const original=useRef<Card|undefined>(deck.cards[0]?{...deck.cards[0]}:undefined);
  const currentId=deck.cards[index]?.id??`local-${index}`;
  useEffect(()=>{if(!adding){selectMetadata(deck.cards[index]);original.current=deck.cards[index]?{...deck.cards[index]}:undefined;setQuestion(deck.cards[index]?.question||'');setAnswer(deck.cards[index]?.answer||'');}},[currentId]);
  function select(next:number){selectMetadata(deck.cards[next]);original.current=deck.cards[next]?{...deck.cards[next]}:undefined;setIndex(next);setAdding(false);setQuestion(deck.cards[next]?.question||'');setAnswer(deck.cards[next]?.answer||'');setError('');setMessage('');}
  async function run(task:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await task();setMessage('저장했습니다.');}catch(cause){setError(cause instanceof Error?cause.message:'저장하지 못했습니다.');}finally{lock.current=false;setBusy(false);}}
  return <div className="overlay"><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
    <button className="close" aria-label="수정 닫기" disabled={busy} onClick={close}><X size={21}/></button><h2 id="edit-title">학습 카드 관리</h2><p>{deck.title}</p>
    <form onSubmit={event=>{event.preventDefault();void run(async()=>{if(adding){await manage?.({type:'add',question,answer,metadata});setAdding(false);select(deck.cards.length);}else await save(index,question,answer,original.current,metadata);const previous=original.current||deck.cards[index];original.current={...previous,...metadata,question:question.trim(),answer:answer.trim(),due:0,interval:0,revision:previous?.revision===undefined?undefined:previous.revision+1};});}}>
      <label>카드 선택<select disabled={busy} value={adding?'new':index} onChange={event=>select(Number(event.target.value))}>
        {deck.cards.map((card,i)=><option key={card.id||i} value={i}>{i+1}. {card.question.slice(0,40)}</option>)}{adding&&<option value="new">새 카드</option>}
      </select></label>
      <label>질문<textarea required maxLength={500} value={question} disabled={busy} onChange={event=>setQuestion(event.target.value)}/></label>
      <label>답<textarea required maxLength={2000} value={answer} disabled={busy} onChange={event=>setAnswer(event.target.value)}/></label>
      <label>해설 · 학습 포인트<textarea maxLength={4000} rows={3} disabled={busy} value={metadata.explanation||''} onChange={event=>setMetadata({...metadata,explanation:event.target.value})}/></label>
      <div className="material-classification"><label>카테고리<select disabled={busy} value={metadata.category||''} onChange={event=>setMetadata({...metadata,category:(event.target.value||null) as CardMetadata['category']})}><option value="">덱 분류 사용</option>{STUDY_CATEGORIES.map(item=><option key={item}>{item}</option>)}</select></label><label>난이도<select disabled={busy} value={metadata.difficulty||''} onChange={event=>setMetadata({...metadata,difficulty:(event.target.value||null) as CardMetadata['difficulty']})}><option value="">미지정</option>{['초급','중급','고급'].map(item=><option key={item}>{item}</option>)}</select></label></div>
      <label>주제 태그 · 쉼표로 구분<input disabled={busy} value={tagsText} maxLength={327} onChange={event=>{setTagsText(event.target.value);setMetadata({...metadata,tags:event.target.value.split(',').map(tag=>tag.trim()).filter(Boolean)});}}/></label>
      {!adding&&<small>질문·답·해설을 수정하면 복습 일정이 초기화됩니다. 분류·태그만 변경하면 일정과 과거 기록을 유지합니다.</small>}
      {error&&<p className="error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      <button className="primary generate" disabled={busy} type="submit">{busy?'저장 중…':adding?'새 카드 저장':'수정 저장'}</button>
    </form>
    {manage&&<div className="card-management"><button className="soft-button" disabled={busy} onClick={()=>{setAdding(true);selectMetadata();setQuestion('');setAnswer('');setMessage('');setError('');}}>카드 추가</button>
      {!adding&&<button className="soft-button" disabled={busy||deck.cards.length<=1} onClick={()=>{if(window.confirm('이 카드를 삭제할까요? 기존 학습 기록은 보존됩니다.'))void run(async()=>{await manage({type:'delete',index});select(0);});}}>카드 삭제</button>}
    </div>}
    {!adding&&regenerate&&<button className="soft-button" disabled={busy} onClick={()=>{try{regenerate(index);}catch(cause){setError(cause instanceof Error?cause.message:'재생성을 준비하지 못했습니다.');}}}>이 카드 AI로 다시 만들기 · 생성 1회 사용</button>}
  </section></div>;
}
