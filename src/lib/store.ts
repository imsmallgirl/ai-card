import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { cardMetadata, type CardMetadata } from './card-content.ts';
import { scheduleRating, ratingOf, type Rating } from './review-schedule.ts';
import { removeLegacySampleDecks } from './study-migration.ts';
export type Card = CardMetadata & {
  completedAt?:number; studyCount?:number;
  favorite?: boolean; deleted?: boolean; reviewCount?:number; wrongCount?:number; lastWrong?:boolean; lastRating?:Rating;
	id?: string;
	revision?: number;
	question: string;
	answer: string;
	due: number;
	interval: number;
};
export type Deck = {
  legacyOriginalId?:string;
  purpose?:'개념 암기'|'면접 준비'|'시험 대비'|'심화 이해'; difficulty?:'초급'|'중급'|'고급';
	storage?: 'local' | 'cloud';
	id: string;
	title: string;
	category: string;
	color: string;
	cards: Card[];
	created: number;
	revision?: number;
};
export type CardAction = {type:'add'; question:string;answer:string;metadata?:CardMetadata} | {type:'delete';index:number} | {type:'favorite';index:number;favorite:boolean} | {type:'move';index:number;direction:-1|1};
export type StudyState = {
  importedReviews?: {date:string;correct?:boolean;count:number}[];
  completeCard?: (deckId:string,index:number,completionId:string,original?:Card)=>void|Promise<void>;
  manageCard?: (deckId:string, action:CardAction)=>Promise<void>;
  updateSettings?: (dailyGoal:number,timeZone:string)=>Promise<void>;

	decks: Deck[];
	reviews: { id?:string; date: string; correct?: boolean; count?: number }[];
  dailyGoal?: number;
  timeZone?: string;
  sync?: { mode: 'local' | 'cloud'; pending: number; busy: boolean; error: string };
  retrySync?: () => void;
  discardPending?: () => void;
  confirmDeck?: (id: string) => Promise<void>;
	updateCard?: (deckId: string, index: number, question: string, answer: string, original?:Card, metadata?:CardMetadata) => void | Promise<void>;
	addDeck: (deck: Deck) => void | Promise<void>;
	removeDeck: (id: string) => void | Promise<void>;
	rate: (id: string, index: number, correct: boolean | Rating, original?: Card) => void | Promise<void>;
};
export function createStudyStore(uid: string, storage?: StateStorage) {
 return createStore<StudyState>()(
	persist(
		(set, get) => ({
      completeCard:(id,index,completionId)=>{
        if(get().reviews.some(item=>item.id===completionId))return;
        const card=get().decks.find(deck=>deck.id===id)?.cards[index];
        if(!card)throw new Error('카드를 찾을 수 없습니다.');
        const now=Date.now();
        set(state=>({reviews:[...state.reviews,{id:completionId,date:new Intl.DateTimeFormat('sv-SE',{timeZone:state.timeZone||'Asia/Seoul'}).format(now)}],decks:state.decks.map(deck=>deck.id===id?{...deck,cards:deck.cards.map((item,i)=>i===index?{...item,completedAt:now,studyCount:(item.studyCount||0)+1}:item)}:deck)}));
      },
      dailyGoal:20, timeZone:'Asia/Seoul',
      updateSettings:async(dailyGoal,timeZone)=>{if(!Number.isInteger(dailyGoal)||dailyGoal<1||dailyGoal>1000)throw new Error('목표는 1~1000장입니다.');new Intl.DateTimeFormat('en',{timeZone});set({dailyGoal,timeZone});},
      manageCard:async(id,action)=>{const deck=get().decks.find(d=>d.id===id);if(!deck)throw new Error('덱을 찾을 수 없습니다.');let cards=[...deck.cards];if(action.type==='add'){if(cards.length>=2000)throw new Error('한 덱은 최대 2000장입니다.');if(!action.question.trim()||!action.answer.trim()||action.question.length>500||action.answer.length>2000)throw new Error('질문과 답의 길이를 확인해 주세요.');cards.push({...cardMetadata.parse(action.metadata||{}),id:crypto.randomUUID(),question:action.question.trim(),answer:action.answer.trim(),due:0,interval:0});}else{if(!cards[action.index])throw new Error('카드를 찾을 수 없습니다.');if(action.type==='delete'){if(cards.length<=1)throw new Error('최소 한 장은 남겨 주세요.');cards.splice(action.index,1);}else if(action.type==='favorite')cards[action.index]={...cards[action.index],favorite:action.favorite};else{const target=action.index+action.direction;if(target<0||target>=cards.length)return;[cards[action.index],cards[target]]=[cards[target],cards[action.index]];}}set({decks:get().decks.map(d=>d.id===id?{...d,cards}:d)});},
			decks: [],
			reviews: [],
			updateCard: (deckId, index, question, answer, original, metadata) => {
        const extra=metadata?cardMetadata.parse(metadata):{};
        const current=get().decks.find(deck=>deck.id===deckId)?.cards[index];
        if(original&&(!current||current.question!==original.question||current.answer!==original.answer))throw new Error('다른 곳에서 카드가 변경되었습니다. 다시 열어 확인해 주세요.');
				if (!question.trim() || !answer.trim() || question.trim().length > 500 || answer.trim().length > 2000) throw new Error('질문은 1~500자, 답은 1~2,000자로 입력해 주세요.');
				set(s => ({ decks: s.decks.map(deck => deck.id === deckId ? { ...deck, cards: deck.cards.map((card, i) => i === index ? { ...card, ...extra, question: question.trim(), answer: answer.trim(), ...((card.question!==question.trim()||card.answer!==answer.trim()||(extra.explanation!==undefined&&extra.explanation!==(card.explanation||'')))?{due:0,interval:0,completedAt:undefined}:{}) } : card) } : deck) }));
			},
			addDeck: (deck) => { set((s) => ({ decks: s.decks.some(current => current.id === deck.id) ? s.decks : [deck, ...s.decks] })); },
			removeDeck: (id) => {
				set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })); },
			rate: (id, index, correct) => {
				set((s) => !s.decks.find(d => d.id === id)?.cards[index] ? s : ({
					reviews: [
						...s.reviews,
						{ date: new Intl.DateTimeFormat('sv-SE',{timeZone:get().timeZone||'Asia/Seoul'}).format(new Date()), correct:ratingOf(correct)!=='again' },
					],
					decks: s.decks.map((d) =>
						d.id !== id
							? d
							: {
									...d,
									cards: d.cards.map((c, i) =>
										i !== index
											? c
											: {
													...c,
													...scheduleRating(c.interval,correct), reviewCount:(c.reviewCount||0)+1, wrongCount:(c.wrongCount||0)+Number(ratingOf(correct)==='again'), lastWrong:ratingOf(correct)==='again', lastRating:ratingOf(correct),
												},
									),
								},
					),
				})); },
		}),
		{
      name: `moa-study-user-${uid}`,
      storage: createJSONStorage(() => storage || localStorage),
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Pick<StudyState, 'decks' | 'reviews'>;
        return { ...state, decks: removeLegacySampleDecks(state.decks || []) };
      },
    },
	),
);

}
