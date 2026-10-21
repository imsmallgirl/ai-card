import { applicationDefault, getApps, initializeApp, type Credential } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { StudyError, type DocumentData, type StudyDatabase } from './study-service.ts';

// Firestore/gRPC can start more than one auth promise during client initialization.
// Reject missing ADC before constructing that client, rather than hiding unhandled rejections.
let credentialCheck: { key: string; promise: Promise<Credential>; validUntil: number } | undefined;
async function requireFirestoreCredential(projectId: string): Promise<Credential> {
  const credential = applicationDefault();
  if (process.env.FIRESTORE_EMULATOR_HOST) return credential;
  const key = `${projectId}:${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'adc'}`;
  if (credentialCheck?.key === key && credentialCheck.validUntil > Date.now()) return credentialCheck.promise;
  const entry = { key, promise: Promise.resolve(credential), validUntil: Date.now() + 30000 };
  entry.promise = (async () => {
    try {
      await credential.getAccessToken();
      return credential;
    } catch {
      if (credentialCheck === entry) credentialCheck = undefined;
      throw new StudyError('FIRESTORE_CREDENTIALS_REQUIRED',
        '서버 Firebase 인증정보가 필요합니다. GOOGLE_APPLICATION_CREDENTIALS 또는 Application Default Credentials(ADC)를 설정한 뒤 서버를 다시 시작해 주세요.', 503);
    }
  })();
  credentialCheck = entry;
  return entry.promise;
}
export async function getStudyAdminApp() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new StudyError('NOT_CONFIGURED', 'Firestore 프로젝트 설정이 필요합니다.', 503);
  const credential = await requireFirestoreCredential(projectId);
  const name = 'moa-study-server';
  return getApps().find(app => app.name === name) || initializeApp({ projectId, credential }, name);
}
export async function getStudyFirestore() { return getFirestore(await getStudyAdminApp()); }
// Absolute paths are built only in server services from verified token UIDs.
export async function generationDatabase(): Promise<StudyDatabase> {
  const db = await getStudyFirestore();
  return { transaction: run => db.runTransaction(async transaction => {
    const writes = new Map<string, DocumentData>();
    const result = await run({
      get: async path => writes.has(path) ? writes.get(path) : (await transaction.get(db.doc(path))).data(),
      set: (path, data) => { writes.set(path, data); },
    });
    const owners=new Set([...writes.keys()].flatMap(path=>/^users\/([^/]+)\//.exec(path)?.[1]||[]));
    for(const uid of owners){
      const status=await transaction.get(db.doc(`users/${uid}/account/status`));
      if(status.data()?.deleting)throw new StudyError('ACCOUNT_DELETING','삭제 중인 계정은 변경할 수 없습니다.',403);
    }
    for (const [path, data] of writes) transaction.set(db.doc(path), data);
    return result;
  }) };
}
