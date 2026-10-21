import {randomUUID} from 'node:crypto';
import {AccessToken} from 'livekit-server-sdk';
import {ROOM,configured,teacherAuthorized,publicName,allowedPart} from '../lib/live-auth.mjs';
const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const res=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
export default async function handler(req){
 if(req.method!=='POST')return res({error:'POST required'},405);
 if(!configured())return res({error:'Screen sharing is not configured on this Netlify deployment. Check that LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and CIA4103_TEACHER_PIN are set for Functions (12+ character PIN), then redeploy.'},503);
 try{
  if(Number(req.headers.get('content-length')||0)>2400)return res({error:'Request too large'},413);
  const raw=await req.text();if(raw.length>2400)return res({error:'Request too large'},413);
  const data=JSON.parse(raw);
  if(data.role!=='teacher'&&data.role!=='student')return res({error:'Invalid role'},400);
  const isTeacher=data.role==='teacher';
  if(isTeacher&&!teacherAuthorized(data.pin))return res({error:'Invalid lecturer PIN'},403);
  if(!isTeacher&&!allowedPart(data.part))return res({error:'Enter the lab or activity before sharing.'},400);
  if(!isTeacher&&(!data.name||!publicName(data.name).trim()))return res({error:'Enter your name before sharing.'},400);
  // Never put a person's name in participant identity or room name.
  const identity=(isTeacher?'lecturer-':'student-')+randomUUID();
  const display=isTeacher?'Lecturer':publicName(data.name);
  const token=new AccessToken(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{
   identity,name:display,ttl:isTeacher?'30m':'15m',metadata:JSON.stringify({role:data.role,part:isTeacher?'':data.part.trim()})
  });
  token.addGrant({roomJoin:true,room:ROOM,canPublish:!isTeacher,canPublishSources:isTeacher?[]:['screen_share'],canSubscribe:isTeacher,canPublishData:false});
  return res({url:process.env.LIVEKIT_URL,token:await token.toJwt(),identity,display});
 }catch(e){console.error('LiveKit token issue',e);return res({error:'Unable to initialize secure screen sharing.'},500);}
}
