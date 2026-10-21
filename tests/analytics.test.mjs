import test from 'node:test';
import assert from 'node:assert/strict';
import { generationMemoryDatabase } from './helpers/generation-db.mjs';
import { ANALYTICS_POLICY_VERSION, analyticsEvent, analyticsAction, analyticsStorageKey } from '../src/lib/analytics-model.ts';
import { changeAnalyticsConsent, readAnalyticsConsent, recordClientAnalytics, recordDomainAnalytics, claimAnalyticsEvent } from '../src/lib/server/analytics-service.ts';
import { createAnalyticsHandler } from '../src/lib/server/analytics-http.ts';
import { createGa4Sender, exportAnalytics } from '../src/lib/server/analytics-export.ts';
import { createAnalyticsClient, createAnalyticsTransport } from '../src/lib/analytics-client.ts';
import { AuthenticationError } from '../src/lib/server-auth.ts';
import { applyStudyCommand } from '../src/lib/server/study-service.ts';
import { generationPolicy, reserveGeneration, beginGenerationAttempt, finishGeneration } from '../src/lib/server/generation-usage.ts';
const now = Date.now();
const change = (granted, revision = 0) => ({ granted, expectedRevision: revision, mutationId: crypto.randomUUID(), policyVersion: ANALYTICS_POLICY_VERSION });
const action = (name, revision = 1) => ({ action: name, id: crypto.randomUUID(), consentRevision: revision });
const grant = (db, uid = 'a') => changeAnalyticsConsent(db, uid, change(true), now);
function storage() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), values }; }
function scoped(db, uid) {
 return { transaction: run => db.transaction(tx => run({ get: path => tx.get(`users/${uid}/${path}`), set: (path, value) => tx.set(`users/${uid}/${path}`, value) })) };
}
const deck = () => ({ type: 'createDeck', mutationId: crypto.randomUUID(), deck: { id: 'deck', title: '비밀 제목', category: '외국어', color: 'purple' }, cards: [{ id: 'card', question: '민감한 질문', answer: '민감한 정답' }] });

test('default/no-consent and disabled hooks produce no growth or event writes', async () => {
 const db = generationMemoryDatabase();
 assert.equal((await readAnalyticsConsent(db, 'a')).granted, false);
 await db.transaction(tx => recordDomainAnalytics(tx, 'users/a/', true, { type: 'deck', id: 'id', count: 1, source: 'cloud' }, now));
 assert.equal(db.get('users/a/growth/state'), undefined);
 assert.deepEqual(await recordClientAnalytics(db, 'a', action('visit'), now), { accepted: false });
 await grant(db);
 await db.transaction(tx => recordDomainAnalytics(tx, 'users/a/', false, { type: 'generation', id: 'id', count: 1 }, now));
 assert.equal(db.get('users/a/analyticsOutbox/c1-generation-id'), undefined);
});

test('consent revision prevents stale grants; withdrawal is safe across devices and invalidates old queue', async () => {
 const db = generationMemoryDatabase(); const consent = await grant(db);
 await recordClientAnalytics(db, 'a', { ...action('local_deck_created'), count: 3 }, now);
 const denied = await changeAnalyticsConsent(db, 'a', change(false, 0), now + 1);
 assert.equal(denied.granted, false); assert.equal(denied.revision, 2);
 assert.equal(await claimAnalyticsEvent(db, 'a', 'c1-first-deck', now + 2), null);
 assert.equal(db.get('users/a/analyticsOutbox/c1-first-deck').state, 'cancelled');
 await assert.rejects(changeAnalyticsConsent(db, 'a', change(true, consent.revision), now + 3), { code: 'CONSENT_CONFLICT' });
 assert.deepEqual(await recordClientAnalytics(db, 'a', action('visit', 1), now + 4), { accepted: false });
});

test('consent mutation replay does not duplicate signups; only verified recent account creation qualifies', async () => {
 const db = generationMemoryDatabase(); const command = change(true);
 await changeAnalyticsConsent(db, 'a', command, now, now - 100);
 await changeAnalyticsConsent(db, 'a', command, now + 1, now - 100);
 assert.equal(db.get('users/a/consent/analytics').revision, 1);
 assert.equal(db.get('users/a/analyticsOutbox/c1-signup').name, 'sign_up');
 await changeAnalyticsConsent(db, 'b', change(true), now, now - 86400000);
 assert.equal(db.get('users/b/analyticsOutbox/c1-signup'), undefined);
 await assert.rejects(changeAnalyticsConsent(db, 'a', { ...command, granted: false }, now), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('cloud domain commit/replay and client retries record first actions only once without content', async () => {
 const db = generationMemoryDatabase(); await grant(db);
 const command = deck();
 await applyStudyCommand(scoped(db, 'a'), command, now, true);
 await applyStudyCommand(scoped(db, 'a'), command, now, true);
 const event = db.get('users/a/analyticsOutbox/c1-first-deck');
 assert.equal(event.props.occurrence, 'first_observed');
 assert.equal(event.props.source, 'cloud');
 assert.doesNotMatch(JSON.stringify(event), /비밀|민감|title|question|answer/);
 const rate = { type: 'rate', mutationId: crypto.randomUUID(), cardId: 'card', deckId: 'deck', expectedRevision: 1, correct: true };
 await applyStudyCommand(scoped(db, 'a'), rate, now, true);
 await applyStudyCommand(scoped(db, 'a'), rate, now, true);
 assert.equal(db.get('users/a/analyticsOutbox/c1-first-review').name, 'first_review_completed');
 await recordClientAnalytics(db, 'a', { ...action('local_deck_created'), count: 20 }, now);
 assert.equal(db.get('users/a/analyticsOutbox/c1-first-deck').props.source, 'cloud');
});

test('failed domain transactions roll back analytics markers with domain data', async () => {
 const db = generationMemoryDatabase(); await grant(db);
 await assert.rejects(db.transaction(async tx => { await recordDomainAnalytics(tx, 'users/a/', true, { type: 'deck', id: 'id', count: 1, source: 'cloud' }, now); throw new Error('rollback'); }));
 assert.equal(db.get('users/a/growth/state').firstDeckObservedAt, undefined);
 assert.equal(db.get('users/a/analyticsOutbox/c1-first-deck'), undefined);
});

test('successful AI completion creates one event at server commit, never on replay', async () => {
 const db = generationMemoryDatabase(); await grant(db);
 const previous = process.env.ANALYTICS_ENABLED; process.env.ANALYTICS_ENABLED = 'true';
 try {
  const id = crypto.randomUUID(); const policy = generationPolicy({});
  await reserveGeneration(db, 'a', id, 'hash', 'test-model', 100, policy, now);
  await beginGenerationAttempt(db, 'a', id, policy, now);
  await finishGeneration(db, 'a', id, policy, { result: { cards: [{ question: 'SECRET', answer: 'SECRET' }], model: 'test-model' } }, now);
  await finishGeneration(db, 'a', id, policy, { result: { cards: [], model: 'test-model' } }, now);
  const event = db.get(`users/a/analyticsOutbox/c1-generation-${id}`);
  assert.equal(event.name, 'ai_generation_completed'); assert.doesNotMatch(JSON.stringify(event), /SECRET/);
 } finally { if (previous === undefined) delete process.env.ANALYTICS_ENABLED; else process.env.ANALYTICS_ENABLED = previous; }
});

test('7-day return is exact local-calendar day, once, and existing account cohort is observed', async () => {
 const db = generationMemoryDatabase(); await grant(db);
 await recordClientAnalytics(db, 'a', action('visit'), now + 6 * 86400000);
 assert.equal(db.get('users/a/analyticsOutbox/c1-return-7d'), undefined);
 await Promise.all([recordClientAnalytics(db, 'a', action('visit'), now + 7 * 86400000), recordClientAnalytics(db, 'a', action('visit'), now + 7 * 86400000)]);
 assert.equal(db.get('users/a/analyticsOutbox/c1-return-7d').props.occurrence, 'observed_return');
 assert.equal(db.get('users/a/growth/state').return7Recorded, true);
});

test('client action schema rejects arbitrary content, UID, public/advertising spoof events', () => {
 for (const raw of [{ ...action('visit'), title: 'SECRET' }, { ...action('visit'), uid: 'b' }, { ...action('deck_shared') }, { ...action('ad_slot_viewed') }]) assert.equal(analyticsAction.safeParse(raw).success, false);
 const valid = { id: 'id', name: 'first_deck_created', props: { source: 'cloud' }, createdAt: now, expiresAt: now + 1000, consentRevision: 1, policyVersion: ANALYTICS_POLICY_VERSION };
 assert.equal(analyticsEvent.safeParse({ ...valid, props: { source: 'cloud', title: 'SECRET' } }).success, false);
});

test('GA4 adapter is inert without independent flags and forwards allowlisted data only', async () => {
 let calls = 0; let payload;
 const fetcher = async (url, init) => { calls++; payload = JSON.parse(init.body); assert.match(url, /^https:\/\/www.google-analytics.com\/mp\/collect\?/); return new Response('', { status: 204 }); };
 assert.equal(createGa4Sender({}, fetcher), null);
 assert.equal(createGa4Sender({ ANALYTICS_ENABLED: 'true', GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test' }, fetcher), null);
 assert.equal(calls, 0);
 const sender = createGa4Sender({ ANALYTICS_ENABLED: 'true', ANALYTICS_EXPORT_ENABLED: 'true', GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test' }, async (url, init) => { calls++; payload = JSON.parse(init.body); return new Response(null, { status: 204 }); });
 await sender('random-pseudonym', { id: 'id', name: 'sign_up', props: { source: 'account' }, createdAt: now, expiresAt: now + 1000, consentRevision: 1, policyVersion: ANALYTICS_POLICY_VERSION }, new AbortController().signal);
 assert.equal(calls, 1); assert.equal(payload.client_id, 'random-pseudonym');
 assert.equal(payload.user_id, undefined); assert.equal(payload.events[0].params.page_location, undefined); assert.equal(payload.events[0].params.uid, undefined);
 assert.equal(payload.consent.ad_personalization, 'DENIED');
});

test('delivery claim prevents parallel duplicate sends; ambiguous response is never automatically retried', async () => {
 const db = generationMemoryDatabase(); await grant(db); await recordClientAnalytics(db, 'a', { ...action('local_deck_created'), count: 1 }, now);
 let calls = 0; const params = { db, uid: 'a', listPending: async () => ['c1-first-deck'], signal: new AbortController().signal, sender: async () => { calls++; throw new Error('network'); } };
 await Promise.all([exportAnalytics(params), exportAnalytics(params)]);
 assert.equal(calls, 1); assert.equal(db.get('users/a/analyticsOutbox/c1-first-deck').state, 'uncertain');
 await exportAnalytics(params); assert.equal(calls, 1);
});

test('disabled export does not read outbox, and revocation/expiry prevents external delivery', async () => {
 let reads = 0; const db = generationMemoryDatabase();
 await exportAnalytics({ db, uid: 'a', sender: null, listPending: async () => { reads++; return []; }, signal: new AbortController().signal });
 assert.equal(reads, 0);
 await grant(db); await recordClientAnalytics(db, 'a', { ...action('local_deck_created'), count: 1 }, now);
 assert.equal(await claimAnalyticsEvent(db, 'a', 'c1-first-deck', now + 73 * 3600000), null);
 assert.equal(db.get('users/a/analyticsOutbox/c1-first-deck').state, 'cancelled');
});

test('client disabled/no consent has no event calls; withdrawal is immediate and retries durably after offline failure', async () => {
 const disk = storage(); const calls = []; let offline = false;
 const client = createAnalyticsClient({ uid: 'a', enabled: false, storage: disk, notify: () => {}, transport: async path => { calls.push(path); return {}; } });
 await client.reload(); await client.track('visit'); assert.deepEqual(calls, []); client.stop();
 let remote = { granted: true, revision: 1, policyVersion: ANALYTICS_POLICY_VERSION };
 const enabled = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async (path, body) => {
  if (offline) throw new Error('offline'); calls.push(path);
  if (path === 'consent' && body) remote = { ...remote, granted: body.granted, revision: remote.revision + 1 };
  return { consent: remote, enabled: true };
 } });
 await enabled.reload(); assert.equal(enabled.getState().granted, true);
 offline = true; const pending = enabled.choose(false); assert.equal(enabled.getState().granted, false); await pending;
 assert.equal(JSON.parse(disk.getItem(analyticsStorageKey('a'))).pendingWithdrawal, true);
 const before = calls.length; await enabled.track('visit'); assert.equal(calls.length, before);
 offline = false; await enabled.reload(); assert.equal(remote.granted, false);
 assert.equal(JSON.parse(disk.getItem(analyticsStorageKey('a'))).pendingWithdrawal, false);
 enabled.stop();
});

test('client ignores late account responses and does not export after withdrawal during an event', async () => {
 let release; const gate = new Promise(resolve => { release = resolve; }); const disk = storage(); let exports = 0;
 const client = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async (path, body) => {
  if (path === 'events') { await gate; return { accepted: true }; }
  if (path === 'export') { exports++; return {}; }
  return { consent: { granted: body ? body.granted : true, revision: 1, policyVersion: ANALYTICS_POLICY_VERSION }, enabled: true };
 } });
 await client.reload(); const tracking = client.track('visit'); await Promise.resolve();
 await client.choose(false); release(); await tracking; assert.equal(exports, 0);
 let late; const blocked = new Promise(resolve => { late = resolve; });
 let notifications = 0;
 const other = createAnalyticsClient({ uid: 'b', enabled: true, storage: disk, notify: () => { notifications++; }, transport: async () => { await blocked; return { consent: { granted: true, revision: 1, policyVersion: ANALYTICS_POLICY_VERSION }, enabled: true }; } });
 const loading = other.reload(); other.stop(); late(); await loading; assert.equal(notifications, 0); client.stop();
});

test('HTTP validates consent and rejects unauthenticated/foreign/sensitive event requests', async () => {
 const db = generationMemoryDatabase();
 const handler = createAnalyticsHandler({ authenticate: async request => { if (!request.headers.get('authorization')) throw new AuthenticationError('로그인 필요'); return { uid: 'a' }; }, database: () => db, enabled: () => true, accountCreatedAt: async () => undefined, sender: () => null, listPending: async () => [], clock: () => now });
 const request = body => new Request('https://test', { method: 'POST', headers: { authorization: 'test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
 assert.equal((await handler(new Request('https://test'), 'consent')).status, 401);
 assert.equal((await handler(request(change(true)), 'consent')).status, 200);
 const response = await handler(request({ ...action('visit'), uid: 'b' }), 'event'); assert.equal(response.status, 400);
 assert.equal(db.get('users/b/growth/state'), undefined);
 assert.equal((await handler(request(action('visit', 100)), 'event')).status, 200);
 assert.deepEqual(await (await handler(request(action('visit', 100)), 'event')).json(), { accepted: false });
 const read = await handler(new Request('https://test', { headers: { authorization: 'test' } }), 'consent');
 assert.equal(read.headers.get('cache-control'), 'no-store'); assert.equal((await read.json()).consent.clientId, undefined);
});

test('optional transport refreshes token at most once and aborts before auth after teardown', async () => {
 let calls = 0;
 const request = createAnalyticsTransport(async () => 'token', new AbortController().signal, async () => { calls++; return Response.json({ error: 'expired' }, { status: 401 }); });
 await assert.rejects(request('consent')); assert.equal(calls, 2);
 let tokens = 0; const stopped = createAnalyticsTransport(async () => { tokens++; return 'token'; }, AbortSignal.abort());
 await assert.rejects(stopped('consent')); assert.equal(tokens, 0);
});

test('client privacy changes in another tab pause in-flight choice without leaving busy stuck', async () => {
 const disk = storage(); let release; const gate = new Promise(resolve => { release = resolve; });
 const client = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async (_path, body) => {
  if (body) await gate;
  return { consent: { granted: Boolean(body?.granted), revision: 1, policyVersion: ANALYTICS_POLICY_VERSION }, enabled: true };
 } });
 await client.reload(); const choosing = client.choose(true); await Promise.resolve(); client.pause();
 assert.equal(client.getState().busy, false); release(); await choosing;
 assert.equal(client.getState().granted, false); client.stop();
});

test('old-policy local consent is withdrawn before resuming collection', async () => {
 const disk = storage(); disk.setItem(analyticsStorageKey('a'), JSON.stringify({ granted: true, pendingWithdrawal: false, policyVersion: 'old' }));
 const posted = [];
 const client = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async (_path, body) => {
  if (body) posted.push(body);
  return { consent: { granted: !body, revision: 2, policyVersion: ANALYTICS_POLICY_VERSION }, enabled: true };
 } });
 await client.reload(); assert.equal(posted[0].granted, false); assert.equal(client.getState().granted, false); client.stop();
});

test('client corrupt consent storage fails closed; API rejects stale or abusive client events', async () => {
 const disk = storage(); disk.setItem(analyticsStorageKey('a'), 'broken'); let calls = 0;
 const client = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async () => { calls++; return {}; } });
 await client.reload(); await client.track('visit'); assert.equal(client.getState().granted, false); assert.equal(calls, 0);
 assert.equal(disk.getItem(analyticsStorageKey('a')), 'broken'); client.stop();
 const db = generationMemoryDatabase(); await grant(db);
 const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
 db.set('users/a/analyticsLimits/' + date, { count: 200 });
 await assert.rejects(recordClientAnalytics(db, 'a', action('visit'), now), { code: 'ANALYTICS_LIMIT' });
});

test('background refresh cannot supersede consent save and leave controls busy', async () => {
 const disk = storage(); let release; const gate = new Promise(resolve => { release = resolve; });
 let reads = 0;
 const client = createAnalyticsClient({ uid: 'a', enabled: true, storage: disk, notify: () => {}, transport: async (_path, body) => {
  if (body) await gate; else reads++;
  return { consent: { granted: Boolean(body?.granted), revision: 1, policyVersion: ANALYTICS_POLICY_VERSION }, enabled: true };
 } });
 await client.reload(); const choosing = client.choose(true); await client.reload(); assert.equal(reads, 1);
 release(); await choosing; assert.equal(client.getState().busy, false); assert.equal(client.getState().granted, true); client.stop();
});
