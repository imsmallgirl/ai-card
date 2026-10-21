import { DEFAULT_GEMINI_MODEL } from '../gemini.ts';
import { GenerationError } from './generation-usage.ts';

export const MOCK_MODEL = 'mock-study-v1';
export function mockAllowed(env: Record<string, string | undefined>) {
  return env.NODE_ENV === 'development' && env.AI_PROVIDER === 'mock'
    && !env.VERCEL && !env.K_SERVICE && env.NETLIFY !== 'true';
}
export function generationSettings(env: Record<string, string | undefined>) {
  const provider = env.AI_PROVIDER || 'gemini';
  if (provider !== 'gemini' && provider !== 'mock') throw new GenerationError('NOT_CONFIGURED', 'AI_PROVIDER는 gemini 또는 mock으로 설정해 주세요.', 503);
  if (provider === 'mock') {
    if (!mockAllowed(env)) throw new GenerationError('MOCK_DISABLED', 'Mock AI는 로컬 development 환경에서만 사용할 수 있습니다. 배포 환경의 AI_PROVIDER를 gemini로 설정해 주세요.', 503);
    return { provider, model: MOCK_MODEL } as const;
  }
  const model = (env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
  if (!/^gemini-[a-zA-Z0-9][a-zA-Z0-9._-]{0,110}$/.test(model)) throw new GenerationError('MODEL_CONFIG_INVALID', 'GEMINI_MODEL에 정확한 Gemini 모델 ID를 설정해 주세요.', 503);
  return { provider, model } as const;
}
