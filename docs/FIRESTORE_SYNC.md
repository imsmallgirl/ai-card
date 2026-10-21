> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# Phase 3 작업 1 — Firestore 동기화 구현

2026-10-21. 이 문서는 **현재 구현**이다. 나머지 Phase 2 문서의 후속 기능 계약은 설계이며, 이번에 모두 구현한 것은 아니다. 사용자 요청에 따라 이 작업 후 멈춘다.

## 구현 범위

- 기존 Firebase Google 인증을 유지하고 `/api/study` GET/POST에서 ID 토큰 검증. UID는 토큰에서만 추출한다.
- Firestore 덱/카드별 문서, 복습 이벤트, 날짜별 및 누적 집계, 기본 프로필 저장. 생성/삭제/기존 2단계 복습을 연결했으며 후속 보완에서 카드 내용 편집과 AI 생성 저장 확인을 추가했다. 목적·난이도/4단계 복습/설정 변경 UI는 미구현이다.
- 동일 mutationId 재전송은 한 번만 반영하고 payload 변경은409. 카드 revision 충돌은 자동 덮어쓰지 않는다.
- 복습 일정·이벤트·통계를 동일 transaction에서 반영. 기존 기억=최소1일/간격2배, 다시=1분 유지.
- UID별 검증된 캐시와 전송 대기열을 localStorage의 `moa-study-cloud-v2-{uid}`에 함께 저장. 저장 공간 실패는 새 요청 접수를 거부한다. 미전송 데이터는 새로고침 후 재개한다.
- 서버 응답 유실 시 동일 ID 재전송. 서버 확인 및 변경분 읽기가 끝난 뒤 큐에서 제거한다. 충돌 요청은 사용자 확인 후 첫 건만 취소할 수 있다.
- 로그아웃/UID 변경 시 fetch abort, timer/구독 해제와 store 폐기. 늦은 응답은 캐시에 반영하지 않는다. 다른 기기에서는 같은 계정의 클라우드 데이터를 읽는다.
- 동일 브라우저/UID의 outbox 덮어쓰기를 막기 위해 Web Locks로 활성 탭 하나만 허용. 다른 탭은 대기한다. HTTPS 또는 localhost와 Web Locks 지원 브라우저가 필요하다.

## 읽기 정책과 Phase 2 설계에서 구체화한 결정

클라이언트 Firestore 직접 listener 대신 인증된 HTTP 변경분 조회를 사용한다. Firebase 브라우저 디스크 캐시를 만들지 않으며 토큰/취소/오류 처리를 기존 API 방식과 통일했다. 30초마다 **보이는 탭만** revision 문서1개를 조회하고, 변경 시 decks/cards/dailyStats/settings의 `updatedRevision` 범위를 각50개 커서 페이지로 읽는다. 포커스 복귀와 수동 버튼도 동기화한다. 오류 발생 후 자동 반복을 멈추며 사용자가 다시 시도한다.

초기에는 전체 보유 데이터를 페이지로 적재하여 기존 검색·전체 복습 의미를 유지한다. 이후는 변경된 문서만 읽는다. 매번 이벤트 전체를 읽지 않고 일별 집계를 UI 횟수로 사용한다. 변경 도중 상한 revision을 넘긴 문서는 다음 라운드에 반영된다. 즉시 실시간 보장이 아닌 최대30초 간격의 eventual sync다. 페이지 중 오류가 나면 watermark를 진전시키지 않는다. 요청당25초 타임아웃, 401 토큰 강제 갱신은1회만 수행한다.

## 현행 컬렉션 (users/{uid}/ 아래)

| 경로 | 현재 필드 |
|---|---|
| decks/{id} | id,title,category,color,created(ms),cardCount,revision,deleted,updatedRevision,schemaVersion2 |
| cards/{id} | id,deckId,question,answer,due(ms),interval(일),order,revision,updatedRevision,schemaVersion2 |
| reviewEvents/{mutationId} | id,cardId,deckId,date,timeZone,correct,reviewedAt(ms),schemaVersion2 |
| dailyStats/{YYYY-MM-DD} | id,count,correct,updatedRevision,schemaVersion2 |
| stats/summary | totalReviews,correct,updatedRevision,schemaVersion2 |
| settings/profile | id=profile,dailyGoal=20,timeZone=Asia/Seoul,revision,updatedRevision,schemaVersion2 |
| meta/sync | revision,updatedAt(ms) |
| mutations/{UUID} | hash,revision,createdAt(ms) |
| account/status | deleting=true면 요청 차단; 계정삭제 작업은 아직 미구현 |

시간은 현 단계에서 기존 store와 호환되는 epoch ms를 사용한다(Phase 2의 Timestamp 제안 대신). 4단계 평가·contentRevision·고급 통계·스트릭·TTL은 후속 작업이다. 기본 프로필은 첫 성공 쓰기에 함께 생성되고 이후 서버 프로필 값을 읽는다. 기본 타임존은 현재 서비스 기준 Asia/Seoul이며 UI 날짜 집계와 서버 이벤트 날짜가 이를 공유한다.

덱 삭제는 tombstone(`deleted=true`) 처리, 카드/이력은 유지하며 UI와 복습 대상에서 제외한다. 30일 정리/복원/계정삭제 배치는 아직 없다. mutations도 자동 정리하지 않아 재전송 멱등성을 유지한다. 규모 증가 시 보존 정책을 별도 구현해야 한다.

## API 실제 계약

Bearer 토큰 필수, Cache-Control:no-store. GET `/api/study` → `{revision}`.
GET `?collection=decks|cards|dailyStats|settings&since=N&target=N&cursor=[revision,id]` → `{items,cursor}`(최대50). cursor는 URL 인코딩한 JSON이며 null이면 마지막 페이지다. 서버가 토큰 UID 아래에서만 조회한다.

POST는 application/json, 스트리밍 본문64KiB 상한, 아래 discriminated schema. 요청 본문의 UID는 저장 경로에 사용하지 않는다. 성공 `{revision}`.

- updateCard: `{type,mutationId(UUID),deckId,cardId,expectedRevision,question,answer}`. 내용만 변경하고 복습 일정·통계는 유지한다.
- createDeck: `{type,mutationId(UUID),deck:{id,title,category,color},cards:[{id,question,answer}]}`(1~20). 일정·created·revision은 서버가 생성.
- deleteDeck: `{type,mutationId,deckId,expectedRevision}`.
- rate: `{type,mutationId,deckId,cardId,expectedRevision,correct}`.

오류:400 INVALID_INPUT,401 UNAUTHENTICATED,403 ACCOUNT_DELETING,404 NOT_FOUND,409 REVISION_CONFLICT/ID_CONFLICT/IDEMPOTENCY_CONFLICT,413 BODY_TOO_LARGE,503 SYNC_DISABLED/NOT_CONFIGURED/SYNC_UNAVAILABLE. 형태 `{code,error}`. 민감한 데이터·provider 원문은 로그/응답에 포함하지 않는다. 시간대/목표 변경 API, 일반 CRUD API, generation quota는 이번 범위에 없다.

## 활성화 조건 (이번에 실제 변경/배포하지 않음)

1. 기존 Firebase 웹 프로젝트와 같은 프로젝트의 Firestore 데이터베이스/리전을 확인한다. 신규 리소스·과금 활성화는 별도 승인 대상이다.
2. 서버에 ADC/workload identity 또는 서버 전용 GOOGLE_APPLICATION_CREDENTIALS 경로와 최소 Firestore IAM 권한을 설정한다. 기존 ID 토큰 서명 검증만으로 Firestore 쓰기 권한이 생기지 않는다. 서비스 계정 JSON을 저장소나 NEXT_PUBLIC에 넣지 않는다.
3. `firestore.rules`, `firestore.indexes.json`을 실제 기존 설정과 비교 검토 후 별도 배포한다. 여기 제공한 규칙을 배포하면 미정의 다른 경로의 접근도 거부되므로 같은 프로젝트의 다른 앱 영향을 먼저 확인해야 한다. 이번에는 배포하지 않았다.
4. `.env.local`/호스팅 환경에 `FIRESTORE_SYNC_ENABLED=true`, `NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED=true`를 함께 설정하고 재빌드/재시작한다. `.env.example`은 기본false다. 운영에 FIRESTORE_EMULATOR_HOST를 설정하지 않는다.
5. 새 테스트 계정으로 덱 생성→새로고침→다른기기→복습→통계→계정전환을 확인한 후 활성화한다. 실제 Google 로그인/운영 기기 간 E2E는 아직 미검증이다.

**기존 로컬 기록은 보존하고 새 덱은 클라우드에 저장한다.** 클라우드 활성화 시 UID별 로컬/클라우드 store를 함께 표시하고 기존 덱에는 로컬 표시를 붙인다. 기존 덱의 복습·수정·삭제는 로컬 store로, 새 생성은 클라우드 store로 전달한다. 임의 자동 업로드·원본 삭제는 하지 않는다. 손상 JSON은 빈 계정으로 간주하지 않고 중단한다. 기존 로컬 데이터의 다른 기기 이전은 아직 지원하지 않는다. 자세한 생성 저장 시점과 한계는 [AI 자동 저장](AI_FIRESTORE_STORAGE.md)을 참고한다.

## 테스트/변경 파일

- `src/lib/study-cloud-model.ts`: Zod 모델/명령/날짜/기존 일정 계산.
- `src/lib/server/study-service.ts`, `study-firestore.ts`, `study-http.ts`, `src/app/api/study/route.ts`: UID별 repository·트랜잭션·HTTP 경계.
- `src/lib/study-cloud-client.ts`, `study-cloud-store.ts`: 변경분 조회·캐시·대기열·재시도·충돌.
- `src/lib/store.ts`, `study-storage.ts`: 호환 타입과 기존 데이터 감지/잘못된 카드 평가 방지.
- `src/components/study-provider.tsx`, `study-app.tsx`, `study-gate.tsx`, `src/app/globals.css`: 모드 선택·수명주기·집계 표시·저장 상태/재시도 UI.
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`: 소유권 읽기/서버전용 쓰기 및 로컬 에뮬레이터 구성.
- `tests/study-cloud.test.mjs`, `tests/firestore/security.test.mjs`: 단위/API/동기화 및 실제 Rules/트랜잭션 검증.
- `.env.example`, `.gitignore`, `package.json`, `package-lock.json`, `README.md`, `docs/*.md`: 설정·테스트 도구·실제 상태 문서화.

실행 결과는 [TESTING.md](TESTING.md) 참고. 실제 운영 설정·데이터·배포는 변경하지 않았다.
