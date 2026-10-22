'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createWebAnalytics, type WebAnalyticsState } from '@/lib/web-analytics-client';
import { createWebTag } from '@/lib/web-analytics-tag';
import { WEB_CONSENT_KEY, webAnalyticsConfig, type WebEvent } from '@/lib/web-analytics-model';
import ConsentSettings from './consent-settings';

const config = webAnalyticsConfig({ NEXT_PUBLIC_GA4_ENABLED: process.env.NEXT_PUBLIC_GA4_ENABLED,
  NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED: process.env.NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED,
  NEXT_PUBLIC_GA4_MEASUREMENT_ID: process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID,
  NEXT_PUBLIC_SITE_ORIGIN: process.env.NEXT_PUBLIC_SITE_ORIGIN });
const Context = createContext<{ track: (event: WebEvent, key: string) => void; granted: boolean }>({ track: () => {}, granted: false });
export default function WebAnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const client = useRef<ReturnType<typeof createWebAnalytics> | null>(null);
  const [state, setState] = useState<WebAnalyticsState>({ ready: false, granted: false, busy: false, error: '', serverEnabled: config.enabled });
  const route = useRef({ pathname, sequence: 0 });
  if (route.current.pathname !== pathname) route.current = { pathname, sequence: route.current.sequence + 1 };
  const page = useCallback(() => {
    const current = route.current;
    return client.current?.page(current.pathname, `page:${performance.timeOrigin}:${current.sequence}`);
  }, []);
  useEffect(() => {
    let controller: ReturnType<typeof createWebAnalytics>;
    try {
      if (config.enabled && !navigator.locks) throw new Error();
      controller = createWebAnalytics({ ...config, storage: localStorage,
        exclusive: run => navigator.locks ? navigator.locks.request('moa-web-analytics', run) : Promise.resolve(run()),
        context: () => ({ href: location.href, pathname: location.pathname, referrer: document.referrer }),
        tag: createWebTag(config.measurementId), notify: setState });
    } catch { setState(s => ({ ...s, ready: true, error: '브라우저 저장소를 사용할 수 없어 분석을 중단했습니다.' })); return; }
    client.current = controller;
    void controller.reload().then(page);
    const changed = (event: StorageEvent) => { if (event.key === WEB_CONSENT_KEY || event.key === null) { controller.pause(); void controller.reload().then(page); } };
    const visible = () => { if (document.visibilityState === 'visible') void controller.reload().then(page); };
    window.addEventListener('storage', changed); document.addEventListener('visibilitychange', visible);
    return () => { controller.stop(); client.current = null; window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', visible); };
  }, [page]);
  useEffect(() => { void page(); }, [pathname, page]);
  const track = useCallback((event: WebEvent, key: string) => { void client.current?.track(event, key); }, []);
  return <Context.Provider value={{ track, granted: state.granted }}>{children}
    {process.env.NEXT_PUBLIC_GA4_ENABLED === 'true'&&<ConsentSettings loggedIn={false} browserScope state={state} configured={config.enabled}
      onChoose={value => { void client.current?.choose(value).then(page); }} onRetry={() => { void client.current?.reload().then(page); }}/ >}
  </Context.Provider>;
}
export function useWebAnalytics() { return useContext(Context); }
