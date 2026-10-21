import { z } from 'zod';
import {
  cloudCollections, cloudPage, cloudSnapshot, cloudCommand, emptyCloudSnapshot, parseCloudItems,
  type CloudSnapshot, type CloudCommand,
} from './study-cloud-model.ts';

export class CloudRequestError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export type CloudTransport = (query?: string, command?: CloudCommand) => Promise<unknown>;
export function createCloudTransport(
  getToken: (refresh: boolean) => Promise<string>, signal: AbortSignal, fetcher: typeof fetch = fetch,
): CloudTransport {
  return async (query = '', command) => {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const token = await getToken(attempt > 0);
      signal.throwIfAborted();
      const response = await fetcher(`/api/study${query}`, {
        method: command ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, ...(command ? { 'Content-Type': 'application/json' } : {}) },
        ...(command ? { body: JSON.stringify(command) } : {}),
        signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]), cache: 'no-store',
      });
      if (response.status === 401 && attempt === 0) continue;
      const body = await response.json();
      if (!response.ok) throw new CloudRequestError(typeof body.error === 'string' ? body.error : '동기화하지 못했습니다.', response.status);
      signal.throwIfAborted();
      return body;
    }
  };
}
export type CloudDisk = { snapshot: CloudSnapshot; pending: CloudCommand[] };
const diskSchema = z.object({ snapshot: cloudSnapshot, pending: z.array(cloudCommand) });
export function cloudStorageKey(uid: string) { return `moa-study-cloud-v2-${uid}`; }
export function readCloudDisk(storage: Pick<Storage, 'getItem'>, uid: string): CloudDisk {
  const raw = storage.getItem(cloudStorageKey(uid));
  return raw ? diskSchema.parse(JSON.parse(raw)) : { snapshot: emptyCloudSnapshot(), pending: [] };
}

// Stages pages locally and advances the watermark only after all collections succeed.
// Updates above target are picked up on the next round, even when a page changed during reads.
export async function pullCloudSnapshot(transport: CloudTransport, current: CloudSnapshot): Promise<CloudSnapshot> {
  const { revision: target } = z.object({ revision: z.number().int().nonnegative() }).parse(await transport());
  if (target < current.revision) throw new Error('클라우드 데이터 버전이 이전으로 변경되었습니다. 관리자에게 문의해 주세요.');
  if (target === current.revision) return current;
  const next = structuredClone(current);
  for (const collection of cloudCollections) {
    const items = new Map<string, unknown>(current[collection].map(item => [item.id, item]));
    let cursor: [number, string] | null = null;
    const visited = new Set<string>();
    do {
      const query = new URLSearchParams({ collection, since: String(current.revision), target: String(target) });
      if (cursor) query.set('cursor', JSON.stringify(cursor));
      const page = cloudPage.parse(await transport(`?${query}`));
      for (const item of parseCloudItems(collection, page.items)) items.set(item.id, item);
      cursor = page.cursor;
      if (cursor) {
        const key = JSON.stringify(cursor);
        if (visited.has(key)) throw new Error('동기화 커서가 반복되었습니다.');
        visited.add(key);
      }
    } while (cursor);
    // Each collection is runtime-validated again as a complete snapshot below.
    Object.assign(next, { [collection]: [...items.values()] });
  }
  next.revision = target;
  return cloudSnapshot.parse(next);
}
