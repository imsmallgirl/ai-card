import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import next from 'next';

// Production build only. No sign-in, credentials, AI calls or database operations.
process.env.NODE_ENV = 'production';
let app, server, origin;
before(async () => {
  app = next({ dev: false, quiet: true }); await app.prepare();
  server = http.createServer(app.getRequestHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { if(server) await new Promise(resolve => server.close(resolve)); if(app) await app.close(); });

test('anonymous HTML contains the complete public landing before client authentication resolves', async () => {
  const response = await fetch(origin); const html = await response.text();
  assert.equal(response.status, 200);
  for (const text of ['배운 순간을', '오래 기억하도록', '이용 방법', '시작하기 전에 궁금한 점', 'consistent는 어떤 뜻일까요?', '로그인 없이 체험', '개인정보 안내']) assert.ok(html.includes(text), `Missing public content: ${text}`);
  assert.equal(html.includes('class="sidebar"'), false);
  assert.ok(html.includes('name="description"'));
});
test('public information and login routes are accessible; policy drafts are labelled', async () => {
  for(const path of ['/about','/login','/privacy','/terms']) {
    const response=await fetch(origin+path); const html=await response.text();assert.equal(response.status,200,path);
    if(path==='/privacy'||path==='/terms'){assert.ok(html.includes('출시 전 안내 초안'));assert.ok(html.includes('noindex'));}
  }
});
test('removed sharing pages and APIs return 404', async () => {
  for(const path of ['/explore','/decks/'+ '0'.repeat(64),'/admin/reports','/api/public-decks','/api/publications','/api/admin/reports']) {
    const response=await fetch(origin+path);await response.text();assert.equal(response.status,404,path);
  }
});
test('anonymous users still cannot read private study data or generate cards', async () => {
  for(const path of ['/api/study','/api/usage','/api/generate','/api/account']) {
    const response=await fetch(origin+path,['/api/generate','/api/account'].includes(path)?{method:'POST',headers:{'content-type':'application/json'},body:'{}'}:{});
    const body=await response.json();assert.equal(response.status,401,path);assert.equal(body.code,'UNAUTHENTICATED');
  }
});

test('production applies security headers without exposing framework headers',async()=>{
 const response=await fetch(origin);await response.text();
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('x-frame-options'),'DENY');
 assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 assert.equal(response.headers.get('x-powered-by'),null);
});

test('liveness responds without private configuration or database access',async()=>{
 const response=await fetch(origin+'/api/health');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{status:'ok'});assert.equal(response.headers.get('cache-control'),'no-store');
});
