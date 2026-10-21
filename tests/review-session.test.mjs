import test from 'node:test';
import assert from 'node:assert/strict';
import { collectReviewEntries, createReviewSession } from '../src/lib/review-session.ts';

const card = (question, due) => ({ question, answer: 'answer', due, interval: 1 });
const decks = [
  { id: 'a', title: '영어', cards: [card('A', 0), card('B', 9999999999999)] },
  { id: 'b', title: '수학', cards: [card('C', 0)] },
];

test('all-deck review includes all cards once, even those not due', () => {
  const session = createReviewSession(decks);
  assert.deepEqual(session.entries.map(entry => entry.card.question), ['A', 'B', 'C']);
  assert.deepEqual(session.entries.map(entry => [entry.deckId, entry.index]), [['a', 0], ['a', 1], ['b', 0]]);
  assert.equal(session.entries[2].deckTitle, '수학');
});

test('due-only filtering preserves original card indexes for rating', () => {
  const entries = collectReviewEntries(decks, true, 100);
  assert.deepEqual(entries.map(entry => [entry.deckId, entry.index]), [['a', 0], ['b', 0]]);
});

test('shuffling preserves all source references and does not mutate decks', () => {
  const original = structuredClone(decks);
  const session = createReviewSession(decks, { shuffle: true, quiz: true });
  assert.equal(session.quiz, true);
  assert.equal(session.entries.length, 3);
  assert.equal(new Set(session.entries.map(entry => `${entry.deckId}:${entry.index}`)).size, 3);
  assert.deepEqual(decks, original);
  session.entries[0].card.interval = 100;
  assert.deepEqual(decks, original);
});

test('empty reviews cannot create an invalid zero-card session', () => {
  assert.equal(createReviewSession([]), null);
  assert.equal(createReviewSession([{ ...decks[0], cards: [card('future', 9999999999999)] }], { dueOnly: true }), null);
});

test('review selection excludes unchecked decks while retaining source indexes for ratings', () => {
  const session = createReviewSession(decks, { deckIds: ['a'], dueOnly: true, shuffle: true, quiz: true });
  assert.equal(session.quiz, true);
  assert.deepEqual(session.entries.map(entry => [entry.deckId, entry.index, entry.card.question]), [['a', 0, 'A']]);
  const all = createReviewSession(decks, { deckIds: ['b'] });
  assert.deepEqual(all.entries.map(entry => [entry.deckId, entry.index]), [['b', 0]]);
});

test('empty selection never falls back to all decks, and removed or duplicate IDs are safe', () => {
  assert.equal(createReviewSession(decks, { deckIds: [] }), null);
  assert.equal(createReviewSession(decks, { deckIds: ['removed'] }), null);
  const session = createReviewSession(decks, { deckIds: ['b', 'b', 'removed'] });
  assert.equal(session.entries.length, 1);
  assert.equal(session.entries[0].deckId, 'b');
});
