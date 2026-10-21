> 자료 기반 생성 최신 변경: [MATERIAL_CREATION.md](MATERIAL_CREATION.md). 현재 기본 모드는 자료로 만들기이며, 카드의 선택적 해설/태그/분류 필드를 저장합니다.

> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# Phase 1 — 프로젝트 분석

> Phase 1·2 기준선/승인 설계 문서입니다. Phase 3 작업 1의 현재 코드·구체화된 결정은 [FIRESTORE_SYNC.md](FIRESTORE_SYNC.md)를 참고하세요.

기준: 2026-10-21, ai-card 작업 트리. 요청 원문: `~/Desktop/mvp/CARD_PLAN.md`.
Phase 1·2 문서만 작성했다. 아래의 제안은 미구현이며 데이터·Firebase 설정·배포를 변경하지 않았다.

## 기술과 구조

| 항목 | 실제 확인 |
|---|---|
| 런타임/패키지 | Node 24.16.0, npm, package-lock.json |
| 프레임워크 | 설치된 Next.js 16.4.2, React/React DOM 19.3.1 |
| 라이브러리 | TypeScript 7.0.2, Zustand 5.0.15, Zod 4.6.7, Firebase 13.0.0, Admin 14.5.0, lucide-react 1.59.0 |
| 버전 정책 | 주요 패키지 다수가 latest. lockfile로 현재 재현 가능하나 업데이트 시 회귀 위험 |
| 라우팅 | `src/app/page.tsx`의 `/`, `src/app/api/generate/route.ts`의 POST만 존재. 화면 전환은 URL이 아닌 StudyApp의 view 상태 |
| UI | `study-app.tsx`에 대시보드·덱·생성·통계·복습 모달 집중. all-review-panel, 인증, avatar는 분리 |
| 스타일 | globals.css의 CSS 변수·보라색 중심 패널, 미디어 쿼리. 동일 선택자를 뒤에서 재정의하는 누적 구조 |
| 상태 | UID별 Zustand vanilla store + persist, 컴포넌트 로컬 상태로 세션/입력 관리 |
| 테스트 | node:test 5개 파일, 20개 테스트. lint/E2E/Rules 도구 및 CI·배포 설정 파일은 저장소에서 확인되지 않음 |

## 구현 현황과 근거

| 기능 | 현재 동작 / 근거 |
|---|---|
| Google 로그인 | auth-account의 popup 로그인/로그아웃, 오류 안내. auth-provider의 onAuthStateChanged |
| 인증 격리 | StudyGate가 인증 확인 중 로딩, 비로그인 로그인 화면. UID key로 StudyProvider 재생성하여 세션 종료 |
| 서버 인증 | server-auth에서 Bearer 토큰을 Admin verifyIdToken으로 검증. 누락/잘못된 토큰 401. 서명 검증용 projectId 사용, Firestore 서버 자격증명은 별도 미구성 |
| 생성 | title 1~80자, category 18종, count 정수 1~20 기본10, 자료 15,000자. 5/10/15/20 프리셋 |
| Gemini | 서버 fetch, JSON Schema+Zod, 안전 차단/파싱/개수 검증, 55초 전체 타임아웃. 500/502/503/504만 최대 2회 재시도 |
| 자료 기반 | 자료가 있으면 자료에만 근거하도록 프롬프트. 없으면 제목·카테고리 기반. 사실 검증 엔진은 없음 |
| 덱 | 생성 즉시 UUID 덱 로컬 저장, 검색/필터/확인 후 덱 삭제. 개별 카드 CRUD·미리보기 없음 |
| 복습 | 전체/기한 도래/덱/섞기/주관식 직접 비교, 원래 덱 표시, 2단계 자기 평가, 완료 카드 수 |
| 일정 | 기억: max(1, interval×2)일 후, 실패: interval=0 및 1분 후 |
| 저장 | moa-study-user-{uid}, persist version=1. decks/reviews 전체 JSON 저장 |
| 이전 | moa-study-v1을 최초 계정에 복사, moa-study-legacy-owner 기록. 원본 키 유지. 고정 ID+created=0인 기존 내장 샘플만 제거 |
| 통계 | 로컬 날짜 문자열별 복습 횟수, 최근7일, 전체 성공 비율. 동일 카드 반복도 횟수에 포함 |
| 일일 목표 | 20장 고정 표시/달성률. 사용자 변경 및 설정 저장은 미구현 |
| 반응형 | CSS에 모바일 대응 규칙 존재. 실제 브라우저·모바일 검증은 이번 단계에서 미실행 |

## 현재 모델

- Card: question, answer, due(epoch ms), interval(일). 고유 ID 없음.
- Deck: id, title, category, color, cards 배열, created(epoch ms).
- Review: date(브라우저 로컬 YYYY-MM-DD), correct(boolean). 카드/덱/시각/타임존/세션 ID 없음.
- 설정·클라우드·사용량 모델은 없음. 로컬 데이터 JSON의 런타임 스키마 검증도 없음.

## 문제와 개선 우선순위

| 우선순위 | 코드에서 확인한 제약 | 개선 |
|---|---|---|
| P0 | 인증된 사용자에게 서버 생성 일일/동시/중복 제한 없음 | Firestore 트랜잭션 예약과 서버 전역 비용 차단 |
| P0 | 로컬 저장만으로 다른 기기 복원 불가, JSON 손상/용량 실패 처리 부족 | 검증·백업·재개 가능한 이관 후 클라우드 authoritative 저장 |
| P0 | 카드 index로 평가, rate는 유효 카드 존재 확인 없이 기록 추가 | 안정 ID, revision 검증, eventId 기반 원자 처리 |
| P0 | 생성·평가에 서버 idempotency 없음 | 재시도/빠른 연속 클릭의 중복 방지. UI disabled만으로 정확성 보장 불가 |
| P1 | 생성 결과 즉시 저장, 중복 질문 탐지/목적/난이도/출력 토큰 상한 없음 | 초안 검토, 중복 정규화, 옵션과 토큰 한도 |
| P1 | 리뷰 원본 정보 부족 | 과거 성공/날짜만 보존, 카드별 통계를 소급 생성하지 않음 |
| P1 | StudyApp 결합, useStudy 전체 구독, CSS 중복 | 기능별 모듈·selector·기존 시각 스타일 유지 |
| P1 | 공개 랜딩/정책/계정삭제/실제 설정 없음 | 공개·개인 라우트 분리, 삭제 작업 설계 |
| P2 | 단위 테스트가 HTTP 라우트·실제 로그인·Rules를 검증하지 않음 | 통합/에뮬레이터/E2E 보강 |

기존 아키텍처는 작은 로컬 MVP에 적합하다. UI와 인증·검증 로직은 재사용하되 저장, 복습 계산, 생성 제한을 독립 모듈로 옮기는 것이 적절하다. 전면 재작성이나 스택 변경은 필요 없다.

## 확인할 수 없는 사항

실제 Firebase 프로젝트의 Firestore 존재/리전/Rules/IAM, Auth 제공업체·도메인 설정, Gemini 키의 모델 접근권한·요금제·쿼터, 운영 도메인·호스팅·배포·실사용자 수·실제 비용·실제 로컬 데이터 분포는 확인하지 않았다. `.env.local` 비밀값은 열람하지 않았다. README의 설명만으로 실서비스 성공을 인정하지 않는다.

검증 결과는 [TESTING.md](TESTING.md), 설계 승인 대상은 [ROADMAP.md](ROADMAP.md)에 정리했다.
