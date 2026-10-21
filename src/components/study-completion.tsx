'use client';
import { goalProgress } from '@/lib/study-goal';

import { Check, ArrowRight, RotateCcw } from 'lucide-react';

export default function StudyCompletion({title,count,today,goal,again,close}:{title:string;count:number;today:number;goal:number;again:()=>void;close:()=>void}) {
  const progress=goalProgress(today,goal);
  return <div className="study-completion">
    <span className="study-completion-badge"><Check size={30} strokeWidth={2.5} aria-hidden="true"/></span>
    <p className="study-completion-label">학습 완료</p><h2 id="review-title">이번 학습을 마쳤어요</h2>
    <p className="study-completion-subtitle">{title}</p>
    <div className="study-completion-stats"><div><span>이번에 학습한 카드</span><strong>{count}<small>장</small></strong></div><div><span>오늘 쌓은 학습</span><strong>{today}<small>장</small></strong></div></div>
    <div className="study-completion-goal"><div><span>오늘 목표 {goal}장</span><strong>{progress}%</strong></div><div className="progress" role="progressbar" aria-label="오늘의 학습 목표 달성률" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{width:`${progress}%`}}/></div><p>{today>=goal?'오늘의 목표를 채웠어요. 수고했어요!':`목표까지 ${goal-today}장 남았어요. 내 속도로 이어가세요.`}</p></div>
    <button className="primary study-completion-primary" onClick={close}>대시보드로 돌아가기<ArrowRight size={17}/></button>
    <button className="study-completion-again" onClick={again}><RotateCcw size={15}/>같은 카드 다시 학습하기</button>
  </div>;
}
