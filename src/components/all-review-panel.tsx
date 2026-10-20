'use client';

import { useState } from 'react';
import { ArrowRight, Layers, Plus, Shuffle } from 'lucide-react';
import type { Deck } from '@/lib/store';

export default function AllReviewPanel({ decks, onStart, onCreate }: {
  decks: Deck[];
  onStart: (options: { dueOnly: boolean; shuffle: boolean; quiz: boolean }) => void;
  onCreate: () => void;
}) {
  const [dueOnly, setDueOnly] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [quiz, setQuiz] = useState(false);
  const total = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const due = decks.reduce((sum, deck) => sum + deck.cards.filter(card => card.due <= Date.now()).length, 0);
  const selected = dueOnly ? due : total;
  return <section className="all-review-panel panel">
    <div className="all-review-heading"><span className="stat-icon purple"><Layers size={26}/></span><div><span className="eyebrow">ONE SESSION, ALL YOUR DECKS</span><h2>모든 배움을 한 번에 복습해요</h2><p>덱을 옮겨 다닐 필요 없이, 모든 덱의 카드를 하나의 세션으로 공부하세요.</p></div></div>
    {!total ? <div className="empty"><span className="empty-icon"><Layers size={32}/></span><h3>먼저 나만의 학습 덱을 만들어 보세요</h3><p>학습 카드가 생기면 이곳에서 모든 덱을 함께 복습할 수 있어요.</p><button className="primary" onClick={onCreate}><Plus size={18}/>새 학습 덱 만들기</button></div> : <>
      <div className="review-scope" role="group" aria-label="복습할 카드 범위">
        <button className={!dueOnly ? 'scope-selected' : ''} aria-pressed={!dueOnly} onClick={() => setDueOnly(false)}><strong>모든 카드</strong><span>복습 예정일과 관계없이 {total}장</span></button>
        <button className={dueOnly ? 'scope-selected' : ''} aria-pressed={dueOnly} onClick={() => setDueOnly(true)}><strong>오늘 복습할 카드</strong><span>지금 복습할 때가 된 {due}장</span></button>
      </div>
      <div className="review-options"><label><input type="checkbox" checked={shuffle} onChange={event => setShuffle(event.target.checked)}/><Shuffle size={17}/>카드 순서 섞기</label><label><input type="checkbox" checked={quiz} onChange={event => setQuiz(event.target.checked)}/>주관식 퀴즈로 공부하기</label></div>
      <div className="included-decks"><h3>함께 공부할 학습 덱</h3><div>{decks.map(deck => <span key={deck.id}>{deck.title}<small>{dueOnly ? deck.cards.filter(card => card.due <= Date.now()).length : deck.cards.length}장</small></span>)}</div></div>
      <div className="all-review-start"><div><strong>{decks.length}개 덱 · {selected}장</strong><p>{selected ? '학습 결과는 각 카드가 속한 원래 덱에 저장돼요.' : '오늘 복습할 카드를 모두 마쳤어요. 모든 카드를 선택하면 다시 공부할 수 있어요.'}</p></div><button className="primary" disabled={!selected} onClick={() => onStart({ dueOnly, shuffle, quiz })}>전체 복습 시작하기<ArrowRight size={18}/></button></div>
    </>}
  </section>;
}
