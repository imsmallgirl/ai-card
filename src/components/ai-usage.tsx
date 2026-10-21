'use client';
import type { GenerationUsage } from '@/lib/generation-model';
export default function AiUsage({ usage, error, onRetry, provider, model }: { usage: GenerationUsage | null; error: string; onRetry: () => void; provider?: 'gemini' | 'mock'; model?: string }) {
  return <div className="ai-usage" role="status">
    {provider && <strong>{provider === 'mock' ? 'Mock 모드 · Gemini API 호출 없음' : `Gemini · ${model || '설정된 모델'}`}</strong>}
    {usage?.unlimited ? <><strong>AI 생성 무제한 · 로컬 테스트</strong><span>생성 횟수와 대기시간 제한이 해제되어 있습니다.</span></> : usage ? <><strong>오늘 남은 AI 생성 {usage.remaining} / {usage.limit}회</strong><span>{usage.reserved ? `${usage.reserved}회 처리 중 · ` : ''}{new Date(usage.resetAt).toLocaleString('ko-KR')}에 초기화됩니다.</span></> : <span>AI 사용량을 확인해 주세요.</span>}
    {error && <span className="error">{error}</span>}
    <button type="button" className="text-button" onClick={onRetry}>사용량 새로고침</button>
    <small>{provider === 'mock' ? '테스트용 카드가 생성됩니다. Firestore 저장·조회는 동일하게 실행되며 Gemini 사용량은 차감되지 않습니다.' : '복습은 무제한입니다. AI 호출을 시작한 후 실패하거나 응답 시간이 초과된 요청도 1회 차감될 수 있습니다.'}</small>
  </div>;
}
