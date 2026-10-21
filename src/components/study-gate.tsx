'use client';

import { useAuth } from '@/components/auth-provider';
import { StudyProvider } from '@/components/study-provider';
import StudyApp from '@/components/study-app';

export default function StudyGate({ landing }: { landing: React.ReactNode }) {
  const { user, checking } = useAuth();
  // Public server-rendered content remains visible during auth checks; private stores never mount early.
  if (checking || !user) return landing;
  return <StudyProvider key={user.uid} uid={user.uid}><StudyApp/></StudyProvider>;
}
