# Phase 4 작업 1 — AI 사용량 제한·비용 보호

2026-10-21. 승인된 PHASE4_PLAN의 첫 구현 단위다. 외부 Analytics/공개 덱/광고/로컬 마이그레이션은 착수하지 않았다. 실제 Firebase·Gemini 설정/과금/운영 배포는 변경하지 않았다.

## 완료 기능

- Firebase UID당 UTC 날짜별 기본3회, 계정 전역 동시 요청1개. 날짜를 변경하거나 여러 인스턴스에서 요청해도 Firestore transaction이 검증한다.
- Idempotency-Key(UUID)와 서버 정규화 입력 hash. 동일ID·동일입력은 진행 상태/기존 결과 반환, 다른 입력409. 새 ID를 보내도 UID 한도와 전역예산 적용.
- provider 호출 전에 전역 일일 시도 횟수와 보수적 입력/출력 예산을 원자 예약.5xx 재시도도 매번 예약, 최대3attempt(기존 최대2회 재시도 유지).
- 입력64KiB/자료15000자/1~20개, 출력 maxOutputTokens 기본8192, provider JSON256KiB,55초 신호. 불완전 finishReason은 저장하지 않는다.
- 호출 전 실패는 일일 예약 환불. 호출을 시작했거나 시작 여부가 불확실한 실패/timeout은1회 차감. 성공 여부와 일일 차감은 구분한다.
- 2분 lease. 서버 중단 시 다음 usage/reserve/result 조회에서 재조정, 호출 시도가 있으면unknown으로 차감, 없으면 환불. 자동 provider 재호출은 하지 않는다. 늦은 worker가 확정된unknown을 성공으로 바꾸지 못한다.
- 성공 결과7일 보관·재조회. 응답 유실/새로고침/덱 저장 실패에 같은 ID로 재확인. 프런트는 입력/요청 ID/성공 결과를 계정별로 먼저 보존하고, 저장 후 제거한다. AI 재호출 없이 저장 재시도 가능.
- 서버 usage API로 남은횟수·예약·초기화 시각 표시. 처리 중/초과/비활성/오류 안내.401 토큰 갱신은1회, 요청 ID 유지.
- 일자·UID·모델·요청 결과·시도·토큰 기반의 운영 데이터. 관리자 custom claim이 실제 boolean true인 계정만 날짜/모델 집계 API를 조회한다. 관리자 권한 부여 자체는 수행하지 않았다.

## 설정과 기존 기능 영향

| 서버 환경변수 | 기본값 / 의미 |
|---|---|
| AI_GENERATION_ENABLED | 명시적true일 때만 새 생성 허용. .env.example false |
| AI_DAILY_LIMIT |3,0이면 사용자 생성 차단 |
| AI_GLOBAL_DAILY_ATTEMPTS |100, 실패·재시도·호출 여부 불명 시도도 포함 |
| AI_GLOBAL_DAILY_TOKEN_BUDGET |2000000, 아래 입장예산 단위의 일일 상한 |
| AI_MAX_OUTPUT_TOKENS |8192, 허용256~16384 |
| AI_COOLDOWN_SECONDS | 성공 후5초 |
| AI_FAILURE_COOLDOWN_SECONDS | 실패 후30초 |

AI 생성에는 **Firestore 서버 ADC/IAM이 필수**다. 공부 데이터 동기화 flag와 독립적이므로 로컬 학습 모드에도 동일한 서버 AI 한도를 적용한다. 저장소가 없거나 오류이면 메모리 제한으로 우회하지 않고503/fail closed. 기존 GEMINI_API_KEY만 설정한 환경도 새 생성에는 ADC와명시적AI 활성화가 추가로 필요하다. 실제 .env.local은 수정하지 않았다.

로그인·제목/카테고리·수량·참고자료·기존 학습/검색/통계·간격 규칙은 유지. 복습/덱 저장은 AI 사용량을 소비하지 않는다. 카드 개별 재생성 UI는 미구현이고 추후 반드시 같은 quota service를 사용해야 한다. 정해진 deck ID(`ai-{requestId}`)로 저장 재시도 시 로컬·클라우드 outbox가 중복 덱을 만들지 않도록 보완했다.

프런트는 요청을 보존한 상태에서 입력을 잠그고 같은 요청을 확인한다. 다른 내용을 요청하려면 명시적으로 이전 연결 해제(확인창)를 사용한다. 연결 해제는 서버 호출 취소/환불을 의미하지 않는다. 임시 데이터는 `moa-generation-pending-{uid}`에 localStorage로 보존하며 저장 성공/명시 해제 시 제거한다. 민감 자료를 장기간 보존하지 않도록 이 사실을 폼에 안내한다. 손상 저장 데이터는 자동 덮어쓰지 않고 새 요청을 차단한다.

## API 현재 계약

모든 API Bearer 토큰 필수/no-store. 개인 UID는 토큰에서만 사용. 토큰·키·참고자료·생성 전문의 서버 로그 없음.

| API | 계약 |
|---|---|
| POST /api/generate | 기존 JSON `{title,category?,text?,count?}` 유지, Idempotency-Key 필수. 성공 `{cards,model,requestId,usage}` |
| GET /api/usage | `{usage:{limit,charged,reserved,remaining,resetAt,retryAt,maxCards},enabled}`. 날짜 기준UTC, 시각epoch ms. UI는 서버 값을 표시 |
| GET /api/generation-requests/{id} | 본인 결과/상태만. 성공 시 생성 응답과 같은 구조, 다른 UID404. 진행409, 실패는 확정 code/status,7일 후410 |
| GET /api/admin/costs?from=YYYY-MM-DD&to=YYYY-MM-DD | admin=true custom claim 필수, 최대31일. `{days:[{day,total,models,modelsTruncated}],currencyCost:null,note}`. 모델별최대50. 실제청구금액 아님 |

오류 형태 `{code,error,usage?,retryAt?}`. 주요 코드:400 INVALID_INPUT,401 UNAUTHENTICATED,403 ACCOUNT_DELETING,404 NOT_FOUND,409 GENERATION_IN_PROGRESS/IDEMPOTENCY_CONFLICT/RESULT_UNKNOWN/REQUEST_CLOSED,410 RESULT_EXPIRED,413 BODY_TOO_LARGE,422 CONTENT_BLOCKED/INVALID_OUTPUT,429 DAILY_LIMIT/GLOBAL_LIMIT/COOLDOWN/QUOTA_EXCEEDED,503 GENERATION_DISABLED/NOT_CONFIGURED/USAGE_UNAVAILABLE/GENERATION_UNAVAILABLE,504 TIMEOUT. provider 키/모델/권한 오류 코드도 기존 의미 유지. retryAt이 있으면 Retry-After 초 단위 헤더 제공.

kill switch는 새 요청에 적용되며 이미 저장된 결과의GET 조회는 계속 허용한다. 이미 provider에 보낸 요청의 비용을 소급 취소하지 않는다. config 변경으로 한도가 줄어도 이미 소비한 횟수는 지우지 않는다.

## DB 추가사항

| 경로 | 저장 내용 |
|---|---|
| users/{uid}/usageDaily/{UTC-date} | charged/reserved/requests/success/failed, admitted providerAttempts, 기록된 토큰·누락 집계 |
| users/{uid}/locks/generation | requestId/leaseUntil/retryAt. UID당 단일 lock |
| users/{uid}/generationRequests/{UUID} | input hash,모델,UTC 예약일,state,시각,시도수,입장예산,안전한 실패코드/메시지 |
| 위 requests/{UUID}/attempts/{1~3} | 시도 시작UTC일,모델,state,응답status,토큰(nullable),기록시각 |
| users/{uid}/generationDrafts/{UUID} | 검증된 cards/model/expiresAt. 참고자료·입력 원문은 서버에 저장하지 않음 |
| serviceUsage/{UTC-date} | 시도수·누적 입장예산·확인된토큰/기록attempt수·missingUsageAttempts·완료/성공/실패/unknown |
| serviceUsage/{UTC-date}/models/{model} | 날짜·모델별 같은 운영 집계. 전체 사용자 원장 재스캔 없이 비용분석 기반 제공 |

기존 Rules가 위 경로의 모든 client 읽기/쓰기를 기본deny한다. 사용량은 API로만 제공하므로 Rules를 완화하지 않았다. 기존 학습 데이터 스키마와 updatedRevision sync 대상은 변경하지 않았다. 기존 덱/카드/복습 데이터를 이관하거나삭제하지 않았다. 신규 인덱스가 필요한 쿼리는 없다(관리 조회는 명시 날짜+문서ID 순서).

성공 결과7일은 현재 **논리적 만료**다. 자동 TTL/정리 작업을 배포하지 않았으므로 저장된 문서는 물리적으로 남는다. 요청 ledger를 제거하면 같은ID를 새 호출로 오인할 수 있어 무단 삭제하지 않는다. 보존기간·실제 정리는 운영 정책/별도 배포 때 정해야 한다.

## 비용 수치의 의미와 한계

입장예산은 serialized prompt/schema의 UTF-8 bytes + output cap +2048 여유분으로 계산해 **환불하지 않고** 전역 상한에서 소비한다. 실제 provider token 수나 달러 상한을 의미하지 않는다. 모델의 thinking/과금 정책 차이를 포함한 정확한 금액은 공식 단가와 청구 내역을 확인해야 한다. 재시도/실패도 비용이 생길 수 있어100attempt/day의 독립 hard limit을 함께 적용했다.

확인된 input/output/thinking/total 토큰을 각각 기록하고, total이 없으면 missingUsageAttempts로 표시한다. 실제호출 여부 불명·서버 crash로 metadata가 없으면 attempts와recordedAttempts의 차이에서도 미보고 시도를 알 수 있다. 누락 토큰을 실제0으로 보고하지 않는다. UTC 자정 전후 요청의 사용자quota는 예약일에, provider시도는 시도일에, 완료결과 집계는 완료일에 기록한다.

한계: UID제한만으로 계정 생성 남용을 차단하지 못한다. 전역 provider 시도는 제한하나 악성 HTTP 조회로 생기는 Firestore 읽기비용 전체의 hard cap은 아니다. 호스팅 rate limit/App Check·예산 경보·실제 모델/프로젝트 쿼터 확인은 운영 활성화 전 필요하다. 자동 배포/과금/방화벽 설정은 수행하지 않았다.

## 변경 파일

- 새 도메인/클라이언트: `src/lib/generation-model.ts`, `generation-client.ts`, `src/components/ai-usage.tsx`.
- 새 서버: `src/lib/server/firestore-database.ts`, `generation-usage.ts`, `generation-service.ts`, `generation-http.ts`, `generation-runtime.ts`, `generation-cost-http.ts`.
- API: 기존 `src/app/api/generate/route.ts`, 신규 `api/usage/route.ts`, `api/generation-requests/[id]/route.ts`, `api/admin/costs/route.ts`.
- 연결: `src/lib/gemini.ts`, `src/lib/server/study-firestore.ts`(동일Admin app 재사용), `src/components/study-app.tsx`, `src/app/globals.css`, `src/lib/store.ts`, `study-cloud-store.ts`.
- 테스트: `tests/generation-usage.test.mjs`, `tests/helpers/generation-db.mjs`, 기존 `tests/firestore/security.test.mjs`, `tests/study-cloud.test.mjs`.
- 설정/문서: `.env.example`, `README.md`, `docs/PHASE4_PROGRESS.md`, 이 문서 및 API/DATABASE/TESTING/ROADMAP 문서.

새 패키지는 설치하지 않았다. `next-env.d.ts`는 작업 시작 시 이미 변경 상태였고 직접 편집하지 않았다(Next 빌드가 자동 생성할 수 있는 파일).

## 검증과 남은 작업

[TESTING.md](TESTING.md)의 Phase 4 작업1 결과를 따른다. 실제 Gemini 과금 호출·Google 실로그인·브라우저복구/모바일 E2E·실 ADC/운영 Firestore 연결은 검증하지 않았다. 모델의 현재 기본 문자열 `gemini-3.5-flash`도 실제키 접근권한/과금 조건을 확인한 것으로 간주하지 않는다.

다음 작업은 승인된 순서의 동의·이벤트 기반(Analytics)이며 이번 작업에는 포함하지 않았다. 공개/공유/신고·학습 지속·광고도 남아 있다. 사용자와 합의한 기능 단위 보고 시점에서 멈춘다.

공식 참고: [Gemini generateContent/usageMetadata](https://ai.google.dev/api/generate-content), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions). 구현 시 2026-10-21 확인했으며 모델별 운영 조건은 활성화 전에 재확인한다.
