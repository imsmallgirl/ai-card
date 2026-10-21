'use client';
import type { AnalyticsClientState } from '@/lib/analytics-client';
export default function ConsentSettings({ loggedIn, state, configured, onChoose, onRetry }: {
  loggedIn: boolean; state: AnalyticsClientState; configured: boolean;
  onChoose: (granted: boolean) => void; onRetry: () => void;
}) {
  return <details className="consent-settings"><summary>개인정보 · 선택적 분석 설정</summary>
    <section aria-label="선택적 사용 분석 설정">
      <h2>서비스 사용 분석은 선택 사항이에요</h2><a className="text-button" href="/privacy/analytics">선택적 분석 안내 자세히 보기</a>
      <p>동의하면 가입·카드 생성·첫 복습·재방문 같은 기능 이용 여부와 개수 구간을 기록합니다. 제목, 질문·정답, 참고 자료, 답안, 이름·이메일, 페이지 주소는 분석 이벤트에 포함하지 않습니다.</p>
      <p>외부 전송이 별도로 활성화된 경우 무작위 분석 식별자와 최소 이벤트를 Google Analytics에 보냅니다. 광고 분석 동의는 포함하지 않습니다. 동의를 거부하거나 철회해도 로그인과 학습 기능을 계속 이용할 수 있습니다.</p>
      <p>선택은 계정에 저장됩니다. 철회하면 이후 수집과 대기 이벤트 전송을 중단합니다. 이미 전송 중이거나 전달된 정보는 철회만으로 회수되지 않습니다. 대기 기록은 최대 72시간 동안 외부 전송 대상으로 유지되며, 현재 자동 삭제는 구현되지 않아 기록이 남을 수 있습니다. 외부 전송 활성화 전 운영 보존·삭제 정책을 확정합니다.</p>
      <strong role="status">{!loggedIn?'로그인 후 계정별로 설정할 수 있어요.':!configured?'분석 기능이 현재 비활성화되어 있습니다.':!state.ready?'분석 설정 확인 중…':state.granted?'선택적 분석에 동의한 상태입니다.':'선택적 분석 수집을 중단한 상태입니다.'}</strong>
      {state.error&&<p className="error" role="alert">{state.error}</p>}
      {loggedIn&&<div className="consent-actions">
        <button className="soft-button" disabled={state.busy||!state.ready||!configured||!state.serverEnabled} onClick={()=>onChoose(true)}>분석에 동의</button>
        <button className="soft-button" disabled={state.busy} onClick={()=>onChoose(false)}>거부 / 동의 철회</button>
        <button className="text-button" disabled={state.busy} onClick={onRetry}>설정 다시 확인</button>
      </div>}
    </section>
  </details>;
}
