import { z } from 'zod';

export const WEB_ANALYTICS_POLICY = '2026-10-22-web-v1';
export const WEB_CONSENT_KEY = 'moa-web-analytics-consent';
export const WEB_SEEN_KEY = 'moa-web-analytics-events';
export const WEB_ACQUISITION_KEY = 'moa-web-analytics-acquisition';
export const webScreen = z.enum(['dashboard', 'decks', 'review', 'statistics', 'settings']);
export const webMethod = z.enum(['manual', 'rules', 'ai']);
const bucket = z.enum(['1-5', '6-10', '11-20', '21-200']);
export const webEvent = z.discriminatedUnion('name', [
  z.object({ name: z.literal('login') }).strict(),
  z.object({ name: z.literal('card_generation_completed'), method: webMethod, count_bucket: bucket }).strict(),
  z.object({ name: z.literal('cards_saved'), method: webMethod, count_bucket: bucket }).strict(),
  z.object({ name: z.literal('review_started'), count_bucket: bucket }).strict(),
  z.object({ name: z.literal('review_completed'), count_bucket: bucket }).strict(),
  z.object({ name: z.literal('screen_view'), screen_name: webScreen }).strict(),
]);
export type WebEvent = z.infer<typeof webEvent>;
export const webConsent = z.object({ policy: z.literal(WEB_ANALYTICS_POLICY), granted: z.boolean(), clientId: z.uuid().optional(), expiresAt: z.number().finite() }).strict();

const paths = new Set(['/', '/about', '/login', '/privacy', '/privacy/analytics', '/terms']);
export function safePage(pathname: string) { return paths.has(pathname) ? pathname : '/other'; }
const sources = ['google', 'naver', 'bing', 'instagram', 'youtube', 'kakao'] as const;
export const webAcquisition = z.object({ source: z.enum([...sources, 'direct', 'other']), medium: z.enum(['none', 'email', 'social', 'cpc', 'referral', 'campaign', 'organic']),
  referral: z.enum(['', ...sources.map(source => `https://${source}.com/`)] as [string, ...string[]]) }).strict();
export const webAcquisitionRecord = z.object({ clientId: z.uuid(), expiresAt: z.number().finite(), acquisition: webAcquisition }).strict();
// URL, referrer and campaign strings are inspected locally; only fixed labels leave this function.
export function safeAcquisition(href: string, referrer: string) {
  let source = 'direct', medium = 'none', referral = '';
  try {
    const url = new URL(href);
    const tagged = url.searchParams.get('utm_source')?.toLowerCase();
    if (tagged) {
      source = sources.includes(tagged as typeof sources[number]) ? tagged : 'other';
      const value = url.searchParams.get('utm_medium');
      medium = ['email', 'social', 'cpc', 'referral'].includes(value || '') ? value! : 'campaign';
    } else if (referrer) {
      const from = new URL(referrer);
      if (from.origin === url.origin) return { source, medium, referral };
      const host = from.hostname.replace(/^www\./, '');
      source = ['google.com', 'google.co.kr', 'google.co.jp', 'google.co.uk'].includes(host) ? 'google'
        : host === 'youtu.be' ? 'youtube' : sources.find(value => host === `${value}.com` || host.endsWith(`.${value}.com`)) || 'other';
      medium = ['google', 'naver', 'bing'].includes(source) ? 'organic' : 'referral';
      referral = source === 'other' ? '' : `https://${source}.com/`;
    }
  } catch { /* Do not forward malformed input. */ }
  return { source, medium, referral };
}

export function webAnalyticsConfig(env: Record<string, string | undefined>) {
  let origin = '';
  try { const url = new URL(env.NEXT_PUBLIC_SITE_ORIGIN || ''); if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin; } catch { /* disabled */ }
  const measurementId = env.NEXT_PUBLIC_GA4_MEASUREMENT_ID || '';
  return { measurementId, origin, enabled: env.NEXT_PUBLIC_GA4_ENABLED === 'true'
    && env.NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED === 'true' && /^G-[A-Z0-9]+$/.test(measurementId) && Boolean(origin) };
}
