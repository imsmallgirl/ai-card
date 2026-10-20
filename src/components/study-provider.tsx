'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStudyStore } from '@/lib/store';
import { prepareStudyStorage } from '@/lib/study-storage';
import { Sparkles } from 'lucide-react';

type Store = ReturnType<typeof createStudyStore>;
const StudyContext = createContext<Store | null>(null);

export function StudyProvider({ uid, children }: { uid: string; children: React.ReactNode }) {
  const [store, setStore] = useState<Store | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    try {
      prepareStudyStorage(localStorage, uid);
      setStore(createStudyStore(uid));
    } catch { setFailed(true); }
  }, [uid]);

  if (failed) return <div className="boot">학습 저장소를 열 수 없습니다. 브라우저의 사이트 저장 권한을 확인하고 새로고침해 주세요.</div>;
  if (!store) return <div className="boot"><Sparkles/>나의 학습 공간을 준비하고 있어요</div>;
  return <StudyContext.Provider value={store}>{children}</StudyContext.Provider>;
}

export function useStudy() {
  const store = useContext(StudyContext);
  if (!store) throw new Error('StudyProvider가 필요합니다.');
  return useStore(store);
}
