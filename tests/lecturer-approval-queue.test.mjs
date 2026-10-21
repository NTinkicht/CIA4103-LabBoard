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
test('switch A to B preserves A capture and selects B',async()=>{
 const {data,api,sequence}=fakeRoom();
 const selected='student-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
 const result=await switchPresenter(api,selected);
 assert.equal(result.active,selected);
 assert.equal(data.filter(x=>x.permission.canPublish).length,2);
 assert.ok(sequence.every(x=>x.publish),'no existing track permission should be revoked');
 assert.equal(JSON.parse(data[0].metadata).status,'standby');
 assert.equal(JSON.parse(data[1].metadata).status,'active');
 assert.deepEqual(data[1].permission.canPublishSources,[TrackSource.SCREEN_SHARE]);
 assert.equal(data[1].permission.canSubscribe,false);
});
test('returning to A does not require another screen selection',async()=>{
 const {data,api,sequence}=fakeRoom();
 await switchPresenter(api,'student-bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb');
 sequence.length=0;
 await switchPresenter(api,'student-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
 assert.equal(JSON.parse(data[0].metadata).status,'active');
 assert.equal(JSON.parse(data[1].metadata).status,'standby');
 assert.ok(sequence.every(x=>x.publish));
});
test('hiding screen preserves capture in standby',async()=>{
 const {data,api}=fakeRoom();
 const result=await switchPresenter(api,null);
 assert.equal(result.active,null);
 assert.equal(data[0].permission.canPublish,true);
 assert.equal(JSON.parse(data[0].metadata).status,'standby');
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
test('student maintains capture when lecturer changes the displayed stream',()=>{
 const code=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 assert.match(code,/ParticipantMetadataChanged/);
 assert.match(code,/if\(!approved&&capture\)stopCapture\(\)/);
 assert.match(code,/STANDBY · Video upload paused/);
 assert.match(code,/pauseUpstream\(\)/);
 assert.match(code,/resumeUpstream\(\)/);
 assert.doesNotMatch(code,/if\(!onAir&&capture\)stopCapture\(\)/);
});
test('standby pauses transmission without stopping the captured window',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function synchronizeUpstream(){');
 const end=source.indexOf('function permissionCheck(){',start);
 assert.ok(start>=0&&end>start);
 const calls=[],capture={getTracks(){throw Error('capture was stopped')}};
 const pub={
   isUpstreamPaused:false,
   async pauseUpstream(){calls.push('pause');this.isUpstreamPaused=true;},
   async resumeUpstream(){calls.push('resume');this.isUpstreamPaused=false;}
 };
 const context={publication:pub,capture,room:{},approved:true,onAir:false,
   upstreamSyncing:false,upstreamPending:false,
   sharingStatus(){},stopCapture(){throw Error('standby should not end local capture');},
   status(){},console};
 const sync=runInNewContext(source.slice(start,end)+'\nsynchronizeUpstream',context);
 await sync();
 assert.equal(pub.isUpstreamPaused,true,'video upload paused');
 assert.equal(context.capture,capture,'window capture is retained');
 context.onAir=true;await sync();
 assert.equal(pub.isUpstreamPaused,false,'same screen stream resumes');
 assert.deepEqual(calls,['pause','resume']);
});
test('rapid switches while pause is pending settle to the newest selection',async()=>{
 const {runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function synchronizeUpstream(){');
 const end=source.indexOf('function permissionCheck(){',start);
 const events=[];
 const context={publication:null,capture:{},room:{},approved:true,onAir:false,upstreamSyncing:false,upstreamPending:false,
   sharingStatus(){},stopCapture(){throw Error('capture must survive')},status(){},console};
 context.publication={
   isUpstreamPaused:false,
   async pauseUpstream(){events.push('pause');this.isUpstreamPaused=true;context.onAir=true;},
   async resumeUpstream(){events.push('resume');this.isUpstreamPaused=false;}
 };
 const sync=runInNewContext(source.slice(start,end)+'\nsynchronizeUpstream',context);
 await sync();
 assert.deepEqual(events,['pause','resume']);
 assert.equal(context.publication.isUpstreamPaused,false);
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
 assert.match(client,/Approve and show /);
 assert.match(client,/Resume /);
 assert.match(client,/stream-icon-action/);
 assert.match(client,/aria-label/);
 assert.match(client,/stream-filter/);
 assert.doesNotMatch(client,/button\.textContent=student\.presenting\?/);
 assert.match(client,/id="stream-stop-all"/);
 assert.match(client,/autoSubscribe:false/);
 assert.match(client,/setSubscribed\(false\)/);
 assert.match(client,/setSubscribed\(true\)/);
 assert.match(client,/STANDBY/);
});
test('compact lecturer roster supports 30 students without tall cards',()=>{
 const html=readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8');
 const client=readFileSync(new URL('../public/assets/live-teacher.mjs',import.meta.url),'utf8');
 assert.match(html,/\.stream-student\{display:grid;grid-template-columns:8px minmax\(0,1fr\) 34px/);
 assert.match(html,/min-height:46px/);
 assert.match(html,/\.stream-icon-action\{display:grid/);
 assert.match(html,/#stream-list\{flex:1;min-height:0;overflow-y:auto/);
 assert.match(client,/const term=\$\('stream-filter'\)/);
 assert.match(client,/button\.title=action/);
 assert.match(client,/button\.setAttribute\('aria-label',action\)/);
 assert.match(client,/panel\.scrollTop=scroll/);
});
test('an approved standby student resumes without a new screen picker',()=>{
 const student=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 assert.match(student,/room\.localParticipant\.on\(LivekitClient\.ParticipantEvent\.ParticipantMetadataChanged,permissionCheck\)/);
 assert.match(student,/await pub\.resumeUpstream\(\)/);
 assert.match(student,/if\(!room\|\|!approved\|\|!onAir\|\|capture\)/);
 const method=student.slice(student.indexOf('async function synchronizeUpstream(){'),student.indexOf('function permissionCheck(){'));
 assert.doesNotMatch(method,/void synchronizeUpstream\(\);\s*sharingStatus\(\);/,'do not recurse while synchronizing');
});
test('PDF limit is 50MB and green 5Es labels are removed',()=>{
 const pdf=readFileSync(new URL('../public/assets/lab-pdfs.mjs',import.meta.url),'utf8');
 const student=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const teacher=readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8');
 assert.match(pdf,/MAX=50\*1024\*1024/);
 assert.doesNotMatch(student,/<div class="kicker">5Es/i);
 assert.doesNotMatch(teacher,/<div class="kicker">5Es/i);
});
