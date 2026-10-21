'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { signOut } from 'firebase/auth';
import { getFirebaseAuth } from '@/lib/firebase';
import { holdStudyLock } from '@/lib/study-lock';
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
const StopStudyContext = createContext<(() => void) | null>(null);
export function StudyProvider({ uid, children }: { uid: string; children: React.ReactNode }) {
  const { user } = useAuth();
  const [store, setStore] = useState<StoreApi<StudyState> | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [migration,setMigration]=useState<{source:()=>StudyState;transport:CloudTransport;complete:()=>Promise<void>}|null>(null);
  const [attempt, setAttempt] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState('');
  const stopSession = useRef<() => void>(() => {});
  useEffect(() => {
    const abort = new AbortController();
    stopSession.current = () => abort.abort();
    setStore(null); setMigration(null); setError(''); setNotice('');
    if (!user || user.uid !== uid) return;
    const currentUser = user;
    async function start() {
      try {
        const enabled = process.env.NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED === 'true';
        if (!enabled) {
          prepareStudyStorage(localStorage, uid);
          setStore(createStudyStore(uid));
          return;
        }
        if (!navigator.locks) throw new Error('안전한 클라우드 저장을 위해 Web Locks를 지원하는 최신 브라우저가 필요합니다.');
        setNotice('학습 저장소를 여는 중입니다. 다른 탭에서 학습 중이라면 해당 탭을 닫아 주세요.');
        // A single writer per browser/UID prevents two tabs from overwriting the durable outbox.
        await holdStudyLock(navigator.locks, uid, abort.signal, () => {
          // Inspect/migrate storage only after this tab owns the writer lock.
          prepareStudyStorage(localStorage, uid);
          const hasLegacyData = hasLocalStudyRecords(localStorage, uid)&&localStorage.getItem(migrationKey(uid))!=='true';
          const transport=createCloudTransport(refresh=>currentUser.getIdToken(refresh),abort.signal);
          const session = createCloudStudyStore(uid, localStorage, transport);
          let dispose = () => session.stop();
          try {
            const local=hasLegacyData?createStudyStore(uid):undefined;
            const combined = local ? combineStudyStores(local, session.store) : undefined;
            const refresh = () => {
              if (document.visibilityState === 'visible' && !session.store.getState().sync?.error) void session.sync();
            };
            const timer = window.setInterval(refresh, 30000);
            window.addEventListener('online', refresh);
            document.addEventListener('visibilitychange', refresh);
            const cleanup = () => {
              combined?.stop();
              session.stop(); window.clearInterval(timer);
              window.removeEventListener('online', refresh);
              document.removeEventListener('visibilitychange', refresh);
            };
            dispose = cleanup;
            if(combined)setMigration({source:()=>local!.getState(),transport,complete:async()=>{await session.sync();if(abort.signal.aborted)throw new Error('계정이 변경되었습니다.');if(session.store.getState().sync?.error)throw new Error(session.store.getState().sync?.error);localStorage.setItem(migrationKey(uid),'true');combined.stop();setMigration(null);setStore(session.store);}});
            setNotice(''); setStore(combined?.store || session.store);
            void session.sync();
            return cleanup;
          } catch (cause) { dispose(); throw cause; }
        });
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '학습 저장소를 열 수 없습니다. 브라우저 저장 권한을 확인해 주세요.');
      }
    }
    void start();
    return () => { abort.abort(); };
  }, [uid, user, attempt]);

  async function logout() {
    if (signingOut) return;
    setSigningOut(true); setLogoutError('');
    stopSession.current();
    try { await signOut(getFirebaseAuth()); }
    catch { setLogoutError('로그아웃하지 못했습니다. 다시 시도해 주세요. 저장된 내용과 전송 대기 중인 변경은 유지됩니다.'); setAttempt(value => value + 1); }
    finally { setSigningOut(false); }
  }

  if (error || !store) return <div className="boot study-boot"><Sparkles aria-hidden="true"/>
    <p role={error ? 'alert' : 'status'}>{error || notice || '나의 학습 공간을 준비하고 있어요'}</p>
    <p>다른 탭에서 모아를 사용 중이라면 저장을 마친 뒤 해당 탭을 닫아 주세요. 전송 대기 중인 변경은 이 브라우저에 보관되며 같은 계정으로 다시 접속하면 이어서 동기화합니다.</p>
    <div className="study-boot-actions">
      <button className="soft-button" disabled={signingOut} onClick={() => { stopSession.current(); setAttempt(value => value + 1); }}>다시 시도</button>
      <button className="soft-button" disabled={signingOut} onClick={logout}>{signingOut ? '로그아웃 중…' : '로그아웃'}</button>
    </div>
    {logoutError&&<p role="alert">{logoutError}</p>}
  </div>;
  return <StopStudyContext.Provider value={() => stopSession.current()}><StudyContext.Provider value={store}>{migration&&<LegacyMigration uid={uid} {...migration}/ >}{children}</StudyContext.Provider></StopStudyContext.Provider>;
}
export function useStopStudySession() {
  const stop = useContext(StopStudyContext);
  if (!stop) throw new Error('StudyProvider가 필요합니다.');
  return stop;
}
export function useStudy() {
  const store = useContext(StudyContext);
  if (!store) throw new Error('StudyProvider가 필요합니다.');
  return useStore(store);
}
