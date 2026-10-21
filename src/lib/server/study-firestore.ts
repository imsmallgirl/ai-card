import { FieldPath } from 'firebase-admin/firestore';
import { getStudyFirestore } from './firestore-database.ts';
import type { CloudCollection } from '../study-cloud-model.ts';
import { StudyError, type DocumentData, type StudyDatabase } from './study-service.ts';

export async function studyRepository(uid: string) {
  // UID comes exclusively from verifyIdToken, not from URL/body/query parameters.
  if (!uid || uid.includes('/')) throw new StudyError('UNAUTHENTICATED', '계정을 확인할 수 없습니다.', 401);
  const db = await getStudyFirestore();
  const root = db.collection('users').doc(uid);
  const database: StudyDatabase = {
    transaction: run => db.runTransaction(async transaction => {
      // Stage writes so all Firestore reads precede all writes, including future domain branches.
      const writes = new Map<string, DocumentData>();
      const result = await run({
        get: async path => (await transaction.get(db.doc(`${root.path}/${path}`))).data(),
        set: (path, data) => { writes.set(path, data); },

      });
      for (const [path, data] of writes) transaction.set(db.doc(`${root.path}/${path}`), data);
      return result;
    }),
  };
  return {
    ...database,
    revision: async () => Number((await db.doc(`${root.path}/meta/sync`).get()).data()?.revision || 0),
    page: async (collection: CloudCollection, since: number, target: number, cursor?: [number, string]) => {
      let query = root.collection(collection).where('updatedRevision', '>', since).where('updatedRevision', '<=', target)
        .orderBy('updatedRevision').orderBy(FieldPath.documentId()).limit(50);
      if (cursor) query = query.startAfter(...cursor);
      const snapshot = await query.get();
      const last = snapshot.docs.at(-1);
      return { items: snapshot.docs.map(doc => doc.data()), cursor: snapshot.size === 50 && last ? [last.data().updatedRevision, last.id] : null };
    },
  };
}
