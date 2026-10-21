import { z } from 'zod';
import { AuthenticationError } from '../server-auth.ts';

export function createCostHandler(deps: {
  authenticate: (request: Request) => Promise<{ uid: string; admin?: unknown }>;
  read: (first: number, last: number) => Promise<unknown>;
}) {
  return async (request: Request) => {
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      const user = await deps.authenticate(request);
      if (user.admin !== true) return reply({ code: 'FORBIDDEN', error: '관리자 권한이 필요합니다.' }, 403);
      const query = new URL(request.url).searchParams;
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
      const start = date.parse(query.get('from')), end = date.parse(query.get('to'));
      const first = Date.parse(start + 'T00:00:00Z'), last = Date.parse(end + 'T00:00:00Z');
      if (!Number.isFinite(first) || !Number.isFinite(last) || new Date(first).toISOString().slice(0, 10) !== start || new Date(last).toISOString().slice(0, 10) !== end || last < first || last - first > 30 * 86400000) return reply({ code: 'INVALID_INPUT', error: '조회 기간은 유효한 UTC 날짜, 최대 31일이어야 합니다.' }, 400);
      return reply({ days: await deps.read(first, last), currencyCost: null, note: '토큰은 확인된 사용량의 합계이며 누락·미보고 시도가 있을 수 있습니다. 실제 청구 금액은 제공하지 않습니다.' });
    } catch (cause) {
      if (cause instanceof AuthenticationError) return reply({ code: 'UNAUTHENTICATED', error: cause.message }, 401);
      if (cause instanceof z.ZodError) return reply({ code: 'INVALID_INPUT', error: 'from/to 날짜를 확인해 주세요.' }, 400);
      return reply({ code: 'COSTS_UNAVAILABLE', error: '비용 분석 데이터를 조회하지 못했습니다.' }, 503);
    }
  };
}
