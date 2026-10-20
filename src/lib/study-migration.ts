const legacySampleIds = new Set(['english', 'biology', 'design', 'history']);

// Old built-in decks used fixed IDs and created=0; generated decks use UUIDs.
export function removeLegacySampleDecks<T extends { id: string; created: number }>(decks: T[]): T[] {
  return decks.filter(deck => !(deck.created === 0 && legacySampleIds.has(deck.id)));
}
