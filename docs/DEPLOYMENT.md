# 1차 MVP 배포 가이드

2026-10-21. 실제 배포·IAM 변경·비밀키 생성·과금 활성화는 수행하지 않았다. 배포 대상은 아직 선택되지 않아 App Hosting과 Vercel 경로를 구분한다. 공유 기능은 포함하지 않는다.

## 먼저 확인할 것

- 이 앱은 정적 사이트가 아니다. Next.js 서버, Firebase Admin SDK, `/api/*`가 필요하다. `output: export` 또는 `.next`를 Firebase Hosting 정적 폴더로 업로드하는 방식은 사용할 수 없다.
- `firebase.json`은 Firestore 규칙·인덱스와 로컬 에뮬레이터 설정만 갖는다. 이것만으로 웹앱이 배포되지는 않는다.
- 로컬 macOS의 gcloud ADC 파일은 배포 서버로 전달되지 않는다. 운영 서버에 별도의 ADC/IAM이 필요하다.
- 현재 검증 버전은 Node 24.16.0, Next 16.4.2, React 19.3.1이다. package/lock에 설치된 버전을 고정했다. 의도치 않은 메이저 업데이트 없이 `npm ci`를 사용한다. Node 22.14~24를 허용하지만 이번 실제 검증은 24에서 수행했다.
- 초기에는 테스트용 Firebase 프로젝트/계정으로 비공개 배포한다. Google 로그인 승인 도메인에 배포 도메인을 추가한다. 도메인이 정해지면 환경변수 문서의 SITE_URL도 설정한다.

## 공통 준비와 확인 순서

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run check:bundle
npm run test:http
npm run check:release
```

`check:release`는 운영 환경 우선순위로 `.env.production.local`, `.env.local`, `.env.production`, `.env`를 읽고 정적 설정만 검사한다. 기존 파일을 덮어쓰지 않는다. 호스팅 콘솔에서는 배포에 주입될 값으로 실행한다. 통과가 IAM·정책 적법성·실제 모델 접근·로그인 성공을 보증하지 않는다. 출력에는 비밀값이 없다.

Firestore를 배포할 때는 대상을 직접 확인하고 다음 명령을 **사용자가** 실행한다. 기존 프로젝트의 규칙/인덱스 설정과 비교하고 필요 시 백업한다. 이 명령은 운영 설정을 바꾼다.

```sh
npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
```

로컬 규칙 검증은 실제 프로젝트 대신 `npm run test:firestore`로 수행한다. Java 21+, 포트8787이 필요하다.

## Firebase App Hosting

Firebase와 실행 환경을 함께 관리하고 기본 서비스 계정 ADC를 이용하는 경로다. **Blaze 결제 플랜이 필요하고 Cloud Run/빌드/저장소 등에 비용이 발생할 수 있다.** 무료 운영을 보장하지 않는다. 예산 알림과 인스턴스 수 제한을 먼저 검토한다. 이 저장소에서는 결제를 활성화하지 않았다.

1. Firebase Console에서 테스트 프로젝트의 App Hosting 백엔드를 생성하고 GitHub 저장소·브랜치·루트 폴더를 선택한다. 자동 배포 여부를 직접 선택한다.
2. 선택한 백엔드가 현재 Next/Node 버전을 지원하는지 공식 지원표와 콘솔에서 확인한다. 이번 검증은 로컬 Next 빌드이며 App Hosting 어댑터 빌드까지 검증한 것은 아니다.
3. `apphosting.example.yaml`을 검토하고 모든 YOUR_ 값을 실제 공개 설정으로 교체한 뒤 `apphosting.yaml`로 복사한다. 예시는 minInstances0/maxInstances2이며 실제 부하·비용에 맞춰 조정한다. 현재 파일 자체는 활성 배포 설정이 아니다.
4. 백엔드의 Secret Manager에 GEMINI_API_KEY를 직접 등록하고 RUNTIME에만 주입한다. NEXT_PUBLIC_*와 SITE_URL/정책 표시값은 빌드 시에도 필요하다. Firebase Console 환경변수가 YAML보다 우선한다.
5. 런타임 서비스 계정에 해당 프로젝트의 Firestore 데이터 접근 권한과 Firebase Auth 사용자 조회/삭제 권한을 부여한다. 보통 Firestore는 `roles/datastore.user`, Auth는 최소 `firebaseauth.users.get`/`firebaseauth.users.delete` 권한을 포함한 역할이 필요하다. Editor/Owner 전체 권한을 앱 런타임에 주지 않는다. 실제 IAM 정책은 관리자가 검토한다.
6. 운영에는 GOOGLE_APPLICATION_CREDENTIALS의 로컬 파일 경로나 에뮬레이터 환경변수를 넣지 않는다. 서비스 계정 비밀키를 생성하지 않고 실행 환경 ADC를 사용한다.
7. 첫 배포 후 `/api/health`, 로그인, 자료 추출/저장/재로그인/목표 변경을 확인한다. AI를 활성화하려면 요금제/무료 할당량·키·한도를 확인한 뒤 별도로 설정한다.
8. 테스트 계정 하나에서만 삭제 흐름을 실행해 Auth 계정·개인 컬렉션·브라우저 캐시 삭제를 확인한다. 운영자 본계정으로 삭제 테스트하지 않는다.

공식 근거: [백엔드/환경변수/Secret 설정](https://firebase.google.com/docs/app-hosting/configure), [비용](https://firebase.google.com/docs/app-hosting/costs), [프레임워크 지원](https://firebase.google.com/docs/app-hosting/frameworks-tooling).

## Vercel + Firebase

Next.js 웹앱은 Vercel, 데이터/인증은 Firebase에 둔다. 정적 export가 아니라 Next.js 프레임워크로 배포한다.

1. Node24, `npm ci`, `npm run build`를 사용하고 Preview와 Production의 Firebase 프로젝트/환경변수를 구분한다.
2. `.env.local`이나 gcloud 사용자 ADC 파일을 업로드하지 않는다. 현재 서버 코드는 `applicationDefault()`를 사용하므로 Vercel에 Firebase 웹 설정만 넣는 것으로 Firestore가 연결되지는 않는다.
3. Google Cloud Workload Identity Federation과 Vercel OIDC를 설정하고, Google 인증 라이브러리가 읽을 수 있는 외부 계정 ADC 구성을 서버에 연결해야 한다. 이 통합은 이번에 활성화/실서비스 검증하지 않았다. OIDC 토큰/서비스 계정 private key를 NEXT_PUBLIC_*에 넣지 않는다. 서비스 계정 JSON을 단순히 환경변수 문자열에 넣는 기능은 현재 코드에 없다.
4. Firebase Auth 사용자 조회/삭제와 Firestore에 필요한 런타임 IAM을 확인한다. 인증·스토리지 연결까지 구성하지 못했다면 App Hosting 경로와 비교한다.
5. `/api/generate`와 `/api/account`는 maxDuration60초다. 선택한 Vercel 플랜의 실제 함수 시간 제한을 확인한다. 프론트엔드 타임아웃이 서버 실행 시간을 늘려주지는 않는다.
6. Preview/Production 도메인을 Firebase 승인 도메인에 등록하고 NEXT_PUBLIC_* 변경 시 재빌드한다.

공식 근거: [Vercel의 Google Cloud OIDC](https://vercel.com/docs/oidc/gcp), [Google Workload Identity Federation](https://docs.cloud.google.com/iam/docs/workload-identity-federation).

## 롤백과 운영

- 웹앱은 직전 배포로 되돌린다. 이번 선택 필드는 기존 기록과 호환되지만 구버전 UI가 새 완료 기록을 오답처럼 계산할 수 있으므로 완료 통계를 지원하는 빌드를 기준으로 롤백한다.
- 장애 시 `AI_GENERATION_ENABLED=false`로 새 호출을 멈춘다. 모델/키/동기화 공개 플래그 변경은 새 빌드/배포가 필요할 수 있다. 이미 전송한 요청의 비용은 취소되지 않는다.
- 로그의 app_error/area/code/id와 HTTP 5xx를 확인한다. 입력 원문/토큰/키를 로그에 추가하지 않는다.
- 실제 비용은 Google AI Studio/Cloud Billing에서 확인한다. 앱의 admission budget은 통화 단위 지출 상한이 아니다.
- 고객 테스트 전 [출시 체크리스트](RELEASE_CHECKLIST.md)를 완료한다.
