'use client';
import { useWebAnalytics } from './web-analytics-provider';
import { countBucket } from '@/lib/analytics-model';
import { webScreen } from '@/lib/web-analytics-model';
import { goalProgress } from '@/lib/study-goal';
import { useEffect, useRef, useState } from 'react';
import { assertReviewedDeck, regenerationState } from '@/lib/generation-review';
import AiLoadingOverlay from '@/components/ai-loading-overlay';
import GeneratedPreview from '@/components/generated-preview';
import StudyInsights from '@/components/study-insights';
import {useDialogAccessibility} from '@/components/use-dialog-accessibility';
import DailyGoalEditor from '@/components/daily-goal-editor';
import StudyCompletion from '@/components/study-completion';
import StudySettings from '@/components/study-settings';
import AdSlot from '@/components/ad-slot';
import { reviewDate } from '@/lib/study-cloud-model';
import AiUsage from '@/components/ai-usage';
import CardEditor from '@/components/card-editor';
import MaterialDeckDialog from '@/components/material-deck-dialog';
import ManualDeckDialog from '@/components/manual-deck-dialog';
import DeckCreationMode, { type CreationMode } from '@/components/deck-creation-mode';
import { generationUsage, type GenerationUsage } from '@/lib/generation-model';
import { generationInput } from '@/lib/gemini';
import { generationFetch, generationClientResult, GenerationClientError, readPendingGeneration, pendingGenerationKey, type PendingGeneration } from '@/lib/generation-client';
import { useAnalytics } from '@/components/analytics-provider';
import AuthAccount from '@/components/auth-account';
import { ArrowUpRight, ArrowRight, BookOpen, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight, CircleHelp, Flame, FolderOpen, GraduationCap, Layers, LayoutDashboard, Lightbulb, Plus, Search, Settings2, Sparkles, Target, Trash2, X } from 'lucide-react';
import type { Deck } from '@/lib/store';
import { useStudy } from '@/components/study-provider';
import { useAuth } from '@/components/auth-provider';
import AllReviewPanel from '@/components/all-review-panel';
import { usedCategories, deckProgress } from '@/lib/study-presentation';
import { STUDY_CATEGORIES } from '@/lib/categories';
import { collectReviewEntries, createReviewSession, type ReviewSession } from '@/lib/review-session';
const categories = ['전체', ...STUDY_CATEGORIES];
export default function StudyApp(){
 const {decks,reviews,addDeck,removeDeck,updateCard,manageCard,updateSettings,confirmDeck,completeCard,sync,retrySync,discardPending,dailyGoal=20,timeZone}=useStudy();
 const [excludedReviewDeckIds,setExcludedReviewDeckIds]=useState<string[]>([]);
 const [creationSession,setCreationSession]=useState(0);
 const [creationMode,setCreationMode]=useState<CreationMode>('material');
 const [editingDeckId,setEditingDeckId]=useState<string|null>(null);
 const editingDeck=decks.find(deck=>deck.id===editingDeckId);
 const {user}=useAuth(); const analytics=useAnalytics(); const webAnalytics=useWebAnalytics();
 const [purpose,setPurpose]=useState<'개념 암기'|'면접 준비'|'시험 대비'|'심화 이해'>('개념 암기');
 const [difficulty,setDifficulty]=useState<'초급'|'중급'|'고급'>('초급');
 const [questionCount,setQuestionCount]=useState('10');
 const [ready,setReady]=useState(false); const [view,setView]=useState('대시보드'); const [category,setCategory]=useState('전체'); const [search,setSearch]=useState('');
 const screenVisit=useRef({name:'',sequence:0});
 const reviewVisit=useRef('');
 useEffect(()=>{
   const screens:Record<string,string>={'대시보드':'dashboard','내 학습 덱':'decks','전체 복습':'review','학습 통계':'statistics','설정':'settings'};
   const parsed=webScreen.safeParse(screens[view]);if(!parsed.success)return;
   if(screenVisit.current.name!==view)screenVisit.current={name:view,sequence:screenVisit.current.sequence+1};
   webAnalytics.track({name:'screen_view',screen_name:parsed.data},`screen:${performance.timeOrigin}:${screenVisit.current.sequence}`);
 },[view,webAnalytics.granted,webAnalytics.track]);
 function trackReviewStart(next:ReviewSession|null){
   if(!next)return;reviewVisit.current=crypto.randomUUID();
   webAnalytics.track({name:'review_started',count_bucket:countBucket(next.entries.length)},`review-start:${reviewVisit.current}`);
 }
 const [modal,setModal]=useState(false); const [title,setTitle]=useState(''); const [text,setText]=useState(''); const [newCategory,setNewCategory]=useState('기타'); const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [notice,setNotice]=useState('');
 const completionIds=useRef(new Map<string,string>());const completedEntries=useRef(new Set<string>());const completionLock=useRef(false);
 const [completionBusy,setCompletionBusy]=useState(false);const [completionError,setCompletionError]=useState('');
 const [session,setSession]=useState<ReviewSession|null>(null); const [flipped,setFlipped]=useState(false); const [answer,setAnswer]=useState('');
 useEffect(()=>setReady(true),[]);
 const today=ready?(timeZone?reviewDate(Date.now(),timeZone):new Date().toLocaleDateString('sv-SE')):'';
 const reviewCount=(items:typeof reviews)=>items.reduce((sum,item)=>sum+(item.count??1),0);
 const totalReviews=reviewCount(reviews);const correctReviews=reviewCount(reviews.filter(r=>r.correct));
 const todayReviews=reviewCount(reviews.filter(r=>r.date===today));
 const total=decks.reduce((n,d)=>n+d.cards.length,0); const due=decks.reduce((n,d)=>n+d.cards.filter(c=>c.due<=Date.now()).length,0);
 const start=(deck:Deck,quiz=false)=>{
  const dueEntries=collectReviewEntries([deck],!quiz);
  completionIds.current.clear();completedEntries.current.clear();setCompletionError('');const next=createReviewSession([deck],{dueOnly:!quiz&&dueEntries.length>0,quiz,title:deck.title});trackReviewStart(next);setSession(next);setFlipped(false);setAnswer('');
 };
 const syncedDecks=sync?.mode==='cloud'?decks.filter(deck=>deck.storage==='local'||deck.cards.every(card=>card.revision!==undefined)):decks;
 const startAll=(options:{dueOnly:boolean;shuffle:boolean;quiz:boolean;deckIds:string[]})=>{
  completionIds.current.clear();completedEntries.current.clear();setCompletionError('');const next=createReviewSession(syncedDecks,{...options,title:options.dueOnly?'오늘의 선택 덱 복습':'선택한 덱 복습'});trackReviewStart(next);setSession(next);setFlipped(false);setAnswer('');
 };
 async function nextCard(){
   if(!session||completionLock.current||session.position>=session.entries.length)return;
   completionLock.current=true;setCompletionBusy(true);setCompletionError('');
   try{
     const entry=session.entries[session.position];const key=`${entry.deckId}:${entry.card.id||entry.index}`;
     if(!completedEntries.current.has(key)){
       if(!completeCard)throw new Error('학습 완료 저장을 사용할 수 없습니다.');
       let id=completionIds.current.get(key);if(!id){id=crypto.randomUUID();completionIds.current.set(key,id);}
       await completeCard(entry.deckId,entry.index,id,entry.card);completedEntries.current.add(key);
     }
     if(session.position+1===session.entries.length)webAnalytics.track({name:'review_completed',count_bucket:countBucket(session.entries.length)},`review-complete:${reviewVisit.current}`);
     setSession({...session,position:session.position+1});setFlipped(false);setAnswer('');
   }catch(cause){setCompletionError(cause instanceof Error?cause.message:'학습 완료를 저장하지 못했습니다. 다시 시도해 주세요.');}
   finally{completionLock.current=false;setCompletionBusy(false);}
 }
 const [aiProvider,setAiProvider]=useState<'gemini'|'mock'|undefined>(undefined); const [aiModel,setAiModel]=useState('');
 const [usage,setUsage]=useState<GenerationUsage|null>(null); const [usageError,setUsageError]=useState(''); const [pendingReadError,setPendingReadError]=useState(false);
 const [failedGeneration,setFailedGeneration]=useState(false);
 const [pendingGeneration,setPendingGeneration]=useState<PendingGeneration|null>(null);
 const generationPending=useRef<PendingGeneration|null>(null); const generating=useRef(false);
 const generationAbort=useRef<AbortController|null>(null);
 useEffect(()=>{const abort=new AbortController();generationAbort.current=abort;
  try{if(user){const pending=readPendingGeneration(localStorage,user.uid);generationPending.current=pending;setPendingGeneration(pending);if(pending){setPurpose(pending.input.purpose);setDifficulty(pending.input.difficulty);setTitle(pending.input.title);setText(pending.input.text);setNewCategory(pending.input.category);setQuestionCount(String(pending.input.count));setNotice('이전에 요청한 AI 생성이 있습니다. 새 덱 만들기에서 결과를 다시 확인할 수 있어요.');}}}catch{setPendingReadError(true);setUsageError('이전 AI 요청의 저장 데이터를 읽지 못했습니다. 원본은 보존됩니다.');}
  return()=>abort.abort();},[user]);
 async function refreshUsage(){if(!user||!generationAbort.current)return;const signal=generationAbort.current.signal;
  try{const data=await generationFetch(refresh=>user.getIdToken(refresh),'/api/usage',signal);if(!signal.aborted){const parsed=data as {usage:unknown;enabled?:boolean;provider?:string;model?:string};if(parsed.provider==='gemini'||parsed.provider==='mock')setAiProvider(parsed.provider);if(typeof parsed.model==='string')setAiModel(parsed.model);setUsage(generationUsage.parse(parsed.usage));setUsageError(parsed.enabled===false?'AI 생성이 비활성화되어 있거나 서버 연결 설정이 필요합니다.':'');}}
  catch(cause){if(!signal.aborted)setUsageError(cause instanceof Error?cause.message:'사용량을 확인하지 못했습니다.');}}
 useEffect(()=>{if(modal&&creationMode==='ai')void refreshUsage();},[modal,creationMode]);
 function preserveGeneration(pending:PendingGeneration){if(!user)throw new Error('로그인이 필요합니다.');localStorage.setItem(pendingGenerationKey(user.uid),JSON.stringify(pending));generationPending.current=pending;setPendingGeneration(pending);}
 function clearGeneration(){if(!user)return;localStorage.removeItem(pendingGenerationKey(user.uid));generationPending.current=null;setPendingGeneration(null);setFailedGeneration(false);}
 function closeCreation(){
  setNotice('');setUsageError('');
  // Dismiss all creation drafts together; confirmed data and the durable study outbox are untouched.
  try{if(user){localStorage.removeItem(pendingGenerationKey(user.uid));localStorage.removeItem(`moa-material-ai-pending-${user.uid}`);}setPendingReadError(false);}
  catch{setPendingReadError(true);setNotice('입력 화면은 초기화했지만 브라우저의 임시 요청 정보를 지우지 못했습니다. 저장 권한을 확인해 주세요.');}
  generationPending.current=null;setPendingGeneration(null);setFailedGeneration(false);
  setTitle('');setText('');setNewCategory('기타');setQuestionCount('10');setPurpose('개념 암기');setDifficulty('초급');setError('');
  setModal(false);setCreationMode('material');setCreationSession(value=>value+1);
 }
 function prepareNewGeneration(){
  const previous=generationPending.current;if(!previous||previous.result)return;
  try{clearGeneration();if(previous.target)preserveGeneration({id:crypto.randomUUID(),input:previous.input,target:previous.target});setPurpose(previous.input.purpose);setDifficulty(previous.input.difficulty);setTitle(previous.input.title);setText(previous.input.text);setNewCategory(previous.input.category);setQuestionCount(String(previous.input.count));setError('');setNotice(aiProvider==='mock'?'입력 내용을 유지했습니다. Mock 카드 만들기를 누르면 새 요청으로 생성합니다.':'입력 내용을 유지했습니다. 다시 생성하면 새 API 호출과 비용이 발생할 수 있습니다.');}
  catch{setError('이전 요청 연결을 해제하지 못했습니다. 브라우저 저장 권한을 확인해 주세요.');}
 }
 async function generate(e:React.FormEvent){e.preventDefault();if(generating.current||pendingReadError)return;generating.current=true;setLoading(true);setError('');setFailedGeneration(false);
  try{if(!user||!generationAbort.current)throw new Error('로그인이 필요합니다.');const signal=generationAbort.current.signal;
   // Persist the request ID before any provider request; retries/reloads retain the same identity.
   let pending=generationPending.current;const resuming=Boolean(pending);
   if(!pending){pending={id:crypto.randomUUID(),input:generationInput.parse({title,category:newCategory,text,purpose,difficulty,count:Number(questionCount)})};preserveGeneration(pending);}
   let result=pending.result;
   if(!result){let data:unknown;
    if(resuming){try{data=await generationFetch(refresh=>user.getIdToken(refresh),`/api/generation-requests/${pending.id}`,signal);}catch(cause){if(!(cause instanceof GenerationClientError)||cause.status!==404)throw cause;}}
    if(!data)data=await generationFetch(refresh=>user.getIdToken(refresh),'/api/generate',signal,pending);
    result=generationClientResult.parse(data);webAnalytics.track({name:'card_generation_completed',method:'ai',count_bucket:countBucket(result.cards.length)},`generated:${pending.id}`);preserveGeneration({...pending,result});setNotice('AI 결과를 확인하고 저장해 주세요. 아직 덱에 저장되지 않았습니다.');return;}
   if(signal.aborted)return;if(result.usage)setUsage(result.usage);
   // Deterministic deck ID makes save retries safe too (cloud outbox de-duplicates this ID).
   result=generationClientResult.parse(result);
   preserveGeneration({...pending,result,saving:true});
   if(pending.target){
     const target=decks.find(deck=>deck.id===pending.target!.deckId);const current=target?.cards[pending.target.index];
     if(regenerationState(pending.target,current,result.cards[0])==='apply'){if(!updateCard||!current)throw new Error('카드 수정 기능을 사용할 수 없습니다.');await updateCard(target!.id,pending.target.index,result.cards[0].question,result.cards[0].answer,{...current,revision:pending.target.revision},result.cards[0]);}
     webAnalytics.track({name:'cards_saved',method:'ai',count_bucket:'1-5'},`saved-regeneration:${pending.id}`);clearGeneration();setModal(false);setNotice('카드를 재생성하고 저장했습니다. 복습 일정은 초기화되었습니다.');return;
   }
   const deckId=`ai-${pending.id}`;
   assertReviewedDeck(decks.find(deck=>deck.id===deckId),result.cards);
   if(!decks.some(deck=>deck.id===deckId))await addDeck({id:deckId,title:pending.input.title,category:pending.input.category,purpose:pending.input.purpose,difficulty:pending.input.difficulty,color:['purple','green','orange','blue'][decks.length%4],created:Date.now(),cards:result.cards.map(card=>({...card,due:0,interval:0}))});
   await confirmDeck?.(deckId);
   webAnalytics.track({name:'cards_saved',method:'ai',count_bucket:countBucket(result.cards.length)},`saved:${deckId}`);
   if(signal.aborted)return;
   if(sync?.mode!=='cloud')void analytics.track('local_deck_created',result.cards.length);
   clearGeneration();setModal(false);setTitle('');setText('');setSearch('');setCategory('전체');setNotice('');setView('내 학습 덱');
  }catch(cause){if(generationAbort.current?.signal.aborted)return;if(cause instanceof GenerationClientError){if(cause.usage)setUsage(cause.usage);setFailedGeneration(cause.terminal);}setError(cause instanceof Error?cause.message:'같은 요청으로 다시 확인해 주세요.');}
  finally{generating.current=false;setLoading(false);void refreshUsage();}}

 function regenerateCard(deck:Deck,index:number){
   if(generationPending.current){setNotice('보존된 AI 요청을 먼저 저장하거나 해제해 주세요.');setCreationMode('ai');setModal(true);return;}
   const card=deck.cards[index];
   const input=generationInput.parse({title:deck.title,category:deck.category,count:1,purpose:deck.purpose||purpose,difficulty:deck.difficulty||difficulty,text:`다음 질문과 같은 개념을 새로운 표현으로 한 장 작성하세요. 질문: ${card.question} 답: ${card.answer}`});
   preserveGeneration({id:crypto.randomUUID(),input,target:{deckId:deck.id,cardId:card.id,index,revision:card.revision,originalQuestion:card.question,originalAnswer:card.answer}});
   setTitle(input.title);setText(input.text);setQuestionCount('1');setNewCategory(input.category);setEditingDeckId(null);setCreationMode('ai');setError('');setModal(true);
 }
 const onManualSaved=(deck:Deck,source?:'rules'|'ai')=>{const method=source||(deck.id.startsWith('manual-')?'manual':'rules');if(method==='manual')webAnalytics.track({name:'card_generation_completed',method,count_bucket:countBucket(deck.cards.length)},`generated:${deck.id}`);webAnalytics.track({name:'cards_saved',method,count_bucket:countBucket(deck.cards.length)},`saved:${deck.id}`);setModal(false);setSearch('');setCategory('전체');setView('내 학습 덱');setNotice('');if(sync?.mode!=='cloud')void analytics.track('local_deck_created',deck.cards.length);};
 const creationDialogRef=useRef<HTMLElement>(null);const reviewDialogRef=useRef<HTMLElement>(null);
 useDialogAccessibility(creationDialogRef,modal&&creationMode==='ai',closeCreation,loading);
 useDialogAccessibility(reviewDialogRef,Boolean(session),()=>setSession(null),completionBusy);
 const shown=decks.filter(d=>(category==='전체'||d.category===category)&&d.title.toLowerCase().includes(search.trim().toLowerCase()));
 if(!ready)return <div className="boot"><Sparkles/> 모아를 준비하고 있어요</div>;
 return <div className="app"><a className="skip-link" href="#study-main">학습 본문으로 건너뛰기</a><aside className="sidebar"><a className="brand" href="/"><span className="brand-icon"><Layers size={23}/></span>모아<span className="brand-dot">.</span></a><p className="nav-label">WORKSPACE</p><nav aria-label="주요 메뉴">{[{name:'대시보드',icon:LayoutDashboard},{name:'내 학습 덱',icon:FolderOpen},{name:'전체 복습',icon:Layers},{name:'학습 통계',icon:ChartNoAxesCombined}].map(({name,icon:Icon})=><button key={name} aria-current={view===name?'page':undefined} className={view===name?'nav-item active':'nav-item'} onClick={()=>setView(name)}><Icon size={19}/>{name}{name==='전체 복습'&&<span className="nav-count">{due}</span>}</button>)}</nav><div className="sidebar-bottom"><button onClick={()=>setView('설정')}><Settings2 size={18}/>설정 및 도움말</button><AuthAccount variant="sidebar"/></div></aside>
 <div className="main-shell"><header><div className="breadcrumb">내 스페이스 <ChevronRight size={13}/> <span>{view}</span></div><div className="header-right"><span className="local-badge"><i/>{sync?.mode==='cloud'?(sync.error?'동기화 확인 필요':sync.busy?'동기화 중':sync.pending?`전송 대기 ${sync.pending}건`:'클라우드 저장'):'로컬 저장 중'}</span><AuthAccount/></div></header><main id="study-main" tabIndex={-1}><div className="page-heading"><div><div className="eyebrow">YOUR LEARNING, A LITTLE SMARTER</div><h1>{view==='대시보드'?'배움이 기억이 되는 곳':view}<span className="heading-dot">.</span></h1><p>조금씩, 꾸준히. 오늘의 배움을 오래 기억해 보세요.</p></div>{view==='내 학습 덱'&&decks.length>0&&<button className="primary" onClick={()=>{setCreationMode('material');setModal(true);}}><Plus size={18}/>새 학습 덱 만들기</button>}</div>
 {sync?.mode==='cloud'&&(sync.error||sync.pending>0)&&<div className="sync-status" role={sync.error?'alert':'status'}><span>{sync.error|| (sync.pending?`${sync.pending}건이 이 기기에 보존되어 있습니다. 서버 확인 후 저장 완료됩니다.`:'계정별 클라우드 저장 · 다른 기기 변경 사항은 최대 30초 후 또는 새로고침 시 반영됩니다.')}</span><button className="soft-button" disabled={sync.busy} onClick={retrySync}>동기화 다시 확인</button>{discardPending&&<button className="soft-button" disabled={sync.busy} onClick={()=>{if(window.confirm('충돌한 첫 번째 요청만 취소하고 서버 상태를 사용할까요? 이 요청의 변경 내용은 반영되지 않습니다.'))discardPending();}}>충돌 요청 취소</button>}</div>}
 {notice&&<div className="generation-notice" role="status"><Sparkles size={17}/><span>{notice}</span><button aria-label="안내 닫기" onClick={()=>setNotice('')}><X size={16}/></button></div>}
 {view==='설정'?<StudySettings dailyGoal={dailyGoal} timeZone={timeZone||'Asia/Seoul'} save={updateSettings} blocked={Boolean(sync?.busy||sync?.pending)}/>:<>
 {view==='대시보드'&&<section className="dashboard-actions panel" aria-labelledby="today-actions"><div><h2 id="today-actions">오늘도 조금씩, 기억을 쌓아요</h2><p>{due>0?`지금 복습할 카드가 ${due}장 있어요. 새 카드도 포함됩니다.`:total?'예정된 복습을 마쳤어요. 모든 카드를 다시 공부하거나 새 카드를 만들어 보세요.':'자료를 붙여 넣거나 직접 작성해 첫 학습을 시작하세요.'}</p></div><div className="dashboard-action-buttons"><button className="primary" disabled={!syncedDecks.some(deck=>deck.cards.some(card=>card.due<=Date.now()))} onClick={()=>startAll({dueOnly:true,shuffle:true,quiz:false,deckIds:syncedDecks.map(deck=>deck.id)})}>오늘의 복습 시작 <ArrowRight size={17}/></button><button className="soft-button" onClick={()=>{setCreationMode('material');setModal(true);}}><Plus size={17}/>카드 만들기</button>{total>0&&due===0&&<button className="text-button" onClick={()=>setView('전체 복습')}>모든 카드 복습</button>}</div>{due>0&&!syncedDecks.some(deck=>deck.cards.some(card=>card.due<=Date.now()))&&<p role="status">복습할 카드의 저장 확인을 기다리고 있어요. 위 동기화 안내를 확인해 주세요.</p>}</section>}

 <section className="stats"><div className="stat"><span className="stat-icon purple"><Layers size={21}/></span><div><p>전체 학습 카드</p><strong>{total}<small>장</small></strong></div><span className="stat-caption">{decks.length}개의 학습 덱</span></div><div className="stat"><span className="stat-icon orange"><Target size={21}/></span><div><p>오늘 복습할 카드</p><strong>{due}<small>장</small></strong></div><span className="stat-caption accent">미학습 카드 포함 · 예정 시각 도래</span></div><div className="stat"><span className="stat-icon green"><Check size={21}/></span><div><p>오늘 학습량</p><strong>{todayReviews}<small>회</small></strong></div><span className="stat-caption">목표 {dailyGoal}회 · 새 학습의 반복 포함</span></div></section>
 <p className="metric-help">학습 경험은 현재 카드 중 학습 완료·평가 이력이 있는 비율이며 암기 정확도가 아니에요. 복습 대기는 예정 시각이 된 카드 수, 오늘 학습량은 반복을 포함한 완료 횟수예요.</p>
 {view==='대시보드'&&<StudyInsights compact decks={decks} reviews={reviews} timeZone={timeZone||'Asia/Seoul'}/>}
 {view==='대시보드'&&<AdSlot placement="dashboard"/>}
 {view==='내 학습 덱'&&<AdSlot placement="deck-list"/>}

 {view==='전체 복습'?<AllReviewPanel decks={syncedDecks} excludedIds={excludedReviewDeckIds} onExcludedChange={setExcludedReviewDeckIds} onStart={startAll} onCreate={()=>{setCreationMode('material');setModal(true);}}/>:view==='학습 통계'?<StudyInsights decks={decks} reviews={reviews} timeZone={timeZone||'Asia/Seoul'}/ >:<div className="content-grid"><section className="deck-section"><div className="section-heading"><h2>{view==='복습하기'?'오늘의 복습':'내 학습 덱'}<span>{decks.length}</span></h2><button className="text-button" onClick={()=>{setView(view==='내 학습 덱'?'대시보드':'내 학습 덱');setCategory('전체');setSearch('');}}>{view==='내 학습 덱'?'대시보드':'전체 보기'}<ArrowRight size={14}/></button></div><div className="deck-toolbar"><div className="tabs category-tabs" role="group" aria-label="카테고리 필터">{usedCategories(decks,category).map(c=><button className={category===c?'selected':''} key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}>{c}</button>)}</div><div className="search"><Search size={20} aria-hidden="true"/><input type="search" aria-label="학습 덱 검색" placeholder="찾고 싶은 학습 덱 이름을 입력하세요" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="search-clear" aria-label="검색어 지우기" onClick={()=>setSearch('')}><X size={18}/></button>}</div></div><div className="deck-grid">{shown.map(d=>{const {learned,percent}=deckProgress(d);const count=d.cards.filter(c=>c.due<=Date.now()).length;return <article className="deck" key={d.id}><div className="deck-top"><span className={`deck-icon ${d.color}`}>{d.category==='외국어'?<span>Aa</span>:d.category==='과학'?<Lightbulb size={23}/>:d.category==='디자인'?<Layers size={23}/>:<BookOpen size={23}/>}</span><button aria-label={`${d.title} 삭제`} className="delete" onClick={async()=>{if(window.confirm('이 학습 덱을 삭제할까요?')){try{await removeDeck(d.id);}catch(cause){setNotice(cause instanceof Error?cause.message:'삭제하지 못했습니다.');}}}}><Trash2 size={15}/></button></div><span className={`category ${d.color}`}>{d.category}</span><h3>{d.title}</h3>{d.storage==='local'&&<small>기존 로컬 덱 · 이 기기에 저장</small>}<p className="deck-description">{d.cards.length}장의 카드 <span>·</span> {count>0?`${count}장 복습 대기`:'지금 예정된 복습 없음'}</p><div className="progress-label"><span>학습 경험 {learned} / {d.cards.length}장</span><strong>{percent}%</strong></div><div className="progress" role="progressbar" aria-label={`${d.title} 학습 경험 비율`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><i style={{width:`${percent}%`}}/></div><div className="deck-footer">{updateCard&&<button disabled={sync?.mode==='cloud'&&d.storage!=='local'&&d.cards.some(card=>card.revision===undefined)} onClick={()=>setEditingDeckId(d.id)}>카드 수정</button>}<button disabled={sync?.mode==='cloud'&&d.storage!=='local'&&d.cards.some(card=>card.revision===undefined)} onClick={()=>start(d)}>학습 시작 <ArrowRight size={14}/></button><button disabled={sync?.mode==='cloud'&&d.storage!=='local'&&d.cards.some(card=>card.revision===undefined)} onClick={()=>start(d,true)}>퀴즈 풀기</button></div></article>})}{shown.length===0&&<div className={`empty ${decks.length===0?'empty-first':''}`}>
 <span className="empty-icon">{decks.length===0?<Layers size={32}/>:<Search size={30}/>}</span>
 <h3>{decks.length===0?'아직 학습 덱이 없어요':'조건에 맞는 학습 덱이 없어요'}</h3>
 <p>{decks.length===0?'자료에서 AI 없이 추출하거나, AI로 생성하거나, 직접 작성할 수 있어요. 저장 전 내용을 확인해 주세요.':'다른 검색어를 입력하거나 카테고리 필터를 바꿔 보세요.'}</p>
 {decks.length===0?<>{view!=='대시보드'&&<button className="primary" onClick={()=>{setCreationMode('material');setModal(true);}}><Plus size={19}/>새 학습 덱 만들기</button>}<span className="empty-hint">예: 여행 영어 · 한국사 핵심 개념 · JavaScript 기초</span></>:<div className="empty-actions"><button className="soft-button" onClick={()=>{setSearch('');setCategory('전체');}}>검색 및 필터 초기화</button><button className="primary" onClick={()=>{setCreationMode('material');setModal(true);}}><Plus size={18}/>새 덱 만들기</button></div>}
 </div>}</div></section><aside className="right-column"><section className="goal panel"><div className="section-heading"><h3>오늘의 학습 목표</h3><span className="mini-icon"><Target size={18}/></span></div><DailyGoalEditor goal={dailyGoal} timeZone={timeZone||'Asia/Seoul'} save={updateSettings}/><div className="goal-ring" style={{background:`conic-gradient(#7970d8 ${goalProgress(todayReviews,dailyGoal)}%, #eeedf7 0)`}}><div><strong>{goalProgress(todayReviews,dailyGoal)}<span>%</span></strong><small>오늘의 달성률</small></div></div><div className="goal-summary"><span>오늘 학습 완료 횟수</span><strong>{todayReviews}<span> / {dailyGoal}회</span></strong></div><p className="goal-criteria">오늘 학습 완료 횟수 ÷ 하루 목표<br/>같은 카드도 새 학습에서 완료하면 포함돼요.</p><p className="goal-message">{todayReviews>=dailyGoal?'오늘의 목표 달성! 멋진 하루예요 ✨':'차근차근, 나만의 속도로 가요 🌱'}</p></section><section className="tip"><span className="tip-label"><Lightbulb size={16}/> LEARNING TIP</span><h3>잊어버리기 전에, 한 번 더.</h3><p>배운 내용을 떠올리는 연습은 기억을<br/>더 오래 유지하는 데 도움이 돼요.<br/>오늘 배운 카드, 내일 다시 만나세요.</p><div>작은 반복이 만드는 큰 차이 <span>✦</span></div></section></aside></div>}
 </>}<footer><span><span className="footer-logo">모아.</span> 매일의 배움을, 오래도록.</span><span>Made for your curious mind <span className="footer-flower">✳</span></span></footer></main></div>
 {editingDeck&&updateCard&&<CardEditor key={editingDeck.id} deck={editingDeck} manage={manageCard?async action=>{await manageCard(editingDeck.id,action);}:undefined} regenerate={index=>regenerateCard(editingDeck,index)} save={async(index,question,answer,original,metadata)=>{await updateCard(editingDeck.id,index,question,answer,original,metadata);}} close={()=>setEditingDeckId(null)}/>}
 <MaterialDeckDialog key={`material-${creationSession}`} open={modal&&creationMode==='material'} close={closeCreation} changeMode={setCreationMode} store={{addDeck,confirmDeck}} color={['purple','green','orange','blue'][decks.length%4]} saved={onManualSaved}/>
 <ManualDeckDialog key={`manual-${creationSession}`} open={modal&&creationMode==='manual'} close={closeCreation} changeMode={setCreationMode} store={{addDeck,confirmDeck}} color={['purple','green','orange','blue'][decks.length%4]} saved={onManualSaved}/>
 {modal&&creationMode==='ai'&&<div className="overlay" onClick={()=>!loading&&closeCreation()}><section ref={creationDialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title" onClick={e=>e.stopPropagation()}><button className="close" aria-label="닫기" disabled={loading} onClick={closeCreation}><X size={21}/></button><span className="modal-icon"><Sparkles/></span><h2 id="create-title">카테고리로 학습 카드 만들기</h2><p>카테고리와 주제를 정하면 AI가 학습 카드를 만들어요.</p><DeckCreationMode value="ai" change={setCreationMode} disabled={loading}/><AiUsage provider={aiProvider} model={aiModel} usage={usage} error={pendingReadError?'이전 AI 요청 데이터를 읽을 수 없어 새 생성을 잠갔습니다. 원본은 보존되어 있습니다.':usageError} onRetry={()=>void refreshUsage()}/>{pendingGeneration&&<p className="generation-pending">이전 요청이 보존되어 있습니다. 다시 누르면 같은 요청을 확인하며, 성공 결과는 AI를 재호출하지 않습니다.</p>}<form onSubmit={generate}><fieldset className="generation-fields" hidden={Boolean(pendingGeneration?.result)} disabled={loading||pendingReadError||Boolean(pendingGeneration)}><label>학습 덱 이름<input autoFocus required maxLength={80} value={title} onChange={e=>setTitle(e.target.value)} placeholder="예: 고등학교 생물 — 세포 소기관"/></label><label>카테고리<select value={newCategory} onChange={e=>setNewCategory(e.target.value)}>{categories.slice(1).map(c=><option key={c}>{c}</option>)}</select></label><label>학습 목적<select value={purpose} onChange={event=>setPurpose(event.target.value as typeof purpose)}>{['개념 암기','면접 준비','시험 대비','심화 이해'].map(item=><option key={item}>{item}</option>)}</select></label><label>난이도<select value={difficulty} onChange={event=>setDifficulty(event.target.value as typeof difficulty)}>{['초급','중급','고급'].map(item=><option key={item}>{item}</option>)}</select></label><fieldset className="question-count"><legend>질문 수</legend><div className="count-presets">{[5,10,15,20].map(count=><button type="button" key={count} aria-pressed={Number(questionCount)===count} className={Number(questionCount)===count?'selected':''} disabled={loading} onClick={()=>setQuestionCount(String(count))}>{count}개</button>)}</div><label className="count-custom">직접 입력<input type="number" required min={1} max={20} step={1} value={questionCount} onChange={event=>setQuestionCount(event.target.value)} disabled={loading} aria-label="생성할 질문 수"/>개</label><small>1~20개까지 선택할 수 있어요. 참고 자료가 부족하면 더 적게 생성될 수 있습니다.</small></fieldset><label>참고 자료 (선택)<textarea maxLength={15000} rows={4} value={text} onChange={e=>setText(e.target.value)} placeholder="비워 두면 제목과 카테고리로 생성해요. 특정 범위를 공부하려면 노트나 교재 내용을 붙여 넣어 주세요."/></label></fieldset>{pendingGeneration?.result&&<GeneratedPreview cards={pendingGeneration.result.cards} locked={loading||Boolean(pendingGeneration.saving)} change={cards=>{const pending=generationPending.current;if(pending?.result)try{preserveGeneration({...pending,result:{...pending.result,cards}});}catch{setError('검토 내용을 보존하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.');}}}/>}<small>실제 AI 모드에서는 제목·카테고리와 참고 자료가 Google Gemini로 전송됩니다. 개발 Mock 모드에서는 외부 AI로 전송하지 않습니다. 실패 복구를 위해 입력과 결과를 이 브라우저에 임시 보존하며, 저장 성공 또는 요청 해제 시 제거합니다. AI 내용은 확인해 주세요.</small>{error&&<div className="error" role="alert"><p>{error}</p><p>{pendingGeneration?.result?'생성 결과를 유지하고 있어요. 연결 상태를 확인한 뒤 같은 결과로 저장을 다시 시도하세요.':failedGeneration?'입력은 유지됩니다. 아래에서 새 요청을 준비하거나 AI 없이 카드 추출을 이용하세요.':'새 요청을 만들기 전에 같은 요청 확인으로 결과를 확인하세요. 중복 호출을 줄일 수 있어요.'}</p></div>}{failedGeneration&&pendingGeneration&&!pendingGeneration.result&&<div role="status"><p>이전 생성 요청은 실패로 종료되었습니다. 같은 요청을 조회해도 새 덱은 생성되지 않습니다. 입력 내용을 유지하고 새 요청을 준비할 수 있습니다.</p><button type="button" className="soft-button" disabled={loading} onClick={prepareNewGeneration}>{aiProvider==='mock'?'같은 내용으로 새 Mock 요청 준비':'같은 내용으로 새 요청 준비'}</button></div>}<button disabled={loading||pendingReadError||(!pendingGeneration&&usage?.remaining===0)||failedGeneration} className="primary generate" type="submit"><Sparkles size={17}/>{loading?pendingGeneration?.result?'저장하는 중…':'AI가 카드를 만드는 중… 잠시만 기다려 주세요':pendingGeneration?.result?'검토한 카드 저장하기':failedGeneration?'종료된 요청 · 새 요청을 준비해 주세요':pendingGeneration?'같은 요청 확인 / 저장 재시도':usage?.remaining===0?'오늘의 무료 생성을 모두 사용했어요':aiProvider==='mock'?'Mock 카드 만들기':'AI로 학습 카드 만들기'}</button>{pendingGeneration&&<button type="button" className="soft-button" disabled={loading} onClick={()=>{if(window.confirm('보존된 요청 연결을 해제할까요? 서버에서 진행 중인 호출이나 이미 차감된 사용량은 취소되지 않습니다. 저장하지 않은 결과는 이 화면에서 사라집니다.')){try{clearGeneration();setError('');}catch{setError('이전 요청 연결을 해제하지 못했습니다.');}}}}>다른 내용으로 새 요청 준비</button>}</form><AiLoadingOverlay active={loading} phase={pendingGeneration?.result?'saving':'generation'} label={pendingGeneration?.result?'카드를 저장하고 있어요':'AI가 학습 카드를 만들고 있어요'}/></section></div>}
 {session&&<div className="overlay"><section ref={reviewDialogRef} className="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
   <button className="close" aria-label="학습 종료" disabled={completionBusy} onClick={()=>setSession(null)}><X size={21}/></button>
   {session.position>=session.entries.length?<StudyCompletion title={session.title} count={completedEntries.current.size} today={todayReviews} goal={dailyGoal} close={()=>{setSession(null);setView('대시보드');}} again={()=>{trackReviewStart(session);completionIds.current.clear();completedEntries.current.clear();setCompletionError('');setSession({...session,position:0});setFlipped(false);setAnswer('');}}/>:<>
     <h2 id="review-title">{session.title}</h2>
     <div className="review-progress"><span>{session.position+1} / {session.entries.length}</span></div>
     <div className={`flashcard review-reading-card ${flipped?'is-answer':'is-question'}`} role="region" aria-label={flipped?'정답과 해설':'학습 질문'} tabIndex={0}>
       {flipped&&<div className="review-question-context"><span>질문</span><p>{session.entries[session.position].card.question}</p></div>}
       <span className="review-card-label">{flipped?'정답':'질문'}</span><h3>{flipped?session.entries[session.position].card.answer:session.entries[session.position].card.question}</h3>
       {flipped&&session.entries[session.position].card.explanation&&<section className="card-explanation"><strong>해설</strong><p>{session.entries[session.position].card.explanation}</p></section>}
     </div>
     {session.quiz&&!flipped&&<><p id="quiz-answer-help" className="quiz-answer-help">질문을 읽고 답을 떠올린 뒤 입력해 보세요. 정답을 확인하고 직접 비교할 수 있어요.</p><textarea className="quiz-answer" aria-label="내 답안" aria-describedby="quiz-answer-help" value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="기억나는 답을 적어 보세요."/></>}
     {session.quiz&&flipped&&answer&&<p className="self-check">내 답안: {answer}</p>}
     <button className="primary generate" disabled={completionBusy} onClick={()=>setFlipped(value=>!value)}>{flipped?'질문 다시 보기':'정답 확인하기'}</button>
     {completionError&&<p className="error" role="alert">{completionError}</p>}<div className="review-navigation">
       <button className="soft-button" disabled={completionBusy||session.position===0} onClick={()=>{setSession({...session,position:session.position-1});setFlipped(false);setAnswer('');}}>이전 카드</button>
       <button className="soft-button" disabled={completionBusy} onClick={()=>void nextCard()}>{completionBusy?'저장 중…':session.position===session.entries.length-1?'학습 마치기':'다음 카드'}</button>
     </div>
   </>}
 </section></div>}

 </div>;
}
