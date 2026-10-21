import { recordDomainAnalytics } from './analytics-service.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { generationRequestId, type GenerationUsage } from '../generation-model.ts';
import { generationInput } from '../gemini.ts';
import { geminiDiagnostic, type GeminiDiagnostic } from '../gemini-errors.ts';
import { StudyError, type StudyDatabase, type StudyTransaction } from './study-service.ts';

export type GenerationPolicy = {
  unlimited?: boolean; dailyLimit: number; globalAttempts: number; globalTokenBudget: number;
  maxOutputTokens: number; cooldownMs: number; failureCooldownMs: number;
};
export function generationPolicy(env: Record<string, string | undefined> = process.env): GenerationPolicy {
  const integer = (name: string, fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).parse(env[name] ?? fallback);
  // Local testing bypass; production always retains the configured limits.
  const unlimited = env.NODE_ENV === 'development' && env.AI_GENERATION_UNLIMITED === 'true' && !env.VERCEL && !env.K_SERVICE && env.NETLIFY !== 'true';
  return {
    unlimited,
    dailyLimit: integer('AI_DAILY_LIMIT', 3, 0, 1000),
    globalAttempts: integer('AI_GLOBAL_DAILY_ATTEMPTS', 100, 0, 1000000),
    globalTokenBudget: integer('AI_GLOBAL_DAILY_TOKEN_BUDGET', 2000000, 0, 1000000000),
    maxOutputTokens: integer('AI_MAX_OUTPUT_TOKENS', 8192, 256, 16384),
    cooldownMs: unlimited ? 0 : integer('AI_COOLDOWN_SECONDS', 5, 0, 3600) * 1000,
    failureCooldownMs: unlimited ? 0 : integer('AI_FAILURE_COOLDOWN_SECONDS', 30, 0, 3600) * 1000,
  };
}
export class GenerationError extends StudyError {
  terminal = false;
  retryAt?: number;
  diagnostic?: GeminiDiagnostic;
  constructor(code: string, message: string, status = 409, retryAt?: number, diagnostic?: GeminiDiagnostic) { super(code, message, status); this.retryAt = retryAt; this.diagnostic = diagnostic; }
}
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const daySchema = z.object({ charged: count.default(0), reserved: count.default(0), success: count.default(0), failed: count.default(0), requests: count.default(0) }).passthrough();
const requestSchema = z.object({
  id: generationRequestId, hash: z.string(), day: z.string(), model: z.string(),
  state: z.enum(['reserved', 'running', 'succeeded', 'failed', 'unknown']),
  createdAt: count, leaseUntil: count, attempts: count, budgetPerAttempt: count,
  status: z.number().int().optional(), code: z.string().optional(), error: z.string().optional(), finishedAt: count.optional(),
  diagnostic: geminiDiagnostic.optional(),
});
export type GenerationRecord = z.infer<typeof requestSchema>;
export type TokenUsage = { input: number | null; output: number | null; thinking: number | null; total: number | null };
export type GenerationResult = { title?:string; cards: { question: string; answer: string }[]; model: string };
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const resetAt = (now: number) => Date.parse(utcDay(now) + 'T00:00:00Z') + 86400000;
function paths(uid: string) {
  if (!uid || uid.includes('/')) throw new GenerationError('UNAUTHENTICATED', '로그인이 필요합니다.', 401);
  return { root: `users/${uid}`, lock: `users/${uid}/locks/generation`, request: (id: string) => `users/${uid}/generationRequests/${generationRequestId.parse(id)}`, day: (date: string) => `users/${uid}/usageDaily/${date}` };
}
const lockSchema = z.object({ requestId: z.string().default(''), leaseUntil: count.default(0), retryAt: count.default(0) });
const readLock = async (tx: StudyTransaction, path: string) => lockSchema.parse(await tx.get(path) || {});
const globalSchema = z.object({ attempts: count.default(0), admittedTokenBudget: count.default(0) }).passthrough();
const active = (record: GenerationRecord) => record.state === 'reserved' || record.state === 'running';
const readDay = async (tx: StudyTransaction, path: string) => daySchema.parse(await tx.get(path) || {});

// Reconcile a crashed worker conservatively; never re-call its provider or refund unknown spend.
async function recover(tx: StudyTransaction, uid: string, now: number) {
  const path = paths(uid);
  const lock = await readLock(tx, path.lock);
  if (!lock?.requestId || Number(lock.leaseUntil) > now) return;
  const record = requestSchema.parse(await tx.get(path.request(String(lock.requestId))));
  if (active(record)) {
    const day = await readDay(tx, path.day(record.day));
    const globalPath = `serviceUsage/${utcDay(now)}`;
    const modelPath = `${globalPath}/models/${record.model}`;
    const global = await tx.get(globalPath) || {};
    const model = await tx.get(modelPath) || {};
    const recovered = (old: Record<string, unknown>) => ({ ...old, completedRequests: Number(old.completedRequests || 0) + 1,
      failed: Number(old.failed || 0) + Number(record.attempts === 0), unknownRequests: Number(old.unknownRequests || 0) + Number(record.attempts > 0) });
    tx.set(globalPath, recovered(global)); tx.set(modelPath, recovered(model));
    tx.set(path.day(record.day), { ...day, reserved: Math.max(0, day.reserved - 1), charged: day.charged + Number(record.attempts > 0), failed: day.failed + 1 });
    tx.set(path.request(record.id), { ...record, state: record.attempts ? 'unknown' : 'failed', status: 409,
      code: 'RESULT_UNKNOWN', error: record.attempts ? '이전 요청의 결과를 확인하지 못했습니다. 중복 호출을 막기 위해 다시 실행하지 않습니다. 생성 1회가 차감되었습니다.' : '이전 요청이 호출 전에 종료되었습니다. 사용량은 차감되지 않았습니다.', finishedAt: now });
  }
  tx.set(path.lock, { requestId: '', leaseUntil: 0, retryAt: now });
}
export async function readGenerationUsage(db: StudyDatabase, uid: string, policy: GenerationPolicy, now = Date.now()): Promise<GenerationUsage> {
  return db.transaction(async tx => {
    await recover(tx, uid, now);
    const path = paths(uid);
    const day = await readDay(tx, path.day(utcDay(now)));
    const lock = await readLock(tx, path.lock);
    return { unlimited: Boolean(policy.unlimited), limit: policy.dailyLimit, charged: day.charged, reserved: day.reserved,
      remaining: policy.unlimited ? null : Math.max(0, policy.dailyLimit - day.charged - day.reserved), resetAt: resetAt(now),
      retryAt: Math.max(Number(lock?.retryAt || 0), lock?.requestId ? Number(lock.leaseUntil) : 0), maxCards: 20 };
  });
}
export function generationHash(input: z.infer<typeof generationInput>) {
  return createHash('sha256').update(JSON.stringify(generationInput.parse(input))).digest('hex');
}
export async function reserveGeneration(db: StudyDatabase, uid: string, id: string, hash: string, model: string, budgetPerAttempt: number, policy: GenerationPolicy, now = Date.now()) {
  return db.transaction(async tx => {
    await recover(tx, uid, now);
    const path = paths(uid);
    const existing = await tx.get(path.request(id));
    if (existing) {
      const record = requestSchema.parse(existing);
      if (record.hash !== hash) throw new GenerationError('IDEMPOTENCY_CONFLICT', '같은 요청 ID로 다른 자료를 생성할 수 없습니다.');
      return { record, claimed: false };
    }
    const account = await tx.get(`${path.root}/account/status`);
    if (account?.deleting) throw new GenerationError('ACCOUNT_DELETING', '삭제 중인 계정입니다.', 403);
    const lock = await readLock(tx, path.lock);
    if (lock?.requestId && Number(lock.leaseUntil) > now) throw new GenerationError('GENERATION_IN_PROGRESS', '다른 생성 요청을 처리하고 있습니다.', 409, Number(lock.leaseUntil));
    if (!policy.unlimited && Number(lock?.retryAt || 0) > now) throw new GenerationError('COOLDOWN', '잠시 후 다시 생성해 주세요.', 429, Number(lock?.retryAt));
    const day = await readDay(tx, path.day(utcDay(now)));
    if (!policy.unlimited && day.charged + day.reserved >= policy.dailyLimit) throw new GenerationError('DAILY_LIMIT', '오늘의 무료 AI 생성 횟수를 모두 사용했습니다. 저장된 카드는 계속 복습할 수 있습니다.', 429, resetAt(now));
    const record: GenerationRecord = { id, hash, day: utcDay(now), model, state: 'reserved', createdAt: now, leaseUntil: now + 120000, attempts: 0, budgetPerAttempt };
    tx.set(path.request(id), record);
    tx.set(path.day(record.day), { ...day, reserved: day.reserved + 1, requests: day.requests + 1 });
    tx.set(path.lock, { requestId: id, leaseUntil: record.leaseUntil, retryAt: 0 });
    return { record, claimed: true };
  });
}
export async function beginGenerationAttempt(db: StudyDatabase, uid: string, id: string, policy: GenerationPolicy, now = Date.now()) {
  return db.transaction(async tx => {
    const path = paths(uid);
    const record = requestSchema.parse(await tx.get(path.request(id)));
    const lock = await readLock(tx, path.lock);
    if (!active(record) || lock?.requestId !== id || record.leaseUntil <= now || record.attempts >= 3) throw new GenerationError('REQUEST_CLOSED', '이 생성 요청은 더 이상 실행할 수 없습니다.');
    const globalPath = `serviceUsage/${utcDay(now)}`;
    const global = globalSchema.parse(await tx.get(globalPath) || {});
    const modelPath = `${globalPath}/models/${record.model}`;
    const model = await tx.get(modelPath) || {};
    if (!policy.unlimited && (Number(global.attempts || 0) >= policy.globalAttempts || Number(global.admittedTokenBudget || 0) + record.budgetPerAttempt > policy.globalTokenBudget)) {
      throw new GenerationError('GLOBAL_LIMIT', '오늘의 서비스 AI 생성 한도에 도달했습니다. 저장된 카드는 계속 복습할 수 있습니다.', 429, resetAt(now));
    }
    const attempt = record.attempts + 1;
    const daily = await readDay(tx, path.day(record.day));
    tx.set(path.day(record.day), { ...daily, providerAttempts: Number(daily.providerAttempts || 0) + 1 });
    tx.set(path.request(id), { ...record, state: 'running', attempts: attempt });
    tx.set(globalPath, { ...global, attempts: Number(global.attempts || 0) + 1, admittedTokenBudget: Number(global.admittedTokenBudget || 0) + record.budgetPerAttempt });
    tx.set(modelPath, { ...model, attempts: Number(model.attempts || 0) + 1 });
    tx.set(`${path.request(id)}/attempts/${attempt}`, { day: utcDay(now), model: record.model, startedAt: now, state: 'unknown' });
    return attempt;
  });
}
export async function recordGenerationAttempt(db: StudyDatabase, uid: string, id: string, attempt: number, status: number, usage: TokenUsage, now = Date.now()) {
  return db.transaction(async tx => {
    const path = `${paths(uid).request(id)}/attempts/${attempt}`;
    const data = await tx.get(path);
    if (!data || data.recordedAt !== undefined) return;
    const globalPath = `serviceUsage/${String(data.day)}`;
    const modelPath = `${globalPath}/models/${String(data.model)}`;
    const global = await tx.get(globalPath) || {};
    const model = await tx.get(modelPath) || {};
    const dailyPath = paths(uid).day(String(requestSchema.parse(await tx.get(paths(uid).request(id))).day));
    const daily = await readDay(tx, dailyPath);
    const metrics = (old: Record<string, unknown>) => ({ ...old, recordedAttempts: Number(old.recordedAttempts || 0) + 1,
      inputTokens: Number(old.inputTokens || 0) + (usage.input ?? 0), outputTokens: Number(old.outputTokens || 0) + (usage.output ?? 0),
      thinkingTokens: Number(old.thinkingTokens || 0) + (usage.thinking ?? 0), totalTokens: Number(old.totalTokens || 0) + (usage.total ?? 0),
      missingUsageAttempts: Number(old.missingUsageAttempts || 0) + Number(usage.total === null),
    });
    tx.set(path, { ...data, state: status >= 200 && status < 300 ? 'responded' : 'failed', providerStatus: status, usage, recordedAt: now });
    tx.set(globalPath, metrics(global)); tx.set(modelPath, metrics(model));
    tx.set(dailyPath, metrics(daily));
  });
}
export async function finishGeneration(db: StudyDatabase, uid: string, id: string, policy: GenerationPolicy,
  outcome: { result: GenerationResult } | { code: string; error: string; status: number; diagnostic?: GeminiDiagnostic }, now = Date.now()) {
  return db.transaction(async tx => {
    const path = paths(uid);
    const record = requestSchema.parse(await tx.get(path.request(id)));
    if (!active(record)) return;
    const day = await readDay(tx, path.day(record.day));
    const lock = await readLock(tx, path.lock);
    const success = 'result' in outcome;
    const globalPath = `serviceUsage/${utcDay(now)}`;
    const modelPath = `${globalPath}/models/${record.model}`;
    const global = await tx.get(globalPath) || {};
    const model = await tx.get(modelPath) || {};
    const outcomes = (old: Record<string, unknown>) => ({ ...old, completedRequests: Number(old.completedRequests || 0) + 1,
      success: Number(old.success || 0) + Number(success), failed: Number(old.failed || 0) + Number(!success) });
    tx.set(globalPath, outcomes(global)); tx.set(modelPath, outcomes(model));
    tx.set(path.day(record.day), { ...day, reserved: Math.max(0, day.reserved - 1), charged: day.charged + Number(record.attempts > 0), success: day.success + Number(success), failed: day.failed + Number(!success) });
    tx.set(path.request(id), { ...record, state: success ? 'succeeded' : 'failed', finishedAt: now,
      ...(success ? { status: 200 } : outcome) });
    if (success) {
      tx.set(`${path.root}/generationDrafts/${id}`, { ...outcome.result, expiresAt: now + 7 * 86400000 });
      await recordDomainAnalytics(tx, `${path.root}/`, process.env.ANALYTICS_ENABLED === 'true', { type: 'generation', id, count: outcome.result.cards.length }, now);
    }
    if (lock?.requestId === id) tx.set(path.lock, { requestId: '', leaseUntil: 0, retryAt: now + (success ? policy.cooldownMs : policy.failureCooldownMs) });
  });
}
export async function readGenerationRecord(db: StudyDatabase, uid: string, id: string, now = Date.now()) {
  return db.transaction(async tx => {
    await recover(tx, uid, now);
    const path = paths(uid);
    const data = await tx.get(path.request(id));
    if (!data) throw new GenerationError('NOT_FOUND', '생성 요청을 찾을 수 없습니다.', 404);
    const record = requestSchema.parse(data);
    const draft = record.state === 'succeeded' ? await tx.get(`${path.root}/generationDrafts/${id}`) : undefined;
    if (record.state === 'succeeded' && (!draft || Number(draft.expiresAt) <= now)) throw new GenerationError('RESULT_EXPIRED', '생성 결과의 보관 기간이 지났습니다. 같은 요청은 다시 실행되지 않습니다.', 410);
    return { record, draft };
  });
}
