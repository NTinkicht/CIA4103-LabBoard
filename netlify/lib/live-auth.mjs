import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';
export const ROOM='cia4103-lab09-screen-shares';
export function configured(env=process.env){
 return Boolean(env.LIVEKIT_URL&&env.LIVEKIT_API_KEY&&env.LIVEKIT_API_SECRET&&env.CIA4103_TEACHER_PIN&&env.CIA4103_TEACHER_PIN.length>=12&&/^wss:\/\//.test(env.LIVEKIT_URL));
}
export function teacherAuthorized(candidate,env=process.env){
 if(!configured(env)||typeof candidate!=='string')return false;
 const hash=x=>createHash('sha256').update(x,'utf8').digest();
 return timingSafeEqual(hash(candidate),hash(env.CIA4103_TEACHER_PIN));
}
export const publicName=x=>typeof x==='string'?x.trim().slice(0,60).replace(/[\x00-\x1f\x7f]/g,''):'';
export const allowedPart=x=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=100&&!/[\x00-\x1f\x7f]/.test(x);


// Existing CIA4103 lecturer PIN still works on the standalone dashboard.
// The embedded Classroom Toolkit can authenticate using its *existing*
// HMAC-signed lecturer room session, without asking for the PIN again.
// A valid signature alone is not sufficient: verify the room still exists,
// has not expired and has not been ended by the lecturer.
export async function lecturerAuthorized(data,storeProvider=getStore,env=process.env,now=Date.now()){
 if(teacherAuthorized(data?.pin,env))return true;
 const value=data?.toolkitToken;
 const secret=env.TOOLKIT_SESSION_SECRET||env.LIVEKIT_API_SECRET||'';
 if(typeof value!=='string'||value.length>2200||secret.length<24)return false;
 const pieces=value.split('.');
 if(pieces.length!==2)return false;
 let signature;
 try{signature=Buffer.from(pieces[1],'base64url')}catch{return false}
 const expected=createHmac('sha256',secret).update(pieces[0]).digest();
 if(signature.length!==expected.length||!timingSafeEqual(signature,expected))return false;
 let claims;
 try{claims=JSON.parse(Buffer.from(pieces[0],'base64url').toString('utf8'))}
 catch{return false}
 if(claims?.role!=='teacher'||!/^[0-9]{6}$/.test(claims.code)||
   !Number.isFinite(claims.exp)||claims.exp<=now)return false;
 try{
  const room=await storeProvider({name:'classroom-toolkit-v1',consistency:'strong'})
    .get('room/'+claims.code,{type:'json',consistency:'strong'});
  return Boolean(room&&room.code===claims.code&&!room.ended&&
    Number.isFinite(room.expiresAt)&&room.expiresAt>now);
 }catch(error){
  console.error('Toolkit lecturer session verification unavailable',error?.name||'error');
  return false;
 }
}
