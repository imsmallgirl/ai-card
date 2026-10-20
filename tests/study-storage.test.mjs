import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStudyStorage } from '../src/lib/study-storage.ts';
import { createStudyStore } from '../src/lib/store.ts';
import { createReviewSession } from '../src/lib/review-session.ts';

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const deck = (id) => ({ id, title: id, category: '수학', color: 'purple', created: 1, cards: [{ question: id, answer: 'answer', due: 0, interval: 0 }] });

test('legacy decks are adopted only once, without overwriting an existing account', () => {
  const storage = memoryStorage();
  storage.setItem('moa-study-v1', 'legacy');
  prepareStudyStorage(storage, 'first');
  assert.equal(storage.getItem('moa-study-user-first'), 'legacy');
  prepareStudyStorage(storage, 'second');
  assert.equal(storage.getItem('moa-study-user-second'), null);
  const existing = memoryStorage();
  existing.setItem('moa-study-v1', 'legacy');
  existing.setItem('moa-study-user-first', 'existing');
  prepareStudyStorage(existing, 'first');
  assert.equal(existing.getItem('moa-study-user-first'), 'existing');
});

test('account stores remain isolated and restore their own data', () => {
  const storage = memoryStorage();
  const a = createStudyStore('a', storage);
  const b = createStudyStore('b', storage);
  a.getState().addDeck(deck('deck-a'));
  assert.equal(b.getState().decks.length, 0);
  b.getState().addDeck(deck('deck-b'));
  assert.deepEqual(createStudyStore('a', storage).getState().decks.map(d => d.id), ['deck-a']);
  assert.deepEqual(createStudyStore('b', storage).getState().decks.map(d => d.id), ['deck-b']);
});

test('all-deck ratings update the source deck rather than the previous card deck', () => {
  const store = createStudyStore('rating', memoryStorage());
  store.getState().addDeck(deck('a'));
  store.getState().addDeck(deck('b'));
  const session = createReviewSession(store.getState().decks);
  const entry = session.entries.find(entry => entry.deckId === 'a');
  store.getState().rate(entry.deckId, entry.index, true);
  assert.equal(store.getState().decks.find(deck => deck.id === 'a').cards[0].interval, 1);
  assert.equal(store.getState().decks.find(deck => deck.id === 'b').cards[0].interval, 0);
  assert.equal(store.getState().reviews.length, 1);
});
