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
