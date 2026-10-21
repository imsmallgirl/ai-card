import type { Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStudyAdminApp, getStudyFirestore } from './firestore-database.ts';
import { StudyError } from './study-service.ts';

export async function deleteOwnAccount(uid:string,deps?:{firestore:()=>Promise<Firestore>;deleteAuthUser:(uid:string)=>Promise<void>}) {
  if(!uid||uid.includes('/'))throw new StudyError('UNAUTHENTICATED','계정을 확인해 주세요.',401);
  const db=await (deps?.firestore||getStudyFirestore)();const root=db.collection('users').doc(uid);
  // Keep the lock outside deleted collections. In-flight writes read it transactionally.
  // It contains no cards, email, token or source text; operations can clear it after 30 days.
  await root.collection('account').doc('status').set({deleting:true,requestedAt:Date.now()},{merge:true});
  const collections=await root.listCollections();
  for(const collection of collections)if(collection.id!=='account')await db.recursiveDelete(collection);
  const accountDocs=await root.collection('account').listDocuments();
  for(const doc of accountDocs)if(doc.id!=='status')await db.recursiveDelete(doc);
  await root.delete();
  await root.collection('account').doc('status').set({deleting:true,dataDeletedAt:Date.now(),cleanupAfter:Date.now()+30*86400000});
  try{await (deps?.deleteAuthUser|| (async(id:string)=>getAuth(await getStudyAdminApp()).deleteUser(id)))(uid);}catch(cause){
    if(!cause||typeof cause!=='object'||!('code' in cause)||cause.code!=='auth/user-not-found')throw cause;
  }
}
