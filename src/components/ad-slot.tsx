import type { ReactNode } from 'react';
import { ADS_CONFIG, type AdPlacement } from '@/lib/ad-slots';
export default function AdSlot({placement,children}:{placement:AdPlacement;children?:ReactNode}){
  if(!ADS_CONFIG.enabled||!children)return null;
  return <aside className="ad-slot" data-placement={placement} aria-label="광고"><small>광고</small>{children}</aside>;
}
