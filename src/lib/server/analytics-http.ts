import { z } from 'zod';
import { analyticsAction, consentChange } from '../analytics-model.ts';
import { AuthenticationError, AuthConfigurationError } from '../server-auth.ts';
import { StudyError, type StudyDatabase } from './study-service.ts';
import { readStudyBody } from './study-http.ts';
import { changeAnalyticsConsent, readAnalyticsConsent, recordClientAnalytics } from './analytics-service.ts';
import { exportAnalytics, type AnalyticsSender } from './analytics-export.ts';

export function createAnalyticsHandler(deps: {
  authenticate: (request: Request) => Promise<{ uid: string }>;
  database: () => StudyDatabase | Promise<StudyDatabase>; enabled: () => boolean;
  accountCreatedAt: (uid: string) => Promise<number | undefined>;
  sender: () => AnalyticsSender | null;
  listPending: (uid: string) => Promise<string[]>;
  clock?: () => number;
}) {
  return async (request: Request, operation: 'consent' | 'event' | 'export') => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      const { uid } = await deps.authenticate(request);
      const enabled = deps.enabled();
      if (operation === 'consent') {
        if (request.method === 'GET') return reply({ consent: await readAnalyticsConsent(await deps.database(), uid), enabled });
        const change = consentChange.parse(await readStudyBody(request));
        if (change.granted && !enabled) throw new StudyError('ANALYTICS_DISABLED', '선택적 분석 기능이 비활성화되어 있습니다.', 503);
        const createdAt = change.granted ? await deps.accountCreatedAt(uid) : undefined;
        return reply({ consent: await changeAnalyticsConsent(await deps.database(), uid, change, (deps.clock || Date.now)(), createdAt), enabled });
      }
      if (!enabled) return reply({ accepted: false, enabled: false });
      if (operation === 'event') {
        const action = analyticsAction.parse(await readStudyBody(request));
        return reply(await recordClientAnalytics(await deps.database(), uid, action, (deps.clock || Date.now)()));
      }
      // No input-derived external destination or UID, and no database scans while export is disabled.
      const sender = deps.sender();
      if (!sender) return reply({ attempted: 0 });
      return reply(await exportAnalytics({ db: await deps.database(), uid, sender, listPending: deps.listPending, signal: request.signal }));
    } catch (cause) {
      if (cause instanceof AuthenticationError) return reply({ code: 'UNAUTHENTICATED', error: cause.message }, 401);
      if (cause instanceof AuthConfigurationError) return reply({ code: 'ANALYTICS_UNAVAILABLE', error: '분석 설정 서버에 연결할 수 없습니다.' }, 503);
      if (cause instanceof StudyError) return reply({ code: cause.code, error: cause.message }, cause.status);
      if (cause instanceof z.ZodError) return reply({ code: 'INVALID_INPUT', error: '분석 설정 또는 허용 이벤트를 확인해 주세요.' }, 400);
      return reply({ code: 'ANALYTICS_UNAVAILABLE', error: '분석 설정을 저장하지 못했습니다. 학습 기능은 계속 이용할 수 있습니다.' }, 503);
    }
  };
}
