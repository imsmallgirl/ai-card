# Phase 4 작업 2 — Analytics 동의·이벤트 기반

2026-10-21. 승인된 계획의 다음 기능 단위만 구현했다. 외부 전송·수집은 기본false이며 실제 운영 설정, Google Analytics 속성/비밀키, 광고, 프로덕션 배포를 변경하지 않았다. 새로운 패키지는 설치하지 않았다.

## 구현 범위와 설계 구체화

브라우저 Firebase Analytics SDK 대신 **서버 이벤트 + GA4 Measurement Protocol adapter**를 사용한다. 앞선 계획의 SDK adapter 제안에서 구체화한 결정이며, 자동 page_view/enhanced measurement/URL·쿼리·referrer 수집을 피하고 허용된 속성만 전달하기 위해서다. 브라우저에 Google Analytics 스크립트/쿠키/gtag를 추가하지 않는다. 기존 Firebase Authentication SDK는 그대로 유지한다.

- 로그인 계정별 선택적 분석 동의/거부/철회 UI, 공개 `/privacy/analytics` 안내 페이지.
- 분석 동의를 Firebase UID별 서버 문서에 저장하고 서버에서 동의 상태·정책 버전·revision 확인.
- core 데이터의 commit transaction에 최초 관측 이벤트와 마커를 함께 저장. 재시도된 domain mutation은 이벤트도 중복 생성하지 않음.
- 클라이언트 로컬 모드의 덱/첫 복습은 별도 인증 API로 최소 신호만 수신, `source=local`의 자체 보고로 구분.
- 서버 outbox의 단일 발행 경로와 전송 claim. 철회/정책 버전 변경/만료된 이전 동의 이벤트는 전송 대상 제외.
- 외부 adapter와 테스트 fake sender. 실제 외부 전송 설정이 없으면 outbox 조회/Google 호출 모두 하지 않음.

## 활성화 설정

| 환경변수 | 기본 / 역할 |
|---|---|
| NEXT_PUBLIC_ANALYTICS_ENABLED |false. 클라이언트 동의 조회·이벤트 연결 허용. 재빌드 필요 |
| ANALYTICS_ENABLED |false. 서버 신규 분석 이벤트 수집 허용 |
| ANALYTICS_EXPORT_ENABLED |false. 서버 외부 전송을 별도로 허용 |
| GA4_MEASUREMENT_ID |빈값. 실제 Web stream ID가 G- 형식이어야 함 |
| GA4_API_SECRET |빈값. 서버 전용 Measurement Protocol secret, NEXT_PUBLIC로 노출 금지 |

수집 플래그2개를 켜더라도 **해당 사용자의 명시적 동의가 있어야** 이벤트가 기록된다. 실제 Google 전송에는 별도 export flag 및 유효 설정까지 모두 필요하다. 이번에는 .env.example의false/빈 설정만 추가했고 .env.local은 수정하지 않았다.

운영 활성화 전에는 실제 서비스 개인정보처리방침·보존/물리삭제·운영자/사용지역·Google 설정 및 별도 외부 수집 승인이 필요하다. 현재 안내 페이지는 실제 구현의 동작 설명이며 앱 전체 개인정보처리방침을 대체하지 않는다. 동의 문구를 구현했다고 법적 검토까지 완료된 것으로 보고하지 않는다.

## 이벤트 의미와 연결 상태

| 이벤트 | 현재 기준/발행 위치 |
|---|---|
| sign_up | 동의 시 서버 Auth 사용자 생성시각/최초 로그인 메타데이터를 확인. 생성5분 이내·처음 로그인인 계정만1회. 가입 직후 미동의·늦은동의는 소급 측정하지 않음 |
| first_deck_created | cloud createDeck commit 또는 local 저장 후 자체보고에서 최초 관측1회. occurrence=first_observed이며 생애 첫 덱/최초 가입 덱이라고 표시하지 않음 |
| ai_generation_completed | 성공 result 저장 transaction에서 generation request ID별1회. HTTP 재전송/결과 재조회/덱 저장 재시도는 추가 이벤트 없음 |
| first_review_completed | cloud rate commit 또는 local 평가 후 최초 관측1회. **첫 카드 평가**이며 전체 세션 완료를 의미하지 않음 |
| return_7d | 동의 후 최초 관측일+7번째 서비스 날짜에 실제 visit이 있으면1회. profile IANA timeZone, 기존계정은 관측 코호트. 6/8일째를7일 재방문으로 계산하지 않음 |
| deck_shared / public_deck_copied | 이벤트 스키마만 예약. 공개 기능이 아직 없어 발행 지점/API 수신은 구현하지 않음 |
| ad_slot_viewed / ad_load_failed | 스키마만 예약. 실제 광고/익명 수집/광고 관련 지표는 미구현, 현재0건 |

중앙 스키마에서 허용하는 속성은 source(cloud/local/server/account), count_bucket(1-5/6-10/11-20), occurrence(최초관측/실제계정생성/관측재방문)뿐이다. 제목·질문·정답·자료·답안·이름·이메일·페이지주소/쿼리·인증토큰·raw UID를 외부 이벤트에 포함하지 않는다. 외부 client_id는 동의 시 새로 만든 무작위 식별자로 Firebase UID에서 파생하지 않는다. user_id, page_location, referrer, 사용자IP override를 전송하지 않는다.

독립 Measurement Protocol 기반이므로 브라우저 세션/마케팅 유입/지역/GA4 자동 retention을 완전하게 재현하지 않는다. 7일 재방문은 자체 이벤트 정의로 측정한다. 외부의2xx는 HTTP 수신 확인이지 보고서 반영 성공을 보장하지 않는다. 실제 GA4 validation/보고서는 아직 검증하지 않았다.

## 동의·철회·계정 격리

동의는 계정에 저장되며 다른기기에도 적용된다. 확인 전 기본은수집off. 로컬 캐시만으로 동의를 승인하지 않고 서버 확인을 기다린다. root AuthProvider 아래 analytics controller를 UID별로 생성/종료하고 이전 UID의 동의/늦은응답/전송작업을 다음계정에 적용하지 않는다.

철회 버튼은 이 기기의 수집을 즉시 끄고 `moa-analytics-consent-{uid}`에 pendingWithdrawal을 먼저 저장한다. 네트워크가 끊기면 명시적으로 오류/재시도를 안내한다. 온라인 복귀/설정 재확인 시 서버 철회를 재전송한다. storage event로 다른 탭도 즉시pause한다. 계정변경/로그아웃 시 fetch abort, timer 종료. 정책 버전이 바뀐 옛 동의도 철회 후 새 동의를 받는다.

서버 철회가 커밋되면 consent revision이 증가해 모든 이전 epoch의 대기 이벤트가 무효가 된다. 철회는 stale revision이어도 허용하지만 stale grant는409로 거부하여 예전 탭의 응답이 새 동의를 복구하지 못하게 한다. 동일 mutationId 재전송은 같은 결과, 정책/결정 변경은409.

오프라인 철회가 아직 서버에 반영되지 않았을 때 다른 기기에는 기존 동의가 남을 수 있다. 이미 전송 처리 중이거나 Google에 전달된 이벤트를 철회만으로 회수하지는 못한다. 이 한계를 안내 UI/페이지에도 명시했다. queue 제외와 물리 삭제는 별개다.

## 전송과 비용

브라우저는 자체 서버 API만 호출한다. 로그인 초기/동의 변경 후 visit을 보낸다. cloud 이벤트는 서버에서 기록, local 최초 행동은 클라이언트가 보고한다. 사용 중인 보이는 탭에서60초마다 동의를 재확인하고 남은 outbox를 최대5개씩 전송한다. collection flag가false면 자동 API/timer 활동을 만들지 않는다. local 최초 행동의 클라이언트 보고는 한 controller당 종류별1회로 제한한다.

export flagfalse/설정누락이면 Google 요청뿐 아니라 outbox 쿼리도 생략한다. 외부 전송은 로그인 UID의 pending row만5개씩 문서ID순 조회, claim transaction→동의 재확인→외부요청→결과상태 기록. 각 요청3초 signal. 외부응답 유실/프로세스중단은 uncertain/sending으로 남기고 자동 재전송하지 않아 중복 전송을 피한다. 전달 누락 가능성을 감추지 않으며 exactly-once 보고서 반영을 주장하지 않는다.

대기 row는7일의 논리적 expiresAt을 갖지만 GA4의 과거 발생시각 제약에 맞춰 **72시간 이후에는 전송하지 않는다**. 외부 payload에 서버 발생시각(timestamp_micros)을 넣는다. 과거 이벤트를 오늘 발생한 것으로 소급 전송하지 않는다. state가cancelled/uncertain/expired인 row 및 growth/동의 기록의 자동 물리 정리·삭제는 아직 미구현이다. 실제 보존정책·TTL은 별도 검토/배포 대상이다.

클라이언트 이벤트 API는 UID별 프로필 날짜 기준200요청/일 상한. 이는 학습 횟수 제한이 아니라 선택적 분석 신호 제한이다. 다중 탭/기기의 반복 최초신호도 서버 marker로1회 처리한다. export/동의 API의 악성 HTTP 유입비용 전체를 hard cap하는 기능은 아니며 운영 시 호스팅 rate limit 검토가 필요하다. 자동 Analytics SDK·새 외부 모니터링 도구는 추가하지 않았다.

## DB와 API

추가 경로는 모두 users/{uid} 아래 서버전용이다.

| 경로 | 내용 |
|---|---|
| consent/analytics |granted,revision,policyVersion,lastMutationId,updatedAt,clientId(거부 시 빈값) |
| growth/state |동의 후 firstSeenAt,signupRecorded,firstDeckObservedAt,firstReviewObservedAt,lastVisitDate,return7Recorded |
| analyticsOutbox/{cN-eventId} |name,허용props,createdAt,expiresAt,consentRevision,policyVersion,state,attemptedAt. 내용 전문 없음 |
| analyticsLimits/{localDate} |선택적 client 신호 요청수 |

기존 Firestore Rules의 기본deny를 유지해 **소유 사용자도 위 운영문서에 직접 접근할 수 없다**. API가 인증 UID 경로에 접근하며 consent 응답에서clientId/내부 마커를 제외한다. 소유 경로/원자성은 Rules+Admin서비스 각각 검증한다. 신규 복합 인덱스·기존 데이터 이관/삭제 없음. 기존 cloud snapshot 모델을 변경하지 않는다.

- GET `/api/analytics/consent`: `{consent:{granted,revision,policyVersion},enabled}`.
- POST 같은경로: `{granted,expectedRevision,mutationId(UUID),policyVersion}`. deny는 collection flagoff일 때도 서버 반영 가능.
- POST `/api/analytics/events`: `{action:visit|local_deck_created|local_review_completed,id(UUID),consentRevision,count?}`. count는 local 덱생성1~20만. 임의 props/UID/공유·광고 위조 이벤트는400. 현재 동의와 맞지 않으면 `{accepted:false}`.
- POST `/api/analytics/export`: 본인 queue만 처리. export off면 attempted0. 임의 외부 URL/사용자 ID를 입력받지 않음.

모두 Bearer필수/no-store.401 인증,400스키마,409동의충돌,429client신호한도,503설정·저장소 오류. 선택적 client API/외부전송 실패를 학습 UI에 전파하지 않는다. collectionoff일 때 기존 core transaction에 분석 읽기/쓰기가 추가되지 않는다. collectionon+동의계정의 cloud 이벤트는 학습저장과 같은 transaction에 있으므로 추가 Firestore 읽기/쓰기 및 지연은 있다.

## 변경 파일

신규: `src/lib/analytics-model.ts`, `analytics-client.ts`, `src/lib/server/analytics-service.ts`, `analytics-http.ts`, `analytics-export.ts`, `analytics-runtime.ts`, `src/components/analytics-provider.tsx`, `consent-settings.tsx`, `src/app/api/analytics/{consent,events,export}/route.ts`, `src/app/privacy/analytics/page.tsx`, `tests/analytics.test.mjs`.

수정: `src/lib/server/study-service.ts`, `generation-usage.ts`, `firestore-database.ts`, `src/app/layout.tsx`, `src/components/study-app.tsx`, `src/app/globals.css`, `tests/firestore/security.test.mjs`, `.env.example`, README와 관련문서. 기존 firebase/auth 모듈의 동작은 유지했다. 측정계정/비밀키/실서비스flag/패키지/Rules 배포는 변경하지 않았다.

## 검증·남은 작업

최신 실행 결과는 [TESTING.md](TESTING.md) 참고. 실제 Google 전송/GA4 validation·보고서·Auth관리자격증명·브라우저의storage event/철회DOM·모바일 E2E는 아직 미검증이다. 브라우저 SDK/쿠키 자동추적이 없는 구조와 fake adapter의payload를 코드/테스트로 확인했다.

다음은 공개 덱·공유·복사·신고/관리 작업이며 이번 범위에서 구현하지 않았다. 광고 이벤트와 공개 이벤트의 실제 연결, 동의 외의 계정삭제/분석자료 물리삭제, 외부 에러모니터링 운영연동도 후속 과제다.

공식 자료(2026-10-21 확인): [Measurement Protocol](https://developers.google.com/analytics/devguides/collection/protocol/ga4/reference), [Web/App 전송 차이·비밀키](https://developers.google.com/analytics/devguides/collection/protocol/ga4/sending-events), [Firebase Analytics API](https://firebase.google.com/docs/reference/js/analytics). 실제 활성화 전 설정·정책·수신결과를 다시 확인한다.
