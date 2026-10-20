import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

export class AuthenticationError extends Error {}
export class AuthConfigurationError extends Error {}

export async function requireUser(request: Request) {
  const match = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i);
  if (!match) throw new AuthenticationError('로그인이 필요합니다.');
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new AuthConfigurationError('Firebase 프로젝트 설정이 필요합니다.');
  const name = 'moa-server-auth';
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId }, name);
  try {
    // Verification uses Google's public signing keys and the configured project ID.
    // No Admin service-account private key is needed for ID token verification.
    return await getAuth(app).verifyIdToken(match[1]);
  } catch { throw new AuthenticationError('로그인 인증이 만료되었거나 유효하지 않습니다. 다시 로그인해 주세요.'); }
}
