import {RoomServiceClient} from 'livekit-server-sdk';
import {ROOM,configured,teacherAuthorized} from '../lib/live-auth.mjs';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const res=(x,status=200)=>new Response(JSON.stringify(x),{status,headers});
export default async function handler(req){
 if(req.method!=='POST')return res({error:'POST required'},405);
 if(!configured())return res({error:'LiveKit is not configured.'},503);
 try{
  const raw=await req.text();if(raw.length>250)return res({error:'Invalid request'},400);
  const {pin}=JSON.parse(raw);if(!teacherAuthorized(pin))return res({error:'Lecturer access denied'},403);
  const host=process.env.LIVEKIT_URL.replace(/^wss:\/\//,'https://');
  const api=new RoomServiceClient(host,process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
  let people=[];try{people=await api.listParticipants(ROOM);}catch(e){if(/not found|does not exist|404/i.test(String(e)))return res({streams:[]});throw e;}
  const streams=people.flatMap(p=>{
   let metadata={};try{metadata=JSON.parse(p.metadata||'{}');}catch{}
   return metadata.role==='student'?[{
    identity:p.identity,name:p.name||'Student',connected:true,
    status:p.permission?.canPublish?'approved':'waiting',
    approved:Boolean(p.permission?.canPublish),
    sharing:Boolean(p.tracks?.some(t=>t.source===3&&!t.muted))
   }]:[];
  });
  return res({streams,active:streams.find(s=>s.approved)?.identity||null});
 }catch(e){console.error('LiveKit participants',e);return res({error:'Could not list screen sharers.'},502);}
}
