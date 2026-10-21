import PublicContent from '@/components/public-content';
import styles from '@/components/landing.module.css';
export const metadata={title:'이용 안내 — 모아',robots:{index:false,follow:true}};
export default function Terms(){return <PublicContent title="서비스 이용 안내" intro="모아를 이용하기 전에 현재 제공하는 기능과 이용 시 유의할 점을 확인해 주세요."><p className={styles.draft}>출시 전 안내 초안입니다. 이 페이지가 정식 이용약관 검토와 운영 정보 확정을 대신하지는 않습니다.</p>
  <section><h2>학습을 돕는 도구입니다</h2><p>모아는 AI 학습 카드와 복습 기능을 제공하는 학습 보조 서비스입니다. AI가 생성한 내용은 오류나 누락이 있을 수 있으므로 원문 자료와 비교하고 직접 확인해 주세요. 특정 시험 결과나 학습 성과를 보장하지 않습니다.</p></section>
  <section><h2>입력할 권한이 있는 자료를 사용하세요</h2><p>본인이 입력·처리할 권한이 있는 자료를 사용하고, 다른 사람의 개인정보나 권리를 침해하는 내용은 입력하지 마세요. 계정이나 API를 악용하여 비정상적인 요청을 보내거나 서비스의 사용량 제한을 우회하지 마세요.</p></section>
  <section><h2>무료 기능과 사용량 한도</h2><p>현재 학습 기능은 무료로 시작할 수 있으며 AI 생성에는 운영 설정에 따른 사용량 한도가 있습니다. 한도와 오류는 생성 화면에서 안내합니다. AI 호출이 시작된 뒤 실패한 요청은 사용 횟수에 포함될 수 있습니다. 향후 유료 기능이나 광고를 도입할 경우 별도 안내가 필요하며, 현재 페이지에서 결제나 광고를 활성화하지 않습니다.</p></section>
  <section><h2>저장 상태를 확인하세요</h2><p>연결 오류나 브라우저 저장 공간 문제로 저장이 완료되지 않을 수 있습니다. 저장 상태와 오류 안내를 확인하고 필요한 경우 다시 시도해 주세요. 기기에만 저장된 기록은 해당 브라우저의 데이터 삭제에 영향을 받습니다.</p></section>
</PublicContent>;}
