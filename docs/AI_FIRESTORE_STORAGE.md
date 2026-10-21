> 최신 구현: [Phase 3 구현 기록](PHASE3_IMPLEMENTATION.md). 아래 최초 분석·설계·단계별 기록은 작성 시점의 내용입니다. 현재는 로컬→Firestore 이전, 생성 결과 검토 후 저장, 카드 관리, 4단계 복습과 통계가 추가되었습니다.

# AI 학습 카드 자동 저장 확인 및 보완

2026-10-21. 기존 생성·클라우드 동기화 코드를 연결하고 저장 확인과 카드 편집을 보완했다. 실제 운영 Firestore나 Gemini를 호출하는 테스트·Rules 배포는 수행하지 않는다.

## 확인한 기존 상태

AI 생성은 이미 서버 ADC로 Firestore 사용량·생성 요청·성공 결과를 기록했다. 그러나 학습용 덱 저장은 별개이며, 동기화 flag가 없으면 UID별 localStorage만 사용했다. 기존 로컬 기록이 있어도 클라우드 대신 로컬 store를 선택했다. 현재 개발 환경에는 두 동기화 flag가 없어 이 분기가 적용되는 상태였다.

현재 `.env.local`의 `FIRESTORE_SYNC_ENABLED`, `NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED`를 true로 활성화했다. 비밀값과 ADC는 변경하지 않았다. 설정 예제는 명시적 활성화를 위한 false를 유지한다. 환경변수 변경은 개발 서버 재시작이 필요하며 배포용 NEXT_PUBLIC 값은 빌드 시 결정된다.

## 실제 저장 순서

1. 브라우저가 Google 로그인 사용자의 ID 토큰을 서버에 전달한다. 생성 request ID와 입력은 호출 전에 UID별 브라우저 저장소에 보존한다.
2. `/api/generate`는 AI 응답을 검증하고 `users/{uid}/generationDrafts/{requestId}`에 결과를 보관한다. 이 결과의 유효 기간은 현재 애플리케이션 기준 7일이며 자동 물리 삭제는 구현하지 않았다.
3. 브라우저가 결과를 받으면 자동으로 `ai-{requestId}` 덱의 createDeck 명령을 계정별 영속 대기열에 넣고 `/api/study`로 전송한다. AI 덱의 카드 ID도 `{deckId}-{index}`로 고정한다.
4. 서버는 ID 토큰에서만 UID를 얻고, 덱과 모든 카드를 동일 Firestore transaction으로 저장한다. 프로필·변경 revision·중복 방지 ledger도 함께 반영한다.
5. 서버의 변경분을 재조회하고 전송 대기열이 해소되었음을 확인한 뒤에만 생성 완료 안내를 표시하고 생성 복구 데이터를 정리한다.

따라서 AI API 응답 자체와 학습 덱 저장 완료 시점은 다르다. 생성 응답 전에 창을 닫으면 학습용 덱 저장은 아직 실행되지 않을 수 있다. 같은 브라우저/계정으로 돌아와 새 덱 만들기의 보존된 요청을 재개하면 기존 AI 결과를 재사용하여 저장한다. 대기열에 들어간 뒤 연결이 끊기면 로그인·새로고침 시 재전송한다. 실패는 생성 모달과 동기화 배너에 표시하고 결과/대기열을 보존한다. 브라우저 저장 공간 자체가 부족하면 전송 요청 접수를 거부하며 생성 복구 데이터를 지우지 않는다.

## 컬렉션 구조

```text
users/{Firebase Auth UID}/
  decks/{ai-requestId}         # 제목, 카테고리, 생성 시각, cardCount, revision, deleted
  cards/{deckId-index}         # deckId, question, answer, order, due, interval, revision
  generationRequests/{UUID}   # 생성 상태, 모델, 재시도·완료 기록
  generationDrafts/{UUID}     # 생성 성공 결과와 expiresAt
  usageDaily/{UTC date}       # AI 사용량
  locks/generation           # 진행 중 생성과 쿨다운
  settings/profile           # 기본 목표·타임존
  meta/sync                  # 변경 revision
  mutations/{UUID}           # 쓰기 멱등성 ledger
  reviewEvents/{UUID}         # 복습 이벤트
  dailyStats/{local date}     # 날짜별 복습 통계
  stats/summary              # 누적 복습 통계
```

`cards`는 덱 문서의 하위 컬렉션이 아니라 사용자 문서 아래의 별도 컬렉션이다. 대시보드는 로그인·새로고침 때 인증된 API로 decks/cards/settings/dailyStats를 읽고 조합한다. 기존 계정 캐시는 즉시 표시하며 서버 변경은 보이는 탭에서 30초마다, 온라인 복귀·화면 복귀·수동 재시도 시 반영한다.

## 사용자 분리·수정·삭제·중복 방지

- UID는 검증한 ID 토큰에서만 추출한다. 요청 body/query의 다른 UID는 저장 경로로 사용하지 않는다. Admin SDK는 Rules를 우회하므로 서버의 UID 고정이 핵심이다. Rules 에뮬레이터에서도 타 계정 직접 조회를 차단하고 클라이언트 직접 쓰기는 모두 거부하는 정책을 검증한다.
- 덱의 `카드 수정` 버튼에서 질문·답을 수정한다. 클라우드 수정은 revision을 검사하고 충돌을 표시한다. 내용 변경은 복습 간격과 통계를 변경하지 않는다.
- 덱 삭제는 기존 정책대로 deleted=true로 숨긴다. 카드·복습 이력을 물리 삭제하지 않으며 삭제 덱의 평가·내용 수정은 거부한다.
- 같은 mutationId의 동일 요청은 한 번만 적용한다. 동일 AI 요청의 덱/카드 ID가 고정되어 새로고침과 다른 기기의 같은 결과 저장도 중복 생성하지 않는다. 내용이 다른 충돌을 자동 덮어쓰지 않는다.
- 기존 로컬 덱은 `기존 로컬 덱 · 이 기기에 저장`으로 구분하고 복습·수정·삭제를 기존 UID별 store에 전달한다. 신규 생성만 cloud store로 전달한다. 기존 로컬 덱과 통계는 자동 이전하지 않아 다른 기기에 나타나지 않는다. 캐시/outbox와 생성 복구 데이터도 계정별 키를 사용한다.

기존 UI와 복습 방식, 전체 복습·퀴즈·검색·AI 테스트 무제한 설정을 유지한다. 로컬 기록 보존과 클라우드 저장 경로를 연결하는 combined store, 생성 저장 확인, 카드 편집 UI/API, 다른 기기 저장 재시도 중복 방지가 이번 변경이다.
