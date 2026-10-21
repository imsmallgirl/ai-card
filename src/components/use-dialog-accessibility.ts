'use client';
import { useEffect, useRef, type RefObject } from 'react';

export function useDialogAccessibility(ref:RefObject<HTMLElement|null>,open:boolean,close:()=>void,busy=false) {
  const options=useRef({close,busy});options.current={close,busy};
  useEffect(()=>{
    const dialog=ref.current;if(!open||!dialog)return;
    const previous=document.activeElement;
    if(!dialog.contains(previous))dialog.querySelector<HTMLElement>('input,textarea,button,a[href]')?.focus();
    const handle=(event:KeyboardEvent)=>{
      if(event.defaultPrevented)return;
      if(event.key==='Escape'&&!options.current.busy){event.preventDefault();options.current.close();}
      if(event.key!=='Tab')return;
      const elements=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')).filter(item=>!item.closest('[inert]')&&item.getClientRects().length>0);
      const first=elements[0],last=elements.at(-1);
      if(!first){event.preventDefault();return;}
      if(!dialog.contains(document.activeElement)){event.preventDefault();first.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener('keydown',handle);
    return()=>{document.removeEventListener('keydown',handle);if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true});};
  },[open,ref]);
}
