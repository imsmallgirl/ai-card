import { z } from 'zod';
export const generationUsage = z.object({
  unlimited: z.boolean().optional(),
  limit: z.number().int().nonnegative(), charged: z.number().int().nonnegative(), reserved: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(), resetAt: z.number(), retryAt: z.number(), maxCards: z.literal(20),
});
export type GenerationUsage = z.infer<typeof generationUsage>;
export const generationRequestId = z.uuid();
