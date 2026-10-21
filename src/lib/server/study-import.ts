import type { CloudCommand } from '../study-cloud-model.ts';
import { StudyError, type StudyTransaction } from './study-service.ts';

export async function importLegacy(tx:StudyTransaction, command:Extract<CloudCommand,{type:'importDeck'|'importDay'}>, revision:number) {
  if(command.type==='importDeck') {
    const path=`decks/${command.deck.id}`;
    const existing=await tx.get(path);
    if(existing && existing.importSource!==command.source)throw new StudyError('MIGRATION_CONFLICT','이미 다른 내용으로 이전된 덱입니다. 원본은 유지됩니다.');
    const previous=await Promise.all(command.cards.map(card=>tx.get(`cards/${card.id}`)));
    if(!existing)tx.set(path,{...command.deck,cardCount:0,importSource:command.source,revision:1,deleted:false,importing:true,updatedRevision:revision});
    let added=0;
    command.cards.forEach((card,index)=>{
      if(previous[index]) {if(previous[index]!.deckId!==command.deck.id)throw new StudyError('MIGRATION_CONFLICT','이전 카드 ID가 충돌했습니다.');return;}
      added++;tx.set(`cards/${card.id}`,{...card,deckId:command.deck.id,revision:1,updatedRevision:revision});
    });
    if(added)tx.set(path,{...(existing||{...command.deck,importSource:command.source,revision:1,deleted:false,importing:true}),cardCount:Number(existing?.cardCount||0)+added,nextOrder:Math.max(Number(existing?.nextOrder||0),...command.cards.map(card=>card.order+1)),updatedRevision:revision});
  }else{
    const marker=`legacyImports/day-${command.day.id}`;
    const previous=await tx.get(marker);
    if(previous){if(previous.source!==command.source)throw new StudyError('MIGRATION_CONFLICT','다른 내용의 기존 기록이 이미 이전되었습니다. 원본을 확인해 주세요.');return;}
    const daily=await tx.get(`dailyStats/${command.day.id}`);
    const summary=await tx.get('stats/summary');
    tx.set(`dailyStats/${command.day.id}`,{...daily,...(command.day.completed||daily?.completed?{completed:Number(daily?.completed||0)+(command.day.completed||0),importedCompleted:Number(daily?.importedCompleted||0)+(command.day.completed||0)}:{}),id:command.day.id,count:Number(daily?.count||0)+command.day.count,correct:Number(daily?.correct||0)+command.day.correct,importedCount:Number(daily?.importedCount||0)+command.day.count,importedCorrect:Number(daily?.importedCorrect||0)+command.day.correct,updatedRevision:revision});
    tx.set('stats/summary',{...summary,...(command.day.completed||summary?.completed?{completed:Number(summary?.completed||0)+(command.day.completed||0)}:{}),totalReviews:Number(summary?.totalReviews||0)+command.day.count,correct:Number(summary?.correct||0)+command.day.correct,updatedRevision:revision});
    tx.set(marker,{source:command.source,...command.day});
  }
}
