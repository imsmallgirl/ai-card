> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# 비로그인 공개 화면

현재 작업 기준은 `~/Desktop/mvp/CARD_PLAN.md`이며 CARD_PLAN2는 구현 기준에서 제외한다. 직전 공개 덱·공유·복사·신고 기능의 화면/API/규칙/인덱스를 되돌렸다. 기존 개인 학습, AI 생성, Firestore 동기화, 카드 편집 및 실패 요청 복구 코드는 보존했다. 운영 데이터나 클라우드 설정을 변경하지 않았다.

## 화면과 인증

- `/`: 서비스 가치, 주요 기능, 학습 방법, FAQ, Google 로그인, 과목별 예시 카드 체험.
- `/about`: 현재 기능과 학습 방법 설명.
- `/login`: 기존 Google 로그인 연결. 인증되면 개인 학습 공간으로 이동.
- `/privacy`, `/terms`: 출시 전 초안임을 명시한 안내. 운영 주체·문의처·보존기간 등을 확정한 뒤 출시 전에 보완해야 한다.

루트에서 인증 확인 중과 로그아웃 상태에는 서버가 렌더링한 공개 콘텐츠를 표시한다. 인증이 확인된 사용자에게만 기존 StudyProvider/StudyApp을 마운트한다. 개인 저장/생성 API는 계속 인증을 요구한다. 로그아웃 시 공개 화면으로 돌아간다.

예시 카드는 정적 데이터와 컴포넌트 내부 상태만 사용한다. 정답 전환, 다음 카드, 과목 선택은 Gemini/Firestore/브라우저 저장소를 사용하지 않는다. 실제 생성·저장은 기존 로그인 흐름을 그대로 사용한다. 광고나 유료 결제는 연결하지 않았다.

공개 안내에는 메타데이터와 robots를 제공한다. 운영 도메인이 확정되면 서버 환경변수 `SITE_URL`에 해당 사이트의 절대 URL을 지정한다. sitemap은 유효한 URL이 있을 때 `/`, `/about`만 포함하며 미설정 상태에서는 빈 목록을 반환한다. 정책 초안과 로그인 페이지는 noindex다.

## 주요 파일

- `src/components/landing-page.tsx`, `landing.module.css`: 공개 랜딩 구성과 반응형 스타일.
- `src/components/landing-demo.tsx`, `src/lib/landing-demo.ts`: 저장되지 않는 예시 체험.
- `src/components/study-gate.tsx`, `auth-account.tsx`: 공개/개인 화면 경계와 기존 로그인 재사용.
- `src/components/public-content.tsx`, `login-panel.tsx`, `src/app/{about,login,privacy,terms}`: 공개 안내 페이지.
- `tests/http/landing.test.mjs`: 익명 콘텐츠, 안내 페이지, 공유 경로 제거, 개인 API 인증 검사.

## 검증

일반 테스트 85개, 프로덕션 HTTP 검사 4개, Firestore 에뮬레이터 테스트 6개와 빌드 통과. 브라우저에서 데스크톱 랜딩과 예시 정답 전환을 확인했다. 실제 Google 로그인/로그아웃, 모바일 기기 E2E, 운영 Firestore/Gemini 호출은 실행하지 않았다. 에뮬레이터에서 AI 결과 및 Mock 결과의 저장·재조회·편집·삭제, 계정 격리와 클라이언트 쓰기 차단을 검증했다.
