import { getAuth } from 'firebase-admin/auth';
import { getStudyAdminApp, getStudyFirestore, generationDatabase } from './firestore-database.ts';
import { requireUser } from '../server-auth.ts';
import { createAnalyticsHandler } from './analytics-http.ts';
import { createGa4Sender } from './analytics-export.ts';
export const analyticsHandler = createAnalyticsHandler({
  authenticate: requireUser, database: generationDatabase,
  enabled: () => process.env.ANALYTICS_ENABLED === 'true',
  accountCreatedAt: async uid => {
    const user = await getAuth(await getStudyAdminApp()).getUser(uid);
    // Only the original sign-in is a registration. A later login must not become sign_up.
    if (user.metadata.creationTime !== user.metadata.lastSignInTime) return undefined;
    const time = Date.parse(user.metadata.creationTime);
    return Number.isFinite(time) ? time : undefined;
  },
  sender: () => createGa4Sender(process.env),
  listPending: async uid => {
    const snapshot = await (await getStudyFirestore()).collection(`users/${uid}/analyticsOutbox`).where('state', '==', 'pending').orderBy('__name__').limit(5).get();
    return snapshot.docs.map(doc => doc.id);
  },
});
