import test from 'node:test';
import assert from 'node:assert/strict';
import {TrackSource} from 'livekit-server-sdk';
import {switchPresenter,acquire,release} from '../netlify/functions/live-control.mjs';
import {readFileSync} from 'node:fs';
const p=(id,status='waiting',canPublish=false)=>({
 identity:id,name:id,metadata:JSON.stringify({role:'student',status}),
 permission:{canPublish,canSubscribe:false,canPublishData:false,canPublishSources:canPublish?[TrackSource.SCREEN_SHARE]:[]},
 tracks:canPublish?[{source:TrackSource.SCREEN_SHARE,muted:false}]:[]
});
function fakeRoom(){
 const data=[p('student-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','approved',true),
             p('student-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')];
 const sequence=[];
 const api={
  listParticipants:async()=>data.map(x=>({...x,permission:{...x.permission}})),
  updateParticipant:async(_room,id,opts)=>{
   const user=data.find(x=>x.identity===id);
   assert.ok(user,'target student must be connected');
   Object.assign(user.permission,opts.permission||{});
   if(opts.metadata)user.metadata=opts.metadata;
   sequence.push({id,publish:user.permission.canPublish});
   return user;
  }
 };
 return {data,api,sequence};
}
test('approval revokes prior publisher before approving next',async()=>{
 const {data,api,sequence}=fakeRoom();
 const result=await switchPresenter(api,'student-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
 assert.equal(result.active,'student-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
 assert.deepEqual(sequence.map(x=>x.publish),[false,true]);
 assert.equal(data.filter(x=>x.permission.canPublish).length,1);
 assert.deepEqual(data.find(x=>x.permission.canPublish).permission.canPublishSources,[TrackSource.SCREEN_SHARE]);
 assert.equal(data.find(x=>x.permission.canPublish).permission.canSubscribe,false);
});
test('stopping shares revokes all student publish permissions',async()=>{
 const {data,api}=fakeRoom();
 const result=await switchPresenter(api,null);
 assert.equal(result.active,null);
 assert.ok(data.every(x=>x.permission.canPublish===false));
});
test('never approve a disconnected identity',async()=>{
 const {api,data}=fakeRoom();
 const result=await switchPresenter(api,'student-cccccccc-cccc-4ccc-cccc-cccccccccccc');
 assert.equal(result.status,404);
 assert.equal(data.filter(x=>x.permission.canPublish).length,1);
});
test('distributed lease refuses overlapping lecturer actions',async()=>{
 const storeData=new Map();
 const store={
  getWithMetadata:async key=>storeData.get(key)||null,
  setJSON:async(key,val,condition)=>{
   const old=storeData.get(key);
   if(condition.onlyIfNew&&old)return {modified:false};
   if(condition.onlyIfMatch&&old?.etag!==condition.onlyIfMatch)return {modified:false};
   const etag='"'+(storeData.size+Date.now()+Math.random())+'"';
   storeData.set(key,{data:val,etag});
   return {modified:true,etag};
  }
 };
 const a=await acquire(store,1000,'lecturer1');
 assert.ok(a);
 const b=await acquire(store,1100,'lecturer2');
 assert.equal(b,null);
 await release(store,a);
 const c=await acquire(store,1200,'lecturer3');
 assert.ok(c);
});
test('window capture is verified, and unauthorized screens are stopped',()=>{
 const code=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 assert.match(code,/monitorTypeSurfaces:'exclude'/);
 assert.match(code,/displaySurface:'window'/);
 assert.match(code,/surface!=='window'/);
 assert.match(code,/selected\.getTracks\(\)\.forEach\(t=>t\.stop\(\)\)/);
 assert.match(code,/ParticipantPermissionsChanged/);
});
test('lecturer viewer uses one large video and a waiting sidebar',()=>{
 const html=readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8');
 const client=readFileSync(new URL('../public/assets/live-teacher.mjs',import.meta.url),'utf8');
 assert.match(html,/grid-template-columns:minmax\(0,1fr\) 295px/);
 assert.match(client,/id="primary-stream-video"/);
 assert.match(client,/Approve & show/);
 assert.match(client,/id="stream-stop-all"/);
});
test('PDF limit is 50MB and green 5Es labels are removed',()=>{
 const pdf=readFileSync(new URL('../public/assets/lab-pdfs.mjs',import.meta.url),'utf8');
 const student=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const teacher=readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8');
 assert.match(pdf,/MAX=50\*1024\*1024/);
 assert.doesNotMatch(student,/<div class="kicker">5Es/i);
 assert.doesNotMatch(teacher,/<div class="kicker">5Es/i);
});
