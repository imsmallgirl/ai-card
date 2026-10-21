import type { AnalyticsEvent } from '../analytics-model.ts';
import { analyticsEvent } from '../analytics-model.ts';
import type { StudyDatabase } from './study-service.ts';
import { claimAnalyticsEvent, acknowledgeAnalyticsEvent } from './analytics-service.ts';

export type AnalyticsSender = (clientId: string, event: AnalyticsEvent, signal: AbortSignal) => Promise<boolean>;
export function createGa4Sender(env: Record<string, string | undefined>, fetcher: typeof fetch = fetch): AnalyticsSender | null {
  if (env.ANALYTICS_ENABLED !== 'true' || env.ANALYTICS_EXPORT_ENABLED !== 'true' || !/^G-[A-Z0-9]+$/.test(env.GA4_MEASUREMENT_ID || '') || !env.GA4_API_SECRET?.trim()) return null;
  // No browser SDK, page URL, Firebase UID or user_id. Secret is server-only and never logged.
  return async (clientId, raw, signal) => {
    const event = analyticsEvent.parse(raw);
    const query = new URLSearchParams({ measurement_id: env.GA4_MEASUREMENT_ID!, api_secret: env.GA4_API_SECRET! });
    const response = await fetcher(`https://www.google-analytics.com/mp/collect?${query}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', signal,
      body: JSON.stringify({ client_id: clientId, timestamp_micros: event.createdAt * 1000, consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
        events: [{ name: event.name, params: { ...event.props, event_id: event.id, policy_version: event.policyVersion } }],
      }),
    });
    await response.body?.cancel();
    // MP 2xx means accepted by transport, not that every event is present in GA reports.
    return response.ok;
  };
}
export async function exportAnalytics(options: {
  db: StudyDatabase; uid: string; sender: AnalyticsSender | null;
  listPending: (uid: string) => Promise<string[]>; signal: AbortSignal;
}) {
  if (!options.sender) return { attempted: 0 };
  const ids = (await options.listPending(options.uid)).slice(0, 5);
  let attempted = 0;
  for (const id of ids) {
    if (options.signal.aborted) break;
    const claimed = await claimAnalyticsEvent(options.db, options.uid, id);
    if (!claimed) continue;
    // Recheck at dispatch; an already in-flight external request cannot be recalled on withdrawal.
    // A second transactional consent check narrows the claim-to-network interval.
    const allowed = await options.db.transaction(async tx => {
      const consent = await tx.get(`users/${options.uid}/consent/analytics`);
      return consent?.granted === true && consent.revision === claimed.event.consentRevision;
    });
    if (!allowed) { await acknowledgeAnalyticsEvent(options.db, options.uid, id, false); continue; }
    attempted++;
    let sent = false;
    try { sent = await options.sender(claimed.clientId, claimed.event, AbortSignal.any([options.signal, AbortSignal.timeout(3000)])); } catch { /* Do not log payloads or secret-bearing URLs. */ }
    await acknowledgeAnalyticsEvent(options.db, options.uid, id, sent);
  }
  return { attempted };
}
