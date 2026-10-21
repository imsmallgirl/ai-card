import { z } from 'zod';

// Provider messages may contain input, project IDs or keys. Only fixed labels leave this parser.
export const geminiDiagnostic = z.object({
  providerStatus: z.number().int().min(100).max(599),
  providerCode: z.enum(['RESOURCE_EXHAUSTED', 'INVALID_ARGUMENT', 'FAILED_PRECONDITION', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'UNKNOWN']),
});
export type GeminiDiagnostic = z.infer<typeof geminiDiagnostic>;
const errorBody = z.object({ error: z.object({
  status: z.string().optional(), message: z.string().optional(),
  details: z.array(z.object({ reason: z.string().optional(),
    violations: z.array(z.object({ quotaId: z.string().optional(), quotaMetric: z.string().optional(), quotaValue: z.union([z.number(), z.string()]).optional() })).optional(),
  })).optional(),
}).optional() });

export function geminiFailure(status: number, body: unknown = {}) {
  const parsed = errorBody.safeParse(body);
  const provider = parsed.success ? parsed.data.error : undefined;
  const diagnostic: GeminiDiagnostic = {
    providerStatus: status,
    providerCode: geminiDiagnostic.shape.providerCode.safeParse(provider?.status).success ? provider!.status as GeminiDiagnostic['providerCode'] : 'UNKNOWN',
  };
  const details = provider?.details || [];
  const reasons = details.map(detail => detail.reason);
  const message = provider?.message || '';
  const violations = details.flatMap(detail => detail.violations || []);
  const metrics = violations.map(item => `${item.quotaId || ''} ${item.quotaMetric || ''}`).join(' ');
  const fail = (http: number, code: string, explanation: string) => ({ status: http, code,
    error: `Gemini HTTP ${status} / ${diagnostic.providerCode}: ${explanation} [${code}]`, diagnostic });
  if (reasons.some(reason => ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'API_KEY_LEAKED'].includes(reason || '')) || status === 401 || /api key (?:was reported as leaked|not valid|expired)/i.test(message)) {
    return fail(502, 'INVALID_API_KEY', 'API 키가 유효하지 않거나 차단되었습니다. 서버의 GEMINI_API_KEY를 확인해 주세요.');
  }
  if (status === 402 || /(?:prepay|credit) (?:balance|credits?).*(?:depleted|exhausted|insufficient)/i.test(message)) {
    return fail(402, 'BILLING_CREDITS_EXHAUSTED', '결제 또는 선불 크레딧 문제입니다. Google AI Studio의 결제 상태를 확인해 주세요.');
  }
  if (reasons.some(reason => ['BILLING_DISABLED', 'BILLING_NOT_ACTIVE', 'BILLING_ACCOUNT_DISABLED', 'BILLING_ACCOUNT_CLOSED'].includes(reason || '')) || /billing (?:is |has been )?(?:disabled|not enabled|inactive)|enable billing|billing account.*(?:closed|suspended)/i.test(message)) {
    return fail(502, 'BILLING_REQUIRED', '응답에 결제 활성화 또는 결제 계정 문제가 명시되어 있습니다. 결제 상태를 확인해 주세요.');
  }
  if (reasons.some(reason => ['SPEND_LIMIT_EXCEEDED', 'BILLING_LIMIT_EXCEEDED', 'DAILY_SPEND_LIMIT_EXCEEDED'].includes(reason || '')) || /(?:spend|spending|billing)[ -](?:based[ -])?(?:rate[ -])?limit.*(?:exceeded|reached)/i.test(message)) {
    return fail(429, 'BILLING_LIMIT_EXCEEDED', '응답에 지출 한도 초과가 명시되어 있습니다. 요청·토큰 한도와 구분하여 결제/지출 한도를 확인해 주세요.');
  }
  if (status === 404) return fail(502, 'MODEL_NOT_FOUND', '설정된 모델 또는 API 버전을 사용할 수 없습니다. GEMINI_MODEL의 정확한 모델 ID와 해당 프로젝트의 모델 접근 권한을 확인해 주세요.');
  if (status === 403) return fail(502, 'ACCESS_DENIED', 'API 접근이 거부되었습니다. API 키 제한, API 활성화와 모델 접근 권한을 확인해 주세요.');
  if (status === 429 || provider?.status === 'RESOURCE_EXHAUSTED') {
    if (violations.some(item => item.quotaValue !== undefined && String(item.quotaValue).trim() !== '' && Number(item.quotaValue) === 0)) return fail(429, 'QUOTA_UNAVAILABLE', '응답의 할당량이 0입니다. 해당 모델의 무료/유료 티어와 프로젝트 접근 가능 여부를 확인해 주세요. 잠시 기다리는 것만으로 해결되지 않을 수 있습니다.');
    if (/per[ _-]?day|daily/i.test(metrics)) return fail(429, 'DAILY_QUOTA_EXCEEDED', '응답에 일일 할당량 초과가 명시되어 있습니다. Google AI Studio에서 모델별 일일 사용량을 확인해 주세요.');
    if (/per[ _-]?minute|per[ _-]?second/i.test(metrics) || reasons.includes('RATE_LIMIT_EXCEEDED')) return fail(429, 'RATE_LIMIT_EXCEEDED', '응답에 분당/초당 요청 또는 토큰 한도 초과가 명시되어 있습니다. 요청 간격과 모델별 한도를 확인해 주세요.');
    return fail(429, 'RESOURCE_EXHAUSTED', '리소스 또는 할당량이 소진되었습니다. 응답만으로 요청·토큰 한도, 일일 할당량, 지출 한도를 확정할 수 없습니다. Google AI Studio의 사용량·결제를 확인해 주세요.');
  }
  if (status === 400 && provider?.status === 'FAILED_PRECONDITION') return fail(502, 'PROVIDER_PRECONDITION', '사용 전제 조건이 충족되지 않았습니다. 지역·티어·결제 상태를 확인해 주세요. 이 코드만으로 결제 문제라고 확정할 수 없습니다.');
  if (status === 400) {
    if (/too many states|schema.*(?:too complex|too large|too deeply nested)|(?:complexity|nesting).*schema/i.test(message)) return fail(502, 'OUTPUT_SCHEMA_TOO_COMPLEX', '구조화 출력 스키마가 모델의 복잡도 제한을 초과했습니다. 서버의 출력 스키마를 간소화해야 합니다.');
    if (/unknown name.*(?:response_?json_?schema|response_?mime_?type|response_?format)|(?:response_?json_?schema|response_?mime_?type|response_?format).*(?:not supported|unsupported|unknown)/i.test(message)) return fail(502, 'STRUCTURED_OUTPUT_OPTION_INVALID', 'API가 구조화 출력 옵션을 거부했습니다. REST 요청의 generationConfig.responseFormat 형식과 모델 지원을 확인해 주세요.');
    if (/max_?output_?tokens/i.test(message)) return fail(502, 'OUTPUT_TOKEN_OPTION_INVALID', 'API가 출력 토큰 설정을 거부했습니다. 서버의 최대 출력 토큰 값과 모델 한도를 확인해 주세요.');
    return fail(502, 'MODEL_REQUEST_INVALID', '요청 형식 또는 모델별 옵션이 잘못되었습니다. API 버전과 모델의 구조화 출력 지원을 확인해 주세요.');
  }
  if (status >= 500) return fail(503, 'PROVIDER_UNAVAILABLE', 'Gemini 서버 오류입니다. 제한된 자동 재시도 후에도 실패했습니다. 입력 내용은 유지됩니다.');
  return fail(502, 'GENERATION_FAILED', '요청을 처리하지 못했습니다. 모델 설정과 API 접근 권한을 확인해 주세요.');
}
