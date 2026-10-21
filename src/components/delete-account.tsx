'use client';
import { useState } from 'react';
import { GoogleAuthProvider, reauthenticateWithPopup, signOut } from 'firebase/auth';
import { useAuth } from './auth-provider';
import { getFirebaseAuth } from '@/lib/firebase';
import { clearAccountStorage } from '@/lib/account-storage';

export default function DeleteAccount({blocked}:{blocked:boolean}) {
  const {user}=useAuth();const [open,setOpen]=useState(false);const [confirmation,setConfirmation]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <section className="account-deletion"><h3>계정 삭제</h3><p>Google 로그인 연결과 서버의 학습 카드·학습 기록을 삭제합니다. 이 브라우저의 해당 계정 캐시·백업도 제거합니다. 다른 기기의 로컬 자료는 해당 기기에서 직접 삭제해야 합니다.</p>
    {!open?<button type="button" className="text-button danger-button" onClick={()=>setOpen(true)}>계정 삭제하기</button>:<div>
      <label>되돌릴 수 없습니다. 계속하려면 ‘삭제’를 입력하세요.<input value={confirmation} disabled={busy} onChange={event=>setConfirmation(event.target.value)} autoComplete="off"/></label>
      <p>삭제 전에 Google 계정을 다시 확인합니다. 전송 대기 중인 변경이 있으면 먼저 동기화해 주세요.</p>
      <button type="button" className="danger-button" disabled={busy||blocked||confirmation!=='삭제'||!user} onClick={async()=>{
        if(!user||busy)return;setBusy(true);setError('');
        try{
          await reauthenticateWithPopup(user,new GoogleAuthProvider());
          const token=await user.getIdToken(true);
          const response=await fetch('/api/account',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({confirmation:'DELETE_MY_ACCOUNT'}),cache:'no-store',signal:AbortSignal.timeout(65000)});
          const body=await response.json();if(!response.ok||body.deleted!==true)throw new Error(body.error||'삭제를 확인하지 못했습니다. 다시 시도해 주세요.');
          await signOut(getFirebaseAuth());clearAccountStorage(localStorage,user.uid);window.location.assign('/');
        }catch(cause){setError(cause instanceof Error&&cause.message&&!cause.message.startsWith('Firebase:')?cause.message:'삭제를 완료하지 못했습니다. Google 인증 및 연결 상태를 확인하고 다시 시도해 주세요.');setBusy(false);}
      }}>{busy?'계정을 삭제하는 중…':'Google 재인증 후 계정 영구 삭제'}</button>
      <button type="button" disabled={busy} onClick={()=>{setOpen(false);setConfirmation('');setError('');}}>취소</button>
      {blocked&&<p role="status">진행 중이거나 전송 대기 중인 저장을 먼저 완료해 주세요.</p>}
    </div>}
    {error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
