import test from 'node:test';
import assert from 'node:assert/strict';
import { generationMemoryDatabase } from './helpers/generation-db.mjs';
import { generationInput } from '../src/lib/gemini.ts';
import { generationPolicy, reserveGeneration, beginGenerationAttempt, finishGeneration, readGenerationUsage, readGenerationRecord, recordGenerationAttempt } from '../src/lib/server/generation-usage.ts';
import { generateWithBudget, tokenUsage } from '../src/lib/server/generation-service.ts';
import { createGenerationHandlers } from '../src/lib/server/generation-http.ts';
import { AuthenticationError } from '../src/lib/server-auth.ts';
import { generationFetch, readPendingGeneration, pendingGenerationKey } from '../src/lib/generation-client.ts';
const now = Date.UTC(2026, 9, 21, 1);
const policy = (changes = {}) => ({ ...generationPolicy({ AI_DAILY_LIMIT: '3', AI_COOLDOWN_SECONDS: '0', AI_FAILURE_COOLDOWN_SECONDS: '0' }), ...changes });
const input = generationInput.parse({ title: '영어' });
const answer = () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ cards: [{ question: 'Q', answer: 'A' }] }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 150 } });
const opts = (db, overrides = {}) => ({ db, uid: 'a', id: crypto.randomUUID(), input, key: 'not-real', model: 'test-model', policy: policy(), signal: new AbortController().signal, clock: () => now, fetcher: async () => Response.json(answer()), ...overrides });
const reserve = (db, uid, id, p = policy(), time = now) => reserveGeneration(db, uid, id, 'hash', 'test-model', 200, p, time);

test('twenty concurrent requests acquire only one UID lock; three completed calls exhaust daily quota', async () => {
  const db = generationMemoryDatabase(); const p = policy();
  const ids = Array.from({ length: 20 }, () => crypto.randomUUID());
  const results = await Promise.allSettled(ids.map(id => reserve(db, 'a', id, p)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const result of results.filter(r => r.status === 'rejected')) assert.equal(result.reason.code, 'GENERATION_IN_PROGRESS');
  const id = ids[results.findIndex(r => r.status === 'fulfilled')];
  await beginGenerationAttempt(db, 'a', id, p, now);
  await finishGeneration(db, 'a', id, p, { result: { cards: [{ question: 'Q', answer: 'A' }], model: 'test-model' } }, now);
  await generateWithBudget(opts(db)); await generateWithBudget(opts(db));
  await assert.rejects(generateWithBudget(opts(db)), { code: 'DAILY_LIMIT' });
  const usage = await readGenerationUsage(db, 'a', p, now);
  assert.equal(usage.charged, 3); assert.equal(usage.reserved, 0); assert.equal(usage.remaining, 0);
  assert.equal((await readGenerationUsage(db, 'b', p, now)).remaining, 3);
});

test('duplicate request IDs replay saved results once; changed input is rejected', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  const option = opts(db, { fetcher: async () => { calls++; return Response.json(answer()); } });
  const result = await generateWithBudget(option); const replay = await generateWithBudget(option);
  assert.deepEqual(replay, result); assert.equal(calls, 1);
  await assert.rejects(generateWithBudget({ ...option, input: { ...input, title: '다른 주제' } }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 1);
  assert.equal(db.get('serviceUsage/2026-10-21/models/test-model').totalTokens, 150);
  assert.equal(db.get('serviceUsage/2026-10-21').success, 1);
});

test('transient retries each consume global admission budget; bounded at three attempts', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  const result = await generateWithBudget(opts(db, { fetcher: async (_url, init) => {
    calls++; assert.equal(JSON.parse(init.body).generationConfig.maxOutputTokens, 8192);
    return calls < 3 ? Response.json({}, { status: 503 }) : Response.json(answer());
  } }));
  assert.equal(result.cards.length, 1); assert.equal(calls, 3);
  assert.equal(db.get('serviceUsage/2026-10-21').attempts, 3);
  assert.equal(db.get('serviceUsage/2026-10-21').missingUsageAttempts, 2);
  assert.equal(db.get('users/a/usageDaily/2026-10-21').providerAttempts, 3);
  assert.equal(db.get('users/a/usageDaily/2026-10-21').charged, 1);
});

test('global attempt cap is atomic across UIDs and prevents provider admission beyond the cap', async () => {
  const db = generationMemoryDatabase(); const p = policy({ globalAttempts: 5 });
  const users = Array.from({ length: 20 }, (_, n) => 'user' + n);
  const ids = users.map(() => crypto.randomUUID());
  await Promise.all(users.map((uid, n) => reserve(db, uid, ids[n], p)));
  const results = await Promise.allSettled(users.map((uid, n) => beginGenerationAttempt(db, uid, ids[n], p, now)));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 5);
  assert.equal(db.get('serviceUsage/2026-10-21').attempts, 5);
  assert.equal(db.get('serviceUsage/2026-10-21').admittedTokenBudget, 1000);
});

test('zero global token budget refunds pre-call reservation and makes no provider call', async () => {
  const db = generationMemoryDatabase(); let calls = 0; const id = crypto.randomUUID();
  const options = opts(db, { id, policy: policy({ globalTokenBudget: 0 }), fetcher: async () => { calls++; return Response.json(answer()); } });
  await assert.rejects(generateWithBudget(options), { code: 'GLOBAL_LIMIT' });
  assert.equal(calls, 0);
  const usage = await readGenerationUsage(db, 'a', policy(), now);
  assert.equal(usage.charged, 0); assert.equal(usage.reserved, 0);
  await assert.rejects(generateWithBudget(options), { code: 'GLOBAL_LIMIT' });
  assert.equal(calls, 0);
});

test('global budget stops retries; already started request is charged once', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  await assert.rejects(generateWithBudget(opts(db, { policy: policy({ globalAttempts: 1 }), fetcher: async () => { calls++; return Response.json({}, { status: 503 }); } })), { code: 'GLOBAL_LIMIT' });
  assert.equal(calls, 1); assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 1);
});

test('abort before admission refunds; transport timeout after admission charges and records unknown tokens', async () => {
  const db = generationMemoryDatabase();
  await assert.rejects(generateWithBudget(opts(db, { signal: AbortSignal.abort(new DOMException('timeout', 'TimeoutError')) })), { code: 'TIMEOUT' });
  assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 0);
  await assert.rejects(generateWithBudget(opts(db, { fetcher: async () => { throw new DOMException('timeout', 'TimeoutError'); } })), { code: 'TIMEOUT' });
  assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 1);
  assert.equal(db.get('serviceUsage/2026-10-21').missingUsageAttempts, 1);
});

test('expired worker recovery charges only started request on its original day; late finalizer cannot change outcome', async () => {
  const db = generationMemoryDatabase(); const p = policy(); const before = Date.UTC(2026, 9, 20, 23, 59, 50); const id = crypto.randomUUID();
  await reserve(db, 'a', id, p, before); await beginGenerationAttempt(db, 'a', id, p, before);
  const midnight = Date.UTC(2026, 9, 21, 0, 0, 10);
  await assert.rejects(reserve(db, 'a', crypto.randomUUID(), p, midnight), { code: 'GENERATION_IN_PROGRESS' });
  const later = before + 121000;
  const usage = await readGenerationUsage(db, 'a', p, later);
  assert.equal(usage.charged, 0); assert.equal(usage.remaining, 3);
  assert.equal(db.get('users/a/usageDaily/2026-10-20').charged, 1);
  assert.equal(db.get('users/a/usageDaily/2026-10-20').reserved, 0);
  assert.equal((await readGenerationRecord(db, 'a', id, later)).record.state, 'unknown');
  await finishGeneration(db, 'a', id, p, { result: { cards: [], model: 'test-model' } }, later);
  assert.equal(db.get(`users/a/generationDrafts/${id}`), undefined);
  await reserve(db, 'a', crypto.randomUUID(), p, later);
});

test('expired reservation before a provider call is refunded and cooldown is enforced after completion', async () => {
  const db = generationMemoryDatabase(); const id = crypto.randomUUID(); const p = policy({ cooldownMs: 5000 });
  await reserve(db, 'a', id, p); await readGenerationUsage(db, 'a', p, now + 121000);
  assert.equal(db.get('users/a/usageDaily/2026-10-21').charged, 0);
  await generateWithBudget(opts(db, { policy: p, clock: () => now + 122000 }));
  await assert.rejects(reserve(db, 'a', crypto.randomUUID(), p, now + 123000), { code: 'COOLDOWN' });
});

test('non-STOP/incomplete, blocked, malformed and oversized responses fail safely without draft', async () => {
  const payloads = [
    { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"cards":[{"question":"Q","answer":"A"}]}' }] } }] },
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'broken' }] } }] },
    { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"cards":[]}' }] } }] },
  ];
  for (const payload of payloads) {
    const db = generationMemoryDatabase(); const option = opts(db, { fetcher: async () => Response.json(payload) });
    await assert.rejects(generateWithBudget(option));
    assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 1);
    assert.equal(db.get(`users/a/generationDrafts/${option.id}`), undefined);
  }
  const db = generationMemoryDatabase();
  await assert.rejects(generateWithBudget(opts(db, { fetcher: async () => new Response('a'.repeat(262145)) })), { code: 'INVALID_OUTPUT' });
});

test('attempt telemetry is idempotent and missing tokens remain unknown', async () => {
  assert.deepEqual(tokenUsage({}), { input: null, output: null, thinking: null, total: null });
  const db = generationMemoryDatabase(); const id = crypto.randomUUID();
  await reserve(db, 'a', id); await beginGenerationAttempt(db, 'a', id, policy(), now);
  await recordGenerationAttempt(db, 'a', id, 1, 200, { input: 2, output: 3, thinking: null, total: 5 }, now);
  await recordGenerationAttempt(db, 'a', id, 1, 200, { input: 2, output: 3, thinking: null, total: 5 }, now);
  assert.equal(db.get('serviceUsage/2026-10-21').totalTokens, 5);
});

test('HTTP auth, input byte limit, key requirements and no memory fallback', async () => {
  let calls = 0; const db = generationMemoryDatabase();
  const handler = createGenerationHandlers({ authenticate: async request => { if (request.headers.get('authorization') !== 'a') throw new AuthenticationError('로그인 필요'); return { uid: 'a' }; }, database: () => db,
    environment: () => ({ AI_GENERATION_ENABLED: 'true', GEMINI_API_KEY: 'fake', AI_COOLDOWN_SECONDS: '0' }), clock: () => now,
    fetcher: async () => { calls++; return Response.json(answer()); } });
  const req = (body, id = crypto.randomUUID(), auth = 'a') => new Request('https://test/api/generate', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json', 'idempotency-key': id }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await handler(req(input, crypto.randomUUID(), 'b'), 'generate')).status, 401);
  assert.equal((await handler(req(input, 'bad'), 'generate')).status, 400);
  assert.equal((await handler(req('a'.repeat(450001)), 'generate')).status, 413);
  assert.equal(calls, 0);
  const id = crypto.randomUUID();
  const response = await handler(req({ ...input, uid: 'b' }, id), 'generate');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).usage.remaining, 9);
  assert.equal(db.get('users/b/usageDaily/2026-10-21'), undefined);
  const replay = await handler(new Request('https://test/result', { headers: { authorization: 'a' } }), 'result', id);
  assert.equal(replay.status, 200); assert.equal(calls, 1);
  const unavailable = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => { throw new Error('ADC'); }, environment: () => ({ AI_GENERATION_ENABLED: 'true', GEMINI_API_KEY: 'fake' }), fetcher: async () => { calls++; return Response.json(answer()); } });
  assert.equal((await unavailable(req(input), 'generate')).status, 503); assert.equal(calls, 1);
});

test('disabled generation makes no provider calls; result is UID-scoped and expires without re-calling', async () => {
  const db = generationMemoryDatabase(); const option = opts(db);
  await generateWithBudget(option);
  await assert.rejects(readGenerationRecord(db, 'b', option.id, now), { code: 'NOT_FOUND' });
  const handler = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db, environment: () => ({ AI_GENERATION_ENABLED: 'false' }), clock: () => now });
  const req = new Request('https://test', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify(input) });
  assert.equal((await handler(req, 'generate')).status, 503);
  assert.equal((await handler(new Request('https://test'), 'result', option.id)).status, 200);
  await assert.rejects(readGenerationRecord(db, 'a', option.id, now + 8 * 86400000), { code: 'RESULT_EXPIRED' });
});

test('client 401 retry keeps request ID and UID-specific pending payload survives reload', async () => {
  const pending = { id: crypto.randomUUID(), input };
  const disk = new Map([[pendingGenerationKey('a'), JSON.stringify(pending)]]);
  assert.deepEqual(readPendingGeneration({ getItem: key => disk.get(key) || null }, 'a'), pending);
  assert.equal(readPendingGeneration({ getItem: key => disk.get(key) || null }, 'b'), null);
  const ids = [];
  await generationFetch(async () => 'token', '/api/generate', new AbortController().signal, pending, async (_url, init) => { ids.push(init.headers['Idempotency-Key']); return ids.length === 1 ? Response.json({}, { status: 401 }) : Response.json({}); });
  assert.deepEqual(ids, [pending.id, pending.id]);
});

test('global budget or lock corruption fails closed rather than admitting provider calls', async () => {
  for (const entry of [ ['serviceUsage/2026-10-21', { attempts: -5 }], ['users/a/locks/generation', { requestId: 'other', leaseUntil: 'bad' }] ]) {
    const db = generationMemoryDatabase(); db.set(...entry); let calls = 0;
    await assert.rejects(generateWithBudget(opts(db, { fetcher: async () => { calls++; return Response.json(answer()); } })));
    assert.equal(calls, 0);
  }
});

test('administrator cost API enforces boolean custom claim and bounded valid UTC dates', async () => {
  const { createCostHandler } = await import('../src/lib/server/generation-cost-http.ts');
  let reads = 0;
  for (const admin of [undefined, false, 'true']) {
    const handler = createCostHandler({ authenticate: async () => ({ uid: 'a', admin }), read: async () => { reads++; return []; } });
    assert.equal((await handler(new Request('https://test?from=2026-10-01&to=2026-10-21'))).status, 403);
  }
  const handler = createCostHandler({ authenticate: async () => ({ uid: 'admin', admin: true }), read: async () => { reads++; return []; } });
  for (const query of ['from=2026-02-30&to=2026-03-01','from=2026-01-01&to=2026-10-21','from=2026-10-21&to=2026-10-01']) assert.equal((await handler(new Request('https://test?' + query))).status, 400);
  assert.equal(reads, 0);
  const response = await handler(new Request('https://test?from=2026-10-01&to=2026-10-21'));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(reads, 1);
});

test('duplicate in-flight replay cannot run a second provider call', async () => {
  const db = generationMemoryDatabase(); let release; let started;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const options = opts(db, { fetcher: async () => { calls++; started(); await gate; return Response.json(answer()); } });
  const first = generateWithBudget(options); await entered;
  await assert.rejects(generateWithBudget(options), { code: 'GENERATION_IN_PROGRESS' });
  release(); await first;
  assert.equal(calls, 1);
});

test('permanent provider errors are charged once and never retried', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  await assert.rejects(generateWithBudget(opts(db, { fetcher: async () => { calls++; return Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 }); } })), { code: 'ACCESS_DENIED' });
  assert.equal(calls, 1); assert.equal((await readGenerationUsage(db, 'a', policy(), now)).charged, 1);
});


test('local unlimited mode bypasses exhausted daily/global budgets and old cooldowns while recording usage', async () => {
  const db = generationMemoryDatabase();
  const p = generationPolicy({ NODE_ENV: 'development', AI_GENERATION_UNLIMITED: 'true', AI_DAILY_LIMIT: '0', AI_GLOBAL_DAILY_ATTEMPTS: '0', AI_GLOBAL_DAILY_TOKEN_BUDGET: '0' });
  await db.transaction(async tx => { tx.set('users/a/locks/generation', { requestId: '', leaseUntil: 0, retryAt: now + 60000 }); });
  for (let i = 0; i < 4; i++) await generateWithBudget(opts(db, { policy: p }));
  const usage = await readGenerationUsage(db, 'a', p, now);
  assert.equal(usage.unlimited, true);
  assert.equal(usage.remaining, null);
  assert.equal(usage.charged, 4);
  assert.equal(db.get('serviceUsage/2026-10-21').attempts, 4);
  assert.equal(p.cooldownMs, 0);
  assert.equal(p.failureCooldownMs, 0);
  assert.equal(generationPolicy({ NODE_ENV: 'production', AI_GENERATION_UNLIMITED: 'true' }).unlimited, false);
});

test('normalized duplicate AI questions are rejected without an automatic replacement call',async()=>{
  const db=generationMemoryDatabase();let calls=0;
  const option=opts(db,{input:generationInput.parse({title:'중복',count:2}),fetcher:async()=>{calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({cards:[{question:'질문?',answer:'A'},{question:'질문 !',answer:'B'}]})}]}}]});}});
  await assert.rejects(generateWithBudget(option),{code:'DUPLICATE_CARDS'});assert.equal(calls,1);
  assert.equal((await readGenerationUsage(db,'a',policy(),now)).charged,1);
});

test('launch default permits ten daily generations then blocks the eleventh for the same user',async()=>{
  const db=generationMemoryDatabase();const p=generationPolicy({AI_COOLDOWN_SECONDS:'0'});
  assert.equal(p.dailyLimit,10);
  for(let index=0;index<10;index++){
    const id=crypto.randomUUID();await reserve(db,'launch',id,p,now);
    await beginGenerationAttempt(db,'launch',id,p,now);
    await finishGeneration(db,'launch',id,p,{result:{cards:[{question:'Q',answer:'A'}],model:'test-model'}},now);
  }
  assert.equal((await readGenerationUsage(db,'launch',p,now)).remaining,0);
  await assert.rejects(()=>reserve(db,'launch',crypto.randomUUID(),p,now));
  assert.equal((await readGenerationUsage(db,'other-user',p,now)).remaining,10);
});
