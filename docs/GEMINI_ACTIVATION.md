# moa-web Gemini 활성화 준비

대상: `ai-card-92a13` / `moa-web` / `asia-east1`.

Secret 등록과 최소 IAM 설정은 승인 후 완료했다. 앱 변경은 배포 준비 상태이며, 배포 서버의 AI 활성화가 완료된 상태가 아니다. 이전 잠금/계정 정리 수정은 그대로 보존했다. rollout은 별도 승인이 필요하다.

## 모델·API 확인

- 현재 로컬 키로 v1beta 모델 목록 및 `models/gemini-3.1-flash-lite` 메타데이터 조회 성공. `generateContent` 지원 확인.
- 안정 ID `gemini-3.1-flash-lite`와 REST `v1beta`를 유지한다. preview와 latest 별칭을 사용하지 않는다.
- 공식 문서상 3.1 Flash-Lite는 stable이며, 표준 텍스트 단가는 입력 $0.25/100만 토큰, 출력 $1.50/100만 토큰이다. 2.5 Flash-Lite는 더 저렴하지만 기존 사용자 중심 접근 제한 안내가 있어 선택하지 않았다.
- 실제 앱 요청 body로 카드 1장, 최대 출력 1024토큰 테스트가 HTTP 200, STOP으로 완료되고 카드 스키마 검증에 통과했다. 입력 219·출력 122·총 341토큰. 별도 첫 요청은 완료 응답을 받지 못했으며 사용량/비용을 확정할 수 없다. 추가 생성 호출은 하지 않았다.
- 이 직접 API 검사는 실제 배포 서버나 Firestore 자동 저장 성공을 의미하지 않는다.

## 로컬 변경

- `apphosting.yaml`: `AI_GENERATION_ENABLED=true`, `GEMINI_API_KEY` → `moa-gemini-api-key` Secret, RUNTIME 한정 참조.
- `AI_DAILY_LIMIT=3`, `AI_GENERATION_UNLIMITED=false`, Firestore 동기화·기존 전체 서비스 한도 유지.
- 요청 URL에 API 버전 상수를 사용하고, models/ 접두사 정규화와 키가 URL/body에 들어가지 않는 회귀 테스트 추가.
- 기존 키 오류·404 모델/API 버전 오류·할당량·결제·일시적 서버 오류의 안전한 원인 코드와 사용자 안내를 유지한다. 원본 provider 메시지나 키를 사용자에게 그대로 반환하지 않는다.
- `npm run check:gemini`: 메타데이터만 조회하는 사전 점검. `-- --generate`를 붙인 경우에만 1회 생성 요청(1장, 출력 1024토큰, 자동 재시도 없음)을 보낸다. 이 직접 점검은 앱 사용자별 사용량 원장을 통하지 않으므로 반복 부하 테스트에 사용하지 않는다.

## 검증

전체 테스트 145개, 타입 검사, 프로덕션 빌드, 브라우저 번들 비밀값 검사 통과. 기존 일일 3회 제한·계정별 독립성·생성 결과 재조회·Firestore 저장 흐름의 모의 테스트도 포함된다. 실제 키 값은 출력하거나 Git 파일에 기록하지 않았다.

## Secret 등록 완료 및 남은 승인

승인 후 `.env.local`의 현재 키를 메모리에서 읽어 `moa-gemini-api-key` 버전 **1**에 등록했다. 상태 **ENABLED**와 IAM 바인딩을 조회하여 확인했다. 명령행 인자·로그·소스 파일에 키를 남기지 않았다.

공식 문서의 Secret Accessor 대안을 적용하여 아래 바인딩을 **이 Secret에만** 추가했다. 프로젝트 전체 IAM은 변경하지 않았다.

| 계정 | Secret에 부여할 역할 |
| --- | --- |
| firebase-app-hosting-compute@ai-card-92a13.iam.gserviceaccount.com | roles/secretmanager.secretAccessor |

해당 백엔드의 빌드·런타임 계정은 동일한 compute 계정이다. Viewer·Secret Version Manager 및 서비스 에이전트 추가 권한은 부여하지 않았다. 배포 과정에서 추가로 요구되는 권한이 발견되면 근거를 확인하고 별도 승인받는다.

Git 변경 검토 후 현재 배포용 브랜치로의 일반 push는 승인되었다. 실제 rollout 직전에 대상 커밋과 설정으로 다시 승인받는다. 배포 후 로그인된 테스트 계정에서 1장 생성 → 기존 저장 절차 → Firestore 저장 완료 → 새로고침 복원을 확인한다. 인증된 테스트 세션이 없어 실행할 수 없으면 미검증으로 보고한다. 테스트 데이터 삭제도 별도 승인받는다.

공식 근거: [모델](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [가격](https://ai.google.dev/gemini-api/docs/pricing), [2.5 접근 안내](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), [App Hosting Secret](https://firebase.google.com/docs/app-hosting/configure).
