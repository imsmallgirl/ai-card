import { parseMaterial } from './material-parser.ts';
import type { CardContent } from './card-content.ts';
import { z } from 'zod';
import { generationInput, materialGeneratedCards } from './gemini.ts';
import { generationFetch, generationClientResult, GenerationClientError, type PendingGeneration } from './generation-client.ts';
export const materialAnalysisPending=z.object({id:z.uuid(),input:generationInput.refine(input=>input.mode==='material'&&Boolean(input.text.trim()||input.image))});
// Called only by the explicit, consented AI action. The rule parser has no dependency on this module.
export async function analyzeMaterial(pending:PendingGeneration,getToken:(refresh:boolean)=>Promise<string>,signal:AbortSignal,fetcher:typeof fetch=fetch){
  const checked=materialAnalysisPending.parse(pending);
  if(!checked.input.image&&parseMaterial(checked.input.text).cards.length>checked.input.count)throw new Error('자료의 질문 수가 AI 분석 한도를 넘습니다. 자료를 나누어 분석해 주세요.');
  let data:unknown;
  try{data=await generationFetch(getToken,`/api/generation-requests/${checked.id}`,signal,undefined,fetcher);}catch(cause){if(!(cause instanceof GenerationClientError)||cause.status!==404)throw cause;}
  if(!data)data=await generationFetch(getToken,'/api/generate',signal,checked,fetcher);
  return generationClientResult.parse(data);
}

// AI extraction replaces the entire preview, including classifications and previously excluded cards.
export function mergeMaterialAnalysis(_source:string,result:CardContent[]) {
  const checked=materialGeneratedCards.omit({title:true}).safeParse({cards:result});
  if(!checked.success)throw new Error('AI 추출 결과에 유효한 카테고리·태그·난이도가 필요합니다. 기존 미리보기는 유지됩니다.');
  return {cards:checked.data.cards,warnings:['AI 추출 결과로 미리보기를 교체했습니다. 질문·정답·해설을 원본과 비교한 후 저장해 주세요.']};
}
