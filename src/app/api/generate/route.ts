import { NextResponse } from 'next/server';
import { AuthenticationError, AuthConfigurationError, requireUser } from '@/lib/server-auth';
import { requestGemini, DEFAULT_GEMINI_MODEL, generatedCards, generationInput, geminiFailure } from '@/lib/gemini';

export const maxDuration = 60;

export async function POST(request: Request) {
  try { await requireUser(request); }
  catch (error) {
    if (error instanceof AuthenticationError) return NextResponse.json({ code: 'UNAUTHENTICATED', error: error.message }, { status: 401 });
    if (error instanceof AuthConfigurationError) return NextResponse.json({ code: 'AUTH_NOT_CONFIGURED', error: error.message }, { status: 503 });
    return NextResponse.json({ code: 'AUTH_UNAVAILABLE', error: '로그인 인증을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: '올바른 학습 내용을 입력해 주세요.' }, { status: 400 }); }

  const input = generationInput.safeParse(body);
  if (!input.success) return NextResponse.json({ error: '1~80자의 학습 덱 이름과 카테고리를 확인해 주세요. 질문 수는 1~20개, 추가 자료는 15,000자까지 입력할 수 있습니다.' }, { status: 400 });

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return NextResponse.json({ code: 'NOT_CONFIGURED', error: 'AI 연결이 필요합니다. 서버의 .env.local에 GEMINI_API_KEY를 설정해 주세요.' }, { status: 503 });

  const model = (process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL).replace(/^models\//, '');
  if (!/^[a-zA-Z0-9._-]+$/.test(model)) return NextResponse.json({ error: 'GEMINI_MODEL에 올바른 모델 이름을 입력해 주세요.' }, { status: 503 });

  try {
    const response = await requestGemini({ key, model, input: input.data, signal: AbortSignal.timeout(55000) });

    if (!response.ok) {
      const failure = geminiFailure(response.status, await response.json().catch(() => ({})));
      console.warn('[AI generation failed]', { model, providerStatus: response.status, code: failure.code });
      return NextResponse.json({ code: failure.code, error: failure.error }, { status: failure.status });
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (data.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(candidate?.finishReason)) {
      return NextResponse.json({ code: 'CONTENT_BLOCKED', error: '이 자료로는 카드를 생성할 수 없습니다. 학습 내용을 수정해 다시 시도해 주세요.' }, { status: 422 });
    }

    const text = candidate?.content?.parts?.filter((part: { thought?: boolean }) => !part.thought).map((part: { text?: string }) => part.text || '').join('');
    let parsed: unknown;
    try { parsed = JSON.parse(text || '{}'); }
    catch { return NextResponse.json({ code: 'INVALID_OUTPUT', error: 'AI 응답이 완성되지 않았습니다. 학습 자료를 줄이거나 다시 시도해 주세요.' }, { status: 502 }); }

    const result = generatedCards.safeParse(parsed);
    if (!result.success || result.data.cards.length > input.data.count) return NextResponse.json({ code: 'INVALID_OUTPUT', error: '학습 주제를 파악하지 못했습니다. 덱 이름을 더 구체적으로 적거나 참고 자료를 추가해 주세요.' }, { status: 422 });
    return NextResponse.json({ ...result.data, model });
  } catch (error) {
    if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
      return NextResponse.json({ code: 'TIMEOUT', error: 'AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.' }, { status: 504 });
    }
    return NextResponse.json({ code: 'CONNECTION_FAILED', error: 'Gemini에 연결하지 못했습니다. 서버의 네트워크 연결을 확인한 뒤 다시 시도해 주세요.' }, { status: 502 });
  }
}
