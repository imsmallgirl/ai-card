'use client';
import { studyInsights } from '@/lib/study-insights';
import type { Deck, StudyState } from '@/lib/store';
export default function StudyInsights({decks,reviews,timeZone,compact=false}:{decks:Deck[];reviews:StudyState['reviews'];timeZone:string;compact?:boolean}){
  const data=studyInsights(decks,reviews,timeZone);
  return <section className="panel insights"><h2>{compact?'매일 쌓이는 배움':'학습 기록과 통계'}</h2>
    <div className="insight-grid">{(compact?[
      ['연속 학습',`${data.streak}일`],['최장 연속',`${data.longest}일`],['오늘 학습',data.studiedToday?'완료':'아직 시작 전'],
    ]:[['오늘 복습',`${data.todayCount}회`],['최근 7일',`${data.week}회`],['이번 달',`${data.month}회`],['총 카드',`${data.totalCards}장`],['누적 학습',`${data.total}회`],['지금 복습할 카드',`${data.due}장`],['내일 예정',`${data.tomorrow}장`],['연속 / 최장',`${data.streak}일 / ${data.longest}일`]]).map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    {!compact&&<><h3>최근 7일 학습량</h3><div className="chart">{data.calendar.slice(-7).map(day=><div key={day.date}><span>{day.count}회</span><div className="bar" style={{height:Math.max(4,Math.min(180,day.count*12))}}/><small>{day.date.slice(5)}</small></div>)}</div>
    <h3>학습 캘린더 · 최근 12주</h3><p>같은 날 여러 번 복습한 기록을 포함합니다. 타임존: {timeZone}</p><div className="study-calendar" role="list" aria-label="날짜별 학습량">{data.calendar.map(day=><span key={day.date} role="listitem" data-level={day.count===0?0:day.count<5?1:day.count<15?2:3} title={`${day.date}: ${day.count}회`} aria-label={`${day.date}: ${day.count}회`}/>)}</div>
    <h3>카테고리별 학습 현황</h3><div className="insight-table"><table><thead><tr><th>카테고리</th><th>카드</th><th>복습 대기</th><th>기록된 복습</th></tr></thead><tbody>{data.categories.map(row=><tr key={row.category}><th>{row.category}</th><td>{row.count}장</td><td>{row.due}장</td><td>{row.reviewed}회</td></tr>)}</tbody></table></div>
    <h3>자주 틀리는 카드</h3>{data.wrong.length?<ul>{data.wrong.map((card,index)=><li key={card.id||index}>{card.question} <small>· {card.deckTitle} · 기록된 오답 {card.wrongCount}회</small></li>)}</ul>:<p>카드별 오답 기록이 아직 없습니다.</p>}
    <small>이전 로컬 기록에 카드별 연결 정보가 없으면 카테고리별 복습·오답 횟수로 추정하지 않습니다. 날짜별 전체 학습량에는 보존된 기록을 포함합니다.</small></>}
  </section>;
}
