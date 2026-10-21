import { FileText, PenLine, Sparkles } from 'lucide-react';
export type CreationMode = 'material' | 'ai' | 'manual';
export default function DeckCreationMode({ value, change, disabled = false }: {
  value: CreationMode; change: (value: CreationMode) => void; disabled?: boolean;
}) {
  return <div className="creation-modes" role="group" aria-label="학습 덱 만드는 방법">
    <button type="button" aria-pressed={value === 'material'} disabled={disabled} onClick={() => change('material')}><FileText size={17}/>자료로 만들기</button>
    <button type="button" aria-pressed={value === 'ai'} disabled={disabled} onClick={() => change('ai')}><Sparkles size={17}/>AI 자동 생성</button>
    <button type="button" aria-pressed={value === 'manual'} disabled={disabled} onClick={() => change('manual')}><PenLine size={17}/>직접 만들기</button>
  </div>;
}
