import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGenerationHandlers } from '../src/lib/server/generation-http.ts';
import { createAnalyticsHandler } from '../src/lib/server/analytics-http.ts';
import { StudyError } from '../src/lib/server/study-service.ts';

// A separate strict process catches SDK-created unhandled promises which ordinary mocked tests miss.
// Use a nonexistent credential file: deterministic offline failure, no real credentials/network calls.
test('missing ADC is awaited before Firestore SDK construction, including concurrent callers and retry', () => {
  const env = { ...process.env, FIREBASE_PROJECT_ID: 'demo-moa-adc-regression',
    GOOGLE_APPLICATION_CREDENTIALS: join(tmpdir(), `moa-missing-${crypto.randomUUID()}.json`) };
  delete env.FIRESTORE_EMULATOR_HOST;
  for (const mode of ['missing-file', 'no-adc']) {
    if (mode === 'no-adc') {
      delete env.GOOGLE_APPLICATION_CREDENTIALS; delete env.google_application_credentials;
      env.CLOUDSDK_CONFIG = join(tmpdir(), `moa-empty-adc-${crypto.randomUUID()}`);
      env.METADATA_SERVER_DETECTION = 'none'; // Isolate tests from host/cloud credential discovery.
    }
  const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--experimental-strip-types', '--input-type=module', '-'], {
    cwd: process.cwd(), env, encoding: 'utf8', timeout: 15000,
    input: `
      import assert from 'node:assert/strict';
      import { getApps } from 'firebase-admin/app';
      import { getStudyFirestore, generationDatabase } from './src/lib/server/firestore-database.ts';
      import { createGenerationHandlers } from './src/lib/server/generation-http.ts';
      for (let retry = 0; retry < 2; retry++) {
        const results = await Promise.allSettled(Array.from({length: 4}, () => getStudyFirestore()));
        for (const item of results) {
          assert.equal(item.status, 'rejected');
          assert.equal(item.reason.code, 'FIRESTORE_CREDENTIALS_REQUIRED');
          assert.equal(item.reason.status, 503);
        }
      }
      assert.equal(getApps().some(app => app.name === 'moa-study-server'), false);
      const handler = createGenerationHandlers({ authenticate: async () => ({uid:'a'}), database: generationDatabase, environment: () => ({}) });
      const response = await handler(new Request('http://localhost/api/usage'), 'usage');
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, 'FIRESTORE_CREDENTIALS_REQUIRED');
      await new Promise(resolve => setTimeout(resolve, 150));
      console.log('ADC_FAILURE_HANDLED');
    `,
  });
  assert.equal(result.status, 0, `child failed: ${result.stderr}`);
  assert.match(result.stdout, /ADC_FAILURE_HANDLED/);
  }
});

test('async credential failures become generation/analytics configuration responses without provider calls', async () => {
  let providerCalls = 0;
  const database = async () => { throw new StudyError('FIRESTORE_CREDENTIALS_REQUIRED', '서버 Firebase 인증정보가 필요합니다.', 503); };
  const generation = createGenerationHandlers({ authenticate: async () => ({ uid: 'a' }), database,
    environment: () => ({ AI_GENERATION_ENABLED: 'true', GEMINI_API_KEY: 'mock' }), fetcher: async () => { providerCalls++; return new Response(); } });
  const response = await generation(new Request('http://localhost/api/usage'), 'usage');
  assert.equal(response.status, 503); assert.equal((await response.json()).code, 'FIRESTORE_CREDENTIALS_REQUIRED');
  assert.equal(providerCalls, 0);
  const analytics = createAnalyticsHandler({ authenticate: async () => ({ uid: 'a' }), database, enabled: () => true,
    accountCreatedAt: async () => undefined, sender: () => null, listPending: async () => [] });
  const consent = await analytics(new Request('http://localhost/api/analytics/consent'), 'consent');
  assert.equal(consent.status, 503); assert.equal((await consent.json()).code, 'FIRESTORE_CREDENTIALS_REQUIRED');
  // A disabled export must not ask ADC for a token or construct Firestore.
  const exported = await analytics(new Request('http://localhost/api/analytics/export', { method: 'POST' }), 'export');
  assert.equal(exported.status, 200); assert.deepEqual(await exported.json(), { attempted: 0 });
});
