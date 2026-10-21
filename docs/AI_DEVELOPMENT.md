# Gemini 오류 진단과 개발 전용 Mock

2026-10-21. 실제 Gemini 생성 API를 호출하지 않고 코드·로컬 설정·로그와 공식 문서를 점검했다.

## 현재 진단에서 확인한 사실과 한계

- 변경 전 `.env.local`의 모델은 `gemini-3.5-flash`였다. 사용자가 언급한 3.6과 다르지만, 이것만으로 실패 원인이 모델 오류라고 확정하지 않는다.
- GEMINI_API_KEY의 설정 유무만 확인했고 값은 출력하지 않았다. 키의 유효성·결제 상태·모델 접근 권한을 실제 API로 검사하지 않았다.
- 확인한 로컬 Next 개발 로그에는 최근 429/404/503, RESOURCE_EXHAUSTED, 결제 오류 원본이 없었다. Firestore 운영 데이터를 추가 조회하거나 Gemini를 재호출하지 않았다. 따라서 과거 실패의 정확한 원인은 아직 미확정이다.
- 기존 코드는 모든 HTTP429를 QUOTA_EXCEEDED로 합쳤고, 실패 기록에는 원본의 quota 세부 사항을 남기지 않았다. 변경 후에는 안전한 분류 코드와 providerStatus/providerCode를 화면·API·실패 기록에 남긴다. 과거 오류를 소급하여 정확히 분류할 수는 없다.

## 오류 구분

| 근거 | 애플리케이션 코드 | 설명 |
|---|---|---|
| 429/RESOURCE_EXHAUSTED, 추가 근거 없음 | RESOURCE_EXHAUSTED | 요청·토큰·일일 할당량·지출 한도 중 무엇인지 확정 불가 |
| QuotaFailure의 per-minute/per-second 항목, RATE_LIMIT_EXCEEDED reason | RATE_LIMIT_EXCEEDED | 응답이 명시한 단기 요청/토큰 한도 |
| QuotaFailure의 per-day 항목 | DAILY_QUOTA_EXCEEDED | 응답이 명시한 일일 할당량 |
| quotaValue=0 | QUOTA_UNAVAILABLE | 해당 모델/티어 할당량이 0. 단순 대기만으로 해결된다고 가정하지 않음 |
| SPEND_LIMIT_EXCEEDED 등 명시적 reason, 지출 한도 초과 문구 | BILLING_LIMIT_EXCEEDED | 응답에 지출/결제 한도 초과가 명시됨 |
| HTTP402 또는 크레딧 소진 명시 | BILLING_CREDITS_EXHAUSTED | 결제/선불 크레딧 확인 필요 |
| BILLING_DISABLED 등 reason, enable billing 명시 | BILLING_REQUIRED | 결제 활성화/계정 문제 |
| HTTP404 | MODEL_NOT_FOUND | 모델 ID·접근 가능 여부·API 버전 확인. 모델이 존재하지 않는다고 단정하지 않음 |
| HTTP400 / FAILED_PRECONDITION, 추가 근거 없음 | PROVIDER_PRECONDITION | 전제 조건 불충족. 결제 문제로 단정하지 않음 |
| 기타 HTTP400 | MODEL_REQUEST_INVALID | 요청 형식/모델 옵션 지원 확인 |
| 키 무효/만료/유출 reason, HTTP401 | INVALID_API_KEY | 서버 키 상태 확인 |
| 기타 HTTP403 | ACCESS_DENIED | 키 제한/API·모델 접근 확인 |
| HTTP5xx | PROVIDER_UNAVAILABLE | 일시적 서버 오류. 기존 최대3회 재시도 유지 |

429에는 자동 재시도를 하지 않는다. 응답의 일반적인 “check plan and billing details” 문구만으로 결제 한도라고 분류하지 않는다. 원본 provider message·키·URL·프로젝트 ID·참고 자료는 로그/진단 응답에 복사하지 않는다. 응답의 diagnostic에는 숫자 HTTP 상태와 허용 목록의 provider status만 포함한다. 앱 자체 DAILY_LIMIT/GLOBAL_LIMIT/COOLDOWN과 Gemini 오류 코드는 별개다.

공식 근거: [문제 해결](https://ai.google.dev/gemini-api/docs/troubleshooting), [요청·토큰·지출 한도](https://ai.google.dev/gemini-api/docs/rate-limits), [API 오류](https://ai.google.dev/gemini-api/docs/api-errors). 현재 앱은 generateContent API를 사용하므로 Interactions 전용 오류 코드를 사용하는 것으로 가정하지 않는다.

## 로컬 설정과 사용법

Git에서 제외되는 `.env.development.local`에 다음 설정을 적용했다. 기존 `.env.local`의 API 키·ADC·Firestore 설정은 변경하지 않았다.

```dotenv
AI_PROVIDER=mock
GEMINI_MODEL=gemini-3.1-flash-lite
AI_GENERATION_ENABLED=true
```

`npm run dev`를 재시작하고 새 덱을 만든다. 모달에 `Mock 모드 · Gemini API 호출 없음`이 표시된다. 1~20장의 테스트 카드가 생성되고 기존 사용자별 Firestore 저장/실패 표시/재조회/편집/덱 삭제가 그대로 동작한다. Mock은 의미 있는 학습 내용을 생성하거나 참고 자료를 분석하지 않으며 질문과 답에 Mock 테스트용 표시를 붙인다.

Mock은 `GEMINI_API_KEY`가 없어도 실행되지만 Google 로그인과 정상 Firestore 연결은 필요하다. Gemini 비용은 없고 Firestore 읽기/쓰기는 정상적으로 발생한다. 모든 생성 횟수 제한을 우회하며 provider attempts·청구 사용량을 증가시키지 않는다. 같은 request ID의 성공 결과를 재사용하며 같은 ID에 다른 입력을 보내면 충돌한다.

실제 개발 모델을 사용하려면 같은 파일에서 `AI_PROVIDER=gemini`로 바꾸고 서버를 재시작한다. 그때부터 Gemini 호출 비용/할당량이 적용될 수 있다. `GEMINI_MODEL`은 정확한 모델 ID이며 `models/` 접두어도 허용한다. 후속 요청에 따라 코드 기본값·환경변수 예제·현재 로컬 및 개발 설정의 기본 모델을 gemini-3.1-flash-lite로 통일했다. 모드 선택과 API 키는 변경하지 않았다.

**현재 공식 문서 주의사항:** [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)는 기존 사용 이력이 있는 사용자에게 접근을 제한할 수 있다고 명시한다. 모델 ID 지원을 구현했어도 현재 프로젝트에서 실제 사용 가능한지/무료 한도가 있는지는 별개이며 보장하지 않는다. 실제 모델 호출로 이를 검증하지 않았다.

기존 실패 요청을 재개하면 기존 실패 결과를 보여준다. Mock 전환 후에도 그 요청을 성공으로 덮어쓰지 않는다. 실패 응답에는 terminal=true를 포함하여 종료된 요청을 구분한다. 화면은 종료된 요청 재조회 버튼을 비활성화하고 오류 바로 아래에 `같은 내용으로 새 Mock 요청 준비`(실제 모드: `같은 내용으로 새 요청 준비`)를 표시한다. 이 버튼은 제목·카테고리·자료·질문 수를 유지하고 브라우저의 이전 요청 연결만 해제한다. 이후 `Mock 카드 만들기`를 눌러 새 ID로 생성한다. 서버의 과거 실패 기록은 보존하며 자동으로 Mock으로 대체하지 않는다. 기존 `다른 내용으로 새 요청 준비`도 사용할 수 있다. 성공 결과가 이미 보존된 요청은 설정 전환만으로 새 모델을 호출하지 않는다.

## 배포 차단·보안·응답 호환성

- 기본 AI_PROVIDER는 gemini다. mock은 NODE_ENV=development와 AI_PROVIDER=mock을 모두 명시한 로컬 환경에서만 허용한다. Vercel/Cloud Run/Netlify 호스팅 환경도 차단한다.
- production/test/환경 불명에서 mock을 설정하면 MOCK_DISABLED(503)로 실패한다. Gemini로 자동 전환하지 않아 예상치 못한 유료 호출도 방지한다. production에서 저장된 Mock 생성 결과를 생성 API로 재개하는 경로도 차단한다.
- Gemini 실패 시 Mock fallback은 없다. 요청 body/query로 모드나 모델·키를 지정할 수 없다. 서버 환경변수로만 결정한다.
- Mock 응답은 실제 응답과 동일한 `{cards:[{question,answer}],model,requestId,usage}` 구조다. model은 `mock-study-v1`. 같은 generationClientResult 스키마를 검증하고 기존 addDeck/confirmDeck 경로로 저장한다. 실패해도 브라우저의 생성 복구 데이터와 전송 대기열은 유지한다.
- 생성 요청/성공 draft는 기존 UID 하위 컬렉션을 쓴다. Mock에는 provider 호출이 없어 attempts=0, charged 증가 없음. 사용자별 잠금·멱등성·계정 분리를 유지한다. 서비스 완료 건수는 Mock도 포함될 수 있고 모델별 집계는 mock-study-v1로 구분한다.
- Mock으로 이미 저장한 덱은 사용자 테스트 데이터이므로 배포하거나 모드를 바꿔도 자동 삭제하지 않는다. 필요하면 기존 덱 삭제로 정리한다.
- GEMINI_API_KEY는 서버에서만 읽어 외부 요청 헤더에 넣는다. 브라우저에는 모드/모델명/정제된 오류만 전달한다. 환경 파일은 Git 제외 상태를 유지한다.

## 주요 변경 파일

- `src/lib/gemini-errors.ts`, `src/lib/gemini.ts`: 안전한 오류 분류와 기존 export 호환.
- `src/lib/server/generation-settings.ts`, `generation-mock.ts`: 서버 모드/모델 결정, 배포 차단, API 없는 생성.
- `src/lib/server/generation-http.ts`, `generation-service.ts`, `generation-usage.ts`: Mock/실제 경로 분기, 진단 보존·재조회, 기존 Firestore 흐름 유지.
- `src/lib/generation-client.ts`, `src/components/ai-usage.tsx`, `study-app.tsx`: 진단 해석과 모드 안내.
- `.env.development.local`(Git 제외), `.env.example`, `README.md`: 실행 설정·문서.
- `tests/generation-mock.test.mjs`, `tests/firestore/security.test.mjs`: 모드 차단/오류/비노출/Firestore 통합 검증.

실행한 검증 결과와 미검증 범위는 [TESTING.md](TESTING.md)의 최신 항목을 참고한다.


## 기본 모델 3.1 Flash-Lite 전환

현재 기본 모델은 정식 모델 ID `gemini-3.1-flash-lite`다. preview 접미어는 사용하지 않는다. `.env.local`과 우선순위가 높은 `.env.development.local`을 함께 변경했다. 서버 재시작 뒤 생성 모달에 `Gemini · gemini-3.1-flash-lite`가 표시되는지 확인하고, 종료된 이전 요청은 `같은 내용으로 새 요청 준비`를 눌러 입력을 유지한 새 ID로 제출한다. 과거 실패 기록은 모델을 바꿔도 성공으로 바뀌지 않는다. 새 모델에서도 실제 생성 성공을 보장하지 않으며 키별 할당량/결제는 별개다.
# Gemini 400 요청 오류 점검

REST 구조화 출력은 `generationConfig.responseFormat.text`에 `mimeType: APPLICATION_JSON`과 `schema`를 전달합니다. 모델명·API 키·환경변수는 이 수정으로 변경하지 않습니다. 스키마의 배열 상한과 카테고리 enum 제약을 줄이고, 카드 수·태그 수·분류 유효성은 기존 서버 검증으로 검사합니다.

400 응답은 제공자의 원문에 명시된 경우에만 `OUTPUT_SCHEMA_TOO_COMPLEX`, `STRUCTURED_OUTPUT_OPTION_INVALID`, `OUTPUT_TOKEN_OPTION_INVALID`로 구분합니다. 그 외는 `MODEL_REQUEST_INVALID`로 유지하며 원문·입력·키를 노출하지 않습니다. 일반 400 메시지만으로는 정확한 원인을 확정할 수 없습니다.

실패한 요청 ID는 오류가 재조회됩니다. 수정 후에는 생성 창을 X로 닫고 다시 열어 새 요청을 만드세요. 400 자동 재호출이나 Mock 자동 대체는 하지 않습니다. 실제 Gemini 성공 여부는 별도 실제 호출이 필요하며, 이 수정의 검증은 가짜 응답을 이용한 테스트·타입 검사·빌드로 수행했습니다.

참고: https://ai.google.dev/gemini-api/docs/generate-content/structured-output


## 영어 단어 자동 생성

「영어단어외우기」「영단어」「토익 단어」「영어 기초 동사」 등의 자동 생성 요청은 어휘 암기 형식을 우선한다. 앞면은 실제 영어 단어/숙어, 뒷면은 한국어 뜻과 품사, 해설은 예문과 번역을 요청한다. 일반 영어 문법 제목과 자료 추출 모드에는 이 분기를 적용하지 않는다. 참고 자료가 있으면 그 안의 어휘만 사용하도록 지시한다.

서버는 해당 요청의 영어 앞면·한국어 뜻 형식을 검사해 명백한 이론 질문을 VOCABULARY_FORMAT_INVALID로 거부한다. 잘못된 결과를 저장하거나 자동으로 추가 API 호출하지 않는다. 형식 검증이 모든 의미 오류를 검출하는 것은 아니다. 가짜 응답 기반 회귀 테스트와 전체 테스트 130개·타입 검사·빌드를 통과했으며 실제 Gemini 호출/과금은 하지 않았다. 이전에 저장된 결과는 자동 변경하지 않으므로 새 요청으로 확인해야 한다.
