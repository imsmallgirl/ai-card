'use client';
import { STUDY_CATEGORIES } from '@/lib/categories';
import type { MaterialCard } from '@/lib/material-parser';
export type MaterialPreviewCard=MaterialCard&{included:boolean;tagsText?:string};
export default function MaterialCardPreview({cards,change,locked}:{cards:MaterialPreviewCard[];change:(cards:MaterialPreviewCard[])=>void;locked:boolean}){
  function update(index:number,patch:Partial<MaterialPreviewCard>){change(cards.map((card,i)=>i===index?{...card,...patch}:card));}
  return <section className="material-preview" aria-label="저장 전 카드 미리보기"><h3 aria-live="polite">미리보기 · {cards.filter(card=>card.included).length} / {cards.length}장 선택</h3><p>아직 저장되지 않았어요. 질문·답을 원본과 비교하고 수정한 뒤 저장하세요. 체크를 해제한 카드는 저장에서 제외됩니다.</p>
    <fieldset className="generation-fields" disabled={locked}>{cards.map((card,index)=><fieldset className={`manual-card ${!card.included?'material-excluded':''}`} key={index}>
      <legend><label className="material-include"><input type="checkbox" checked={card.included} onChange={event=>update(index,{included:event.target.checked})}/>카드 {index+1} 저장에 포함</label></legend>
      <label>질문<textarea required={card.included} maxLength={500} value={card.question} onChange={event=>update(index,{question:event.target.value})}/></label>
      <label>답변<textarea required={card.included} maxLength={2000} rows={3} value={card.answer} onChange={event=>update(index,{answer:event.target.value})}/></label>
      {!card.answer&&<small className="material-warning">원본에서 답을 찾지 못했습니다. 직접 입력하거나 이 카드를 제외하세요.</small>}
      <label>해설 · 학습 포인트<textarea maxLength={4000} rows={2} value={card.explanation||''} onChange={event=>update(index,{explanation:event.target.value})}/></label>
      <div className="material-classification"><label>카테고리<select value={card.category||'기타'} onChange={event=>update(index,{category:event.target.value as MaterialCard['category']})}>{STUDY_CATEGORIES.map(item=><option key={item}>{item}</option>)}</select></label>
      <label>난이도<select value={card.difficulty||''} onChange={event=>update(index,{difficulty:(event.target.value||undefined) as MaterialCard['difficulty']})}><option value="">미지정</option>{['초급','중급','고급'].map(item=><option key={item}>{item}</option>)}</select></label></div>
      <label>주제 태그 · 쉼표로 구분<input maxLength={327} value={card.tagsText??(card.tags||[]).join(', ')} onChange={event=>update(index,{tagsText:event.target.value,tags:event.target.value.split(',').map(tag=>tag.trim()).filter(Boolean)})}/></label>
      <small>태그 최대 8개, 각 40자. 분류 근거가 부족하면 기타/미지정으로 남겨 둡니다.</small>
    </fieldset>)}</fieldset>
  </section>;
}
