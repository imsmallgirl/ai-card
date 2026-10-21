# 테스트 배포 준비 점검 — 2026-10-21

## 판정과 범위

로컬 빌드는 가능하지만 실제 사용자 대상 테스트 배포는 조건부 보류다. 운영 정보 확정, 배포 서버 인증/IAM 확인, Firestore 통합 테스트 및 실제 테스트 계정 삭제 검증이 남았다.

기존 코드·UI·설정·기존 미커밋 변경은 유지했다. 이 보고서만 추가했다. 실제 배포, 결제 활성화, IAM 변경, 키 생성, 실서비스 Gemini 호출 및 사용자 데이터 변경은 하지 않았다. 콘솔 접근 없이 저장소와 로컬 검사만 확인했으므로 실제 프로젝트의 IAM, 배포된 Rules/인덱스, 허용 도메인, API 키 제한, 과금 상태는 미확인이다.

## 실행 결과

| 검사 | 결과 |
| --- | --- |
| `npm run build` | 성공, Next.js 16.4.2, 정적 페이지 및 동적 API 생성 |
| `npm run typecheck` | 성공 |
| `npm test` | 137개 통과 |
| `npm run test:http` | 6개 통과. 최초 샌드박스 포트 제한 후 허용된 재실행으로 성공 |
| `npm run check:bundle` | 성공. 브라우저 파일 21개, 로컬 설정 비밀값 1개 대조 |
| `npm run check:release` | 실패: SITE_OPERATOR_NAME, SUPPORT_EMAIL, SITE_URL, PRIVACY_POLICY_CONFIRMED 미충족. AI 비활성화 경고 |
| `npm run test:firestore` | 실행 불가: Java 21 이상 필요, 사용 가능한 Java 런타임 없음 |
| 작업 트리 자격증명 패턴 검색 | 실제 키로 의심되는 패턴 0개, 예제 이외 추적된 env 파일 0개 |

번들 검사는 현재 설정된 일부 비밀값에 대한 대조다. Git 전체 과거 기록, 원격 저장소, 과거 배포, 외부 로그의 유출 부재까지 보증하지 않는다. 단위 테스트의 MODULE_TYPELESS_PACKAGE_JSON 경고는 있었으나 실패는 아니다.

## 배포 환경 비교와 추천

| 항목 | Vercel | Firebase App Hosting |
| --- | --- | --- |
| Next.js 배포 | Git 연결·Preview가 편리 | Git 연동, Cloud Run 기반, 프레임워크 어댑터 확인 필요 |
| 현재 Admin ADC 코드 | 외부 클라우드 인증 연결 필요 | 런타임 서비스 계정의 ADC 활용 가능 |
| 장기 비밀키 없는 인증 | OIDC + GCP Workload Identity Federation, 별도 연동 필요 | Google 관리 런타임 서비스 계정 사용 |
| 비용 | Hobby는 개인·비상업 용도 제한, 사업 목적이면 조건 확인 | Blaze 결제 연결 필요, 무료 할당량 초과 시 과금 |
| 운영 | Vercel과 Firebase 양쪽 관리 | Firebase/GCP 중심으로 관리 |

현재 코드 변경을 최소화하며 인증·Firestore·삭제까지 검증하려면 **Firebase App Hosting을 우선 추천**한다. 단, 결제 연결 승인 후에만 진행한다. 결제 연결을 원하지 않고 개인·비상업 테스트 조건을 충족하면 Vercel을 대안으로 선택하되 서버 ADC 연동 작업이 필요하다. 테스트 배포라는 이유만으로 Hobby 사용 자격이 자동으로 충족되지는 않는다.

설치된 Next.js 가이드는 Node 서버 배포를 지원한다. 이 서비스는 서버 API가 필수이므로 정적 export나 정적 Firebase Hosting 단독 배포는 맞지 않는다. App Hosting 문서는 Next.js 13.5 이상, Node 22 이상을 안내하지만 설치된 16.4.2의 실제 어댑터 빌드 성공까지 확인한 것은 아니다.

## package.json·Next.js·API

- `build`, `start`, `typecheck`, 단위/HTTP/Firestore 테스트 스크립트가 있다. Node 범위는 `>=22.14.0 <25`, `.nvmrc`는 24다. 배포도 Node 24로 맞추고 lockfile로 설치한다.
- `next.config.ts`는 보안 헤더 4개 및 poweredByHeader 비활성화를 설정한다. 타입 오류 무시, 정적 export, 비밀값을 노출하는 env 설정은 없다. CSP는 현재 없으며 추가한다면 Firebase 인증과 실제 브라우저 동작 검증이 필요하다.
- 서버 API는 Node 런타임이다. `/api/generate`, `/api/account`는 60초, study/export는 30초를 선언한다. 플랫폼에서 실제 적용되는 제한시간은 별도 확인해야 한다.
- 생성은 55초 abort 이후에도 Firestore 정산 작업이 남을 수 있어 60초 제한 근처의 종료·결과 복구를 테스트해야 한다. 계정 삭제의 재귀 삭제도 데이터량에 따라 60초를 넘을 수 있다.
- `requireUser`는 Bearer 토큰을 Admin SDK로 검증하고 폐기·삭제·비활성 사용자도 검사한다. UID는 검증한 토큰에서 가져온다. 관리자 비용 API는 `admin === true` custom claim을 추가로 요구한다.
- 개인 데이터 응답은 no-store이고 본문은 64KiB, 생성 자료는 15,000자·카드 20개로 제한한다. health는 프로세스 생존만 확인하며 Firebase/Gemini 정상 상태를 보증하지 않는다.
- 현재 변경 파일과 미추적 파일이 많다. 배포 커밋에 필요한 파일이 빠지지 않도록 검토하되 비밀파일은 포함하지 않는다.

## 배포 환경변수 목록 — 비밀값 제외

| 구분 | 변수 | 설정 기준 |
| --- | --- | --- |
| 공개 Firebase 웹 설정 | `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_APP_ID` | 같은 테스트 프로젝트의 Web 앱 설정. 빌드 전에 주입 |
| 서버 프로젝트 | `FIREBASE_PROJECT_ID` | 선택적 override지만 명시 권장. 공개 project ID와 일치 |
| 클라우드 저장 | `FIRESTORE_SYNC_ENABLED`, `NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED` | 인증·Rules 검증 후 둘 다 true |
| AI 제공자 | `AI_PROVIDER`, `GEMINI_MODEL` | gemini 및 접근 가능한 정확한 모델 ID. 예제 기본은 gemini-3.1-flash-lite, 실제 접근은 미검증 |
| AI 비밀키 | `GEMINI_API_KEY` | AI 활성화 시 서버 secret에만 저장 |
| AI 제어 | `AI_GENERATION_ENABLED`, `AI_GENERATION_UNLIMITED` | 최초 false/false, 한도 검토 후 enabled만 true |
| 사용량 한도 | `AI_DAILY_LIMIT`, `AI_GLOBAL_DAILY_ATTEMPTS`, `AI_GLOBAL_DAILY_TOKEN_BUDGET` | 기본 3, 100, 2000000. 마지막 값은 금액 한도가 아님 |
| 출력·재시도 간격 | `AI_MAX_OUTPUT_TOKENS`, `AI_COOLDOWN_SECONDS`, `AI_FAILURE_COOLDOWN_SECONDS` | 기본 8192, 5, 30. 소규모 테스트는 더 보수적으로 조정 가능 |
| 공개 운영 정보 | `SITE_URL`, `SITE_OPERATOR_NAME`, `SUPPORT_EMAIL`, `PRIVACY_POLICY_CONFIRMED` | HTTPS origin, 실제 운영자/연락처. 정책 확인 후에만 true |
| 선택적 분석 | `NEXT_PUBLIC_ANALYTICS_ENABLED`, `ANALYTICS_ENABLED`, `ANALYTICS_EXPORT_ENABLED` | 첫 테스트는 모두 false 권장 |
| GA4 선택 설정 | `GA4_MEASUREMENT_ID`, `GA4_API_SECRET` | 분석 전송 사용 시에만. API_SECRET은 서버 secret |
| 외부 ADC | `GOOGLE_APPLICATION_CREDENTIALS` | 외부 환경에서 필요한 경우 서버의 실제 credential config 파일 경로. JSON 문자열을 넣는 변수가 아님 |

`NEXT_PUBLIC_*`는 브라우저에 공개되며 빌드 시 고정된다. Firebase 웹 API 키 공개 자체는 Admin 권한 노출이 아니다. Gemini/서비스 계정 키에는 공개 접두사를 사용하면 안 된다. `/privacy`, sitemap 등은 이번 빌드에서 정적 생성되므로 운영 정보도 빌드 전에 설정하고 변경 후 재빌드한다.

배포에는 `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, 로컬 credential 경로를 복사하지 않는다. App Hosting에서는 런타임 ADC 사용 시 GOOGLE_APPLICATION_CREDENTIALS가 필요 없다. `apphosting.example.yaml`은 템플릿이며 실제 배포 설정이 아니다. GEMINI_API_KEY secret 연결은 주석 상태다.

## Admin 인증·Firestore IAM·데이터 접근

현재 `src/lib/server/firestore-database.ts`는 `applicationDefault()`를 사용한다. FIREBASE_PRIVATE_KEY나 FIREBASE_SERVICE_ACCOUNT_JSON 환경변수를 추가하는 것만으로 이 코드가 이를 읽지는 않는다.

1. App Hosting: 실제 런타임 서비스 계정을 확인하고 관리형 ADC를 사용한다. 개인용 JSON 키 업로드는 피한다.
2. Vercel: OIDC → GCP Workload Identity Federation → 서비스 계정 impersonation 방식이 우선이다. 신뢰 조건을 팀·프로젝트·환경으로 제한하고 untrusted Preview에 운영 접근을 주지 않는다. 현재 코드는 Vercel OIDC 교환을 구현하지 않았으므로 연동을 검증해야 한다.
3. 기존 JSON 키를 사용하는 대안은 서버 전용 안전한 저장/파일 주입과 회전 절차가 필요하다. 저장소나 브라우저에 넣지 않는다. 이번에는 생성하지 않았다.

실제 IAM은 콘솔에서 확인해야 한다. 런타임에는 Firestore 데이터 읽기/쓰기/삭제가 필요하므로 `roles/datastore.user`를 검토하고, Auth는 `firebaseauth.users.get` 및 `firebaseauth.users.delete`가 필요하다. 가능하면 필요한 권한의 custom role을 검토한다. `roles/firebaseauth.admin`은 더 넓으므로 범위를 이해하고 선택한다. Owner/Editor를 편의상 부여하지 않는다. Secret 접근은 필요한 secret에만 제한한다. 배포 계정의 빌드/배포 권한과 런타임 권한을 구분한다.

로컬 `firestore.rules`는 본인 UID 아래 6개 컬렉션의 읽기만 허용하고 모든 클라이언트 쓰기, 타 사용자, serviceUsage 및 내부 메타데이터 접근을 거부한다. 삭제 잠금도 확인한다. **Admin SDK는 Rules를 우회하므로 서버 UID 격리와 IAM이 실제 보호 장치다.** Firestore IAM은 사용자별 문서 소유권 검사를 대신하지 않는다.

서버 저장 명령은 삭제 상태를 트랜잭션에서 확인한다. 다만 study GET의 revision/page는 삭제 상태 확인이 없어 삭제 중 일부 데이터를 소유자가 잠시 읽을 수 있다. 타인 접근 문제는 아니지만 즉시 읽기 차단이 요구되면 보완해야 한다.

인덱스 파일에는 복합 인덱스가 없고 큰 텍스트 필드의 색인 제외가 있다. 실제 환경의 동기화·분석 쿼리가 요구하는 인덱스를 확인한다. Emulator 성공만으로 운영 인덱스 준비를 보증하지 않는다. 저장소의 Rules/인덱스와 콘솔에 적용된 상태가 같은지도 확인해야 한다.

## Gemini 노출·남용 방지

키는 서버 환경에서 읽어 고정 Gemini endpoint의 `x-goog-api-key` 헤더로 전송한다. 확인한 브라우저 번들/작업 트리에 서버 키 노출 증거는 없다. 현재 구현은 인증, 사용자별 일일 한도, cooldown, 계정당 생성 lock, idempotency, 전역 일일 호출·입장 예산, 입력/출력 크기 제한, 출력 스키마 검사, fail-closed 저장소 오류 처리, AI kill switch를 갖췄다. 여러 서버에서도 Firestore 트랜잭션으로 한도를 공유한다.

미구현/잔여 위험:

- 테스트 사용자 allowlist, App Check 토큰 검증, IP별 요청 제한은 없다. 도메인 등록은 테스트 사용자 접근 제한이 아니다.
- 유효한 Google 계정을 가진 사람이 API를 반복 호출하면 인증/Firestore 비용이 발생할 수 있다. 생성 한도가 일반 학습/조회 API 비용을 제한하지는 않는다.
- 무료 Google 계정을 여러 개 만드는 공격은 UID별 한도를 우회할 수 있다. 공개 테스트 전에 allowlist 또는 배포 접근 보호를 검토한다.
- 토큰 예산은 보수적 추정 단위이며 실제 청구 금액 상한이 아니다. provider quota·실제 요금제·키 제한·모델 접근을 콘솔에서 확인한다. 예산 알림도 자동 결제 차단 장치로 간주하지 않는다.
- Gemini 키의 현재 제한·차단 상태는 AI Studio에서 확인한다. 노출이 확인되면 승인 후 폐기·교체한다. 이번 점검에서는 유료 API 호출을 하지 않았다.

## 계정 삭제 판정

`/api/account`는 최근 5분 내 Google 재인증, 명시적 삭제 확인, 검증한 UID를 요구한다. `deleteOwnAccount`는 삭제 잠금 → users/UID 아래 account 외 컬렉션 재귀 삭제 → account 내부 status 외 문서 삭제 → 루트 문서 삭제 → status 보존 → Auth deleteUser 순서다. Auth user-not-found는 성공으로 처리한다. 실패 후 재시도 가능하며 다른 UID 데이터는 건드리지 않도록 구성되어 있다.

**Auth와 개인 Firestore 데이터를 삭제하는 구현은 있으나 완전 삭제를 실환경에서 검증한 상태는 아니다.** Firestore 테스트는 Auth 삭제 함수를 mock하므로 실제 Auth 사용자 삭제는 별도 검증해야 한다. 주의할 점은 다음과 같다.

- `users/UID/account/status`는 UID 경로와 삭제 시각을 보존한다. 익명 정보라고 단정하면 안 된다. cleanupAfter는 숫자 필드이며 TTL/스케줄러가 연결되지 않아 30일 후 자동 삭제되지 않는다.
- dataDeletedAt/cleanupAfter가 Auth 삭제 성공 전에 기록된다. 운영자는 이 필드만 보고 Auth 삭제 성공으로 판단하면 안 된다.
- 삭제는 두 서비스 간 원자적 작업이 아니다. Auth 삭제 실패 시 Firestore 자료는 이미 삭제되어 있고 계정 잠금이 남는다. 재시도·운영 복구 절차가 필요하다.
- 대량 계정은 60초 제한으로 중단될 수 있다. 소량·대량·실패 재시도·동시 저장 테스트 후 필요하면 비동기 삭제 작업을 설계한다.
- 현재 브라우저 정리는 서버 성공 후 signOut 다음 실행된다. signOut 실패나 네트워크 응답 유실이면 캐시 정리가 누락될 수 있다. 다른 기기의 로컬 데이터는 원격 삭제하지 않는다.
- 서비스 집계는 유지된다. 호스팅 로그·백업·이미 외부 전송한 분석 데이터는 이 함수로 삭제되지 않는다. 실제 수집 범위와 별도 삭제/보관 절차를 정책에 반영한다.

## 운영 정보 확정

`/privacy`, `/privacy/analytics`, `/terms`, `/about`가 존재한다. 개인정보 페이지는 운영자/문의 환경변수를 사용하고 이용 안내는 계속 초안으로 표시된다. PRIVACY_POLICY_CONFIRMED=true만으로 약관 내용이 완성되지는 않는다.

테스트 사용자 초대 전에 운영자명, 실제 수신 가능한 문의 이메일, 적용일/개정일, 수집 항목과 목적, 보관 기간, 탈퇴·삭제 요청 방법, 덱 삭제와 영구 삭제의 차이, 삭제 잠금의 보관/정리, 로컬 데이터와 백업/로그 보관, Firebase/Gemini 위탁·국외 처리 관련 고지, 선택 분석 동의/철회를 실제 운영에 맞게 확정한다. 이용약관에는 테스트 서비스의 범위, 중단·데이터 보존 정책, AI 오류, 입력 자료 권리, 남용 제한, 계정 삭제·문의, 미성년 이용 기준 등을 정한다. 이는 코드 점검 목록이며 법적 적합성 확정을 대신하지 않는다. 확정된 보관 기간이나 국외 처리 국가를 추측하여 기재하지 않는다.

## 초보자를 위한 진행 순서

아래는 앞으로 할 일이며 이번에 실행하지 않았다. 배포·결제·IAM·키 생성은 사용자 승인 후 진행한다.

1. 개인 테스트인지 사업 목적 테스트인지, 초대할 사용자와 비용 허용 여부를 정한다. App Hosting을 우선 검토하고 결제를 허용하지 않으면 Vercel 조건과 인증 작업을 검토한다.
2. 기존 Firebase 프로젝트가 테스트용인지 확인한다. 가능하면 운영 데이터와 분리할 프로젝트 계획을 세운다. 프로젝트 ID를 메모하되 비밀값은 문서에 적지 않는다.
3. 운영자명·문의 이메일·개인정보/약관·보관 정책을 확정한다. 공개 테스트 접근 제한과 실패한 삭제 문의 처리 방법도 정한다.
4. 승인 후 Java 21 이상을 준비하고 `npm run test:firestore`를 재실행한다. 테스트는 demo-moa-study 에뮬레이터 전용이다. 실제 프로젝트로 대체하지 않는다.
5. 콘솔에서 Google 로그인 제공자, Firestore database 위치/상태, 현재 Rules, IAM, Gemini quota/키 제한을 읽기 확인한다. 변경할 권한 목록과 배포 대상 프로젝트를 다시 검토한다.
6. 인증 방식을 준비한다. App Hosting이면 런타임 ADC와 최소 권한, Vercel이면 OIDC 연동과 서비스 계정 impersonation을 승인 후 설정한다. 키 생성은 별도 승인 없이 하지 않는다.
7. 승인 후 테스트 프로젝트에 Rules/인덱스를 적용한다. CLI 사용 시 `npx firebase deploy --only firestore:rules,firestore:indexes --project <테스트_프로젝트_ID>`처럼 프로젝트를 명시한다. 이 명령은 원격 정책을 변경하므로 현재 실행하지 않았다.
8. 호스팅을 설정한다. App Hosting은 승인 후 Blaze 연결, Git 저장소/브랜치 및 가까운 지원 리전 선택, 템플릿을 실제 apphosting.yaml로 준비한다. 백엔드 생성·Git 연결이 자동 rollout을 유발할 수 있으므로 배포 승인 후 진행한다. Vercel은 승인 후 Next.js/Node 24, Build `npm run build`, root 저장소 루트를 선택하고 최초 Import가 배포임을 주의한다.
9. 위 표의 환경변수를 Preview/테스트 환경에 설정한다. 공개 변수와 운영 정보는 build에도 제공한다. AI는 우선 비활성화하고 분석은 모두 false, unlimited는 false로 둔다. 필요한 기존 키는 서버 secret으로 연결한다.
10. `npm run build`, `npm run typecheck`, `npm test`, `npm run test:http`, `npm run check:bundle`, `npm run check:release`를 실행한다. 실제 테스트 환경 설정으로 release 검사가 통과해야 한다. 사용하지 않는 로컬 비밀파일은 Git에 넣지 않는다.
11. 승인 후 최초 테스트 배포를 실행한다. 생성된 HTTPS 주소의 hostname을 확인한다. SITE_URL이 달라졌으면 수정 후 재빌드한다.
12. Firebase Console → Authentication → Settings → Authorized domains → Add domain에서 배포 hostname만 등록한다. 예: `<앱>.vercel.app`. `https://`, 경로, 와일드카드는 넣지 않는다. 고정 테스트 도메인 사용을 권장하며 새 Preview hostname은 별도 등록이 필요할 수 있다. Sign-in method의 Google 제공자와 지원 이메일도 확인한다.
13. 기본 authDomain은 Firebase Web 설정값을 유지한다. 커스텀 authDomain을 의도적으로 쓰는 경우 Firebase 인증 도메인 구성과 OAuth redirect URI `https://<authDomain>/__/auth/handler`를 함께 설정한다. 배포 도메인을 승인 목록에 추가하는 것만으로 authDomain을 바꿀 필요는 없다.
14. 전용 테스트 계정 2개로 로그인/로그아웃, 저장/새로고침/다른 기기 동기화, 타 계정 격리, 계정 삭제, Auth 목록 제거, Firestore 하위 컬렉션 제거 및 남은 status만 존재함을 확인한다. 삭제 재시도와 로컬 캐시 정리도 확인한다.
15. 모델·quota·비용 및 키 제한 승인 후 AI를 활성화하고 실제 호출 최소 1회, 중복 요청, 한도 초과, 타임아웃 복구를 확인한다. 미승인 상태에서는 키 생성/과금 연결/실제 호출을 하지 않는다.
16. 제한된 테스터에게 주소를 전달하고 오류 로그/사용량을 관찰한다. 이상 발생 시 AI_GENERATION_ENABLED=false로 중단하고 재배포 여부를 확인한다. 삭제 상태 30일 정리는 Auth 삭제 완료·진행 중 요청 종료를 확인한 운영 절차로 관리한다.

## 공식 자료

- [App Hosting 시작 및 결제 조건](https://firebase.google.com/docs/app-hosting/get-started), [비용](https://firebase.google.com/docs/app-hosting/costs), [지원 프레임워크/런타임](https://firebase.google.com/docs/app-hosting/frameworks-tooling)
- [Firebase Admin SDK와 Google 환경 ADC](https://firebase.google.com/docs/admin/setup)
- [Vercel Hobby 조건](https://vercel.com/docs/plans/hobby), [Vercel OIDC와 GCP](https://vercel.com/docs/oidc/gcp)
- [Firestore IAM](https://firebase.google.com/docs/firestore/security/iam), [Auth IAM 권한](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth)
- [Google 로그인과 커스텀 인증 도메인](https://firebase.google.com/docs/auth/web/google-signin)
- [Gemini API 키 보안 및 현재 키 정책](https://ai.google.dev/gemini-api/docs/api-key)

공식 문서는 점검 당시 확인했다. 실제 배포 시점의 지원 버전·요금·quota를 다시 확인한다.
