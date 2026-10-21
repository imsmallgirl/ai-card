export function clearAccountStorage(storage:Pick<Storage,'removeItem'|'getItem'>,uid:string) {
  let failed = false;
  const remove = (key: string) => { try { storage.removeItem(key); } catch { failed = true; } };
  for(const key of [
    `moa-study-user-${uid}`,`moa-study-cloud-v2-${uid}`,`moa-study-import-backup-${uid}`,
    `moa-study-imported-v1-${uid}`,`moa-generation-pending-${uid}`,`moa-material-ai-pending-${uid}`,
    `moa-analytics-consent-${uid}`,
  ])remove(key);
  try {
    if(storage.getItem('moa-study-legacy-owner')===uid){
      // Keep the ownership marker if legacy removal fails, so a retry can
      // identify it and another account cannot adopt the deleted user's data.
      try { storage.removeItem('moa-study-v1'); remove('moa-study-legacy-owner'); } catch { failed = true; }
    }
  } catch { failed = true; }
  if (failed) throw new Error('이 브라우저의 일부 계정 자료를 정리하지 못했습니다. 브라우저 저장 권한을 확인하고 다시 시도해 주세요.');
}
