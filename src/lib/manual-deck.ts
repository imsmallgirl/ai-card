import { z } from 'zod';
import { STUDY_CATEGORIES } from './categories.ts';
import type { Deck, StudyState } from './store.ts';

export const manualDeckInput = z.object({
  title: z.string().trim().min(1, '덱 이름을 입력해 주세요.').max(80),
  category: z.enum(STUDY_CATEGORIES),
  cards: z.array(z.object({
    question: z.string().trim().min(1, '모든 카드에 질문을 입력해 주세요.').max(500),
    answer: z.string().trim().min(1, '모든 카드에 답을 입력해 주세요.').max(2000),
  })).min(1).max(20),
});

export function createManualDeck(input: unknown, color: Deck['color']): Deck {
  const parsed = manualDeckInput.parse(input);
  return { ...parsed, id: `manual-${crypto.randomUUID()}`, color, created: Date.now(),
    cards: parsed.cards.map(card => ({ ...card, due: 0, interval: 0 })) };
}

// Retrying with the same immutable deck uses the existing store's ID/outbox deduplication.
export async function saveManualDeck(deck: Deck, store: Pick<StudyState, 'addDeck' | 'confirmDeck'>) {
  await store.addDeck(deck);
  await store.confirmDeck?.(deck.id);
}
