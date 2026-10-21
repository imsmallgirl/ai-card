> 자료 기반 생성 최신 변경: [MATERIAL_CREATION.md](MATERIAL_CREATION.md). 현재 기본 모드는 자료로 만들기이며, 카드의 선택적 해설/태그/분류 필드를 저장합니다.

> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# Phase 2 — API 계약

> Phase 1·2 기준선/승인 설계 문서입니다. Phase 3 작업 1의 현재 코드·구체화된 결정은 [FIRESTORE_SYNC.md](FIRESTORE_SYNC.md)를 참고하세요.

## Phase 3 시점 계약: POST /api/generate (아래는 이전 기준선)

Authorization: Bearer Firebase ID token. JSON `{title,category?,count?,text?}`. title 1~80자, category는 categories.ts enum(기본 기타), count 1~20 정수(기본10), text 최대15000자(기본빈값). 성공200 `{cards:[{question,answer}],model}`. 카드 최소1·최대요청개수, 질문500/답2000자 제한. 현재 목적/난이도/사용량/멱등성은 없다.

| 상태 | 현재 code |
|---|---|
| 400 | JSON/입력 오류 일부는 code 없이 error만 반환 |
| 401 | UNAUTHENTICATED |
| 503 | AUTH_NOT_CONFIGURED, AUTH_UNAVAILABLE, NOT_CONFIGURED, PROVIDER_UNAVAILABLE; 모델명 형식 오류는 code 없음 |
| 422 | CONTENT_BLOCKED, INVALID_OUTPUT(스키마/개수/빈결과) |
| 429 | QUOTA_EXCEEDED(provider 한도) |
| 502 | INVALID_API_KEY, ACCESS_DENIED, MODEL_NOT_FOUND, GENERATION_FAILED, INVALID_OUTPUT(JSON 파싱), CONNECTION_FAILED |
| 504 | TIMEOUT |

> 현재 생성 API에는 비용 제한과 멱등성 계약이 추가되었습니다. [AI_COST_PROTECTION.md](AI_COST_PROTECTION.md)를 참고하세요.

## 제안 공통 계약 (아래 전부 미구현)

Node Route Handlers, 모든 개인 API는 Bearer 토큰 검증 후 UID 추출. 사용자 UID를 요청에 받지 않음. Cache-Control: no-store. JSON 본문 상한64KiB(스트림 읽기 중 강제), Content-Length만 신뢰하지 않음. list는 limit≤50, cursor 불투명 값 검증. timestamp는 epoch ms. 쓰기에 Idempotency-Key(UUID), 수정에 expectedRevision 필수. 같은 key+payload는 이전 결과, 다른 payload는409. 에러 `{code,error,requestId,retryable,details?}`, 성공 `{data,requestId}`. 기존 generate 클라이언트와 새 응답 변경을 같은 릴리스에 적용한다.

| 메서드/경로 | 요청 → 결과 |
|---|---|
| POST /api/generate | 기존 입력 + purpose(concept/interview/exam/deep), difficulty(beginner/intermediate/advanced), sourceMode(topic/sourceOnly) → draftId,cards,model,usage |
| GET /api/generation-requests/{id} | 본인 request 상태 및 완료 draft; unknown이면 재호출하지 않음 |
| POST /api/cards/{id}/regenerate | topic/context,expectedRevision → 단일 카드 초안. 저장은 사용자 검토 후 별도 수정; 생성 quota1회 |
| GET /api/usage | limit,charged,reserved,remaining,maxCards,resetAt. 서버가 계산, UI는 표시만 |
| POST /api/decks | title/category/color,cards(0~20),draftId? → deck+card IDs. 비어있는 수동 덱 허용. draft 저장 재시도는 동일 덱 반환 |
| PATCH /api/decks/{id} | title/category/color,expectedRevision → 변경 덱 |
| DELETE /api/decks/{id} | expectedRevision,확인 토큰 → soft delete 및 복습 조회 제외 |
| POST /api/decks/{id}/cards | question/answer,mutationId → card. 누적 카드 수가20을 넘는 수동 덱도 지원 |
| PATCH /api/cards/{id} | question/answer/favorite/orderKey,expectedRevision → card,resetSchedule 여부 |
| DELETE /api/cards/{id} | expectedRevision,확인 토큰 → soft delete |
| POST /api/reviews | eventId,sessionId,cardId,contentRevision,expectedRevision,rating(again/hard/good/easy),clientReviewedAt → event,nextDueAt,cardRevision |
| PATCH /api/settings | dailyGoal(1~1000),timeZone(IANA),expectedRevision → settings |
| POST /api/migrations | fingerprint,mappingVersion,manifest counts → migrationId,status |
| POST /api/migrations/{id}/items | items≤50,source IDs,payload hashes → accepted/skipped/conflicts,cursor |
| POST /api/migrations/{id}/verify | manifestHash → verified/counts/unresolved |
| POST /api/account/deletion | 최근 재인증 토큰(auth_time≤5분) + 명시 확인 →202 jobId |
| GET /api/account/deletion/{jobId} | 삭제 진행 상태; 인증/접근 방식은 Auth 삭제 전까지 제공 |

데이터 읽기는 Client SDK의 소유 경로 쿼리로 수행(DATABASE.md). 리소스 존재를 통한 타 계정 정보 유출 방지: 소유 UID 경로에서만 찾고 없으면404. 서버 API에 전달한 cardId/deckId를 전역 조회하지 않는다.

## 생성/복습 검증과 오류

목적/난이도 기본 concept/beginner, count 기본10 및 1~20 호환. sourceOnly는 비어 있지 않은 자료 필수. 정규화(NFKC/공백/대소문자) 질문 중복 제거 후 최소1개, 부족하면 실제 개수와 안내 반환. 의미 중복/사실성 완전 보장을 표시하지 않는다. MAX_TOKENS 등 불완전 finishReason이면 저장 금지. 구조 JSON+Zod를 유지하고 중복제거 때문에 추가 provider 자동 호출하지 않는다.

400 INVALID_INPUT/BODY_TOO_LARGE(크기는413), 401 UNAUTHENTICATED, 404 NOT_FOUND, 409 REVISION_CONFLICT/IDEMPOTENCY_CONFLICT/GENERATION_IN_PROGRESS, 422 INVALID_OUTPUT/CONTENT_BLOCKED, 429 DAILY_LIMIT/GLOBAL_LIMIT/QUOTA_EXCEEDED, 502 PROVIDER_ERROR, 503 SERVICE_UNAVAILABLE, 504 TIMEOUT. 429에 resetAt/Retry-After, 409에 안전한 현재 revision 제공. 에러에 provider 원문/키/토큰 포함 금지.

복습 eventId 중복은 기존 결과200, 같은 eventId 다른 평가409. 트랜잭션이 현재 카드 revision을 확인한 뒤 일정/이벤트/일별 및 전체 집계를 함께 저장한다. 삭제된 카드/덱은 평가409. 서버 처리 직전 계정 deleting 상태면 작업을 거부한다. 인증 만료는 토큰 강제 갱신 1회 후 같은 멱등키로 재시도하고 지속401이면 초안 보존 후 재로그인 안내.

## Phase 4 작업 2 — 선택적 분석

/api/analytics/consent(GET/POST), events(POST), export(POST)의 현재 인증·동의·요청스키마·오류는 [ANALYTICS.md](ANALYTICS.md)를 따른다. 외부 수집 기본off이며 공개/광고 이벤트 수신은 아직 허용하지 않는다.




## Phase 3 실제 API 확장

기존 인증된 `/api/study` POST에 추가한 명령: `importDeck`(source hash, deck, 일정/순서를 포함한 cards), `finishImport`(source/deckId/cardCount), `importDay`(source/day), `settings`(expectedRevision/dailyGoal/timeZone), `addCard`(deckId/expectedRevision/card), `deleteCard`·`favorite`(deckId/cardId/expectedRevision), `reorder`(deckId/expectedRevision/cardIds). 모든 명령에 UUID mutationId가 필요하다. 기존 `rate`의 correct는 호환성을 위해 유지하고 rating=again/hard/remember/easy가 있으면 이를 우선한다. `updateCard`는 내용을 바꾸면 due/interval을 초기화한다. 요청당64KiB/소유자 인증/충돌 검사/트랜잭션 멱등성을 유지한다. 클라이언트에서 Firestore에 직접 쓰지 않는다.

`/api/generate` 입력에 purpose/difficulty가 추가되었다. 기존 클라이언트에는 개념 암기/초급이 기본값이다. 개별 재생성도 이 엔드포인트로 count=1을 요청하므로 같은 한도를 적용한다. 결과 검토나 덱 저장에는 새 AI 호출이 없다.


## 자료 기반 생성 API 호환

규칙 추출 전용 서버/AI 호출은 없다. 최종 `/api/study` createDeck은 카드200장까지 허용하며 요청64KiB 한도와 UID/트랜잭션 검증은 유지한다. 카드 본문에 선택적 explanation/category/tags/difficulty가 추가되었다. updateCard는 이 필드를 수정할 수 있고, category/difficulty의 null은 분류 해제다. 다른 필드를 생략하면 기존 값을 유지한다. `/api/generate`는 선택적 mode=material을 받아 원문 기반 구조화/분류 프롬프트를 사용하며 자료가 비어 있으면 호출 전에400으로 거절한다. AI 생성 수량/횟수/입출력 한도는 그대로다.

## MVP 계정 삭제/상태

POST `/api/account`: Bearer 인증 + 최근5분 이내 Google 재인증(auth_time) + JSON `{confirmation:"DELETE_MY_ACCOUNT"}`. body UID는 사용하지 않고 검증된 본인 계정만 삭제합니다. 성공 `{deleted:true}`. 재인증 필요401, 확인 없음400, 중단/서버 오류503. 중단 시 삭제 잠금과 이미 삭제한 결과를 유지하고 재인증 후 재시도합니다. 성공 후 프론트엔드가 로그아웃/계정 캐시 삭제를 수행합니다.

GET `/api/health`: 비인증 `{status:"ok"}`. 서버 liveness만 확인하며 DB/AI/인증 연결 상태나 비밀 설정은 반환하지 않습니다. 모든 민감 API는 no-store, 서버 인증은 폐기/삭제된 계정 토큰까지 확인합니다.
