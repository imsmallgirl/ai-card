import { metadataOf, sameCardContent } from '../card-content.ts';
import { importLegacy } from './study-import.ts';
import { ratingOf, scheduleRating } from '../review-schedule.ts';
import { recordDomainAnalytics } from './analytics-service.ts';
import { createHash } from 'node:crypto';
import { cloudCommand, cloudSettings, reviewDate, type CloudCommand } from '../study-cloud-model.ts';

export class StudyError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 409) { super(message); this.code = code; this.status = status; }
}
export type DocumentData = Record<string, unknown>;
export type StudyTransaction = {
  get: (path: string) => Promise<DocumentData | undefined>;
  set: (path: string, data: DocumentData) => void;
};
export type StudyDatabase = {
  transaction: <T>(run: (transaction: StudyTransaction) => Promise<T>) => Promise<T>;
};

// Every path is relative to the UID fixed by the authenticated repository, never a body UID.
export async function applyStudyCommand(database: StudyDatabase, raw: CloudCommand, now = Date.now(), analyticsEnabled = process.env.ANALYTICS_ENABLED === 'true') {
  const command = cloudCommand.parse(raw);
  const hash = createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return database.transaction(async tx => {
    const previous = await tx.get(`mutations/${command.mutationId}`);
    if (previous) {
      if (previous.hash !== hash) throw new StudyError('IDEMPOTENCY_CONFLICT', '같은 요청 ID로 다른 내용을 저장할 수 없습니다.');
      return { revision: previous.revision as number };
    }
    const user = await tx.get('account/status');
    if (user?.deleting) throw new StudyError('ACCOUNT_DELETING', '삭제 중인 계정입니다.', 403);
    const sync = await tx.get('meta/sync');
    const revision = Number(sync?.revision || 0) + 1;
    const settingsData = await tx.get('settings/profile');
    const settings = settingsData ? cloudSettings.parse(settingsData) : {
      id: 'profile', dailyGoal: 20, timeZone: 'Asia/Seoul', revision: 0, updatedRevision: revision,
    };
    if (command.type === 'importDeck' || command.type === 'importDay') {
      await importLegacy(tx,command,revision);
    } else if(command.type==='finishImport') {
      const deck=await tx.get(`decks/${command.deckId}`);
      if(!deck||deck.deleted||deck.importSource!==command.source||deck.cardCount!==command.cardCount)throw new StudyError('MIGRATION_CONFLICT','이전한 카드 수를 확인하지 못했습니다. 원본은 유지됩니다.');
      tx.set(`decks/${command.deckId}`,{...deck,importing:false,updatedRevision:revision});
    } else if(command.type==='settings') {
      if(settings.revision!==command.expectedRevision)throw new StudyError('REVISION_CONFLICT','다른 기기에서 설정이 변경되었습니다.');
      tx.set('settings/profile',{...settings,dailyGoal:command.dailyGoal,timeZone:command.timeZone,revision:settings.revision+1,updatedRevision:revision});
    } else if (command.type === 'createDeck') {
      if (new Set(command.cards.map(card => card.id)).size !== command.cards.length) {
        throw new StudyError('INVALID_INPUT', '카드 ID가 중복되었습니다.', 400);
      }
      const deck = await tx.get(`decks/${command.deck.id}`);
      const cards = await Promise.all(command.cards.map(card => tx.get(`cards/${card.id}`)));
      // Multiple devices can resume the same AI request with different mutation IDs.
      if (/^ai-[0-9a-f-]{36}$/.test(command.deck.id) && deck && !deck.deleted && deck.title === command.deck.title && deck.category === command.deck.category && deck.cardCount === command.cards.length && cards.every((card, index) => card?.deckId === command.deck.id && sameCardContent(card,command.cards[index]))) {
        tx.set(`mutations/${command.mutationId}`, { hash, revision: sync?.revision || 0, createdAt: now });
        return { revision: Number(sync?.revision || 0) };
      }
      if (deck || cards.some(Boolean)) throw new StudyError('ID_CONFLICT', '이미 존재하는 덱 또는 카드입니다.');
      tx.set(`decks/${command.deck.id}`, { ...command.deck, cardCount: command.cards.length, nextOrder:command.cards.length, created: now, revision: 1, deleted: false, updatedRevision: revision, schemaVersion: 2 });
      await recordDomainAnalytics(tx, '', analyticsEnabled, { type: 'deck', id: command.mutationId, count: command.cards.length, source: 'cloud' }, now);
      command.cards.forEach((card, order) => tx.set(`cards/${card.id}`, {
        ...card, deckId: command.deck.id, due: 0, interval: 0, order, revision: 1, updatedRevision: revision, schemaVersion: 2,
      }));
    } else {
      const deck = await tx.get(`decks/${command.deckId}`);
      if (!deck || deck.deleted) throw new StudyError('NOT_FOUND', '학습 덱을 찾을 수 없습니다.', 404);
      if(command.type==='addCard') {
        if(deck.revision!==command.expectedRevision)throw new StudyError('REVISION_CONFLICT','덱이 변경되었습니다. 다시 확인해 주세요.');
        if(Number(deck.cardCount)>=2000)throw new StudyError('CARD_LIMIT','한 덱은 최대 2000장입니다.',400);
        if(await tx.get(`cards/${command.card.id}`))throw new StudyError('ID_CONFLICT','이미 존재하는 카드입니다.');
        tx.set(`cards/${command.card.id}`,{...command.card,deckId:command.deckId,order:Number(deck.nextOrder||deck.cardCount||0),due:0,interval:0,revision:1,updatedRevision:revision});
        tx.set(`decks/${command.deckId}`,{...deck,cardCount:Number(deck.cardCount||0)+1,nextOrder:Number(deck.nextOrder||deck.cardCount||0)+1,revision:Number(deck.revision)+1,updatedRevision:revision});
      } else if(command.type==='reorder') {
        if(deck.revision!==command.expectedRevision||new Set(command.cardIds).size!==command.cardIds.length||command.cardIds.length!==deck.cardCount)throw new StudyError('REVISION_CONFLICT','카드 목록이 변경되었습니다. 다시 확인해 주세요.');
        const cards=await Promise.all(command.cardIds.map(id=>tx.get(`cards/${id}`)));
        if(cards.some(card=>!card||card.deleted||card.deckId!==command.deckId))throw new StudyError('INVALID_INPUT','카드 목록을 확인해 주세요.',400);
        cards.forEach((card,index)=>tx.set(`cards/${command.cardIds[index]}`,{...card,order:index,revision:Number(card!.revision)+1,updatedRevision:revision}));
        tx.set(`decks/${command.deckId}`,{...deck,nextOrder:command.cardIds.length,revision:Number(deck.revision)+1,updatedRevision:revision});
      } else if (command.type === 'deleteDeck') {
        if (deck.revision !== command.expectedRevision) throw new StudyError('REVISION_CONFLICT', '다른 기기에서 덱이 변경되었습니다.');
        tx.set(`decks/${command.deckId}`, { ...deck, deleted: true, revision: Number(deck.revision) + 1, updatedRevision: revision });

      } else {
        const card = await tx.get(`cards/${command.cardId}`);
        if (!card || card.deleted || card.deckId !== command.deckId) throw new StudyError('NOT_FOUND', '학습 카드를 찾을 수 없습니다.', 404);
        if (card.revision !== command.expectedRevision) throw new StudyError('REVISION_CONFLICT', '다른 기기에서 이 카드가 변경되었습니다. 새 상태를 확인해 주세요.');
        if(command.type==='deleteCard') {
          if(Number(deck.cardCount)<=1)throw new StudyError('LAST_CARD','최소 한 장은 남겨 주세요. 덱 전체 삭제는 덱 목록에서 할 수 있습니다.',400);
          tx.set(`cards/${command.cardId}`,{...card,deleted:true,revision:Number(card.revision)+1,updatedRevision:revision});
          tx.set(`decks/${command.deckId}`,{...deck,cardCount:Number(deck.cardCount)-1,nextOrder:Number(deck.nextOrder||deck.cardCount),revision:Number(deck.revision)+1,updatedRevision:revision});
        } else if(command.type==='favorite') {
          tx.set(`cards/${command.cardId}`,{...card,favorite:command.favorite,revision:Number(card.revision)+1,updatedRevision:revision});
        } else if(command.type==='completeCard') {
          const date=reviewDate(now,settings.timeZone);
          const daily=await tx.get(`dailyStats/${date}`);const summary=await tx.get('stats/summary');
          tx.set(`cards/${command.cardId}`,{...card,completedAt:now,studyCount:Number(card.studyCount||0)+1,revision:Number(card.revision)+1,updatedRevision:revision});
          tx.set(`reviewEvents/${command.mutationId}`,{id:command.mutationId,cardId:command.cardId,deckId:command.deckId,type:'completed',date,timeZone:settings.timeZone,reviewedAt:now,schemaVersion:2});
          tx.set(`dailyStats/${date}`,{...daily,id:date,count:Number(daily?.count||0)+1,correct:Number(daily?.correct||0),completed:Number(daily?.completed||0)+1,updatedRevision:revision,schemaVersion:2});
          tx.set('stats/summary',{...summary,totalReviews:Number(summary?.totalReviews||0)+1,correct:Number(summary?.correct||0),completed:Number(summary?.completed||0)+1,updatedRevision:revision,schemaVersion:2});
        } else if (command.type === 'updateCard') {
          const contentChanged=card.question!==command.question||card.answer!==command.answer||(command.explanation!==undefined&&command.explanation!==(card.explanation||''));
          tx.set(`cards/${command.cardId}`, { ...card, ...metadataOf(command), question: command.question, answer: command.answer, ...(contentChanged?{due:0,interval:0,completedAt:0}:{}), revision: Number(card.revision) + 1, updatedRevision: revision });
        } else {
        const rating=ratingOf(command.rating??command.correct);
        const correct=rating!=='again';
        const date = reviewDate(now, settings.timeZone);
        const daily = await tx.get(`dailyStats/${date}`);
        const summary = await tx.get('stats/summary');
        tx.set(`cards/${command.cardId}`, { ...card, ...scheduleRating(Number(card.interval), rating, now), reviewCount:Number(card.reviewCount||0)+1, wrongCount:Number(card.wrongCount||0)+Number(!correct), lastWrong:!correct,lastRating:rating, revision: Number(card.revision) + 1, updatedRevision: revision });
        await recordDomainAnalytics(tx, '', analyticsEnabled, { type: 'review', id: command.mutationId, source: 'cloud' }, now);
        tx.set(`reviewEvents/${command.mutationId}`, { id: command.mutationId, cardId: command.cardId, deckId: command.deckId, date, timeZone: settings.timeZone, correct, rating, reviewedAt: now, schemaVersion: 2 });
        tx.set(`dailyStats/${date}`, { ...daily, id: date, count: Number(daily?.count || 0) + 1, correct: Number(daily?.correct || 0) + Number(correct), ...(daily?.importedCount!==undefined?{importedCount:daily.importedCount,importedCorrect:daily.importedCorrect}:{}), updatedRevision: revision, schemaVersion: 2 });
        tx.set('stats/summary', { ...summary, totalReviews: Number(summary?.totalReviews || 0) + 1, correct: Number(summary?.correct || 0) + Number(correct), updatedRevision: revision, schemaVersion: 2 });
        }
      }
    }
    if (!settingsData && command.type!=='settings') tx.set('settings/profile', { ...settings, schemaVersion: 2 });
    tx.set('meta/sync', { revision, updatedAt: now });
    tx.set(`mutations/${command.mutationId}`, { hash, revision, createdAt: now });
    return { revision };
  });
}
