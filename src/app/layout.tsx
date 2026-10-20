import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
export const metadata: Metadata = { title: '모아 — 배움이 기억이 되는 곳', description: 'AI 플래시카드와 간격 반복으로 만드는 나만의 학습 루틴' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body><AuthProvider>{children}</AuthProvider></body></html>; }
