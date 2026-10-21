'use client';
import { useState } from 'react';
import { ArrowRight, RotateCcw, Sparkles } from 'lucide-react';
import { demoCards, demoSubjects } from '@/lib/landing-demo';
import styles from './landing.module.css';
export default function LandingDemo() {
  const [subject,setSubject]=useState<typeof demoSubjects[number]>('외국어');const [index,setIndex]=useState(0);const [flipped,setFlipped]=useState(false);
  const cards=demoCards[subject];const card=cards[index];
  return <section id="preview" className={styles.demo} aria-label="저장되지 않는 학습 카드 예시 체험">
    <div className={styles.demoTop}><span><i/><i/><i/></span><p>나의 작은 학습 공간</p><span className={styles.exampleLabel}>예시</span></div>
    <div className={styles.demoBody}>
      <div className={styles.demoHeading}><span className={styles.demoIcon}><Sparkles size={21}/></span><div><strong>어떤 배움이든, 한 장부터</strong><p>카드를 넘기며 학습 방식을 살펴보세요.</p></div></div>
      <div className={styles.subjects} role="group" aria-label="예시 주제 선택">{demoSubjects.map(value=><button key={value} aria-pressed={subject===value} onClick={()=>{setSubject(value);setIndex(0);setFlipped(false);}}>{value}</button>)}</div>
      <div className={`${styles.exampleCard} ${flipped?styles.answerCard:''}`}>
        <div className={styles.cardHeading}><span>{flipped?'ANSWER':'QUESTION'}</span><span>{String(index+1).padStart(2,'0')} / 03</span></div>
        <div className={styles.cardContent} aria-live="polite"><h3>{flipped?card.answer:card.question}</h3>{!flipped&&<p>정답을 보기 전에, 잠깐 떠올려 보세요.</p>}</div>
        <button className={styles.flipButton} onClick={()=>setFlipped(value=>!value)} aria-label={flipped?'예시 질문 다시 보기':'예시 정답 확인하기'}>{flipped?<RotateCcw size={16}/>:<Sparkles size={16}/>} {flipped?'질문 다시 보기':'정답 확인하기'}</button>
      </div>
      <div className={styles.demoBottom}><span>로그인 없이 체험 · 저장되지 않아요</span><button onClick={()=>{setIndex(value=>(value+1)%cards.length);setFlipped(false);}}>다음 카드 <ArrowRight size={15}/></button></div>
    </div>
  </section>;
}
