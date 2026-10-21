import { requireUser } from '@/lib/server-auth';
import { studyRepository } from '@/lib/server/study-firestore';
import { createStudyHandler } from '@/lib/server/study-http';

export const runtime = 'nodejs';
export const maxDuration = 30;
const handler = createStudyHandler({
  enabled: () => process.env.FIRESTORE_SYNC_ENABLED === 'true',
  authenticate: requireUser,
  repository: studyRepository,
});
export const GET = handler;
export const POST = handler;
