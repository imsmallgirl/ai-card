import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAnalytics } from '../src/lib/web-analytics-client.ts';
import { WEB_CONSENT_KEY, WEB_SEEN_KEY, WEB_ANALYTICS_POLICY, safePage, safeAcquisition, webAnalyticsConfig } from '../src/lib/web-analytics-model.ts';
import { createGa4Sender } from '../src/lib/server/analytics-export.ts';

function fixture(changes = {}) {
  const data = changes.data || new Map(), sent = [], loads = [];
  let tail = Promise.resolve();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
  let state, disabled = 0;
  const options = {
    enabled: true, measurementId: 'G-TEST123', origin: 'https://moa.example', storage,
    exclusive: run => { const next = tail.then(run); tail = next.catch(() => {}); return next; },
    context: () => ({ href: 'https://moa.example/?utm_source=google&utm_medium=cpc&email=private@example.com#SECRET', referrer: 'https://www.google.com/search?q=PRIVATE', pathname: '/' }),
    tag: { load: async config => loads.push(config), send: (name, params) => sent.push({ name, params }), disable: () => { disabled++; } },
    notify: value => { state = value; }, ...changes,
  };
  const client = createWebAnalytics(options);
  return { client, data, sent, loads, options, state: () => state, disabled: () => disabled };
}
const event = { name: 'cards_saved', method: 'ai', count_bucket: '1-5' };

test('activation requires explicit enable, reviewed manual-only stream, measurement ID and safe origin', () => {
  const env = { NEXT_PUBLIC_GA4_ENABLED: 'true', NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED: 'true', NEXT_PUBLIC_GA4_MEASUREMENT_ID: 'G-TEST123', NEXT_PUBLIC_SITE_ORIGIN: 'https://moa.example' };
  assert.equal(webAnalyticsConfig(env).enabled, true);
  for (const patch of [{ NEXT_PUBLIC_GA4_ENABLED: 'false' }, { NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED: 'false' }, { NEXT_PUBLIC_GA4_MEASUREMENT_ID: '' }, { NEXT_PUBLIC_SITE_ORIGIN: 'https://moa.example/?uid=PRIVATE' }]) assert.equal(webAnalyticsConfig({ ...env, ...patch }).enabled, false);
  assert.equal(createGa4Sender({ NEXT_PUBLIC_GA4_ENABLED: 'true', ANALYTICS_ENABLED: 'true', ANALYTICS_EXPORT_ENABLED: 'true', GA4_MEASUREMENT_ID: 'G-TEST123', GA4_API_SECRET: 'private' }), null);
});

test('no tag or event before consent, after denial, or when collection is disabled; no historical replay', async () => {
  const f = fixture(); await f.client.reload(); await f.client.track(event, 'before');
  await f.client.choose(false); await f.client.page('/', 'denied');
  assert.equal(f.loads.length, 0); assert.equal(f.sent.length, 0);
  await f.client.choose(true); assert.equal(f.sent.length, 0);
  await f.client.track(event, 'after'); assert.equal(f.sent.length, 1);
  f.client.stop();
  const off = fixture({ enabled: false }); await off.client.reload(); await off.client.choose(true); await off.client.track(event, 'off');
  assert.equal(off.loads.length, 0); assert.equal(off.sent.length, 0); off.client.stop();
});

test('only fixed paths and acquisition categories leave the browser; raw input and identifiers are rejected', async () => {
  assert.equal(safePage('/users/UID-PRIVATE/decks/CARD-PRIVATE'), '/other');
  assert.deepEqual(safeAcquisition('https://moa.example/?utm_source=EMAIL-PRIVATE&utm_medium=SECRET', ''), { source: 'other', medium: 'campaign', referral: '' });
  assert.deepEqual(safeAcquisition('https://moa.example/', 'https://www.google.co.kr/search?q=SECRET'), { source: 'google', medium: 'organic', referral: 'https://google.com/' });
  const f = fixture(); await f.client.choose(true);
  await f.client.page('/users/UID-PRIVATE', 'page');
  await f.client.track({ ...event, email: 'private@example.com', uid: 'UID-PRIVATE', title: 'CARD-PRIVATE', text: 'SECRET' }, 'bad');
  await f.client.track({ name: 'screen_view', screen_name: 'private@example.com' }, 'bad-screen');
  await f.client.track(event, 'UID-PRIVATE:internal-only');
  assert.equal(f.sent.length, 2);
  const output = JSON.stringify({ loads: f.loads, sent: f.sent });
  for (const value of ['private@example.com', 'UID-PRIVATE', 'CARD-PRIVATE', 'SECRET', 'utm_source', 'user_id']) assert.equal(output.includes(value), false, value);
  assert.equal(f.loads[0].send_page_view, false);
  assert.equal(f.loads[0].allow_google_signals, false);
  assert.match(f.loads[0].client_id, /^[0-9a-f-]{36}$/);
  f.client.stop();
});

test('concurrent repeated callbacks and reloads emit a logical action only once', async () => {
  const f = fixture(); await f.client.choose(true);
  await Promise.all([f.client.track(event, 'saved:stable-deck'), f.client.track(event, 'saved:stable-deck')]);
  assert.equal(f.sent.length, 1);
  f.client.stop();
  const reload = fixture({ data: f.data }); await reload.client.reload(); await reload.client.track(event, 'saved:stable-deck');
  assert.equal(reload.sent.length, 0);
  await reload.client.track({ name: 'screen_view', screen_name: 'dashboard' }, 'screen:1');
  await reload.client.track({ name: 'screen_view', screen_name: 'dashboard' }, 'screen:1');
  await reload.client.track({ name: 'screen_view', screen_name: 'decks' }, 'screen:2');
  await reload.client.track({ name: 'screen_view', screen_name: 'dashboard' }, 'screen:3');
  assert.equal(reload.sent.length, 3); reload.client.stop();
});

test('withdrawal is immediate, durable and rotates the random identity on regrant', async () => {
  const f = fixture(); await f.client.choose(true); const old = f.loads[0].client_id;
  await f.client.track(event, 'action');
  const withdrawn = f.client.choose(false); assert.equal(f.client.getState().granted, false); await withdrawn;
  assert.equal(JSON.parse(f.data.get(WEB_CONSENT_KEY)).clientId, undefined);
  assert.equal(f.data.has(WEB_SEEN_KEY), false);
  await f.client.track(event, 'after-withdrawal'); assert.equal(f.sent.length, 1);
  await f.client.choose(true); assert.notEqual(f.loads.at(-1).client_id, old); f.client.stop();
});

test('manual pageviews deduplicate effect replay and visibility reload but count real navigation', async () => {
  const f = fixture(); await f.client.choose(true);
  await Promise.all([f.client.page('/', 'page:document:0'), f.client.page('/', 'page:document:0')]);
  await f.client.reload(); await f.client.page('/', 'page:document:0');
  assert.equal(f.sent.length, 1);
  await f.client.page('/about', 'page:document:1');
  await f.client.page('/', 'page:document:2');
  assert.deepEqual(f.sent.map(value => value.name), ['page_view', 'page_view', 'page_view']);
  assert.ok(f.loads.every(config => config.send_page_view === false));
  await f.client.choose(false); await f.client.page('/', 'page:document:3');
  assert.equal(f.sent.length, 3);
  f.client.stop();
});

test('withdrawal during script load prevents queued events and stale grants from reactivating', async () => {
  let finish; const loading = new Promise(resolve => { finish = resolve; });
  const f = fixture({ tag: { load: () => loading, send: () => assert.fail('event after withdrawal'), disable: () => {} } });
  const grant = f.client.choose(true); await Promise.resolve();
  await f.client.choose(false); finish(); await grant;
  assert.equal(f.client.getState().granted, false); f.client.stop();
});

test('queued lock callbacks recheck cross-tab withdrawal before sending', async () => {
  let release;
  const f = fixture({ exclusive: run => new Promise(resolve => { release = () => { run(); resolve(); }; }) });
  await f.client.choose(true); const pending = f.client.track(event, 'waiting');
  f.data.set(WEB_CONSENT_KEY, JSON.stringify({ policy: WEB_ANALYTICS_POLICY, granted: false, expiresAt: Date.now() + 10000 }));
  release(); await pending; assert.equal(f.sent.length, 0); f.client.stop();
});

test('corrupt consent, expired consent, quota failure and tag failure all fail closed', async () => {
  const bad = fixture(); bad.data.set(WEB_CONSENT_KEY, '{'); await bad.client.reload(); assert.equal(bad.loads.length, 0); assert.equal(bad.client.getState().granted, false); bad.client.stop();
  let now = Date.now(); const expired = fixture({ clock: () => now }); await expired.client.choose(true); now += 91 * 86400000; await expired.client.reload(); await expired.client.track(event, 'expired'); assert.equal(expired.sent.length, 0); expired.client.stop();
  const full = fixture(); await full.client.choose(true); full.options.storage.setItem = () => { throw new Error('quota'); }; await full.client.track(event, 'full'); assert.equal(full.sent.length, 0); assert.equal(full.client.getState().granted, false); full.client.stop();
  const tag = fixture({ tag: { load: async () => { throw new Error('offline'); }, send: () => assert.fail(), disable: () => {} } }); await tag.client.choose(true); assert.equal(tag.client.getState().granted, false); tag.client.stop();
});

import { createWebTag } from '../src/lib/web-analytics-tag.ts';
test('an existing external Google tag blocks activation instead of adding a duplicate tag', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  globalThis.window = {};
  globalThis.document = { cookie: '', querySelector: () => ({ src: 'https://www.googletagmanager.com/gtm.js' }),
    createElement: () => assert.fail('Must not create a second tag') };
  const f = fixture({ measurementId: 'G-EXISTING', tag: createWebTag('G-EXISTING') });
  try {
    await f.client.choose(true); await f.client.page('/', 'page');
    assert.equal(f.client.getState().granted, false);
    assert.equal(globalThis.window['ga-disable-G-EXISTING'], true);
    assert.equal((globalThis.window.dataLayer || []).length, 0);
  } finally { f.client.stop(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('real tag adapter appends no script before consent and suppresses a load completed after withdrawal', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const scripts = [], cookies = [];
  globalThis.window = {};
  globalThis.document = {
    cookie: 'moa_ga=previous; unrelated=keep', querySelector: () => null,
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild: script => scripts.push(script) },
  };
  Object.defineProperty(globalThis.document, 'cookie', { configurable: true, get: () => 'moa_ga=previous; unrelated=keep', set: value => cookies.push(value) });
  const f = fixture({ measurementId: 'G-DOMONE', tag: createWebTag('G-DOMONE') });
  try {
    await f.client.reload(); await f.client.track(event, 'before'); assert.equal(scripts.length, 0);
    const grant = f.client.choose(true); assert.equal(scripts.length, 1);
    assert.equal(scripts[0].referrerPolicy, 'no-referrer');
    assert.equal(scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-DOMONE');
    await f.client.choose(false); scripts[0].onload(); await grant;
    assert.equal(globalThis.window['ga-disable-G-DOMONE'], true);
    assert.equal((globalThis.window.dataLayer || []).length, 0);
    assert.ok(cookies.every(value => value.startsWith('moa_ga=')));
  } finally { f.client.stop(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('tag adapter configures only safe data, disables automatic pageviews and reuses its loader', async () => {
  const previousWindow = globalThis.window, previousDocument = globalThis.document;
  const scripts = [];
  globalThis.window = {};
  globalThis.document = { cookie: '', querySelector: () => null, createElement: () => ({ dataset: {}, remove() {} }), head: { appendChild: script => scripts.push(script) } };
  const f = fixture({ measurementId: 'G-DOMTWO', tag: createWebTag('G-DOMTWO') });
  try {
    const grant = f.client.choose(true); scripts[0].onload(); await grant;
    await f.client.page('/', 'page'); await f.client.track(event, 'save');
    const commands = globalThis.window.dataLayer.map(value => Array.from(value));
    assert.deepEqual(commands[0], ['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }]);
    assert.equal(commands.find(value => value[0] === 'config')[2].send_page_view, false);
    assert.equal(commands.filter(value => value[0] === 'event').length, 2);
    assert.equal(JSON.stringify(commands).includes('private@example.com'), false);
    await f.client.reload(); assert.equal(scripts.length, 1);
    await f.client.choose(false); await f.client.track(event, 'withdrawn');
    assert.equal(globalThis.window.dataLayer.map(value => Array.from(value)).filter(value => value[0] === 'event').length, 2);
  } finally { f.client.stop(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
});

test('sanitized acquisition survives internal navigation/reload without retaining raw campaigns', async () => {
  const f = fixture(); await f.client.choose(true); f.client.stop();
  const again = fixture({ data: f.data, context: () => ({ href: 'https://moa.example/about', referrer: 'https://moa.example/', pathname: '/about' }) });
  await again.client.reload(); await again.client.page('/about', 'page:next');
  assert.equal(again.sent[0].params.acquisition_source, 'google');
  assert.equal(again.sent[0].params.acquisition_medium, 'cpc');
  assert.equal(JSON.stringify([...f.data]).includes('private@example.com'), false);
  assert.equal(JSON.stringify([...f.data]).includes('SECRET'), false);
  again.client.stop();
});
