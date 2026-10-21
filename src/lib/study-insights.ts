import type { Deck, StudyState } from './store.ts';
import { reviewDate } from './study-cloud-model.ts';
export function shiftDay(day:string,amount:number){const date=new Date(`${day}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+amount);return date.toISOString().slice(0,10);}
export function studyInsights(decks:Deck[],reviews:StudyState['reviews'],timeZone:string,now=Date.now()) {
  const today=reviewDate(now,timeZone);const days=new Map<string,{count:number;correct:number}>();
  for(const review of reviews){const item=days.get(review.date)||{count:0,correct:0};item.count+=review.count??1;if(review.correct)item.correct+=review.count??1;days.set(review.date,item);}
  const active=[...days].filter(([day,value])=>value.count>0&&day<=today).map(([day])=>day).sort();
  let longest=0,run=0,previous='';for(const day of active){run=previous&&shiftDay(previous,1)===day?run+1:1;longest=Math.max(longest,run);previous=day;}
  let streak=0;let day=days.get(today)?.count?today:shiftDay(today,-1);while(days.get(day)?.count){streak++;day=shiftDay(day,-1);}
  const countFrom=(from:string)=>[...days].filter(([day])=>day>=from&&day<=today).reduce((sum,[,value])=>sum+value.count,0);
  const calendar=Array.from({length:84},(_,index)=>{const date=shiftDay(today,index-83);return {date,...(days.get(date)||{count:0,correct:0})};});
  const total=[...days.values()].reduce((sum,value)=>sum+value.count,0);const correct=[...days.values()].reduce((sum,value)=>sum+value.correct,0);
  const rated=reviews.filter(item=>item.correct!==undefined).reduce((sum,item)=>sum+(item.count??1),0);
  const cards=decks.flatMap(deck=>deck.cards.map(card=>({...card,deckTitle:deck.title,category:deck.category})));
  const categories=[...new Set(decks.map(deck=>deck.category))].map(category=>{const items=cards.filter(card=>card.category===category);return {category,count:items.length,due:items.filter(card=>card.due<=now).length,reviewed:items.reduce((sum,card)=>sum+(card.reviewCount||0)+(card.studyCount||0),0)};});
  return {today,streak,longest,studiedToday:Boolean(days.get(today)?.count),todayCount:days.get(today)?.count||0,week:countFrom(shiftDay(today,-6)),month:countFrom(today.slice(0,7)+'-01'),total,correct,success:rated?Math.round(correct/rated*100):null,calendar,categories,totalCards:cards.length,due:cards.filter(card=>card.due<=now).length,tomorrow:cards.filter(card=>card.due>now&&reviewDate(card.due,timeZone)===shiftDay(today,1)).length,wrong:cards.filter(card=>(card.wrongCount||0)>0).sort((a,b)=>(b.wrongCount||0)-(a.wrongCount||0)).slice(0,5)};
}
