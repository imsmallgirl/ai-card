'use client';

import { useEffect, useRef } from 'react';

// Mounted directly inside the creation popup: only its content is blurred and locked.
export default function AiLoadingOverlay({active,label}:{active:boolean;label:string}) {
  const ref=useRef<HTMLDivElement>(null);
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
  return <div ref={ref} className="ai-loading-overlay" role="status" aria-live="polite" aria-label={label} aria-busy="true" tabIndex={0}
    onClick={event=>event.stopPropagation()} onKeyDown={event=>{event.stopPropagation();if(event.key==='Tab'||event.key==='Escape')event.preventDefault();}}>
    <div className="ai-loading-content"><span className="ai-loading-spinner" aria-hidden="true"/>
      <strong>{label}</strong><p>잠시만 기다려 주세요.</p>
    </div>
  </div>;
}
