import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationHandlers } from '../src/lib/server/generation-http.ts';
import { generationSettings, MOCK_MODEL } from '../src/lib/server/generation-settings.ts';
import { generateMock } from '../src/lib/server/generation-mock.ts';
import { generationPolicy } from '../src/lib/server/generation-usage.ts';
import { generationInput, geminiFailure } from '../src/lib/gemini.ts';
import { generationClientResult, generationFetch } from '../src/lib/generation-client.ts';
import { generationMemoryDatabase } from './helpers/generation-db.mjs';

const now = Date.UTC(2026, 9, 21);
const mockEnv = { NODE_ENV: 'development', AI_PROVIDER: 'mock', AI_GENERATION_ENABLED: 'true' };
const input = generationInput.parse({ title: '세포', category: '과학', count: 5 });
const request = (id = crypto.randomUUID(), body = input) => new Request('https://test/api/generate', {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': id }, body: JSON.stringify(body),
});

test('mock returns the real response schema without an API key or any fetch, preserving Firestore draft replay and UID isolation', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  const handler = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db,
    environment: () => mockEnv, clock: () => now, fetcher: async () => { calls++; throw new Error('must not call'); } });
  const usageResponse = await handler(new Request('https://test'), 'usage');
  const usage = await usageResponse.json(); assert.equal(usage.provider, 'mock'); assert.equal(usage.enabled, true);
  const id = crypto.randomUUID();
  const response = await handler(request(id), 'generate'); assert.equal(response.status, 200);
  const result = generationClientResult.parse(await response.json());
  assert.deepEqual(Object.keys(result).sort(), ['cards', 'model', 'requestId', 'usage']);
  assert.equal(result.model, MOCK_MODEL); assert.equal(result.requestId, id); assert.equal(result.cards.length, 5);
  assert.equal(new Set(result.cards.map(card => card.question)).size, 5);
  assert.equal(result.usage.charged, 0); assert.equal(result.usage.remaining, null);
  assert.equal(db.get(`users/a/generationRequests/${id}`).attempts, 0);
  assert.equal(db.get(`users/a/generationDrafts/${id}`).cards.length, 5);
  assert.equal(db.get('serviceUsage/2026-10-21').attempts, undefined);
  const replay = await handler(request(id), 'generate');
  assert.deepEqual(await replay.json(), result); assert.equal(calls, 0);
  const changed = await handler(request(id, { ...input, title: '다른 주제' }), 'generate');
  assert.equal(changed.status, 409);
  const other = createGenerationHandlers({ authenticate: async () => ({ uid: 'b' }), database: () => db, environment: () => mockEnv, clock: () => now });
  assert.equal((await other(new Request('https://test'), 'result', id)).status, 404);
});

test('mock is rejected in production, test, unknown environments and hosted development with no DB or provider activity', async () => {
  for (const override of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { NODE_ENV: undefined }, { VERCEL: '1' }, { NETLIFY: 'true' }, { K_SERVICE: 'app' }]) {
    let reads = 0; let calls = 0;
    const env = { ...mockEnv, ...override };
    const handler = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => { reads++; return generationMemoryDatabase(); }, environment: () => env,
      fetcher: async () => { calls++; throw new Error('must not call'); } });
    const response = await handler(request(), 'generate'); assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'MOCK_DISABLED'); assert.equal(reads, 0); assert.equal(calls, 0);
    await assert.rejects(generateMock({ db: generationMemoryDatabase(), uid: 'a', id: crypto.randomUUID(), input,
      policy: generationPolicy({}), signal: new AbortController().signal, environment: env }), { code: 'MOCK_DISABLED' });
  }
});

test('stored mock results cannot be replayed by production real mode; mock still requires working Firestore', async () => {
  const db = generationMemoryDatabase(); const id = crypto.randomUUID();
  await generateMock({ db, uid: 'a', id, input, policy: generationPolicy({}), signal: new AbortController().signal, environment: mockEnv, clock: () => now });
  const real = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db, environment: () => ({ NODE_ENV: 'production' }), clock: () => now });
  const response = await real(new Request('https://test'), 'result', id);
  assert.equal((await response.json()).code, 'MOCK_DISABLED');
  const unavailable = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => { throw new Error('ADC unavailable'); }, environment: () => mockEnv });
  const failed = await unavailable(request(), 'generate'); assert.equal(failed.status, 503);
  assert.equal((await failed.json()).cards, undefined);
});

test('mock respects quantity bounds, labels fake content and deterministically replays without reference analysis', async () => {
  for (const count of [1, 20]) {
    const result = await generateMock({ db: generationMemoryDatabase(), uid: 'a', id: crypto.randomUUID(), input: { ...input, count, text: 'private reference' },
      policy: generationPolicy({}), signal: new AbortController().signal, environment: mockEnv, clock: () => now });
    assert.equal(result.cards.length, count);
    assert.ok(result.cards.every(card => card.question.startsWith('[Mock') && card.answer.includes('실제 AI')));
    assert.equal(JSON.stringify(result).includes('private reference'), false);
  }
  await assert.rejects(generateMock({ db: generationMemoryDatabase(), uid: 'a', id: crypto.randomUUID(), input: { ...input, count: 21 },
    policy: generationPolicy({}), signal: new AbortController().signal, environment: mockEnv }));
});

test('real mode selects the environment model, keeps API keys server-side and never falls back on quota errors', async () => {
  const db = generationMemoryDatabase(); let calls = 0; const secret = 'test-private-server-key';
  const env = { NODE_ENV: 'development', AI_PROVIDER: 'gemini', AI_GENERATION_ENABLED: 'true', GEMINI_MODEL: 'models/gemini-2.5-flash-lite', GEMINI_API_KEY: secret };
  const handler = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db, environment: () => env, clock: () => now,
    fetcher: async (url, init) => {
      calls++; assert.match(url, /models\/gemini-2\.5-flash-lite:generateContent$/);
      assert.equal(init.headers['x-goog-api-key'], secret); assert.equal(url.includes(secret), false); assert.equal(init.body.includes(secret), false);
      return Response.json({ error: { status: 'RESOURCE_EXHAUSTED', message: `check your plan and billing details ${secret}`, details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerModel' }] }] } }, { status: 429 });
    } });
  const id = crypto.randomUUID();
  const response = await handler(request(id, { ...input, provider: 'mock', apiKey: 'client-supplied-key' }), 'generate');
  assert.equal(response.status, 429);
  const body = await response.json(); assert.equal(body.code, 'RATE_LIMIT_EXCEEDED'); assert.equal(body.cards, undefined);
  assert.deepEqual(body.diagnostic, { providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED' });
  assert.equal(JSON.stringify(body).includes(secret), false); assert.equal(calls, 1);
  assert.equal(db.get(`users/a/generationDrafts/${id}`), undefined);
  const replay = await handler(new Request('https://test'), 'result', id);
  assert.deepEqual((await replay.json()).diagnostic, body.diagnostic); assert.equal(calls, 1);
  const usage = await handler(new Request('https://test'), 'usage'); assert.equal(JSON.stringify(await usage.json()).includes(secret), false);
});

test('provider diagnostics distinguish quota, rate, zero allocation, billing, model and precondition without leaking raw details', () => {
  const cases = [
    [429, { status: 'RESOURCE_EXHAUSTED' }, 'RESOURCE_EXHAUSTED'],
    [429, { status: 'RESOURCE_EXHAUSTED', message: 'Please check your plan and billing details' }, 'RESOURCE_EXHAUSTED'],
    [429, { details: [{ violations: [{ quotaId: 'RequestsPerMinutePerProject', quotaValue: '10' }] }] }, 'RATE_LIMIT_EXCEEDED'],
    [429, { details: [{ violations: [{ quotaId: 'RequestsPerDay' }] }] }, 'DAILY_QUOTA_EXCEEDED'],
    [429, { details: [{ violations: [{ quotaId: 'RequestsPerDay', quotaValue: '0' }] }] }, 'QUOTA_UNAVAILABLE'],
    [429, { details: [{ reason: 'SPEND_LIMIT_EXCEEDED' }] }, 'BILLING_LIMIT_EXCEEDED'],
    [429, { message: 'Spend-based rate limit exceeded' }, 'BILLING_LIMIT_EXCEEDED'],
    [402, {}, 'BILLING_CREDITS_EXHAUSTED'],
    [403, { details: [{ reason: 'BILLING_DISABLED' }] }, 'BILLING_REQUIRED'],
    [400, { status: 'FAILED_PRECONDITION', message: 'Please enable billing' }, 'BILLING_REQUIRED'],
    [400, { status: 'FAILED_PRECONDITION' }, 'PROVIDER_PRECONDITION'],
    [400, { status: 'INVALID_ARGUMENT' }, 'MODEL_REQUEST_INVALID'],
    [400, { status: 'INVALID_ARGUMENT', message: 'Schema is too complex DO_NOT_LEAK' }, 'OUTPUT_SCHEMA_TOO_COMPLEX'],
    [400, { status: 'INVALID_ARGUMENT', message: 'Unknown name "responseJsonSchema" at generation_config DO_NOT_LEAK' }, 'STRUCTURED_OUTPUT_OPTION_INVALID'],
    [400, { status: 'INVALID_ARGUMENT', message: 'maxOutputTokens must be smaller DO_NOT_LEAK' }, 'OUTPUT_TOKEN_OPTION_INVALID'],
    [404, {}, 'MODEL_NOT_FOUND'], [403, {}, 'ACCESS_DENIED'],
    [400, { details: [{ reason: 'API_KEY_INVALID' }] }, 'INVALID_API_KEY'],
  ];
  for (const [status, error, code] of cases) {
    const result = geminiFailure(status, { error: { message: 'DO_NOT_LEAK raw provider input', ...error } });
    assert.equal(result.code, code); assert.equal(result.diagnostic.providerStatus, status);
    assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'), false);
  }
});

test('model settings reject malformed names and client preserves safe diagnostics', async () => {
  assert.equal(generationSettings({}).model, 'gemini-3.1-flash-lite');
  assert.equal(generationSettings({ GEMINI_MODEL: 'gemini-2.5-flash-lite' }).model, 'gemini-2.5-flash-lite');
  assert.throws(() => generationSettings({ GEMINI_MODEL: 'invalid?key=secret' }), { code: 'MODEL_CONFIG_INVALID' });
  assert.throws(() => generationSettings({ AI_PROVIDER: 'automatic' }), { code: 'NOT_CONFIGURED' });
  await assert.rejects(generationFetch(async () => 'token', '/api/generate', new AbortController().signal, undefined,
    async () => Response.json({ error: 'Gemini quota', code: 'RESOURCE_EXHAUSTED', diagnostic: { providerStatus: 429, providerCode: 'RESOURCE_EXHAUSTED' } }, { status: 429 })), error => {
      assert.equal(error.diagnostic.providerStatus, 429); assert.equal(error.code, 'RESOURCE_EXHAUSTED'); return true;
    });
});

test('saved 429 failure is explicitly terminal, and a deliberate new Mock request succeeds without retrying Gemini', async () => {
  const db = generationMemoryDatabase(); let calls = 0;
  const real = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db, clock: () => now,
    environment: () => ({ NODE_ENV: 'development', AI_GENERATION_ENABLED: 'true', GEMINI_API_KEY: 'fake' }),
    fetcher: async () => { calls++; return Response.json({ error: { status: 'RESOURCE_EXHAUSTED' } }, { status: 429 }); } });
  const oldId = crypto.randomUUID(); const failed = await real(request(oldId), 'generate');
  assert.equal(failed.status, 429); assert.equal((await failed.json()).terminal, true);
  const mock = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database: () => db, clock: () => now, environment: () => mockEnv,
    fetcher: async () => { calls++; throw new Error('must not call'); } });
  await assert.rejects(generationFetch(async () => 'token', `/api/generation-requests/${oldId}`, new AbortController().signal, undefined,
    async () => mock(new Request('https://test'), 'result', oldId)), error => {
      assert.equal(error.status, 429); assert.equal(error.terminal, true);
      assert.match(error.message, /이전 요청의 실패 기록/); assert.match(error.message, /당시 모델: gemini-3\.1-flash-lite/); return true;
    });
  assert.equal(db.get(`users/a/generationDrafts/${oldId}`), undefined);
  const newId = crypto.randomUUID(); const fresh = await mock(request(newId), 'generate');
  assert.equal(fresh.status, 200); const result = generationClientResult.parse(await fresh.json());
  assert.equal(result.requestId, newId); assert.equal(result.model, MOCK_MODEL); assert.equal(result.cards.length, input.count);
  assert.equal(db.get(`users/a/generationRequests/${oldId}`).state, 'failed');
  assert.equal(db.get(`users/a/generationRequests/${newId}`).state, 'succeeded'); assert.equal(calls, 1);
});

test('vocabulary generation rejects theory answers without saving or retrying and accepts actual words',async()=>{
  for(const valid of [false,true]){
    const db=generationMemoryDatabase();let calls=0;
    const handler=createGenerationHandlers({authenticate:async()=>({uid:'words'}),database:()=>db,clock:()=>now,
      environment:()=>({NODE_ENV:'development',AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake'}),
      fetcher:async()=>{calls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({cards:[valid?{question:'achieve',answer:'달성하다 (동사)',explanation:'Achieve your goal. 목표를 달성하세요.'}:{question:'영어 어휘력이란 무엇인가요?',answer:'영어 단어를 이해하고 사용하는 능력입니다.'}]})}]}}]});}});
    const id=crypto.randomUUID();const response=await handler(request(id,{title:'영어단어외우기',category:'외국어',count:1}),'generate');
    const body=await response.json();assert.equal(calls,1);
    if(valid){assert.equal(response.status,200);assert.equal(body.cards[0].question,'achieve');}
    else{assert.equal(response.status,422);assert.equal(body.code,'VOCABULARY_FORMAT_INVALID');assert.equal(db.get(`users/words/generationDrafts/${id}`),undefined);}
  }
});

test('invalid, disabled and oversized material requests do not open the database or call AI',async()=>{
 for(const [body,enabled,status] of [[{title:'영어',count:21},'true',400],[{title:'영어',count:1},'false',503],[{title:'자료',mode:'material',count:1,text:'Q: 첫 질문?\nA: 답\nQ: 다음 질문?\nA: 답'},'true',400]]){
  let reads=0,calls=0;
  const handler=createGenerationHandlers({authenticate:async()=>({uid:'a'}),database:()=>{reads++;return generationMemoryDatabase();},environment:()=>({NODE_ENV:'production',AI_GENERATION_ENABLED:enabled,GEMINI_API_KEY:'fake'}),fetcher:async()=>{calls++;throw new Error('must not call');}});
  assert.equal((await handler(request(crypto.randomUUID(),body),'generate')).status,status);
  assert.equal(reads,0);assert.equal(calls,0);
 }
});
