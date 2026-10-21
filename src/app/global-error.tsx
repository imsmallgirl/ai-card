'use client';
export default function GlobalError({retry}:{retry:()=>void}) {
  return <html lang="ko"><body><main style={{maxWidth:480,margin:'15vh auto',padding:24,fontFamily:'sans-serif',lineHeight:1.8}}><h1>잠시 연결이 원활하지 않아요</h1><p>다시 시도하거나 처음 화면으로 돌아가 주세요.</p><button onClick={retry}>다시 시도하기</button><p><a href="/">처음으로</a></p></main></body></html>;
}
