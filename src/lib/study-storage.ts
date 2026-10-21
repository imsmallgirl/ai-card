type SyncStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function prepareStudyStorage(storage: SyncStorage, uid: string) {
  const targetKey = `moa-study-user-${uid}`;
  const ownerKey = 'moa-study-legacy-owner';
  // Pre-login records are adopted once. Subsequent accounts start independently.
  if (!storage.getItem(ownerKey)) {
    const legacy = storage.getItem('moa-study-v1');
    if (legacy && !storage.getItem(targetKey)) storage.setItem(targetKey, legacy);
    storage.setItem(ownerKey, uid);
  }
  return targetKey;
}

// Inspect before hydration: Zustand may recover a corrupt payload to empty state.
// An unreadable legacy payload must never be mistaken for a new cloud account.
export function hasLocalStudyRecords(storage: Pick<Storage, 'getItem'>, uid: string) {
  const raw = storage.getItem(`moa-study-user-${uid}`);
  if (!raw) return false;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('기존 학습 데이터가 손상되어 있습니다. 원본을 보존했으며 자동으로 클라우드 모드로 전환하지 않습니다.'); }
  if (!value || typeof value !== 'object' || !('state' in value) || !value.state || typeof value.state !== 'object') {
    throw new Error('기존 학습 데이터 형식을 확인할 수 없습니다. 원본은 보존됩니다.');
  }
  const state = value.state;
  if (!('decks' in state) || !Array.isArray(state.decks) || !('reviews' in state) || !Array.isArray(state.reviews)) {
    throw new Error('기존 학습 데이터 형식을 확인할 수 없습니다. 원본은 보존됩니다.');
  }
  return state.decks.length > 0 || state.reviews.length > 0;
}
