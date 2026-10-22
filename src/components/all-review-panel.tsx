'use client';

import { useState } from 'react';
import { ArrowRight, Layers, Plus, Shuffle } from 'lucide-react';
import { collectReviewEntries } from '@/lib/review-session';
import type { Deck } from '@/lib/store';

export default function AllReviewPanel({ decks, excludedIds, onExcludedChange, onStart, onCreate }: {
  decks: Deck[];
  excludedIds: string[];
  onExcludedChange: (ids: string[]) => void;
  onStart: (options: { dueOnly: boolean; shuffle: boolean; quiz: boolean; deckIds: string[] }) => void;
  onCreate: () => void;
}) {
  const [dueOnly, setDueOnly] = useState(false);
  const [shuffle, setShuffle] = useState(true);
  const [quiz, setQuiz] = useState(false);
  const total = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const selectedDecks = decks.filter(deck => !excludedIds.includes(deck.id));
  const selectedTotal = selectedDecks.reduce((sum, deck) => sum + deck.cards.length, 0);
  const due = selectedDecks.reduce((sum, deck) => sum + deck.cards.filter(card => card.due <= Date.now()).length, 0);
  const selected = collectReviewEntries(selectedDecks,dueOnly).length;
  return <section className="all-review-panel panel">
    <div className="all-review-heading"><span className="stat-icon purple"><Layers size={26}/></span><div><span className="eyebrow">ONE SESSION, ALL YOUR DECKS</span><h2>공부할 덱을 골라 복습해요</h2><p>원하는 덱만 선택해 하나의 세션으로 공부하세요. 제외한 덱의 카드는 나오지 않아요.</p></div></div>
    {!total ? <div className="empty"><span className="empty-icon"><Layers size={32}/></span><h3>먼저 나만의 학습 덱을 만들어 보세요</h3><p>학습 카드가 생기면 이곳에서 모든 덱을 함께 복습할 수 있어요.</p><button className="primary" onClick={onCreate}><Plus size={18}/>새 학습 덱 만들기</button></div> : <>
      <div className="review-scope" role="group" aria-label="복습할 카드 범위">
        <button className={!dueOnly ? 'scope-selected' : ''} aria-pressed={!dueOnly} onClick={() => setDueOnly(false)}><strong>모든 카드</strong><span>복습 예정일과 관계없이 {selectedTotal}장</span></button>
        <button className={dueOnly ? 'scope-selected' : ''} aria-pressed={dueOnly} onClick={() => setDueOnly(true)}><strong>오늘 복습할 카드</strong><span>지금 복습할 때가 된 {due}장</span></button>
      </div>
      <div className="review-options"><label><input type="checkbox" checked={shuffle} onChange={event => setShuffle(event.target.checked)}/><Shuffle size={17}/>카드 순서 섞기</label><label><input type="checkbox" checked={quiz} onChange={event => setQuiz(event.target.checked)}/>주관식 퀴즈로 공부하기</label></div>
      <div className="review-deck-picker">
        <div className="review-deck-heading"><h3>공부할 학습 덱</h3><div><button type="button" onClick={() => onExcludedChange([])}>전체 선택</button><button type="button" onClick={() => onExcludedChange(decks.map(deck => deck.id))}>전체 해제</button></div></div>
        <div className="review-deck-list">{decks.map(deck => <label key={deck.id} className={!excludedIds.includes(deck.id) ? 'review-deck-option is-selected' : 'review-deck-option'}>
          <input type="checkbox" checked={!excludedIds.includes(deck.id)} onChange={event => onExcludedChange(event.target.checked ? excludedIds.filter(id => id !== deck.id) : [...excludedIds, deck.id])}/>
          <span>{deck.title}</span><small>{dueOnly ? deck.cards.filter(card => card.due <= Date.now()).length : deck.cards.length}장</small>
        </label>)}</div>
      </div>
      <div className="all-review-start"><p role="status">{!selectedDecks.length ? '복습할 학습 덱을 하나 이상 선택해 주세요.' : selected ? '선택한 덱의 카드만 복습해요. 학습 기록은 원래 덱에 저장됩니다.' : '선택한 덱에 오늘 복습할 카드가 없어요. 모든 카드로 바꾸거나 다른 덱을 선택해 주세요.'}</p><button className="primary" disabled={!selected} onClick={() => onStart({ dueOnly, shuffle, quiz, deckIds: selectedDecks.map(deck => deck.id) })}>{selected ? `총 ${selected}장 복습 시작` : '복습 시작하기'}<ArrowRight size={18}/></button></div>
    </>}
  </section>;
}
