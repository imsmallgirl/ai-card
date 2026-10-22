import type { Deck } from './store.ts';
import { STUDY_CATEGORIES } from './categories.ts';

export function usedCategories(decks: Deck[], selected: string) {
  return ['전체', ...STUDY_CATEGORIES.filter(category => category === selected || decks.some(deck => deck.category === category))];
}
export function deckProgress(deck: Deck) {
  const learned = deck.cards.filter(card => (card.completedAt || 0) > 0 || card.interval > 0).length;
  return { learned, percent: deck.cards.length ? Math.round(learned / deck.cards.length * 100) : 0 };
}
