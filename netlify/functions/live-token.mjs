import {randomUUID} from 'node:crypto';
import {AccessToken,RoomServiceClient,TrackSource} from 'livekit-server-sdk';
import {ROOM,configured,lecturerAuthorized,teacherAuthorized,publicName} from '../lib/live-auth.mjs';
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
  if(isTeacher&&!await lecturerAuthorized(data))return res({error:'Lecturer session has expired or is unauthorized'},403);
  if(!isTeacher&&(typeof data.name!=='string'||!publicName(data.name).trim()))return res({error:'Enter your name before sharing.'},400);
  // Verify that the configured API key, secret, and URL actually work for
  // the lecturer before issuing room tokens. Merely having env vars is not
  // sufficient to establish valid LiveKit authentication.
  if(isTeacher){
   try{
    const host=process.env.LIVEKIT_URL.replace(/^wss:\/\//,'https://');
    const api=new RoomServiceClient(host,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
    await api.listRooms();
   }catch(err){
    const msg=String(err?.message||'');
    if(/401|unauthoriz|invalid.api.key|invalid.token|signature/i.test(msg))
      return res({error:'LiveKit rejected the API key or secret for this project URL. In LiveKit Cloud, create a NEW API key/secret pair for the project, replace both matching variables in Netlify, verify LIVEKIT_URL and redeploy. Do not share the secret.'},502);
    console.error('LiveKit credential preflight', {name:err?.name,kind:'upstream-connection-error'});
    return res({error:'Could not verify the LiveKit Cloud connection. Check the project URL, LiveKit service status and the Netlify Function logs.'},502);
   }
  }
  // Never put a person's name in participant identity or room name.
  const identity=(isTeacher?'lecturer-':'student-')+randomUUID();
  const display=isTeacher?'Lecturer':publicName(data.name);
  const token=new AccessToken(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET,{
   identity,name:display,ttl:isTeacher?'30m':'15m',metadata:JSON.stringify({role:data.role,status:isTeacher?'lecturer':'waiting'})
  });
  // SDK expects numeric protobuf enum values, not the client-side 'screen_share' string.
  // Students enter a waiting lobby with NO publish or subscribe permissions. Only the lecturer can authorize one screen at a time through live-control.
  token.addGrant({roomJoin:true,room:ROOM,canPublish:false,canPublishSources:isTeacher?[]:[TrackSource.SCREEN_SHARE],canSubscribe:isTeacher,canPublishData:false});
  return res({url:process.env.LIVEKIT_URL,token:await token.toJwt(),identity,display});
  }catch(e){
  const description=String(e?.message||'');
  // Never send key material, JWTs or raw SDK exceptions to the browser.
  console.error('LiveKit token initialization failed',{name:e?.name,category:/secret|api.key|credential/i.test(description)?'credential-configuration':'unexpected'});
  const credentials=/secret|api.key|credential|length|sign/i.test(description);
  return res({error:credentials?'LiveKit token setup failed. Ask the lecturer to verify the project API key and matching API secret in Netlify and redeploy.':'The screen-sharing session could not start. Ask the lecturer to check Netlify Functions logs.'},500);
 }
}
