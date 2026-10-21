> 자료 기반 생성 최신 변경: [MATERIAL_CREATION.md](MATERIAL_CREATION.md). 현재 기본 모드는 자료로 만들기이며, 카드의 선택적 해설/태그/분류 필드를 저장합니다.

> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# Phase 2 — Firestore 및 마이그레이션 설계 (미구현)

> Phase 1·2 기준선/승인 설계 문서입니다. Phase 3 작업 1의 현재 코드·구체화된 결정은 [FIRESTORE_SYNC.md](FIRESTORE_SYNC.md)를 참고하세요.

## 컬렉션

모든 사용자 데이터는 `users/{uid}` 아래에 둔다. 일반 쓰기는 인증된 서버만 수행하고 클라이언트는 본인 데이터 중 허용된 경로만 읽는다. 시간은 Firestore Timestamp, API 직렬화는 epoch ms, 날짜 키는 YYYY-MM-DD. 모든 도메인 문서에 schemaVersion=2를 둔다.

| 경로 (users/{uid}/ 이하) | 필드와 목적 |
|---|---|
| 루트 사용자 문서 | createdAt, status(active/deleting), schemaVersion. 이메일 등 불필요한 개인정보 복제 금지 |
| settings/profile | dailyGoal 기본20, timeZone(IANA), updatedAt, revision |
| decks/{deckId} | title≤80, category, color(enum), createdAt, updatedAt, revision, deletedAt nullable, cardCount, dueCount, nextDueAt, learnedCount |
| cards/{cardId} | deckId, question≤500, answer≤2000, orderKey, favorite, contentRevision, revision, dueAt, intervalDays, lastRating nullable, lapseCount, reviewCount, createdAt, updatedAt, deletedAt |
| reviewEvents/{eventId} | sessionId, cardId/deckId nullable(이전기록), contentRevision nullable, rating nullable, correct, reviewedAt nullable, receivedAt, localDate, timeZone nullable, schedulerVersion, source(live/legacy), categorySnapshot nullable |
| dailyStats/{date} | reviewCount, rememberedCount, categoryCounts, updatedAt. legacy 횟수 포함, 고유 카드 수는 추적 가능 기록만 별도 표기 |
| stats/summary | totalReviews, rememberedCount, streak, longestStreak, lastStudyDate, updatedAt. 현재 보유 카드 수는 덱 요약 집계 |
| generationRequests/{requestId} | inputHash, kind, state, reservedDay, model, attemptCount, usage(입출력 토큰 nullable), draftId, errorCode, createdAt, finishedAt, expiresAt. 입력 전문 없음 |
| generationDrafts/{draftId} | cards(최대20), title/category/purpose/difficulty/sourceMode, model, revision, savedDeckId nullable, createdAt, expiresAt. 참고 자료 원문 저장 안 함 |
| usageDaily/{UTC-date} | charged, reserved, success, failed, providerAttempts, inputTokens, outputTokens |
| locks/generation | requestId, leaseUntil, state. 날짜 경계 동시 생성 방지 |
| migrations/{migrationId} | sourceFingerprint, mappingVersion, state, counts, cursor, verifiedAt, createdAt |
| migrationItems/{itemKey} | migrationId, sourceId, targetId, payloadHash, state. 재개/중복 방지 ledger |
| mutations/{mutationId} | payloadHash, resultRef, createdAt. 쓰기 재시도 멱등성 |
| deletionJobs/{jobId} | state, cursor, errorCode, requestedAt. 서버만 접근 |

서버 전용 `serviceUsage/{UTC-date}`와 `serviceConfig/ai`는 전역 예산/차단 관리용이며 클라이언트 접근을 모두 거부한다. 관리자 설정은 환경변수와 서버 관리 절차로만 변경한다.

덱 내 cards 배열 대신 카드별 문서를 사용한다. 카드 편집/복습마다 전체 덱을 재작성하지 않고 문서 크기 제한 위험을 줄인다. 복습 이벤트·집계·카드 일정·덱 요약은 동일 transaction에서 변경하고 eventId 존재 시 중복 집계하지 않는다. dueCount는 시간이 지나면 낡으므로 정확한 기한 도래 목록의 근거로 사용하지 않는다. dueAt 쿼리가 정답이며 요약은 참고값/재계산 대상이다.

## 쿼리/인덱스 초안

모든 쿼리는 users/{uid}의 해당 컬렉션에서 실행하며 soft delete 대상 제외. 실제 firestore.indexes.json은 구현 때 필요한 쿼리와 에뮬레이터 결과로 작성한다.

| 컬렉션 | 복합 인덱스 필드 순서 |
|---|---|
| decks | deletedAt ASC, updatedAt DESC (+ category ASC 필터 변형) |
| cards | deletedAt ASC, dueAt ASC |
| cards | deckId ASC, deletedAt ASC, orderKey ASC |
| cards | favorite ASC, deletedAt ASC, dueAt ASC |
| cards | lastRating ASC, deletedAt ASC, dueAt ASC (다시/어려움 in 쿼리) |
| reviewEvents | cardId ASC, receivedAt DESC |
| dailyStats | document ID 날짜 범위, 기본 인덱스 |

question/answer/초안 cards/입력 hash 등 검색하지 않는 큰 필드는 인덱싱 제외 제안. 서버 검색을 도입하기 전 덱 제목 검색은 로드 범위를 명시하고, 전체 검색이 필요하면 별도 색인 전략을 설계한다. 전체 읽어 검색하는 방식으로 무제한 확장하지 않는다.

## 보안 규칙 정책과 테스트 설계

- 기본 deny. request.auth != null && request.auth.uid == uid인 경우에만 명시된 decks/cards/reviewEvents/dailyStats/stats/settings/migrations 및 본인 draft 읽기 허용.
- generationRequests는 토큰·내부 오류 정보를 제외한 API 응답으로 조회. usage/lock/mutation/migrationItems/deletionJobs/전역 설정은 직접 읽기 금지.
- 모든 client write 거부. 서버가 모델 길이·enum·필드 allowlist·문서 소유 경로·삭제 상태·revision을 검증한다. 임의 UID/경로를 request body에서 채택하지 않는다.
- Rules emulator: 미인증 모든 거부, A가 B의 get/list/query/write 거부, A의 허용 읽기 성공, A의 usage·집계·일정 직접 조작 거부, 미정의 하위 경로 거부. Admin 경로는 Rules 대신 API 교차계정 통합 테스트가 필수다.
- 현 단계에는 규칙 파일/배포/실행 테스트를 추가하지 않았다. 컬렉션이 실제로 보호된다고 보고하지 않는다.

## 기존 데이터 무손실 이전

1. 인증 UID 확정 후 `moa-study-user-{uid}`와 legacy owner를 검사한다. 기존 prepareStudyStorage의 최초 계정 귀속을 존중하며 다른 UID의 데이터를 읽거나 이전하지 않는다. 소유권 불명 legacy는 사용자 확인 전 이전하지 않는다.
2. 원본 JSON을 별도 계정별 백업과 다운로드 가능한 파일로 보존한다. 스키마·날짜·크기 검사 후 개수/오류 미리보기. 파싱 실패/초과 길이를 조용히 자르거나 삭제하지 않고 해당 항목을 보류한다.
3. canonical snapshot hash와 mappingVersion으로 manifest 작성. 덱 ID 유지, 카드 ID는 UID+원 덱 ID+원 인덱스의 결정적 hash로 부여해 먼저 로컬 snapshot에 영속화. 중복 질문 카드도 원 인덱스가 달라 별개 보존한다. review ID는 원 배열 인덱스+원 date/correct로 생성한다.
4. 서버는 클라이언트 hash를 신뢰하지 않고 재계산한다. 새 브라우저의 다른 snapshot에서 동일 덱 ID와 다른 내용이 충돌하면 overwrite 금지, 별도 conflict 항목으로 사용자에게 병합 선택을 받는다. 동일 payload는 skip한다. 기존 클라우드에 같은 ID가 있으면 create-if-absent와 ledger를 transaction으로 확인한다.
5. 최대50개 항목/64KiB 청크를 업로드하고 서버가 payload byte 제한을 검증한다. 각 item의 domain 문서+ledger를 원자 처리, 성공 cursor 이후만 재개. 타임아웃은 ledger 조회로 판별한다. 이관 중 해당 snapshot 대상의 편집은 대기 큐에 보존하고 완료 후 새 revision에 재적용한다.
6. legacy review는 cardId/deckId/정확한 시각/타임존을 복원할 수 없다. 원 date/correct 보존, source=legacy로 일별/전체 횟수만 반영. 중복 ledger를 통해 집계도 정확히 한 번만 증가시킨다. 기존 interval/due는 그대로 보존한다.
7. 서버 count 및 각 item payload hash 확인 후 verified 상태를 기록하고 UI에 결과 표시. 실패한 항목이 있으면 완료 처리하지 않는다. verified 전후 모두 원 로컬/백업 자동 삭제 금지. 별도 사용자 승인 없이는 정리하지 않는다.
8. 전환 후 서버를 authoritative로 사용하며 전체 로컬 snapshot 재업로드 금지. 미전송 변경만 mutationId로 재생한다. 롤백은 클라우드 쓰기 중단 후 원본+outbox를 읽는 방식이며, 서버에 새로 생긴 기록은 export 후 병합해야 한다.

## 보존 및 삭제

초안7일/운영 메타30일/soft delete30일은 제안값. TTL·정리 작업은 실제 설정과 과금 검토 후 적용한다. 계정 삭제는 재인증→status=deleting으로 새 요청 차단→하위 컬렉션을 페이지로 정리→Auth 삭제→완료. 루트 문서 삭제만으로 하위 컬렉션이 지워진다고 가정하지 않는다. 중간 실패는 서버 job으로 재개하고 해당 UID 기기의 로컬 캐시 정리도 안내한다. 비용 발생 작업/영구 삭제는 별도 승인 대상이다.

## Phase 4 작업 1의 실제 추가 컬렉션

usageDaily/locks/generationRequests/attempts/generationDrafts 및 서버 전용 serviceUsage의 현행 필드는 [AI_COST_PROTECTION.md](AI_COST_PROTECTION.md)에 기록했습니다. 기존 데이터/Rules의 접근 범위는 유지하며 신규 경로는 기본deny입니다.

## Phase 4 작업 2 — 선택적 분석 데이터

consent/analytics, growth/state, analyticsOutbox, analyticsLimits의 실제필드·revision·물리보존 한계는 [ANALYTICS.md](ANALYTICS.md)에 기록했다. 기존 Rules 기본deny를 유지하고 신규 인덱스/기존데이터이관은 하지 않았다.




## Phase 3 실제 저장 필드

`cards`에 선택적 deleted/favorite/reviewCount/wrongCount/lastWrong/lastRating을 추가했다. 누락된 과거 필드는 새 이력으로 추정하지 않는다. `decks`는 cardCount/nextOrder와 선택적 purpose/difficulty/importing/importSource/legacyOriginalId를 저장한다. 삭제 카드는 tombstone으로 증분 동기화 후 화면에서 제외한다. `dailyStats`의 선택적 importedCount/importedCorrect는 로컬 병합 단계의 이중 집계 방지용이다. `legacyImports/day-{date}`는 원본 hash와 일별 기여량을 보존하는 서버 전용 이전 원장이다. 기존 users/{uid} 경계와 기본 거부 규칙을 유지하며 새 공개 컬렉션은 없다. 문서 ID 직접 접근을 사용하므로 새 쿼리 인덱스는 추가하지 않았다.


## 자료 카드 선택 필드

users/{uid}/cards의 explanation(최대4000자), category(기존 enum 또는 null), tags(최대8개/각40자), difficulty(초급/중급/고급 또는 null)는 선택 사항이다. 기존 카드 문서는 그대로 읽는다. 생성·추가·수정·재조회·복습·로컬→Firestore 이전에서 필드를 보존한다. 새 컬렉션, 보안 규칙 완화나 신규 인덱스는 없다.

## MVP 출시 준비: 계정 삭제/인덱스

`users/{uid}/account/status`의 deleting=true는 계정 삭제의 잠금입니다. 새 서버 쓰기와 직접 클라이언트 읽기를 차단하고, 모든 다른 개인 하위 컬렉션을 제거한 뒤 Auth 계정을 삭제합니다. 이 최소 기술 상태는 재시도/진행 중 쓰기 차단을 위해 남으며 운영 정리 조건은 [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)를 따릅니다. 임의로 잠금을 지우면 삭제가 실패한 계정이 다시 저장할 수 있으므로 Auth 삭제 확인이 우선입니다.

현재 동기화 쿼리는 updatedRevision 범위+updatedRevision/documentId 정렬이며 추가 복합 인덱스가 없습니다. cards의 question/answer/explanation/tags와 generationDrafts.cards는 조회 조건에 사용하지 않아 인덱스를 제외했습니다. 태그 검색 등을 추가하면 쿼리와 인덱스를 함께 재검토해야 합니다.
