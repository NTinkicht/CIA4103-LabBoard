import {createHash,timingSafeEqual} from 'node:crypto';
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
export const allowedPart=x=>typeof x==='string'&&/^(09a-[1-5]|09b-[1-3])$/.test(x);
