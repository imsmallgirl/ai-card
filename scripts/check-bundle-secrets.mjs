import { readdir,readFile } from 'node:fs/promises';
import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd(),false,{info:()=>{},error:()=>{}});
const names=['GEMINI_API_KEY','GA4_API_SECRET','FIREBASE_PRIVATE_KEY'];
const secrets=names.map(name=>process.env[name]).filter(value=>value&&value.length>=8);
async function files(root){const result=[];for(const item of await readdir(root,{withFileTypes:true})){const path=`${root}/${item.name}`;if(item.isDirectory())result.push(...await files(path));else result.push(path);}return result;}
try{
  const paths=await files('.next/static');let found=false;
  for(const path of paths){const data=await readFile(path,'utf8');if(secrets.some(secret=>data.includes(secret)||data.includes(JSON.stringify(secret).slice(1,-1))))found=true;}
  if(found){console.error('FAIL: 서버 비밀값이 브라우저 파일에서 발견되었습니다. 배포를 중단하고 노출된 키를 교체하세요.');process.exitCode=1;}
  else console.log(`Client bundle secret scan passed (${paths.length} files, ${secrets.length} configured secrets checked). Values were not printed.`);
}catch{console.error('빌드 결과를 확인하지 못했습니다. npm run build를 먼저 실행하세요.');process.exitCode=1;}
