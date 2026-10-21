# Phase 4 품질 검증 · Phase 5 출시 준비

검증일: 2026-10-21. 기준: 사용자가 제시한 품질/출시 항목과 CARD_PLAN 방향. 공유 기능과 CARD_PLAN2 성장/수익화 항목은 포함하지 않았다. 기존 미커밋 작업을 유지했으며 배포·커밋·실제 계정 삭제·유료 AI 호출은 하지 않았다.

## 완료한 코드 보완

| 항목 | 결과 |
|---|---|
| 중복 개선 | 생성/수정/학습 팝업의 키보드 포커스/닫기/복원 공통 hook, 하루 목표 비율 공통 함수 |
| 타입 | TypeScript strict 유지, 입력 Zod 검증, 새 계정 삭제 API는 verified UID·최근 auth_time·확인 문구 검사 |
| 인증 | 토큰 형식/길이 제한 후 Admin verifyIdToken(token,true). 삭제·비활성화·폐기된 세션 거부 |
| 서버 권한 | UID는 인증 결과로만 결정. body의 다른 UID는 사용하지 않음. 사용자 클라이언트 Firestore 쓰기 금지 유지 |
| 계정 삭제 | 재인증·‘삭제’ 확인, 개인 하위 자료 삭제, Auth 삭제, 현재 브라우저 계정 캐시/백업 제거. 삭제 도중 쓰기 재생성 차단 및 중단 후 재시도 |
| Firestore 규칙 | 삭제 잠금 계정은 직접 읽기도 거부. 다른 계정/운영 컬렉션 차단 유지 |
| 인덱스 | 동기화의 updatedRevision+document ID 변경분 조회는 단일 필드 인덱스 사용. 사용하지 않는 긴 해설/태그/AI draft 카드의 인덱스 제외 추가. 운영 준비 상태는 배포 후 확인 필요 |
| 성능 | cloudView의 덱별 전체 카드 반복 탐색을 한 번의 Map 그룹화로 교체. 30초 가시 탭 polling/50개 cursor/기존 outbox 유지. 실측 Lighthouse/부하 수치는 측정하지 않음 |
| AI 비용 | 잘못된/비활성/문항 수 초과 요청은 Firestore 예약/공급자 호출 전에 거부. 운영/호스팅에서 로컬 unlimited 우회 차단. 기존 UID·전역 예산/멱등성/토큰 상한 유지 |
| 버전 재현성 | 현재 설치 버전 고정, lockfile 유지, Node 범위와 .nvmrc24 추가. 새 패키지 버전을 다운로드/업그레이드하지 않음. 사용 중이던 @next/env를 직접 의존성으로 명시 |
| 오류 처리 | Next16.4 설치 문서의 retry API로 error/global-error 화면,404 화면 추가. 오류 원문/요청/토큰/UID를 넣지 않는 고정 JSON 운영 로그, /api/health liveness 추가 |
| 웹 헤더 | nosniff,frame DENY,referrer policy,카메라/마이크/위치 권한 제한,프레임워크 응답 헤더 제거. Firebase popup에 영향을 주는 강제 COOP/미검증 CSP는 도입하지 않음 |
| 접근성 | 팝업 Tab/Shift+Tab 순환·Escape·포커스 복원, focus-visible, 모바일 터치 타깃, reduced-motion. 비대화형 캘린더의 과도한 Tab 정지 제거 |
| 반응형 | 480px 이하 입력/긴 카드/버튼 감싸기와 최소 폭 보완. 실제 단말/화면 확인은 아래 미검증 범위 참조 |
| 표시 일치 | 랜딩/소개에서 폐기된 다시·기억함 평가 안내를 완료 기반 학습으로 교체, 설정/정책의 계정 삭제 및 실제 보관 상태 설명 |

## 실행한 검증

| 명령/항목 | 결과 | 범위 |
|---|---|---|
| npm test | 137/137 통과 | 기존 생성·자료 파서·중립 완료·마이그레이션·클라우드 + 출시 설정·목표 비율·삭제 HTTP 경계·캐시 정리·로그 비노출·호스팅 unlimited/무효 요청 비용 차단 |
| npm run typecheck | 통과 | strict TypeScript |
| npm run build | 통과 | Next16.4 프로덕션 빌드 |
| npm run test:firestore | 11/11 통과 | 실제 로컬 Firestore 에뮬레이터, Rules·소유자 격리·transactions·재시도·중립 완료·삭제 잠금/중단 후 재시도. Auth 사용자 삭제 자체는 fake adapter로 대체 |
| npm run test:http | 6/6 통과 | 실제 프로덕션 HTTP 서버의 공개 HTML/정책 초안/공유404/개인 API401/보안 헤더/liveness. 실로그인 없음 |
| npm run check:bundle | 통과 | .next/static21개 파일에서 현재 설정된 서버 Secret1개 값 검사. 값 미출력 |
| npm audit --omit=dev | 알려진 취약점0건 | 실행 시점 npm 데이터베이스의 운영 의존성. 보안 전체를 보증하지 않음 |
| npm ls --depth=0 | 통과 | 직접 의존성과 설치 상태 |
| git diff --check | 통과 | 공백/패치 오류 |
| npm run check:release | 의도된 실패 | 운영자·문의 이메일·SITE_URL·정책 확인이 미설정. 생산 설정에서 AI 생성 비활성 경고. 로컬 개발 설정을 운영으로 자동 복사하지 않음 |

위 검증에 유료 Gemini 호출이나 운영 Firestore 쓰기는 없다. 로컬 환경 파일/ADC를 생성·변경하거나 서비스 계정 비밀키를 만들지 않았다.

## 아직 통과로 볼 수 없는 범위

- 브라우저 자동화의 in-app browser가 사용 불가 상태여서 데스크톱/모바일 화면 캡처·로그인 후 조작을 수행하지 못했다. CSS/의미 구조 확인을 실제 반응형/접근성 통과로 간주하지 않는다.
- 실제 Google 로그인/재인증/폐기 토큰 확인·실제 Firebase Auth 계정 삭제·운영 IAM은 테스트 배포 후 일회용 계정으로 검증해야 한다.
- 실제 모델의 무료 티어 접근과 생성 내용 정확성·실패 응답은 이 단계에서 호출하지 않았다. 공급자 테스트는 fake 응답이다.
- App Hosting 어댑터/Vercel 빌드·실제 배포·도메인/HTTPS·Rules/인덱스 운영 배포는 미실행이다.
- 외부 오류 수집 서비스/호스팅 경보는 연결하지 않았다. 고정 로그와 liveness만 준비했다. 플랫폼 기본 접속 로그는 별도 설정/보관 정책 대상이다.
- 오류 로그/정책 문구의 개인정보 처리 적합성을 법적으로 보증하지 않는다. 운영자 정보·보관 기간·문의 창구·제공자 조건을 실제 운영 기준으로 확정해야 한다.
- 계정 삭제 기술 상태의30일 이후 정리와 만료 AI draft 물리 삭제는 자동 스케줄러가 연결되지 않았다. 조회 만료와 물리 삭제는 다르다.
- CSP/App Check/호스팅 단의 봇·일반 API rate limit/부하 시험은 향후 공개 트래픽 확대 전 별도 검토 대상이다. AI에는 기존 전역·개인 한도가 있다.

## 출시 판단

코드와 자동 테스트 기준으로 1차 **비공개 테스트 배포를 준비할 수 있는 상태**다. 현재 `check:release` 실패 항목과 실제 IAM/인증·화면 검증이 남아 있어 공개 출시 완료는 아니다. [배포 가이드](DEPLOYMENT.md), [환경변수](ENVIRONMENT.md), [출시 체크리스트](RELEASE_CHECKLIST.md)를 순서대로 따른다. 실제 배포 플랫폼은 미확정이다.

## 주요 변경 파일

- 서버: server-auth, firestore-database, account-delete/account-http, operational-log, generation-http/usage, 새 /api/account 및 /api/health, instrumentation
- UI: use-dialog-accessibility, delete-account, study-settings/app, 생성/수정 팝업, study-completion, 오류/404/정책/소개/랜딩, globals.css
- 모델/성능: study-goal, release-config, study-cloud-store
- 설정: package.json/lock, .nvmrc, next.config.ts, .gitignore, .env.example, firestore.rules/indexes, apphosting.example.yaml
- 검증: release-quality.test.mjs, generation-mock.test.mjs, Firestore 통합 및 HTTP smoke, check-release/check-bundle-secrets scripts
