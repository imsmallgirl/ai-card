const areas=['study','generation','account','next'] as const;
const codes=['UNEXPECTED_FAILURE','ACCOUNT_DELETE_FAILED','REQUEST_ERROR'] as const;
// Fixed labels only: never pass exception messages, URLs, request bodies, headers or UIDs.
export function operationalLog(area:typeof areas[number],code:typeof codes[number],write:(line:string)=>void=console.error) {
  const id=crypto.randomUUID();
  write(JSON.stringify({event:'app_error',id,area:areas.includes(area)?area:'next',code:codes.includes(code)?code:'UNEXPECTED_FAILURE',at:new Date().toISOString()}));
  return id;
}
