import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupDeletedAccount } from '../src/lib/deleted-account-cleanup.ts';
import { clearAccountStorage } from '../src/lib/account-storage.ts';
import { createCloudStudyStore } from '../src/lib/study-cloud-store.ts';
import { emptyCloudSnapshot } from '../src/lib/study-cloud-model.ts';

test('confirmed deletion stops writes and clears only the deleted UID even if sign-out fails', async () => {
  const events = [];
  const values = new Map([['moa-study-cloud-v2-own', 'private'], ['moa-study-user-other', 'keep']]);
  const result = await cleanupDeletedAccount({
    stopSession: () => events.push('stop'),
    signOut: async () => { events.push('signOut'); throw new Error('offline'); },
    clearStorage: () => { events.push('clear'); clearAccountStorage({ getItem: key => values.get(key) || null, removeItem: key => values.delete(key) }, 'own'); },
  });
  assert.deepEqual(events, ['stop', 'clear', 'signOut']);
  assert.deepEqual(result, { signedOut: false, storageCleared: true });
  assert.deepEqual([...values], [['moa-study-user-other', 'keep']]);
});

test('storage errors do not skip other keys or lose legacy ownership; cleanup can be retried', async () => {
  let fail = true;
  const values = new Map([['moa-study-user-own', 'private'], ['moa-study-cloud-v2-own', 'cache'], ['moa-study-legacy-owner', 'own'], ['moa-study-v1', 'legacy'], ['moa-study-user-other', 'keep']]);
  const storage = {
    getItem: key => values.get(key) || null,
    removeItem: key => {
      if (fail && ['moa-study-user-own', 'moa-study-v1'].includes(key)) throw new Error('blocked');
      values.delete(key);
    },
  };
  let signOuts = 0;
  const deps = { stopSession: () => {}, signOut: async () => { signOuts++; }, clearStorage: () => clearAccountStorage(storage, 'own') };
  assert.deepEqual(await cleanupDeletedAccount(deps), { signedOut: false, storageCleared: false });
  assert.equal(signOuts, 0, 'keep the stopped UI available for retry until storage cleanup succeeds');
  assert.equal(values.has('moa-study-cloud-v2-own'), false);
  assert.equal(values.get('moa-study-legacy-owner'), 'own');
  fail = false;
  assert.deepEqual(await cleanupDeletedAccount(deps), { signedOut: true, storageCleared: true });
  assert.deepEqual([...values], [['moa-study-user-other', 'keep']]);
});

test('a late sync response cannot recreate the deleted cache after failed sign-out', async () => {
  const values = new Map([['moa-study-cloud-v2-own', JSON.stringify({snapshot: emptyCloudSnapshot(), pending: []})]]);
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  let respond;
  const response = new Promise(resolve => { respond = resolve; });
  const session = createCloudStudyStore('own', storage, () => response);
  const syncing = session.sync();
  const result = await cleanupDeletedAccount({stopSession: session.stop, clearStorage: () => clearAccountStorage(storage, 'own'), signOut: async () => { throw new Error('offline'); }});
  respond({revision: 0}); await syncing;
  assert.equal(result.storageCleared, true);
  assert.equal(values.has('moa-study-cloud-v2-own'), false);
  await assert.rejects(session.store.getState().addDeck({id: 'blocked', title: 'blocked', category: '기타', color: 'purple', cards: []}), /계정이 변경/);
});
