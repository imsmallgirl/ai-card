import { AuthenticationError } from '../server-auth.ts';
import { StudyError } from './study-service.ts';
import { readStudyBody } from './study-http.ts';
import { operationalLog } from './operational-log.ts';

export function createAccountDeleteHandler(deps:{authenticate:(request:Request)=>Promise<{uid:string;auth_time?:number}>;remove:(uid:string)=>Promise<void>;clock?:()=>number}) {
  return async(request:Request)=>{
    const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    try{
      const user=await deps.authenticate(request);
      if(request.method!=='POST')return reply({code:'METHOD_NOT_ALLOWED',error:'지원하지 않는 요청입니다.'},405);
      if(!user.auth_time||Math.abs((deps.clock?.()??Date.now())/1000-user.auth_time)>300)throw new StudyError('RECENT_LOGIN_REQUIRED','계정 삭제 전 Google로 다시 인증해 주세요.',401);
      const body=await readStudyBody(request);
      if(!body||typeof body!=='object'||!('confirmation' in body)||body.confirmation!=='DELETE_MY_ACCOUNT')throw new StudyError('CONFIRMATION_REQUIRED','계정 삭제 확인이 필요합니다.',400);
      // UID is always from verified authentication, never from the body.
      await deps.remove(user.uid);return reply({deleted:true});
    }catch(cause){
      if(cause instanceof AuthenticationError)return reply({code:'UNAUTHENTICATED',error:'다시 로그인해 주세요.'},401);
      if(cause instanceof StudyError)return reply({code:cause.code,error:cause.message},cause.status);
      const errorId=operationalLog('account','ACCOUNT_DELETE_FAILED');
      return reply({code:'ACCOUNT_DELETE_FAILED',error:'삭제를 완료하지 못했습니다. 다시 인증하여 재시도해 주세요. 삭제 중인 계정의 새 저장은 차단됩니다.',errorId},503);
    }
  };
}
