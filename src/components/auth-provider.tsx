'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { firebaseConfigured, getFirebaseAuth } from '@/lib/firebase';

type AuthState = { user: User | null; checking: boolean; error: string };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, checking: firebaseConfigured, error: '' });

  useEffect(() => {
    if (!firebaseConfigured) return;
    const fail = () => setState({ user: null, checking: false, error: '로그인 상태를 확인하지 못했습니다. Firebase 설정을 확인하고 새로고침해 주세요.' });
    try {
      return onAuthStateChanged(getFirebaseAuth(), user => {
        setState({ user, checking: false, error: '' });
      }, fail);
    } catch { fail(); }
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const state = useContext(AuthContext);
  if (!state) throw new Error('AuthProvider가 필요합니다.');
  return state;
}
