import { FileText, Sparkles } from 'lucide-react';
export type CreationMode = 'material' | 'ai' | 'manual';
export default function DeckCreationMode({ value, change, disabled = false }: {
  value: CreationMode; change: (value: CreationMode) => void; disabled?: boolean;
}) {
  if(value==='manual')return null;
  return <div className="creation-submodes" role="group" aria-label="AI로 만드는 방법">
    <button type="button" aria-pressed={value === 'material'} disabled={disabled} onClick={() => change('material')}><FileText size={15}/>자료로 만들기</button>
    <button type="button" aria-pressed={value === 'ai'} disabled={disabled} onClick={() => change('ai')}><Sparkles size={15}/>카테고리로 자동생성</button>
  </div>;
}
