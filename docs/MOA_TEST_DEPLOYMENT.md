# moa-web 첫 테스트 배포 점검

점검일: 2026-10-21. 이 문서는 준비 결과이며 배포 완료 기록이 아니다.

## 대상과 설정

- Firebase 프로젝트: `ai-card-92a13`, 백엔드: `moa-web`, 리전: `asia-east1`.
- 예정 URL: `https://moa-web--ai-card-92a13.asia-east1.hosted.app`.
- 저장소: `https://github.com/imsmallgirl/ai-card`, 현재 브랜치: `main`, 앱 루트: `.`.
- `apphosting.yaml`에 공개 Firebase 설정과 SITE_URL을 구성했다. 로컬 비밀값을 복사하지 않았다.
- AI 생성·무제한 생성·분석 수집·외부 분석 전송은 비활성화 상태다. Secret 참조는 없다.
- Firestore 동기화는 서버와 브라우저 모두 활성화했다. 서비스 계정 키 파일과 에뮬레이터 설정을 배포하지 않는다.
- 인스턴스 0~2, CPU 1, 메모리 512MiB, 동시 처리 20이다.
- 런타임 서비스 계정은 `firebase-app-hosting-compute@ai-card-92a13.iam.gserviceaccount.com`이다.

## 읽기 전용 클라우드 점검

기존 프로젝트 IAM의 조건 없는 역할 바인딩과 역할에 포함된 권한을 조회했다. `roles/firebase.sdkAdminServiceAgent`, `roles/firebaseapphosting.computeRunner`, `roles/developerconnect.readTokenAccessor`, `roles/storage.objectViewer`가 부여되어 있다. Firestore 엔티티 조회·목록·생성·수정·삭제, 데이터베이스 조회 및 Auth 사용자 조회·삭제 권한이 포함되어 있다. 추가 IAM 변경은 수행하지 않았다. 실제 배포 런타임에서의 인증 및 데이터 접근 성공은 배포 후 검증해야 한다.

기본 Firestore DB는 Native 모드이며 `asia-northeast3`에 있다. 백엔드 리전과 달라 실제 응답 지연을 테스트해야 한다. 데이터베이스 이동이나 결제 변경은 하지 않았다.

Google 로그인 공급자는 활성화되어 있다. Auth 승인 도메인에는 localhost와 기존 Firebase 도메인만 있으며, 위 hosted.app 도메인은 없다. 로그인 테스트 전에 해당 도메인 추가가 필요하다. 이 점검에서는 Auth 설정을 변경하지 않았다.

백엔드의 codebase는 비어 있고 `asia-east1`의 Developer Connect 연결도 없다. 따라서 GitHub push만으로 이 백엔드가 배포되는 상태가 아니다. GitHub 연결 생성 절차는 Developer Connect 서비스 에이전트에 Secret Manager Admin 역할을 요구할 수 있다. 추가 IAM·Secret 생성 승인을 받기 전에는 연결 생성 절차를 실행하지 않는다.

## 로컬 검증

- `npm test`: 137/137 통과.
- `npm run typecheck`: 통과.
- `npm run build`: 통과. YAML 환경변수를 주입하고 로컬 env 값과 Gemini 비밀키를 비워 검증했다. 원본 env 파일은 변경하지 않았다.
- `npm run check:bundle`: 통과. 로컬 Gemini 키가 브라우저 번들에 포함되지 않았으며 값은 출력하지 않았다.
- `npm run test:http`: 6/6 통과. 최초 샌드박스 실행의 포트 차단 후 허용된 실행으로 재검증했다.
- YAML을 대상으로 공개 출시 설정 검사를 실행했다. 운영자명·지원 이메일 미설정, 개인정보 정책 검토 미완료가 남아 있다. AI 비활성화 경고는 의도한 설정이다. 공개 출시 검사 전체 통과 상태는 아니다.

현재 Next.js 16.4.2 / Node 24.16.0 로컬 빌드는 성공했다. App Hosting 어댑터와 Cloud Build는 아직 실행하지 않았다. 공식 지원 문서는 새 프레임워크 버전에 대한 지원이 즉시 활성화되는 것은 아니라고 안내하므로, 첫 클라우드 빌드에서 호환성을 확인해야 한다.

## 승인 후 실행 순서

1. 준비한 로컬 커밋과 GitHub 대상 브랜치를 검토한 뒤 실제 push 승인을 받는다. push 전에 원격 HEAD를 다시 확인한다.
2. GitHub 연동 방식을 사용할 경우 필요한 IAM·Secret 작업을 구체적으로 확인하고 별도 승인을 받는다. 자동 rollout을 비활성화한 상태에서 저장소와 백엔드를 연결한다. 연결을 생략하는 CLI 소스 배포 경로도 가능하지만 별도 rollout 승인이 필요하다.
3. Auth에 테스트 URL 도메인을 추가한다. 운영자·연락처·정책 검토 미완료 상태는 제한된 테스트 범위로 유지한다. App Hosting URL 자체에 접근 제한이 설정된 것으로 간주하지 않는다.
4. 실제 rollout 직전에 대상 프로젝트·백엔드·리전·커밋과 Gemini 비활성화를 다시 제시하고 승인을 받는다. Firestore 규칙/인덱스는 이 웹 배포에 함께 배포하지 않는다.
5. 승인된 배포 후 `/api/health`, Google 로그인, 저장·재로그인·목표 변경을 점검한다. 계정 삭제는 별도 테스트 계정으로만 검증한다. Gemini 요청이 비활성화되어 있는지 확인한다.

실제 push·rollout, 추가 IAM 변경, Secret 생성, 결제 변경은 이 준비 작업에서 실행하지 않았다.

공식 참고: [App Hosting 설정](https://firebase.google.com/docs/app-hosting/configure), [프레임워크·런타임 지원](https://firebase.google.com/docs/app-hosting/frameworks-tooling).
