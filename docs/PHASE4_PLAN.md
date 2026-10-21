> 보관 문서: 사용자 요청으로 더 이상 구현 기준으로 사용하지 않습니다. 현재 기준은 CARD_PLAN.md와 ROADMAP.md입니다.

# Phase 4 성장·수익화 구현 계획 — 승인 완료

작성일: 2026-10-21. 지시 원문: `~/Desktop/mvp/CARD_PLAN2.md`.
아래는 계획 작성 시점 기준이다. 이후 사용자가 승인하여 첫 단위 AI 비용 보호를 구현했으며 현재 상태는 [PHASE4_PROGRESS.md](PHASE4_PROGRESS.md)를 따른다. 계획 작성 당시의 작업은 코드 분석과 이 계획 작성에 한정했다. 애플리케이션 코드·환경변수·DB·Rules·패키지·클라우드 설정은 변경하지 않는다. 기존 작업 트리의 미커밋 변경은 앞선 Firestore 구현 결과이며 보존한다.

이 문서의 Phase 4는 **새 요청의 성장·수익화 단계**다. 기존 CARD_PLAN.md/ROADMAP.md의 Phase 4(품질 검증)와 이름은 같지만 범위는 다르다. 기존 미완료 항목을 완료했다고 간주하거나 전체 Phase 3 구현을 자동으로 추가하지 않는다.

## 1. 현재 프로젝트 분석

| 항목 | 코드에서 확인한 상태와 근거 |
|---|---|
| 기술 | Next.js App Router, React, TypeScript, npm/package-lock, Zustand, Firebase Web/Admin, Gemini REST, Zod, lucide-react, 전역 CSS. 직전 설치 확인 버전: Next16.4.2/React19.3.1/TS7.0.2/Firebase13/Admin14.5.0 |
| 인증 | auth-provider의 onAuthStateChanged, auth-account의 Google popup/signOut. StudyGate가 인증 확인 전/비로그인 시 학습 UI 숨김. UID key로 개인 store 재생성 |
| 서버 인증 | server-auth에서 Admin verifyIdToken. `/api/generate`, `/api/study`가 각각 인증. Firestore 쓰기에는 별도 ADC/IAM 필요 |
| 저장 | 기본 UID별 localStorage. cloud flag 활성화 및 기존 로컬 기록 없는 계정에서만 cloud store 사용. 기존 기록 자동 이관 없음 |
| Firestore | users/{uid}/decks, cards, reviewEvents, dailyStats, stats/summary, settings/profile, meta/sync, mutations. 서버 쓰기/본인 일부 읽기 Rules, 공개 경로 없음 |
| 동기화 | 보이는 탭30초 polling, updatedRevision 변경분50개 커서 조회, UID별 캐시/outbox, mutationId 멱등성, revision 충돌, Web Locks로 브라우저/UID 단일 활성 탭 |
| AI 생성 | 제목/카테고리/1~20개/선택 자료. JSON Schema+Zod,55초 timeout, 일시5xx 최대2회 재시도. UID 검증 후 사용량 예약 없이 provider 호출 |
| 대시보드/덱 | 총 카드/기한 도래/오늘 학습량, 제목 검색/카테고리 필터, 생성 즉시 저장, 확인 후 덱 삭제. 클라우드 삭제는 tombstone |
| 학습/통계 | 전체·기한 도래·덱별·섞기·주관식 자기비교, boolean 평가. good=최소1일/2배, again=1분. 최근7일과 전체 성공 비율 |
| 목표/지속 | 기본20장 표시. cloud profile의 dailyGoal/timeZone을 읽지만 변경 API·UI 없음. 스트릭/활동 캘린더/브라우저 알림 없음 |
| 라우트/SEO | 실제 페이지는 `/`와 API2개. 내부 view 상태 전환. layout의 기본 title/description만 있고 공개 탐색/상세/공유 라우트 없음 |
| Analytics | 소스에 Firebase Analytics 초기화·gtag·GTM·이벤트 발행 없음. 기존 Firebase 앱 초기화만으로 Analytics 연동 완료로 보지 않음 |
| 에러 모니터링 | 사용자 오류 UI 및 Gemini 실패의 제한된 console.warn만 있음. Sentry 등 외부 수집/통합 모니터링 구성 없음 |
| 테스트 | node:test 단위/API, Rules+실제 emulator 통합 테스트. 직전 검증32+2개/타입/빌드 통과. 이번 문서 단계에서는 재실행하지 않음 |

Phase 1·2는 분석·설계 승인 완료, Phase 3는 첫 작업 Firestore 동기화만 구현 완료다. 마이그레이션, AI 한도, 카드 CRUD/검토, 목적·난이도,4단계 평가, 즐겨찾기/오답, 고급 통계, 공개 페이지/광고 준비는 미완료다. Firebase 운영 설정·활성 flag·실제 비용·운영 도메인·트래픽·관리자 계정은 확인하지 않았다. 비밀 환경변수는 열람하지 않았다.

발견 사항: auth-account의 안내는 아직 “다른 기기 동기화 없음”으로 고정되어 cloud 모드와 불일치한다. 오늘 학습량은 고유 카드 수가 아니라 평가 횟수다. 계정별 캐시/일별 집계는 재사용하되 이를 숨기거나 허위 통계로 바꾸지 않는다.

## 2. 우선순위와 단계별 완료 조건

| 순서 | 우선순위/기능 | 범위·완료 조건 | 의존성 |
|---|---|---|---|
| 0 | P0 호환성·공개 경계 | cloud/local 안내 수정, 신규 필드 기본값/flag/권한 정책, 로컬 계정의 공유 제한 안내. 기존 기능 유지 | 현행 코드 |
| 1 | P0 E: AI 비용 보호 | 서버 UID별 하루3회(설정 가능), 전역예산, 동시1개, 멱등성, 토큰/본문 상한, 사용량 UI·관리 집계 | Firestore 서버 자격증명(운영 활성화 전 필요) |
| 2 | P1 F 기반: 동의/이벤트 계약 | 분석 기본off, 단일 이벤트 경로·중복 방지·개인정보 allowlist, 테스트 adapter. 실수집은 별도 설정/동의 후 | 현행 인증·서버 명령 |
| 3 | P1 A+B: 공개 덱·공유·복사·관리 | 공개 스냅샷, 탐색/상세/공유 링크, 원본 작성자만 갱신·철회, 복사, 신고·관리자 조치·Rules 통합 검증 | 0/1, cloud 데이터 |
| 4 | P1 C: 학습 지속 | 스트릭/최장 기록/목표 변경/주간·연간 캘린더/완료 축하/앱 내 복습 안내 | 기존 dailyStats·profile, 설정 명령 |
| 5 | P2 D: 광고 준비 | 기본off 슬롯·반응형 예약공간·실패 대응·이벤트 계약, 학습 화면 제외 | 공개 UI 및 동의 기반 |
| 6 | P1 품질·출시 준비 | 회귀·모바일·접근성·권한·캐시·비용/읽기량 검증 및 문서 | 위 단계 |

각 기능 단위로 구현→관련 테스트→기존 회귀 검사→변경 파일/DB/결과/문제/남은 작업 보고. 전체를 한 번에 구현하지 않는다. 권장 첫 구현 단위는 **AI 비용 보호**다. 새 계획 승인 전에는 어떤 단위도 착수하지 않는다.

로컬 데이터 마이그레이션은 기존 Phase 3의 별도 작업이다. 이번 성장 기능 때문에 자동 업로드하거나 기존 저장소를 비우지 않는다. 초기 공개/복사 기능은 cloud 동기화 완료 계정에서 제공하고 로컬 계정에는 이유를 안내한다. 모든 기존 사용자에게 공개 기능을 개방하려면 별도 마이그레이션 구현·검증을 먼저 완료해야 한다.

## 3. DB 설계 제안

### 3.1 공개 데이터의 분리

개인 users 경로를 공개하지 않는다. 공개는 사용자 확인을 거친 **명시적 스냅샷 게시**다. 기본 비공개, 공개와 링크공유는 동일 공개 범위로 취급한다. 추측 불가 URL도 비공개 접근 제어 수단으로 쓰지 않는다.

| 신규/변경 경로 | 필드/역할 | 접근 정책 |
|---|---|---|
| publicDecks/{publicId} | title, normalizedTitle, category, cardCount, visibility(public/private), moderation(active/hidden), revision, publishedAt, updatedAt, authorAlias(선택), schemaVersion | public+active만 비인증 읽기. UID/개인 덱 ID/자료/학습 일정·이력 제외 |
| publicDecks/{publicId}/cards/{id} | question,answer,order,revision | 부모가 public+active일 때만 읽기. 모든 client 쓰기 거부 |
| publicationOwners/{publicId} | ownerUid,sourceDeckId,sourceRevision,publicRevision | 서버전용. 요청 UID와 대조해 게시·수정·철회 권한 검증 |
| users/{uid}/publications/{publicId} | sourceDeckId,publicRevision,visibility,moderation,updatedRevision | 본인 읽기/서버쓰기. cloud 변경분 sync 컬렉션에 추가 |
| users/{uid}/decks/{id} | 기존 필드 유지, copiedFromPublicId/copiedFromRevision 선택 필드 | 복사본도 개인 덱. 새 필드는 기존 v2 데이터에 선택값으로 추가 |
| deckReports/{reportId} | publicId,reporterUid,reason(enum),detail(선택≤500자),status,createdAt,decisionAt | server만 저장, 관리자 API만 열람. 공개 컬렉션/Analytics에 원문 없음 |
| moderationActions/{actionId} | adminUid,publicId,action,reasonCode,createdAt | 서버전용 감사 기록. 조치 ID로 멱등 처리 |
| users/{uid}/usageDaily/{UTC-date} | charged,reserved,success,failed,providerAttempts,inputTokens,outputTokens | 클라이언트 쓰기 금지, 안전한 usage API로만 본인 조회 |
| users/{uid}/generationRequests/{id} | payloadHash,state,reservedDay,model,attempts,tokenUsage,resultRef,errorCode,timestamps | 서버전용; API에서 본인 요청 상태만 제공 |
| users/{uid}/generationDrafts/{id} | 검증된 cards,model,expiresAt | 본인 API 조회, 기간7일 제안. 참고 자료 원문 제외 |
| users/{uid}/locks/generation | requestId,leaseUntil,state | 서버전용; 날짜 변경에도 UID 전역동시1개 |
| serviceUsage/{UTC-date} | 실제 provider 시도·예약토큰·확정토큰·모델별 집계 | 서버/관리자만. UID별 한도를 우회하는 다계정 공격의 전역 비용 차단 |
| users/{uid}/settings/profile | 기존 dailyGoal/timeZone/revision 유지, 사용자 설정 변경 명령 추가 | 본인 읽기/서버쓰기, expectedRevision 검증 |
| users/{uid}/growth/state | firstSeenAt,lastVisitDate,firstDeckAt,firstReviewAt,return7SentAt,이벤트 마커 | 서버전용. 학습 통계와 마케팅 동의는 별도 |
| users/{uid}/analyticsOutbox/{eventId} | name,허용 속성,발생시각,전달상태 | 동의한 이벤트만 저장/수집, 서버전용. 보존7일 제안 |

현재 카드 최대20개 생성 흐름과 연결해 초기 게시도 **최대20개 카드**로 제한하고 초과는 명시적으로 안내한다. 제목80/질문500/답2000 및 전체 게시 데이터 크기 검증. 서버가 원본 덱·카드를 트랜잭션에서 읽고 검증한 뒤 공개 문서와 mapping을 함께 저장한다. 게시 갱신은 공개 revision 검사 후 전체 카드 스냅샷 교체, 사라진 공개 카드도 같은 트랜잭션에서 제거한다. 개인 학습 상태 변경은 공개 카드에 전파하지 않는다.

원본 편집은 자동 공개되지 않고 “공개본 업데이트”로 재확인한다. 원본 삭제 시 공개본도 즉시 private 처리하도록 기존 deleteDeck 명령을 확장한다. 관리자가 숨긴 덱은 소유자가 재게시만으로 active로 되돌릴 수 없다. 철회 이후 이미 복사된 덱은 독립 개인 자료로 남고, 기존 다운로드/외부 검색엔진 캐시의 소급 삭제는 보장하지 않는다는 안내를 게시 전 표시한다.

### 3.2 검색·인덱스·비용

목록20개/페이지, 카드 상세최대20개, 커서로 추가 조회. publicDecks visibility+moderation+publishedAt(DESC), visibility+moderation+category+publishedAt, visibility+moderation+normalizedTitle(ASC), category를 포함한 제목검색 변형을 인덱스 후보로 둔다.

초기 제목 검색은 NFKC/공백/대소문자 정규화한 **접두어 검색**으로 정의해 UI에도 “제목 앞부분으로 검색”을 안내한다. 중간 문자열/형태소/의미 검색을 지원한다고 표시하지 않는다. 카테고리 필터와 결합하고400ms debounce, 검색어2~80자, 페이지20개 상한. 전체 공개 컬렉션 다운로드 후 필터링 금지. 전문검색이 필요해지면 별도 엔진/비용 검토 후 확장한다.

공개+active를 쿼리 자체에 포함한다. Rules는 결과를 자동 필터링하는 기능으로 가정하지 않는다. 신고 목록 status+createdAt, 비용 분석은 날짜·모델별 집계를 조회하며 전체 request 원장 스캔을 매번 수행하지 않는다. 실제 복합 인덱스는 승인 후 쿼리·에뮬레이터/운영 인덱스 확인을 거쳐 추가하며 자동 배포하지 않는다.

### 3.3 호환성·권한·관리

새 필드가 없으면 비공개, copiedFrom 없음, 기존 dailyGoal20 및 timeZone 유지. 기존 계정/카드 ID/일정/날짜/복습 이력은 변환하지 않는다. 신규 캐시 필드는 기본값으로 hydrate하고 unknown outbox 명령은 조용히 삭제하지 않는다. 배포/롤백에 대비해 신규 명령 사용을 flag로 통제한다.

관리자는 Firebase custom claim `admin=true`를 서버에서 검증한다. 이메일 목록·클라이언트 토글로 관리자 권한을 부여하지 않는다. 최초 관리자 계정 지정/claim 설정은 별도 운영 승인·설정 대상이다. 관리자는 신고 목록/처리/숨김/복구를 수행하고 모든 조치를 감사 기록한다. 신고는 로그인 필수, UID+publicId 기준 활성 신고1건, UID 일일 상한으로 스팸을 제한한다. 단순 신고 수만으로 자동 삭제하지 않는다.

Firestore Rules도 공개 부모 상태, 본인 개인 경로, 내부 컬렉션 기본deny, 모든 client write deny를 검증한다. 관리자 조치도 API 경유, Admin SDK는 Rules를 우회하므로 API의 소유권/claim 검사가 필수다. 공개 write를 허용하는 일반 users Rules는 만들지 않는다.

## 4. API·라우팅 설계

기존 `/`의 로그인/학습 동작은 유지한다. 공개 `/explore`, `/decks/[publicId]`, 관리자 `/admin/reports`를 추가한다. 공유 링크는 별도 토큰 API 없이 동일 공개 상세의 canonical URL이다. 개인 상세가 아직 없으므로 게시·관리 모달을 기존 덱 목록에서 연다. 로그인 복귀 returnTo는 앱 내부 경로 allowlist만 허용한다.

| API/확장 | 인증과 계약 |
|---|---|
| POST /api/generate (확장) | Bearer UID, Idempotency-Key 필수. 기존 입력/응답 cards·model 호환 + requestId/usage. 서버 원자 예약 후 호출 |
| GET /api/usage | 본인 limit/charged/reserved/remaining/resetAt. 클라이언트 계산으로 한도 승인하지 않음 |
| GET /api/generation-requests/{id} | 본인 상태/결과, 응답 유실 시 동일 요청 확인 |
| POST /api/publications | cloud 본인 sourceDeckId+expectedRevision+게시 확인+mutationId. 서버가 카드 내용 읽기 |
| PATCH /api/publications/{id} | 소유자만 공개/비공개 또는 공개본 갱신, expectedPublicRevision |
| DELETE /api/publications/{id} | 소유자만 공개 철회(tombstone), 원본 개인 덱은 유지 |
| GET /api/public-decks | 비인증 공개+active 목록, q/category/cursor/limit≤20 |
| GET /api/public-decks/{id} | 비인증 공개본만. 비공개/hidden/없는 ID 모두404 |
| POST /api/public-decks/{id}/copy | 로그인+cloud ready, mutationId. 공개 상태/revision 확인 후 새 개인 덱·새 카드 IDs/일정 초기화·개인 sync revision을 원자 저장 |
| POST /api/public-decks/{id}/reports | 로그인, reason/detail 검증, 중복/일일 상한,202 |
| GET /api/admin/reports | admin claim 필수, status/cursor/limit≤20 |
| POST /api/admin/reports/{id}/resolve | admin+조치ID, hidden/restore/dismiss 사유, 상태·감사 기록 원자 갱신 |
| /api/study 명령 확장 | settings 변경(목표/타임존), publications 변경분 조회. 기존 createDeck/deleteDeck/rate 유지 |
| POST /api/analytics/events | 로그인+동의 확인, 허용 이벤트/속성·eventId만 수용, UID별 제한, 서버 검증. 광고·익명 이벤트는 동의한 브라우저 adapter 별도 |
| GET /api/admin/costs | admin claim, 기간/모델별 운영 집계. 개인 학습 내용/전체 토큰 원문 제공 금지 |

개인·관리 응답 no-store, 쓰기는 JSON byte 상한·Zod·멱등키.404/409/429/503를 명확히 구분한다. 공개 상세/metadata/OG는 같은 공개 상태 검사 함수를 재사용하고 초기에는 no-store 동적 렌더링한다. 비공개 전환 직후 페이지·API·metadata·기존 세션의 재요청 모두404/콘텐츠 없음. 페이지를 외부 CDN에 장기 캐시하지 않는다. 이미 방문자의 화면에 렌더링된 텍스트는 철회로 회수할 수 없다.

공유/복사 경합: 서버 transaction이 공개 parent revision을 읽어 철회와 copy가 동시에 일어나도 일관된 순서로 반영한다. 같은 mutationId는 같은 복사 덱을 반환한다. 다른 mutationId로 의도적으로 다시 복사하는 것은 별개 덱으로 허용한다. 복사에는 AI 호출/AI quota 차감이 없다. 복사본은 원본 수정으로 바뀌지 않는다.

SEO: 공개 제목/설명/카드 수만 metadata에 사용, 이메일/UID/참고자료/개인 덱 ID 없음. 실제 도메인이 설정되지 않으면 가짜 canonical을 생성하지 않는다. 공개 텍스트는 React로 escape하고 HTML 주입 금지. private/hidden404는 noindex, 공개 sitemap은 공개 상태만 포함하고 철회 시 갱신한다.

## 5. AI 비용 관리 상세

기본 환경 설정 제안: `AI_DAILY_LIMIT=3`, `AI_MAX_OUTPUT_TOKENS=8192`, 서버 전체 일일 요청/예약토큰 예산, 실패 cooldown, `AI_GENERATION_ENABLED`. 키/실제 단가/무료 쿼터는 추정하지 않고 적용 모델·요금제를 확인한 뒤 예산 수치를 확정한다.

인증·입력 검증→UID/UTC-day quota 및 UID 전역 lock/요청 hash를 **동일 Firestore transaction**에서 예약→provider 호출(transaction 밖)→검증 결과 임시 저장→사용량 확정/lock 해제. 문서 없는 새 UID도 원자 create한다. 서버 프로세스 메모리나 UI 제한으로 대체하지 않는다. quota API와 오류의 resetAt은 서버 UTC 자정 기준이며 UI는 현지 시각으로 표시한다.

같은 요청ID+내용 재전송은 기존 상태/결과를 반환하고 다른 내용409. 성공한 결과를 재사용할 수 있도록7일 초안 보존 제안. provider 호출 전 오류는 예약 환불, 호출 후 실패/timeout/불확실 상태는 비용 보호를 위해1회 차감하고 안내한다. lease 만료를 무조건 환불·재호출하지 않고 재조정 작업이 확정한다. 일시5xx 재시도는 기존 최대2회 상한을 유지하되 **각 attempt마다 전역 예산**을 확인한다. 사용자3회가 provider 최대9회가 될 수 있다는 비용을 반영한다.

통계에는 날짜·UID·요청/성공/실패·시도횟수·모델·실제 usageMetadata의 입출력 토큰을 기록한다. 토큰 누락은unknown으로 표시하고0으로 사실화하지 않는다. 모델별 가격표 버전/시점과 실제 토큰으로 추정 비용을 산출하며 청구 금액과 동일하다고 보장하지 않는다. 저장 카드 복습/수동 편집/공개본 복사는 AI 한도와 분리한다. 일반적인 uid 한도만으로 다계정·공개 엔드포인트 공격을 막지 못하므로 호스팅 rate limit/App Check 적용 가능성도 확인한다.

Firestore/ADC 미설정 시 비용 제한을 메모리 모드로 우회하지 않고 생성503+설정 안내(fail closed)한다. 따라서 개발 환경에서 AI 생성 전에 필요한 설정이 늘어나는 변경을 릴리스 문서에 명시한다.

## 6. 학습 지속과 UI/UX

dailyStats를 재사용해 평가 횟수>0인 날짜를 학습일로 계산한다. 오늘/어제까지 이어진 streak와 최장 streak를 순수 함수로 분리하고, 실제 기록이 없는 날을 학습일로 만들지 않는다. 장기 무학습 후 오늘 공부하면1일부터 시작한다. 기존 legacy는 원 date만 사용하고 카드별 지표를 복원하지 않는다.

캘린더는 최근12개월 일별 횟수, 주간은 최근7일. 각 셀의 날짜·횟수에 접근 가능한 라벨/키보드 탐색과 색상 외 범례 제공. 일일 목표1~1000(기본20) 설정, 달성률100% 상한. 학습 횟수와 고유 카드 수를 명확히 구분한다. 타임존 변경은 이후 이벤트부터 적용하고 과거 localDate는 재작성하지 않는다. 기기 시각을 신뢰한 과거 이벤트 재작성 금지.

현재 오프라인 평가는 업로드 시각으로 서버 날짜를 기록한다. 이번 단계에서는 **서버 저장일 기준 스트릭**임을 표시하고, 오프라인 발생일 기준으로 정책을 바꾸려면 별도 스키마/위변조 검토 후 구현한다. 전송 대기 평가의 축하 UI는 “기기에 저장됨/클라우드 확인 대기”와 확정 상태를 구분한다.

복습 알림은 대시보드의 기한 도래 배지/단일 배너만 사용한다. 푸시·메일·브라우저 알림 권한 요청은 제외한다. dismiss한 알림은 같은 날 반복해서 띄우지 않으며 완료 시 해제한다. 완료 축하는 기존 모달을 확장하고 감소된 모션 설정을 존중한다.

공개 탐색은 기존 카드·보라색·간격/폰트·반응형 패널 재사용. 공개 미리보기에서 질문/답을 확인, 로그인 전 복사 CTA는 로그인 후 안전한 복귀를 제공. 게시 전 실제 공개될 내용을 검토하고 개인정보/권리 확인, 원본 작성자에게만 공개 관리 버튼 노출(서버도 검증). 링크 복사는 Clipboard 실패 시 선택 가능한 URL 제공. 신고는 사유 선택·오류·제출 완료, 관리자는 신고 큐와 조치 확인 UI를 사용한다.

## 7. 분석 이벤트와 개인정보

기존 Analytics 발행 경로가 없어 중복 SDK는 도입하지 않는다. 기존 firebase 패키지의 analytics 모듈을 adapter 하나로 감싸고 기본 비활성화한다. `NEXT_PUBLIC_ANALYTICS_ENABLED=false`, measurement ID 미설정/미동의 시 SDK 초기화·스크립트·이벤트 전송 모두 하지 않는 방식을 채택한다. 정책 문서와 명시적 동의/철회 UI를 먼저 준비한다. 적용 지역/연령·법적 문구는 운영 범위 확인 후 검토한다.

| 이벤트 | 확정 기준·중복 방지 |
|---|---|
| sign_up | Google credential 결과의 isNewUser를 확인하고 서버 사용자 마커와 결합. 서버에서도 Auth 사용자 생성 메타데이터를 대조. 기존 사용자의 첫 Analytics 관측을 회원가입으로 오인하지 않음 |
| first_deck_created | 서버 최초 덱 commit 시1회. AI 완료만으로 발행하지 않음 |
| ai_generation_completed | generation request 성공 ID당1회. UI 재시도/초안저장으로 재발행 안 함 |
| first_review_completed | 서버에서 최초 평가 이벤트 commit 시1회. 의미는 “첫 카드 복습 완료”로 정의하고 세션완료와 구분 |
| deck_shared | 공유 링크 Clipboard 성공 또는 명시적 대체 복사 완료 시도. 링크 노출만으로 발행하지 않음 |
| public_deck_copied | copy mutation commit ID당1회 |
| return_7d | 최초 관측일+7번째 서비스 날짜의 실제 재방문(동일 타임존), 계정당1회. 가입일 기록 없는 기존 사용자는 관측 코호트로 구분 |
| ad_slot_viewed / ad_load_failed | 실제 슬롯 가시성/로딩 실패 기준. AdSense 지급·유효 노출 지표와 구분, disabled면0건 |

허용 속성은 eventId,기능명,개수 구간,결과 코드,모델 코드,동의버전 등 최소한으로 고정한다. 제목·질문·답·참고자료·답안·이메일·이름·원 URL/쿼리/인증토큰·raw UID를 외부 Analytics에 보내지 않는다. 자동 page_view/enhanced measurement 설정도 검토하고 URL 쿼리 수집을 차단한다. 오류 모니터링 역시 code/requestId/route template만 기록하고 payload/Authorization/사용자 텍스트를 제거한다.

발행 지점은 서버 확정 이벤트와 UI 공유 이벤트 중 하나로 고정한다. 서버 outbox+eventId로 내부 중복을 방지하고 클라이언트 마커를 UID별로 격리한다. 외부 GA4 네트워크 전달의 exactly-once까지 보장하지 않으며 필요 시 eventId로 분석 단계 중복을 제거한다. growth/state의 행동분석 마커와 analyticsOutbox는 동의 이후에만 생성한다. 기존 서버 기록으로 최초 여부를 확인할 수 없는 지표는 최초 관측으로 구분한다. 동의 거부/철회 시 전송·미전달 마케팅 큐를 중단하고 기능 사용은 유지한다. 운영 비용 기록은 서비스 보호용이며 광고/행동분석 동의와 혼동하지 않는다.

## 8. 광고 준비

`AdSlot` + provider adapter + 중앙 slot 설정, `NEXT_PUBLIC_ADS_ENABLED=false` 기본값. 실제 활성화는 유효한 publisher/slot ID, 정책/동의 설정, 별도 사용자 승인까지 충족해야 한다. ID가 없으면 외부 스크립트/요청/가짜 광고를 만들지 않는다.

위치는 공개 탐색 하단·대시보드 콘텐츠 뒤·학습 완료 결과 뒤 후보로 제한한다. 플래시카드·평가버튼·퀴즈 입력·생성 모달·로그인·신고/관리 UI 사이에는 넣지 않는다. 모바일/데스크톱 breakpoint별 고정 또는 min-height 영역을 렌더 전에 결정하여 CLS를 방지하고 “광고” 라벨과 조작 버튼 간 여백을 둔다. 광고 enabled 상태의 no-fill/차단/실패는 예약영역 내 중립 상태 또는 사전 결정된 비표시 처리로 대응하고 갑작스러운 높이 변화를 만들지 않는다. disabled일 때는 처음부터 슬롯·빈공간 없이 렌더한다.

iframe 내부 클릭을 읽거나 광고 클릭을 유도·자체 테스트하지 않는다. 실제 광고 impression/revenue는 승인 후 provider 보고 지표를 사용하고 개발 중에는 fake adapter로만 검증한다. 자동 광고·결제·구독·실제 게시·외부 수집 활성화는 이번 코드 계획 승인과 별도다.

## 9. 예상 수정 파일

아래는 승인 후 예상 경로다. 이번 턴에 해당 코드를 만들거나 변경하지 않았다.

| 영역 | 기존 수정 후보 | 신규 후보 |
|---|---|---|
| 공통/인증 | auth-account.tsx, study-provider.tsx, study-app.tsx, layout.tsx, globals.css | components/consent-settings.tsx, lib/server/admin-auth.ts |
| AI 비용 | app/api/generate/route.ts, lib/gemini.ts, server-auth.ts | lib/server/generation-usage.ts, generation-service.ts, app/api/usage/route.ts, generation-requests/[id]/route.ts, components/ai-usage.tsx |
| 공개/공유/복사 | study-cloud-model/client/store.ts, server/study-service/firestore/http.ts | lib/server/public-decks.ts, lib/public-deck-model.ts, app/explore/page.tsx, app/decks/[publicId]/page.tsx, components/public-deck-*.tsx, publication-dialog.tsx, app/api/publications/**, public-decks/** |
| 신고/관리 | firestore.rules | app/admin/reports/page.tsx, app/api/admin/reports/**, admin/costs/route.ts, lib/server/moderation.ts |
| 학습 지속 | lib/store.ts, cloud model/store/service, study-app.tsx, review-session.ts | lib/study-activity.ts, components/activity-calendar.tsx, learning-streak.tsx, review-reminder.tsx |
| 분석/모니터링 | firebase.ts, auth-account.tsx, generate route, study service, layout.tsx | lib/analytics.ts, analytics-events.ts, server/analytics-service.ts, app/api/analytics/events/route.ts, lib/server/error-monitor.ts |
| 광고 | layout.tsx, globals.css, 해당 목록/완료 UI | components/ads/ad-slot.tsx, lib/ads-config.ts |
| 설정/문서/테스트 | .env.example, firestore.rules/indexes.json, tests/firestore/security.test.mjs, docs/API/DATABASE/TESTING/ROADMAP, README | tests/generation-usage/public-decks/study-activity/analytics/ads*.test.mjs, 브라우저 시나리오, docs/PHASE4_PROGRESS.md |

기존 불필요한 리팩터링·기술 스택 변경 없음. 새로운 provider SDK는 설정 필요성이 확인될 때만 추가한다. browser E2E 도구가 필요하면 기존 node:test/Rules 도구로 커버되지 않는 사용자 흐름에 한해 도입한다. 기능 코드 작성 전 해당 Next16 로컬 가이드(서버/클라이언트 경계·async params·metadata·route)를 다시 확인한다.

## 10. 위험 요소와 검증

| 위험 | 검증/대응 |
|---|---|
| 비공개 내용이 목록/metadata/캐시에 남음 | public 상태검사 단일화,404/no-store,철회 전후 API/HTML/metadata/Rules 테스트, private 원본 경로 직접 접근 차단 |
| 공개·복사·철회·삭제 경합 | Firestore transaction에서 원본/공개 revision 검증, 동시 테스트·mutation 재시도·관리 hidden 재게시 차단 |
| 신고 악용/권한 상승 | UID 일일 상한/활성중복 방지,admin custom claim,일반사용자 관리자 API/Rules 접근 거부,감사 이벤트 검증 |
| quota race/자정/서버중단/다계정 | 병렬 요청20개/여러 인스턴스/UTC 경계/lease 복구/응답유실 테스트,전역 예산·fail closed |
| 스트릭 날짜 왜곡 | 자정/DST/윤년/월경계/타임존변경/legacy/전송지연 테스트,고정된 과거 날짜 보존 |
| 분석 중복/민감정보 | Strict Mode/새로고침/2탭/UID 변경/재전송 테스트,허용속성 스키마,미동의 네트워크0·철회 큐 중단 검증 |
| 광고 CLS/오클릭/실패 | disabled/ID없음/동의없음/로딩 실패/모바일 viewport 테스트,카드 조작 버튼 인근 배치 금지, 실제 광고 클릭 테스트 금지 |
| Firestore 비용/큰덱 | 공개20/목록20/커서상한·본문byte 검증, 변경분 조회·인덱스 확인, 대표 시나리오 문서 read/write 수 기록 |
| 기존 outbox/로컬 데이터 손실 | 구버전 v2 hydrate/미전송 명령/손상 JSON/flag 전환·다른계정 테스트,원본삭제·무단이관 금지 |
| 운영 검증 부재 | 실 ADC/Rules/도메인/모델 접근성·단가/관리자/광고·분석 ID는 출시 전 별도 확인, 미확인 항목을 완료로 보고하지 않음 |

기능별 node:test+관련 Rules emulator 테스트를 우선 실행하고 통합 시 typecheck/build, 마지막으로 전체 회귀·브라우저 로그인/로그아웃/복사복귀/모바일320·768·1440px/키보드·focus/error/빈 상태를 검증한다. 현재 lint 설정은 없으므로 lint 미실행을 명시한다. 필요 도구 추가는 최소화한다.

직전 단계 개발용 firebase-tools 전이 의존성 보안 경고7건과 Node 모듈 경고가 남아 있다. 운영 의존성 audit0건은 직전 실행 결과이며 이번에 재감사한 값은 아니다. 출시 전 최신 결과 재확인, 강제 업데이트로 기존 동작을 바꾸지 않는다.

## 11. 승인 범위·배포 준비

이 계획 승인 후에도 기능별 구현/테스트/보고 방식으로 진행한다. 코드 계획 승인은 실제 Firebase 리소스 생성·과금/광고/Analytics 외부 전송 활성화·admin claim 설정·영구삭제·프로덕션 배포 승인이 아니다. 로컬 마이그레이션 등 기존 Phase 3의 별도 기능은 명시된 의존성 외에 자동 착수하지 않는다.

승인 요청: **AI 비용 보호 → 동의·이벤트 기반 → 공개/공유/복사와 신고·관리 → 학습 지속 → 광고 비활성 준비 → 품질 검증** 순서. 공개 검색은 초기 접두어 방식, 공개는20장 스냅샷, 기존 로컬 계정은 마이그레이션 전 공유 제한, 광고·외부 Analytics 기본off를 제안한다. 이 결정들이 승인되면 첫 단위의 구체 코드 구현을 시작한다.

배포 준비 산출물은 설정 목록·모델/예산·Rules/index 검토·관리자 운영 절차·정책/동의 문구·롤백 flag·모니터링·테스트 기록·미검증 목록이다. 실제 배포 전 각 flag를off로 두고 demo emulator 검증→별도 테스트 환경 검증→명시적 운영 승인 순서를 따른다.

## 12. 참고 공식 자료

2026-10-21 확인. 구체 단가·서비스 설정·정책은 활성화 직전에 다시 확인한다.

- [Firebase Analytics Web](https://firebase.google.com/docs/analytics/web/get-started), [Analytics JS API: collection/consent](https://firebase.google.com/docs/reference/js/analytics)
- [Firestore 쿼리](https://firebase.google.com/docs/firestore/query-data/queries), [규칙 테스트](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [AdSense 프로그램 정책](https://support.google.com/adsense/answer/48182), [광고 배치 정책](https://support.google.com/adsense/answer/1346295)
- [Gemini 공식 가격표](https://ai.google.dev/gemini-api/docs/pricing)
