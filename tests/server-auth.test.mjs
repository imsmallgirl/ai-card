import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticationError, requireUser } from '../src/lib/server-auth.ts';

process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'moa-test-project';

test('missing or malformed bearer header is rejected before generating anything', async () => {
  for (const authorization of [undefined, 'Basic test', 'Bearer ', 'Bearer one two']) {
    const headers = authorization ? { authorization } : {};
    await assert.rejects(requireUser(new Request('http://localhost/api/generate', { headers })), AuthenticationError);
  }
});

test('an arbitrary token is rejected by Firebase token verification', async () => {
  await assert.rejects(requireUser(new Request('http://localhost/api/generate', { headers: { authorization: 'Bearer not-a-firebase-token' } })), AuthenticationError);
});
