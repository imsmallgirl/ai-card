'use client';
import { useEffect, useRef, useState } from 'react';
import {useDialogAccessibility} from './use-dialog-accessibility';
import AiLoadingOverlay from './ai-loading-overlay';
import { FileText, X } from 'lucide-react';
import { ZodError } from 'zod';
import { parseMaterial, materialCategory } from '@/lib/material-parser';
import { createMaterialDeck, saveMaterialDeck } from '@/lib/material-deck';
import { STUDY_CATEGORIES } from '@/lib/categories';
import { generationInput } from '@/lib/gemini';
import { GenerationClientError, type PendingGeneration } from '@/lib/generation-client';
import { analyzeMaterial, materialAnalysisPending, mergeMaterialAnalysis } from '@/lib/material-analysis';
import type { Deck, StudyState } from '@/lib/store';
import { useAuth } from './auth-provider';
import DeckCreationMode, { type CreationMode } from './deck-creation-mode';
import MaterialCardPreview, {type MaterialPreviewCard} from './material-card-preview';

export default function MaterialDeckDialog({open,close,changeMode,store,color,saved}:{
  open:boolean;close:()=>void;changeMode:(mode:CreationMode)=>void;
  store:Pick<StudyState,'addDeck'|'confirmDeck'>;color:string;saved:(deck:Deck)=>void;
}){
  const {user}=useAuth();
  const [source,setSource]=useState('');const [title,setTitle]=useState('');
  const [category,setCategory]=useState<typeof STUDY_CATEGORIES[number]>('기타');
  const [cards,setCards]=useState<MaterialPreviewCard[]>([]);const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [aiBusy,setAiBusy]=useState(false);
  const [consent,setConsent]=useState(false);const [aiNotice,setAiNotice]=useState('');
  const [aiReadError,setAiReadError]=useState(false);
  const [aiPending,setAiPending]=useState<PendingGeneration|null>(null);const [aiFailed,setAiFailed]=useState(false);
  const [origin,setOrigin]=useState<'rules'|'ai'>('rules');const [parsedSource,setParsedSource]=useState('');
  const attempt=useRef<Deck|null>(null);const lock=useRef(false);const abort=useRef<AbortController|null>(null);
  const aiKey=user?`moa-material-ai-pending-${user.uid}`:'';
  useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!aiKey)return;
    try{const raw=localStorage.getItem(aiKey);if(raw){const value=materialAnalysisPending.parse(JSON.parse(raw));setAiPending(value);setSource(value.input.text);setTitle(value.input.title);setAiNotice('이전 AI 분석 요청이 있습니다. 같은 요청 확인은 AI를 중복 호출하지 않습니다.');}}
    catch{setAiReadError(true);setAiNotice('이전 AI 분석 정보를 읽지 못했습니다. 규칙 기반 추출은 이용할 수 있습니다.');}
  },[aiKey]);
  const dialogRef=useRef<HTMLElement>(null);useDialogAccessibility(dialogRef,open,close,busy||aiBusy);
  if(!open)return null;
  const locked=busy||aiBusy||Boolean(attempt.current);
  function extract(){
    try{const result=parseMaterial(source);setCards(result.cards.map(card=>({...card,included:true})));setCategory(result.classification.category||'기타');setWarnings(result.warnings);setParsedSource(source);setOrigin('rules');setError('');}
    catch(cause){setError(cause instanceof Error?cause.message:'자료를 읽지 못했습니다.');}
  }
  async function analyze(){
    if(lock.current||!consent||aiReadError||!user||!abort.current)return;
    lock.current=true;setAiBusy(true);setError('');setAiFailed(false);
    try{
      let pending=aiPending;
      if(!pending){pending={id:crypto.randomUUID(),input:generationInput.parse({mode:'material',title:title.trim()||'입력 자료 분석',category,text:source,count:20})};localStorage.setItem(aiKey,JSON.stringify(pending));setAiPending(pending);}
      const signal=abort.current.signal;const result=await analyzeMaterial(pending,refresh=>user.getIdToken(refresh),signal);if(signal.aborted)return;
      localStorage.removeItem(aiKey);setAiPending(null);
      const merged=mergeMaterialAnalysis(pending.input.text,result.cards);setCards(merged.cards.map(card=>({...card,included:true})));setCategory(materialCategory(merged.cards));setTitle(result.title||pending.input.title);setParsedSource(pending.input.text);setOrigin('ai');setWarnings(merged.warnings);setAiNotice(`${result.model==='mock-study-v1'?'Mock 테스트 결과 · 실제 AI 분석 아님':'분석 완료'} · ${result.cards.length}장 · 남은 생성 ${result.usage?.remaining??'확인 필요'}회`);
    }catch(cause){if(abort.current?.signal.aborted)return;setAiFailed(cause instanceof GenerationClientError&&cause.terminal);setError(cause instanceof Error?cause.message:'AI 분석에 실패했습니다. 기존 미리보기와 규칙 추출은 유지됩니다.');}
    finally{lock.current=false;setAiBusy(false);}
  }
  return <div className="overlay" onClick={()=>!busy&&!aiBusy&&close()}><section ref={dialogRef} className="modal material-deck-modal" role="dialog" aria-modal="true" aria-labelledby="material-title" onClick={event=>event.stopPropagation()}>
    <button className="close" aria-label="닫기" disabled={busy||aiBusy} onClick={close}><X size={21}/></button>
    <span className="modal-icon"><FileText/></span><h2 id="material-title">내 자료를 학습 카드로</h2><p>질문과 답변을 그대로 살리고, 해설은 따로 모아요.</p>
    <DeckCreationMode value="material" change={changeMode} disabled={busy||aiBusy}/>
    <label>원본 자료<textarea autoFocus maxLength={60000} rows={9} disabled={locked} value={source} onChange={event=>setSource(event.target.value)} placeholder={'1. React의 특징은?\n답변: 컴포넌트 기반으로 UI를 구성합니다.\n-> 재사용성과 선언적 UI가 학습 포인트입니다.\n\nQ: 상태란 무엇인가요?\nA: 컴포넌트가 기억하는 데이터입니다.'}/></label>
    <small>번호·Markdown 제목·Q/A·답변/정답·→ 또는 -&gt; 해설을 지원합니다. 기본 추출은 이 브라우저에서만 실행하며 AI API를 호출하지 않습니다.</small>
    <button className="soft-button material-extract" type="button" disabled={locked||!source.trim()} onClick={extract}>AI 없이 자료에서 카드 추출</button>
    <details className="material-ai"><summary>AI로 카드 추출하기</summary><p>자료를 AI가 읽고 학습 카드로 정리합니다. 덱 이름·질문·답변·해설과 카테고리·태그·난이도를 함께 추출합니다. 정답이 없는 객관식은 AI가 풀이하며 근거를 해설에 표시합니다. 기존 미리보기와 수정·제외한 내용은 AI 결과로 모두 교체됩니다. 선택 시 자료가 Google Gemini로 전송되며 AI 생성 1회 및 API 비용이 발생할 수 있습니다. 최대 15,000자·20장까지 지원합니다. 저장 전 원본과 비교해 주세요. 이전 요청 확인은 당시 자료를 사용하며, 실패해도 기존 미리보기는 유지됩니다.</p>
      <label className="material-consent"><input type="checkbox" checked={consent} disabled={locked} onChange={event=>setConsent(event.target.checked)}/>자료 전송과 AI 사용량 차감을 확인했습니다.</label>
      {aiNotice&&<p role="status">{aiNotice}</p>}
      <button className="soft-button" type="button" disabled={locked||aiReadError||!consent||(!aiPending&&(!source.trim()||source.length>15000))||aiFailed} onClick={()=>void analyze()}>{aiBusy?'AI로 카드 추출 중…':aiPending?'이전 카드 추출 요청 확인':'AI로 카드 추출하기'}</button>
      {(aiPending||aiReadError)&&<button className="soft-button" disabled={locked} type="button" onClick={()=>{try{localStorage.removeItem(aiKey);setAiPending(null);setAiReadError(false);setAiFailed(false);setAiNotice('새 분석은 새 요청으로 처리됩니다. 이전 사용량은 환불되지 않습니다.');}catch{setError('이전 요청을 해제하지 못했습니다. 원본은 보존됩니다.');}}}>이전 요청 연결 해제</button>}
    </details>
    <form onSubmit={async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
      const selected=cards.filter(card=>card.included).map(({included,...card})=>({...card,tags:card.tags?.map(tag=>tag.trim()).filter(Boolean)}));
      const deck=attempt.current||createMaterialDeck({title,category,cards:selected},color);attempt.current=deck;
      await saveMaterialDeck(deck,store);attempt.current=null;setSource('');setTitle('');setCards([]);setWarnings([]);setParsedSource('');saved(deck);
    }catch(cause){setError(cause instanceof ZodError?`입력 내용을 확인해 주세요: ${cause.issues[0].path.join('.')} · ${cause.issues[0].message}`:cause instanceof Error?cause.message:'저장하지 못했습니다.');}finally{lock.current=false;setBusy(false);}}}>
      <fieldset className="generation-fields" disabled={locked}><label>학습 덱 이름<input required maxLength={80} value={title} onChange={event=>setTitle(event.target.value)} placeholder="예: 프론트엔드 면접 자료"/></label><label>덱 카테고리 · 자동 추정 후 수정 가능<select value={category} onChange={event=>setCategory(event.target.value as typeof category)}>{STUDY_CATEGORIES.map(item=><option key={item}>{item}</option>)}</select></label></fieldset>
      {warnings.length>0&&<ul className="material-warnings" aria-label="추출 확인 사항">{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
      {cards.length>0&&<><p className="material-origin">{origin==='rules'?'규칙 기반 추출 · AI 미사용':'사용자가 선택한 AI 분석 결과'}</p><MaterialCardPreview cards={cards} change={setCards} locked={locked}/></>}
      {parsedSource&&parsedSource!==source&&<p className="material-warning">원본 입력이 바뀌었습니다. 현재 미리보기는 이전 자료 기준입니다. 다시 추출하거나 미리보기를 직접 확인해 주세요.</p>}
      {error&&<p className="error" role="alert">{error}</p>}{attempt.current&&!busy&&<p role="status">저장 요청이 보존되었습니다. 같은 덱으로 재시도하며 중복 생성하지 않습니다.</p>}
      <button className="primary generate" type="submit" disabled={busy||aiBusy||!cards.some(card=>card.included)}>{busy?'저장 중…':attempt.current?'같은 덱 저장 다시 확인':'선택한 카드 확인하고 저장'}</button>
    </form>
  <AiLoadingOverlay active={aiBusy} label="AI로 카드를 추출하고 있어요"/></section></div>;
}
