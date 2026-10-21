import { generatedCards, generationInput } from '../gemini.ts';
import type { z } from 'zod';
import type { StudyDatabase } from './study-service.ts';
import { generationHash, reserveGeneration, finishGeneration, GenerationError, type GenerationPolicy } from './generation-usage.ts';
import { generationResult } from './generation-service.ts';
import { MOCK_MODEL, mockAllowed } from './generation-settings.ts';

export async function generateMock(options: {
  db: StudyDatabase; uid: string; id: string; input: z.infer<typeof generationInput>;
  policy: GenerationPolicy; signal: AbortSignal; environment: Record<string, string | undefined>; clock?: () => number;
}) {
  // Guard here as well as in the HTTP settings resolver. No fetcher/key exists in this path.
  if (!mockAllowed(options.environment)) throw new GenerationError('MOCK_DISABLED', 'Mock AI는 로컬 development 환경에서만 사용할 수 있습니다.', 503);
  const { db, uid, id, signal } = options;
  signal.throwIfAborted();
  const input = generationInput.parse(options.input);
  const clock = options.clock || Date.now;
  const policy = { ...options.policy, unlimited: true, cooldownMs: 0, failureCooldownMs: 0 };
  const { claimed } = await reserveGeneration(db, uid, id, generationHash(input), MOCK_MODEL, 0, policy, clock());
  if (!claimed) return generationResult(db, uid, id, clock(), true);
  const cards = generatedCards.parse({ cards: Array.from({ length: input.count }, (_, index) => ({
    ...(input.mode==='material'?{category:input.category,tags:['Mock 테스트'],difficulty:input.difficulty}:{}),
    question: `[Mock ${index + 1}] ${input.title} — 테스트 질문 ${index + 1}`,
    answer: `[Mock 테스트용] ${input.category} 카드 ${index + 1}의 저장·조회·수정·복습을 확인하세요. 실제 AI가 생성한 학습 내용이 아닙니다.${input.text ? ' 참고 자료의 자동 분석도 수행하지 않았습니다.' : ''}`,
  })) }).cards;
  // Provider attempts stay at zero: no Gemini quota or token/spend admission is consumed.
  await finishGeneration(db, uid, id, policy, { result: { cards, model: MOCK_MODEL, ...(input.mode==='material'?{title:`[Mock] ${input.title}`.slice(0,80)}:{}) } }, clock());
  return generationResult(db, uid, id, clock(), true);
}
