import AdSlot from './ad-slot';
import Link from 'next/link';
import { ArrowDown, ArrowRight, BookOpen, Check, Layers, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import AuthAccount from './auth-account';
import LandingDemo from './landing-demo';
import styles from './landing.module.css';

export function PublicHeader() {return <header className={styles.header}><Link className={styles.logo} href="/" aria-label="모아 홈"><span><Layers size={23}/></span>모아<span className={styles.logoDot}>.</span></Link><nav className={styles.navigation} aria-label="서비스 안내"><Link href="/#how-it-works">이용 방법</Link><Link href="/#features">주요 기능</Link><Link href="/#questions">자주 묻는 질문</Link></nav><AuthAccount/></header>;}
export function PublicFooter() {return <footer className={styles.footer}><div><Link className={styles.footerBrand} href="/">모아<span>.</span></Link><p>작은 배움을 모아, 오래 남는 기억으로.</p></div><nav aria-label="하단 안내"><Link href="/about">서비스 소개</Link><Link href="/privacy">개인정보 안내</Link><Link href="/terms">이용 안내</Link></nav><small>© {new Date().getFullYear()} 모아</small></footer>;}
export default function LandingPage() {
  return <div className={styles.shell}><a className={styles.skipLink} href="#landing-main">본문으로 건너뛰기</a><div className={styles.container}><PublicHeader/>
    <main className={styles.main} id="landing-main">
      <section className={styles.hero} aria-labelledby="landing-title"><div className={styles.heroCopy}><span className={styles.eyebrow}><i/> YOUR EVERYDAY LEARNING</span><h1 id="landing-title">배운 순간을,<br/><em>오래 기억하도록.</em></h1><p className={styles.lead}>영어 단어부터 자격증, 새로운 관심사까지.<br/>공부하고 싶은 주제를 학습 카드로 만들고,<br className={styles.desktopBreak}/> 나만의 속도로 차근차근 복습하세요.</p><div className={styles.heroActions}><AuthAccount variant="cta" label="Google로 학습 시작하기"/><a className={styles.previewLink} href="#preview">먼저 체험해 보기 <ArrowDown size={16}/></a></div><p className={styles.heroNote}><ShieldCheck size={15}/>개인 학습 공간은 로그인 후 이용할 수 있어요.</p></div><div className={styles.heroVisual}><div className={styles.visualLabel}><Sparkles size={15}/>작은 카드, 오래 남는 배움</div><LandingDemo/></div></section>
      <div className={styles.topicStrip}><span>배우고 싶은 건 무엇이든</span><div>{['외국어','자격증 · 시험','개발 · 기술','과학 · 인문','나의 관심사'].map(topic=><span key={topic}>{topic}</span>)}</div></div>
      <section id="features" className={styles.section}><div className={styles.sectionHeading}><span className={styles.eyebrow}>LESS EFFORT, MORE LEARNING</span><h2>공부할 내용은 가볍게 정리하고,<br/>기억은 조금 더 단단하게.</h2><p>정리하는 시간보다 이해하고 떠올리는 시간에 집중하세요.</p></div><div className={styles.featureGrid}>{[
        {icon:Sparkles,number:'01',title:'내 자료에서 시작하는 학습',text:'면접 질문과 답변, 강의 노트를 붙여 넣어 카드로 정리해요. AI 자동 생성과 직접 입력도 선택할 수 있어요.',label:'자료 추출 · AI 자동 생성 · 직접 만들기'},
        {icon:BookOpen,number:'02',title:'읽고, 떠올리고, 확인하기',text:'카드 앞면의 질문을 읽고 답을 떠올려 보세요. 정답을 확인하고, 필요한 내용은 직접 수정할 수 있어요.',label:'카드 학습 · 주관식 퀴즈'},
        {icon:RotateCcw,number:'03',title:'다시 볼 때를 놓치지 않게',text:'질문과 정답에 집중해요. 완료한 카드와 오늘의 목표, 쌓이는 학습 기록을 한곳에서 확인하세요.',label:'카드 학습 · 학습 기록'},
      ].map(feature=><article className={styles.feature} key={feature.number}><div><span className={styles.featureIcon}><feature.icon size={24}/></span><span className={styles.featureNumber}>{feature.number}</span></div><h3>{feature.title}</h3><p>{feature.text}</p><span className={styles.featureLabel}>{feature.label}</span></article>)}</div></section>
      <section id="how-it-works" className={styles.how}><div className={styles.howIntro}><span className={styles.eyebrow}>A SMALL DAILY ROUTINE</span><h2>처음부터 완벽하게 말고,<br/>오늘은 한 장부터.</h2><p>복잡한 준비 없이 시작하세요.<br/>나에게 필요한 배움만 모으면 됩니다.</p><Link href="/about">모아의 학습 방식 알아보기 <ArrowRight size={16}/></Link></div><ol className={styles.steps}>{[
        ['나의 자료를 붙여 넣어요','질문과 답이 있는 자료를 붙여 넣거나 AI 자동 생성·직접 만들기를 선택하세요.'],
        ['미리보고 확인한 뒤 저장해요','질문·답·해설을 확인하고, 분류와 태그를 고치거나 필요 없는 카드를 제외하세요.'],
        ['떠올리고, 다시 만나세요','질문을 보고 답을 떠올린 다음 정답을 확인해요. 오늘의 복습을 조금씩 이어가세요.'],
      ].map(([title,text],i)=><li key={title}><span>{i+1}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol></section>
      <section id="questions" className={`${styles.section} ${styles.faq}`}><div className={styles.sectionHeading}><span className={styles.eyebrow}>GOOD TO KNOW</span><h2>시작하기 전에 궁금한 점</h2></div><div>{[
        ['어떤 주제로 공부할 수 있나요?','외국어, 시험 준비, 개발, 과학 등 다양한 주제를 입력할 수 있어요. 범위가 구체적일수록 활용하기 좋은 카드를 만들기 쉽습니다.'],
        ['로그인 없이도 사용할 수 있나요?','서비스 소개와 이 페이지의 예시 카드는 로그인 없이 볼 수 있어요. 나만의 카드 생성·저장·복습은 Google 로그인 후 사용할 수 있습니다. 예시 체험은 AI를 호출하거나 기록을 저장하지 않아요.'],
        ['AI가 만든 내용은 항상 정확한가요?','AI가 만든 질문과 답에는 오류가 있을 수 있어요. 학습 자료와 비교해 확인하고, 필요한 부분은 직접 수정해 주세요.'],
        ['무료로 시작할 수 있나요?','현재 학습 기능은 무료로 시작할 수 있어요. AI 생성에는 사용량 한도가 적용되며, 남은 횟수는 생성 화면에서 확인할 수 있습니다. 저장된 카드의 복습에는 AI 생성 횟수가 사용되지 않아요.'],
        ['내 카드는 다른 사람에게 보이나요?','개인 덱과 학습 기록은 로그인한 본인의 학습 공간에서만 볼 수 있어요. 덱을 공개하거나 다른 사용자와 공유하는 기능은 제공하지 않습니다.'],
        ['새로고침해도 카드가 남아 있나요?','저장 완료된 카드는 다시 로그인해도 확인할 수 있어요. 저장 상태는 학습 공간에서 확인할 수 있고, 기존 로컬 덱은 원본을 보존하면서 클라우드로 이전할 수 있습니다.'],
      ].map(([title,text])=><details key={title}><summary>{title}<span aria-hidden="true">+</span></summary><p>{text}</p></details>)}</div></section>
      <section className={styles.finalCta}><span><Check size={18}/>나에게 필요한 배움, 나만의 속도로</span><h2>오늘의 배움이<br/>내일의 기억이 되도록.</h2><p>지금 나만의 첫 학습 카드를 만들어 보세요.</p><AuthAccount variant="cta" label="Google로 시작하기"/></section>
    </main><AdSlot placement="landing"/><PublicFooter/></div></div>;
}
