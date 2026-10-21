import { createStore } from 'zustand/vanilla';
import { metadataOf } from './card-content.ts';
import { ratingOf, scheduleRating } from './review-schedule.ts';
import type { Card, Deck, StudyState } from './store.ts';
import { cloudCommand, reviewDate, type CloudCommand, type CloudSnapshot } from './study-cloud-model.ts';
import { cloudStorageKey, pullCloudSnapshot, readCloudDisk, type CloudTransport } from './study-cloud-client.ts';

type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
export function cloudView(snapshot: CloudSnapshot, pending: CloudCommand[]) {
  const cardsByDeck=new Map<string,CloudSnapshot['cards']>();
  for(const card of snapshot.cards)if(!card.deleted){const cards=cardsByDeck.get(card.deckId)||[];cards.push(card);cardsByDeck.set(card.deckId,cards);}
  const decks: Deck[] = snapshot.decks.filter(deck => !deck.deleted && !deck.importing).map(deck => ({
    ...deck, storage: 'cloud' as const, cards: (cardsByDeck.get(deck.id)||[]).sort((a,b)=>a.order-b.order||a.id.localeCompare(b.id)),
  })).sort((a,b)=>b.created-a.created||a.id.localeCompare(b.id));
  const reviews: StudyState['reviews'] = snapshot.dailyStats.flatMap(day => [
    { date: day.id, correct: true, count: day.correct }, { date: day.id, correct: false, count: day.count - day.correct - (day.completed||0) },
    ...(day.completed?[{date:day.id,count:day.completed}]:[]),
  ]);
  const profile = snapshot.settings.find(settings => settings.id === 'profile');
  const importedReviews=snapshot.dailyStats.flatMap(day=>[{date:day.id,correct:true,count:day.importedCorrect||0},{date:day.id,correct:false,count:(day.importedCount||0)-(day.importedCorrect||0)-(day.importedCompleted||0)},...(day.importedCompleted?[{date:day.id,count:day.importedCompleted}]:[])]);
  return { decks, reviews, importedReviews, dailyGoal: profile?.dailyGoal || 20, timeZone: profile?.timeZone || 'Asia/Seoul', pending };
}

export function createCloudStudyStore(uid: string, storage: Storage, transport: CloudTransport) {
  let disk = readCloudDisk(storage, uid);
  let stopped = false;
  let running: Promise<void> | null = null;
  let error = '';
  let conflict = false;
  const store = createStore<StudyState>(() => ({
    ...cloudView(disk.snapshot, disk.pending),
    sync: { mode: 'cloud', busy: false, pending: disk.pending.length, error: '' },
    updateSettings:async(dailyGoal,timeZone)=>{
      const profile=disk.snapshot.settings.find(item=>item.id==='profile');
      await confirmed({type:'settings',mutationId:crypto.randomUUID(),expectedRevision:profile?.revision||0,dailyGoal,timeZone});
    },
    manageCard:async(deckId,action)=>{
      if(disk.pending.length)throw new Error('먼저 대기 중인 변경을 동기화해 주세요.');
      const deck=store.getState().decks.find(item=>item.id===deckId);
      if(!deck||deck.revision===undefined)throw new Error('동기화 후 다시 시도해 주세요.');
      if(action.type==='add')await confirmed({type:'addCard',mutationId:crypto.randomUUID(),deckId,expectedRevision:deck.revision,card:{...metadataOf(action.metadata||{}),id:crypto.randomUUID(),question:action.question,answer:action.answer}});
      else{
        const card=deck.cards[action.index];if(!card?.id||card.revision===undefined)throw new Error('카드를 찾을 수 없습니다.');
        if(action.type==='move'){
          const ids=deck.cards.map(item=>item.id!);const target=action.index+action.direction;
          if(target<0||target>=ids.length)return;[ids[action.index],ids[target]]=[ids[target],ids[action.index]];
          await confirmed({type:'reorder',mutationId:crypto.randomUUID(),deckId,expectedRevision:deck.revision,cardIds:ids});
        }else if(action.type==='delete')await confirmed({type:'deleteCard',mutationId:crypto.randomUUID(),deckId,cardId:card.id,expectedRevision:card.revision});
        else await confirmed({type:'favorite',mutationId:crypto.randomUUID(),deckId,cardId:card.id,expectedRevision:card.revision,favorite:action.favorite});
      }
    },
    addDeck: async deck => {
      if (disk.snapshot.decks.some(current => current.id === deck.id) || disk.pending.some(command => command.type === 'createDeck' && command.deck.id === deck.id)) return;
      enqueue({ type: 'createDeck', mutationId: crypto.randomUUID(), deck: {
        id: deck.id, title: deck.title, category: deck.category, color: deck.color, ...(deck.purpose?{purpose:deck.purpose}:{}), ...(deck.difficulty?{difficulty:deck.difficulty}:{}),
      }, cards: deck.cards.map((card, index) => ({ id: /^ai-[0-9a-f-]{36}$/.test(deck.id) ? `${deck.id}-${index}` : crypto.randomUUID(), question: card.question, answer: card.answer, ...metadataOf(card) })) });
    },
    confirmDeck: async id => {
      await sync();
      if (stopped) throw new Error('계정이 변경되었습니다.');
      if (disk.pending.some(command => command.type === 'createDeck' && command.deck.id === id)) throw new Error(error || '클라우드 저장을 확인하지 못했습니다. 입력 내용은 보존됩니다. 같은 요청으로 다시 저장해 주세요.');
      if (!disk.snapshot.decks.some(deck => deck.id === id && !deck.deleted)) throw new Error('클라우드에서 저장된 덱을 확인하지 못했습니다. 다시 시도해 주세요.');
    },
    updateCard: async (deckId, index, question, answer, original, metadata) => {
      const card = original || store.getState().decks.find(deck => deck.id === deckId)?.cards[index];
      if (!card?.id || card.revision === undefined) throw new Error('동기화 후 수정해 주세요.');
      if (disk.pending.some(command => 'cardId' in command && command.cardId === card.id)) throw new Error('이 카드의 이전 변경을 동기화한 후 수정해 주세요.');
      const mutationId = crypto.randomUUID();
      enqueue({ type: 'updateCard', mutationId, deckId, cardId: card.id, expectedRevision: card.revision, question, answer, ...metadataOf(metadata||{}) });
      await sync();
      if (disk.pending.some(command => command.mutationId === mutationId)) throw new Error(error || '수정 내용을 전송 대기 중입니다. 동기화를 다시 확인해 주세요.');
    },
    removeDeck: async deckId => {
      const deck = disk.snapshot.decks.find(deck => deck.id === deckId && !deck.deleted);
      if (!deck) throw new Error('아직 클라우드에 저장되지 않은 덱입니다. 동기화 후 다시 시도해 주세요.');
      enqueue({ type: 'deleteDeck', mutationId: crypto.randomUUID(), deckId, expectedRevision: deck.revision });
    },
    completeCard:async(deckId,index,completionId,original)=>{
      const card=original||store.getState().decks.find(deck=>deck.id===deckId)?.cards[index];
      if(!card?.id||card.revision===undefined)throw new Error('동기화 후 다시 시도해 주세요.');
      if(!disk.pending.some(item=>item.mutationId===completionId))enqueue({type:'completeCard',mutationId:completionId,deckId,cardId:card.id,expectedRevision:card.revision});
      await sync();
      if(stopped||disk.pending.some(item=>item.mutationId===completionId))throw new Error(error||'학습 완료를 전송 대기 중입니다. 다시 확인해 주세요.');
    },
    rate: async (deckId, index, correct, original?: Card) => {
      const card = original || store.getState().decks.find(deck => deck.id === deckId)?.cards[index];
      if (!card?.id || card.revision === undefined) throw new Error('동기화를 완료한 후 학습을 시작해 주세요.');
      if (disk.pending.some(item => item.type === 'rate' && item.cardId === card.id)) throw new Error('이 카드의 이전 평가를 동기화한 후 다시 학습해 주세요.');
      enqueue({ type: 'rate', mutationId: crypto.randomUUID(), cardId: card.id, deckId, expectedRevision: card.revision, correct:ratingOf(correct)!=='again', rating:ratingOf(correct) });
    },
    retrySync: () => { void sync(); },

  }));
  async function confirmed(command:CloudCommand){
    if(disk.pending.length)throw new Error('먼저 대기 중인 변경을 동기화해 주세요.');
    enqueue(command);await sync();
    if(stopped)throw new Error('계정이 변경되었습니다.');
    if(disk.pending.some(item=>item.mutationId===command.mutationId))throw new Error(error||'전송 대기 중입니다. 동기화를 확인해 주세요.');
  }
  function publish(busy = false) {
    if (stopped) return;
    // Display durable queued mutations without changing the confirmed server snapshot.
    const view = cloudView(disk.snapshot, disk.pending);
    for (const command of disk.pending) {
      if (command.type === 'createDeck' && !view.decks.some(deck => deck.id === command.deck.id) && !disk.snapshot.decks.some(deck => deck.id === command.deck.id)) {
        view.decks.unshift({ ...command.deck, storage: 'cloud', created: 0, cards: command.cards.map(card => ({ ...card, due: 0, interval: 0 })) });
      } else if (command.type === 'deleteDeck') {
        view.decks = view.decks.filter(deck => deck.id !== command.deckId);
      } else if(command.type==='completeCard') {
        const deck=view.decks.find(deck=>deck.id===command.deckId);const card=deck?.cards.find(card=>card.id===command.cardId);
        if(card&&card.revision===command.expectedRevision){
          deck!.cards=deck!.cards.map(item=>item.id===card.id?{...item,completedAt:Date.now(),studyCount:(item.studyCount||0)+1}:item);
          view.reviews.push({date:reviewDate(Date.now(),view.timeZone)});
        }
      } else if (command.type === 'rate') {
        const deck = view.decks.find(deck => deck.id === command.deckId);
        const card = deck?.cards.find(card => card.id === command.cardId);
        if (card && card.revision === command.expectedRevision) {
          // Never mutate the confirmed snapshot while projecting the outbox.
          deck!.cards = deck!.cards.map(current => current.id === command.cardId ? { ...current, ...scheduleRating(current.interval, command.rating??command.correct, Date.now()) } : current);
          view.reviews.push({ date: reviewDate(Date.now(), view.timeZone), correct: command.correct });
        }
      }
    }
    store.setState({ ...view, sync: { mode: 'cloud', pending: disk.pending.length, busy, error }, discardPending: conflict ? discardConflict : undefined });
  }
  function discardConflict() {
    if (stopped || running || !conflict) return;
    save({ ...disk, pending: disk.pending.slice(1) });
    conflict = false;
    void sync();
  }
  function save(next: typeof disk) {
    if (stopped) throw new Error('계정이 변경되었습니다.');
    // A full disk never becomes a false "saved" UI state.
    storage.setItem(cloudStorageKey(uid), JSON.stringify(next));
    disk = next;
  }
  function enqueue(raw: unknown) {
    if (stopped) throw new Error('계정이 변경되었습니다.');
    const command = cloudCommand.parse(raw);
    if (new TextEncoder().encode(JSON.stringify(command)).length > 65536) throw new Error('저장할 카드가 너무 큽니다. 카드 내용을 줄여 주세요.');
    save({ ...disk, pending: [...disk.pending, command] });
    publish(Boolean(running));
    void sync();
  }
  async function perform() {
    error = '';
    conflict = false;
    publish(true);
    try {
      const snapshot = await pullCloudSnapshot(transport, disk.snapshot);
      if (stopped) return;
      save({ ...disk, snapshot });
      publish(true);
      while (!stopped && disk.pending.length) {
        const command = disk.pending[0];
        await transport('', command);
        if (stopped) return;
        const snapshot = await pullCloudSnapshot(transport, disk.snapshot);
        if (stopped) return;
        save({ snapshot, pending: disk.pending.filter(item => item.mutationId !== command.mutationId) });
        publish(true);
      }
    } catch (cause) {
      if (stopped) return;
      conflict = cause instanceof Error && 'status' in cause && [400, 404, 409, 413].includes(Number(cause.status));
      error = cause instanceof Error ? cause.message : '동기화를 완료하지 못했습니다. 다시 시도해 주세요.';
    }
  }
  function sync(): Promise<void> {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = perform().finally(() => { running = null; publish(); });
    return running;
  }
  return { store, sync, stop: () => { stopped = true; } };
}
