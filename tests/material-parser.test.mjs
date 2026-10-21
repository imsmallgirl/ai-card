import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMaterial,classifyMaterial} from '../src/lib/material-parser.ts';
import {createMaterialDeck,materialDeckInput} from '../src/lib/material-deck.ts';
import {STUDY_CATEGORIES} from '../src/lib/categories.ts';
import {cardContent,sameCardContent} from '../src/lib/card-content.ts';
import {analyzeMaterial} from '../src/lib/material-analysis.ts';
import {createGenerationHandlers} from '../src/lib/server/generation-http.ts';
import {generationMemoryDatabase} from './helpers/generation-db.mjs';
import {readGenerationUsage,generationPolicy} from '../src/lib/server/generation-usage.ts';

test('numbered interview questions preserve original answers, split explanations, and never call AI',()=>{
  const before=globalThis.fetch;let calls=0;globalThis.fetch=()=>{calls++;throw new Error('must not call AI');};
  try{
    const source='1. React의 특징은?\n답변: 컴포넌트 기반 UI입니다.\n- 재사용이 가능합니다.\n-> 선언적으로 UI를 표현한다는 점이 중요합니다.\n\n2) 상태란 무엇인가요?\n정답: 컴포넌트가 기억하는 데이터입니다.';
    const {cards}=parseMaterial(source);
    assert.equal(cards.length,2);assert.equal(cards[0].question,'React의 특징은?');
    assert.equal(cards[0].answer,'컴포넌트 기반 UI입니다.\n- 재사용이 가능합니다.');
    assert.equal(cards[0].explanation,'선언적으로 UI를 표현한다는 점이 중요합니다.');
    assert.equal(cards[1].answer,'컴포넌트가 기억하는 데이터입니다.');assert.equal(calls,0);
    assert.equal(cards[0].category,'프로그래밍·IT');assert.ok(cards[0].tags.includes('React'));
  }finally{globalThis.fetch=before;}
});

test('Markdown questions, answer headings, Q/A and explanation headings stay separate',()=>{
  const parsed=parseMaterial('# 면접 노트\n## 1. React란 무엇인가요?\n### 답변\nUI 라이브러리입니다.\n### 학습 포인트\n컴포넌트에 주목합니다.\n## 2. HTTP란?\nA: 통신 프로토콜입니다.\n→ 요청과 응답을 살펴보세요.');
  assert.equal(parsed.cards.length,2);assert.equal(parsed.cards[0].question,'React란 무엇인가요?');
  assert.equal(parsed.cards[0].answer,'UI 라이브러리입니다.');assert.equal(parsed.cards[0].explanation,'컴포넌트에 주목합니다.');
  assert.equal(parsed.cards[1].explanation,'요청과 응답을 살펴보세요.');assert.ok(parsed.warnings.some(value=>value.includes('포함하지')));
});

test('Q/A keeps multiline questions, nested answer lists, fenced code and line breaks',()=>{
  const source='Q1: 다음 코드를 설명하세요.\n두 가지 특징을 말하세요.\nA1: 예시는 다음과 같습니다.\n```js\nQ: not a question\n1. inside code\n```\n  1. 첫째\n  2. 둘째\n- 해설: 원본 코드입니다.\n\nQ2: 다음 질문?\nA2: 다음 답변.';
  const {cards}=parseMaterial(source);assert.equal(cards.length,2);
  assert.equal(cards[0].question,'다음 코드를 설명하세요.\n두 가지 특징을 말하세요.');
  assert.match(cards[0].answer,/Q: not a question\n1. inside code/);assert.match(cards[0].answer,/  1\. 첫째\n  2\. 둘째/);
  assert.equal(cards[0].explanation,'원본 코드입니다.');
});

test('missing answers remain editable, unstructured notes are not turned into invented cards',()=>{
  const {cards,warnings}=parseMaterial('Q: 답이 없는 질문?\nQ: 답이 있는 질문?\nA: 실제 답.');
  assert.equal(cards.length,2);assert.equal(cards[0].answer,'');assert.ok(warnings.some(value=>value.includes('답이 없습니다')));
  assert.equal(materialDeckInput.safeParse({title:'덱',category:'기타',cards}).success,false);
  assert.equal(parseMaterial('오늘 수업에서는 세포를 공부했다.\n중요한 내용은 다음과 같다.').cards.length,0);
});

test('answer numbering does not split contiguous numbered answer lists',()=>{
  const {cards}=parseMaterial('Q: 순서는?\nA: 다음 순서입니다.\n1. 첫째\n2. 둘째\n마지막 문장.\nQ: 다음 문제?\nA: 정답.');
  assert.equal(cards.length,2);assert.match(cards[0].answer,/1\. 첫째\n2\. 둘째\n마지막 문장/);
});

test('classification uses existing categories, is conservative and editable before saving',()=>{
  assert.equal(classifyMaterial('난이도: 고급\nReact 최적화 면접').difficulty,'고급');
  assert.equal(classifyMaterial('알 수 없는 주제').category,'기타');assert.equal(classifyMaterial('알 수 없는 주제').difficulty,undefined);
  assert.ok(STUDY_CATEGORIES.includes(classifyMaterial('광합성 세포').category));
  const parsed=parseMaterial('Q: React란?\nA: UI 라이브러리.');
  const deck=createMaterialDeck({title:'분류 수정',category:'과학',cards:parsed.cards.map(card=>({...card,category:'과학',tags:['직접 지정'],difficulty:'중급'}))},'purple');
  assert.equal(deck.category,'과학');assert.deepEqual(deck.cards[0].tags,['직접 지정']);assert.equal(deck.cards[0].difficulty,'중급');
});

test('rules support more than 20 questions without silently truncating, and enforce explicit safety limits',()=>{
  const source=Array.from({length:25},(_,i)=>`Q${i+1}: 질문 ${i+1}?\nA${i+1}: 답 ${i+1}`).join('\n');
  const parsed=parseMaterial(source);assert.equal(parsed.cards.length,25);
  assert.equal(createMaterialDeck({title:'25장',category:'기타',cards:parsed.cards},'blue').cards.length,25);
  assert.throws(()=>parseMaterial('a'.repeat(60001)),/60,000/);
  assert.throws(()=>parseMaterial(Array.from({length:201},(_,i)=>`Q: ${i}?\nA: a`).join('\n')),/200/);
  assert.throws(()=>createMaterialDeck({title:'큰 자료',category:'기타',cards:Array.from({length:15},()=>({question:'Q',answer:'가'.repeat(2000)}))},'blue'),/64KiB/);
});

test('old cards remain compatible; explanation and metadata distinguish reviewed results',()=>{
  assert.equal(cardContent.safeParse({question:'Q',answer:'A'}).success,true);
  assert.equal(sameCardContent({question:'Q',answer:'A',explanation:'old'},{question:'Q',answer:'A',explanation:'new'}),false);
  assert.equal(cardContent.safeParse({question:'Q',answer:'A',tags:Array(9).fill('tag')}).success,false);
  assert.equal(cardContent.safeParse({question:'Q',answer:'A',category:'invalid'}).success,false);
});

test('explicit AI material analysis uses the authenticated budget API, resumes once, and fails without disturbing rule output',async()=>{
  const db=generationMemoryDatabase();let providerCalls=0;const now=Date.UTC(2026,9,21);
  const handler=createGenerationHandlers({authenticate:async()=>({uid:'material'}),database:()=>db,clock:()=>now,
    environment:()=>({NODE_ENV:'production',AI_PROVIDER:'gemini',AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake',AI_COOLDOWN_SECONDS:'0',AI_FAILURE_COOLDOWN_SECONDS:'0'}),
    fetcher:async()=>{providerCalls++;return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'과학 개념 학습',cards:[{question:'원본 질문?',answer:'원본 답.',explanation:'원본 해설.',category:'과학',tags:['세포'],difficulty:'초급'}]})}]}}]});}});
  const fetcher=(url,init)=>handler(new Request(`https://test${url}`,init),String(url).startsWith('/api/generation-requests/')?'result':'generate',String(url).split('/').at(-1));
  const pending={id:crypto.randomUUID(),input:{mode:'material',title:'시험 자료',text:'Q: 원본 질문?\nA: 원본 답.\n-> 원본 해설.',count:20}};
  const result=await analyzeMaterial(pending,async()=>'fake-token',new AbortController().signal,fetcher);
  assert.equal(result.title,'과학 개념 학습');assert.equal(result.cards[0].explanation,'원본 해설.');assert.equal(providerCalls,1);
  await analyzeMaterial(pending,async()=>'fake-token',new AbortController().signal,fetcher);assert.equal(providerCalls,1);
  assert.equal((await readGenerationUsage(db,'material',generationPolicy({}),now)).charged,1);
  const rules=parseMaterial('Q: 원본 질문?\nA: 원본 답.');const original=structuredClone(rules);
  await assert.rejects(analyzeMaterial({...pending,id:crypto.randomUUID()},async()=>'fake-token',new AbortController().signal,async()=>Response.json({error:'API 실패',code:'RESOURCE_EXHAUSTED'},{status:429})),/API 실패/);
  assert.deepEqual(rules,original);assert.equal(parseMaterial(pending.input.text).cards.length,1);
});

test('AI extraction replaces the whole preview with AI content and requires complete classification',async()=>{
  const {mergeMaterialAnalysis}=await import('../src/lib/material-analysis.ts');
  const source='Q: 원본 질문?\nA: 원본 답.\n-> 원본 해설.\nQ: 이전에 추출된 질문?';
  const result=[{question:'AI가 추출한 질문?',answer:'AI 정답',explanation:'AI 해설',category:'과학',tags:['과학 퀴즈'],difficulty:'중급'}];
  const replaced=mergeMaterialAnalysis(source,result);
  assert.deepEqual(replaced.cards,result);assert.equal(replaced.cards.length,1);
  assert.equal(replaced.cards.some(card=>card.question==='이전에 추출된 질문?'),false);
  for(const patch of [{category:undefined},{category:null},{difficulty:undefined},{difficulty:null},{tags:undefined},{tags:[]}]){
    assert.throws(()=>mergeMaterialAnalysis(source,[{...result[0],...patch}]),/카테고리·태그·난이도/);
  }
  // Editing or excluding a previous rule preview cannot leak into a new AI preview.
  result[0].answer='changed after validation';assert.equal(replaced.cards[0].answer,'AI 정답');
});

test('structured materials over the AI cap are routed to free extraction before any API request',async()=>{
  const source=Array.from({length:21},(_,i)=>`Q: 질문 ${i}?\nA: 답 ${i}.`).join('\n');let requests=0;
  await assert.rejects(analyzeMaterial({id:crypto.randomUUID(),input:{mode:'material',title:'21장',text:source,count:20}},async()=>'token',new AbortController().signal,async()=>{requests++;throw new Error();}),/한도/);
  assert.equal(requests,0);assert.equal(parseMaterial(source).cards.length,21);
});

test('document title followed by labelled questions is context, not an extra empty card',()=>{
  const result=parseMaterial('# 면접 자료\n\nQ1: React란?\nA1: UI 라이브러리.');
  assert.equal(result.cards.length,1);assert.equal(result.cards[0].question,'React란?');
});

test('Korean multiple-choice paste preserves choices and separates inline or standalone answer keys without AI',()=>{
  const source=`33. 소다는 염기성이고 식초는 산성입니다. 염기성과 산성이 만나면 무엇이 발생할까요?

1. 산소 2. 수소 3. 황소 4. 이산화탄소
정답 : 4. 이산화탄소

34. 옥수수를 뜨거운 열에 가하면 커집니다. 그렇지만 옥수수에 바늘로 구멍을 내면 커지지 않습니다. 바로 이게 빠져나가서 그렇습니다. 이건 뭘까요?
1번, 단백질 2번, 당분 3번, 소금 4번, 수분 정답 : 4, 수분

35. 풍선들 위에 올라서기는 힘의 어떤 원리를 이용할까요?
1번 마찰의 원리 2번 중력의 원리 3번 부력의 원리 4번 분산의 원리
정답 : 4, 분산의 원리`;
  const {cards,warnings}=parseMaterial(source);
  assert.equal(cards.length,3);
  assert.deepEqual(cards.map(card=>card.answer),['4. 이산화탄소','4, 수분','4, 분산의 원리']);
  assert.match(cards[0].question,/1\. 산소 2\. 수소 3\. 황소 4\. 이산화탄소/);
  assert.match(cards[1].question,/1번, 단백질 2번, 당분 3번, 소금 4번, 수분$/);
  assert.match(cards[2].question,/4번 분산의 원리$/);
  assert.ok(cards.every(card=>!card.question.includes('정답')));
  assert.equal(warnings.length,0);
  assert.ok(cards.every(card=>cardContent.safeParse(card).success));
});

test('separate choice lines remain in question; missing answer is not guessed; explanation is separate',()=>{
  const {cards}=parseMaterial('1. 맞는 것은?\n1. 산소\n2. 수소\n3. 이산화탄소\n정답: 3\n-> 원문 해설\n2. 다음 질문?\n① 하나\n② 둘');
  assert.equal(cards.length,2);assert.match(cards[0].question,/1\. 산소\n2\. 수소\n3\. 이산화탄소/);
  assert.equal(cards[0].answer,'3');assert.equal(cards[0].explanation,'원문 해설');
  assert.match(cards[1].question,/① 하나\n② 둘/);assert.equal(cards[1].answer,'');
});

test('material AI rejects incomplete classification before saving a draft and requests required metadata',async()=>{
  const db=generationMemoryDatabase();let calls=0;
  const handler=createGenerationHandlers({authenticate:async()=>({uid:'metadata-check'}),database:()=>db,
    environment:()=>({NODE_ENV:'production',AI_PROVIDER:'gemini',AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake'}),
    fetcher:async(_url,init)=>{
      calls++;const schema=JSON.parse(init.body).generationConfig.responseFormat.text.schema;
      assert.deepEqual(schema.properties.cards.items.required,['question','answer','category','tags','difficulty']);
      return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({cards:[{question:'Q?',answer:'A'}]})}]}}]});
    }});
  const id=crypto.randomUUID();
  const response=await handler(new Request('https://test/api/generate',{method:'POST',headers:{'content-type':'application/json','idempotency-key':id},body:JSON.stringify({mode:'material',title:'자료',text:'Q: Q?\nA: A',count:1})}),'generate');
  assert.equal(response.status,422);assert.equal(calls,1);
  assert.equal(db.get(`users/metadata-check/generationDrafts/${id}`),undefined);
});

test('science quiz keywords select science rather than unrelated history',()=>{
  const source='33. 소다는 염기성이고 식초는 산성입니다. 만나면 무엇이 발생할까요?\n1. 산소 2. 수소 3. 황소 4. 이산화탄소\n정답: 4. 이산화탄소';
  const parsed=parseMaterial(source);
  assert.equal(parsed.classification.category,'과학');assert.equal(parsed.cards[0].category,'과학');
});

const quiz4042=`40. 다음 중 조선시대의 발명가 장영실이 만든것이 아닌것은?
1. 해시계 2. 간의 3. 측우기 4. 체중계

41. 다음 중 탄성력과 관계없는 것은 무엇일까요?
1. 활을 쏠 때 화살을 당긴다. 2. 양말을 신을 때 늘어난다.
3. 공을 하늘로 던지면 땅으로 떨어진다.
4. 볼펜에는 용수철이 있다.

42. 우리 귀에 소리가 전달되는 건 어떤 힘이 작용해서 일까요?
1. 중력 2. 관성의 법칙 3. 원심력 4. 진동
정답 ; 4번 진동`;

test('40–42 quiz separates all questions and multiline choices, supports semicolon answers without inventing missing keys',()=>{
  const {cards}=parseMaterial(quiz4042);
  assert.equal(cards.length,3);
  assert.equal(cards[0].answer,'');assert.equal(cards[1].answer,'');assert.equal(cards[2].answer,'4번 진동');
  assert.match(cards[1].question,/3\. 공을 하늘로 던지면 땅으로 떨어진다/);
  assert.match(cards[1].question,/4\. 볼펜에는 용수철이 있다/);
  assert.doesNotMatch(cards[0].question,/탄성력/);assert.doesNotMatch(cards[1].question,/우리 귀/);
});

test('material AI preserves generated title on replay and refuses merged or omitted questions without automatic extra calls',async()=>{
  for(const count of [3,2]){
    const db=generationMemoryDatabase();let calls=0;
    const handler=createGenerationHandlers({authenticate:async()=>({uid:'quiz'}),database:()=>db,
      environment:()=>({NODE_ENV:'production',AI_PROVIDER:'gemini',AI_GENERATION_ENABLED:'true',GEMINI_API_KEY:'fake'}),
      fetcher:async(_url,init)=>{
        calls++;const body=JSON.parse(init.body);
        assert.ok(body.generationConfig.responseFormat.text.schema.required.includes('title'));
        assert.match(body.contents[0].parts[0].text,/총 3개/);
        assert.match(body.systemInstruction.parts[0].text,/정답이 없는 객관식 문제는/);
        const cards=parseMaterial(quiz4042).cards.slice(0,count).map((card,index)=>({...card,answer:card.answer||`테스트용 풀이 ${index}`,category:'과학',tags:['테스트'],difficulty:'초급',explanation:card.answer?'원문 정답':'AI 풀이: 테스트용 근거'}));
        return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({title:'발명과 힘·소리 퀴즈',cards})}]}}]});
      }});
    const id=crypto.randomUUID();
    const response=await handler(new Request('https://test/api/generate',{method:'POST',headers:{'content-type':'application/json','idempotency-key':id},body:JSON.stringify({mode:'material',title:'입력 자료 분석',text:quiz4042,count:20})}),'generate');
    const body=await response.json();
    assert.equal(calls,1);
    if(count===3){
      assert.equal(response.status,200);assert.equal(body.title,'발명과 힘·소리 퀴즈');assert.equal(body.cards.length,3);
      const replay=await handler(new Request('https://test'),'result',id);
      assert.equal((await replay.json()).title,body.title);assert.equal(calls,1);
    }else{
      assert.equal(response.status,422);assert.equal(body.code,'MATERIAL_QUESTION_MISMATCH');
      assert.equal(db.get(`users/quiz/generationDrafts/${id}`),undefined);
    }
  }
});
