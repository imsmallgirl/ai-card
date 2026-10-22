'use client';

import { useEffect, useRef, useState } from 'react';

// Mounted directly inside the creation popup: only its content is blurred and locked.
export default function AiLoadingOverlay({active,label,phase='generation'}:{active:boolean;label:string;phase?:'generation'|'saving'}) {
  const ref=useRef<HTMLDivElement>(null);
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{
    if(!active)return;
    const started=performance.now();setElapsed(0);
    const timer=window.setInterval(()=>setElapsed(Math.floor((performance.now()-started)/1000)),1000);
    return()=>window.clearInterval(timer);
  },[active,phase]);
  useEffect(()=>{
    const overlay=ref.current;const popup=overlay?.parentElement;
    if(!active||!overlay||!popup)return;
    const previousFocus=document.activeElement;
    const previousOverflow=popup.style.overflow;
    const siblings=Array.from(popup.children).filter((item):item is HTMLElement=>item instanceof HTMLElement&&item!==overlay);
    const previousInert=siblings.map(item=>item.inert);
    siblings.forEach(item=>{item.inert=true;});
    const position=()=>{overlay.style.top=`${popup.scrollTop}px`;overlay.style.height=`${popup.clientHeight}px`;};
    popup.style.overflow='hidden';position();overlay.focus({preventScroll:true});
    const observer=new ResizeObserver(position);observer.observe(popup);
    return ()=>{
      observer.disconnect();popup.style.overflow=previousOverflow;
      siblings.forEach((item,index)=>{item.inert=previousInert[index];});
      if(previousFocus instanceof HTMLElement&&previousFocus.isConnected)previousFocus.focus({preventScroll:true});
    };
  },[active]);
  if(!active)return null;
  return <div ref={ref} className="ai-loading-overlay" aria-label={label} aria-busy="true" tabIndex={0}
    onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Tab'||event.key==='Escape')event.preventDefault();}}>
    <div className="ai-loading-content">
      <strong role="status" aria-live="polite">{label}</strong>
      <div className="ai-progress-track" role="progressbar" aria-label={phase==='saving'?'카드 저장 진행 중':'AI 응답 대기 중'}><span/></div>
      <p className="ai-elapsed" aria-live="off">경과 시간 {Math.floor(elapsed/60)>0?`${Math.floor(elapsed/60)}분 `:''}{elapsed%60}초</p>
      <p>{phase==='saving'?'서버에서 저장 결과를 확인하고 있어요.':elapsed>=30?'30초 이상 처리 중이에요. 요청 결과를 기다리고 있습니다.':'자료의 길이와 카드 수에 따라 처리 시간이 달라져요.'}</p>
      <small>정확한 진행률과 남은 시간은 제공되지 않아요. {phase==='saving'?'같은 저장 요청으로 결과를 확인합니다.':'완료되면 검토할 카드를 보여드려요.'}</small>
    </div>
  </div>;
}
