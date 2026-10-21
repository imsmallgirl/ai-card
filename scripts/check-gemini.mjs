import nextEnv from '@next/env';
import { GEMINI_API_VERSION, createGenerationBody, generationInput, generatedCards } from '../src/lib/gemini.ts';
import { generationSettings } from '../src/lib/server/generation-settings.ts';
import { geminiFailure } from '../src/lib/gemini-errors.ts';

// Metadata only by default. --generate makes ONE potentially billable request,
// with one card, a 1024-token output cap, no retries and no Firestore writes.
nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: () => {} });
const generate = process.argv.slice(2).includes('--generate');
function report(value) { console.log(JSON.stringify(value)); }
async function read(response) {
  let body;
  try { body = await response.json(); } catch { throw new Error('INVALID_PROVIDER_RESPONSE'); }
  if (!response.ok) {
    const failure = geminiFailure(response.status, body);
    report({ http: response.status, code: failure.code, guidance: failure.error });
    throw new Error('PROVIDER_REQUEST_FAILED');
  }
  return body;
}
try {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new Error('KEY_NOT_CONFIGURED');
  const { model } = generationSettings({ ...process.env, AI_PROVIDER: 'gemini' });
  const url = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${model}`;
  const metadata = await read(await fetch(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15000) }));
  if (metadata.name !== `models/${model}` || !metadata.supportedGenerationMethods?.includes('generateContent')) throw new Error('MODEL_METHOD_UNAVAILABLE');
  report({ check: 'model', model, apiVersion: GEMINI_API_VERSION, generateContentSupported: true });
  if (generate) {
    const body = await read(await fetch(`${url}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(createGenerationBody(generationInput.parse({ title: '물의 화학식', category: '과학', count: 1 }), 1024)),
      signal: AbortSignal.timeout(55000), cache: 'no-store',
    }));
    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
    let result;
    try { result = generatedCards.parse(JSON.parse(text)); } catch { throw new Error('INVALID_GENERATED_CARDS'); }
    if (candidate.finishReason !== 'STOP' || result.cards.length !== 1) throw new Error('INCOMPLETE_GENERATION');
    report({ check: 'generation', http: 200, model, apiVersion: GEMINI_API_VERSION, validCards: 1, usage: body.usageMetadata });
  }
} catch (cause) {
  // Never print exception messages, request headers, raw provider payloads or keys.
  const safeCodes = ['KEY_NOT_CONFIGURED', 'INVALID_PROVIDER_RESPONSE', 'PROVIDER_REQUEST_FAILED', 'MODEL_METHOD_UNAVAILABLE', 'INVALID_GENERATED_CARDS', 'INCOMPLETE_GENERATION'];
  report({ check: 'failed', code: cause?.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : safeCodes.includes(cause?.message) ? cause.message : 'CHECK_FAILED', generationRequested: generate });
  process.exitCode = 1;
}
