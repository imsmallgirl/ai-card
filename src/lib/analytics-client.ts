import { z } from 'zod';
import { ANALYTICS_POLICY_VERSION, analyticsConsent, analyticsStorageKey, localAnalyticsConsent, type AnalyticsConsent } from './analytics-model.ts';

export type AnalyticsTransport = (path: string, body?: unknown) => Promise<unknown>;
export function createAnalyticsTransport(getToken: (refresh: boolean) => Promise<string>, signal: AbortSignal, fetcher: typeof fetch = fetch): AnalyticsTransport {
  return async (path, body) => {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted(); const token = await getToken(attempt > 0); signal.throwIfAborted();
      const response = await fetcher(`/api/analytics/${path}`, { method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: 'no-store',
      });
      if (response.status === 401 && attempt === 0) continue;
      const data: unknown = await response.json(); signal.throwIfAborted();
      if (!response.ok) {
        const parsed = z.object({ error: z.string() }).safeParse(data);
        throw new Error(parsed.success ? parsed.data.error : '분석 설정 서버에 연결하지 못했습니다.');
      }
      return data;
    }
  };
}
export type AnalyticsClientState = { ready: boolean; granted: boolean; busy: boolean; error: string; serverEnabled: boolean };
export function createAnalyticsClient(options: {
  uid: string; enabled: boolean; storage: Pick<Storage, 'getItem' | 'setItem'>;
  transport: AnalyticsTransport; notify: (state: AnalyticsClientState) => void;
}) {
  let stopped = false; let busy = false;
  let consent: AnalyticsConsent = { granted: false, revision: 0, policyVersion: ANALYTICS_POLICY_VERSION };
  let state: AnalyticsClientState = { ready: !options.enabled, granted: false, busy: false, error: '', serverEnabled: options.enabled };
  let epoch = 0;
  const reported = new Set<string>();
  const key = analyticsStorageKey(options.uid);
  const publish = () => { if (!stopped) options.notify({ ...state, busy }); };
  function readLocal() {
    const raw = options.storage.getItem(key);
    if (!raw) return null;
    const local = localAnalyticsConsent.parse(JSON.parse(raw));
    return local.policyVersion === ANALYTICS_POLICY_VERSION ? local : { ...local, granted: false, pendingWithdrawal: true };
  }
  function saveLocal(granted: boolean, pendingWithdrawal = false) {
    options.storage.setItem(key, JSON.stringify({ granted, pendingWithdrawal, policyVersion: ANALYTICS_POLICY_VERSION }));
  }
  async function reload() {
    if (stopped || busy) return;
    const run = ++epoch;
    try {
      const local = readLocal();
      if (!options.enabled && !local?.pendingWithdrawal) { state = { ...state, ready: true, granted: false, serverEnabled: false }; publish(); return; }
      const data = z.object({ consent: analyticsConsent, enabled: z.boolean() }).parse(await options.transport('consent'));
      if (stopped || run !== epoch) return;
      consent = data.consent;
      if (local?.pendingWithdrawal) {
        const response = z.object({ consent: analyticsConsent }).parse(await options.transport('consent', {
          granted: false, expectedRevision: consent.revision, mutationId: crypto.randomUUID(), policyVersion: ANALYTICS_POLICY_VERSION,
        }));
        if (stopped || run !== epoch) return;
        consent = response.consent; saveLocal(false);
      }
      const granted = options.enabled && data.enabled && consent.granted && consent.policyVersion === ANALYTICS_POLICY_VERSION;
      state = { ...state, ready: true, serverEnabled: data.enabled, granted, error: '' }; publish();
    } catch {
      if (stopped || run !== epoch) return;
      state = { ...state, ready: true, granted: false, error: '분석 설정을 확인하지 못했습니다. 이 기기에서 수집을 중단했습니다. 철회 대기 중이면 다시 시도해 주세요.' }; publish();
    }
  }
  async function choose(granted: boolean) {
    if (stopped || busy) return;
    const run = ++epoch; busy = true;
    // A withdrawal stops this client synchronously and is durable before network activity.
    if (!granted) state = { ...state, granted: false };
    publish();
    try {
      if (granted && (!options.enabled || !state.serverEnabled)) throw new Error('선택적 분석 기능이 현재 비활성화되어 있습니다.');
      saveLocal(false, !granted);
      const response = z.object({ consent: analyticsConsent, enabled: z.boolean() }).parse(await options.transport('consent', {
        granted, expectedRevision: consent.revision, mutationId: crypto.randomUUID(), policyVersion: ANALYTICS_POLICY_VERSION,
      }));
      if (stopped || run !== epoch) return;
      consent = response.consent; saveLocal(consent.granted);
      state = { ...state, ready: true, serverEnabled: response.enabled, granted: granted && consent.granted && response.enabled && consent.policyVersion === ANALYTICS_POLICY_VERSION, error: '' };
    } catch (cause) {
      if (!stopped && run === epoch) state = { ...state, granted: false, error: cause instanceof Error ? cause.message : '설정을 저장하지 못했습니다.' };
    } finally { if (!stopped && run === epoch) { busy = false; publish(); } }
  }
  async function flush() {
    if (stopped || !options.enabled || !state.ready || !state.granted || busy) return;
    try {
      if (readLocal()?.pendingWithdrawal) return;
      await options.transport('export', {});
    } catch { /* Delivery failure never affects core use. */ }
  }
  async function track(action: 'visit' | 'local_deck_created' | 'local_review_completed', count?: number) {
    if (stopped || !options.enabled || !state.ready || !state.granted || busy) return;
    const run = epoch;
    if (action !== 'visit' && reported.has(action)) return;
    try {
      const local = readLocal();
      if (local?.pendingWithdrawal) return;
      if (action !== 'visit') reported.add(action);
      const response = z.object({ accepted: z.boolean() }).safeParse(await options.transport('events', { action, id: crypto.randomUUID(), consentRevision: consent.revision, ...(action === 'local_deck_created' ? { count } : {}) }));
      if (!response.success || !response.data.accepted) { reported.delete(action); return; }
      if (stopped || run !== epoch || !state.granted) return;
      // Endpoint is a no-op without the separate server export activation flag and credentials.
      await options.transport('export', {});
    } catch { if (action !== 'visit') reported.delete(action); /* Optional measurement never blocks UI actions. */ }
  }
  function pause() { epoch++; busy = false; state = { ...state, granted: false }; publish(); }
  return { reload, choose, track, flush, pause, stop: () => { stopped = true; epoch++; }, getState: () => ({ ...state, busy }) };
}
