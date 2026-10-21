'use client';
import { useRef, useState } from 'react';
import { importLegacyState, migrationKey } from '@/lib/legacy-import';
import type { StudyState } from '@/lib/store';
import type { CloudTransport } from '@/lib/study-cloud-client';
export default function LegacyMigration({uid,source,transport,complete}:{uid:string;source:()=>Pick<StudyState,'decks'|'reviews'>;transport:CloudTransport;complete:()=>Promise<void>}){
  const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const lock=useRef(false);
  return <><aside className="migration-panel" aria-label="기존 데이터 이전"><strong>이 기기의 기존 학습 데이터</strong><p>원본을 남겨 둔 채 이 계정의 클라우드로 이전할 수 있어요. 질문·답·복습 일정·날짜별 기록을 보존합니다. 다른 기기에서도 이어서 공부할 수 있어요.</p><button className="soft-button" disabled={busy} onClick={async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setMessage('이전 자료를 확인하고 있습니다.');
    try{const diskBefore=localStorage.getItem(`moa-study-user-${uid}`);const current=source();const snapshot=structuredClone({decks:current.decks,reviews:current.reviews});if(!localStorage.getItem(`moa-study-import-backup-${uid}`))localStorage.setItem(`moa-study-import-backup-${uid}`,JSON.stringify(snapshot));await importLegacyState(snapshot,transport,(done,total)=>setMessage(`${done} / ${total} 전송 완료`));if(localStorage.getItem(`moa-study-user-${uid}`)!==diskBefore)throw new Error('이전 중 기존 데이터가 변경되었습니다. 원본과 백업은 유지됩니다. 다른 탭의 변경을 확인해 주세요.');await complete();localStorage.setItem(migrationKey(uid),'true');}
    catch(cause){setMessage(cause instanceof Error?cause.message:'이전에 실패했습니다. 원본은 유지됩니다. 다시 시도해 주세요.');}
    finally{lock.current=false;setBusy(false);}
  }}>{busy?'이전 중…':'원본 보존하고 클라우드로 이전'}</button>{message&&<p role="status">{message}</p>}</aside>{busy&&<div className="overlay"><section className="modal" role="status"><h2>기존 학습 데이터를 이전하고 있어요</h2><p>{message}</p><p>다른 탭에서는 기존 데이터를 수정하지 마세요. 실패해도 원본은 지워지지 않으며 다시 시도할 수 있습니다.</p></section></div>}</>;
}
