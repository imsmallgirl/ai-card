import PublicContent from '@/components/public-content';
import LoginPanel from '@/components/login-panel';
export const metadata={title:'로그인 — 모아',robots:{index:false,follow:true}};
export default function Login(){return <PublicContent title="나만의 배움을 시작하세요" intro="Google 계정으로 로그인하고 학습 카드를 만들어 보세요. 개인 덱과 복습 기록은 계정별로 분리됩니다."><LoginPanel/><section><h2>로그인하면 무엇을 할 수 있나요?</h2><p>주제로 학습 카드를 만들고, 질문과 답을 수정하고, 카드 학습과 퀴즈로 복습할 수 있습니다. 남은 AI 생성 횟수와 카드의 저장 상태는 학습 공간에서 확인할 수 있습니다.</p></section></PublicContent>;}
