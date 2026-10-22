import { siteOrigin } from '@/lib/site-origin';
import type { Metadata } from 'next';
import './globals.css';
import AnalyticsProvider from '@/components/analytics-provider';
import { AuthProvider } from '@/components/auth-provider';
import WebAnalyticsProvider from '@/components/web-analytics-provider';
export const metadata: Metadata = { title: '모아 — 배움이 기억이 되는 곳', description: '자료·AI·직접 만드는 플래시카드와 반복 학습으로 만드는 나만의 학습 루틴', metadataBase:siteOrigin(), openGraph:{type:'website',locale:'ko_KR',siteName:'모아',title:'모아 — 배움이 기억이 되는 곳',description:'직접 또는 AI로 만드는 학습 카드와 매일의 반복 학습'} };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body><AuthProvider><WebAnalyticsProvider><AnalyticsProvider>{children}</AnalyticsProvider></WebAnalyticsProvider></AuthProvider></body></html>; }
