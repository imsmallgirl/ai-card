# 모아 — 학습 카드 MVP

Next.js App Router · React · TypeScript · Firebase Authentication/Admin/Firestore · Gemini · Zustand · Zod.

## 시작하기

Node24 권장. 의존성은 package-lock 기준으로 설치합니다.

```sh
npm ci
# .env.local이 없는 경우에만 .env.example을 복사하고 직접 설정합니다.
cp .env.example .env.local
npm run dev
```

기존 `.env.local`을 덮어쓰지 마세요. Google 로그인 설정과 서버 ADC/IAM이 필요합니다. 서버는 서명·만료뿐 아니라 폐기/삭제된 계정의 ID 토큰도 확인합니다.

## 현재 기능

- 로그아웃 시 공개 랜딩, Google 로그인 후 UID별 개인 학습 공간. 공유 기능 없음.
- **자료로 만들기**(기본): AI 없는 규칙 추출, 객관식/Q&A/Markdown 지원, 수정·제외 후 저장. 사용자가 선택할 때만 AI 추출.
- **AI 자동 생성**: 제목·카테고리·목적·난이도·1~20장. 단어 암기 요청은 영어 단어/한국어 뜻 형식.
- **직접 만들기**: 직접 질문/답 입력, 기존 카드 편집/삭제.
- Firestore 서버 쓰기와 UID별 캐시/outbox·멱등성·충돌 처리. 동기화 flags를 켜야 클라우드로 저장됩니다. 기존 로컬 자료는 원본 보존 후 명시적으로 이전합니다.
- 덱 선택·순서 섞기·퀴즈/카드 학습. 기억 평가 없이 다음 카드/마지막 완료를 저장해 진행률·학습량·스트릭·캘린더 반영.
- 하루 목표 변경, 새로고침 후 유지, 계정 삭제(재인증·본인 자료 삭제·진행 중 쓰기 차단).
- 개발 Mock은 로컬 development에서만 동작. 실제 API 오류를 Mock으로 자동 대체하지 않음.

## 검증

```sh
npm test
npm run typecheck
npm run build
npm run check:bundle
npm run test:http
npm run check:release
# Java21+, 로컬8787 포트 필요. 운영 Firebase를 사용하지 않음
npm run test:firestore
```

`check:release`는 운영 도메인·연락처·서버 설정·안전 플래그가 준비되지 않으면 실패합니다. 테스트/빌드 통과와 실제 출시 설정 완료는 별개입니다.

## 배포 및 운영 문서

- [1차 MVP 배포 가이드](docs/DEPLOYMENT.md): Firebase App Hosting / Vercel, ADC·IAM, 비용과 롤백
- [환경변수 표](docs/ENVIRONMENT.md): 공개/서버 Secret, 빌드/런타임 구분
- [출시 체크리스트](docs/RELEASE_CHECKLIST.md): 설정·도메인·실제 계정·반응형·접근성·운영 점검
- [Phase4·5 검증 보고서](docs/QUALITY_REPORT.md): 변경 내용·실행한 검증·남은 범위
- [자료 카드 생성](docs/MATERIAL_CREATION.md), [AI 개발/Mock](docs/AI_DEVELOPMENT.md), [AI 비용 보호](docs/AI_COST_PROTECTION.md)
- [Firestore 동기화](docs/FIRESTORE_SYNC.md), [데이터 구조](docs/DATABASE.md)

Firebase Hosting 정적 업로드만으로는 서버 API가 동작하지 않습니다. App Hosting은 Blaze 비용 검토가 필요하며, Vercel은 별도 서버 Google ADC/WIF 연결이 필요합니다. 로컬 gcloud 인증이 배포 서버로 자동 전송되지 않습니다. 실제 배포·Rules 배포·IAM/비밀키/과금 변경은 별도 작업입니다.

일부 이전 Phase 문서는 당시 상태를 보존한 기록입니다. 현재 출시 판단은 위 배포 문서와 검증 보고서를 기준으로 합니다. CARD_PLAN2와 공유 기능은 구현 기준에서 제외합니다.
