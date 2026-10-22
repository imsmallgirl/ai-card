'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { LogIn, LogOut, ShieldCheck, X } from 'lucide-react';
import { firebaseConfigured, getFirebaseAuth } from '@/lib/firebase';
import { useAuth } from '@/components/auth-provider';
import UserAvatar from '@/components/user-avatar';
import { useWebAnalytics } from './web-analytics-provider';

function errorMessage(error: unknown) {
  if (!(error instanceof FirebaseError)) return '로그인 중 문제가 발생했습니다. 다시 시도해 주세요.';
  switch (error.code) {
    case 'auth/popup-closed-by-user': return '로그인 창이 닫혔어요. 다시 시도할 수 있습니다.';
    case 'auth/cancelled-popup-request': return '이미 열린 로그인 창에서 계속해 주세요.';
    case 'auth/popup-blocked': return '브라우저에서 팝업을 허용한 뒤 다시 시도해 주세요.';
    case 'auth/unauthorized-domain': return '현재 도메인이 허용되지 않았습니다. Firebase Authentication의 승인된 도메인에 추가해 주세요.';
    case 'auth/operation-not-allowed': return 'Firebase 콘솔에서 Google 로그인 제공업체를 활성화해 주세요.';
    case 'auth/network-request-failed': return '네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
    case 'auth/invalid-api-key': return 'Firebase API 키 설정을 확인해 주세요.';
    case 'auth/user-disabled': return '사용 중지된 계정입니다. 관리자에게 문의해 주세요.';
    default: return '로그인에 실패했습니다. Firebase 설정을 확인한 뒤 다시 시도해 주세요.';
  }
}

export default function AuthAccount({ variant = 'header', label }: { variant?: 'header' | 'sidebar' | 'login' | 'cta'; label?: string }) {
  const { user, checking, error: authError } = useAuth();
  const webAnalytics = useWebAnalytics();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setOpen(false);
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('keydown', handleKey); trigger.current?.focus(); };
  }, [open, pending]);

  async function login() {
    setPending(true);
    setError('');
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(getFirebaseAuth(), provider);
      webAnalytics.track({ name: 'login' }, `login:${crypto.randomUUID()}`);
      setOpen(false);
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  }

  async function logout() {
    setPending(true);
    setError('');
    try { await signOut(getFirebaseAuth()); setOpen(false); }
    catch { setError('로그아웃하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setPending(false); }
  }

  const name = user?.displayName || user?.email?.split('@')[0] || '학습자';
  if (variant === 'login' || variant === 'cta') return <div className="login-actions">
    {user ? <a className="primary" href="/">내 학습 공간으로</a> : <button className={variant === 'cta' ? 'primary landing-auth-cta' : 'google-signin'} disabled={checking || pending || !firebaseConfigured} onClick={login}><span className="google-mark" aria-hidden="true">G</span>{checking ? '로그인 확인 중…' : pending ? 'Google에서 로그인하는 중…' : label || 'Google로 계속하기'}</button>}
    {!firebaseConfigured && <p className="error" role="alert">로그인 설정이 필요합니다. Firebase 프로젝트 설정을 확인해 주세요.</p>}
    {(error || authError) && <p className="error" role="alert">{error || authError}</p>}
  </div>;
  return <>
    <button ref={trigger} className={variant === 'sidebar' ? 'profile account-profile' : 'account-trigger'} onClick={() => setOpen(true)} disabled={checking} aria-haspopup="dialog" aria-label={user ? `${name} 계정 정보` : '로그인'}>
      {variant === 'sidebar' ? <>
        <UserAvatar name={user ? name : '나'} photoURL={user?.photoURL}/>
        <span className="profile-info"><strong>{checking ? '로그인 확인 중…' : user ? name : '로그인 필요'}</strong><small>{user?.email || (user ? 'Google 계정으로 로그인' : '로그인하고 시작하기')}</small></span>
        <span className={user ? 'online' : 'offline'}/>
      </> : user ? <><UserAvatar name={name} photoURL={user.photoURL} small/><span className="account-name">{name}</span></> : <><LogIn size={15}/><span>{checking ? '확인 중…' : '로그인'}</span></>}
    </button>
    {open && <div className="overlay" onClick={() => !pending && setOpen(false)}>
      <section ref={dialog} className="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
        <button ref={close} className="close" disabled={pending} aria-label="닫기" onClick={() => setOpen(false)}><X size={21}/></button>
        <span className="modal-icon"><ShieldCheck/></span>
        <span className="eyebrow">YOUR PERSONAL LEARNING SPACE</span>
        <h2 id={titleId}>{user ? `${name}님, 반가워요` : '반가워요, 모아에 오신 걸 환영해요'}</h2>
        <p>{user ? 'Google 계정으로 로그인되어 있습니다.' : 'Google 계정으로 간편하게 시작하세요.'}</p>
        {user ? <><div className="account-detail"><UserAvatar name={name} photoURL={user.photoURL}/><div><strong>{name}</strong><small>{user.email || 'Google 계정'}</small></div><span className="account-provider">Google</span></div><button className="google-signin" onClick={logout} disabled={pending}><LogOut size={17}/>{pending ? '로그아웃 중…' : '로그아웃'}</button></> : <>
          <button className="google-signin" disabled={pending || !firebaseConfigured} onClick={login}><span className="google-mark" aria-hidden="true">G</span>{pending ? 'Google에서 로그인하는 중…' : 'Google로 계속하기'}</button>
          {!firebaseConfigured && <div className="auth-setup"><strong>로그인 연결을 준비하고 있어요</strong><p>Firebase 프로젝트 설정 후 사용할 수 있습니다. 관리자가 Firebase 설정을 완료한 후 로그인할 수 있습니다.</p></div>}
        </>}
        {(error || authError) && <p className="error" role="alert">{error || authError}</p>}
        <p className="auth-storage-note">학습 덱과 기록은 계정별로 분리됩니다. 저장 방식은 학습 공간의 저장 상태에서 확인할 수 있습니다. 기존 로컬 덱은 해당 기기에 유지됩니다.</p>
      </section>
    </div>}
  </>;
}
