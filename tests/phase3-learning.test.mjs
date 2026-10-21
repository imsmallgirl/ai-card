import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleRating,ratingOf} from '../src/lib/review-schedule.ts';
import {studyInsights,shiftDay} from '../src/lib/study-insights.ts';
import {createReviewSession} from '../src/lib/review-session.ts';
import {generationInput,createGenerationBody} from '../src/lib/gemini.ts';
import {readPendingGeneration,pendingGenerationKey} from '../src/lib/generation-client.ts';
import {ADS_CONFIG,AD_PLACEMENTS} from '../src/lib/ad-slots.ts';

test('four ratings retain legacy boolean compatibility and produce bounded schedules',()=>{
  const now=1000;
  assert.deepEqual(scheduleRating(5,'again',now),{interval:0,due:61000});
  assert.equal(scheduleRating(5,'hard',now).interval,6);
  assert.equal(scheduleRating(5,'remember',now).interval,10);
  assert.equal(scheduleRating(5,'easy',now).interval,15);
  assert.equal(scheduleRating(0,'easy',now).interval,3);
  assert.deepEqual(scheduleRating(2,true,now),scheduleRating(2,'remember',now));
  assert.equal(ratingOf(false),'again');assert.ok(Number.isSafeInteger(scheduleRating(Number.MAX_SAFE_INTEGER,'easy',now).due));
});

test('streak, calendar and month/week counts use user day keys across DST and leap days',()=>{
  const reviews=[{date:'2026-10-18',correct:true,count:2},{date:'2026-10-19',correct:false},{date:'2026-10-20',correct:true,count:3},{date:'2026-09-30',correct:true,count:7}];
  const data=studyInsights([],reviews,'America/Los_Angeles',Date.UTC(2026,9,21,1));
  assert.equal(data.today,'2026-10-20');assert.equal(data.todayCount,3);assert.equal(data.streak,3);assert.equal(data.longest,3);assert.equal(data.week,6);assert.equal(data.month,6);assert.equal(data.total,13);
  assert.equal(data.calendar.length,84);assert.equal(data.calendar.at(-1).date,data.today);
  assert.equal(shiftDay('2024-02-28',1),'2024-02-29');assert.equal(shiftDay('2024-03-10',1),'2024-03-11');
  assert.equal(studyInsights([],reviews,'America/Los_Angeles',Date.UTC(2026,9,22,1)).streak,3);
  assert.equal(studyInsights([],reviews,'America/Los_Angeles',Date.UTC(2026,9,23,1)).streak,0);
});

test('favorites and wrong-card sessions use actual per-card records, preserving source indexes',()=>{
  const decks=[{id:'a',title:'A',category:'과학',cards:[{question:'old',answer:'a',due:0,interval:0},{question:'favorite',answer:'a',due:0,interval:0,favorite:true},{question:'wrong',answer:'a',due:0,interval:0,lastWrong:true,wrongCount:2,reviewCount:3}]}];
  assert.deepEqual(createReviewSession(decks,{filter:'favorite'}).entries.map(item=>item.index),[1]);
  assert.deepEqual(createReviewSession(decks,{filter:'wrong'}).entries.map(item=>item.index),[2]);
  assert.equal(createReviewSession(decks,{filter:'wrong',deckIds:[]}),null);
  const stats=studyInsights(decks,[],'Asia/Seoul',1000);
  assert.equal(stats.success,null);assert.equal(stats.categories[0].reviewed,3);assert.equal(stats.wrong.length,1);
});

test('purpose and difficulty have backward-compatible defaults and affect the provider prompt',()=>{
  const input=generationInput.parse({title:'면접',purpose:'면접 준비',difficulty:'고급'});
  const prompt=createGenerationBody(input).systemInstruction.parts[0].text;
  assert.match(prompt,/면접 준비/);assert.match(prompt,/고급/);
  assert.equal(generationInput.parse({title:'basic'}).difficulty,'초급');
  assert.equal(generationInput.safeParse({...input,difficulty:'invalid'}).success,false);
});

test('reviewed AI drafts and regeneration target survive reload without starting provider requests',()=>{
  const uid='a';const id=crypto.randomUUID();
  const draft={id,input:{title:'재생성',count:1},target:{deckId:'deck',index:2,cardId:'card',revision:5},saving:true,result:{cards:[{question:'검토한 질문',answer:'검토한 답'}],model:'test',requestId:id}};
  const pending=readPendingGeneration({getItem:key=>key===pendingGenerationKey(uid)?JSON.stringify(draft):null},uid);
  assert.equal(pending.result.cards[0].question,'검토한 질문');assert.equal(pending.target.revision,5);assert.equal(pending.saving,true);
});

test('ads remain disabled and review-card screens are not allowed placements',()=>{
  assert.equal(ADS_CONFIG.enabled,false);assert.deepEqual(AD_PLACEMENTS,['dashboard','deck-list','completion','landing']);
});

test('site origin accepts only configured HTTP origins and strips credentials/path',async()=>{
  const {siteOrigin}=await import('../src/lib/site-origin.ts');
  assert.equal(siteOrigin(''),undefined);
  assert.equal(siteOrigin('invalid'),undefined);assert.equal(siteOrigin('javascript:alert(1)'),undefined);
  assert.equal(siteOrigin('https://name:secret@example.com/path').href,'https://example.com/');
});

test('reviewed saves never drop edits when another device saved that request first; regeneration retry is safe',async()=>{
  const {assertReviewedDeck,regenerationState}=await import('../src/lib/generation-review.ts');
  assert.throws(()=>assertReviewedDeck({cards:[{question:'old',answer:'A'}]},[{question:'edited',answer:'A'}]),/다른 내용/);
  assert.doesNotThrow(()=>assertReviewedDeck({cards:[{question:'Q',answer:'A'}]},[{question:'Q',answer:'A'}]));
  const target={deckId:'deck',index:0,cardId:'card',revision:3};const result={question:'new Q',answer:'new A'};
  assert.equal(regenerationState(target,{id:'card',revision:3,question:'Q',answer:'A'},result),'apply');
  assert.equal(regenerationState(target,{id:'card',revision:4,...result},result),'confirmed');
  assert.throws(()=>regenerationState(target,{id:'card',revision:4,question:'other',answer:'other'},result),/변경/);
  assert.throws(()=>regenerationState(target,{id:'different',revision:3,...result},result),/찾을 수/);
});
