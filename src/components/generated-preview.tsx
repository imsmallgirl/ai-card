'use client';
import type { CardContent } from '@/lib/card-content';
export default function GeneratedPreview({cards,change,locked}:{cards:CardContent[];change:(cards:CardContent[])=>void;locked:boolean}){
  return <section className="generated-preview"><h3>생성 결과 검토 · {cards.length}장</h3><p>아직 학습 덱에 저장되지 않았습니다. 내용을 확인하고 수정한 뒤 저장하세요. AI가 생성한 사실의 정확성은 보장되지 않습니다.</p>
    <fieldset className="generation-fields" disabled={locked}>{cards.map((card,index)=><fieldset className="manual-card" key={index}><legend>카드 {index+1}</legend>
      <label>질문<textarea required maxLength={500} value={card.question} onChange={event=>change(cards.map((item,i)=>i===index?{...item,question:event.target.value}:item))}/></label>
      <label>답<textarea required maxLength={2000} value={card.answer} onChange={event=>change(cards.map((item,i)=>i===index?{...item,answer:event.target.value}:item))}/></label>
      {card.explanation!==undefined&&<label>해설 · 학습 포인트<textarea maxLength={4000} value={card.explanation} onChange={event=>change(cards.map((item,i)=>i===index?{...item,explanation:event.target.value}:item))}/></label>}
      <button type="button" disabled={cards.length===1} onClick={()=>change(cards.filter((_,i)=>i!==index))}>카드 삭제</button>
    </fieldset>)}</fieldset>
  </section>;
}
