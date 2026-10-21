'use client';
export default function ErrorPage({retry}:{retry:()=>void}) {
  return <main className="boot recovery-page"><h1>화면을 불러오지 못했어요</h1><p>잠시 후 다시 시도해 주세요. 저장된 학습 자료는 자동으로 삭제되지 않습니다.</p><button className="primary" onClick={retry}>다시 시도하기</button><a href="/">처음으로 돌아가기</a></main>;
}
