import { webAnalyticsConfig } from './web-analytics-model.ts';
type Finding={level:'error'|'warning';code:string;message:string};
export function releaseConfig(env:Record<string,string|undefined>):Finding[] {
  const findings:Finding[]=[];
  const add=(code:string,message:string,level:'error'|'warning'='error')=>findings.push({level,code,message});
  for(const key of ['NEXT_PUBLIC_FIREBASE_API_KEY','NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN','NEXT_PUBLIC_FIREBASE_PROJECT_ID','NEXT_PUBLIC_FIREBASE_APP_ID','SITE_OPERATOR_NAME','SUPPORT_EMAIL'])if(!env[key]?.trim())add('MISSING_ENV',`${key} 설정이 필요합니다.`);
  if(env.FIREBASE_PROJECT_ID&&env.FIREBASE_PROJECT_ID!==env.NEXT_PUBLIC_FIREBASE_PROJECT_ID)add('PROJECT_MISMATCH','서버/브라우저 Firebase 프로젝트가 다릅니다.');
  if(env.FIRESTORE_SYNC_ENABLED!=='true'||env.NEXT_PUBLIC_FIRESTORE_SYNC_ENABLED!=='true')add('SYNC_DISABLED','MVP 클라우드 저장에는 두 Firestore 동기화 플래그가 모두 true여야 합니다.');
  if(env.FIRESTORE_EMULATOR_HOST||env.FIREBASE_AUTH_EMULATOR_HOST)add('EMULATOR_IN_PRODUCTION','운영 환경에서 에뮬레이터 설정을 제거하세요.');
  if(env.AI_PROVIDER==='mock')add('MOCK_IN_PRODUCTION','운영 AI_PROVIDER는 gemini여야 합니다.');
  if(env.AI_GENERATION_UNLIMITED==='true')add('UNLIMITED_IN_PRODUCTION','운영 AI_GENERATION_UNLIMITED는 false로 설정하세요.');
  if(env.AI_GENERATION_ENABLED==='true'&&!env.GEMINI_API_KEY?.trim())add('AI_KEY_REQUIRED','AI를 활성화하려면 서버 GEMINI_API_KEY가 필요합니다.');
  if(env.AI_GENERATION_ENABLED!=='true')add('AI_DISABLED','AI 생성은 비활성화됩니다. 자료 규칙 추출과 직접 만들기는 이용 가능합니다.','warning');
  const limits:Record<string,[number,number]>={AI_DAILY_LIMIT:[0,1000],AI_GLOBAL_DAILY_ATTEMPTS:[0,1000000],AI_GLOBAL_DAILY_TOKEN_BUDGET:[0,1000000000],AI_MAX_OUTPUT_TOKENS:[256,16384],AI_COOLDOWN_SECONDS:[0,3600],AI_FAILURE_COOLDOWN_SECONDS:[0,3600]};
  for(const [key,[min,max]] of Object.entries(limits)){
    const value=env[key];if(value!==undefined&&(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max))add('INVALID_BUDGET',`${key}의 허용 범위를 확인하세요.`);
  }
  if(env.AI_PROVIDER&&env.AI_PROVIDER!=='gemini'&&env.AI_PROVIDER!=='mock')add('INVALID_PROVIDER','AI_PROVIDER 설정이 유효하지 않습니다.');
  if(env.GEMINI_MODEL&&!/^(?:models\/)?gemini-[a-zA-Z0-9][a-zA-Z0-9._-]{0,110}$/.test(env.GEMINI_MODEL.trim()))add('INVALID_MODEL','GEMINI_MODEL 형식을 확인하세요. 실제 모델 접근 권한은 별도 검증해야 합니다.');
  if(Object.entries(env).some(([key,value])=>value&&/^NEXT_PUBLIC_.*(?:GEMINI|PRIVATE_KEY|SERVICE_ACCOUNT|GA4_API_SECRET|CREDENTIAL)/i.test(key)))add('PUBLIC_SECRET','서버 인증 정보가 NEXT_PUBLIC 변수에 설정되어 있습니다. 제거하고 노출된 키는 교체하세요.');
  try{const url=new URL(env.SITE_URL||'');if(url.protocol!=='https:'||url.username||url.password||url.hostname==='localhost'||url.hostname==='127.0.0.1'||url.pathname!=='/'||url.search||url.hash)throw new Error();}catch{add('SITE_URL_REQUIRED','SITE_URL에 운영 HTTPS origin을 설정하세요.');}
  if(env.SUPPORT_EMAIL&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SUPPORT_EMAIL))add('INVALID_CONTACT','SUPPORT_EMAIL의 이메일 형식을 확인하세요.');
  if(env.PRIVACY_POLICY_CONFIRMED!=='true')add('POLICY_REVIEW_REQUIRED','운영 정보·보관/삭제 정책을 검토한 뒤 PRIVACY_POLICY_CONFIRMED=true로 설정하세요.');
  if(env.NEXT_PUBLIC_GA4_ENABLED==='true'&&!webAnalyticsConfig(env).enabled)add('GA4_PREFLIGHT_REQUIRED','GA4 측정 ID·공개 origin·수동 측정 검토 확인이 필요합니다.');
  if(env.ANALYTICS_ENABLED==='true'||env.ANALYTICS_EXPORT_ENABLED==='true'||env.NEXT_PUBLIC_ANALYTICS_ENABLED==='true'||env.NEXT_PUBLIC_GA4_ENABLED==='true')add('ANALYTICS_REVIEW','선택적 분석이 활성화되어 있습니다. 동의·외부 전송 설정을 별도로 검증하세요.','warning');
  return findings;
}
