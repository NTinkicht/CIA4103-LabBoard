import {randomUUID} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {RoomServiceClient,TrackSource} from 'livekit-server-sdk';
import {ROOM,configured,teacherAuthorized} from '../lib/live-auth.mjs';

// One lecturer action at a time. The distributed lease serializes approvals
// from independent browsers/functions. Fail CLOSED if lease storage is unavailable.
const LOCK='lecturer-approval-lease';
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
function service(){
 return new RoomServiceClient(process.env.LIVEKIT_URL.replace(/^wss:\/\//,'https://'),
  process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET);
}
function meta(p){
 try{return JSON.parse(p.metadata||'{}')}catch{return{}}
}
export async function acquire(store,now=Date.now(),id=randomUUID()){
 const existing=await store.getWithMetadata(LOCK,{type:'json',consistency:'strong'});
 const lease={owner:id,expires:now+25000};
 if(existing?.data?.owner&&existing.data.expires>now)return null;
 const options=existing?{onlyIfMatch:existing.etag}:{onlyIfNew:true};
 const result=await store.setJSON(LOCK,lease,options);
 if(!result.modified||!result.etag)return null;
 return {owner:id,etag:result.etag};
}
export async function release(store,lease){
 if(!lease)return;
 try{await store.setJSON(LOCK,{owner:null,expires:0},{onlyIfMatch:lease.etag});}
 catch(err){console.error('Classroom control lease release failed',err?.name||'error');}
}
export async function switchPresenter(api,identity){
 let people=await api.listParticipants(ROOM);
 const students=people.filter(p=>meta(p).role==='student');
 if(identity&&!students.some(p=>p.identity===identity))return {error:'This student has disconnected. Refresh the waiting list.',status:404};
 // Fail-closed: revoke EVERY connected student's ability to publish FIRST,
 // regardless of whether their metadata says approved. The old screen track is unpublished.
 for(const p of students){
  if(p.permission?.canPublish||meta(p).status==='approved'){
   await api.updateParticipant(ROOM,p.identity,{
    permission:{canPublish:false,canSubscribe:false,canPublishData:false,canPublishSources:[]},
    metadata:JSON.stringify({role:'student',status:'waiting'})
   });
  }
 }
 if(identity){
  await api.updateParticipant(ROOM,identity,{
   permission:{canPublish:true,canSubscribe:false,canPublishData:false,canPublishSources:[TrackSource.SCREEN_SHARE]},
   metadata:JSON.stringify({role:'student',status:'approved'})
  });
 }
 // Post-condition check. Do not return success if multiple students can publish.
 people=await api.listParticipants(ROOM);
 const publishing=people.filter(p=>meta(p).role==='student'&&p.permission?.canPublish);
 if(publishing.length>1||identity&&(publishing.length!==1||publishing[0].identity!==identity)){
  // Best effort to fail closed; do not falsely claim successful authorization.
  for(const p of publishing)await api.updateParticipant(ROOM,p.identity,{
   permission:{canPublish:false,canSubscribe:false,canPublishData:false,canPublishSources:[]},
   metadata:JSON.stringify({role:'student',status:'waiting'})
  });
  return {error:'Could not establish exclusive screen-sharing permissions. Try again.',status:409};
 }
 return {active:identity||null,connected:students.length};
}
export default async function handler(req){
 if(req.method!=='POST')return respond({error:'POST required'},405);
 if(!configured())return respond({error:'LiveKit is not configured'},503);
 let data;
 try{
  const body=await req.text();if(body.length>1000)return respond({error:'Request too large'},413);
  data=JSON.parse(body);
 }catch{return respond({error:'Invalid request'},400)}
 if(!teacherAuthorized(data.pin))return respond({error:'Lecturer authorization failed'},403);
 if(!['approve','stop'].includes(data.action))return respond({error:'Unknown action'},400);
 if(data.action==='approve'&&(!/^student-[a-f0-9-]{36}$/.test(data.identity||'')))return respond({error:'Invalid student'},400);
 let lease,store;
 try{
  store=getStore({name:'cia4103-screen-control',consistency:'strong'});
  lease=await acquire(store);
  if(!lease)return respond({error:'A lecturer action is already in progress. Please retry in a moment.'},409);
  const result=await switchPresenter(service(),data.action==='approve'?data.identity:null);
  return result.error?respond({error:result.error},result.status):respond(result);
 }catch(err){
  console.error('Live classroom control failure',{name:err?.name,category:'control'});
  return respond({error:'Could not switch the screen safely. Try again or check Netlify Functions logs.'},502);
 }finally{if(lease)await release(store,lease)}
}
