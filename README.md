# 모아 — AI 학습 앱

Next.js App Router · React · TypeScript · Zustand · Firebase Authentication · Gemini · Zod

## 실행과 로그인

Node.js 20.9 이상이 필요합니다. 테스트는 Node.js 24 기준으로 확인했습니다.

```sh
npm install
cp .env.example .env.local
npm run dev
```

이미 `.env.local`을 설정했다면 복사 명령으로 덮어쓰지 마세요. 개발 서버가 출력하는 localhost 주소로 접속합니다.

1. Firebase Console에서 프로젝트의 웹 앱을 등록합니다.
2. 웹 앱 설정의 apiKey/authDomain/projectId/appId를 `.env.local`의 `NEXT_PUBLIC_FIREBASE_*`에 입력합니다.
3. Authentication → Sign-in method에서 Google을 활성화합니다.
4. Authentication → Settings → Authorized domains에 localhost와 운영 도메인을 추가합니다.
5. `.env.local`에 `GEMINI_API_KEY`를 설정합니다. 기본 `GEMINI_MODEL`은 `gemini-3.5-flash`입니다.
6. 환경 변수 변경 후 개발 서버를 재시작합니다. 운영 환경은 재빌드해야 합니다.

Firebase 웹 앱 구성은 공개 설정입니다. 서비스 계정 비밀키를 `NEXT_PUBLIC_` 변수에 넣지 마세요. Firebase 설정이 없으면 로그인 설정 안내만 표시되며 학습 기능은 열리지 않습니다.

## 주요 기능

- **로그인 필수:** 비로그인 상태에서는 로그인 화면만 렌더링합니다. 대시보드, 덱, 복습, 통계, 설정은 로그인 후 이용합니다. 로그아웃하면 학습 화면과 세션을 닫습니다.
- **서버 인증:** AI 생성 요청에 Firebase ID 토큰을 보내며 Admin SDK가 서명/발급자/대상 프로젝트/유효 기간을 검증합니다. 토큰이 없거나 잘못되면 401로 차단합니다. 서명 검증에는 공개 인증서와 프로젝트 ID를 사용하므로 서비스 계정 비밀키가 필요하지 않습니다.
- **AI 생성:** 제목과 카테고리로 생성합니다. 질문 수는 1~20개(기본 10개), 빠른 선택은 5/10/15/20개입니다. 참고 자료는 선택 사항입니다. 자료가 부족하면 근거 없는 내용을 만들지 않도록 더 적은 카드가 생성될 수 있습니다.
- **전체 복습:** 모든 덱의 카드를 한 세션에서 공부합니다. 모든 카드/오늘 복습할 카드, 순서 섞기, 주관식 퀴즈를 선택합니다. 현재 카드의 원래 덱 이름을 보여주고 자기 평가 결과를 해당 덱에 저장합니다.
- **간격 반복:** 기억한 카드는 1일부터 간격을 두 배로, 다시 볼 카드는 1분 뒤 예약합니다.
- **계정별 로컬 저장:** Firebase UID별로 덱과 복습 기록을 분리합니다. 기존 비로그인 기록은 최초로 로그인한 계정에 한 번만 이어집니다. 다른 기기와 클라우드 동기화는 하지 않으며 브라우저 데이터를 지우면 기록이 사라집니다.
- **빈 상태:** 샘플 덱 없이 시작하며 새 덱 만들기로 안내합니다. 이전 내장 샘플만 마이그레이션으로 제거하고 직접 만든 덱은 보존합니다.
- 검색, 카테고리 필터, 주간 통계, 일일 목표, 반응형 UI를 지원합니다.

## 카테고리

외국어, 국어·문학, 수학, 과학, 역사·지리, 사회·정치, 인문, 프로그래밍·IT, 기술·공학, 경영·경제, 법률, 의학·간호, 자격증·시험, 디자인, 예술·음악, 건강·운동, 일반상식, 기타.

[Quizlet의 주제 탐색](https://quizlet.com/search)과 [Brainscape의 과목 분류](https://www.brainscape.com/subjects)를 참고해 이 앱에 맞게 구성했습니다. 사용 빈도 순위를 의미하지는 않습니다. 카테고리는 `src/lib/categories.ts`에서 관리하며 폼과 API가 같은 목록을 사용합니다.

## AI 오류 처리와 검증

JSON Schema 출력을 요청하고 Zod로 카드 형식과 개수를 검증합니다. 키/권한/모델/사용량 오류는 구체적으로 안내합니다. 일시적인 Gemini 500/502/503/504는 0.5초, 1초 간격으로 최대 두 번 재시도합니다. 전체 생성 요청은 55초 제한이며 외부 서비스 장애가 지속되면 실패 안내와 입력 내용을 유지합니다.

```sh
npm test
npm run typecheck
npm run build
npm start
```

테스트는 질문 수 경계값, 카테고리, 재시도, 인증 거부, 전체 복습의 원본 카드 참조, 계정 분리와 기존 데이터 보존을 검증합니다.

Firebase 인증: https://firebase.google.com/docs/auth/admin/verify-id-tokens
Gemini API: https://ai.google.dev/api/generate-content

네이버는 Firebase 기본 제공업체가 아닙니다. 추가하려면 네이버 OAuth 서버 연동과 Firebase 커스텀 토큰 인증을 별도로 구현해야 합니다.
