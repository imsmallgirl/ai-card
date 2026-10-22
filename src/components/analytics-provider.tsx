'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { createAnalyticsClient, createAnalyticsTransport, type AnalyticsClientState } from '@/lib/analytics-client';
import { analyticsStorageKey } from '@/lib/analytics-model';
import ConsentSettings from '@/components/consent-settings';

type Client = ReturnType<typeof createAnalyticsClient>;
const AnalyticsContext = createContext<{ track: Client['track'] }>({ track: async () => {} });
const initial: AnalyticsClientState = { ready: false, granted: false, busy: false, error: '', serverEnabled: false };
export default function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth(); const [state, setState] = useState(initial); const [stateUid, setStateUid] = useState('');
  const client = useRef<Client | null>(null);
  useEffect(() => {
    setState(initial); setStateUid(user?.uid || '');
    if (!user) return;
    const abort = new AbortController();
    let storage: Storage;
    try { storage = localStorage; } catch { setState({ ...initial, ready: true, error: '브라우저 저장소를 사용할 수 없어 선택적 분석을 중단했습니다.' }); return () => abort.abort(); }
    const controller = createAnalyticsClient({ uid: user.uid, enabled: process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true',
      storage, transport: createAnalyticsTransport(refresh => user.getIdToken(refresh), abort.signal), notify: setState });
    client.current = controller;
    void controller.reload().then(() => controller.track('visit'));
    const storageChanged = (event: StorageEvent) => {
      if (event.key === analyticsStorageKey(user.uid) || event.key === null) { controller.pause(); void controller.reload(); }
    };
    const online = () => { void controller.reload().then(() => controller.flush()); };
    const timer = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true' ? window.setInterval(() => { if (document.visibilityState === 'visible') online(); }, 60000) : undefined;
    window.addEventListener('storage', storageChanged); window.addEventListener('online', online);
    return () => { if (timer !== undefined) window.clearInterval(timer); controller.stop(); abort.abort(); client.current = null; window.removeEventListener('storage', storageChanged); window.removeEventListener('online', online); };
  }, [user]);
  // Auth can change before effects clean up. Never expose old user's consent or event client.
  const current = user && stateUid === user.uid ? state : initial;
  return <AnalyticsContext.Provider value={{ track: async (action, count) => { if (user?.uid === stateUid) await client.current?.track(action, count); } }}>
    {children}{process.env.NEXT_PUBLIC_GA4_ENABLED!=='true'&&<ConsentSettings loggedIn={Boolean(user)} state={current}
      configured={process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === 'true'}
      onChoose={granted => { const currentClient = client.current; if (user?.uid === stateUid && currentClient) void currentClient.choose(granted).then(() => currentClient.track('visit')); }}
      onRetry={() => { void client.current?.reload(); }}/ >}
  </AnalyticsContext.Provider>;
}
export function useAnalytics() { return useContext(AnalyticsContext); }
