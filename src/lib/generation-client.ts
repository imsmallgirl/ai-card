import { z } from 'zod';
import { generatedCards, generationInput } from './gemini.ts';
import { generationUsage, type GenerationUsage } from './generation-model.ts';
import { geminiDiagnostic, type GeminiDiagnostic } from './gemini-errors.ts';

export class GenerationClientError extends Error {
  status: number; code: string; usage?: GenerationUsage; diagnostic?: GeminiDiagnostic; terminal: boolean;
  constructor(message: string, status: number, code: string, usage?: GenerationUsage, diagnostic?: GeminiDiagnostic, terminal = false) { super(message); this.status = status; this.code = code; this.usage = usage; this.diagnostic = diagnostic; this.terminal = terminal; }
}
export const generationClientResult = generatedCards.extend({ model: z.string(), requestId: z.uuid(), usage: generationUsage.optional() });
export type ClientGenerationResult = z.infer<typeof generationClientResult>;
export const regenerationTarget=z.object({deckId:z.string(),cardId:z.string().optional(),index:z.number().int().nonnegative(),revision:z.number().int().nonnegative().optional(),originalQuestion:z.string().max(500).optional(),originalAnswer:z.string().max(2000).optional()});
export type PendingGeneration = { id: string; input: z.infer<typeof generationInput>; result?: ClientGenerationResult; target?:z.infer<typeof regenerationTarget>; saving?:boolean };
const pendingSchema = z.object({ id: z.uuid(), input: generationInput, target:regenerationTarget.optional(), saving:z.boolean().optional(), result: generationClientResult.optional() });
export const pendingGenerationKey = (uid: string) => `moa-generation-pending-${uid}`;
export function readPendingGeneration(storage: Pick<Storage, 'getItem'>, uid: string): PendingGeneration | null {
  const raw = storage.getItem(pendingGenerationKey(uid));
  return raw ? pendingSchema.parse(JSON.parse(raw)) : null;
}
export async function generationFetch(
  getToken: (refresh: boolean) => Promise<string>, path: string, signal: AbortSignal,
  pending?: PendingGeneration, fetcher: typeof fetch = fetch,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const token = await getToken(attempt > 0);
    signal.throwIfAborted();
    const response = await fetcher(path, {
      method: pending ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(pending ? { 'Content-Type': 'application/json', 'Idempotency-Key': pending.id } : {}) },
      ...(pending ? { body: JSON.stringify(pending.input) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]), cache: 'no-store',
    });
    if (response.status === 401 && attempt === 0) continue;
    const body: unknown = await response.json();
    signal.throwIfAborted();
    const parsed = z.object({ error: z.string().optional(), code: z.string().optional(), usage: generationUsage.optional(), diagnostic: geminiDiagnostic.optional(), terminal: z.boolean().optional() }).safeParse(body);
    if (!response.ok) throw new GenerationClientError(parsed.success ? parsed.data.error || 'AI 요청을 처리하지 못했습니다.' : 'AI 응답을 확인하지 못했습니다.', response.status,
      parsed.success ? parsed.data.code || 'UNKNOWN' : 'UNKNOWN', parsed.success ? parsed.data.usage : undefined, parsed.success ? parsed.data.diagnostic : undefined, parsed.success ? parsed.data.terminal : false);
    return body;
  }
}
