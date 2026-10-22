'use client';
import type { AnalyticsClientState } from '@/lib/analytics-client';
export default function ConsentSettings({ loggedIn, browserScope = false, state, configured, onChoose, onRetry }: {
  browserScope?: boolean;
  loggedIn: boolean; state: AnalyticsClientState; configured: boolean;
  onChoose: (granted: boolean) => void; onRetry: () => void;
}) {
  return <details className="consent-settings"><summary>개인정보 · 선택적 분석 설정</summary>
    <section aria-label="선택적 사용 분석 설정">
      <h2>서비스 사용 분석은 선택 사항이에요</h2><a className="text-button" href="/privacy/analytics">선택적 분석 안내 자세히 보기</a>
      {browserScope?<><p>동의 후 방문·유입 분류·기기 정보, 로그인·카드 생성·저장·복습 시작과 완료, 고정된 화면 이름을 Google Analytics에 보냅니다. 이름·이메일·Firebase UID·카드 내용·입력 원문·URL 쿼리는 보내지 않습니다. 광고 개인화는 사용하지 않습니다.</p>
        <p>선택은 로그인 여부와 관계없이 이 브라우저에 90일간 저장됩니다. 공유 기기에서는 다른 사용자에게도 적용되며 다른 기기에는 적용되지 않습니다. 철회하면 이후 전송을 중단하고 이 서비스의 분석 쿠키를 제거합니다. 이미 전송된 정보는 회수되지 않습니다. 동의하지 않아도 학습 기능은 그대로 이용할 수 있습니다.</p></>:<><p>동의하면 가입·카드 생성·첫 복습·재방문 같은 기능 이용 여부와 개수 구간을 기록합니다. 제목, 질문·정답, 참고 자료, 답안, 이름·이메일, 페이지 주소는 분석 이벤트에 포함하지 않습니다.</p>
      <p>기존 계정별 분석은 계정에 선택을 저장합니다. 철회하면 이후 수집과 대기 이벤트 전송을 중단합니다. 이미 전달된 정보는 회수되지 않으며, 서버 기록 자동 삭제는 아직 구현되지 않았습니다.</p></>}
      <strong role="status">{!configured?'분석 기능이 현재 비활성화되어 있습니다.':!loggedIn&&!browserScope?'로그인 후 계정별로 설정할 수 있어요.':!state.ready?'분석 설정 확인 중…':state.granted?'선택적 분석에 동의한 상태입니다.':'선택적 분석 수집을 중단한 상태입니다.'}</strong>
      {state.error&&<p className="error" role="alert">{state.error}</p>}
      {(loggedIn||browserScope)&&<div className="consent-actions">
        <button className="soft-button" disabled={state.busy||!state.ready||!configured||!state.serverEnabled} onClick={()=>onChoose(true)}>분석에 동의</button>
        <button className="soft-button" disabled={!browserScope&&state.busy} onClick={()=>onChoose(false)}>거부 / 동의 철회</button>
        <button className="text-button" disabled={state.busy} onClick={onRetry}>설정 다시 확인</button>
      </div>}
    </section>
  </details>;
}
