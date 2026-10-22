import test from 'node:test';
import assert from 'node:assert/strict';
import { usedCategories, deckProgress } from '../src/lib/study-presentation.ts';
const deck = (category, cards=[]) => ({ category, cards });
test('filters show used categories and retain an active empty category so users can clear it', () => {
  assert.deepEqual(usedCategories([], '전체'), ['전체']);
  const result=usedCategories([deck('과학'),deck('과학')], '외국어');
  assert.equal(result.filter(value=>value==='과학').length,1);
  assert.ok(result.includes('외국어'));
  assert.equal(result.includes('디자인'),false);
});
test('learning experience is distinct from due status and handles empty decks', () => {
  assert.deepEqual(deckProgress(deck('과학')), {learned:0,percent:0});
  assert.deepEqual(deckProgress(deck('과학',[{completedAt:1,interval:0,due:0},{interval:2,due:0},{interval:0,due:0} ])),{learned:2,percent:67});
});
