'use client';
import type { GenerationUsage } from '@/lib/generation-model';
export default function AiUsage({ usage, error, onRetry, provider, model, dashboard=false, busy=false }: { usage: GenerationUsage | null; error: string; onRetry: () => void; provider?: 'gemini' | 'mock'; model?: string; dashboard?: boolean; busy?: boolean }) {
  return <div className={dashboard?'ai-usage dashboard-ai-usage panel':'ai-usage'} aria-busy={busy}>
    {dashboard?<div className="dashboard-ai-heading"><h2>오늘 AI 사용량</h2><button type="button" className="text-button" disabled={busy} onClick={onRetry}>{busy?'확인 중…':'새로고침'}</button></div>:provider&&<strong>{provider==='mock'?'Mock 모드 · Gemini API 호출 없음':`Gemini · ${model||'설정된 모델'}`}</strong>}
    <div role="status">
    {usage?.unlimited?<><strong>AI 생성 무제한 · 로컬 테스트</strong><span>생성 횟수와 대기시간 제한이 해제되어 있습니다.</span></>:usage?<>
      {dashboard?<div className="dashboard-ai-counts"><div><span>사용</span><strong>{usage.charged}<small>회</small></strong></div><div><span>남음</span><strong>{usage.remaining??'—'}<small>회</small></strong></div><div><span>하루 한도</span><strong>{usage.limit}<small>회</small></strong></div></div>:<strong>오늘 남은 AI 생성 {usage.remaining??'확인 필요'} / {usage.limit}회</strong>}
      <span>{usage.reserved?`${usage.reserved}회 처리 중 · `:''}{new Date(usage.resetAt).toLocaleString('ko-KR')}에 초기화됩니다. (기기 시간 기준)</span>
    </>:<span>{busy?'오늘 AI 사용량을 확인하고 있어요.':'AI 사용량을 불러오지 못했어요. 새로고침으로 다시 확인해 주세요.'}</span>}
    {error&&<p className="error">{error}{usage?' · 위 수치는 마지막 조회 결과입니다.':''}</p>}
    </div>
    {!dashboard&&<button type="button" className="text-button" disabled={busy} onClick={onRetry}>{busy?'확인 중…':'사용량 새로고침'}</button>}
    <small>{provider==='mock'?'테스트 모드입니다. 실제 Gemini 사용량은 차감되지 않습니다.':'자료·이미지 분석과 자동 생성이 같은 한도를 사용해요. 실패·시간 초과도 차감될 수 있으며 복습과 직접 만들기는 AI 횟수를 사용하지 않아요.'}</small>
  </div>;
}
