import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseConfig } from '../src/lib/release-config.ts';
import { goalProgress } from '../src/lib/study-goal.ts';
import { operationalLog } from '../src/lib/server/operational-log.ts';
import { createAccountDeleteHandler } from '../src/lib/server/account-http.ts';
import { AuthenticationError } from '../src/lib/server-auth.ts';
import { clearAccountStorage } from '../src/lib/account-storage.ts';
import { generationPolicy } from '../src/lib/server/generation-usage.ts';

const env={NEXT_PUBLIC_FIREBASE_API_KEY:'public-config',NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'example.firebaseapp.com',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'test',NEXT_PUBLIC_FIREBASE_APP_ID:'app',FIREBASE_PROJECT_ID:'test',FIRESTORE_SYNC_ENABLED:'true',NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED:'true',AI_PROVIDER:'gemini',AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake-server-secret',AI_GENERATION_UNLIMITED:'false',SITE_URL:'https://example.com',SITE_OPERATOR_NAME:'테스트 운영자',SUPPORT_EMAIL:'test@example.com',PRIVACY_POLICY_CONFIRMED:'true'};

test('release checks reject unsafe production settings without printing values',()=>{
  assert.deepEqual(releaseConfig(env),[]);
  for(const [patch,code] of [
    [{FIREBASE_PROJECT_ID:'other'},'PROJECT_MISMATCH'],[{SITE_URL:'http://localhost:3000'},'SITE_URL_REQUIRED'],
    [{AI_PROVIDER:'mock'},'MOCK_IN_PRODUCTION'],[{AI_GENERATION_UNLIMITED:'true'},'UNLIMITED_IN_PRODUCTION'],
    [{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8787'},'EMULATOR_IN_PRODUCTION'],[{FIRESTORE_SYNC_ENABLED:'false'},'SYNC_DISABLED'],
    [{NEXT_PUBLIC_GEMINI_API_KEY:'DO_NOT_LEAK'},'PUBLIC_SECRET'],[{GEMINI_API_KEY:''},'AI_KEY_REQUIRED'],
    [{AI_DAILY_LIMIT:'-1'},'INVALID_BUDGET'],[{PRIVACY_POLICY_CONFIRMED:'false'},'POLICY_REVIEW_REQUIRED'],
  ]){const result=releaseConfig({...env,...patch});assert.ok(result.some(item=>item.code===code),code);assert.equal(JSON.stringify(result).includes('DO_NOT_LEAK'),false);assert.equal(JSON.stringify(result).includes('fake-server-secret'),false);}
  assert.equal(releaseConfig({...env,AI_GENERATION_ENABLED:'false',GEMINI_API_KEY:''}).some(item=>item.level==='error'),false);
});

test('goal percentage is shared, capped, rounded and handles invalid inputs',()=>{
  assert.equal(goalProgress(5,20),25);assert.equal(goalProgress(30,20),100);assert.equal(goalProgress(1,3),33);
  assert.equal(goalProgress(-1,20),0);assert.equal(goalProgress(1,0),0);assert.equal(goalProgress(NaN,20),0);
});

test('hosted development cannot enable the local unlimited bypass',()=>{
  for(const flag of [{VERCEL:'1'},{K_SERVICE:'backend'},{NETLIFY:'true'}])assert.equal(generationPolicy({NODE_ENV:'development',AI_GENERATION_UNLIMITED:'true',...flag}).unlimited,false);
  assert.equal(generationPolicy({NODE_ENV:'development',AI_GENERATION_UNLIMITED:'true'}).unlimited,true);
});

test('operational logs contain fixed categories and random IDs, not exception content or user identifiers',()=>{
  let line='';const id=operationalLog('DO_NOT_LEAK','DO_NOT_LEAK',value=>{line=value;});
  const parsed=JSON.parse(line);assert.equal(parsed.id,id);assert.equal(parsed.area,'next');assert.equal(parsed.code,'UNEXPECTED_FAILURE');assert.equal(line.includes('DO_NOT_LEAK'),false);
  assert.deepEqual(Object.keys(parsed).sort(),['area','at','code','event','id']);
});

const request=body=>new Request('https://test/api/account',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('account deletion requires authentication, recent login and explicit confirmation; only verified UID is used',async()=>{
  const now=Date.now();let removed=[];
  const remove=async uid=>{removed.push(uid);};
  const handler=auth_time=>createAccountDeleteHandler({authenticate:async()=>({uid:'own',auth_time}),remove,clock:()=>now});
  assert.equal((await handler(now/1000-301)(request({confirmation:'DELETE_MY_ACCOUNT'}))).status,401);
  assert.equal((await handler(now/1000)(request({}))).status,400);assert.deepEqual(removed,[]);
  const denied=createAccountDeleteHandler({authenticate:async()=>{throw new AuthenticationError();},remove});
  assert.equal((await denied(request({confirmation:'DELETE_MY_ACCOUNT'}))).status,401);
  const response=await handler(now/1000)(request({confirmation:'DELETE_MY_ACCOUNT',uid:'someone-else'}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(removed,['own']);
});

test('deletion removes only this account browser cache and owned legacy backups',()=>{
  const values=new Map([['moa-study-user-own','private'],['moa-study-user-other','keep'],['moa-study-cloud-v2-own','cache'],['moa-study-import-backup-own','backup'],['moa-generation-pending-own','prompt'],['moa-analytics-consent-own','consent'],['moa-study-legacy-owner','own'],['moa-study-v1','legacy']]);
  clearAccountStorage({getItem:key=>values.get(key)||null,removeItem:key=>values.delete(key)},'own');
  assert.deepEqual([...values],[['moa-study-user-other','keep']]);
});
