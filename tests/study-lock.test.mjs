import test from 'node:test';
import assert from 'node:assert/strict';
import * as workers from 'node:worker_threads';
import { holdStudyLock } from '../src/lib/study-lock.ts';

const tick = () => new Promise(resolve => setImmediate(resolve));
const options = { skip: !workers.locks };

test('queued retries never steal a live writer; cleanup precedes the next owner', options, async () => {
  const events = [];
  const owner = new AbortController();
  const cancelled = new AbortController();
  const retry = new AbortController();
  const uid = crypto.randomUUID();
  let writers = 0;
  const open = name => () => {
    assert.equal(++writers, 1, 'only one writer can own the account');
    events.push(`open:${name}`);
    return () => { writers--; events.push(`close:${name}`); };
  };
  const first = holdStudyLock(workers.locks, uid, owner.signal, open('owner'));
  await tick();
  const second = holdStudyLock(workers.locks, uid, cancelled.signal, open('cancelled'));
  const rejection = assert.rejects(second, { name: 'AbortError' });
  await tick();
  cancelled.abort();
  await rejection;
  const third = holdStudyLock(workers.locks, uid, retry.signal, open('retry'));
  await tick();
  assert.deepEqual(events, ['open:owner']);
  owner.abort();
  assert.deepEqual(events, ['open:owner', 'close:owner']);
  await first;
  await tick();
  assert.deepEqual(events, ['open:owner', 'close:owner', 'open:retry']);
  retry.abort();
  await third;
  assert.equal(writers, 0);
  assert.equal(events.filter(e => e === 'close:owner').length, 1);
});

test('account locks are independent and an aborted request never opens storage', options, async () => {
  const a = new AbortController(), b = new AbortController(), cancelled = new AbortController();
  const opened = [];
  cancelled.abort();
  await assert.rejects(holdStudyLock(workers.locks, crypto.randomUUID(), cancelled.signal, () => {
    assert.fail('cancelled request opened storage');
  }), { name: 'AbortError' });
  const first = holdStudyLock(workers.locks, crypto.randomUUID(), a.signal, () => { opened.push('a'); return () => {}; });
  const second = holdStudyLock(workers.locks, crypto.randomUUID(), b.signal, () => { opened.push('b'); return () => {}; });
  await tick();
  assert.deepEqual(opened.sort(), ['a', 'b']);
  a.abort(); b.abort();
  await Promise.all([first, second]);
});

test('failed session initialization releases its lock for a fresh attempt', options, async () => {
  const uid = crypto.randomUUID(), controller = new AbortController();
  await assert.rejects(holdStudyLock(workers.locks, uid, controller.signal, () => { throw new Error('bad cache'); }), /bad cache/);
  let opened = false;
  const retry = holdStudyLock(workers.locks, uid, controller.signal, () => { opened = true; return () => {}; });
  await tick();
  assert.equal(opened, true);
  controller.abort(); await retry;
});
