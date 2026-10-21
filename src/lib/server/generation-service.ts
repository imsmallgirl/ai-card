import { z } from 'zod';
import { isEnglishVocabulary, validVocabularyCards } from '../vocabulary-generation.ts';
import { parseMaterial } from '../material-parser.ts';
import { createGenerationBody, generatedCards, materialGeneratedCards, generationInput, geminiFailure, requestGemini } from '../gemini.ts';
import { readGenerationRecord, reserveGeneration, beginGenerationAttempt, recordGenerationAttempt, finishGeneration, generationHash, GenerationError,
  type GenerationPolicy, type TokenUsage, type GenerationRecord } from './generation-usage.ts';
import type { StudyDatabase } from './study-service.ts';
import { MOCK_MODEL } from './generation-settings.ts';

const providerPayload = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({ finishReason: z.string().optional(), content: z.object({ parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })) }).optional() })).optional(),
  usageMetadata: z.object({ promptTokenCount: z.number().int().nonnegative().optional(), candidatesTokenCount: z.number().int().nonnegative().optional(), thoughtsTokenCount: z.number().int().nonnegative().optional(), totalTokenCount: z.number().int().nonnegative().optional() }).optional(),
  error: z.object({ status: z.string().optional(), details: z.array(z.object({ reason: z.string().optional() })).optional() }).optional(),
});
// Bound provider response reads as well as client input. The provider fetch AbortSignal also bounds streaming reads.
async function providerJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 262144) { await reader.cancel(); throw new GenerationError('INVALID_OUTPUT', 'AI 응답이 허용 크기를 초과했습니다.', 502); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(result)) as unknown; }
  catch { return {}; }
}
export const emptyTokenUsage = (): TokenUsage => ({ input: null, output: null, thinking: null, total: null });
export function tokenUsage(data: unknown): TokenUsage {
  const parsed = providerPayload.safeParse(data);
  const usage = parsed.success ? parsed.data.usageMetadata : undefined;
  return { input: usage?.promptTokenCount ?? null, output: usage?.candidatesTokenCount ?? null, thinking: usage?.thoughtsTokenCount ?? null, total: usage?.totalTokenCount ?? null };
}
function terminalError(record: GenerationRecord) {
  if (record.state === 'reserved' || record.state === 'running') return new GenerationError('GENERATION_IN_PROGRESS', '카드를 생성하고 있습니다. 같은 요청으로 다시 확인해 주세요.', 409, record.leaseUntil);
  const model = /^(?:gemini-[a-zA-Z0-9._-]+|mock-study-v1)$/.test(record.model) ? ` 당시 모델: ${record.model}.` : '';
  const message = `${record.error || '카드를 생성하지 못했습니다.'} 이 응답은 이전 요청의 실패 기록입니다.${model} 현재 설정으로 새로 호출한 결과가 아닙니다. 새 요청 준비 버튼을 이용해 주세요.`;
  const failure = new GenerationError(record.code || 'GENERATION_FAILED', message, record.status || 502, undefined, record.diagnostic);
  failure.terminal = true;
  return failure;
}
export async function generationResult(db: StudyDatabase, uid: string, id: string, now = Date.now(), allowMock = false) {
  const { record, draft } = await readGenerationRecord(db, uid, id, now);
  if (record.model === MOCK_MODEL && !allowMock) throw new GenerationError('MOCK_DISABLED', 'Mock 결과는 로컬 Mock 모드에서만 재개할 수 있습니다. 실제 AI 생성은 새 요청으로 시작해 주세요.', 503);
  if (record.state !== 'succeeded') throw terminalError(record);
  return { ...generatedCards.parse(draft), model: String(draft!.model), requestId: id };
}
export async function generateWithBudget(options: {
  db: StudyDatabase; uid: string; id: string; key: string; model: string;
  input: z.infer<typeof generationInput>; policy: GenerationPolicy;
  signal: AbortSignal; fetcher?: typeof fetch; clock?: () => number;
}) {
  const { db, uid, id, input, policy, key, model, signal } = options;
  const clock = options.clock || Date.now;
  // Conservative admission units: serialized input bytes + system/schema allowance + output cap.
  // These are a service admission budget, not a promise about billable provider tokens/dollars.
  const budget = new TextEncoder().encode(JSON.stringify(createGenerationBody(input, policy.maxOutputTokens))).byteLength + policy.maxOutputTokens + 2048;
  const { claimed } = await reserveGeneration(db, uid, id, generationHash(input), model, budget, policy, clock());
  if (!claimed) return generationResult(db, uid, id, clock());
  let attempt = 0;
  let recorded = false;
  let payload: unknown = {};
  try {
    signal.throwIfAborted();
    const response = await requestGemini({ key, model, input, signal, maxOutputTokens: policy.maxOutputTokens,
      beforeAttempt: async () => {
        signal.throwIfAborted();
        attempt = await beginGenerationAttempt(db, uid, id, policy, clock());
        recorded = false;
      },
      onResponse: async response => {
        payload = await providerJson(response);
        await recordGenerationAttempt(db, uid, id, attempt, response.status, tokenUsage(payload), clock());
        recorded = true;
      },
    }, options.fetcher);
    const parsed = providerPayload.safeParse(payload);
    if (!response.ok) {
      const failure = geminiFailure(response.status, payload);
      throw new GenerationError(failure.code, failure.error, failure.status, undefined, failure.diagnostic);
    }
    if (!parsed.success) throw new GenerationError('INVALID_OUTPUT', 'AI 응답 형식이 올바르지 않습니다.', 502);
    const candidate = parsed.data.candidates?.[0];
    if (parsed.data.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(candidate?.finishReason || '')) throw new GenerationError('CONTENT_BLOCKED', '이 자료로는 카드를 생성할 수 없습니다. 학습 내용을 수정해 주세요.', 422);
    if (candidate?.finishReason !== 'STOP') throw new GenerationError('INVALID_OUTPUT', 'AI 응답이 완성되지 않았습니다. 수량이나 자료를 줄여 주세요.', 422);
    const text = candidate.content?.parts.filter(part => !part.thought).map(part => part.text || '').join('');
    let cards: unknown;
    try { cards = JSON.parse(text || '{}'); } catch { throw new GenerationError('INVALID_OUTPUT', 'AI 응답을 읽지 못했습니다.', 502); }
    const result = (input.mode==='material'?materialGeneratedCards:generatedCards).safeParse(cards);
    if (!result.success || result.data.cards.length > input.count) throw new GenerationError('INVALID_OUTPUT', input.mode==='material'?'AI 카드 추출 결과가 올바르지 않습니다. 덱 이름·질문·답변·카테고리·태그·난이도 또는 카드 수를 확인해 주세요.':'학습 주제를 파악하지 못했습니다. 주제와 참고 자료를 확인해 주세요.', 422);
    if(isEnglishVocabulary(input)&&!validVocabularyCards(result.data.cards))throw new GenerationError('VOCABULARY_FORMAT_INVALID','영어 단어·한국어 뜻 형식이 아닌 응답을 받았습니다. 결과는 저장하지 않았습니다. 새 요청으로 다시 생성해 주세요.',422);
    if(input.mode==='material'){
      const expected=parseMaterial(input.text).cards.length;
      if(expected&&result.data.cards.length!==expected)throw new GenerationError('MATERIAL_QUESTION_MISMATCH',`원문은 ${expected}개 문항인데 AI가 ${result.data.cards.length}개 카드로 반환했습니다. 문제를 합치거나 누락한 결과는 적용하지 않습니다. 자료를 나누어 새 요청으로 추출해 주세요.`,422);
    }
    const normalized=result.data.cards.map(card=>card.question.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,''));
    if(new Set(normalized).size!==normalized.length)throw new GenerationError('DUPLICATE_CARDS','AI가 중복된 질문을 생성했습니다. 자료나 주제를 구체적으로 바꿔 주세요.',422);
    await finishGeneration(db, uid, id, policy, { result: { cards: result.data.cards, model, ...('title' in result.data&&result.data.title?{title:result.data.title}:{}) } }, clock());
    return generationResult(db, uid, id, clock());
  } catch (cause) {
    if (attempt && !recorded) {
      // A sent/possibly-sent attempt with no metadata stays visibly unknown in cost metrics.
      await recordGenerationAttempt(db, uid, id, attempt, 0, emptyTokenUsage(), clock()).catch(() => {});
    }
    const failure = cause instanceof GenerationError ? cause
      : cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)
        ? new GenerationError('TIMEOUT', 'AI 응답 시간이 초과되었습니다. 호출을 시작한 요청은 생성 1회가 차감됩니다.', 504)
        : new GenerationError('GENERATION_UNAVAILABLE', '생성을 완료하지 못했습니다. 같은 요청으로 결과를 다시 확인해 주세요.', 503);
    // If this fails, the durable lease recovery charges the uncertain attempt; no in-memory bypass.
    await finishGeneration(db, uid, id, policy, { code: failure.code, error: failure.message, status: failure.status,
      ...(failure.diagnostic ? { diagnostic: failure.diagnostic } : {}) }, clock());
    failure.terminal = true;
    throw failure;
  }
}
