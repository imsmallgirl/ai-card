import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeckPrint } from '../src/lib/deck-print.ts';
const deck={title:'한글 학습 <script>제목</script>',cards:[{question:'질문 하나\n긴 질문',answer:'정답 하나',explanation:'해설 하나'},{question:'질문 둘',answer:'정답 둘',explanation:'해설 둘'}]};
test('study export selects cards in deck order with answers and optional explanations',()=>{
  const html=buildDeckPrint(deck,[1,0,1],'study');
  assert.ok(html.indexOf('질문 하나')<html.indexOf('질문 둘'));
  assert.match(html,/정답 하나/);assert.match(html,/해설 둘/);
  assert.equal((html.match(/<article>/g)||[]).length,2);
  assert.equal(buildDeckPrint(deck,[1],'study',false).includes('해설 둘'),false);
  assert.equal(buildDeckPrint(deck,[1],'study').includes('질문 하나'),false);
  assert.throws(()=>buildDeckPrint(deck,[],'study'));
  assert.throws(()=>buildDeckPrint(deck,[100],'study'));
});
test('exam export moves answers behind all questions and supplies writing space',()=>{
  const html=buildDeckPrint(deck,[0,1],'exam');
  assert.ok(html.indexOf('정답 하나')>html.indexOf('질문 둘'));
  assert.match(html,/class="answer-key"/);assert.match(html,/class="writing-space"/);
  assert.match(html,/break-before:page/);assert.match(html,/white-space:pre-wrap/);
});
test('export escapes user content and has no external resources, scripts or private metadata',()=>{
  const html=buildDeckPrint({...deck,uid:'PRIVATE_UID',email:'PRIVATE_EMAIL',cards:[{question:'<img src=x onerror="alert(1)">',answer:'</p><script>steal()</script>',explanation:'A & B'}]},[0],'study');
  assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img '),false);
  assert.match(html,/&lt;img/);assert.match(html,/A &amp; B/);
  assert.equal(html.includes('PRIVATE_UID'),false);assert.equal(html.includes('PRIVATE_EMAIL'),false);
  assert.match(html,/default-src 'none'/);assert.match(html,/@page\{size:A4/);
});
