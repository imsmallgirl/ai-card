import { z } from 'zod';
import { cardContent,cardMetadata } from './card-content.ts';
import { scheduleRating } from './review-schedule.ts';
import { STUDY_CATEGORIES } from './categories.ts';

export const cloudId = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const cloudCard = cardContent.extend({
  id: cloudId, deckId: cloudId, question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(2000), due: integer, interval: integer,
  revision: integer, order: integer, updatedRevision: integer,
  deleted: z.boolean().optional(), favorite: z.boolean().optional(),
  completedAt:integer.optional(), studyCount:integer.optional(),
  reviewCount: integer.optional(), wrongCount: integer.optional(), lastWrong: z.boolean().optional(), lastRating: z.enum(['again','hard','remember','easy']).optional(),
});
export const cloudDeck = z.object({
  legacyOriginalId:z.string().max(512).optional(),
  purpose:z.enum(['개념 암기','면접 준비','시험 대비','심화 이해']).optional(), difficulty:z.enum(['초급','중급','고급']).optional(),
  id: cloudId, title: z.string().trim().min(1).max(80), category: z.enum(STUDY_CATEGORIES),
  color: z.enum(['purple', 'green', 'orange', 'blue']), created: integer,
  revision: integer, deleted: z.boolean(), importing:z.boolean().optional(), updatedRevision: integer,
});
export const cloudDay = z.object({
  id: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: integer, correct: integer, completed:integer.optional(), importedCompleted:integer.optional(), importedCount:integer.optional(), importedCorrect:integer.optional(), updatedRevision: integer,
}).refine(day => day.correct+(day.completed||0) <= day.count);
export const cloudSettings = z.object({
  id: z.literal('profile'), dailyGoal: z.number().int().min(1).max(1000),
  timeZone: z.string().max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
  }), revision: integer, updatedRevision: integer,
});
export const cloudCollections = ['decks', 'cards', 'dailyStats', 'settings'] as const;
export const cloudCollection = z.enum(cloudCollections);
export type CloudCollection = z.infer<typeof cloudCollection>;
export type CloudCard = z.infer<typeof cloudCard>;
export type CloudDeck = z.infer<typeof cloudDeck>;
export type CloudDay = z.infer<typeof cloudDay>;
export type CloudSettings = z.infer<typeof cloudSettings>;
export type CloudSnapshot = {
  revision: number; decks: CloudDeck[]; cards: CloudCard[]; dailyStats: CloudDay[]; settings: CloudSettings[];
};
export const emptyCloudSnapshot = (): CloudSnapshot => ({ revision: 0, decks: [], cards: [], dailyStats: [], settings: [] });
export const cloudSnapshot = z.object({
  revision: integer, decks: z.array(cloudDeck), cards: z.array(cloudCard),
  dailyStats: z.array(cloudDay), settings: z.array(cloudSettings),
});
const newCard = cardContent.extend({id:cloudId});
export const cloudCommand = z.discriminatedUnion('type', [
  z.object({type:z.literal('finishImport'),mutationId:z.uuid(),deckId:cloudId,source:z.string().regex(/^[a-f0-9]{64}$/),cardCount:integer}),
  z.object({ type: z.literal('importDeck'), mutationId: z.uuid(), source: z.string().regex(/^[a-f0-9]{64}$/), deck: cloudDeck.pick({ id:true,title:true,category:true,color:true,created:true,purpose:true,difficulty:true,legacyOriginalId:true }), cards: z.array(newCard.extend({ due:integer, interval:integer, order:integer, favorite:cloudCard.shape.favorite, completedAt:cloudCard.shape.completedAt,studyCount:cloudCard.shape.studyCount, reviewCount:cloudCard.shape.reviewCount,wrongCount:cloudCard.shape.wrongCount,lastWrong:cloudCard.shape.lastWrong,lastRating:cloudCard.shape.lastRating })).min(1).max(20) }),
  z.object({ type: z.literal('importDay'), mutationId:z.uuid(), source:z.string().regex(/^[a-f0-9]{64}$/), day:z.object({id:cloudDay.shape.id,count:integer,correct:integer,completed:integer.optional()}).refine(day=>day.correct+(day.completed||0)<=day.count) }),
  z.object({ type:z.literal('settings'), mutationId:z.uuid(), expectedRevision:integer, dailyGoal:cloudSettings.shape.dailyGoal, timeZone:cloudSettings.shape.timeZone }),
  z.object({ type:z.literal('addCard'), mutationId:z.uuid(), deckId:cloudId, expectedRevision:integer, card:newCard }),
  z.object({ type:z.literal('deleteCard'), mutationId:z.uuid(), deckId:cloudId, cardId:cloudId, expectedRevision:integer }),
  z.object({ type:z.literal('favorite'), mutationId:z.uuid(), deckId:cloudId, cardId:cloudId, expectedRevision:integer, favorite:z.boolean() }),
  z.object({ type:z.literal('reorder'), mutationId:z.uuid(), deckId:cloudId, expectedRevision:integer, cardIds:z.array(cloudId).min(1).max(2000) }),

  z.object({ type: z.literal('createDeck'), mutationId: z.uuid(), deck: cloudDeck.pick({ id: true, title: true, category: true, color: true, purpose:true, difficulty:true }), cards: z.array(newCard).min(1).max(200) }),
  z.object({ type: z.literal('deleteDeck'), mutationId: z.uuid(), deckId: cloudId, expectedRevision: integer }),
  z.object({type:z.literal('completeCard'),mutationId:z.uuid(),cardId:cloudId,deckId:cloudId,expectedRevision:integer}),
  z.object({ type: z.literal('rate'), mutationId: z.uuid(), cardId: cloudId, deckId: cloudId, expectedRevision: integer, correct: z.boolean(), rating: z.enum(['again','hard','remember','easy']).optional() }),
  z.object({ type: z.literal('updateCard'), mutationId: z.uuid(), cardId: cloudId, deckId: cloudId, expectedRevision: integer, question: newCard.shape.question, answer: newCard.shape.answer, ...cardMetadata.shape }),
]);
export type CloudCommand = z.infer<typeof cloudCommand>;
export const cloudPage = z.object({
  items: z.array(z.unknown()).max(50), cursor: z.tuple([integer, cloudId]).nullable(),
});
export function parseCloudItems(collection: CloudCollection, items: unknown[]) {
  const schema = { decks: cloudDeck, cards: cloudCard, dailyStats: cloudDay, settings: cloudSettings }[collection];
  return items.map(item => schema.parse(item));
}
export function reviewDate(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function scheduleReview(interval: number, correct: boolean, now: number) {
  return scheduleRating(interval, correct, now);
}
