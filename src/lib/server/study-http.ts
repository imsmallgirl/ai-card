import { operationalLog } from './operational-log.ts';
import { z } from 'zod';
import { AuthenticationError, AuthConfigurationError } from '../server-auth.ts';
import { cloudCollection, cloudCommand } from '../study-cloud-model.ts';
import { applyStudyCommand, StudyError } from './study-service.ts';
import type { studyRepository } from './study-firestore.ts';

type Dependencies = {
  enabled: () => boolean;
  authenticate: (request: Request) => Promise<{ uid: string }>;
  repository: typeof studyRepository;
};
const numberParam = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export async function readStudyBody(request: Request, maxBytes = 65536) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new StudyError('INVALID_INPUT', 'JSON 형식으로 요청해 주세요.', 400);
  const reader = request.body?.getReader();
  if (!reader) throw new StudyError('INVALID_INPUT', '요청 내용이 없습니다.', 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new StudyError('BODY_TOO_LARGE', maxBytes===65536?'요청은 64KiB까지 저장할 수 있습니다.':'이미지 요청이 너무 큽니다. 이미지를 줄여 다시 시도해 주세요.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
  catch { throw new StudyError('INVALID_INPUT', '올바른 JSON 요청이 필요합니다.', 400); }
}
export function createStudyHandler(deps: Dependencies) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
    try {
      const { uid } = await deps.authenticate(request);
      if (!deps.enabled()) throw new StudyError('SYNC_DISABLED', 'Firestore 동기화 설정이 필요합니다.', 503);
      if (request.method === 'POST') {
        const command = cloudCommand.parse(await readStudyBody(request));
        return respond(await applyStudyCommand(await deps.repository(uid), command));
      }
      if (request.method !== 'GET') return respond({ code: 'METHOD_NOT_ALLOWED', error: '지원하지 않는 요청입니다.' }, 405);
      const params = new URL(request.url).searchParams;
      const repository = await deps.repository(uid);
      if (!params.has('collection')) return respond({ revision: await repository.revision() });
      const collection = cloudCollection.parse(params.get('collection'));
      const since = numberParam.parse(params.get('since') ?? 0);
      const target = numberParam.parse(params.get('target'));
      if (target < since) throw new StudyError('INVALID_INPUT', '동기화 범위가 올바르지 않습니다.', 400);
      let cursor: [number, string] | undefined;
      if (params.has('cursor')) {
        try {
          cursor = z.tuple([z.number().int().nonnegative(), z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/)]).parse(JSON.parse(params.get('cursor')!));
        } catch { throw new StudyError('INVALID_INPUT', '동기화 커서가 올바르지 않습니다.', 400); }
      }
      return respond(await repository.page(collection, since, target, cursor));
    } catch (error) {
      if (error instanceof AuthenticationError) return respond({ code: 'UNAUTHENTICATED', error: error.message }, 401);
      if (error instanceof AuthConfigurationError) return respond({ code: 'NOT_CONFIGURED', error: 'Firebase 인증 설정을 확인해 주세요.' }, 503);
      if (error instanceof StudyError) return respond({ code: error.code, error: error.message }, error.status);
      if (error instanceof z.ZodError) return respond({ code: 'INVALID_INPUT', error: '저장할 학습 데이터 또는 조회 조건을 확인해 주세요.' }, 400);
      // No request content, token, credential, or provider exception is logged/returned.
      operationalLog('study','UNEXPECTED_FAILURE');
      return respond({ code: 'SYNC_UNAVAILABLE', error: '클라우드에 연결하지 못했습니다. 입력 내용은 보존됩니다. 설정과 네트워크를 확인하고 다시 시도해 주세요.' }, 503);
    }
  };
}
