export function siteOrigin(value=process.env.SITE_URL):URL|undefined {
  if(!value)return undefined;
  try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)?new URL(url.origin):undefined;}catch{return undefined;}
}
