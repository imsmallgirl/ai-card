'use client';
import DeleteAccount from './delete-account';
import { useState } from 'react';
export default function StudySettings({dailyGoal,timeZone,save,blocked=false}:{blocked?:boolean;dailyGoal:number;timeZone:string;save?: (goal:number,zone:string)=>Promise<void>}){
  const [goal,setGoal]=useState(String(dailyGoal));const [zone,setZone]=useState(timeZone);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  return <section className="settings panel"><h2>나만의 학습 설정</h2><form onSubmit={async event=>{event.preventDefault();if(busy||!save)return;setBusy(true);setMessage('');try{await save(Number(goal),zone);setMessage('학습 설정을 저장했습니다. 이전 학습일은 바뀌지 않고 새 기록부터 선택한 타임존을 사용합니다.');}catch(cause){setMessage(cause instanceof Error?cause.message:'설정을 저장하지 못했습니다.');}finally{setBusy(false);}}}>
    <label>하루 목표 카드 수<input type="number" min={1} max={1000} required value={goal} disabled={busy} onChange={event=>setGoal(event.target.value)}/></label>
    <label>학습 타임존<input required maxLength={80} value={zone} disabled={busy} onChange={event=>setZone(event.target.value)} placeholder="Asia/Seoul"/></label><small>IANA 타임존을 입력하세요. 예: Asia/Seoul, Asia/Tokyo, America/New_York</small>
    <button className="primary" disabled={busy||!save}>{busy?'저장 중…':'설정 저장'}</button>{message&&<p role="status">{message}</p>}
    </form><h3>오늘의 달성률 기준</h3><p>오늘 완료한 카드 수를 하루 목표로 나눈 비율이며 최대 100%로 표시합니다. 처음 목표는 하루 20장이며 위에서 직접 변경할 수 있습니다. 다음 카드 또는 학습 마치기를 누르면 한 장이 기록됩니다. 같은 학습 안의 재방문은 중복 집계하지 않고, 새 학습에서 다시 완료한 카드는 학습량에 포함합니다. 하루의 기준은 선택한 타임존입니다.</p><DeleteAccount blocked={blocked}/></section>;
}
