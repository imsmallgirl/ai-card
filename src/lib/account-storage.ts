export function clearAccountStorage(storage:Pick<Storage,'removeItem'|'getItem'>,uid:string) {
  for(const key of [
    `moa-study-user-${uid}`,`moa-study-cloud-v2-${uid}`,`moa-study-import-backup-${uid}`,
    `moa-study-imported-v1-${uid}`,`moa-generation-pending-${uid}`,`moa-material-ai-pending-${uid}`,
    `moa-analytics-consent-${uid}`,
  ])storage.removeItem(key);
  if(storage.getItem('moa-study-legacy-owner')===uid){storage.removeItem('moa-study-v1');storage.removeItem('moa-study-legacy-owner');}
}
