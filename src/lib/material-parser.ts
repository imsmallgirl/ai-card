import type { CardContent } from './card-content.ts';
import type { STUDY_CATEGORIES } from './categories.ts';
export type MaterialCard = Omit<CardContent,'answer'> & {answer:string};
export type Classification = Pick<CardContent,'category'|'tags'|'difficulty'>;
const topics:{category:typeof STUDY_CATEGORIES[number];pattern:RegExp;tag:string}[]=[
  {category:'프로그래밍·IT',pattern:/\breact\b|리액트/iu,tag:'React'},
  {category:'프로그래밍·IT',pattern:/javascript|자바스크립트/iu,tag:'JavaScript'},
  {category:'프로그래밍·IT',pattern:/typescript|타입스크립트/iu,tag:'TypeScript'},
  {category:'프로그래밍·IT',pattern:/\bpython\b|파이썬/iu,tag:'Python'},
  {category:'프로그래밍·IT',pattern:/\bsql\b|데이터베이스|트랜잭션/iu,tag:'데이터베이스'},
  {category:'프로그래밍·IT',pattern:/운영체제|프로세스|스레드/iu,tag:'운영체제'},
  {category:'프로그래밍·IT',pattern:/\bhttp\b|\btcp\b|네트워크/iu,tag:'네트워크'},
  {category:'외국어',pattern:/토익|\btoeic\b|영단어|영어|일본어|중국어/iu,tag:'외국어'},
  {category:'수학',pattern:/미적분|방정식|함수의 극한|행렬|확률/iu,tag:'수학'},
  {category:'과학',pattern:/광합성|세포|원자|분자|뉴턴|화학|산성|염기성|이산화탄소|수증기|부력|중력|마찰/iu,tag:'과학'},
  {category:'역사·지리',pattern:/조선|고려|삼국시대|한국사|세계사/iu,tag:'역사'},
  {category:'경영·경제',pattern:/금리|인플레이션|경제학|재무|마케팅/iu,tag:'경제·경영'},
  {category:'법률',pattern:/민법|형법|헌법|판례|법률/iu,tag:'법률'},
  {category:'의학·간호',pattern:/간호|혈압|병리|해부학|환자/iu,tag:'의학·간호'},
  {category:'디자인',pattern:/타이포그래피|피그마|\bfigma\b|디자인/iu,tag:'디자인'},
  {category:'자격증·시험',pattern:/자격증|정보처리기사|공인중개사/iu,tag:'자격증'},
];
export function classifyMaterial(text:string):Classification {
  const matched=topics.filter(topic=>topic.pattern.test(text));
  const scores=new Map<string,number>();for(const topic of matched)scores.set(topic.category,(scores.get(topic.category)||0)+1);
  const ranked=[...scores].sort((a,b)=>b[1]-a[1]);
  const category=ranked.length&&(!ranked[1]||ranked[0][1]>ranked[1][1])?ranked[0][0] as typeof STUDY_CATEGORIES[number]:'기타';
  const explicit=text.match(/(?:난이도\s*[:：]\s*|\[)(초급|중급|고급)/u)?.[1];
  const difficulty=explicit as CardContent['difficulty']||(/심화|고급|advanced|최적화|동시성|증명/iu.test(text)?'고급':/중급|intermediate/iu.test(text)?'중급':/초급|입문|기초|beginner/iu.test(text)?'초급':undefined);
  const tags=[...new Set(matched.map(topic=>topic.tag))].slice(0,7);
  if(/면접/iu.test(text))tags.push('면접 준비');
  return {category,tags,difficulty};
}
const answerLabel=/^(?:A(?:\d+)?[.):：\s]|답변\s*[:：;；]|정답\s*[:：;；]|답\s*[:：;；])\s*(.*)$/iu;
const explanationLabel=/^(?:(?:->|→)\s*|(?:해설|추가\s*설명|학습\s*포인트|풀이)(?:\s*[:：]\s*|\s*$))(.*)$/u;
const questionLabel=/^(?:Q(?:\d+)?\s*[.):：\-]?\s+|Q(?:\d+)?\s*[:：]\s*|질문\s*[:：]\s*|문제\s*[:：]\s*)(.*)$/iu;
const numbered=/^(?:\d{1,3}\s*[.)、]|\(\d{1,3}\)|[①-⑳])\s*(.+)$/u;
const questionLike=/[?？]$|다음\s*중|것은\s*$|무엇|어떻|차이|설명|정의|원리|왜|장점|단점|비교|란(?:\s|$)|인가|나요/u;
// A choice row belongs to the question, never to its answer. Do not treat numbered answer lists as choices.
const choiceStart=/^(?:[1-9]\d?\s*(?:번\s*[,.)、]?|[.)、])|[①-⑳])\s*\S/u;
function multipleChoices(line:string){return [...line.matchAll(/(?:^|\s)(?:[1-9]\d?\s*(?:번\s*[,.)、]?|[.)、])|[①-⑳])\s*\S/gu)].length>=2;}
export function parseMaterial(source:string):{cards:MaterialCard[];classification:Classification;warnings:string[]} {
  if(source.length>15000)throw new Error('자료는 15,000자까지입니다. 나누어 입력해 주세요.');
  const lines=source.replace(/\r\n?/g,'\n').split('\n');
  const following:string[]=[];let nextText='';for(let i=lines.length-1;i>=0;i--){following[i]=nextText;if(lines[i].trim())nextText=lines[i].trim();}
  type Draft={question:string[];answer:string[];explanation:string[];field:'question'|'answer'|'explanation';choices:boolean;explicitAnswer:boolean};
  const drafts:Draft[]=[];let current:Draft|undefined;let fence='';let unused=0;let ambiguous=false;
  function start(question:string){question=question.match(questionLabel)?.[1]??question;if(drafts.length>=200)throw new Error('자료에서 200개가 넘는 질문을 찾았습니다. 자료를 나누어 주세요.');current={question:[question],answer:[],explanation:[],field:'answer',choices:false,explicitAnswer:false};drafts.push(current);}
  for(let index=0;index<lines.length;index++){
    const raw=lines[index];let line=raw.trim();
    if(fence){if(current)current[current.field].push(raw);else unused++;if(line.startsWith(fence))fence='';continue;}
    const code=line.match(/^(`{3,}|~{3,})/);if(code){fence=code[1];if(current)current[current.field].push(raw);else unused++;continue;}
    if(!line){if(current)current[current.field].push('');continue;}
    const heading=line.match(/^(#{1,6})\s+(.+?)\s*#*$/u);
    line=(heading?heading[2]:line).replace(/^\*\*(.*?)\*\*$/u,'$1').replace(/^[-*]\s+(?=(?:Q[:.\s]|A[:.\s]|질문|문제|답변|정답|해설|추가\s*설명|학습\s*포인트|->|→))/iu,'');
    const inlineAnswer=line.match(/^(.+?)\s+(?:정답|답변|답)\s*[:：;；]\s*(.+)$/u);
    if(inlineAnswer&&current&&!current.explicitAnswer){
      const prefix=inlineAnswer[1];
      if(multipleChoices(prefix)||choiceStart.test(prefix)){current.question.push(prefix);current.choices=true;}
      else current[current.choices?'question':current.field].push(prefix);
      current.answer.push(inlineAnswer[2]);current.field='answer';current.explicitAnswer=true;continue;
    }
    if(current&&!current.explicitAnswer&&choiceStart.test(line)&&
      (multipleChoices(line)||(!questionLike.test(line)&&(current.choices||(choiceStart.test(following[index])&&!questionLike.test(following[index])))))){
      current.question.push(line);current.choices=true;current.field='question';continue;
    }
    const answer=line.match(answerLabel);
    if(answer&&current){current.field='answer';current.explicitAnswer=true;if(answer[1])current.answer.push(answer[1]);continue;}
    const explanation=line.match(explanationLabel);
    if(explanation&&current){current.field='explanation';if(explanation[1])current.explanation.push(explanation[1]);continue;}
    if(heading&&/^(?:답변|정답|답|answer)$/iu.test(line)&&current){current.field='answer';current.explicitAnswer=true;continue;}
    const explicit=line.match(questionLabel);
    if(explicit){start(explicit[1]);current!.field='question';continue;}
    const number=line.match(numbered);
    const next=following[index];
    if(heading&&!questionLike.test(line)&&(/^#{1,6}\s/u.test(next)||questionLabel.test(next)||numbered.test(next))){unused++;continue;}
    const nextIsNumber=numbered.test(next);
    const previousIsNumber=numbered.test(lines[index-1]?.trim()||'');
    const indented=/^(?:\t|\s{2,})/u.test(raw);
    const isQuestion=number&&!indented&&(!current||questionLike.test(number[1])||answerLabel.test(next)||(!nextIsNumber&&!previousIsNumber&&Boolean(next)&&!/^#{1,6}\s/u.test(next)));
    if(isQuestion){if(!questionLike.test(number![1])&&!answerLabel.test(next))ambiguous=true;start(number![1]);continue;}
    if(heading){
      // A title immediately followed by another heading is section context, not a fabricated card.
      if(/^#{1,6}\s/u.test(next)&&!questionLike.test(line)){unused++;continue;}
      start(number?number[1]:line);continue;
    }
    if(current)current[current.field].push(raw);else unused++;
  }
  if(drafts.length>200)throw new Error('자료에서 200개가 넘는 질문을 찾았습니다. 자료를 나누어 주세요. 누락된 채 저장하지 않습니다.');
  const classification=classifyMaterial(source);
  const cards=drafts.map(draft=>{
    const question=draft.question.join('\n').trim();const answer=draft.answer.join('\n').trim();const explanation=draft.explanation.join('\n').trim();
    const inferred=classifyMaterial([question,answer,explanation].join('\n'));
    return {question,answer,explanation,...inferred,category:inferred.category==='기타'?(classification.category||'기타'):inferred.category,difficulty:inferred.difficulty||classification.difficulty,tags:inferred.tags?.length?inferred.tags:classification.tags};
  });
  const warnings:string[]=[];
  if(!cards.length)warnings.push('질문 경계를 찾지 못했습니다. Q: / A:, 번호 또는 Markdown 제목을 사용하거나 AI 분석을 직접 선택해 주세요.');
  const missing=cards.filter(card=>!card.answer).length;if(missing)warnings.push(`${missing}개 항목에 답이 없습니다. 답을 입력하거나 해당 카드를 제외해 주세요.`);
  if(unused)warnings.push(`제목·소개 등 ${unused}줄은 카드에 포함하지 않았습니다. 원본 자료와 비교해 주세요.`);
  if(ambiguous)warnings.push('일부 번호 목록을 질문으로 해석했습니다. 답변 안의 목록이 분리되지 않았는지 확인해 주세요.');
  return {cards,classification,warnings};
}

export function materialCategory(cards:MaterialCard[]):NonNullable<MaterialCard['category']> {
  const votes=new Map<NonNullable<MaterialCard['category']>,number>();
  for(const card of cards)if(card.category&&card.category!=='기타')votes.set(card.category,(votes.get(card.category)||0)+1);
  const ranked=[...votes].sort((a,b)=>b[1]-a[1]);
  return ranked.length&&(!ranked[1]||ranked[0][1]>ranked[1][1])?ranked[0][0]:'기타';
}
