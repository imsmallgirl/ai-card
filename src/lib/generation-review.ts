import { sameCardContent, type CardContent } from './card-content.ts';
import type { Card, Deck } from './store.ts';
import type { PendingGeneration } from './generation-client.ts';
export function assertReviewedDeck(existing:Deck|undefined,cards:CardContent[]) {
  if(existing&&(existing.cards.length!==cards.length||existing.cards.some((card,index)=>!sameCardContent(card,cards[index]))))throw new Error('같은 요청의 덱이 다른 내용으로 이미 저장되었습니다. 검토 내용은 보존됩니다. 기존 덱에서 수정해 주세요.');
}
export function regenerationState(target:NonNullable<PendingGeneration['target']>,current:Card|undefined,result:CardContent):'apply'|'confirmed' {
  if(!current||current.id!==target.cardId)throw new Error('원래 카드를 찾을 수 없습니다. 검토 결과는 보존됩니다.');
  const same=sameCardContent(current,{...current,...result});
  if(target.revision!==undefined){
    if(current.revision===target.revision+1&&same)return 'confirmed';
    if(current.revision===target.revision)return 'apply';
  }else{
    if(same)return 'confirmed';
    if(current.question===target.originalQuestion&&current.answer===target.originalAnswer)return 'apply';
  }
  throw new Error('원래 카드가 변경되었습니다. 검토 결과를 보관하고 기존 카드를 다시 확인해 주세요.');
}
