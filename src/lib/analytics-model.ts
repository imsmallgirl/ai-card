import { z } from 'zod';
export const ANALYTICS_POLICY_VERSION = '2026-10-21-v1';
export const analyticsConsent = z.object({
  granted: z.boolean(), revision: z.number().int().nonnegative(), policyVersion: z.string(),
});
export type AnalyticsConsent = z.infer<typeof analyticsConsent>;
export const defaultAnalyticsConsent = (): AnalyticsConsent => ({ granted: false, revision: 0, policyVersion: ANALYTICS_POLICY_VERSION });
const props = z.object({
  source: z.enum(['cloud', 'local', 'server', 'account']),
  count_bucket: z.enum(['1-5', '6-10', '11-20', '21-200']).optional(),
  occurrence: z.enum(['first_observed', 'account_created', 'observed_return']).optional(),
}).strict();
export const analyticsEvent = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  name: z.enum(['sign_up', 'first_deck_created', 'ai_generation_completed', 'first_review_completed', 'return_7d', 'ad_slot_viewed', 'ad_load_failed']),
  props, createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  consentRevision: z.number().int().positive(), policyVersion: z.literal(ANALYTICS_POLICY_VERSION),
});
export type AnalyticsEvent = z.infer<typeof analyticsEvent>;
export const analyticsAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('visit'), id: z.uuid(), consentRevision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal('local_deck_created'), id: z.uuid(), consentRevision: z.number().int().positive(), count: z.number().int().min(1).max(200) }).strict(),
  z.object({ action: z.literal('local_review_completed'), id: z.uuid(), consentRevision: z.number().int().positive() }).strict(),
]);
export const consentChange = z.object({
  granted: z.boolean(), expectedRevision: z.number().int().nonnegative(), mutationId: z.uuid(), policyVersion: z.literal(ANALYTICS_POLICY_VERSION),
}).strict();
export const analyticsStorageKey = (uid: string) => `moa-analytics-consent-${uid}`;
export const localAnalyticsConsent = z.object({ granted: z.boolean(), pendingWithdrawal: z.boolean().default(false), policyVersion: z.string() });
export const countBucket = (count: number) => count <= 5 ? '1-5' as const : count <= 10 ? '6-10' as const : count <= 20 ? '11-20' as const : '21-200' as const;
