'use client';

import { useEffect, useState } from 'react';

export default function DailyGoalEditor({goal,timeZone,save}:{goal:number;timeZone:string;save?: (goal:number,zone:string)=>Promise<void>}) {
  const [open,setOpen]=useState(false);const [value,setValue]=useState(String(goal));
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  useEffect(()=>setValue(String(goal)),[goal]);
  return <div className="daily-goal-editor">
    <div className="daily-goal-heading"><span>하루 목표 <strong>{goal}장</strong></span><button type="button" className="text-button" aria-expanded={open} disabled={busy||!save} onClick={()=>{setOpen(value=>!value);setError('');setValue(String(goal));}}>목표 변경</button></div>
    {open&&<form onSubmit={async event=>{
      event.preventDefault();if(busy||!save)return;
      const next=Number(value);if(!Number.isInteger(next)||next<1||next>1000){setError('하루 목표는 1~1,000장 사이의 정수로 입력해 주세요.');return;}
      setBusy(true);setError('');try{await save(next,timeZone);setOpen(false);}catch(cause){setError(cause instanceof Error?cause.message:'목표를 저장하지 못했습니다.');}finally{setBusy(false);}
    }}>
      <label>하루에 몇 장 공부할까요?<input type="number" required min={1} max={1000} step={1} value={value} disabled={busy} onChange={event=>setValue(event.target.value)}/></label>
      <div className="daily-goal-presets">{[10,20,30].map(count=><button type="button" key={count} aria-pressed={Number(value)===count} disabled={busy} onClick={()=>setValue(String(count))}>{count}장</button>)}</div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="daily-goal-actions"><button type="button" disabled={busy} onClick={()=>setOpen(false)}>취소</button><button className="primary" disabled={busy}>{busy?'저장 중…':'목표 저장'}</button></div>
    </form>}
  </div>;
}
