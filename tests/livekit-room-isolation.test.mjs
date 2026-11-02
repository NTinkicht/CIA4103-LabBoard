import test from 'node:test';
import assert from 'node:assert/strict';
import {ROOM,screenRoomName,lecturerScreenRoom,studentScreenRoom} from '../netlify/lib/live-auth.mjs';
import {switchPresenter,acquire,release} from '../netlify/functions/live-control.mjs';

const now=1_800_000_000_000;
function provider(room){
 return ()=>({get:async key=>key==='room/123456'?room:null});
}
test('each Toolkit classroom has an independent LiveKit room',()=>{
 assert.notEqual(screenRoomName('123456'),screenRoomName('654321'));
 assert.notEqual(screenRoomName('123456'),ROOM);
 const token=Buffer.from(JSON.stringify({code:'123456',role:'teacher'})).toString('base64url')+'.signature';
 assert.equal(lecturerScreenRoom({toolkitToken:token}),screenRoomName('123456'));
 assert.equal(lecturerScreenRoom({pin:'legacy'}),ROOM);
 assert.equal(lecturerScreenRoom({toolkitToken:'bad'}),null);
});
test('students only enter an existing unexpired Toolkit classroom',async()=>{
 const active={code:'123456',ended:false,expiresAt:now+1000};
 assert.equal(await studentScreenRoom({code:'123456'},provider(active),now),screenRoomName('123456'));
 assert.equal(await studentScreenRoom({code:'123456'},provider({...active,ended:true}),now),null);
 assert.equal(await studentScreenRoom({code:'123456'},provider({...active,expiresAt:now}),now),null);
 assert.equal(await studentScreenRoom({code:'654321'},provider(active),now),null);
 assert.equal(await studentScreenRoom({code:'abc'},provider(active),now),null);
 assert.equal(await studentScreenRoom({},provider(active),now),ROOM);
});
test('presenter operations target only the requested room',async()=>{
 const touched=[];
 const api={listParticipants:async name=>(touched.push(name),[])};
 assert.deepEqual(await switchPresenter(api,null,screenRoomName('123456')),{active:null,connected:0,standby:0});
 assert.deepEqual(touched,[screenRoomName('123456'),screenRoomName('123456')]);
});
test('approval leases can coexist across different classroom room keys',async()=>{
 const records=new Map();
 const store={
  getWithMetadata:async key=>records.get(key)||null,
  setJSON:async(key,data,options)=>{
   const old=records.get(key);
   if(options?.onlyIfNew&&old)return {modified:false};
   if(options?.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};
   const etag=String(Math.random());
   records.set(key,{data,etag});
   return {modified:true,etag};
  }
 };
 const a=await acquire(store,now,'a','lease/123456');
 const b=await acquire(store,now,'b','lease/654321');
 assert.ok(a&&b);
 assert.equal(await acquire(store,now,'c','lease/123456'),null);
 await release(store,a);
 assert.ok(await acquire(store,now,'d','lease/123456'));
});
