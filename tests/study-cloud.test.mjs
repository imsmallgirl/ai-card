import { createManualDeck, manualDeckInput, saveManualDeck } from '../src/lib/manual-deck.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStudyCommand, StudyError } from '../src/lib/server/study-service.ts';
import { createStudyHandler, readStudyBody } from '../src/lib/server/study-http.ts';
import { AuthenticationError } from '../src/lib/server-auth.ts';
import { createCloudStudyStore } from '../src/lib/study-cloud-store.ts';
import { CloudRequestError, createCloudTransport, pullCloudSnapshot, cloudStorageKey } from '../src/lib/study-cloud-client.ts';
import { emptyCloudSnapshot, reviewDate } from '../src/lib/study-cloud-model.ts';
import { combineStudyStores } from '../src/lib/study-combined-store.ts';
import { createStudyStore } from '../src/lib/store.ts';

const create = () => ({ type: 'createDeck', mutationId: crypto.randomUUID(), deck: { id: 'deck', title: '영어', category: '외국어', color: 'purple' }, cards: [{ id: 'card', question: 'Q', answer: 'A' }] });
function memoryDatabase() {
  let documents = new Map();
  let tail = Promise.resolve();
  return {
    get: path => structuredClone(documents.get(path)),
    transaction(run) {
      const task = tail.then(async () => {
        const staged = structuredClone(documents);
        const result = await run({ get: async path => structuredClone(staged.get(path)), set: (path, data) => staged.set(path, structuredClone(data)) });
        documents = staged;
        return result;
      });
      tail = task.catch(() => {});
      return task;
    },
    async revision() { return documents.get('meta/sync')?.revision || 0; },
    async page(collection, since, target, cursor) {
      let items = [...documents.entries()].filter(([key, value]) => key.startsWith(collection + '/') && value.updatedRevision > since && value.updatedRevision <= target)
        .map(([, value]) => structuredClone(value)).sort((a, b) => a.updatedRevision - b.updatedRevision || a.id.localeCompare(b.id));
      if (cursor) items = items.filter(item => item.updatedRevision > cursor[0] || item.updatedRevision === cursor[0] && item.id.localeCompare(cursor[1]) > 0);
      items = items.slice(0, 50);
      const last = items.at(-1);
      return { items, cursor: items.length === 50 ? [last.updatedRevision, last.id] : null };
    },
  };
}
function storage() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data };
}
function transport(db, fail = () => false) {
  return async (query = '', command) => {
    if (fail()) throw new Error('offline');
    if (command) {
      try { return await applyStudyCommand(db, command, Date.UTC(2026, 9, 21)); }
      catch (error) { if (error instanceof StudyError) throw new CloudRequestError(error.message, error.status); throw error; }
    }
    if (!query) return { revision: await db.revision() };
    const params = new URLSearchParams(query);
    return db.page(params.get('collection'), Number(params.get('since')), Number(params.get('target')), params.has('cursor') ? JSON.parse(params.get('cursor')) : undefined);
  };
}
const rate = (revision = 1) => ({ type: 'rate', mutationId: crypto.randomUUID(), cardId: 'card', deckId: 'deck', expectedRevision: revision, correct: true });

test('atomic deck/card creation, defaults and identical request replay', async () => {
  const db = memoryDatabase();
  const command = create();
  assert.deepEqual(await applyStudyCommand(db, command, 100), { revision: 1 });
  assert.deepEqual(await applyStudyCommand(db, command, 200), { revision: 1 });
  assert.equal(db.get('decks/deck').created, 100);
  assert.equal(db.get('cards/card').revision, 1);
  assert.equal(db.get('settings/profile').dailyGoal, 20);
  await assert.rejects(applyStudyCommand(db, { ...command, deck: { ...command.deck, title: 'changed' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(await db.revision(), 1);
});

test('concurrent ratings from two devices commit exactly one event and aggregate', async () => {
  const db = memoryDatabase();
  await applyStudyCommand(db, create());
  const a = rate(), b = rate();
  const results = await Promise.allSettled([applyStudyCommand(db, a, 0), applyStudyCommand(db, b, 0)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal(db.get('stats/summary').totalReviews, 1);
  assert.equal(db.get('dailyStats/1970-01-01').count, 1);
  assert.equal(db.get('cards/card').due, 86400000);
  await applyStudyCommand(db, a, 500);
  assert.equal(db.get('stats/summary').totalReviews, 1);
  assert.equal(await db.revision(), 2);
});

test('bad references and deleted decks cannot append reviews; tombstone retains source cards', async () => {
  const db = memoryDatabase();
  await applyStudyCommand(db, create());
  await assert.rejects(applyStudyCommand(db, { ...rate(), cardId: 'missing' }), { code: 'NOT_FOUND' });
  await applyStudyCommand(db, { type: 'deleteDeck', mutationId: crypto.randomUUID(), deckId: 'deck', expectedRevision: 1 });
  await assert.rejects(applyStudyCommand(db, rate()), { code: 'NOT_FOUND' });
  assert.ok(db.get('cards/card'));
  assert.equal(db.get('stats/summary'), undefined);
  assert.equal(db.get('decks/deck').deleted, true);
});

test('two cloud devices pull incremental data and daily aggregates without event scans', async () => {
  const db = memoryDatabase();
  const a = createCloudStudyStore('a', storage(), transport(db));
  const b = createCloudStudyStore('a', storage(), transport(db));
  await a.store.getState().addDeck({ ...create().deck, cards: [{ question: 'Q', answer: 'A' }], created: 1 });
  await a.sync(); await b.sync();
  assert.equal(b.store.getState().decks.length, 1);
  const card = b.store.getState().decks[0].cards[0];
  assert.ok(card.id);
  await b.store.getState().rate('deck', 0, true, card);
  await b.sync(); await a.sync();
  assert.equal(a.store.getState().decks[0].cards[0].interval, 1);
  assert.equal(a.store.getState().reviews.reduce((sum, r) => sum + (r.count ?? 1), 0), 1);
  a.stop(); b.stop();
});

test('offline durable outbox survives reload, isolates UID and retries response loss once', async () => {
  const db = memoryDatabase();
  const disk = storage();
  let offline = true;
  const a = createCloudStudyStore('a', disk, transport(db, () => offline));
  await a.store.getState().addDeck({ ...create().deck, cards: [{ question: 'Q', answer: 'A' }], created: 1 });
  await a.sync();
  assert.equal(a.store.getState().sync.pending, 1);
  assert.equal(a.store.getState().decks.length, 1);
  a.stop();
  const other = createCloudStudyStore('b', disk, transport(memoryDatabase()));
  assert.equal(other.store.getState().decks.length, 0);
  assert.equal(other.store.getState().sync.pending, 0);
  offline = false;
  let dropResponse = true;
  const base = transport(db);
  const restored = createCloudStudyStore('a', disk, async (query, command) => {
    const result = await base(query, command);
    if (command && dropResponse) { dropResponse = false; throw new Error('lost response'); }
    return result;
  });
  await restored.sync();
  assert.equal(restored.store.getState().sync.pending, 1);
  await restored.sync();
  assert.equal(restored.store.getState().sync.pending, 0);
  assert.equal(await db.revision(), 1);
  assert.equal(restored.store.getState().decks.length, 1);
  assert.ok(disk.getItem(cloudStorageKey('a')));
  restored.stop(); other.stop();
});

test('failed page leaves watermark/cache untouched; pagination follows all pages', async () => {
  const current = emptyCloudSnapshot();
  let calls = 0;
  await assert.rejects(pullCloudSnapshot(async query => {
    if (!query) return { revision: 4 };
    if (++calls === 2) throw new Error('offline');
    return { items: [], cursor: null };
  }, current));
  assert.equal(current.revision, 0);
  assert.deepEqual(current.decks, []);
  let pages = 0;
  const snapshot = await pullCloudSnapshot(async query => {
    if (!query) return { revision: 1 };
    if (new URLSearchParams(query).get('collection') === 'decks') {
      pages++;
      return { items: [], cursor: pages === 1 ? [1, 'last'] : null };
    }
    return { items: [], cursor: null };
  }, current);
  assert.equal(pages, 2); assert.equal(snapshot.revision, 1);
});

test('account teardown ignores late responses and cannot write another account cache', async () => {
  const db = memoryDatabase(); await applyStudyCommand(db, create());
  const disk = storage();
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  const base = transport(db);
  const a = createCloudStudyStore('a', disk, async (...args) => { await paused; return base(...args); });
  const running = a.sync(); a.stop(); release(); await running;
  assert.equal(disk.getItem(cloudStorageKey('a')), null);
  assert.equal(disk.getItem(cloudStorageKey('b')), null);
});

test('storage quota failure preserves old disk and rejects new work rather than reporting saved', async () => {
  const db = memoryDatabase(); const disk = storage();
  const store = createCloudStudyStore('a', { ...disk, setItem() { throw new Error('quota'); } }, transport(db));
  await assert.rejects(store.store.getState().addDeck({ ...create().deck, created: 0, cards: [{ question: 'Q', answer: 'A' }] }), /quota/);
  assert.equal(store.store.getState().sync.pending, 0);
  assert.equal(disk.getItem(cloudStorageKey('a')), null);
});

test('server API rejects unauthenticated access and scopes both reads/writes to token UID', async () => {
  const databases = new Map([['a', memoryDatabase()], ['b', memoryDatabase()]]);
  const handler = createStudyHandler({ enabled: () => true, authenticate: async request => {
    const uid = request.headers.get('authorization');
    if (!databases.has(uid)) throw new AuthenticationError('로그인 필요');
    return { uid };
  }, repository: uid => databases.get(uid) });
  assert.equal((await handler(new Request('https://test/api/study'))).status, 401);
  const body = { ...create(), uid: 'b' };
  const saved = await handler(new Request('https://test/api/study', { method: 'POST', headers: { authorization: 'a', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal(saved.status, 200); assert.equal(saved.headers.get('cache-control'), 'no-store');
  assert.equal(await databases.get('b').revision(), 0);
  const read = await handler(new Request('https://test/api/study?uid=a', { headers: { authorization: 'b' } }));
  assert.deepEqual(await read.json(), { revision: 0 });
  const forbidden = await handler(new Request('https://test/api/study?collection=mutations&since=0&target=10', { headers: { authorization: 'a' } }));
  assert.equal(forbidden.status, 400);
});

test('bounded streaming request body, schema and auth refresh have enforced limits', async () => {
  await assert.rejects(readStudyBody(new Request('https://test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'a'.repeat(65537) })), { status: 413 });
  let attempts = 0; const refreshed = [];
  const client = createCloudTransport(async refresh => { refreshed.push(refresh); return 'token'; }, new AbortController().signal, async () => {
    attempts++; return Response.json({ error: 'expired' }, { status: 401 });
  });
  await assert.rejects(client(), { status: 401 });
  assert.equal(attempts, 2); assert.deepEqual(refreshed, [false, true]);
  assert.equal(reviewDate(Date.UTC(2026, 9, 20, 23, 0), 'Asia/Seoul'), '2026-10-21');
});

test('legacy records and malformed data cannot be silently treated as new cloud accounts', async () => {
  const { hasLocalStudyRecords } = await import('../src/lib/study-storage.ts');
  const disk = storage();
  assert.equal(hasLocalStudyRecords(disk, 'a'), false);
  const raw = JSON.stringify({ state: { decks: [{ id: 'legacy' }], reviews: [] }, version: 1 });
  disk.setItem('moa-study-user-a', raw);
  assert.equal(hasLocalStudyRecords(disk, 'a'), true);
  assert.equal(disk.getItem('moa-study-user-a'), raw);
  disk.setItem('moa-study-user-a', '{broken');
  assert.throws(() => hasLocalStudyRecords(disk, 'a'), /손상/);
  assert.equal(disk.getItem('moa-study-user-a'), '{broken');
});

test('conflicting queued rating stays durable until explicitly discarded', async () => {
  const db = memoryDatabase(); await applyStudyCommand(db, create());
  const disk = storage(); const client = createCloudStudyStore('a', disk, transport(db));
  await client.sync();
  await applyStudyCommand(db, rate());
  await client.store.getState().rate('deck', 0, false, client.store.getState().decks[0].cards[0]);
  await client.sync();
  assert.equal(client.store.getState().sync.pending, 1);
  assert.match(client.store.getState().sync.error, /다른 기기/);
  assert.equal(db.get('stats/summary').totalReviews, 1);
  assert.ok(client.store.getState().discardPending);
  client.store.getState().discardPending(); await client.sync();
  assert.equal(client.store.getState().sync.pending, 0);
  assert.equal(client.store.getState().decks[0].cards[0].interval, 1);
  client.stop();
});

test('stopped sessions cannot discard a durable conflict after writer ownership is released', async () => {
  const db = memoryDatabase(); await applyStudyCommand(db, create());
  const disk = storage(), client = createCloudStudyStore('a', disk, transport(db));
  await client.sync(); await applyStudyCommand(db, rate());
  await client.store.getState().rate('deck', 0, false, client.store.getState().decks[0].cards[0]);
  await client.sync();
  const discard = client.store.getState().discardPending;
  assert.ok(discard);
  client.stop();
  const before = disk.getItem(cloudStorageKey('a'));
  discard();
  assert.equal(disk.getItem(cloudStorageKey('a')), before);
});

test('retrying a deterministic generated deck ID does not enqueue duplicate card creation', async () => {
  const db = memoryDatabase(); const disk = storage();
  const client = createCloudStudyStore('a', disk, transport(db, () => true));
  const deck = { ...create().deck, created: 1, cards: [{ question: 'Q', answer: 'A' }] };
  await client.store.getState().addDeck(deck); await client.sync();
  await client.store.getState().addDeck(deck);
  assert.equal(client.store.getState().sync.pending, 1);
  client.stop();
});

test('generated deck confirmation reports offline failure, retains queued data, and survives reload without duplicate writes', async () => {
  const db = memoryDatabase(); const disk = storage(); let offline = true;
  const deck = { ...create().deck, id: `ai-${crypto.randomUUID()}`, created: 1, cards: [{ question: 'AI question', answer: 'AI answer' }] };
  const client = createCloudStudyStore('a', disk, transport(db, () => offline));
  await client.store.getState().addDeck(deck);
  await assert.rejects(client.store.getState().confirmDeck(deck.id), /offline/);
  assert.equal(client.store.getState().sync.pending, 1);
  assert.equal(db.get(`decks/${deck.id}`), undefined);
  client.stop(); offline = false;
  const restored = createCloudStudyStore('a', disk, transport(db));
  await restored.store.getState().addDeck(deck);
  await restored.store.getState().confirmDeck(deck.id);
  assert.equal(restored.store.getState().sync.pending, 0);
  assert.equal(db.get(`cards/${deck.id}-0`).question, 'AI question');
  assert.equal(await db.revision(), 1);
  const secondDevice = createCloudStudyStore('a', storage(), transport(db));
  await secondDevice.store.getState().addDeck(deck);
  await secondDevice.store.getState().confirmDeck(deck.id);
  assert.equal(await db.revision(), 1);
  const reload = createCloudStudyStore('a', storage(), transport(db));
  await reload.sync();
  assert.equal(reload.store.getState().decks[0].cards[0].answer, 'AI answer');
  restored.stop(); secondDevice.stop(); reload.stop();
});

test('owner card edits are durable, idempotent and conflict checked; deleting the deck removes it from dashboard', async () => {
  const db = memoryDatabase(); const client = createCloudStudyStore('a', storage(), transport(db));
  await client.store.getState().addDeck({ ...create().deck, created: 1, cards: [{ question: 'Q', answer: 'A' }] });
  await client.store.getState().confirmDeck('deck');
  const card = client.store.getState().decks[0].cards[0];
  const command = { type: 'updateCard', mutationId: crypto.randomUUID(), cardId: card.id, deckId: 'deck', expectedRevision: 1, question: 'Updated Q', answer: 'Updated A' };
  await applyStudyCommand(db, command); await applyStudyCommand(db, command);
  assert.equal(db.get(`cards/${card.id}`).revision, 2);
  assert.equal(db.get('stats/summary'), undefined);
  await assert.rejects(applyStudyCommand(db, { ...command, mutationId: crypto.randomUUID() }), { code: 'REVISION_CONFLICT' });
  await client.sync();
  await client.store.getState().updateCard('deck', 0, 'Final Q', 'Final A');
  client.stop();
  const reload = createCloudStudyStore('a', storage(), transport(db));
  await reload.sync();
  assert.equal(reload.store.getState().decks[0].cards[0].question, 'Final Q');
  await assert.rejects(reload.store.getState().updateCard('deck', 0, '', 'A'));
  await reload.store.getState().removeDeck('deck'); await reload.sync();
  assert.equal(reload.store.getState().decks.length, 0);
  assert.equal(db.get('decks/deck').deleted, true);
  await assert.rejects(applyStudyCommand(db, { ...command, expectedRevision: 3, mutationId: crypto.randomUUID() }), { code: 'NOT_FOUND' });
  reload.stop();
});

test('legacy records remain usable while new AI decks go to cloud, with account isolation and reload', async () => {
  const disk = storage(); const local = createStudyStore('a', disk); const db = memoryDatabase();
  const legacy = { ...create().deck, id: 'old', created: 1, cards: [{ question: 'old Q', answer: 'old A', due: 0, interval: 0 }] };
  local.getState().addDeck(legacy);
  const cloud = createCloudStudyStore('a', disk, transport(db));
  const combined = combineStudyStores(local, cloud.store);
  const fresh = { ...legacy, id: `ai-${crypto.randomUUID()}` };
  await combined.store.getState().addDeck(fresh); await combined.store.getState().confirmDeck(fresh.id);
  assert.equal(combined.store.getState().decks.length, 2);
  assert.equal(combined.store.getState().decks.find(deck => deck.id === 'old').storage, 'local');
  await combined.store.getState().rate('old', 0, true);
  await combined.store.getState().updateCard('old', 0, 'local edit', 'A');
  assert.equal(local.getState().decks[0].cards[0].interval, 0); // Content edits reset schedule; history remains.
  assert.equal(local.getState().decks[0].cards[0].question, 'local edit');
  assert.equal(db.get('decks/old'), undefined);
  assert.equal(local.getState().decks.length, 1);
  combined.stop(); cloud.stop();
  const beforeStop = disk.getItem('moa-study-user-a');
  assert.throws(() => combined.store.getState().removeDeck('old'), /계정이 변경/);
  assert.equal(disk.getItem('moa-study-user-a'), beforeStop);
  const reloadLocal = createStudyStore('a', disk);
  const reloadCloud = createCloudStudyStore('a', disk, transport(db));
  const reload = combineStudyStores(reloadLocal, reloadCloud.store);
  await reloadCloud.sync(); assert.equal(reload.store.getState().decks.length, 2);
  assert.equal(createStudyStore('b', disk).getState().decks.length, 0);
  await reload.store.getState().removeDeck('old');
  assert.equal(reload.store.getState().decks.length, 1);
  reload.stop(); reloadCloud.stop();
});

test('forged body UID cannot modify or delete another user cards through authenticated API', async () => {
  const alice = memoryDatabase(); const bob = memoryDatabase();
  await applyStudyCommand(alice, create());
  const handler = createStudyHandler({ enabled: () => true, authenticate: async () => ({ uid: 'bob' }), repository: uid => uid === 'bob' ? bob : alice });
  for (const command of [
    { type: 'updateCard', cardId: 'card', deckId: 'deck', expectedRevision: 1, question: 'attack', answer: 'attack' },
    { type: 'deleteDeck', deckId: 'deck', expectedRevision: 1 },
  ]) {
    const response = await handler(new Request('https://test/api/study?uid=alice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...command, uid: 'alice', mutationId: crypto.randomUUID() }) }));
    assert.equal(response.status, 404);
  }
  assert.equal(alice.get('cards/card').question, 'Q'); assert.equal(alice.get('decks/deck').deleted, false);
});


test('manual deck validates and trims all inputs with existing card limits', () => {
  const input = { title: ' 직접 만든 덱 ', category: '과학', cards: [{ question: ' 질문 ', answer: ' 답 ' }] };
  const deck = createManualDeck(input, 'green');
  assert.match(deck.id, /^manual-/); assert.equal(deck.title, '직접 만든 덱');
  assert.deepEqual(deck.cards[0], { question: '질문', answer: '답', due: 0, interval: 0 });
  for (const change of [{ title: '  ' }, { cards: [] }, { cards: Array(21).fill(input.cards[0]) },
    { cards: [{ question: '  ', answer: '답' }] }, { cards: [{ question: '질문', answer: '  ' }] },
    { cards: [{ question: 'q'.repeat(501), answer: '답' }] }, { cards: [{ question: '질문', answer: 'a'.repeat(2001) }] }]) {
    assert.equal(manualDeckInput.safeParse({ ...input, ...change }).success, false);
  }
  assert.equal(manualDeckInput.safeParse({ ...input, cards: Array(20).fill(input.cards[0]) }).success, true);
});

test('manual save retries the same queued deck, reloads and remains editable without AI services', async () => {
  const db = memoryDatabase(); const disk = storage(); let offline = true;
  const deck = createManualDeck({ title: '직접 만든 과학', category: '과학', cards: [
    { question: '물의 화학식?', answer: 'H2O' }, { question: '산소의 기호?', answer: 'O' },
  ] }, 'green');
  const session = createCloudStudyStore('manual-user', disk, transport(db, () => offline));
  await assert.rejects(saveManualDeck(deck, session.store.getState()), /offline/);
  await assert.rejects(saveManualDeck(deck, session.store.getState()), /offline/);
  assert.equal(session.store.getState().sync.pending, 1);
  offline = false;
  await saveManualDeck(deck, session.store.getState());
  await saveManualDeck(deck, session.store.getState());
  assert.equal(await db.revision(), 1);
  assert.equal(session.store.getState().decks.length, 1);
  session.stop();
  const reload = createCloudStudyStore('manual-user', storage(), transport(db)); await reload.sync();
  assert.equal(reload.store.getState().decks[0].cards.length, 2);
  assert.equal(reload.store.getState().decks[0].cards[0].answer, 'H2O');
  await reload.store.getState().updateCard(deck.id, 0, '물의 분자식?', 'H₂O');
  assert.equal(reload.store.getState().decks[0].cards[0].answer, 'H₂O');
  reload.stop();
});

test('Phase3 legacy migration resumes after interruption without duplicating cards or historical counts', async () => {
  const { importLegacyState } = await import('../src/lib/legacy-import.ts');
  const db=memoryDatabase();const base=transport(db);let writes=0;
  const source={decks:[{id:'old-source',title:'기존 자료',category:'과학',color:'green',created:123,cards:Array.from({length:7},(_,i)=>({question:`Q${i}`,answer:`A${i}`,due:1000+i,interval:i}))}],reviews:[{date:'2026-10-20',correct:true,count:3},{date:'2026-10-20',correct:false,count:2}]};
  const original=structuredClone(source);
  await assert.rejects(importLegacyState(source,async(query,command)=>{if(command&&++writes===2)throw new Error('offline');return base(query,command);}),/offline/);
  await importLegacyState(source,base);const revision=await db.revision();await importLegacyState(source,base);assert.equal(await db.revision(),revision);
  assert.deepEqual(source,original);
  const client=createCloudStudyStore('migrated',storage(),base);await client.sync();
  const decks=client.store.getState().decks;
  assert.equal(decks.length,1);assert.equal(decks[0].cards.length,7);assert.equal(decks[0].created,123);
  assert.deepEqual(decks[0].cards.map(card=>[card.question,card.answer,card.due,card.interval]),source.decks[0].cards.map(card=>[card.question,card.answer,card.due,card.interval]));
  assert.equal(db.get('dailyStats/2026-10-20').count,5);assert.equal(db.get('stats/summary').correct,3);
  const changed=structuredClone(source);changed.decks[0].cards[0].answer='changed';
  await assert.rejects(importLegacyState(changed,base),/다른 내용/);
  client.stop();
});

test('Phase3 validates the whole migration before writes, including invalid historical days', async()=>{
  const {importLegacyState}=await import('../src/lib/legacy-import.ts');let calls=0;
  await assert.rejects(importLegacyState({decks:[{...create().deck,created:1,cards:[{question:'Q',answer:'A',due:0,interval:0}]}],reviews:[{date:'invalid',correct:true}]},async()=>{calls++;}));
  assert.equal(calls,0);
});

test('Phase3 card management, tombstones, favorites, ordering, review history and settings survive reload',async()=>{
  const db=memoryDatabase();const session=createCloudStudyStore('manager',storage(),transport(db));
  await session.store.getState().addDeck({...create().deck,created:0,cards:[{question:'Q',answer:'A',due:0,interval:0}]});await session.store.getState().confirmDeck('deck');
  const api=()=>session.store.getState();
  await api().manageCard('deck',{type:'add',question:'new Q',answer:'new A'});
  await api().manageCard('deck',{type:'favorite',index:1,favorite:true});
  await api().manageCard('deck',{type:'move',index:1,direction:-1});
  assert.equal(api().decks[0].cards[0].question,'new Q');assert.equal(api().decks[0].cards[0].favorite,true);
  await api().rate('deck',0,'again');await session.sync();
  assert.equal(api().decks[0].cards[0].lastWrong,true);assert.equal(api().decks[0].cards[0].wrongCount,1);
  await api().rate('deck',0,'easy');await session.sync();
  assert.equal(api().decks[0].cards[0].interval,3);assert.equal(api().decks[0].cards[0].lastWrong,false);
  await api().updateCard('deck',0,'edited Q','edited A');
  assert.equal(api().decks[0].cards[0].due,0);assert.equal(api().decks[0].cards[0].reviewCount,2);
  await api().manageCard('deck',{type:'delete',index:1});
  assert.equal(api().decks[0].cards.length,1);
  await assert.rejects(api().manageCard('deck',{type:'delete',index:0}),/최소 한 장/);
  // Explicitly discard the rejected last-card operation before further settings edits.
  api().discardPending();await session.sync();
  await api().updateSettings(35,'America/New_York');
  const reload=createCloudStudyStore('manager',storage(),transport(db));await reload.sync();
  assert.equal(reload.store.getState().dailyGoal,35);assert.equal(reload.store.getState().timeZone,'America/New_York');
  assert.equal(reload.store.getState().decks[0].cards.length,1);assert.equal(db.get('stats/summary').totalReviews,2);
  session.stop();reload.stop();
});


test('content editor uses the original revision and refuses to overwrite a newer review or edit',async()=>{
  const db=memoryDatabase();const session=createCloudStudyStore('a',storage(),transport(db));
  await session.store.getState().addDeck({...create().deck,created:1,cards:[{question:'Q',answer:'A',due:0,interval:0}]});await session.store.getState().confirmDeck('deck');
  const original={...session.store.getState().decks[0].cards[0]};
  await session.store.getState().rate('deck',0,'remember');await session.sync();
  await assert.rejects(session.store.getState().updateCard('deck',0,'stale Q','stale A',original),/다른 기기/);
  assert.equal(db.get(`cards/${original.id}`).question,'Q');session.stop();
});

test('migration progressively replaces legacy views without counting imported reviews twice',async()=>{
  const {importLegacyState}=await import('../src/lib/legacy-import.ts');
  const disk=storage();const local=createStudyStore('a',disk);const db=memoryDatabase();
  local.getState().addDeck({...create().deck,id:'local-source',created:1,cards:[{question:'Q',answer:'A',due:0,interval:0,favorite:true}]});
  await local.getState().rate('local-source',0,false);
  const snapshot={decks:structuredClone(local.getState().decks),reviews:structuredClone(local.getState().reviews)};
  const remote=createCloudStudyStore('a',disk,transport(db));const combined=combineStudyStores(local,remote.store);
  await importLegacyState(snapshot,transport(db));await remote.sync();
  assert.equal(combined.store.getState().decks.length,1);
  assert.equal(combined.store.getState().decks[0].cards[0].favorite,true);
  assert.equal(combined.store.getState().reviews.reduce((sum,row)=>sum+(row.count??1),0),1);
  await remote.store.getState().rate(remote.store.getState().decks[0].id,0,'remember');await remote.sync();
  assert.equal(combined.store.getState().reviews.reduce((sum,row)=>sum+(row.count??1),0),2);
  assert.equal(local.getState().decks.length,1);combined.stop();remote.stop();
});

test('material cards retain explanations and editable metadata through offline retry, reload, editing and deletion',async()=>{
  const {parseMaterial}=await import('../src/lib/material-parser.ts');
  const {createMaterialDeck,saveMaterialDeck}=await import('../src/lib/material-deck.ts');
  const db=memoryDatabase();let offline=true;const disk=storage();
  const cards=parseMaterial('Q: React란?\nA: UI 라이브러리입니다.\n-> 재사용성이 핵심입니다.\nQ: HTTP란?\nA: 통신 프로토콜입니다.').cards;
  const deck=createMaterialDeck({title:'자료 덱',category:'프로그래밍·IT',cards},'blue');
  const session=createCloudStudyStore('source-user',disk,transport(db,()=>offline));
  await assert.rejects(saveMaterialDeck(deck,session.store.getState()),/offline/);
  await assert.rejects(saveMaterialDeck(deck,session.store.getState()),/offline/);
  assert.equal(session.store.getState().sync.pending,1);offline=false;
  await saveMaterialDeck(deck,session.store.getState());await saveMaterialDeck(deck,session.store.getState());assert.equal(await db.revision(),1);session.stop();
  const reload=createCloudStudyStore('source-user',storage(),transport(db));await reload.sync();
  const card=reload.store.getState().decks[0].cards[0];assert.equal(card.explanation,'재사용성이 핵심입니다.');assert.ok(card.tags.includes('React'));
  await reload.store.getState().updateCard(deck.id,0,card.question,card.answer,card,{explanation:'수정한 해설',tags:['사용자 태그'],difficulty:'고급',category:'과학'});
  assert.equal(reload.store.getState().decks[0].cards[0].difficulty,'고급');
  const current=reload.store.getState().decks[0].cards[0];
  await reload.store.getState().updateCard(deck.id,0,current.question,current.answer,current,{difficulty:null,category:null,explanation:'',tags:[]});
  assert.equal(reload.store.getState().decks[0].cards[0].difficulty,null);assert.equal(reload.store.getState().decks[0].cards[0].explanation,'');
  await reload.store.getState().manageCard(deck.id,{type:'delete',index:1});assert.equal(reload.store.getState().decks[0].cards.length,1);
  await reload.store.getState().removeDeck(deck.id);await reload.sync();assert.equal(reload.store.getState().decks.length,0);reload.stop();
});

test('metadata-only card corrections retain learned schedule; explanation changes reset it',async()=>{
  const db=memoryDatabase();const session=createCloudStudyStore('metadata',storage(),transport(db));
  await session.store.getState().addDeck({...create().deck,created:1,cards:[{question:'Q',answer:'A',due:0,interval:0}]});await session.store.getState().confirmDeck('deck');
  await session.store.getState().rate('deck',0,'remember');await session.sync();
  const card=session.store.getState().decks[0].cards[0];
  await session.store.getState().updateCard('deck',0,card.question,card.answer,card,{tags:['태그'],category:'과학',difficulty:'중급'});
  const classified=session.store.getState().decks[0].cards[0];assert.equal(classified.due,card.due);assert.equal(classified.interval,1);
  await session.store.getState().updateCard('deck',0,card.question,card.answer,classified,{explanation:'새 해설'});
  assert.equal(session.store.getState().decks[0].cards[0].due,0);assert.equal(session.store.getState().decks[0].cards[0].reviewCount,1);session.stop();
});

test('neutral completion updates persisted progress and daily activity without recording a memory rating',async()=>{
  const db=memoryDatabase();await applyStudyCommand(db,create());
  const command={type:'completeCard',mutationId:crypto.randomUUID(),deckId:'deck',cardId:'card',expectedRevision:1};
  const now=Date.UTC(2026,9,21);
  await applyStudyCommand(db,command,now);
  await applyStudyCommand(db,command,now+1000);
  const card=db.get('cards/card');const event=db.get(`reviewEvents/${command.mutationId}`);
  assert.equal(card.completedAt,now);assert.equal(card.studyCount,1);assert.equal(card.interval,0);
  assert.equal(card.lastRating,undefined);assert.equal(card.wrongCount,undefined);
  assert.equal(event.type,'completed');assert.equal(event.correct,undefined);assert.equal(event.rating,undefined);
  const day=db.get('dailyStats/2026-10-21');assert.equal(day.count,1);assert.equal(day.completed,1);assert.equal(day.correct,0);
  assert.equal(db.get('stats/summary').totalReviews,1);
  const session=createCloudStudyStore('neutral',storage(),transport(db));await session.sync();
  const view=session.store.getState();assert.equal(view.decks[0].cards[0].completedAt,now);
  assert.equal(view.reviews.reduce((sum,item)=>sum+(item.count??1),0),1);
  assert.equal(view.reviews.filter(item=>item.correct===false).reduce((sum,item)=>sum+(item.count??1),0),0);
  session.stop();
});

test('completion survives lost response, reload, retry and duplicate submission with exactly one event',async()=>{
  const db=memoryDatabase();await applyStudyCommand(db,create());const disk=storage();let lose=true;
  const normal=transport(db);
  const flaky=async(query,command)=>{const result=await normal(query,command);if(command?.type==='completeCard'&&lose){lose=false;throw new Error('lost response');}return result;};
  const first=createCloudStudyStore('completion-retry',disk,flaky);await first.sync();
  const original=structuredClone(first.store.getState().decks[0].cards[0]);const id=crypto.randomUUID();
  await assert.rejects(first.store.getState().completeCard('deck',0,id,original),/lost response/);
  assert.equal(db.get('stats/summary').totalReviews,1);first.stop();
  const resumed=createCloudStudyStore('completion-retry',disk,normal);await resumed.sync();
  await resumed.store.getState().completeCard('deck',0,id,original);
  assert.equal(resumed.store.getState().sync.pending,0);
  assert.equal(resumed.store.getState().decks[0].cards[0].studyCount,1);
  assert.equal(db.get('stats/summary').totalReviews,1);resumed.stop();
});

test('local completion is idempotent, reloads and resets progress only when card content changes',async()=>{
  const disk=storage();const local=createStudyStore('completion-local',disk);
  await local.getState().addDeck({id:'local',title:'덱',category:'과학',color:'purple',created:1,cards:[{question:'Q',answer:'A',due:0,interval:0}]});
  const id=crypto.randomUUID();await local.getState().completeCard('local',0,id);await local.getState().completeCard('local',0,id);
  assert.equal(local.getState().reviews.length,1);assert.equal(local.getState().reviews[0].correct,undefined);
  const restored=createStudyStore('completion-local',disk);assert.equal(restored.getState().decks[0].cards[0].studyCount,1);
  assert.ok(restored.getState().decks[0].cards[0].completedAt>0);
  await restored.getState().updateCard('local',0,'Q','A',undefined,{category:'과학'});
  assert.ok(restored.getState().decks[0].cards[0].completedAt>0);
  await restored.getState().updateCard('local',0,'new Q','A');assert.equal(restored.getState().decks[0].cards[0].completedAt,undefined);
});

test('neutral activity contributes to goals and streaks, survives migration, and is not treated as an incorrect answer',async()=>{
  const {studyInsights}=await import('../src/lib/study-insights.ts');
  const {importLegacyState}=await import('../src/lib/legacy-import.ts');
  const db=memoryDatabase();const local=createStudyStore('neutral-import',storage());
  await local.getState().addDeck({id:'legacy-complete',title:'자료',category:'과학',color:'purple',created:1,cards:[{question:'Q',answer:'A',due:0,interval:0}]});
  await local.getState().completeCard('legacy-complete',0,crypto.randomUUID());
  const source=local.getState();const stats=studyInsights(source.decks,source.reviews,'Asia/Seoul');
  assert.equal(stats.todayCount,1);assert.equal(stats.streak,1);assert.equal(stats.success,null);
  await importLegacyState(source,transport(db));
  const remote=createCloudStudyStore('neutral-import',storage(),transport(db));await remote.sync();
  const migrated=remote.store.getState();assert.equal(migrated.decks[0].cards[0].studyCount,1);
  assert.ok(migrated.decks[0].cards[0].completedAt>0);
  assert.equal(migrated.reviews.reduce((sum,item)=>sum+(item.count??1),0),1);
  assert.equal(migrated.reviews.filter(item=>item.correct===false).reduce((sum,item)=>sum+(item.count??1),0),0);
  const combined=combineStudyStores(local,remote.store);
  assert.equal(combined.store.getState().reviews.reduce((sum,item)=>sum+(item.count??1),0),1);
  combined.stop();remote.stop();
});
