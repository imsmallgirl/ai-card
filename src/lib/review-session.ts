import type { Card, Deck } from './store';

export type ReviewEntry = { deckId: string; deckTitle: string; index: number; card: Card };
export type ReviewSession = { title: string; entries: ReviewEntry[]; position: number; correct: number; quiz: boolean };

export function collectReviewEntries(decks: Deck[], dueOnly = false, now = Date.now()): ReviewEntry[] {
  return decks.flatMap(deck => deck.cards.flatMap((card, index) =>
    !dueOnly || card.due <= now ? [{ deckId: deck.id, deckTitle: deck.title, index, card: { ...card } }] : []));
}

export function createReviewSession(decks: Deck[], options: { dueOnly?: boolean; shuffle?: boolean; quiz?: boolean; title?: string } = {}): ReviewSession | null {
  const entries = collectReviewEntries(decks, options.dueOnly);
  if (!entries.length) return null;
  if (options.shuffle) {
    for (let i = entries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [entries[i], entries[j]] = [entries[j], entries[i]];
    }
  }
  return { title: options.title || '전체 덱 복습', entries, position: 0, correct: 0, quiz: options.quiz || false };
}
