import { z } from 'zod';
import { cardContent, metadataOf } from './card-content.ts';
import { STUDY_CATEGORIES } from './categories.ts';
import type { Deck, StudyState } from './store.ts';
export const materialDeckInput=z.object({
  title:z.string().trim().min(1,'덱 이름을 입력해 주세요.').max(80),
  category:z.enum(STUDY_CATEGORIES),
  cards:z.array(cardContent).min(1,'저장할 카드를 한 장 이상 선택해 주세요.').max(200),
});
export function createMaterialDeck(input:unknown,color:string):Deck {
  const parsed=materialDeckInput.parse(input);
  const deck:Deck={...parsed,id:`material-${crypto.randomUUID()}`,color,created:Date.now(),cards:parsed.cards.map(card=>({...card,due:0,interval:0}))};
  const placeholder='00000000-0000-4000-8000-000000000000';
  const command={type:'createDeck',mutationId:placeholder,deck:{id:deck.id,title:deck.title,category:deck.category,color:deck.color},cards:deck.cards.map(card=>({id:placeholder,question:card.question,answer:card.answer,...metadataOf(card)}))};
  if(new TextEncoder().encode(JSON.stringify(command)).length>65536)throw new Error('저장 요청의 64KiB 한도를 넘었습니다. 카드를 일부 제외하거나 자료를 나누어 저장해 주세요.');
  return deck;
}
export async function saveMaterialDeck(deck:Deck,store:Pick<StudyState,'addDeck'|'confirmDeck'>){
  await store.addDeck(deck);await store.confirmDeck?.(deck.id);
}
