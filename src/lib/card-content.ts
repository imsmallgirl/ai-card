import { z } from 'zod';
import { STUDY_CATEGORIES } from './categories.ts';
export const cardMetadata = z.object({
  explanation: z.string().trim().max(4000).optional(),
  category: z.enum(STUDY_CATEGORIES).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  difficulty: z.enum(['초급', '중급', '고급']).nullable().optional(),
});
export type CardMetadata = z.infer<typeof cardMetadata>;
export const cardContent = cardMetadata.extend({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(2000),
});
export type CardContent = z.infer<typeof cardContent>;
export function metadataOf(value: CardMetadata): CardMetadata {
  return cardMetadata.parse(value);
}

export function sameCardContent(left:unknown,right:unknown):boolean {
  const a=cardContent.safeParse(left);const b=cardContent.safeParse(right);
  if(!a.success||!b.success)return false;
  const normalize=(value:CardContent)=>({question:value.question,answer:value.answer,explanation:value.explanation||'',category:value.category||null,difficulty:value.difficulty||null,tags:value.tags||[]});
  return JSON.stringify(normalize(a.data))===JSON.stringify(normalize(b.data));
}
