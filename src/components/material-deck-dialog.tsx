'use client';
import { useEffect, useRef, useState } from 'react';
import {useDialogAccessibility} from './use-dialog-accessibility';
import AiLoadingOverlay from './ai-loading-overlay';
import { FileText, ImagePlus, X } from 'lucide-react';
import { ZodError } from 'zod';
import { materialCategory } from '@/lib/material-parser';
import { createMaterialDeck, saveMaterialDeck } from '@/lib/material-deck';
import { STUDY_CATEGORIES } from '@/lib/categories';
import { generationInput } from '@/lib/gemini';
import { GenerationClientError, type PendingGeneration } from '@/lib/generation-client';
import { analyzeMaterial, materialAnalysisPending, mergeMaterialAnalysis } from '@/lib/material-analysis';
import type { Deck, StudyState } from '@/lib/store';
import { useAuth } from './auth-provider';
import DeckCreationMode, { type CreationMode } from './deck-creation-mode';
import MaterialCardPreview, {type MaterialPreviewCard} from './material-card-preview';
import { useWebAnalytics } from './web-analytics-provider';
import { countBucket } from '@/lib/analytics-model';
import { prepareMaterialImage } from '@/lib/material-image-client';
import type { MaterialImage } from '@/lib/material-image';

export default function MaterialDeckDialog({open,close,changeMode,store,color,saved}:{
  open:boolean;close:()=>void;changeMode:(mode:CreationMode)=>void;
  store:Pick<StudyState,'addDeck'|'confirmDeck'>;color:string;saved:(deck:Deck,method?:'rules'|'ai')=>void;
}){
  const imageInput=useRef<HTMLInputElement>(null);
  const {user}=useAuth();
  const webAnalytics=useWebAnalytics();
  const [image,setImage]=useState<MaterialImage|null>(null);const [imageBusy,setImageBusy]=useState(false);
  const [source,setSource]=useState('');const [title,setTitle]=useState('');
  const [category,setCategory]=useState<typeof STUDY_CATEGORIES[number]>('기타');
  const [cards,setCards]=useState<MaterialPreviewCard[]>([]);const [warnings,setWarnings]=useState<string[]>([]);
  const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [aiBusy,setAiBusy]=useState(false);
  const [consent,setConsent]=useState(false);const [aiNotice,setAiNotice]=useState('');
  const [aiReadError,setAiReadError]=useState(false);
  const [aiPending,setAiPending]=useState<PendingGeneration|null>(null);const [aiFailed,setAiFailed]=useState(false);
  const [parsedSource,setParsedSource]=useState('');const [parsedImage,setParsedImage]=useState('');
  const attempt=useRef<Deck|null>(null);const lock=useRef(false);const abort=useRef<AbortController|null>(null);
  const aiKey=user?`moa-material-ai-pending-${user.uid}`:'';
  useEffect(()=>{const controller=new AbortController();abort.current=controller;return()=>controller.abort();},[]);
  useEffect(()=>{
    if(!aiKey)return;
    try{const raw=localStorage.getItem(aiKey);if(raw){const value=materialAnalysisPending.parse(JSON.parse(raw));setAiPending(value);setSource(value.input.text);setImage(value.input.image||null);setTitle(value.input.title);setAiNotice('이전 AI 분석 요청이 있습니다. 같은 요청 확인은 AI를 중복 호출하지 않습니다.');}}
    catch{setAiReadError(true);setAiNotice('이전 AI 분석 정보를 읽지 못했습니다. 이전 요청 연결을 해제한 후 새로 분석해 주세요.');}
  },[aiKey]);
  const dialogRef=useRef<HTMLElement>(null);useDialogAccessibility(dialogRef,open,close,busy||aiBusy||imageBusy);
  if(!open)return null;
  const locked=busy||aiBusy||imageBusy||Boolean(attempt.current);
  async function analyze(){
    if(lock.current||!consent||aiReadError||!user||!abort.current)return;
    if(cards.length&&!window.confirm('AI 결과로 현재 미리보기의 수정·선택 내용이 교체됩니다. 계속할까요?'))return;
    lock.current=true;setAiBusy(true);setError('');setAiFailed(false);
    try{
      let pending=aiPending;
      if(!pending){pending={id:crypto.randomUUID(),input:generationInput.parse({mode:'material',title:title.trim()||'입력 자료 분석',category,text:source,...(image?{image}:{}),count:20})};localStorage.setItem(aiKey,JSON.stringify(pending));setAiPending(pending);}
      const signal=abort.current.signal;const result=await analyzeMaterial(pending,refresh=>user.getIdToken(refresh),signal);if(signal.aborted)return;
      webAnalytics.track({name:'card_generation_completed',method:'ai',count_bucket:countBucket(result.cards.length)},`generated:${pending.id}`);
      const merged=mergeMaterialAnalysis(pending.input.text,result.cards);
      localStorage.removeItem(aiKey);setAiPending(null);setCards(merged.cards.map(card=>({...card,included:true})));setCategory(materialCategory(merged.cards));setTitle(result.title||pending.input.title);setParsedSource(pending.input.text);setParsedImage(pending.input.image?.data||'');setWarnings(merged.warnings);setAiNotice(`${result.model==='mock-study-v1'?'Mock 테스트 결과 · 실제 AI 분석 아님':'분석 완료'} · ${result.cards.length}장 · 남은 생성 ${result.usage?.remaining??'확인 필요'}회`);
    }catch(cause){if(abort.current?.signal.aborted)return;setAiFailed(cause instanceof GenerationClientError&&cause.terminal);setError(cause instanceof Error?cause.message:'AI 분석에 실패했습니다. 입력과 기존 미리보기는 유지됩니다.');}
    finally{lock.current=false;setAiBusy(false);}
  }
  return <div className="overlay" onClick={()=>!busy&&!aiBusy&&close()}><section ref={dialogRef} className="modal material-deck-modal" role="dialog" aria-modal="true" aria-labelledby="material-title" onClick={event=>event.stopPropagation()}>
    <button className="close" aria-label="닫기" disabled={busy||aiBusy||imageBusy} onClick={close}><X size={21}/></button>
    <span className="modal-icon"><FileText/></span><h2 id="material-title">내 자료를 학습 카드로</h2><p>질문과 답변을 그대로 살리고, 해설은 따로 모아요.</p>
    <DeckCreationMode value="material" change={changeMode} disabled={busy||aiBusy||imageBusy}/>
    <label>원본 자료<textarea aria-describedby="material-input-count" autoFocus maxLength={15000} rows={9} disabled={locked} value={source} onChange={event=>setSource(event.target.value)} placeholder={'공부하고 싶은 내용을 자유롭게 붙여 넣어 주세요.\n수업 필기, 영어 단어, 시험 요약, 생활 상식 모두 좋아요.\n\n예시\napple: 사과 / library: 도서관\n한글을 창제한 왕은 세종대왕이다.\n손을 씻을 때는 비누로 30초 이상 꼼꼼히 씻는다.'}/></label>

    <p id="material-input-count" className="input-guidance">{source.length.toLocaleString()} / 15,000자</p>
    {source.length>15000&&<p className="material-warning">자료를 15,000자 이하로 나눠 주세요. 기존 입력은 보존됩니다.</p>}

    <div className="material-image-upload"><div className="material-image-heading"><span className="material-image-icon" aria-hidden="true"><ImagePlus size={21}/></span><div><strong>이미지 자료</strong><span>교재나 필기 사진 한 장을 추가해 보세요.</span></div><span className="material-image-optional">선택</span></div>
    <button type="button" className="soft-button material-image-select" disabled={locked||Boolean(aiPending)} onClick={()=>imageInput.current?.click()}><ImagePlus size={17} aria-hidden="true"/>{imageBusy?'이미지 준비 중…':image?'다른 이미지 선택':'이미지 선택하기'}</button>
    <input ref={imageInput} hidden aria-label="학습 자료 이미지 선택" type="file" accept="image/jpeg,image/png,image/webp" disabled={locked||Boolean(aiPending)} onChange={async event=>{
      const file=event.target.files?.[0];event.target.value='';if(!file)return;
      setImageBusy(true);setError('');try{const prepared=await prepareMaterialImage(file);if(!abort.current?.signal.aborted)setImage(prepared);}catch(cause){if(!abort.current?.signal.aborted)setError(cause instanceof Error?cause.message:'이미지를 읽지 못했습니다.');}finally{setImageBusy(false);}
    }}/><small>JPG·PNG·WebP 최대 10MB. 전송 전 긴 변 1,600px·256KB 이하로 줄입니다. 작은 글자는 문제 영역만 잘라 등록하세요.</small>
    {imageBusy&&<p role="status">이미지를 준비하고 있어요.</p>}
    {image&&<><img className="material-image-preview" src={`data:${image.mimeType};base64,${image.data}`} alt="분석에 사용할 학습 자료 이미지"/><button type="button" className="text-button" disabled={locked||Boolean(aiPending)} onClick={()=>setImage(null)}>이미지 제거</button></>}
    <p className="input-guidance">글 또는 이미지를 등록하세요. 분석 요청 시 전송되며 실패 복구를 위해 이 브라우저에 임시 보존됩니다. 저장 성공 후 화면 자료는 지워집니다.</p></div>
    <div className="material-ai"><details><summary>AI 추출 안내</summary><p>자료와 이미지를 AI가 읽고 학습 카드로 정리합니다. 덱 이름·질문·답변·해설과 카테고리·태그·난이도를 함께 추출합니다. 정답이 없는 객관식은 AI가 풀이하며 근거를 해설에 표시합니다. 기존 미리보기와 수정·제외한 내용은 AI 결과로 모두 교체됩니다. 선택 시 자료와 이미지가 Google Gemini로 전송되며 AI 생성 1회 및 API 비용이 발생할 수 있습니다. 최대 15,000자·20장까지 지원합니다. 저장 전 원본과 비교해 주세요. 이전 요청 확인은 당시 자료를 사용하며, 실패해도 기존 미리보기는 유지됩니다.</p></details>
      <label className="material-consent"><input type="checkbox" checked={consent} disabled={locked} onChange={event=>setConsent(event.target.checked)}/>자료·이미지의 Google Gemini 전송과 AI 사용량 차감을 확인했습니다.</label>
      {aiNotice&&<p role="status">{aiNotice}</p>}
      {(aiPending||aiReadError)&&<button className="soft-button" disabled={locked} type="button" onClick={()=>{try{localStorage.removeItem(aiKey);setAiPending(null);setAiReadError(false);setAiFailed(false);setAiNotice('새 분석은 새 요청으로 처리됩니다. 이전 사용량은 환불되지 않습니다.');}catch{setError('이전 요청을 해제하지 못했습니다. 원본은 보존됩니다.');}}}>이전 요청 연결 해제</button>}
    </div>
    <div className="material-extract-actions">
      <button className="soft-button" type="button" disabled={locked||aiReadError||!consent||(!aiPending&&((!source.trim()&&!image)||source.length>15000))||aiFailed} onClick={()=>void analyze()}>{aiBusy?'AI로 카드 추출 중…':aiPending?'이전 카드 추출 요청 확인':'AI로 카드 추출'}</button>
    </div>
    <form onSubmit={async event=>{event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');try{
      const selected=cards.filter(card=>card.included).map(({included,...card})=>({...card,tags:card.tags?.map(tag=>tag.trim()).filter(Boolean)}));
      const deck=attempt.current||createMaterialDeck({title,category,cards:selected},color);attempt.current=deck;
      await saveMaterialDeck(deck,store);attempt.current=null;setSource('');setImage(null);setTitle('');setCards([]);setWarnings([]);setParsedSource('');setParsedImage('');saved(deck,'ai');
    }catch(cause){setError(cause instanceof ZodError?`입력 내용을 확인해 주세요: ${cause.issues[0].path.join('.')} · ${cause.issues[0].message}`:cause instanceof Error?cause.message:'저장하지 못했습니다.');}finally{lock.current=false;setBusy(false);}}}>
      <fieldset className="generation-fields" disabled={locked}><label>학습 덱 이름<input required maxLength={80} value={title} onChange={event=>setTitle(event.target.value)} placeholder="예: 프론트엔드 면접 자료"/></label><label>덱 카테고리 · 자동 추정 후 수정 가능<select value={category} onChange={event=>setCategory(event.target.value as typeof category)}>{STUDY_CATEGORIES.map(item=><option key={item}>{item}</option>)}</select></label></fieldset>
      {warnings.length>0&&<ul className="material-warnings" aria-label="추출 확인 사항">{warnings.map((warning,index)=><li key={index}>{warning}</li>)}</ul>}
      {cards.length>0&&<><p className="material-origin">AI 분석 결과 · 저장 전 확인</p><MaterialCardPreview cards={cards} change={setCards} locked={locked}/></>}
      {cards.length>0&&(parsedSource!==source||parsedImage!==(image?.data||''))&&<p className="material-warning">원본 글 또는 이미지가 바뀌었습니다. 현재 미리보기는 이전 자료 기준입니다. 다시 추출하거나 미리보기를 직접 확인해 주세요.</p>}
      {error&&<div className="error" role="alert"><p>{error}</p><p>{attempt.current?'원본과 미리보기를 유지하고 있어요. 연결 상태를 확인한 뒤 아래에서 같은 덱의 저장을 다시 확인하세요.':'입력한 자료와 이미지는 그대로 있어요. 내용을 확인하고 같은 요청으로 결과를 다시 확인해 주세요.'}</p></div>}{attempt.current&&!busy&&<p role="status">저장 요청이 보존되었습니다. 같은 덱으로 재시도하며 중복 생성하지 않습니다.</p>}
      <button className="primary generate" type="submit" disabled={busy||aiBusy||imageBusy||!cards.some(card=>card.included)}>{busy?'저장 중…':attempt.current?'같은 덱 저장 다시 확인':`선택한 ${cards.filter(card=>card.included).length}장 저장하기`}</button>
    </form>
  <AiLoadingOverlay active={aiBusy||busy} phase={busy?'saving':'generation'} label={busy?'카드를 저장하고 있어요':'AI로 카드를 추출하고 있어요'}/></section></div>;
}
