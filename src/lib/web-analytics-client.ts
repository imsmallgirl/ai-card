import { WEB_ANALYTICS_POLICY, WEB_CONSENT_KEY, WEB_SEEN_KEY, WEB_ACQUISITION_KEY, webAcquisitionRecord, safePage, safeAcquisition, webConsent, webEvent, type WebEvent } from './web-analytics-model.ts';

export type WebAnalyticsState = { ready: boolean; granted: boolean; busy: boolean; error: string; serverEnabled: boolean };
export type WebTag = {
  load: (config: Record<string, unknown>) => Promise<void>;
  send: (name: string, params: Record<string, unknown>) => void;
  disable: (clearCookies?: boolean) => void;
};
export function createWebAnalytics(options: {
  enabled: boolean; measurementId: string; origin: string;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  exclusive: (run: () => void) => Promise<void>;
  context: () => { href: string; referrer: string; pathname: string };
  tag: WebTag; notify: (state: WebAnalyticsState) => void;
  clock?: () => number;
}) {
  let epoch = 0, stopped = false, loaded = false;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const now = options.clock || Date.now;
  let consent: ReturnType<typeof webConsent.parse> | null = null;
  let acquisition = safeAcquisition('', '');
  let state: WebAnalyticsState = { ready: false, granted: false, busy: false, error: '', serverEnabled: options.enabled };
  const publish = () => { if (!stopped) options.notify({ ...state }); };
  function pause(clearCookies = true) { epoch++; loaded = false; clearTimeout(expiryTimer); options.tag.disable(clearCookies); state = { ...state, granted: false, busy: false }; publish(); }
  function armExpiry() {
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => { if (allowed()) armExpiry(); else void reload(); }, Math.max(1, Math.min((consent?.expiresAt || now()) - now(), 2147483647)));
    expiryTimer.unref?.();
  }
  function allowed() {
    if (stopped || !options.enabled || !state.granted || !loaded) return false;
    try {
      const current = webConsent.parse(JSON.parse(options.storage.getItem(WEB_CONSENT_KEY) || 'null'));
      return current.granted && current.clientId === consent?.clientId && current.expiresAt > now();
    } catch { pause(); return false; }
  }
  async function reload() {
    if (loaded && allowed()) return;
    pause(false); const run = epoch;
    try {
      const raw = options.storage.getItem(WEB_CONSENT_KEY);
      consent = raw ? webConsent.parse(JSON.parse(raw)) : null;
      if (!options.enabled || !consent?.granted || !consent.clientId || consent.expiresAt <= now()) {
        options.tag.disable(true);
        state = { ...state, ready: true, error: '' }; publish(); return;
      }
      state = { ...state, busy: true }; publish();
      const context = options.context();
      const saved = webAcquisitionRecord.safeParse(JSON.parse(options.storage.getItem(WEB_ACQUISITION_KEY) || 'null'));
      acquisition = saved.success && saved.data.clientId === consent.clientId && saved.data.expiresAt > now()
        ? saved.data.acquisition : safeAcquisition(context.href, context.referrer);
      options.storage.setItem(WEB_ACQUISITION_KEY, JSON.stringify({ clientId: consent.clientId, expiresAt: now() + 30 * 60000, acquisition }));
      await options.tag.load({ client_id: consent.clientId, send_page_view: false,
        page_location: options.origin + safePage(context.pathname), page_referrer: acquisition.referral, page_title: 'Moa',
        campaign_source: acquisition.source, campaign_medium: acquisition.medium,
        campaign_name: 'moa', campaign_id: 'moa', campaign_term: '', campaign_content: '',
        allow_google_signals: false, allow_ad_personalization_signals: false, cookie_domain: 'none', cookie_prefix: 'moa', cookie_expires: 2592000 });
      if (stopped || run !== epoch) return;
      loaded = true; state = { ...state, ready: true, granted: true, busy: false, error: '' }; publish();
      armExpiry();
    } catch { if (!stopped && run === epoch) { pause(); state = { ...state, ready: true, error: '분석 설정을 읽거나 저장하지 못해 수집을 중단했습니다. 학습 기능은 계속 이용할 수 있습니다.' }; publish(); } }
  }
  async function choose(granted: boolean) {
    pause();
    try {
      if (granted && !options.enabled) return;
      options.storage.setItem(WEB_CONSENT_KEY, JSON.stringify({ policy: WEB_ANALYTICS_POLICY, granted,
        ...(granted ? { clientId: crypto.randomUUID() } : {}), expiresAt: now() + 90 * 86400000 }));
      options.storage.removeItem(WEB_SEEN_KEY);
      options.storage.removeItem(WEB_ACQUISITION_KEY);
      await reload();
    } catch { state = { ...state, ready: true, error: '분석 선택을 저장하지 못했습니다. 수집은 중단했습니다.' }; publish(); }
  }
  async function send(name: string, params: Record<string, unknown>, key: string) {
    if (!allowed()) return;
    const run = epoch;
    try {
      await options.exclusive(() => {
        if (!allowed() || run !== epoch) return;
        const raw = JSON.parse(options.storage.getItem(WEB_SEEN_KEY) || '[]');
        if (!Array.isArray(raw) || !raw.every(value => typeof value === 'string')) throw new Error();
        // Deduplication keys stay in this browser; they are never GA4 parameters.
        const id = `${consent!.clientId}:${key}`;
        if (raw.includes(id)) return;
        options.storage.setItem(WEB_SEEN_KEY, JSON.stringify([...raw, id].slice(-1000)));
        if (allowed() && run === epoch) options.tag.send(name, { ...params, send_to: options.measurementId, event_id: crypto.randomUUID() });
      });
    } catch { pause(); state = { ...state, error: '중복 방지 저장소를 사용할 수 없어 분석을 중단했습니다.' }; publish(); }
  }
  async function track(event: WebEvent, key: string) {
    const parsed = webEvent.safeParse(event);
    if (!parsed.success || !allowed()) return;
    const { name, ...params } = parsed.data;
    const context = options.context();
    await send(name, { ...params, ...(name === 'screen_view' ? { screen_class: 'Moa' } : {}), page_location: options.origin + safePage(context.pathname), page_referrer: '', page_title: 'Moa' }, key);
  }
  async function page(pathname: string, key: string) {
    if (!allowed()) return;
    await send('page_view', { page_location: options.origin + safePage(pathname), page_title: 'Moa', page_referrer: acquisition.referral,
      acquisition_source: acquisition.source, acquisition_medium: acquisition.medium }, key);
  }
  return { reload, choose, track, page, pause, getState: () => ({ ...state }), stop: () => { pause(false); stopped = true; } };
}
