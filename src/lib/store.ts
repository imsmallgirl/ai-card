import { createStore } from 'zustand/vanilla';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { removeLegacySampleDecks } from './study-migration.ts';
export type Card = {
	question: string;
	answer: string;
	due: number;
	interval: number;
};
export type Deck = {
	id: string;
	title: string;
	category: string;
	color: string;
	cards: Card[];
	created: number;
};
export type StudyState = {
	decks: Deck[];
	reviews: { date: string; correct: boolean }[];
	addDeck: (deck: Deck) => void;
	removeDeck: (id: string) => void;
	rate: (id: string, index: number, correct: boolean) => void;
};
export function createStudyStore(uid: string, storage?: StateStorage) {
 return createStore<StudyState>()(
	persist(
		(set) => ({
			decks: [],
			reviews: [],
			addDeck: (deck) => set((s) => ({ decks: [deck, ...s.decks] })),
			removeDeck: (id) =>
				set((s) => ({ decks: s.decks.filter((d) => d.id !== id) })),
			rate: (id, index, correct) =>
				set((s) => ({
					reviews: [
						...s.reviews,
						{ date: new Date().toLocaleDateString('sv-SE'), correct },
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
													interval: correct ? Math.max(1, c.interval * 2) : 0,
													due:
														Date.now() +
														(correct
															? Math.max(1, c.interval * 2) * 86400000
															: 60000),
												},
									),
								},
					),
				})),
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
