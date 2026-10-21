'use client';
import { useRef, useState } from 'react';
import {useDialogAccessibility} from './use-dialog-accessibility';
import { PenLine, Plus, Trash2, X } from 'lucide-react';
import { ZodError } from 'zod';
import { STUDY_CATEGORIES } from '@/lib/categories';
import { createManualDeck, saveManualDeck } from '@/lib/manual-deck';
import type { Deck, StudyState } from '@/lib/store';
import DeckCreationMode, { type CreationMode } from './deck-creation-mode';

export default function ManualDeckDialog({ open, close, changeMode, store, color, saved }: {
  open: boolean; close: () => void; changeMode: (mode: CreationMode) => void;
  store: Pick<StudyState, 'addDeck' | 'confirmDeck'>; color: string;
  saved: (deck: Deck) => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('기타');
  const [cards, setCards] = useState([{ question: '', answer: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<Deck | null>(null);
  const submitting = useRef(false);
  // Preserve drafts across mode switches. The parent remounts every creation form on dismissal.
  const dialogRef=useRef<HTMLElement>(null);useDialogAccessibility(dialogRef,open,close,busy);
  if (!open) return null;
  const locked = busy || Boolean(attempt.current);
  function update(index: number, field: 'question' | 'answer', value: string) {
    setCards(current => current.map((card, i) => i === index ? { ...card, [field]: value } : card));
  }
  return <div className="overlay" onClick={() => !busy && close()}>
    <section ref={dialogRef} className="modal manual-deck-modal" role="dialog" aria-modal="true" aria-labelledby="manual-title" onClick={event => event.stopPropagation()}>
      <button className="close" aria-label="닫기" disabled={busy} onClick={close}><X size={21}/></button>
      <span className="modal-icon"><PenLine/></span><h2 id="manual-title">내가 만드는 학습 덱</h2>
      <p>기억하고 싶은 내용을 질문과 답으로 직접 정리해 보세요.</p>
      <DeckCreationMode value="manual" change={changeMode} disabled={busy}/>
      <form onSubmit={async event => {
        event.preventDefault(); if (submitting.current) return;
        submitting.current = true; setBusy(true); setError('');
        try {
          const deck = attempt.current ?? createManualDeck({ title, category, cards }, color);
          attempt.current = deck;
          await saveManualDeck(deck, store);
          attempt.current = null; setTitle(''); setCategory('기타'); setCards([{ question: '', answer: '' }]);
          saved(deck);
        } catch (cause) {
          setError(cause instanceof ZodError ? cause.issues[0].message : cause instanceof Error ? cause.message : '저장하지 못했습니다. 다시 시도해 주세요.');
        } finally { submitting.current = false; setBusy(false); }
      }}>
        <fieldset className="generation-fields" disabled={locked}>
          <label>학습 덱 이름<input autoFocus required maxLength={80} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 나만의 여행 영어"/></label>
          <label>카테고리<select value={category} onChange={event => setCategory(event.target.value)}>{STUDY_CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
          <div className="manual-cards-heading"><h3>학습 카드</h3><span>{cards.length} / 20장</span></div>
          {cards.map((card, index) => <fieldset className="manual-card" key={index}>
            <legend>카드 {index + 1}</legend>
            <label>질문<textarea required maxLength={500} rows={2} value={card.question} onChange={event => update(index, 'question', event.target.value)} placeholder="무엇을 기억하고 싶나요?"/></label>
            <label>답<textarea required maxLength={2000} rows={3} value={card.answer} onChange={event => update(index, 'answer', event.target.value)} placeholder="질문의 정답이나 설명을 입력하세요."/></label>
            <button className="manual-remove" type="button" disabled={cards.length === 1} aria-label={`카드 ${index + 1} 삭제`} onClick={() => setCards(current => current.filter((_, i) => i !== index))}><Trash2 size={15}/>이 카드 삭제</button>
          </fieldset>)}
          <button className="soft-button manual-add" type="button" disabled={cards.length >= 20} onClick={() => setCards(current => [...current, { question: '', answer: '' }])}><Plus size={17}/>카드 추가</button>
        </fieldset>
        <small>1~20장까지 만들 수 있어요. AI를 호출하지 않으며 AI 생성 횟수도 사용하지 않습니다.</small>
        {error && <p className="error" role="alert">{error}</p>}
        {attempt.current && !busy && <p className="manual-save-note" role="status">저장 요청이 보존되어 있습니다. 중복 생성을 막기 위해 입력을 잠갔습니다. 같은 덱으로 저장을 다시 확인해 주세요.</p>}
        <button className="primary generate" type="submit" disabled={busy}><PenLine size={17}/>{busy ? '덱을 저장하는 중…' : attempt.current ? '같은 덱 저장 다시 확인' : '학습 덱 저장하기'}</button>
      </form>
    </section>
  </div>;
}
