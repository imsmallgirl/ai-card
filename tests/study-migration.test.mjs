import test from 'node:test';
import assert from 'node:assert/strict';
import { removeLegacySampleDecks } from '../src/lib/study-migration.ts';

test('removes only the legacy built-in samples', () => {
  const userDeck = { id: 'user-created-uuid', created: 1730000000000, title: '내 학습 덱' };
  const decks = ['english', 'biology', 'design', 'history'].map(id => ({ id, created: 0 }));
  assert.deepEqual(removeLegacySampleDecks([...decks, userDeck]), [userDeck]);
});

test('preserves user data even when names or creation timestamps overlap', () => {
  const decks = [{ id: 'english', created: 100 }, { id: 'custom', created: 0 }];
  assert.deepEqual(removeLegacySampleDecks(decks), decks);
  assert.equal(removeLegacySampleDecks(decks)[0], decks[0]);
});

test('supports an empty initial collection without inserting samples', () => {
  assert.deepEqual(removeLegacySampleDecks([]), []);
});
