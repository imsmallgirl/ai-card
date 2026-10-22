import type { Deck } from './store.ts';
export type PrintFormat = 'study' | 'exam';
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function buildDeckPrint(deck:Deck,indices:number[],format:PrintFormat,explanations=true){
  const selected=deck.cards.filter((_,index)=>indices.includes(index));
  if(!selected.length)throw new Error('내보낼 카드를 한 장 이상 선택해 주세요.');
  const content=(text:string)=>`<p>${escapeHtml(text)}</p>`;
  const answers=(card:Deck['cards'][number])=>`<div class="answer"><h3>정답</h3>${content(card.answer)}${explanations&&card.explanation?`<h3>해설</h3>${content(card.explanation)}`:''}</div>`;
  const cards=selected.map((card,index)=>`<article><h2>카드 ${index+1}</h2><div class="question">${content(card.question)}</div>${format==='study'?answers(card):'<div class="writing-space" aria-label="답안 작성 공간"></div>'}</article>`).join('');
  const key=format==='exam'?`<section class="answer-key"><h1>정답 및 해설</h1>${selected.map((card,index)=>`<article><h2>카드 ${index+1}</h2>${answers(card)}</article>`).join('')}</section>`:'';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(deck.title)} - 모아</title><style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{margin:0;font-family:'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',Arial,sans-serif;color:#302b38;font-size:11pt;line-height:1.8;word-break:keep-all;overflow-wrap:anywhere}header{border-bottom:2px solid #b7a6d0;padding-bottom:14px;margin-bottom:24px}header small{color:#75628c}h1{font-size:21pt;font-weight:500;margin:8px 0}h2{font-size:11pt;font-weight:600;color:#75628c;margin:0 0 10px}h3{font-size:10pt;font-weight:500;color:#75628c;margin:12px 0 4px}p{white-space:pre-wrap;margin:0}article{break-inside:avoid;page-break-inside:avoid;margin-bottom:22px;padding:18px;border:1px solid #e1d9eb;border-radius:8px}.question{font-size:12pt;line-height:1.85}.answer{border-top:1px solid #eee8f4;margin-top:14px;padding-top:4px}.answer-key{break-before:page;page-break-before:always}.answer-key>h1{margin-bottom:24px}.writing-space{height:36mm;margin-top:16px;border-bottom:1px solid #eee8f4}@media screen{body{max-width:800px;margin:28px auto;padding:24px;background:white}}
</style></head><body><header><small>모아 · ${format==='study'?'학습 자료':'시험지'} · ${selected.length}장</small><h1>${escapeHtml(deck.title)}</h1></header><main>${cards}${key}</main></body></html>`;
}
