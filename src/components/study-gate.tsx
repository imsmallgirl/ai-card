'use client';

import { Layers, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import AuthAccount from '@/components/auth-account';
import { StudyProvider } from '@/components/study-provider';
import StudyApp from '@/components/study-app';

export default function StudyGate() {
  const { user, checking } = useAuth();
  if (checking) return <div className="boot" role="status"><Sparkles/>로그인 상태를 확인하고 있어요</div>;
  if (!user) return <div className="login-page"><section className="login-card">
    <a className="brand" href="/"><span className="brand-icon"><Layers size={23}/></span>모아<span className="brand-dot">.</span></a>
    <span className="login-illustration"><ShieldCheck size={42}/></span>
    <div className="eyebrow">YOUR PERSONAL LEARNING SPACE</div>
    <h1>나만의 배움을 시작하세요<span className="heading-dot">.</span></h1>
    <p>AI로 학습 카드를 만들고, 모든 덱을 한 번에 복습하세요.<br/>모아의 모든 학습 기능은 로그인 후 이용할 수 있어요.</p>
    <AuthAccount variant="login"/>
    <small>나의 학습 덱과 기록은 이 브라우저에 계정별로 저장됩니다.</small>
  </section></div>;
  return <StudyProvider key={user.uid} uid={user.uid}><StudyApp/></StudyProvider>;
}
