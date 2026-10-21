import test from 'node:test';
import assert from 'node:assert/strict';
import { generationInput, generatedCards, createGenerationBody, requestGemini, geminiFailure } from '../src/lib/gemini.ts';

const input = generationInput.parse({ title: '영어 기초 동사', category: '외국어' });
const options = () => ({ key: 'test-key', model: 'test-model', input, signal: AbortSignal.timeout(5000) });

test('title and category are enough; notes remain optional', () => {
  assert.equal(input.text, '');
  assert.equal(generationInput.safeParse({ title: '   ' }).success, false);
  assert.equal(generationInput.safeParse({ title: '생물', text: '세포' }).success, true);
  assert.equal(generationInput.safeParse({ title: '생물', category: 'invalid' }).success, false);
  assert.equal(generationInput.safeParse({ title: '생물', text: 'a'.repeat(15001) }).success, false);
});

test('topic generation includes category; notes select source-based generation', () => {
  const topic = createGenerationBody(input);
  assert.match(topic.contents[0].parts[0].text, /외국어/);
  assert.match(topic.systemInstruction.parts[0].text, /학습 자료가 없어도/);
  const source = createGenerationBody({ ...input, text: 'My source note' });
  assert.match(source.contents[0].parts[0].text, /My source note/);
  assert.match(source.systemInstruction.parts[0].text, /자료에 없는 단어를 추가하지/);
});

test('transient 503 recovers after bounded retries with unchanged input', async () => {
  const statuses = [503, 503, 200];
  const bodies = [];
  const response = await requestGemini(options(), async (_url, init) => {
    bodies.push(init.body);
    return new Response('{}', { status: statuses.shift() });
  });
  assert.equal(response.status, 200);
  assert.equal(bodies.length, 3);
  assert.equal(new Set(bodies).size, 1);
});

test('persistent 503 stops after three attempts', async () => {
  let calls = 0;
  const response = await requestGemini(options(), async () => {
    calls++;
    return new Response('{}', { status: 503 });
  });
  assert.equal(calls, 3);
  assert.equal(response.status, 503);
  assert.equal(geminiFailure(response.status).code, 'PROVIDER_UNAVAILABLE');
});

test('authentication, quota and model errors are not retried', async () => {
  for (const status of [400, 403, 404, 429]) {
    let calls = 0;
    const response = await requestGemini(options(), async () => {
      calls++;
      return new Response('{}', { status });
    });
    assert.equal(calls, 1);
    assert.equal(response.status, status);
  }
});

test('aborted request makes no provider calls; empty cards are rejected', async () => {
  let calls = 0;
  await assert.rejects(requestGemini({ ...options(), signal: AbortSignal.abort() }, async () => { calls++; return new Response('{}'); }));
  assert.equal(calls, 0);
  assert.equal(generatedCards.safeParse({ cards: [] }).success, false);
});

test('question count accepts only integers between one and twenty', () => {
  for (const count of [1, 5, 10, 15, 20]) assert.equal(generationInput.safeParse({ ...input, count }).success, true);
  for (const count of [0, 21, 2.5, '20', null]) assert.equal(generationInput.safeParse({ ...input, count }).success, false);
  const body = createGenerationBody({ ...input, count: 20 });
  assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.equal(body.generationConfig.responseFormat.text.schema.properties.cards.type, 'array');
  assert.equal(body.generationConfig.responseJsonSchema, undefined);
  assert.equal(body.generationConfig.responseMimeType, undefined);
  assert.match(body.systemInstruction.parts[0].text, /정확히 20개/);
  const cards = Array.from({ length: 20 }, (_, i) => ({ question: `Q${i}`, answer: `A${i}` }));
  assert.equal(generatedCards.safeParse({ cards }).success, true);
  assert.equal(generatedCards.safeParse({ cards: [...cards, cards[0]] }).success, false);
});

test('expanded subject categories work in both creation modes', () => {
  for (const category of ['수학', '프로그래밍·IT', '자격증·시험', '의학·간호', '경영·경제']) {
    const parsed = generationInput.parse({ ...input, category });
    assert.ok(createGenerationBody(parsed).contents[0].parts[0].text.includes(category));
  }
});

test('material AI must choose an existing category based on source, without being anchored to a previous category',()=>{
  const body=createGenerationBody(generationInput.parse({mode:'material',title:'퀴즈',category:'역사·지리',text:'소다와 식초, 염기성과 산성의 반응은?',count:3}));
  const category=body.generationConfig.responseFormat.text.schema.properties.cards.items.properties.category;
  assert.ok(category.enum.includes('과학'));assert.ok(category.enum.includes('역사·지리'));
  assert.equal(category.enum.includes('화학'),false);
  assert.match(body.systemInstruction.parts[0].text,/화학·산성·염기성·물리·생물은 과학/);
  assert.doesNotMatch(body.contents[0].parts[0].text,/카테고리: 역사·지리/);
});

test('English vocabulary requests produce word/meaning instructions despite the default concept-memorization purpose',async()=>{
  const {isEnglishVocabulary,validVocabularyCards}=await import('../src/lib/vocabulary-generation.ts');
  for(const title of ['영어단어외우기','영단어 암기','토익 필수 단어','영어 기초 동사','English vocabulary']){
    const request=generationInput.parse({title,category:'외국어'});
    assert.equal(isEnglishVocabulary(request),true);
    const prompt=createGenerationBody(request).systemInstruction.parts[0].text;
    assert.match(prompt,/question에는 외울 영어 단어 또는 숙어만/);
    assert.match(prompt,/answer에는 한국어 뜻과 품사/);
    assert.match(prompt,/이론 질문은 만들지 마세요/);
  }
  assert.equal(isEnglishVocabulary(generationInput.parse({title:'영어 문법 현재완료'})),false);
  assert.equal(isEnglishVocabulary(generationInput.parse({title:'영어 단어',mode:'material',text:'Q: 명사란?\nA: 사물의 이름.'})),false);
  assert.equal(validVocabularyCards([{question:'achieve',answer:'달성하다 (동사)'},{question:'look after',answer:'돌보다'}]),true);
  assert.equal(validVocabularyCards([{question:'영어에서 명사란 무엇인가요?',answer:'사람이나 사물의 이름입니다.'}]),false);
});
