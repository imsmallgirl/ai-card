// Public editorial examples only. No user store, API request or persistence is used.
export const demoSubjects = ['외국어', '과학', '개발'] as const;
export const demoCards = {
  외국어: [
    { question: 'consistent는 어떤 뜻일까요?', answer: '일관된, 꾸준한.\n작은 학습을 꾸준히 이어갈 때도 쓸 수 있는 단어예요.' },
    { question: '“~에 익숙하다”를 영어로 표현하면?', answer: 'be used to + 명사 또는 동명사\n예: I am used to studying in the morning.' },
    { question: '“한 번에 한 걸음씩”은 영어로?', answer: 'One step at a time.\n작은 단계부터 차근차근 나아간다는 표현이에요.' },
  ],
  과학: [
    { question: '식물 세포에서 광합성이 일어나는 곳은?', answer: '엽록체.\n빛 에너지를 이용해 유기물을 만드는 광합성이 일어납니다.' },
    { question: '물의 화학식 H₂O는 무엇을 뜻할까요?', answer: '물 분자 하나가 수소 원자 2개와 산소 원자 1개로 이루어져 있다는 뜻입니다.' },
    { question: '액체가 기체로 변하는 현상은?', answer: '기화.\n액체 표면에서 일어나는 증발과 액체 내부에서도 일어나는 끓음을 포함합니다.' },
  ],
  개발: [
    { question: 'HTTPS는 HTTP와 어떻게 다를까요?', answer: 'TLS로 통신을 암호화합니다.\n전송 중인 데이터의 기밀성과 무결성을 보호하고 서버의 신원을 확인합니다.' },
    { question: '배열의 map은 무엇을 반환할까요?', answer: '각 요소에 함수를 적용한 결과로 이루어진 새로운 배열을 반환합니다.' },
    { question: 'Git의 커밋은 어떤 역할을 할까요?', answer: '프로젝트의 변경 사항을 하나의 기록으로 남깁니다.\n나중에 변경 내용을 확인하거나 이전 상태를 살펴볼 수 있습니다.' },
  ],
} satisfies Record<typeof demoSubjects[number], { question: string; answer: string }[]>;
