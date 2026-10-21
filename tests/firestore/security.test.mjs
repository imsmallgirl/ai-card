import { createManualDeck, saveManualDeck } from '../../src/lib/manual-deck.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { studyRepository } from '../../src/lib/server/study-firestore.ts';
import { generationDatabase } from '../../src/lib/server/firestore-database.ts';
import { generationPolicy, reserveGeneration, beginGenerationAttempt, finishGeneration, readGenerationUsage } from '../../src/lib/server/generation-usage.ts';
import { generateWithBudget } from '../../src/lib/server/generation-service.ts';
import { generationInput } from '../../src/lib/gemini.ts';
import { changeAnalyticsConsent, recordClientAnalytics, claimAnalyticsEvent } from '../../src/lib/server/analytics-service.ts';
import { ANALYTICS_POLICY_VERSION } from '../../src/lib/analytics-model.ts';
import { applyStudyCommand } from '../../src/lib/server/study-service.ts';
import { createStudyHandler } from '../../src/lib/server/study-http.ts';
import { createCloudStudyStore } from '../../src/lib/study-cloud-store.ts';
import { createCloudTransport } from '../../src/lib/study-cloud-client.ts';
import { createGenerationHandlers } from '../../src/lib/server/generation-http.ts';
import { generationClientResult } from '../../src/lib/generation-client.ts';

// Intentionally fail rather than silently skip if the explicit integration script lacks an emulator.
assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
const projectId = 'demo-moa-study';
process.env.FIREBASE_PROJECT_ID = projectId;
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const env = await initializeTestEnvironment({ projectId, firestore: {
  host, port: Number(port), rules: await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8'),
} });
const admin = initializeApp({ projectId }, 'study-integration-cleanup');
const db = getFirestore(admin);
const create = uid => ({ type: 'createDeck', mutationId: crypto.randomUUID(), deck: { id: `deck-${uid}`, title: '수학', category: '수학', color: 'blue' }, cards: [{ id: `card-${uid}`, question: '1+1?', answer: '2' }] });

test('Rules and real Firestore transactions enforce owner access, isolation, idempotency and delta pages', async t => {
  await env.clearFirestore();
  try {
    const repository = await studyRepository('alice');
    const command = create('alice');
    await applyStudyCommand(repository, command, 100);
    const owner = env.authenticatedContext('alice').firestore();
    const other = env.authenticatedContext('bob').firestore();
    const guest = env.unauthenticatedContext().firestore();
    for (const path of ['decks/deck-alice', 'cards/card-alice', 'settings/profile']) {
      await assertSucceeds(getDoc(doc(owner, 'users/alice/' + path)));
      await assertFails(getDoc(doc(other, 'users/alice/' + path)));
      await assertFails(getDoc(doc(guest, 'users/alice/' + path)));
      await assertFails(setDoc(doc(owner, 'users/alice/' + path), { fake: true }));
    }
    await assertSucceeds(getDocs(collection(owner, 'users/alice/cards')));
    await assertFails(getDocs(collection(other, 'users/alice/cards')));
    for (const path of ['meta/sync', 'mutations/' + command.mutationId, 'usageDaily/2026-10-21', 'unknown/value']) {
      await assertFails(getDoc(doc(owner, 'users/alice/' + path)));
      await assertFails(setDoc(doc(owner, 'users/alice/' + path), { fake: true }));
    }
    await assertFails(getDoc(doc(owner, 'serviceConfig/ai')));
    assert.equal(await (await studyRepository('bob')).revision(), 0);
    const rate = { type: 'rate', mutationId: crypto.randomUUID(), deckId: 'deck-alice', cardId: 'card-alice', expectedRevision: 1, correct: true };
    await Promise.all([applyStudyCommand(repository, rate, 1000), applyStudyCommand(repository, rate, 1000)]);
    assert.equal((await db.doc('users/alice/stats/summary').get()).data().totalReviews, 1);
    const competing = await Promise.allSettled(Array.from({ length: 2 }, () => applyStudyCommand(repository, { ...rate, expectedRevision: 2, mutationId: crypto.randomUUID() }, 2000)));
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await db.doc('users/alice/stats/summary').get()).data().totalReviews, 2);
    for (const path of ['dailyStats/1970-01-01', 'stats/summary', 'reviewEvents/' + rate.mutationId]) {
      await assertSucceeds(getDoc(doc(owner, 'users/alice/' + path)));
      await assertFails(getDoc(doc(other, 'users/alice/' + path)));
      await assertFails(setDoc(doc(owner, 'users/alice/' + path), { fake: true }));
    }
    const page = await repository.page('cards', 1, await repository.revision());
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].revision, 3);
    await t.test('50-item pagination and unchanged revision query', async () => {
      for (let i = 0; i < 3; i++) {
        const deck = create(`page-${i}`);
        deck.cards = Array.from({ length: 20 }, (_, j) => ({ id: `p-${i}-${j}`, question: 'Q', answer: 'A' }));
        await applyStudyCommand(repository, deck);
      }
      const target = await repository.revision();
      const first = await repository.page('cards', 0, target);
      assert.equal(first.items.length, 50);
      const second = await repository.page('cards', 0, target, first.cursor);
      assert.equal(second.items.length, 11);
      assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 61);
      assert.equal((await repository.page('cards', target, target)).items.length, 0);
    });
    await t.test('AI quota transactions, replay and private operational collections', async () => {
      const database = await generationDatabase();
      const policy = generationPolicy({ AI_COOLDOWN_SECONDS: '0', AI_FAILURE_COOLDOWN_SECONDS: '0' });
      const now = Date.UTC(2026, 9, 21);
      const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
      const reservations = await Promise.allSettled(ids.map(id => reserveGeneration(database, 'quota', id, 'hash', 'test-model', 100, policy, now)));
      assert.equal(reservations.filter(result => result.status === 'fulfilled').length, 1);
      const winner = ids[reservations.findIndex(result => result.status === 'fulfilled')];
      await beginGenerationAttempt(database, 'quota', winner, policy, now);
      const result = { cards: [{ question: 'Q', answer: 'A' }], model: 'test-model' };
      await finishGeneration(database, 'quota', winner, policy, { result }, now);
      let calls = 0;
      const options = { db: database, uid: 'quota', id: crypto.randomUUID(), input: generationInput.parse({ title: '영어' }), key: 'mock', model: 'test-model', policy,
        signal: new AbortController().signal, clock: () => now,
        fetcher: async () => { calls++; return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ cards: result.cards }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }); } };
      await generateWithBudget(options); await generateWithBudget(options);
      assert.equal(calls, 1);
      await generateWithBudget({ ...options, id: crypto.randomUUID() });
      await assert.rejects(generateWithBudget({ ...options, id: crypto.randomUUID() }), { code: 'DAILY_LIMIT' });
      const usage = await readGenerationUsage(database, 'quota', policy, now);
      assert.equal(usage.charged, 3); assert.equal(usage.reserved, 0);
      assert.equal((await readGenerationUsage(database, 'different-user', policy, now)).remaining, 3);
      const quotaUser = env.authenticatedContext('quota').firestore();
      for (const path of [
        'users/quota/usageDaily/2026-10-21', 'users/quota/locks/generation',
        `users/quota/generationRequests/${options.id}`, `users/quota/generationDrafts/${options.id}`,
        'serviceUsage/2026-10-21', 'serviceUsage/2026-10-21/models/test-model',
      ]) {
        await assertFails(getDoc(doc(quotaUser, path)));
        await assertFails(getDoc(doc(other, path)));
        await assertFails(setDoc(doc(quotaUser, path), { charged: 0 }));
      }
      const uidList = ['global-a','global-b','global-c','global-d'];
      const attemptIds = uidList.map(() => crypto.randomUUID());
      const attemptsSoFar = (await db.doc('serviceUsage/2026-10-21').get()).data().attempts;
      const capped = { ...policy, globalAttempts: attemptsSoFar + 2 };
      await Promise.all(uidList.map((uid, index) => reserveGeneration(database, uid, attemptIds[index], 'hash', 'test-model', 100, capped, now)));
      const admitted = await Promise.allSettled(uidList.map((uid, index) => beginGenerationAttempt(database, uid, attemptIds[index], capped, now)));
      assert.equal(admitted.filter(result => result.status === 'fulfilled').length, 2);
      assert.equal((await db.doc('serviceUsage/2026-10-21').get()).data().attempts, capped.globalAttempts);
    });
    await t.test('AI results auto-save through authenticated API, reload, edit, isolate accounts and delete', async () => {
      const uid = 'auto-save'; const id = crypto.randomUUID(); let calls = 0;
      const options = { db: await generationDatabase(), uid, id, key: 'mock', model: 'test-model',
        input: generationInput.parse({ title: '수학', category: '수학' }), policy: generationPolicy({}),
        signal: new AbortController().signal,
        fetcher: async () => { calls++; return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ cards: [{ question: '1+1?', answer: '2' }] }) }] } }] }); },
      };
      const result = await generateWithBudget(options);
      const handler = createStudyHandler({ enabled: () => true, authenticate: async request => ({ uid: request.headers.get('authorization').slice(7) }), repository: studyRepository });
      const transport = account => createCloudTransport(async () => account, new AbortController().signal, (url, init) => handler(new Request(`https://test${url}`, init)));
      const disk = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
      const deck = { id: `ai-${id}`, title: '수학', category: '수학', color: 'blue', created: 0, cards: result.cards.map(card => ({ ...card, due: 0, interval: 0 })) };
      const first = createCloudStudyStore(uid, disk(), transport(uid));
      await first.store.getState().addDeck(deck); await first.store.getState().confirmDeck(deck.id); first.stop();
      assert.equal((await db.doc(`users/${uid}/cards/${deck.id}-0`).get()).data().answer, '2');
      const reload = createCloudStudyStore(uid, disk(), transport(uid)); await reload.sync();
      assert.equal(reload.store.getState().decks[0].cards[0].answer, '2');
      const replay = await generateWithBudget(options); assert.equal(replay.cards.length, 1); assert.equal(calls, 1);
      await reload.store.getState().addDeck(deck); await reload.store.getState().confirmDeck(deck.id);
      assert.equal((await db.collection(`users/${uid}/decks`).get()).size, 1);
      assert.equal((await db.collection(`users/${uid}/cards`).get()).size, 1);
      await reload.store.getState().updateCard(deck.id, 0, '2+2?', '4');
      const other = createCloudStudyStore('not-owner', disk(), transport('not-owner')); await other.sync();
      assert.equal(other.store.getState().decks.length, 0); other.stop();
      await reload.store.getState().removeDeck(deck.id); await reload.sync();
      assert.equal(reload.store.getState().decks.length, 0); reload.stop();
      assert.equal((await db.doc(`users/${uid}/cards/${deck.id}-0`).get()).data().answer, '4');
    });
    await t.test('development Mock API needs no Gemini key, uses real Firestore saves, and survives a new session', async () => {
      const uid = 'mock-save'; const id = crypto.randomUUID(); let providerCalls = 0;
      const handler = createGenerationHandlers({ authenticate: async () => ({ uid }), database: generationDatabase,
        environment: () => ({ NODE_ENV: 'development', AI_PROVIDER: 'mock', AI_GENERATION_ENABLED: 'true' }),
        fetcher: async () => { providerCalls++; throw new Error('Mock must not call Gemini'); } });
      const response = await handler(new Request('https://test/api/generate', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': id },
        body: JSON.stringify({ title: 'Mock 저장 테스트', category: '과학', count: 3 }) }), 'generate');
      assert.equal(response.status, 200);
      const result = generationClientResult.parse(await response.json());
      assert.equal(result.cards.length, 3); assert.equal(result.model, 'mock-study-v1');
      assert.equal(providerCalls, 0); assert.equal(result.usage.charged, 0);
      const study = createStudyHandler({ enabled: () => true, authenticate: async () => ({ uid }), repository: studyRepository });
      const transport = createCloudTransport(async () => 'mock-auth-token', new AbortController().signal, (url, init) => study(new Request(`https://test${url}`, init)));
      const disk = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
      const session = createCloudStudyStore(uid, disk(), transport);
      const deck = { id: `ai-${id}`, title: 'Mock 저장 테스트', category: '과학', color: 'blue', created: 0, cards: result.cards.map(card => ({ ...card, due: 0, interval: 0 })) };
      await session.store.getState().addDeck(deck); await session.store.getState().confirmDeck(deck.id); session.stop();
      const reload = createCloudStudyStore(uid, disk(), transport); await reload.sync();
      assert.equal(reload.store.getState().decks[0].cards.length, 3);
      await reload.store.getState().updateCard(deck.id, 0, '수정한 Mock 질문', '수정한 Mock 답');
      assert.equal((await db.doc(`users/${uid}/cards/${deck.id}-0`).get()).data().answer, '수정한 Mock 답');
      assert.equal((await db.doc(`users/${uid}/generationRequests/${id}`).get()).data().attempts, 0);
      await reload.store.getState().removeDeck(deck.id); await reload.sync();
      assert.equal(reload.store.getState().decks.length, 0); reload.stop();
    });
    await t.test('manual decks persist privately, replay once and do not consume AI usage', async () => {
      const uid = 'manual-save';
      const study = createStudyHandler({ enabled: () => true, authenticate: async () => ({ uid }), repository: studyRepository });
      const transport = createCloudTransport(async () => 'mock-auth-token', new AbortController().signal,
        (url, init) => study(new Request(`https://test${url}`, init)));
      const disk = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }; };
      const deck = createManualDeck({ title: '직접 만든 덱', category: '과학', cards: [{ question: '물?', answer: 'H2O' }] }, 'green');
      const session = createCloudStudyStore(uid, disk(), transport);
      await saveManualDeck(deck, session.store.getState()); await saveManualDeck(deck, session.store.getState()); session.stop();
      const reload = createCloudStudyStore(uid, disk(), transport); await reload.sync();
      assert.equal(reload.store.getState().decks.length, 1);
      assert.equal(reload.store.getState().decks[0].cards[0].answer, 'H2O');
      assert.equal((await db.collection(`users/${uid}/cards`).get()).size, 1);
      assert.equal((await db.collection(`users/${uid}/generationRequests`).get()).size, 0);
      assert.equal((await db.collection(`users/${uid}/usageDaily`).get()).size, 0);
      await assertFails(getDoc(doc(env.authenticatedContext('someone-else').firestore(), `users/${uid}/decks/${deck.id}`)));
      await reload.store.getState().updateCard(deck.id, 0, '물의 분자식?', 'H₂O');
      assert.equal(reload.store.getState().decks[0].cards[0].answer, 'H₂O');
      await reload.store.getState().removeDeck(deck.id); await reload.sync();
      assert.equal(reload.store.getState().decks.length, 0); reload.stop();
    });
    await t.test('Phase3 migration, card management, four ratings and settings work through UID-scoped Firestore API',async()=>{
      const {importLegacyState}=await import('../../src/lib/legacy-import.ts');
      const uid='phase3-complete';
      const handler=createStudyHandler({enabled:()=>true,authenticate:async()=>({uid}),repository:studyRepository});
      const transport=createCloudTransport(async()=>'test-token',new AbortController().signal,(url,init)=>handler(new Request(`https://test${url}`,init)));
      const source={decks:[{id:'legacy',title:'기존 덱',category:'과학',color:'green',created:10,cards:[{question:'기존 Q',answer:'기존 A',due:1234,interval:7}]}],reviews:[{date:'2026-10-20',correct:true,count:4}]};
      await importLegacyState(source,transport);await importLegacyState(source,transport);
      const data=new Map();const session=createCloudStudyStore(uid,{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)},transport);await session.sync();
      const api=()=>session.store.getState();const deckId=api().decks[0].id;
      assert.equal(api().decks[0].cards[0].interval,7);assert.equal((await db.doc(`users/${uid}/stats/summary`).get()).data().totalReviews,4);
      await api().manageCard(deckId,{type:'add',question:'추가 Q',answer:'추가 A'});
      await api().manageCard(deckId,{type:'favorite',index:1,favorite:true});
      await api().manageCard(deckId,{type:'move',index:1,direction:-1});
      assert.equal(api().decks[0].cards[0].favorite,true);
      await api().rate(deckId,0,'hard');await session.sync();assert.equal(api().decks[0].cards[0].interval,1);
      await api().rate(deckId,0,'again');await session.sync();assert.equal(api().decks[0].cards[0].lastWrong,true);
      await api().updateCard(deckId,0,'수정 Q','수정 A');assert.equal(api().decks[0].cards[0].due,0);assert.equal(api().decks[0].cards[0].reviewCount,2);
      await api().manageCard(deckId,{type:'delete',index:1});assert.equal(api().decks[0].cards.length,1);
      await api().updateSettings(30,'America/New_York');assert.equal(api().dailyGoal,30);assert.equal(api().timeZone,'America/New_York');
      await assertFails(getDoc(doc(env.authenticatedContext('other').firestore(),`users/${uid}/cards/${api().decks[0].cards[0].id}`)));
      assert.equal((await db.collection(`users/${uid}/generationRequests`).get()).size,0);
      session.stop();
    });
    await t.test('material extraction saves all 25 cards and metadata privately without creating AI usage',async()=>{
      const {parseMaterial}=await import('../../src/lib/material-parser.ts');
      const {createMaterialDeck,saveMaterialDeck}=await import('../../src/lib/material-deck.ts');
      const uid='material-save';
      const handler=createStudyHandler({enabled:()=>true,authenticate:async()=>({uid}),repository:studyRepository});
      const transport=createCloudTransport(async()=>'test-token',new AbortController().signal,(url,init)=>handler(new Request(`https://test${url}`,init)));
      const cards=parseMaterial(Array.from({length:25},(_,index)=>`Q${index+1}: React 질문 ${index+1}?\nA${index+1}: 원본 답 ${index+1}.\n-> 원본 해설 ${index+1}.`).join('\n')).cards;
      const deck=createMaterialDeck({title:'자료 덱',category:'프로그래밍·IT',cards},'purple');
      const disk=()=>{const map=new Map();return {getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};};
      const session=createCloudStudyStore(uid,disk(),transport);await saveMaterialDeck(deck,session.store.getState());await saveMaterialDeck(deck,session.store.getState());session.stop();
      const reload=createCloudStudyStore(uid,disk(),transport);await reload.sync();
      assert.equal(reload.store.getState().decks[0].cards.length,25);
      const card=reload.store.getState().decks[0].cards[0];assert.equal(card.explanation,'원본 해설 1.');assert.ok(card.tags.includes('React'));
      await assertFails(getDoc(doc(env.authenticatedContext('other-material-user').firestore(),`users/${uid}/cards/${card.id}`)));
      await reload.store.getState().updateCard(deck.id,0,card.question,card.answer,card,{explanation:'사용자 해설',category:'과학',tags:['수정'],difficulty:'중급'});
      const updated=reload.store.getState().decks[0].cards[0];
      assert.equal(updated.explanation,'사용자 해설');assert.equal(updated.difficulty,'중급');
      await reload.store.getState().rate(deck.id,0,'remember',updated);await reload.sync();
      assert.equal(reload.store.getState().decks[0].cards[0].explanation,'사용자 해설');
      assert.equal((await db.collection(`users/${uid}/generationRequests`).get()).size,0);
      assert.equal((await db.collection(`users/${uid}/usageDaily`).get()).size,0);
      await reload.store.getState().removeDeck(deck.id);await reload.sync();assert.equal(reload.store.getState().decks.length,0);reload.stop();
    });
    await t.test('neutral completion persists progress privately, deduplicates and has no correctness fields',async()=>{
      const uid='neutral-progress';const command=create('neutral');const repository=await studyRepository(uid);
      await applyStudyCommand(repository,command);
      const finish={type:'completeCard',mutationId:crypto.randomUUID(),deckId:command.deck.id,cardId:command.cards[0].id,expectedRevision:1};
      const now=Date.now();await applyStudyCommand(repository,finish,now);await applyStudyCommand(repository,finish,now);
      const card=(await db.doc(`users/${uid}/cards/${finish.cardId}`).get()).data();
      assert.equal(card.completedAt,now);assert.equal(card.studyCount,1);assert.equal(card.lastRating,undefined);
      const event=(await db.doc(`users/${uid}/reviewEvents/${finish.mutationId}`).get()).data();
      assert.equal(event.correct,undefined);assert.equal(event.rating,undefined);
      const summary=(await db.doc(`users/${uid}/stats/summary`).get()).data();
      assert.equal(summary.totalReviews,1);assert.equal(summary.completed,1);assert.equal(summary.correct,0);
      await assertFails(getDoc(doc(env.authenticatedContext('other-progress').firestore(),`users/${uid}/cards/${finish.cardId}`)));
    });
    await t.test('account deletion locks pending writes, blocks owner reads, removes only own data, and can resume',async()=>{
      const {deleteOwnAccount}=await import('../../src/lib/server/account-delete.ts');
      const uid='delete-own';await applyStudyCommand(await studyRepository(uid),create(uid));
      await db.doc(`users/${uid}/generationDrafts/private`).set({cards:[{question:'private',answer:'private'}]});
      const otherPath='users/delete-other/cards/keep';await db.doc(otherPath).set({question:'keep'});
      let fail=true;let deleted='';
      const deps={firestore:async()=>db,deleteAuthUser:async id=>{if(fail)throw new Error('temporary');deleted=id;}};
      await assert.rejects(deleteOwnAccount(uid,deps),/temporary/);
      assert.equal((await db.collection(`users/${uid}/cards`).get()).size,0);
      assert.equal((await db.collection(`users/${uid}/generationDrafts`).get()).size,0);
      assert.equal((await db.doc(`users/${uid}/account/status`).get()).data().deleting,true);
      await assert.rejects(applyStudyCommand(await studyRepository(uid),create('resurrect')),{code:'ACCOUNT_DELETING'});
      const database=await generationDatabase();
      await assert.rejects(database.transaction(async tx=>{tx.set(`users/${uid}/generationDrafts/resurrect`,{cards:[]});}),{code:'ACCOUNT_DELETING'});
      await db.doc(`users/${uid}/cards/locked`).set({question:'locked'});
      await assertFails(getDoc(doc(env.authenticatedContext(uid).firestore(),`users/${uid}/cards/locked`)));
      fail=false;await deleteOwnAccount(uid,deps);assert.equal(deleted,uid);
      assert.equal((await db.collection(`users/${uid}/cards`).get()).size,0);
      assert.equal((await db.doc(otherPath).get()).data().question,'keep');
    });
    await t.test('analytics consent, atomic first-event dedupe and protected queues', async () => {
      const database = await generationDatabase(); const now = Date.now();
      const change = (granted, revision) => ({ granted, expectedRevision: revision, mutationId: crypto.randomUUID(), policyVersion: ANALYTICS_POLICY_VERSION });
      await changeAnalyticsConsent(database, 'metrics', change(true, 0), now);
      const command = create('metrics');
      await applyStudyCommand(await studyRepository('metrics'), command, now, true);
      await applyStudyCommand(await studyRepository('metrics'), command, now, true);
      const event = await db.doc('users/metrics/analyticsOutbox/c1-first-deck').get();
      assert.equal(event.data().name, 'first_deck_created');
      assert.equal(event.data().props.occurrence, 'first_observed');
      const queues = await db.collection('users/metrics/analyticsOutbox').where('state', '==', 'pending').orderBy('__name__').limit(5).get();
      assert.equal(queues.size, 1);
      const claims = await Promise.all([claimAnalyticsEvent(database, 'metrics', event.id, now), claimAnalyticsEvent(database, 'metrics', event.id, now)]);
      assert.equal(claims.filter(Boolean).length, 1);
      await recordClientAnalytics(database, 'metrics', { action: 'local_review_completed', id: crypto.randomUUID(), consentRevision: 1 }, now);
      await changeAnalyticsConsent(database, 'metrics', change(false, 0), now + 1);
      assert.equal(await claimAnalyticsEvent(database, 'metrics', 'c1-first-review', now + 2), null);
      const user = env.authenticatedContext('metrics').firestore();
      for (const path of ['consent/analytics','growth/state','analyticsOutbox/c1-first-deck']) {
        await assertFails(getDoc(doc(user, 'users/metrics/' + path)));
        await assertFails(getDoc(doc(other, 'users/metrics/' + path)));
        await assertFails(setDoc(doc(user, 'users/metrics/' + path), { granted: true }));
      }
      assert.equal((await db.doc('users/metrics/consent/analytics').get()).data().granted, false);
      assert.equal((await db.doc('users/metrics/analyticsOutbox/c1-first-review').get()).data().state, 'cancelled');
    });
  } finally {
    await env.clearFirestore(); await env.cleanup(); await deleteApp(admin);
    // Repository creates a named Admin app; close it so Node's test runner can terminate cleanly.
    const { getApps } = await import('firebase-admin/app');
    await Promise.all(getApps().filter(app => app.name === 'moa-study-server').map(deleteApp));
  }
});
