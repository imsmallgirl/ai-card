import { operationalLog } from './operational-log.ts';
import { z } from 'zod';
import { generationRequestId } from '../generation-model.ts';
import { parseMaterial } from '../material-parser.ts';
import { generationInput } from '../gemini.ts';
import { AuthenticationError, AuthConfigurationError } from '../server-auth.ts';
import { readStudyBody } from './study-http.ts';
import { StudyError, type StudyDatabase } from './study-service.ts';
import { generationPolicy, readGenerationUsage, GenerationError, type GenerationPolicy } from './generation-usage.ts';
import { generateWithBudget, generationResult } from './generation-service.ts';
import { generationSettings } from './generation-settings.ts';
import { generateMock } from './generation-mock.ts';

export type GenerationDependencies = {
  authenticate: (request: Request) => Promise<{ uid: string }>;
  database: () => StudyDatabase | Promise<StudyDatabase>;
  environment?: () => Record<string, string | undefined>;
  fetcher?: typeof fetch;
  clock?: () => number;
};
export function createGenerationHandlers(deps: GenerationDependencies) {
  const clock = deps.clock || Date.now;
  const reply = (body: unknown, status = 200, retryAt?: number) => Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', ...(retryAt ? { 'Retry-After': String(Math.max(1, Math.ceil((retryAt - clock()) / 1000))) } : {}),
  } });
  return async (request: Request, operation: 'generate' | 'usage' | 'result', id?: string) => {
    let uid: string | undefined; let db: StudyDatabase | undefined; let policy: GenerationPolicy | undefined;
    try {
      uid = (await deps.authenticate(request)).uid;
      const env = deps.environment?.() || process.env;
      const settings = generationSettings(env);
      try { policy = generationPolicy(env); } catch { throw new GenerationError('NOT_CONFIGURED', 'AI 사용량 제한 설정을 확인해 주세요.', 503); }
      if (settings.provider === 'mock') policy = { ...policy, unlimited: true, cooldownMs: 0, failureCooldownMs: 0 };
      // Reject disabled/malformed generation requests before Firestore usage reads or reservations.
      const generation=operation==='generate'?{requestId:generationRequestId.parse(request.headers.get('idempotency-key')),input:generationInput.parse(await readStudyBody(request))}:undefined;
      if(generation){
        if(generation.input.mode==='material'){
          if(!generation.input.text.trim())throw new GenerationError('INVALID_INPUT','AI 자료 분석에는 원본 자료가 필요합니다.',400);
          if(parseMaterial(generation.input.text).cards.length>generation.input.count)throw new GenerationError('INVALID_INPUT','원문의 문항 수가 AI 생성 한도를 넘습니다. 자료를 나누거나 AI 없이 추출해 주세요.',400);
        }
        if(env.AI_GENERATION_ENABLED!=='true')throw new GenerationError('GENERATION_DISABLED','AI 생성이 현재 비활성화되어 있습니다. 저장된 카드는 계속 복습할 수 있습니다.',503);
        if(settings.provider==='gemini'&&!env.GEMINI_API_KEY?.trim())throw new GenerationError('NOT_CONFIGURED','서버 AI 연결 설정이 필요합니다.',503);
      }
      db = await deps.database();
      if (operation === 'usage') return reply({ usage: await readGenerationUsage(db, uid, policy, clock()), provider: settings.provider, model: settings.model,
        enabled: env.AI_GENERATION_ENABLED === 'true' && (settings.provider === 'mock' || Boolean(env.GEMINI_API_KEY?.trim())) });
      if (operation === 'result') return reply({ ...await generationResult(db, uid, generationRequestId.parse(id), clock(), settings.provider === 'mock'), usage: await readGenerationUsage(db, uid, policy, clock()) });
      if(!generation)throw new GenerationError('INVALID_INPUT','생성 요청을 확인해 주세요.',400);
      const {requestId,input}=generation;
      if (settings.provider === 'mock') {
        const result = await generateMock({ db, uid, id: requestId, input, policy, signal: request.signal, environment: env, clock });
        return reply({ ...result, usage: await readGenerationUsage(db, uid, policy, clock()) });
      }
      const key = env.GEMINI_API_KEY?.trim();
      if (!key) throw new GenerationError('NOT_CONFIGURED', '서버 AI 연결 설정이 필요합니다.', 503);
      const model = settings.model;
      const result = await generateWithBudget({ db, uid, id: requestId, key, model, input, policy,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(55000)]), fetcher: deps.fetcher, clock });
      return reply({ ...result, usage: await readGenerationUsage(db, uid, policy, clock()) });
    } catch (cause) {
      let usage;
      if (uid && db && policy) usage = await readGenerationUsage(db, uid, policy, clock()).catch(() => undefined);
      if (cause instanceof AuthenticationError) return reply({ code: 'UNAUTHENTICATED', error: cause.message }, 401);
      if (cause instanceof AuthConfigurationError) return reply({ code: 'NOT_CONFIGURED', error: 'Firebase 인증 설정이 필요합니다.' }, 503);
      if (cause instanceof StudyError) return reply({ code: cause.code, error: cause.message, usage,
        ...(cause instanceof GenerationError && cause.terminal ? { terminal: true } : {}),
        ...(cause instanceof GenerationError && cause.diagnostic ? { diagnostic: cause.diagnostic } : {}),
        ...(cause instanceof GenerationError && cause.retryAt ? { retryAt: cause.retryAt } : {}) }, cause.status, cause instanceof GenerationError ? cause.retryAt : undefined);
      if (cause instanceof z.ZodError) return reply({ code: 'INVALID_INPUT', error: '학습 내용과 요청 ID를 확인해 주세요. 수량은 1~20개이며 자료는 15,000자까지입니다.', usage }, 400);
      operationalLog('generation','UNEXPECTED_FAILURE');
      return reply({ code: 'USAGE_UNAVAILABLE', error: '사용량 저장소에 연결하지 못했습니다. 안전을 위해 새 AI 호출을 중단했습니다. 같은 요청으로 결과를 다시 확인해 주세요.', usage }, 503);
    }
  };
}
