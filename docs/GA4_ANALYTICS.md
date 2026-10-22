# Moa GA4 방문·행동 분석 준비

## 확인한 연결 상태

Firebase Management API의 읽기 전용 조회 결과:

- Firebase 프로젝트: `ai-card-92a13`.
- 연결된 GA4 속성: `559832161`, 계정: `247231720`.
- 웹 앱: `1:472299472641:web:15c104ea17cee4e01bbd00` (모아).
- 웹 스트림: `16167675375`, 측정 ID: `G-RG4PEMXJC9`.

연결 자체는 존재한다. 실제 웹 수집, 향상된 측정, Google Signals, 연결된 태그 목적지, GA4 보관 설정은 변경하거나 검증하지 않았다. 실제 데이터 수집·push·배포는 수행하지 않았다.

## 수집 경로와 동의

기존 계정별 Firestore/outbox/Measurement Protocol 경로는 보존하되 기본 비활성 상태를 유지한다. 새 방문 분석은 동일 GA4 웹 스트림의 Google 태그를 사용하며, Firebase Analytics SDK의 자동 초기화나 Firebase User-ID는 사용하지 않는다. 서버 MP만으로는 부족한 브라우저 방문·세션·기기 지표를 웹 태그로 처리한다.

기본 동의 모드로 **동의 전에는 스크립트 자체를 요청하지 않고** 이전 행동을 큐에 담거나 소급 전송하지 않는다. 동의한 브라우저에만 무작위 client_id를 만들며 Firebase UID에서 파생하지 않는다. 로그인하지 않아도 선택할 수 있다. 새 동의는 `2026-10-22-web-v1` 정책을 사용하며 기존 계정 동의를 자동 승계하지 않는다.

선택은 브라우저 단위로 90일 보관한다. 공유 브라우저의 다른 사용자에게도 적용되며 다른 기기로 복제하지 않는다. 철회는 즉시 `ga-disable`을 켜고 이후 이벤트 및 로딩 중인 태그의 늦은 초기화를 차단한다. 광고 동의를 거절 상태로 유지하며, 철회 시 별도 cookieless consent ping을 보내지 않는다. 같은 브라우저 다른 탭은 storage 이벤트와 전송 직전 동의 재검사로 철회를 반영한다. 이미 네트워크에 실린 데이터는 회수할 수 없다.

동의 선택·중복 방지 저장소나 태그 초기화가 실패하면 분석만 중단한다. 인증·Firestore·Gemini 요청 경로는 그대로 유지한다. 새 웹 모드를 켜면 기존 서버 GA4 sender는 비활성화하여 두 경로의 중복 집계를 막는다.

## 이벤트와 성공 기준

| 이벤트 | 기준 | 앱이 보내는 추가 정보 |
| --- | --- | --- |
| page_view | 동의 후 공개 경로 진입 | 허용 경로, 유입 분류 |
| login | Google popup 로그인 성공 | 없음 |
| card_generation_completed | AI/규칙 추출 결과 확보, 직접 만들기는 저장 성공 시 | 방식 manual/rules/ai, 개수 구간 |
| cards_saved | confirmDeck 등 기존 저장 확인 완료, 재생성 저장 성공 | 방식, 개수 구간 |
| review_started | 실제 카드가 있는 복습 세션 시작·다시 시작 | 개수 구간 |
| review_completed | 마지막 카드 완료 저장 성공 | 개수 구간 |
| screen_view | 대시보드·덱·전체 복습·통계·설정 전환 | 고정 영문 화면 이름 |

화면 이름은 dashboard/decks/review/statistics/settings만 허용한다. 개수는 1–5/6–10/11–20/21–200 구간이며 원문·덱 이름·카드 ID는 매개변수가 아니다. Google 태그의 표준 세션·첫 방문·참여 등 기술 이벤트는 방문/기기 분석에 사용한다. 수동 page_view로 페이지 방문 중복을 피한다.

## 개인정보 제한과 유입 분석 범위

- 이벤트 입력은 strict allowlist 스키마로 검사한다. 이메일·UID·이름·카드/덱 제목·질문·답·자료·오류 원문 필드를 거절한다.
- page_location은 환경변수의 신뢰한 origin과 공개 경로 목록으로 새로 만든다. 쿼리·해시·임의 경로는 보내지 않는다. 알 수 없는 경로는 `/other`로 묶는다. page_title은 고정값 `Moa`다.
- URL/referrer는 동의 후 브라우저에서 분류한다. Google/네이버/Bing/Instagram/YouTube/Kakao/직접/기타 등 고정값만 사용한다. 자유 입력 UTM 캠페인명·검색어·외부 주소 원문은 전송하지 않는다. 캠페인명은 `moa`로 고정한다. 따라서 상세 외부 사이트나 캠페인명별 분석은 지원하지 않는다.
- `acquisition_source`, `acquisition_medium`은 상세 캠페인 추적 대신 분류를 보는 사용자 정의 차원으로 등록할 수 있다. 기본 유입 보고서와의 실제 매핑은 활성화 후 DebugView·실시간·획득 보고서에서 검증해야 한다.
- Google 태그는 기기/브라우저 등 통신 정보를 처리할 수 있다. 앱이 IP 원문을 별도 매개변수로 보내지는 않지만 브라우저–Google 통신 자체의 IP/UA 처리를 제거했다는 의미는 아니다. 이를 개인정보 안내에 반영했다.
- 내부 중복 방지 키에는 동작 식별자가 포함될 수 있지만 브라우저에만 보관하고 GA4에는 임의 event_id만 보낸다.

## 중복과 전송 실패

동작별 키를 Web Lock 안에서 로컬 저장한 뒤 전송한다. 동일 덱 저장 재시도, 동일 AI 요청 결과 재조회, 화면 effect 재실행, 같은 복습 완료 콜백이 중복 이벤트를 만들지 않도록 한다. 서로 다른 실제 화면 전환·새 복습은 다른 키를 사용한다. 최근 1,000개 키 범위에서 새로고침/탭 간 중복 방지를 유지한다. 보관 범위를 넘은 아주 오래된 동작 재실행까지 영구적으로 중복 방지하는 것은 아니다.

추적 실패는 자동 재시도하지 않는다. 네트워크 불확실성에서 중복보다 누락을 선택하므로 GA4와 실제 저장 건수가 완전히 같다고 보장하지 않는다. 차단기·동의 거부에 따른 누락도 정상이며 방문자는 계정 수가 아니라 브라우저 기반 추정치다.

## 테스트 배포 환경변수

| 변수 | 현재 값/의미 |
| --- | --- |
| NEXT_PUBLIC_GA4_ENABLED | true — 로컬 배포 설정에 준비, 아직 미배포 |
| NEXT_PUBLIC_GA4_MANUAL_ONLY_CONFIRMED | true — 2026-10-23 운영자의 향상된 측정 전체 비활성/자동 페이지·히스토리 설정 확인에 근거 |
| NEXT_PUBLIC_GA4_MEASUREMENT_ID | G-RG4PEMXJC9 — 공개 측정 ID |
| NEXT_PUBLIC_SITE_ORIGIN | https://moa-web--ai-card-92a13.asia-east1.hosted.app |
| ANALYTICS_ENABLED / NEXT_PUBLIC_ANALYTICS_ENABLED | 기존 계정별 분석: false 유지 |
| ANALYTICS_EXPORT_ENABLED | 기존 MP 외부 전송: false 유지 |

브라우저 경로에는 GA4_API_SECRET이 필요하지 않다. 새로운 Secret이나 IAM 권한을 만들지 않았다. NEXT_PUBLIC 설정을 바꾸면 새 빌드/배포가 필요하다.

## 활성화 전 승인 및 운영 점검

1. GA4 웹 스트림의 향상된 측정을 끈다. 자동 페이지/히스토리 추적, 폼 상호작용, 사이트 검색, 외부 클릭, 파일 다운로드·동영상 등 자동 수집과 연결된 태그 목적지를 검토한다. Google Signals·사용자 제공 데이터·User-ID 수집도 사용하지 않는 상태인지 확인한다. 이 콘솔 작업은 이번에 수행하지 않았다.
2. 운영자·연락처·Google 데이터 처리/보관/삭제 안내를 확정하고 동의 UI를 검토한다. 분석 쿠키는 30일, 선택은 90일을 기준으로 구현했다. 브라우저 동의와 기존 계정 동의의 범위 차이를 확인한다.
3. 활성화 요청에 따라 GA4_ENABLED는 true로 준비했다. 2026-10-23 운영자의 콘솔 확인과 저장소의 별도 태그 점검 후 MANUAL_ONLY_CONFIRMED도 true로 준비했다. 방문자의 분석 동의는 여전히 필수다. push와 rollout은 각각 별도 승인받는다. 검토 확인 플래그를 켰다는 것만으로 GA4 콘솔 설정이 자동 변경되지는 않는다.
4. 동의 전 Google Analytics/Tag Manager 측정 요청 0건, 동의 후 테스트 이벤트, 쿼리에 개인정보가 있어도 전송 제외, 철회/다중 탭/새로고침/저장 실패를 브라우저 네트워크로 검증한다. DebugView/실시간 보고서와 유입·기기 차원을 확인한다. 필요하면 별도 테스트 속성을 사용한다.

## 로컬 검증 결과와 한계

이전 준비 단계에서 전체 테스트 156개, HTTP 회귀 검사 6개, 타입 검사, 프로덕션 빌드, 번들 비밀값 검사를 통과했다. 현재 배포 설정은 GA4_ENABLED=true, MANUAL_ONLY_CONFIRMED=true이며 기존 계정별 분석/MP 플래그는 모두 false다. Gemini·Firestore 설정을 유지한다. 이번 활성화 준비의 재검증 결과는 아래에 기록한다.

2026-10-22 활성화 준비 재검증: 전체 테스트 157개(수동 page_view effect 재실행·가시성 복원 중복 방지 및 실제 경로 왕복 검사 포함), HTTP 회귀 검사 6개, 타입 검사, 위 배포 플래그를 명시한 프로덕션 빌드 통과. 브라우저 번들 23개와 변경 파일 23개에서 구성된 로컬 비밀값이 발견되지 않았다. 엄격한 이벤트 스키마 테스트로 이메일·UID·카드 내용·입력 원문 및 URL 쿼리/해시 제외를 확인했다. 실제 Google 전송 내용/콘솔 상태/실시간 보고서는 아직 미검증이다. GitHub push와 rollout은 실행하지 않았다.

모의 태그/저장소와 DOM 테스트는 사전 차단·철회·중복 방지·안전한 매개변수를 확인한다. 콘솔 상태는 운영자 확인에 근거하며 직접 조회하지 않았다. 실제 Google SDK 네트워크 요청과 GA4 보고서 반영은 배포 전이므로 아직 검증하지 않았다. Google 태그를 설치하지 않고도 표준 기술 이벤트를 완전히 모의 검증했다는 의미가 아니다.

공식 참고: [기본 동의 모드](https://developers.google.com/tag-platform/security/concepts/consent-mode), [GA4 설정](https://developers.google.com/analytics/devguides/collection/ga4/reference/config), [향상된 측정](https://support.google.com/analytics/answer/9216061), [Firebase 연결 조회](https://firebase.google.com/docs/reference/firebase-management/rest/v1beta1/projects/getAnalyticsDetails).

2026-10-23 최종 점검: 두 활성화 플래그 true로 프로덕션 빌드, 타입 검사, 전체 테스트 158개, HTTP 검사 6개, 브라우저 번들 비밀값 검사 통과. 저장소에 별도 GA/GTM 삽입 또는 Firebase Analytics 자동 초기화가 없고 MP 전송도 비활성이다. 기존 외부 Google 태그가 발견될 때 추가 태그와 이벤트를 차단하는 회귀 검사를 추가했다. 자동 페이지 조회는 모든 태그 config에서 send_page_view=false로 설정하며 수동 조회는 동작 키로 중복 방지한다. push·rollout은 미실행이다.
