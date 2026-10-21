import { createStore, type StoreApi } from 'zustand/vanilla';
import type { StudyState } from './store.ts';

// Existing local records stay on this device. All newly created decks go to cloud.
export function combineStudyStores(local: StoreApi<StudyState>, cloud: StoreApi<StudyState>) {
  let stopped = false;
  const isLocal = (id: string) => !cloud.getState().decks.some(deck => deck.id === id) && local.getState().decks.some(deck => deck.id === id);
  const owner = (id: string) => {
    if (stopped) throw new Error('계정이 변경되었습니다.');
    return isLocal(id) ? local.getState() : cloud.getState();
  };
  const snapshot = (): StudyState => {
    const remote = cloud.getState();
    const legacy = local.getState();
    const imported=new Map((remote.importedReviews||[]).map(item=>[`${item.date}:${item.correct}`,item.count]));
    const remaining=legacy.reviews.flatMap(item=>{const key=`${item.date}:${item.correct}`;const count=item.count??1;const removed=Math.min(count,imported.get(key)||0);imported.set(key,(imported.get(key)||0)-removed);return count>removed?[{...item,count:count-removed}]:[];});
    return {
      ...remote,
      decks: [...remote.decks, ...legacy.decks.filter(deck => !remote.decks.some(other => other.id === deck.id||other.legacyOriginalId===deck.id)).map(deck => ({ ...deck, storage: 'local' as const }))],
      reviews: [...remote.reviews, ...remaining],
      removeDeck: id => owner(id).removeDeck(id),
      completeCard:(id,index,completionId,original)=>owner(id).completeCard!(id,index,completionId,original),
      rate: (id, index, correct, original) => owner(id).rate(id, index, correct, original),
      manageCard:(id,action)=>owner(id).manageCard!(id,action),
      updateCard: (id, index, question, answer, original, metadata) => owner(id).updateCard?.(id, index, question, answer, original, metadata),
    };
  };
  const store = createStore<StudyState>(() => snapshot());
  const publish = () => store.setState(snapshot());
  const unsubscribeLocal = local.subscribe(publish);
  const unsubscribeCloud = cloud.subscribe(publish);
  return { store, stop: () => { stopped = true; unsubscribeLocal(); unsubscribeCloud(); } };
}
