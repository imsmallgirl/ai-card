import { metadataOf } from './card-content.ts';
import { cloudCommand, type CloudCommand } from './study-cloud-model.ts';
import { STUDY_CATEGORIES } from './categories.ts';
import { pullCloudSnapshot } from './study-cloud-client.ts';
import { emptyCloudSnapshot } from './study-cloud-model.ts';
import type { Deck, StudyState } from './store.ts';
import type { CloudTransport } from './study-cloud-client.ts';
export const migrationKey=(uid:string)=>`moa-study-imported-v1-${uid}`;
async function hash(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');}
async function mutationId(value:unknown){const id=await hash(value);return `${id.slice(0,8)}-${id.slice(8,12)}-4${id.slice(13,16)}-8${id.slice(17,20)}-${id.slice(20,32)}`;}
export async function legacyCommands(state:Pick<StudyState,'decks'|'reviews'>):Promise<CloudCommand[]> {
  const commands:CloudCommand[]=[];
  for(const deck of state.decks){
    if(!deck.cards.length)throw new Error('빈 기존 덱이 있습니다. 원본을 확인해 주세요.');
    const source=await hash(deck);const id=`legacy-${await hash(deck.id)}`;
    const category=STUDY_CATEGORIES.find(item=>item===deck.category)||'기타';
    for(let offset=0;offset<deck.cards.length;offset+=2)commands.push(cloudCommand.parse({
      type:'importDeck',mutationId:await mutationId(['deck-v2',source,id,offset]),source,
      deck:{id,legacyOriginalId:deck.id,title:deck.title,category,color:deck.color,created:deck.created,...(deck.purpose?{purpose:deck.purpose}:{}),...(deck.difficulty?{difficulty:deck.difficulty}:{})},
      cards:deck.cards.slice(offset,offset+2).map((card,index)=>({id:`${id}-${offset+index}`,question:card.question,answer:card.answer,...metadataOf(card),...(card.completedAt!==undefined?{completedAt:card.completedAt}:{}),...(card.studyCount!==undefined?{studyCount:card.studyCount}:{}),due:card.due,interval:card.interval,order:offset+index,...(card.favorite!==undefined?{favorite:card.favorite}:{}),...(card.reviewCount!==undefined?{reviewCount:card.reviewCount}:{}),...(card.wrongCount!==undefined?{wrongCount:card.wrongCount}:{}),...(card.lastWrong!==undefined?{lastWrong:card.lastWrong}:{}),...(card.lastRating!==undefined?{lastRating:card.lastRating}:{})})),
    }));
    commands.push(cloudCommand.parse({type:'finishImport',mutationId:await mutationId(['finish',source,id]),deckId:id,source,cardCount:deck.cards.length}));
  }
  const days=new Map<string,{id:string;count:number;correct:number;completed?:number}>();
  for(const item of state.reviews){const day=days.get(item.date)||{id:item.date,count:0,correct:0};const count=item.count??1;day.count+=count;if(item.correct)day.correct+=count;if(item.correct===undefined)day.completed=(day.completed||0)+count;days.set(day.id,day);}
  for(const day of days.values())commands.push(cloudCommand.parse({type:'importDay',mutationId:await mutationId(['day',day]),source:await hash(day),day}));
  return commands;
}
export async function importLegacyState(state:Pick<StudyState,'decks'|'reviews'>, transport:CloudTransport, progress:(done:number,total:number)=>void=()=>{}) {
  // Validate the entire source before the first write. Stable source/card IDs survive retries/devices.
  const commands=await legacyCommands(state);
  for(let index=0;index<commands.length;index++){await transport('',commands[index]);progress(index+1,commands.length);}
  const snapshot=await pullCloudSnapshot(transport,emptyCloudSnapshot());
  for(const command of commands){
    if(command.type==='importDeck'){
      const deck=snapshot.decks.find(deck=>deck.id===command.deck.id);
      if(!deck||deck.deleted||command.cards.some(card=>!snapshot.cards.some(saved=>saved.id===card.id&&saved.deckId===deck.id&&!saved.deleted)))throw new Error('이전 결과를 확인하지 못했습니다. 원본은 보존됩니다.');
    }else if(command.type==='importDay'){
      const day=snapshot.dailyStats.find(day=>day.id===command.day.id);
      if(!day||day.count<command.day.count||day.correct<command.day.correct||(day.completed||0)<(command.day.completed||0))throw new Error('이전 학습 기록을 확인하지 못했습니다.');
    }
  }
  return commands;
}
