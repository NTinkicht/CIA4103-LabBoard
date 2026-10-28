import {randomUUID} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {RoomServiceClient,TrackSource} from 'livekit-server-sdk';
import {ROOM,configured,lecturerAuthorized,teacherAuthorized} from '../lib/live-auth.mjs';
import {pickStudent} from '../lib/random-student.mjs';

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
// A lecturer switches the displayed screen, NOT a student's browser capture.
// Published student tracks remain available in standby and can resume instantly.
// Restrict the draw to students currently connected to the sharing queue.
// This cannot launch screen capture: that browser permission remains student-only.
export function randomScreenParticipant(participants,choose){
 const eligible=participants.filter(p=>meta(p).role==='student'&&
   /^student-[a-f0-9-]{36}$/.test(p.identity));
 const current=eligible.find(p=>['active','approved'].includes(meta(p).status))?.identity||null;
 return pickStudent(eligible,current,p=>p.identity,choose);
}
export async function switchPresenter(api,identity){
 let people=await api.listParticipants(ROOM);
 const students=people.filter(p=>meta(p).role==='student');
 const target=identity?students.find(p=>p.identity===identity):null;
 if(identity&&!target)return {error:'This student has disconnected. Refresh the list.',status:404};
 // Demote other presenters first. Do not revoke their publishing permissions.
 for(const student of students){
  if(student.identity===identity)continue;
  if(['active','approved'].includes(meta(student).status)){
   await api.updateParticipant(ROOM,student.identity,{
    metadata:JSON.stringify({role:'student',status:student.permission?.canPublish?'standby':'waiting'})
   });
  }
 }
 if(target){
  const existingPermission=Boolean(target.permission?.canPublish);
  await api.updateParticipant(ROOM,identity,{
   ...(existingPermission?{}:{permission:{
    canPublish:true,canSubscribe:false,canPublishData:false,
    canPublishSources:[TrackSource.SCREEN_SHARE]
   }}),
   metadata:JSON.stringify({role:'student',status:'active'})
  });
 }
 people=await api.listParticipants(ROOM);
 const refreshed=people.filter(p=>meta(p).role==='student');
 const selected=refreshed.filter(p=>['active','approved'].includes(meta(p).status));
 if(selected.length!==(identity?1:0)||
   identity&&(!selected[0]||selected[0].identity!==identity||!selected[0].permission?.canPublish)){
  // Fail closed for what is shown, but preserve student's running window capture.
  for(const student of selected){
   await api.updateParticipant(ROOM,student.identity,{
    metadata:JSON.stringify({role:'student',status:student.permission?.canPublish?'standby':'waiting'})
   });
  }
  return {error:'Could not establish a single selected screen.',status:409};
 }
 return {active:identity||null,connected:refreshed.length,
   standby:refreshed.filter(p=>p.permission?.canPublish&&p.identity!==identity).length};
}
export default async function handler(req){
 if(req.method!=='POST')return respond({error:'POST required'},405);
 if(!configured())return respond({error:'LiveKit is not configured'},503);
 let data;
 try{
  const body=await req.text();if(body.length>2800)return respond({error:'Request too large'},413);
  data=JSON.parse(body);
 }catch{return respond({error:'Invalid request'},400)}
 if(!await lecturerAuthorized(data))return respond({error:'Lecturer authorization failed'},403);
 if(!['approve','stop','random'].includes(data.action))return respond({error:'Unknown action'},400);
 if(data.action==='approve'&&(!/^student-[a-f0-9-]{36}$/.test(data.identity||'')))return respond({error:'Invalid student'},400);
 let lease,store;
 try{
  store=getStore({name:'cia4103-screen-control',consistency:'strong'});
  lease=await acquire(store);
  if(!lease)return respond({error:'A lecturer action is already in progress. Please retry in a moment.'},409);
  // Stop means hide the selected screen; students may remain in standby.
  const api=service();
  let targetId=data.action==='approve'?data.identity:null;
  let chosenName=null;
  if(data.action==='random'){
    // Only connected LiveKit students are eligible; other classroom members
    // must first join the sharing queue from their own browser.
    const participants=await api.listParticipants(ROOM);
    const winner=randomScreenParticipant(participants);
    if(!winner)return respond({error:'No students are connected to Screen Sharing yet. Ask students to open Screen Share and join the queue.'},409);
    targetId=winner.identity;
    chosenName=winner.name||'Student';
  }
  const result=await switchPresenter(api,targetId);
  return result.error?respond({error:result.error},result.status):
    respond({...result,...(data.action==='random'?{selectedName:chosenName,selectedIdentity:targetId}:{})});
 }catch(err){
  console.error('Live classroom control failure',{name:err?.name,category:'control'});
  return respond({error:'Could not switch the screen safely. Try again or check Netlify Functions logs.'},502);
 }finally{if(lease)await release(store,lease)}
}
