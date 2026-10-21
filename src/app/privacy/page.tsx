import Link from 'next/link';
import PublicContent from '@/components/public-content';
import styles from '@/components/landing.module.css';
export const metadata={title:'개인정보 안내 — 모아',robots:{index:false,follow:true}};
export default function Privacy(){const operator=process.env.SITE_OPERATOR_NAME;const contact=process.env.SUPPORT_EMAIL;const confirmed=process.env.PRIVACY_POLICY_CONFIRMED==='true'&&operator&&contact;return <PublicContent title="개인정보 안내" intro="현재 서비스에서 어떤 정보를 사용하고 어디에 저장하는지 안내합니다."><>{!confirmed&&<p className={styles.draft}>출시 전 안내 초안입니다. 아래 실제 동작을 기준으로 작성했으며, 운영자 정보·보관/삭제 정책의 최종 검토 후 공개해야 합니다.</p>}</>
  <section><h2>운영 및 문의</h2><p>운영자: {operator||'출시 전 등록 필요'} · 문의: {contact||'출시 전 등록 필요'}</p></section>
  <section><h2>로그인과 학습 기록</h2><p>Google 로그인을 위해 Firebase Authentication을 사용합니다. 계정 식별자와 제공된 이름·이메일·프로필 사진은 로그인과 계정 표시에 이용됩니다. 학습 카드의 질문·답·해설·분류·태그와 복습 기록은 계정별로 분리하여 저장합니다.</p></section>
  <section><h2>AI 카드 생성</h2><p>자료로 만들기의 기본 추출은 브라우저에서 실행하며 외부 AI로 자료를 보내지 않습니다. AI 분석을 직접 선택하거나 실제 AI 자동 생성을 실행하면 주제·카테고리·선택적으로 입력한 참고 자료를 Google Gemini로 전송합니다. 해당 서비스의 요금제와 데이터 처리 조건이 적용될 수 있습니다. 민감한 개인정보나 전송할 권한이 없는 자료는 입력하지 마세요. 개발용 Mock 모드와 홈의 예시 카드 체험은 Gemini를 호출하지 않습니다.</p></section>
  <section><h2>브라우저와 클라우드 저장</h2><p>클라우드 저장이 활성화된 학습 공간은 Firebase Firestore에 데이터를 저장합니다. 브라우저에는 빠른 표시와 실패한 저장의 재시도를 위한 캐시 및 전송 대기 정보를 보존할 수 있습니다. 기존 로컬 덱은 사용자가 이전을 시작하면 클라우드로 복사하며, 원본과 이전 백업은 브라우저에 보존합니다. 로그아웃만으로 저장 데이터가 모두 삭제되지는 않습니다.</p></section>
  <section><h2>선택적 이용 분석</h2><p>선택적 분석은 설정과 사용자 동의가 있을 때만 동작하도록 구성되어 있습니다. 동의는 설정에서 거부하거나 철회할 수 있습니다. 자세한 현재 동작은 <Link href="/privacy/analytics">선택적 분석 안내</Link>에서 확인하세요.</p></section>
  <section><h2>데이터 관리</h2><p>저장된 질문과 답을 수정하고 카드나 덱을 삭제할 수 있습니다. 현재 카드와 덱 삭제는 학습 목록에서 제외하는 방식이며, 관련 기록의 즉시 영구 삭제를 의미하지는 않습니다. 설정의 계정 삭제에서 Google 재인증 후 Firebase 로그인 계정과 서버의 개인 학습 자료·기록·AI 임시 결과·분석 동의를 삭제할 수 있습니다. 현재 브라우저의 해당 계정 캐시와 이전 백업도 삭제합니다. 다른 브라우저·기기의 로컬 자료는 그 기기에서 직접 삭제해야 합니다.</p></section>
  <section><h2>보관과 삭제 후 처리</h2><p>계정 사용 중에는 저장한 학습 자료와 기록을 유지합니다. 덱/카드 삭제는 목록에서 제외하는 방식이며, 계정 삭제에서는 개인 자료를 영구 삭제합니다. 삭제 도중 실패하면 새 저장을 차단하고 재인증 후 재시도할 수 있습니다. 진행 중인 요청이 삭제한 자료를 다시 저장하지 못하도록 계정 경로에 자료·이메일·토큰을 포함하지 않는 최소한의 삭제 상태가 남습니다. 이 상태는 삭제 완료 확인 후 30일 이후 운영자가 정리해야 하며, 자동 정리 작업은 아직 연결되어 있지 않습니다. 개인과 분리된 서비스 사용량/비용 합계는 계정 삭제로 차감되지 않습니다.</p></section>
  <section><h2>운영 오류 확인</h2><p>운영 오류는 발생 시각·고정 오류 분류·임의 오류 ID만 서버 로그에 기록합니다. 카드 내용, 입력 자료, 토큰, API 키, 이메일은 별도 오류 로그에 넣지 않습니다. 호스팅 제공자의 기본 접속 로그와 보관 기간은 실제 배포 환경에서 확인해 운영 정책에 반영해야 합니다.</p></section>
</PublicContent>;}
