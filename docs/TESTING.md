# Phase 1·2 검증 기록

실행일 2026-10-21, Node 24.16.0, 로컬 저장소. 기능 코드를 수정하지 않은 기준선 검증이다. 문서 작성으로 클라우드 기능이 구현·검증된 것으로 해석하지 않는다.

| 명령/항목 | 결과 |
|---|---|
| npm test | 성공: 20개, 실패0. 5개 node:test 파일 |
| npm run typecheck | 성공: tsc --noEmit |
| npm run build | 성공: Next16.4.2 Turbopack, `/` 정적·`/api/generate` 동적 |
| Lint | 미실행. package.json에 lint 스크립트/저장소에 설정 없음. 이번 문서 단계에 패키지 추가 안 함 |
| Node 경고 | MODULE_TYPELESS_PACKAGE_JSON 경고 발생. 테스트 성공에 영향 없음. 모듈 정책은 후속 구현 시 검토 |

## 현재 테스트가 검증하는 범위

- generationInput 기본값/카테고리/자료/수량 경계, 구조 JSON 요청, mocked fetch의 제한된 재시도/취소.
- 잘못된 Bearer 및 임의 토큰 인증 거부. 유효 실토큰 성공과 HTTP401 통합 검증은 아님.
- 전체/기한 도래/셔플 복습 참조 및 비변이, 빈 세션.
- 샘플 제거 조건, 메모리 저장소 계정 분리·최초 legacy 귀속·복습 원본 덱 반영.

## 이번에 검증하지 않은 범위

Google 실로그인/로그아웃, 유효토큰 서명 및 인증서 네트워크 경로, 실제 Gemini 호출/품질/비용/모델 접근권한, 실브라우저 새로고침/계정전환/연속클릭, 모바일/접근성, 손상/용량초과 localStorage, 운영환경/배포. `.env.local`은 build가 로드했지만 비밀값을 읽거나 외부 생성 요청을 보내지 않았다.

Firestore는 미구현이므로 이관·동기화·Rules·트랜잭션·사용량 경쟁 테스트를 실행할 수 없다. Emulator/Rules 테스트 의존성·CI도 아직 없다. 프로덕션 빌드 성공은 외부 서비스 정상 동작의 증거가 아니다.

## Phase 3 이후 테스트 계획

| 영역 | 필수 사례 |
|---|---|
| 인증/라우팅 | 로그인/로그아웃/만료/계정전환/인증로딩에서 이전 UID 화면 및 늦은 응답 비노출 |
| 이관 | 빈/손상/구버전/중복질문/타계정/이미 클라우드 존재/부분실패/응답유실/2기기/재실행, 원본 보존 및 ledger 정확히1회 집계 |
| Rules/API | 미인증·타 UID 읽기/쓰기 차단, owner 허용읽기, client 집계/사용량변조 거부, Admin API 자체 소유권 검증 |
| 비용 보호 | limit=3에 병렬20요청, 동일 key 반복·다른 payload, 프로세스 crash/lease만료/UTC 자정, provider 최대3attempt/요청, 전역예산 소진 |
| AI | 파싱/빈배열/과다수량/빈필드/중복/불완전 finishReason/차단/타임아웃/토큰상한, 실패 차감 정책 |
| CRUD | 카드 추가/편집/삭제/재정렬/즐겨찾기/초안저장 중복·revision충돌·수정 일정초기화·이력보존 |
| 복습 | four ratings 일정, 중복eventId/연속 클릭/2기기충돌/삭제된카드/세션종료 및 재전송 |
| 날짜/통계 | UTC한도와 사용자날짜 구분, DST/윤년/월경계/타임존변경/legacy 통계 누락정보·반복과 고유카드 구분 |
| 브라우저 | 새로고침·오프라인 큐·다른 기기 동기화·초안 보존·키보드 입력충돌·모바일 touch/dialog focus |
| 삭제 | deleting 상태 차단·재인증·하위 컬렉션 제거·중간 실패 재개·Auth 삭제 순서 |

기존 node:test를 순수 로직에 유지하고, 승인 후 Rules용 Firebase Emulator 및 브라우저 E2E 도구를 필요한 범위에서 추가한다. 실제 클라우드 호출/비용 부하는 별도 환경과 승인 범위에서 진행한다.

## Phase 3 작업 1 — 실제 검증 결과

2026-10-21, Firestore 동기화 구현 후:

- `npm test`: 기존20개 + 신규12개 = **32개 통과**, 실패0. 신규는 서버 API 인증/UID 경로 격리·원자적 집계·revision 충돌·멱등성·변경분 페이지·오프라인/응답유실 재전송·계정변경 후 늦은응답 무시·저장용량 오류·손상 legacy 보호를 검증한다. 단위 테스트의 2기기 시나리오는 독립 store 인스턴스 및 메모리 DB를 사용한다.
- `npm run typecheck`: 통과.
- `npm run build`: 통과, `/api/study` 동적 Route Handler 포함.
- `npm run test:firestore`: **2개 통과**(통합 테스트 및 페이지 하위 테스트). 실제 로컬 Firestore Emulator에서 Rules의 owner 읽기/타계정·미인증 읽기·모든 client 쓰기/내부 metadata 접근 거부, Admin transaction 중복/경합 및50개 페이지를 확인했다. 출력의 PERMISSION_DENIED는 assertFails가 기대한 결과다.
- 에뮬레이터 실행에는 Java21이 필요했다. 기존 Java17·샌드박스 포트 제한·사용 중인8080 때문에 초기 시도는 실패했고, 임시 `/private/tmp` Java21 및8787 포트로 실행해 최종 통과했다. demo-moa-study만 사용했으며 실제 Firebase 배포/과금/운영 데이터 변경은 하지 않았다. npm 패키지/임시 런타임/에뮬레이터 다운로드에만 외부 네트워크를 사용했다.
- `git diff --check`: 통과. lint는 여전히 설정이 없어 미실행.
- `npm audit`: 개발용 firebase-tools의 전이 의존성 포함 **7건(중간4·높음3)** 보고. `npm audit --omit=dev`: **0건**. 신규 테스트 도구 경고이며 무관한 패키지 강제 교체는 하지 않았다. 테스트 도구 설치 시 deprecated 의존성 경고도 발생했다.
- 기존 Node MODULE_TYPELESS_PACKAGE_JSON 경고는 남아 있다. 에뮬레이터 Admin SDK에서 metadata 조회 경고가 있었으나 테스트는 통과했다.

실제 Google 로그인·운영 Firestore/ADC·실제 다른 기기 브라우저·모바일·Web Locks의 브라우저 수명주기 E2E·Gemini 실호출은 이번에 검증하지 않았다. 기본 cloud flag는false이고 기존 로컬 계정 마이그레이션은 미구현이다. 따라서 운영 동기화가 활성화되었다고 보고하지 않는다.

재현: Node24, Java21+, `npm install`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:firestore`. 에뮬레이터 스크립트는 host가 없으면 실패하도록 작성되어 미실행을 성공/skip으로 처리하지 않는다.

## Phase 4 작업 1 — AI 비용 보호 검증 (2026-10-21)

- `npm test`: **51개 통과**, 실패0. 기존32 + 비용 보호18 + 생성 덱 ID 재저장1. 비용 테스트는 직렬화된 메모리 transaction 및 mocked provider를 사용한다.
- 신규 단위/API 범위: 동시20요청의 UID lock, 일일3회 소진, 여러 UID 전역 한도, 각 재시도 예산 차감, 동일ID 재전송/다른입력409/진행중 중복 방지, 호출전 환불/호출후 실패차감,UTC 자정/lease회복/늦은완료 차단,부정확한토큰unknown,응답크기/finishReason/영구403,Firestore불가 fail closed,admin custom claim/날짜검사,클라이언트401 시 같은 ID 및 UID별 복구 데이터.
- `npm run test:firestore`: **3개 통과**, 실패0. 기존 Rules/복습·페이지 검증에 실제 quota transaction 병렬12예약,사용자/전역 한도·성공결과 재사용·usage/lock/request/draft/serviceUsage 읽기/쓰기 차단 통합 검증을 추가했다. demo-moa-study localhost8787, 임시Java21 사용. provider는mock이며실과금호출없음.
- `npm run typecheck`, `npm run build`, `git diff --check`: 통과. build에 /api/usage, /api/generation-requests/[id], /api/admin/costs 포함.
- lint는 설정 부재로 미실행. 기존 MODULE_TYPELESS_PACKAGE_JSON·에뮬레이터 metadata조회 경고는 남아 있으나 테스트는 통과. PERMISSION_DENIED 로그는 예상된 차단 검증이다. 새로운 패키지는 설치하지 않았고 이번에 audit를 다시 실행하지 않았다.
- 미검증: 실Gemini모델/키/쿼터·실제토큰과 청구액·운영ADC/IAM·Google실로그인·다기기브라우저/모바일·DOM의생성복구E2E. UI 연동은 타입/프로덕션빌드와 순수클라이언트요청 테스트 범위로 확인했다.
- 실제 .env.local, 운영데이터, rules/index배포, 관리자claim, Analytics/광고·과금 설정은 변경하지 않았다.

최신 코드 계약·추가 DB/파일 목록과 한계는 [AI_COST_PROTECTION.md](AI_COST_PROTECTION.md)를 참고한다. 과거 Phase의 결과는 당시 기준선 기록이다.

## Phase 4 작업 2 — Analytics 동의·이벤트 기반 (2026-10-21)

- `npm test`: **70개 통과**, 실패0. 기존51 + Analytics19. 선택적 client/server와 외부adapter는 메모리transaction·mock transport를 사용해 검증했다.
- 신규 검증: 미동의/flagoff의 무수집·무전송, stale grant/정책버전/철회epoch, 재시도/병렬claim/서버commit의 중복방지, 신규가입의 실제서버메타 기준, 최초관측·정확한7일날짜, 민감속성/UID/가짜공개·광고 이벤트 거부, GA4허용payload, offline철회재전송, 계정전환후늦은응답, 다른탭pause·background refresh 경합, 손상localStorage fail closed,200client신호한도,401갱신상한.
- `npm run test:firestore`: **4개 통과**, 실패0. 기존quota/복습/페이지Rules검증 + 실제동의transaction·최초덱outbox·병렬claim·철회후취소·consent/growth/outbox 본인및타계정 직접접근차단. demo-moa-study localhost8787/임시Java21 사용. Google Analytics 실전송 없음.
- `npm run typecheck`, `npm run build`, `git diff --check`: 통과. 신규 /api/analytics/consent, events, export와 정적 /privacy/analytics 포함.
- lint는 기존설정없어 미실행. 기존 Node모듈형식/에뮬레이터metadata조회 경고는 남아 있다. 예상PERMISSION_DENIED는 차단테스트 결과다. 새패키지/audit실행 없음.
- 미검증: 실제GA4 validation·보고서·외부수신, 실제Auth관리조회ADC권한, 브라우저DOM/모바일·실storage event·다른기기철회E2E. 브라우저SDK가 없는 구조는 소스확인 및 fake sender payload로 검증했다. visual/real-network E2E를 수행한 것으로 보고하지 않는다.
- 수집/외부전송 기본false. 운영환경변수/속성/비밀키·Rules배포/실데이터/기존저장자료 변경 없음. 자동물리삭제·공개/광고이벤트 발행·외부에러수집은 아직미구현이다.

실제구현 계약·변경파일·서버adapter를 선택한 이유는 [ANALYTICS.md](ANALYTICS.md)에 정리했다.

## ADC 미설정 unhandledRejection 수정 (2026-10-21)

누락된 자격증명 경로로 기존 SDK 동작을 재현했을 때 요청 catch 이후에도 별도 unhandledRejection이 발생했다. Firestore 클라이언트 생성 전에 Admin ADC getAccessToken을 await하도록 바꾸고 관련 DB factory/caller를 비동기로 연결했다. 실패는 FIRESTORE_CREDENTIALS_REQUIRED(503), emulator는 사전 ADC 검사 제외. 꺼진 Analytics export는 DB 초기화도 생략한다.

- `npm test`:72개 통과(기존70+회귀2). 별도 `--unhandled-rejections=strict` 자식 프로세스에서 잘못된 파일경로/ADC완전미설정, 동시4호출/재시도, API503과 Firestore 미생성을 확인했다. 실제 자격증명이나 metadata 서버에 접근하지 않도록 테스트 환경을 격리했다.
- `npm run test:firestore`:4개 통과. emulator의 ADC 불필요 경로와 비동기 repository로 변경한 복습/사용량/분석 동작 확인.
- typecheck/build/diff check 통과. 실제 ADC 설정·클라우드IAM·실과금API/운영배포는 변경/검증하지 않았다. 로컬 인증 설정 절차는 README에 추가했다.


## AI 카드 Firestore 자동 저장 보완 (2026-10-21)

- `npm test`: 77개 통과. 기존 73개 + 오프라인 생성 저장 확인 실패/복구·다른 기기 중복 방지, 내용 편집 revision/재시도/덱 삭제, 기존 로컬+신규 클라우드 혼합 모드의 재로그인/계정 분리, 조작된 UID의 타 계정 수정·삭제 거부 4개.
- `npm run test:firestore`: 5개 통과. 기존 Rules/통계/AI 사용량/Analytics 검증에 실제 Firestore emulator + generation service(mock provider) + 인증 API + cloud store의 생성 결과 저장/재조회/새 세션 복원/수정/타 계정 격리/덱 삭제 통합 검증 추가. 저장·쓰기 트랜잭션 검증은 demo-moa-study에서만 수행했다.
- 시스템 Java가 없어 일반 실행은 실패했다. 이전 테스트용 임시 JRE21과 캐시된 emulator JAR를 사용했고 sandbox의 localhost 바인딩 제한은 승인된 재실행으로 해결했다. 시스템 Java 설치나 인증 정보 생성·변경은 하지 않았다.
- `npm run typecheck`, `npm run build`, `git diff --check`: 통과. Node의 기존 MODULE_TYPELESS_PACKAGE_JSON 경고와 Rules 차단 검증의 예상 PERMISSION_DENIED 로그가 있다.
- 실제 Firebase 프로젝트의 데이터/규칙은 변경하지 않았고 Google 로그인·실제 Gemini·브라우저 DOM/모바일 E2E는 실행하지 않았다. 현재 `.env.local`의 두 Firestore 동기화 flag만 활성화했고 자격증명 값은 출력하거나 변경하지 않았다.


## Gemini 원인 분류·개발 전용 Mock (2026-10-21)

- `npm test`: 84개 통과. 기존 77개 + Mock/실제 응답 스키마 호환·키 없는 무호출 생성/UID 분리·멱등성, production/test/환경불명/호스팅 차단, production의 Mock 결과 재개 차단·Firestore 불가 시 오류, 수량1~20/테스트용 표시, GEMINI_MODEL 선택·헤더에만 키 사용·실패 시 Mock fallback 없음·실패 진단 재조회, quota/rate/0할당량/결제/모델/전제조건 구분·원본 비노출, 잘못된 모드/모델 거부·클라이언트 진단 보존 7개.
- `npm run test:firestore`: 6개 통과. 기존5 + 개발 Mock HTTP→Firestore 생성 결과→기존 cloud store 덱/카드 저장→새 세션 재조회→편집→덱 삭제. provider fetcher는 실행되면 실패하도록 하여 호출0을 확인했다. demo 프로젝트의 로컬 에뮬레이터와 기존 임시JRE21/캐시를 사용했으며 localhost 바인딩은 sandbox 밖 승인 실행을 사용했다.
- `npm run typecheck`, `npm run build`, `git diff --check`: 통과. 빌드한 클라이언트 JS/소스맵14개를 실제 설정 키와 메모리에서 비교했고 포함 파일0개였다. 키 내용은 출력하지 않았다.
- 기존 Node MODULE_TYPELESS_PACKAGE_JSON 경고와 Rules 권한 거부를 검증하는 예상 PERMISSION_DENIED 로그는 남아 있다.
- 실제 Gemini API 호출0. Firebase 운영 읽기/쓰기, 과금/키 변경, 모델 목록 조회, 운영 배포/Rules 배포 없음. 이번 작업은 Gemini 과금이 발생하는 생성 진단을 실행하지 않았다.
- 과거 Gemini 실패의 원본 응답이 로컬 로그에 없어 정확한 기존 실패 원인은 미확정이다. 현재 설정이 변경 전3.5 Flash였다는 사실과 기존429분류가 뭉쳐 있었다는 사실만 확정했다. 실제 Google계정 모델 접근/잔여 할당량/결제 한도와 브라우저 DOM E2E는 미검증이다.


## 이전 429 요청 재조회로 생성이 막히는 복구 UI (2026-10-21)

GET /api/generation-requests/{id}가 저장된429실패를 재전달하는 경우를 재현했다. 종료된 실패에는 API의 terminal=true를 전달하고 클라이언트가 인식한다. 화면은 반복 조회를 잠그고 오류 바로 아래에 같은 입력으로 새 요청을 준비하는 버튼을 표시한다. 이전 서버 기록은 수정하지 않고 실제 생성은 사용자가 다시 제출할 때만 시작한다.

- `npm test`:85개 통과. 추가 회귀는 실제경로(mock fetch)의429발생→실패보존→Mock모드의같은ID조회429/terminal→클라이언트인식→같은입력새ID제출200/Mock결과를 확인한다. 기존 실패 기록 보존·Gemini 추가 호출0도 검증했다.
- `npm run build`, `git diff --check`:통과. 프로덕션 빌드의 타입 검사 포함. 실제 Gemini 호출·운영Firestore데이터변경 없음. 브라우저DOM E2E와에뮬레이터통합테스트는 이번단계에서 재실행하지 않았다.

## 공유 롤백 및 비로그인 랜딩 (2026-10-21)

- `npm test`: 85개 통과. 기존 AI/Mock/저장/편집/오류 복구 회귀 유지.
- `npm run build`: 통과. 삭제한 공유 경로는 빌드 라우트에서 제거됨.
- `npm run test:http`: 4개 통과. 프로덕션 서버에서 익명 HTML/메타데이터, 공개 안내, 삭제 경로404, 개인 API401 확인.
- `npm run test:firestore`: 6개 통과. 로컬 에뮬레이터의 소유자 접근, 계정 격리, 저장/재조회/편집/삭제, Mock 저장과 서버 한도 회귀. 권한 거부를 확인하는 PERMISSION_DENIED는 예상 로그다.
- 브라우저 데스크톱 랜딩 및 예시 정답 전환 확인. 실제 로그인/로그아웃과 모바일 기기 E2E는 미실행.
- 운영 Firestore 데이터/인증/배포 변경 및 Gemini 호출 없음. 자세한 범위는 [LANDING.md](LANDING.md).

## 직접 덱 만들기·학습 화면 정리 (2026-10-21)

- 상단 Firestore 안내와 사이드바의 스터디 스페이스 박스 제거. 정상 동기화 안내 줄은 숨기고 전송 대기/오류는 유지.
- 덱 생성 모달에서 AI/직접 만들기 선택. 직접 입력은 기존 서버 createDeck 경로로 저장하며 별도 Gemini/생성 요청 API를 사용하지 않음. 질문500자/답2000자/덱이름80자, 카드1~20장.
- 실패한 직접 저장의 덱 ID와 입력은 모달을 닫거나 AI 모드로 전환해도 현재 학습 화면 메모리에 보존. 전송 대기 요청은 기존 계정별 outbox가 브라우저에 보존. 제출 이후 입력을 잠그고 동일 ID로 재시도. 전송 전 작성 중인 초안은 새로고침하면 사라짐.
- `npm test`:87개, `npm run test:http`:4개, `npm run test:firestore`:7개 통과. 직접 입력 검증·오프라인 재시도 중복 방지·재조회·수정, 에뮬레이터의 실제 저장·삭제·계정 격리·AI 사용량 미차감 확인. 빌드/타입 검사 통과.
- 브라우저에서 사이드바 제거는 확인. 동일 계정의 다른 탭이 Web Lock을 보유하고 사용자 브라우저 조작이 겹쳐 직접 생성 폼의 브라우저 E2E는 완료하지 못함. 실제 Gemini 호출/운영 데이터 쓰기 없음.

## 복습 덱 선택·통계 화면 정리 (2026-10-21)

학습 통계 화면의 상단 새 덱 만들기 버튼을 숨겼다. 전체 복습에서 덱별 체크박스/전체 선택/전체 해제를 제공하고 선택한 덱에만 카드 범위·순서 섞기·퀴즈 옵션을 적용한다. 같은 학습 화면에서 다른 메뉴로 이동했다 돌아와도 덱 선택은 유지하며 새로고침 시 전체 선택으로 초기화한다. 대시보드의 복습 진입은 먼저 선택 화면을 연다. 덱/카드 요약 대신 시작 버튼에 `총 N장 복습 시작`을 표시한다. 미선택 또는 해당 범위에 카드가 없으면 시작을 비활성화한다.

`npm test` 89개, `npm run typecheck`, `npm run build`, `git diff --check` 통과. 선택하지 않은 덱 제외, 평가용 원본 인덱스 유지, 전체 해제 시 전체 덱으로 되돌아가지 않음, 삭제/중복 ID 처리를 회귀 검증했다. Firestore 저장/API/인증은 변경하지 않았다. 이번 변경의 브라우저 E2E와 에뮬레이터는 재실행하지 않았다.

## Phase 3 누락 기능 구현 (2026-10-21)

- `npm test`:103개 통과. 기존 회귀에 이전 중단/재시도/사전 검증/중복 쓰기 및 통계 방지, CRUD·tombstone·순서·즐겨찾기·설정, 원본 revision 충돌, 4단계 스케줄, 타임존/윤년/DST 날짜 집계, 즐겨찾기/오답 필터, 목적/난이도, 정규화 질문 중복 거절, 검토 초안/재생성 저장 복구, 사이트 origin 검증을 추가했다.
- `npm run test:firestore`:8개 통과. 로컬 demo 프로젝트 에뮬레이터에서 UID 범위의 실제 트랜잭션·보안 규칙·이전 재실행·카드 관리·평가/설정·기존 AI/Mock 저장/사용량을 검증했다. 예상 권한 거부 로그는 타 계정/클라이언트 쓰기 차단 검사다.
- `npm run test:http`:4개 통과. 프로덕션 빌드에서 공개 랜딩/안내/정책 초안/제거 경로404/개인 API401을 확인했다.
- `npm run typecheck`, `npm run build`, `git diff --check`:통과. 기존 MODULE_TYPELESS_PACKAGE_JSON 경고는 남아 있다. Lint 스크립트와 설정은 없어 별도 lint는 실행하지 않았다.
- 실제 Gemini 호출0, 운영 Firestore 쓰기/마이그레이션 실행0, 광고 SDK/광고 활성화0, 배포/인증/비밀키 변경0. 새 패키지 설치 없음.
- 사용자 브라우저 조작과 겹쳐 이번 추가 기능의 로그인/모바일/복습 단축키/생성 검토 DOM 전체 E2E는 완료하지 않았다. 이를 검증 완료로 간주하지 않는다. 코드와 에뮬레이터/HTTP 검증 범위는 구분한다.
- 구현 파일과 행동 변화, 실제 운영 도메인/정책/향후 품질 검증 항목은 [PHASE3_IMPLEMENTATION.md](PHASE3_IMPLEMENTATION.md)를 참고한다.

## 카드 수정·복습 평가 UI 단순화

사용자 요청으로 카드 수정의 즐겨찾기/위로 이동/아래로 이동 컨트롤을 제거했다. 복습 버튼과 단축키는 다시(1)/기억함(2)으로 줄이고 설정·소개 안내도 갱신했다. 이전 데이터와 서버 명령은 호환성을 위해 보존한다. 일반 테스트103개, 타입 검사 및 프로덕션 빌드 통과. 브라우저 E2E와 에뮬레이터는 이번 UI 변경에서 재실행하지 않았다.

## 자료 기반 생성·세 가지 모드

- `npm test`:117개 통과. 번호/Markdown/Q&A/다중 줄/목록/코드/해설/빈 답/문서 제목/형식 및 용량 한도, 분류 수정, 원문 보존, 20장 초과 무료 추출, 규칙 추출의 fetch0, 선택적 AI 한도·결과 재개·실패 격리와 원문 고정, 해설/분류 저장·재조회·편집·분류 해제·삭제·오프라인 재시도 등을 검증했다. 분류만 바꾸면 학습 일정을 유지하고 본문/해설 변경 때만 초기화하는 회귀도 포함한다.
- `npm run test:firestore`:9개 통과. demo-moa-study 로컬 에뮬레이터에서 기존 회귀와 자료25장 저장/재조회/해설·분류 수정/복습 후 필드 보존/타 계정 읽기 거부/AI 사용량 기록0/덱 삭제를 확인했다. 포트 실행 승인 후 실행했으며 예상 PERMISSION_DENIED는 보안 규칙 차단 검증 로그다. 운영 프로젝트에 쓰지 않았다.
- `npm run typecheck`, `npm run build`, `git diff --check`:통과. Lint 설정은 없어 별도 lint는 실행하지 않았다. 기존 MODULE_TYPELESS_PACKAGE_JSON 경고는 남아 있다.
- 실제 Gemini API 호출0. 선택적 AI 검사는 주입된 가짜 provider 응답으로 실행했다. 실제 결제/모델 접근 확인·Google 로그인·모바일 터치·브라우저 DOM 전체 E2E는 이번 작업에서 실행하지 않았다. 기존 HTTP 랜딩 smoke는 이번 변경에서 재실행하지 않았다.
- 새 패키지 설치, API 키/인증 설정 변경, 클라우드 배포, 외부 광고/분석 활성화 없음. 최신 동작과 변경 파일은 [MATERIAL_CREATION.md](MATERIAL_CREATION.md).

## 새 덱 창 닫기 시 초기화

X/배경 클릭으로 생성 창을 닫으면 공통 세션 키를 갱신해 자료/직접 입력 폼을 재마운트하고 AI 폼 상태와 임시 요청 연결을 비운다. 모드 전환 중에는 초안을 유지한다. 서버 요청과 저장된 덱 및 study outbox는 삭제하지 않는다. 일반 테스트117개, 타입 검사·빌드 통과. 이번 변경의 브라우저 E2E는 미실행.

## Phase 4 품질 · Phase 5 출시 준비 (2026-10-21)

최신 검증은 [QUALITY_REPORT.md](QUALITY_REPORT.md) 기준입니다. 일반137개, Firestore 에뮬레이터11개, 프로덕션 HTTP6개 통과, 타입/빌드/클라이언트 Secret 검사 통과. 운영 의존성의 알려진 취약점0건. 운영 환경변수 검사는 운영자·문의 이메일·사이트 URL·정책 확인 미설정으로 실패하며 이를 자동 수정하지 않았습니다. 실제 모바일/로그인/배포/유료 Gemini 검증은 미실행입니다. 이전 항목의 수치는 당시 결과입니다.
