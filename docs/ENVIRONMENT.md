# 환경변수와 서버 인증

실제 비밀값은 호스팅의 Secret/환경변수 관리에 입력한다. `.env.example`은 설명/빈 값만 포함한다. `.env.local`을 복사로 덮어쓰거나 인증 JSON을 Git에 넣지 않는다.

| 변수 | 범위 | 운영 기준 |
|---|---|---|
| NEXT_PUBLIC_FIREBASE_API_KEY / AUTH_DOMAIN / PROJECT_ID / APP_ID | 빌드·브라우저 공개 | Firebase 웹앱 설정. API 키는 웹 설정용 공개 식별자이며 서버 비밀키와 다름. 승인 도메인/API 제한 검토 |
| FIREBASE_PROJECT_ID | 서버 | 브라우저 프로젝트와 일치. 생략 시 공개 project ID 사용 |
| NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED | 빌드·브라우저 | 1차 클라우드 MVP는 true |
| FIRESTORE_SYNC_ENABLED | 서버 | 위 플래그와 함께 true |
| AI_PROVIDER | 서버 | gemini. mock은 로컬 development만 허용 |
| GEMINI_API_KEY | 서버 Secret | AI 활성화 시 필요. 클라이언트 금지 |
| GEMINI_MODEL | 서버 | 기본 gemini-3.1-flash-lite. 실제 사용 가능한 정확한 모델 ID 확인. 무료 티어 여부는 프로젝트/모델별 별도 확인 |
| AI_GENERATION_ENABLED | 서버 | 기본 false. 한도/결제 확인 후 true. false여도 규칙 추출/수동 생성/복습 가능 |
| AI_DAILY_LIMIT | 서버 | 기본 UID당 UTC 하루3회, 0~1000 |
| AI_GLOBAL_DAILY_ATTEMPTS | 서버 | 기본100회. 재시도를 포함한 실제 공급자 시도 상한 |
| AI_GLOBAL_DAILY_TOKEN_BUDGET | 서버 | 기본2000000 admission units. 입력 바이트+출력 상한+여유량을 사용하며 실제 토큰/통화 청구 상한과 다름 |
| AI_MAX_OUTPUT_TOKENS | 서버 | 기본8192, 허용256~16384. 공급자 모델 제한도 충족해야 함 |
| AI_COOLDOWN_SECONDS / AI_FAILURE_COOLDOWN_SECONDS | 서버 | 기본5/30초, 허용0~3600 |
| AI_GENERATION_UNLIMITED | 서버 | 운영 false. 로컬 개발 override는 유지, 호스팅에서는 차단 |
| NEXT_PUBLIC_ANALYTICS_ENABLED / ANALYTICS_ENABLED / ANALYTICS_EXPORT_ENABLED | 공개·서버 | 1차 MVP 권장값 모두 false. 서로 다른 역할이며 실제 외부 수집은 따로 검토 |
| GA4_MEASUREMENT_ID / GA4_API_SECRET | 서버 | 외부 분석 전송을 승인해 구성할 때만 필요. Secret은 공개 금지 |
| SITE_URL | 빌드·서버 | 경로/쿼리가 없는 운영 HTTPS origin. canonical/sitemap에 사용 |
| SITE_OPERATOR_NAME / SUPPORT_EMAIL | 빌드·서버 렌더링 공개 | 실제 운영자·문의 이메일. 개인정보 페이지 표시 |
| PRIVACY_POLICY_CONFIRMED | 빌드·서버 | 기본false. 실제 처리·보관·삭제·제공자 로그 정책을 검토한 후 true. 설정만으로 법적 검토가 완료되지는 않음 |
| GOOGLE_APPLICATION_CREDENTIALS | 서버 로컬/WIF | 인증 파일 경로. 파일의 실제 존재·IAM 필요. macOS 경로를 운영에 그대로 넣으면 안 됨 |
| FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST | 테스트 전용 | 운영 미설정 |

`NEXT_PUBLIC_FIREBASE_*`의 표는 접두어를 공통으로 생략해 썼다. 예: AUTH_DOMAIN은 NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN이다.

## 인증 변경

서버는 토큰 서명뿐 아니라 `verifyIdToken(token, true)`로 계정 삭제·비활성화·토큰 폐기도 확인한다. 따라서 로그인된 API 요청에도 런타임 ADC와 Firebase Auth 사용자 조회 IAM이 필요하다. 로컬 ADC가 없는 경우 서버 인증 설정 오류가 발생할 수 있다. 서비스 계정 비밀키를 자동 생성하거나 기존 환경변수를 변경하지 않았다.

## 검사

- `npm run check:release`: 생산 환경변수 정적 검사. 개발 전용 .env.development.local은 읽지 않는다.
- `npm run check:bundle`: 빌드의 .next/static에서 설정된 서버 Secret 값이 포함되는지 확인. 값은 출력하지 않는다. 설정된 키만 대상으로 한 검사이며 모든 정보 유출을 증명하는 도구는 아니다.
- `npm run check:release`가 실패하면 메시지에 표시된 설정을 수정하고 재빌드한다. 서버 IAM/승인 도메인/실제 Gemini 호출은 따로 확인한다.
- 빌드 환경의 NODE_ENV는 호스팅이 production으로 관리하도록 하고 직접 development를 지정하지 않는다.
