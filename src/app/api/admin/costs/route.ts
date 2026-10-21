import { requireUser } from '@/lib/server-auth';
import { getStudyFirestore } from '@/lib/server/firestore-database';
import { createCostHandler } from '@/lib/server/generation-cost-http';

export const runtime = 'nodejs';
export const GET = createCostHandler({ authenticate: requireUser, read: async (first, last) => {
  const db = await getStudyFirestore();
  const days = [];
  for (let time = first; time <= last; time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    const root = db.doc(`serviceUsage/${day}`);
    const [total, models] = await Promise.all([root.get(), root.collection('models').orderBy('__name__').limit(50).get()]);
    days.push({ day, total: total.data() || null, models: models.docs.map(doc => ({ model: doc.id, ...doc.data() })), modelsTruncated: models.size === 50 });
  }
  return days;
} });
