import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ANALYTICS_POLICY_VERSION, analyticsConsent, defaultAnalyticsConsent, analyticsEvent, analyticsAction, consentChange, countBucket, type AnalyticsEvent } from '../analytics-model.ts';
import { reviewDate } from '../study-cloud-model.ts';
import { StudyError, type StudyDatabase, type StudyTransaction } from './study-service.ts';

const consentRecord = analyticsConsent.extend({ clientId: z.string().optional(), updatedAt: z.number().optional(), lastMutationId: z.string().optional() });
const rootPath = (uid: string) => {
  if (!uid || uid.includes('/')) throw new StudyError('UNAUTHENTICATED', '계정을 확인할 수 없습니다.', 401);
  return `users/${uid}/`;
};
function consentEligible(data: unknown) {
  const result = consentRecord.safeParse(data);
  return result.success && result.data.granted && result.data.policyVersion === ANALYTICS_POLICY_VERSION ? result.data : null;
}
export async function readAnalyticsConsent(db: StudyDatabase, uid: string) {
  return db.transaction(async tx => analyticsConsent.parse(await tx.get(`${rootPath(uid)}consent/analytics`) || defaultAnalyticsConsent()));
}
export async function changeAnalyticsConsent(db: StudyDatabase, uid: string, raw: z.infer<typeof consentChange>, now: number, accountCreatedAt?: number) {
  const change = consentChange.parse(raw); const root = rootPath(uid);
  return db.transaction(async tx => {
    const current = consentRecord.parse(await tx.get(`${root}consent/analytics`) || defaultAnalyticsConsent());
    if (current.lastMutationId === change.mutationId) {
      if (current.granted !== change.granted || current.policyVersion !== change.policyVersion) throw new StudyError('IDEMPOTENCY_CONFLICT', '동일 요청 ID로 동의 내용을 변경할 수 없습니다.');
      return analyticsConsent.parse(current);
    }
    // Withdrawal is always safe, even if another device changed the revision.
    if (change.granted && current.revision !== change.expectedRevision) throw new StudyError('CONSENT_CONFLICT', '다른 기기에서 분석 설정이 변경되었습니다. 새로 확인해 주세요.');
    const revision = current.revision + 1;
    const next = { granted: change.granted, revision, policyVersion: ANALYTICS_POLICY_VERSION,
      lastMutationId: change.mutationId, updatedAt: now,
      // A fresh pseudonym per grant; never derive external identifiers from Firebase UID.
      clientId: change.granted ? randomUUID() : '',
    };
    tx.set(`${root}consent/analytics`, next);
    if (change.granted) {
      const old = await tx.get(`${root}growth/state`);
      tx.set(`${root}growth/state`, { ...old, firstSeenAt: old?.firstSeenAt ?? now });
      // Verified Auth metadata only; historical accounts are never classified as new sign-ups.
      if (!old?.signupRecorded && accountCreatedAt !== undefined && accountCreatedAt <= now && now - accountCreatedAt <= 300000) {
        await queueAnalyticsEvent(tx, root, { id: 'signup', name: 'sign_up', props: { source: 'account', occurrence: 'account_created' } }, next, now);
        tx.set(`${root}growth/state`, { ...old, firstSeenAt: old?.firstSeenAt ?? now, signupRecorded: true });
      }
    }
    return analyticsConsent.parse(next);
  });
}

type EventInput = Pick<AnalyticsEvent, 'id' | 'name' | 'props'>;
async function queueAnalyticsEvent(tx: StudyTransaction, root: string, input: EventInput, consent: { revision: number }, now: number) {
  // IDs include consent epoch. A revocation invalidates the entire old queue without scanning it.
  const id = `c${consent.revision}-${input.id}`;
  const path = `${root}analyticsOutbox/${id}`;
  if (await tx.get(path)) return;
  const event = analyticsEvent.parse({ ...input, id, consentRevision: consent.revision, policyVersion: ANALYTICS_POLICY_VERSION, createdAt: now, expiresAt: now + 7 * 86400000 });
  tx.set(path, { ...event, state: 'pending' });
}

// root='' for an existing UID-scoped study transaction; absolute users/{uid}/ for generation.
// Calls are inside the domain transaction, so only committed actions produce events.
export async function recordDomainAnalytics(tx: StudyTransaction, root: string, enabled: boolean,
  action: { type: 'deck'; id: string; count: number; source: 'cloud' | 'local' } | { type: 'review'; id: string; source: 'cloud' | 'local' } | { type: 'generation'; id: string; count: number }, now: number) {
  if (!enabled) return;
  const consent = consentEligible(await tx.get(`${root}consent/analytics`));
  if (!consent) return;
  if (action.type === 'generation') {
    await queueAnalyticsEvent(tx, root, { id: `generation-${action.id}`, name: 'ai_generation_completed', props: { source: 'server', count_bucket: countBucket(action.count) } }, consent, now);
    return;
  }
  const state = await tx.get(`${root}growth/state`) || {};
  const marker = action.type === 'deck' ? 'firstDeckObservedAt' : 'firstReviewObservedAt';
  if (state[marker] !== undefined) return;
  await queueAnalyticsEvent(tx, root, { id: action.type === 'deck' ? 'first-deck' : 'first-review', name: action.type === 'deck' ? 'first_deck_created' : 'first_review_completed', props: {
    source: action.source, occurrence: 'first_observed', ...(action.type === 'deck' ? { count_bucket: countBucket(action.count) } : {}),
  } }, consent, now);
  tx.set(`${root}growth/state`, { ...state, firstSeenAt: state.firstSeenAt ?? now, [marker]: now });
}
export async function recordClientAnalytics(db: StudyDatabase, uid: string, raw: z.infer<typeof analyticsAction>, now = Date.now()) {
  const action = analyticsAction.parse(raw); const root = rootPath(uid);
  return db.transaction(async tx => {
    const consent = consentEligible(await tx.get(`${root}consent/analytics`));
    if (!consent || consent.revision !== action.consentRevision) return { accepted: false };
    const profile = await tx.get(`${root}settings/profile`);
    const timeZone = typeof profile?.timeZone === 'string' ? profile.timeZone : 'Asia/Seoul';
    const day = reviewDate(now, timeZone);
    const ratePath = `${root}analyticsLimits/${day}`;
    const limit = await tx.get(ratePath);
    const requestCount = z.number().int().nonnegative().parse(limit?.count ?? 0);
    if (requestCount >= 200) throw new StudyError('ANALYTICS_LIMIT', '분석 요청 한도에 도달했습니다.', 429);
    tx.set(ratePath, { count: requestCount + 1 });
    if (action.action !== 'visit') {
      await recordDomainAnalytics(tx, root, true, action.action === 'local_deck_created'
        ? { type: 'deck', id: action.id, count: action.count, source: 'local' }
        : { type: 'review', id: action.id, source: 'local' }, now);
      return { accepted: true };
    }
    const state = await tx.get(`${root}growth/state`) || {};
    const first = typeof state.firstSeenAt === 'number' ? state.firstSeenAt : now;
    // UTC arithmetic on persisted local-date keys avoids DST's 23/25-hour days.
    const firstDay = reviewDate(first, timeZone);
    const days = Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse(firstDay + 'T00:00:00Z')) / 86400000);
    if (days === 7 && !state.return7Recorded) {
      await queueAnalyticsEvent(tx, root, { id: 'return-7d', name: 'return_7d', props: { source: 'account', occurrence: 'observed_return' } }, consent, now);
    }
    tx.set(`${root}growth/state`, { ...state, firstSeenAt: first, lastVisitDate: day, return7Recorded: Boolean(state.return7Recorded) || days === 7 });
    return { accepted: true };
  });
}
export async function claimAnalyticsEvent(db: StudyDatabase, uid: string, id: string, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new StudyError('INVALID_INPUT', '분석 이벤트 ID를 확인해 주세요.', 400);
  const root = rootPath(uid);
  return db.transaction(async tx => {
    const consent = consentEligible(await tx.get(`${root}consent/analytics`));
    const data = await tx.get(`${root}analyticsOutbox/${id}`);
    if (!data || data.state !== 'pending') return null;
    const event = analyticsEvent.parse(data);
    if (!consent || consent.revision !== event.consentRevision || now >= Math.min(event.expiresAt, event.createdAt + 72 * 3600000)) {
      tx.set(`${root}analyticsOutbox/${id}`, { ...data, state: 'cancelled' });
      return null;
    }
    if (!consent.clientId) return null;
    // One delivery attempt only. Network ambiguity stays uncertain rather than causing duplicates.
    tx.set(`${root}analyticsOutbox/${id}`, { ...data, state: 'sending', attemptedAt: now });
    return { event, clientId: consent.clientId };
  });
}
export async function acknowledgeAnalyticsEvent(db: StudyDatabase, uid: string, id: string, delivered: boolean) {
  const root = rootPath(uid);
  await db.transaction(async tx => {
    const path = `${root}analyticsOutbox/${id}`; const current = await tx.get(path);
    if (current?.state === 'sending') tx.set(path, { ...current, state: delivered ? 'delivered' : 'uncertain' });
  });
}
