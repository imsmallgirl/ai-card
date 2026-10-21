import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
import { releaseConfig } from '../src/lib/release-config.ts';
// Load the production env precedence, excluding .env.development.local. Never print values.
loadEnvConfig(process.cwd(),false,{info:()=>{},error:()=>{}});
const findings=releaseConfig(process.env);
for(const finding of findings)console.log(`[${finding.level}] ${finding.code}: ${finding.message}`);
if(findings.some(item=>item.level==='error'))process.exitCode=1;
else console.log('환경변수 정적 검사 통과. 인증/IAM·실제 모델·도메인·정책·화면 검증은 출시 체크리스트를 따르세요.');
