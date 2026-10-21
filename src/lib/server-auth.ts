import { getAuth } from 'firebase-admin/auth';
import { getStudyAdminApp } from './server/firestore-database.ts';

export class AuthenticationError extends Error {}
export class AuthConfigurationError extends Error {}

export async function requireUser(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
  if (!match || match[1].length>16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(match[1])) throw new AuthenticationError('로그인이 필요합니다.');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new AuthConfigurationError('Firebase 프로젝트 설정이 필요합니다.');
  const app = await getStudyAdminApp();
  try {
    // Reject disabled/deleted users and revoked tokens, including previously issued ID tokens.
    return await getAuth(app).verifyIdToken(match[1], true);
  } catch { throw new AuthenticationError('로그인 인증이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.'); }
}
