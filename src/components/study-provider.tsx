'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import { createStudyStore, type StudyState } from '@/lib/store';
import { hasLocalStudyRecords, prepareStudyStorage } from '@/lib/study-storage';
import { createCloudStudyStore } from '@/lib/study-cloud-store';
import { combineStudyStores } from '@/lib/study-combined-store';
import { createCloudTransport } from '@/lib/study-cloud-client';
import { useAuth } from '@/components/auth-provider';
import LegacyMigration from './legacy-migration';
import { migrationKey } from '@/lib/legacy-import';
import type { CloudTransport } from '@/lib/study-cloud-client';
import { Sparkles } from 'lucide-react';

const StudyContext = createContext<StoreApi<StudyState> | null>(null);
export function StudyProvider({ uid, children }: { uid: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const [store, setStore] = useState<StoreApi<StudyState> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [migration,setMigration]=useState<{source:()=>StudyState;transport:CloudTransport;complete:()=>Promise<void>}|null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let release: (() => void) | undefined;
    let cleanup: (() => void) | undefined;
    setStore(null); setMigration(null); setError(''); setNotice('');
    if (!user || user.uid !== uid) return;
    const currentUser = user;
    async function start() {
      try {
        prepareStudyStorage(localStorage, uid);
        const hasLegacyData = hasLocalStudyRecords(localStorage, uid)&&localStorage.getItem(migrationKey(uid))!=='true';
        const enabled = process.env.NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED === 'true';
        if (!enabled) {
          setStore(createStudyStore(uid));
          return;
        }
        if (!navigator.locks) throw new Error('안전한 클라우드 저장을 위해 Web Locks를 지원하는 최신 브라우저가 필요합니다.');
        setNotice('학습 저장소를 여는 중입니다. 다른 탭에서 학습 중이라면 해당 탭을 닫아 주세요.');
        // A single writer per browser/UID prevents two tabs from overwriting the durable outbox.
        await navigator.locks.request(`moa-study-cloud-${uid}`, { signal: abort.signal }, async () => {
          if (abort.signal.aborted) return;
          const transport=createCloudTransport(refresh=>currentUser.getIdToken(refresh),abort.signal);
          const session = createCloudStudyStore(uid, localStorage, transport);
          const local=hasLegacyData?createStudyStore(uid):undefined;
          const combined = local ? combineStudyStores(local, session.store) : undefined;
          const refresh = () => {
            if (document.visibilityState === 'visible' && !session.store.getState().sync?.error) void session.sync();
          };
          const timer = window.setInterval(refresh, 30000);
          window.addEventListener('online', refresh);
          document.addEventListener('visibilitychange', refresh);
          cleanup = () => {
            combined?.stop();
            session.stop(); window.clearInterval(timer);
            window.removeEventListener('online', refresh);
            document.removeEventListener('visibilitychange', refresh);
          };
          if(combined)setMigration({source:()=>local!.getState(),transport,complete:async()=>{await session.sync();if(abort.signal.aborted)throw new Error('계정이 변경되었습니다.');if(session.store.getState().sync?.error)throw new Error(session.store.getState().sync?.error);localStorage.setItem(migrationKey(uid),'true');combined.stop();setMigration(null);setStore(session.store);}});
          setNotice(''); setStore(combined?.store || session.store);
          void session.sync();
          await new Promise<void>(resolve => {
            release = resolve;
            if (abort.signal.aborted) resolve();
          });
        });
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '학습 저장소를 열 수 없습니다. 브라우저 저장 권한을 확인해 주세요.');
      }
    }
    void start();
    return () => { abort.abort(); cleanup?.(); release?.(); };
  }, [uid, user, attempt]);

  if (error) return <div className="boot" role="alert">{error}<button className="soft-button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button></div>;
  if (!store) return <div className="boot" role="status"><Sparkles/>{notice || '나의 학습 공간을 준비하고 있어요'}</div>;
  return <StudyContext.Provider value={store}>{migration&&<LegacyMigration uid={uid} {...migration}/ >}{children}</StudyContext.Provider>;
}
export function useStudy() {
  const store = useContext(StudyContext);
  if (!store) throw new Error('StudyProvider가 필요합니다.');
  return useStore(store);
}
