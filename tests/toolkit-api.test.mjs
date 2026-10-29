import test from 'node:test';
import assert from 'node:assert/strict';
import {handleToolkit,aggregate,validText} from '../netlify/functions/toolkit.mjs';

process.env.CIA4103_TEACHER_PIN='unit-test-only-super-secret-teacher-pin';
process.env.TOOLKIT_SESSION_SECRET='unit-test-only-private-signing-key-please-ignore';

class FakeStore {
  constructor(){this.values=new Map();this.sequence=0}
  clone(value){return JSON.parse(JSON.stringify(value))}
  async get(key){return this.values.has(key)?this.clone(this.values.get(key).data):null}
  async getWithMetadata(key){const v=this.values.get(key);return v?{data:this.clone(v.data),etag:v.etag}:null}
  async setJSON(key,data,options={}){
    const old=this.values.get(key);
    if(options.onlyIfNew&&old)return {modified:false};
    if(options.onlyIfMatch&&(!old||old.etag!==options.onlyIfMatch))return {modified:false};
    const etag=String(++this.sequence);
    this.values.set(key,{data:this.clone(data),etag});
    return {modified:true,etag};
  }
  async list({prefix}){return {blobs:[...this.values.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))}}
}
async function call(store,payload){
 const response=await handleToolkit(new Request('https://toolkit.example/.netlify/functions/toolkit',{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
 }),()=>store);
 return {status:response.status,body:await response.json()};
}
function created(store){return call(store,{action:'create',pin:process.env.CIA4103_TEACHER_PIN})}
function join(store,code,name,team=''){return call(store,{action:'join',code,name,team})}
function start(store,token,type,other={}){return call(store,{action:'start',token,type,...other})}
function state(store,token){return call(store,{action:'state',token})}

test('validation rejects controls while allowing multilingual words',()=>{
 assert.equal(validText('عنق الزجاجة',40),true);
 assert.equal(validText('bad\u0000text',40),false);
 assert.equal(validText('a'.repeat(41),40),false);
 const stats=aggregate({type:'cloud'},[
  {value:' Delay ',hidden:false},{value:'delay',hidden:false},
  {value:'Other',hidden:true}]);
 assert.equal(stats.total,2);
 assert.deepEqual(stats.words,[{word:'Delay',count:2}]);
});

test('separate rooms have independent roles, live polls and final vote totals',async()=>{
 const store=new FakeStore();
 const a=(await created(store)).body,b=(await created(store)).body;
 assert.notEqual(a.code,b.code);
 const learner=(await join(store,a.code,'Student A')).body;
 const opened=await start(store,a.teacherToken,'poll',{options:['Option 1','Option 2','Option 3'],prompt:''});
 assert.equal(opened.status,200);
 const id=opened.body.active.id;
 const first=await call(store,{action:'submit',token:learner.token,roundId:id,value:0,revision:0});
 assert.equal(first.status,200);
 const second=await call(store,{action:'submit',token:learner.token,roundId:id,value:2,revision:1});
 assert.equal(second.status,200);
 const teacher=await state(store,a.teacherToken);
 assert.deepEqual(teacher.body.results.votes,[0,0,1]);
 assert.equal(teacher.body.results.total,1);
 const foreign=await state(store,b.teacherToken);
 assert.equal(foreign.body.active,null);
 const foreignJoin=await call(store,{action:'state',token:'bogus'});
 assert.equal(foreignJoin.status,401);
 const studentAdmin=await call(store,{action:'start',token:learner.token,type:'poll',options:['a','b']});
 assert.equal(studentAdmin.status,403);
 const projector=await state(store,a.displayToken);
 assert.equal(projector.body.results,undefined);
 const reveal=await call(store,{action:'control',token:a.teacherToken,roundId:id,control:'reveal'});
 assert.equal(reveal.status,200);
 assert.deepEqual((await state(store,a.displayToken)).body.results.votes,[0,0,1]);
});

test('open answers require lecturer approval before projector exposure',async()=>{
 const store=new FakeStore(),room=(await created(store)).body,learner=(await join(store,room.code,'Learner')).body;
 const round=(await start(store,room.teacherToken,'answers')).body.active.id;
 assert.equal((await call(store,{action:'submit',token:learner.token,roundId:round,value:'My idea',revision:0})).status,200);
 const teacher=(await state(store,room.teacherToken)).body;
 assert.equal(teacher.answers.length,1);
 assert.equal(teacher.answers[0].hidden,true);
 await call(store,{action:'control',token:room.teacherToken,roundId:round,control:'reveal'});
 const before=(await state(store,room.displayToken)).body;
 assert.deepEqual(before.answers,[]);
 const subject=teacher.answers[0].subject;
 assert.equal((await call(store,{action:'moderate',token:room.teacherToken,roundId:round,subject,hidden:false})).status,200);
 const after=(await state(store,room.displayToken)).body;
 assert.equal(after.answers[0].value,'My idea');
 assert.equal(after.answers[0].name,undefined);
});

test('pair responses conflict safely; stale activity controls cannot affect the new round',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const s1=(await join(store,room.code,'A','Pair 01')).body;
 const s2=(await join(store,room.code,'B','Pair 01')).body;
 const id=(await start(store,room.teacherToken,'answers',{unit:'pair'})).body.active.id;
 assert.equal((await call(store,{action:'submit',token:s1.token,roundId:id,value:'Initial',revision:0})).status,200);
 const conflict=await call(store,{action:'submit',token:s2.token,roundId:id,value:'Overwrite',revision:0});
 assert.equal(conflict.status,409);
 assert.equal((await state(store,s2.token)).body.mine.value,'Initial');
 assert.equal((await call(store,{action:'submit',token:s2.token,roundId:id,value:'Revised',revision:1})).status,200);
 assert.equal((await state(store,room.teacherToken)).body.answers.length,1);
 const next=(await start(store,room.teacherToken,'timer',{duration:60})).body.active.id;
 assert.notEqual(id,next);
 assert.equal((await call(store,{action:'control',token:room.teacherToken,roundId:id,control:'close'})).status,409);
 assert.equal((await call(store,{action:'submit',token:s1.token,roundId:id,value:'Late',revision:2})).status,409);
 assert.equal((await state(store,room.teacherToken)).body.active.id,next);
});

test('closing a room invalidates all student and projector sessions',async()=>{
 const store=new FakeStore(),room=(await created(store)).body,student=(await join(store,room.code,'Learner')).body;
 assert.equal((await call(store,{action:'control',token:room.teacherToken,control:'end'})).status,200);
 assert.equal((await state(store,student.token)).status,410);
 assert.equal((await state(store,room.displayToken)).status,410);
 assert.equal((await join(store,room.code,'Late Learner')).status,404);
});


test('lecturer saves polls, edits them and retrieves them after starting another classroom',async()=>{
 const store=new FakeStore();
 const first=(await created(store)).body;
 const poll={title:'Week 8 — Flow Analysis',prompt:'Which step takes longest?',options:['Approval','Recording','Review'],unit:'pair'};
 const save=await call(store,{action:'library',operation:'save',token:first.teacherToken,poll});
 assert.equal(save.status,201);
 assert.equal(save.body.poll.revision,1);
 const loaded=await call(store,{action:'library',operation:'list',token:first.teacherToken});
 assert.equal(loaded.body.polls.length,1);
 assert.equal(loaded.body.polls[0].title,poll.title);
 const student=(await join(store,first.code,'Test student')).body;
 assert.equal((await call(store,{action:'library',operation:'list',token:student.token})).status,403);
 assert.equal((await call(store,{action:'library',operation:'list',token:first.displayToken})).status,403);
 const update=await call(store,{action:'library',operation:'save',token:first.teacherToken,
   id:save.body.poll.id,revision:1,poll:{...poll,options:['Yes','No'],unit:'individual'}});
 assert.equal(update.status,200);
 assert.equal(update.body.poll.revision,2);
 assert.equal((await call(store,{action:'library',operation:'save',token:first.teacherToken,
   id:save.body.poll.id,revision:1,poll})).status,409);
 const second=(await created(store)).body;
 const fromNewRoom=await call(store,{action:'library',operation:'list',token:second.teacherToken});
 assert.equal(fromNewRoom.status,200);
 assert.deepEqual(fromNewRoom.body.polls[0].options,['Yes','No']);
 assert.equal((await call(store,{action:'library',operation:'delete',token:second.teacherToken,id:save.body.poll.id})).status,200);
 assert.equal((await call(store,{action:'library',operation:'list',token:first.teacherToken})).body.polls.length,0);
});
test('saved poll API rejects invalid questions and too many options',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const base={title:'Poll',prompt:'',unit:'individual',options:['Yes','No']};
 const bad=[
   {...base,title:''},
   {...base,options:['Only one']},
   {...base,options:Array.from({length:9},(_,i)=>'Choice '+i)},
   {...base,prompt:'x'.repeat(241)},
   {...base,options:['Yes','']}
 ];
 for (const poll of bad){
  const result=await call(store,{action:'library',operation:'save',token:room.teacherToken,poll});
  assert.equal(result.status,400);
 }
});


test('saved Word Cloud and Live Answers questions persist across classrooms without mixing types',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const cloud={title:'Brainstorm',prompt:'One word to describe slow service?',unit:'pair'};
 const open={title:'Exit ticket',prompt:'What would you improve?',unit:'individual'};
 const a=await call(store,{action:'library',kind:'cloud',operation:'save',token:room.teacherToken,item:cloud});
 const b=await call(store,{action:'library',kind:'answers',operation:'save',token:room.teacherToken,item:open});
 assert.equal(a.status,201);assert.equal(b.status,201);
 assert.equal(a.body.item.kind,'cloud');assert.equal(b.body.item.kind,'answers');
 assert.equal((await call(store,{action:'library',kind:'poll',operation:'list',token:room.teacherToken})).body.items.length,0);
 assert.equal((await call(store,{action:'library',kind:'cloud',operation:'list',token:room.teacherToken})).body.items.length,1);
 assert.equal((await call(store,{action:'library',kind:'answers',operation:'list',token:room.teacherToken})).body.items.length,1);
 const room2=(await created(store)).body;
 const loaded=await call(store,{action:'library',kind:'cloud',operation:'list',token:room2.teacherToken});
 assert.equal(loaded.body.items[0].prompt,cloud.prompt);
 const updated=await call(store,{action:'library',kind:'cloud',operation:'save',token:room2.teacherToken,
  id:a.body.item.id,revision:1,item:{...cloud,prompt:'Name a bottleneck'}});
 assert.equal(updated.status,200);
 assert.equal(updated.body.item.revision,2);
 assert.equal((await call(store,{action:'library',kind:'cloud',operation:'save',token:room.teacherToken,
  id:a.body.item.id,revision:1,item:cloud})).status,409);
 assert.equal((await call(store,{action:'library',kind:'cloud',operation:'delete',token:room2.teacherToken,id:a.body.item.id})).status,200);
 assert.equal((await call(store,{action:'library',kind:'cloud',operation:'list',token:room.teacherToken})).body.items.length,0);
 assert.equal((await call(store,{action:'library',kind:'answers',operation:'list',token:room.teacherToken})).body.items.length,1);
});
test('saved open question validates prompt and rejects nonlecturer access',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 for (const kind of ['answers','cloud']){
  for (const prompt of ['', ' '.repeat(7), 'x'.repeat(241)]){
   assert.equal((await call(store,{action:'library',operation:'save',kind,token:room.teacherToken,
     item:{title:'Question',prompt,unit:'individual'}})).status,400);
  }
  assert.equal((await call(store,{action:'library',operation:'list',kind,token:room.displayToken})).status,403);
 }
 assert.equal((await call(store,{action:'library',operation:'list',kind:'video',token:room.teacherToken})).status,400);
});


test('private classroom work submissions are accessible only to the matching lecturer',async()=>{
 const store=new FakeStore(),a=(await created(store)).body,b=(await created(store)).body;
 const learner=(await join(store,a.code,'A student')).body;
 const note=await call(store,{action:'work',operation:'submit',token:learner.token,
  kind:'problem',topic:'Task 3',note:'I need help with this step',code:'SELECT * FROM T',image:null});
 assert.equal(note.status,201);
 const own=(await call(store,{action:'work',operation:'list',token:a.teacherToken})).body.items;
 assert.equal(own.length,1);
 assert.equal(own[0].name,'A student');
 assert.equal(own[0].kind,'problem');
 assert.equal(own[0].hasImage,false);
 assert.equal(own[0].code,'SELECT * FROM T');
 assert.equal((await call(store,{action:'work',operation:'list',token:learner.token})).status,403);
 assert.equal((await call(store,{action:'work',operation:'list',token:a.displayToken})).status,403);
 assert.equal((await call(store,{action:'work',operation:'list',token:b.teacherToken})).body.items.length,0);
 assert.equal((await call(store,{action:'work',operation:'submit',token:a.teacherToken,
  kind:'solution',note:'Teacher cannot impersonate student'})).status,403);
});
test('screenshot is hidden from list and fetched only with a lecturer room token',async()=>{
 const store=new FakeStore(),a=(await created(store)).body,b=(await created(store)).body;
 const student=(await join(store,a.code,'A')).body;
 const image='data:image/webp;base64,'+Buffer.from('synthetic screenshot').toString('base64');
 const submission=await call(store,{action:'work',operation:'submit',token:student.token,
  kind:'solution',note:'I solved it',image});
 assert.equal(submission.status,201);
 const list=(await call(store,{action:'work',operation:'list',token:a.teacherToken})).body.items;
 assert.equal(list[0].hasImage,true);
 assert.equal(JSON.stringify(list).includes(image),false,'private image must not leak through list');
 assert.equal((await call(store,{action:'work',operation:'image',token:a.teacherToken,id:submission.body.id})).body.image,image);
 assert.equal((await call(store,{action:'work',operation:'image',token:student.token,id:submission.body.id})).status,403);
 assert.equal((await call(store,{action:'work',operation:'image',token:b.teacherToken,id:submission.body.id})).status,404);
 assert.equal((await call(store,{action:'work',operation:'image',token:a.displayToken,id:submission.body.id})).status,403);
});
test('work input validation handles empty, overlong and unsupported image',async()=>{
 const store=new FakeStore(),a=(await created(store)).body,student=(await join(store,a.code,'A')).body;
 const base={action:'work',operation:'submit',token:student.token,kind:'solution'};
 for(const data of [
  {...base,note:'',code:'',image:null},
  {...base,kind:'invalid',note:'something'},
  {...base,note:'x'.repeat(1501)},
  {...base,note:'abc',image:'data:image/svg+xml;base64,SGVsbG8='},
  {...base,note:'abc',image:'data:image/webp;base64,'+'A'.repeat(450100)}
 ]){const res=await call(store,data);assert.equal(res.status,400);}
});


const testStroke=(color='#1976bd')=>({points:[[5,5],[30,40],[100,120]],color,width:4});
test('whiteboard is controlled by teacher and visible only to the active classroom',async()=>{
 const store=new FakeStore();
 const room=(await created(store)).body,other=(await created(store)).body;
 const student=(await join(store,room.code,'Student A')).body;
 const second=(await join(store,room.code,'Student B')).body;
 const foreign=(await join(store,other.code,'Student C')).body;
 assert.equal((await call(store,{action:'board',operation:'activate',token:student.token})).status,403);
 assert.equal((await call(store,{action:'board',operation:'read',token:student.token})).status,409);
 const opened=await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 assert.equal(opened.status,200);
 assert.equal(opened.body.active.type,'whiteboard');
 assert.equal((await state(store,student.token)).body.active.type,'whiteboard');
 const stateTeacher=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body;
 assert.equal(stateTeacher.students.length,2);
 assert.equal(stateTeacher.canDraw,true);
 assert.equal(stateTeacher.writerId,null);
 const studentRead=await call(store,{action:'board',operation:'read',token:student.token});
 assert.equal(studentRead.status,200);
 assert.equal(studentRead.body.canDraw,false);
 assert.equal(studentRead.body.students,undefined);
 assert.deepEqual(studentRead.body.strokes,[]);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:student.token,...testStroke()})).status,409);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:room.displayToken,...testStroke()})).status,403);
 assert.equal((await call(store,{action:'board',operation:'select',token:room.displayToken,studentId:student.body?.id})).status,403);
 assert.equal((await call(store,{action:'board',operation:'read',token:other.teacherToken})).status,409);
 assert.equal((await call(store,{action:'board',operation:'read',token:foreign.token})).status,409);
 // A student from the wrong room cannot be selected.
 const foreignId=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.students[0].id;
 assert.notEqual(foreignId,null);
 assert.equal((await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:'00000000-0000-0000-0000-000000000000'})).status,404);
});
test('teacher selects a writer, switches permission, revokes and clears strokes',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const student1=(await join(store,room.code,'Anna')).body;
 const student2=(await join(store,room.code,'Bashir')).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const members=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.students;
 const anna=members.find(s=>s.name==='Anna').id,bashir=members.find(s=>s.name==='Bashir').id;
 const writer1=await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:anna});
 assert.equal(writer1.status,200);
 assert.equal((await call(store,{action:'board',operation:'read',token:student1.token})).body.canDraw,true);
 assert.equal((await call(store,{action:'board',operation:'read',token:student2.token})).body.canDraw,false);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:student1.token,...testStroke()})).status,200);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:room.teacherToken,...testStroke('#24374f')})).status,200);
 assert.equal((await call(store,{action:'board',operation:'read',token:student2.token})).body.strokes.length,2);
 // Conditional reads do not resend strokes if version is unchanged.
 const version=(await call(store,{action:'board',operation:'read',token:student1.token})).body.version;
 const same=await call(store,{action:'board',operation:'read',token:student1.token,since:version});
 assert.equal('strokes' in same.body,false);
 const selectSecond=await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:bashir});
 assert.equal(selectSecond.status,200);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:student1.token,...testStroke()})).status,409);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:student2.token,...testStroke('#169b83')})).status,200);
 assert.equal((await call(store,{action:'board',operation:'select',token:student1.token,studentId:anna})).status,403);
 const student2before=(await call(store,{action:'board',operation:'read',token:student2.token})).body;
 assert.equal(student2before.strokes.length,3);
 assert.equal((await call(store,{action:'board',operation:'undo',token:student2.token})).status,403);
 assert.equal((await call(store,{action:'board',operation:'undo',token:room.teacherToken})).status,200);
 assert.equal((await call(store,{action:'board',operation:'read',token:student2.token})).body.strokes.length,2);
 assert.equal((await call(store,{action:'board',operation:'clear',token:room.teacherToken})).status,200);
 const after=(await call(store,{action:'board',operation:'read',token:student2.token})).body;
 assert.equal(after.strokes.length,0);
 assert.equal(after.generation,1);
 await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:null});
 assert.equal((await call(store,{action:'board',operation:'read',token:student2.token})).body.canDraw,false);
});
test('multiple writers do not overwrite strokes and input is bounded',async()=>{
 const store=new FakeStore(),room=(await created(store)).body,writer=(await join(store,room.code,'A')).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const id=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.students[0].id;
 await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:id});
 const results=await Promise.all([
   call(store,{action:'board',operation:'stroke',token:writer.token,...testStroke('#c54b58')}),
   call(store,{action:'board',operation:'stroke',token:room.teacherToken,...testStroke('#1976bd')})
 ]);
 assert.deepEqual(results.map(r=>r.status),[200,200]);
 assert.equal((await call(store,{action:'board',operation:'read',token:writer.token})).body.strokes.length,2);
 const invalid=[
  {...testStroke(),points:[[0,0]]},
  {...testStroke(),points:[[1001,0],[0,0]]},
  {...testStroke(),points:[[0,0],[0,-1]]},
  {...testStroke(),points:[[0.5,0],[0,0]]},
  {...testStroke(),points:Array.from({length:121},()=>[0,0])},
  {...testStroke(),color:'red'},
  {...testStroke(),width:100}
 ];
 for(const sample of invalid)assert.equal((await call(store,{action:'board',operation:'stroke',token:writer.token,...sample})).status,400);
 // Leaving whiteboard for another teaching activity disables student drawing until reactivated.
 assert.equal((await start(store,room.teacherToken,'poll',{options:['A','B']})).status,200);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:writer.token,...testStroke()})).status,409);
 assert.equal((await call(store,{action:'board',operation:'read',token:writer.token})).status,409);
 const reopen=await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 assert.equal(reopen.body.active.type,'whiteboard');
 assert.equal((await call(store,{action:'board',operation:'read',token:writer.token})).body.strokes.length,2);
});


test('fast cloud feed updates counts, preserves repeated words and remains private',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const alice=(await join(store,room.code,'Alice')).body;
 const bob=(await join(store,room.code,'Bob')).body;
 const id=(await start(store,room.teacherToken,'cloud',{prompt:'One word for quality?'})).body.active.id;
 const read=(token,since)=>call(store,{action:'cloud-live',token,roundId:id,...(since!==undefined?{since}:{})});
 assert.equal((await read(alice.token)).status,403);
 let first=await read(room.teacherToken);
 assert.equal(first.status,200);
 assert.equal(first.body.total,0);
 assert.deepEqual(first.body.words,[]);
 assert.equal((await read(room.teacherToken,first.body.version)).body.unchanged,true);
 assert.equal((await read(room.displayToken)).body.visible,false);
 assert.equal((await call(store,{action:'submit',token:alice.token,roundId:id,value:'Delay',revision:0})).status,200);
 assert.equal((await call(store,{action:'submit',token:bob.token,roundId:id,value:'delay',revision:0})).status,200);
 const cloud=(await read(room.teacherToken)).body;
 assert.equal(cloud.total,2);
 assert.deepEqual(cloud.words,[{word:'Delay',count:2}]);
 assert.equal(cloud.events.length,2);
 assert.deepEqual(cloud.events.map(e=>e.value),['Delay','delay']);
 const revised=await call(store,{action:'submit',token:alice.token,roundId:id,value:'Flow',revision:1});
 assert.equal(revised.status,200);
 const after=(await read(room.teacherToken)).body;
 assert.equal(after.total,2);
 assert.equal(after.events.length,3);
 assert.equal(after.words.reduce((a,w)=>a+w.count,0),2);
 assert.deepEqual(after.words.map(w=>w.word).sort(),['Flow','delay']);
 assert.equal((await read(room.displayToken)).body.visible,false);
 await call(store,{action:'control',token:room.teacherToken,roundId:id,control:'reveal'});
 const shown=(await read(room.displayToken)).body;
 assert.equal(shown.visible,true);
 assert.equal(shown.total,2);
 assert.equal((await call(store,{action:'cloud-live',token:room.teacherToken,roundId:'another'})).status,409);
});
test('cloud moderation promptly removes and restores words without resubmission',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const student=(await join(store,room.code,'Student')).body;
 const id=(await start(store,room.teacherToken,'cloud')).body.active.id;
 await call(store,{action:'submit',token:student.token,roundId:id,value:'bottleneck',revision:0});
 const original=(await state(store,room.teacherToken)).body.answers[0];
 assert.equal((await call(store,{action:'moderate',token:room.teacherToken,roundId:id,subject:original.subject,hidden:true})).status,200);
 let hidden=(await call(store,{action:'cloud-live',token:room.teacherToken,roundId:id})).body;
 assert.equal(hidden.total,0);
 assert.deepEqual(hidden.words,[]);
 assert.equal((await call(store,{action:'moderate',token:room.teacherToken,roundId:id,subject:original.subject,hidden:false})).status,200);
 let restored=(await call(store,{action:'cloud-live',token:room.teacherToken,roundId:id})).body;
 assert.equal(restored.total,1);
 assert.equal(restored.words[0].word,'bottleneck');
});
test('concurrent cloud submissions keep every student word',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const students=await Promise.all(Array.from({length:12},(_,i)=>join(store,room.code,'Student '+i)));
 const id=(await start(store,room.teacherToken,'cloud')).body.active.id;
 const attempts=await Promise.all(students.map((student,i)=>call(store,{
  action:'submit',token:student.body.token,roundId:id,value:i%2?'Wait':'Flow',revision:0
 })));
 assert.ok(attempts.every(x=>x.status===200));
 const result=(await call(store,{action:'cloud-live',token:room.teacherToken,roundId:id})).body;
 assert.equal(result.total,12);
 assert.deepEqual(result.words.map(w=>w.count),[6,6]);
});


test('migration of an already-running word cloud retains previously submitted words',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const old=(await join(store,room.code,'Old Student')).body,newcomer=(await join(store,room.code,'New Student')).body;
 const id=(await start(store,room.teacherToken,'cloud')).body.active.id;
 const oldAns=await call(store,{action:'submit',token:old.token,roundId:id,value:'Old word',revision:0});
 assert.equal(oldAns.status,200);
 // Simulate a room created by an earlier release with no fast projection.
 store.values.delete('cloud-fast/'+room.code+'/'+id);
 const quick=(await call(store,{action:'cloud-live',token:room.teacherToken,roundId:id})).body;
 assert.equal(quick.total,1);
 assert.equal((await call(store,{action:'submit',token:newcomer.token,roundId:id,value:'New word',revision:0})).status,200);
 const updated=(await call(store,{action:'cloud-live',token:room.teacherToken,roundId:id})).body;
 assert.equal(updated.total,2);
 assert.deepEqual(updated.words.map(w=>w.word).sort(),['New word','Old word']);
});


test('whiteboard shape/text/table objects stay room-scoped and require writing permission',async()=>{
 const store=new FakeStore(),room=(await created(store)).body,foreign=(await created(store)).body;
 const anna=(await join(store,room.code,'Anna')).body,bob=(await join(store,room.code,'Bob')).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const shape={type:'shape',shape:'rectangle',x:40,y:55,w:160,h:110,color:'#1976bd',width:4};
 const textBox={type:'text',x:250,y:60,w:280,h:100,color:'#24374f',fontSize:20,text:'Value stream map'};
 const table={type:'table',x:100,y:210,w:480,h:180,color:'#24374f',rows:3,cols:4,cells:Array(12).fill('')};
 const add=(token,element)=>call(store,{action:'board',operation:'element',token,element});
 assert.equal((await add(anna.token,shape)).status,409);
 assert.equal((await add(room.displayToken,shape)).status,403);
 assert.equal((await add(foreign.teacherToken,shape)).status,409);
 assert.equal((await add(room.teacherToken,shape)).status,200);
 assert.equal((await add(room.teacherToken,textBox)).status,200);
 assert.equal((await add(room.teacherToken,table)).status,200);
 const view=(await call(store,{action:'board',operation:'read',token:anna.token})).body.strokes;
 assert.equal(view.length,3);
 assert.deepEqual(view.map(x=>x.type),['shape','text','table']);
 const teacherView=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body;
 const writer=teacherView.students.find(s=>s.name==='Anna').id;
 await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:writer});
 const studentShape=(await add(anna.token,{...shape,shape:'ellipse',x:500,y:35})).status;
 assert.equal(studentShape,200);
 assert.equal((await add(bob.token,shape)).status,409);
 const tableId=view[2].id,txtId=view[1].id,shapeId=view[0].id;
 assert.equal((await call(store,{action:'board',operation:'edit',token:anna.token,id:txtId,changes:{text:'Updated workflow'}})).status,200);
 const cells=Array(12).fill('');cells[5]='Analyze';
 assert.equal((await call(store,{action:'board',operation:'edit',token:anna.token,id:tableId,changes:{cells}})).status,200);
 assert.equal((await call(store,{action:'board',operation:'move',token:anna.token,id:tableId,x:150,y:220})).status,200);
 let data=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.strokes;
 assert.equal(data.find(e=>e.id===txtId).text,'Updated workflow');
 assert.equal(data.find(e=>e.id===tableId).cells[5],'Analyze');
 assert.equal(data.find(e=>e.id===tableId).x,150);
 assert.equal((await call(store,{action:'board',operation:'remove',token:anna.token,id:shapeId})).status,200);
 await call(store,{action:'board',operation:'select',token:room.teacherToken,studentId:null});
 assert.equal((await call(store,{action:'board',operation:'move',token:anna.token,id:tableId,x:80,y:80})).status,409);
 assert.equal((await call(store,{action:'board',operation:'edit',token:bob.token,id:tableId,changes:{cells}})).status,409);
 assert.equal((await call(store,{action:'board',operation:'remove',token:room.displayToken,id:tableId})).status,403);
 assert.equal((await call(store,{action:'board',operation:'remove',token:room.teacherToken,id:tableId})).status,200);
 data=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.strokes;
 assert.equal(data.length,2);
 assert.equal((await call(store,{action:'board',operation:'undo',token:room.teacherToken})).status,200);
 assert.equal((await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.strokes.length,1);
});
test('whiteboard object validation rejects unsafe geometry, overflowing tables and edits',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const shape={type:'shape',shape:'rectangle',x:20,y:20,w:120,h:75,color:'#24374f',width:4};
 const invalid=[
  {...shape,x:-1},{...shape,w:1000},{...shape,color:'javascript:alert(1)'},
  {...shape,shape:'hexagon'},{...shape,width:100}, {...shape,w:1},
  {type:'text',x:1,y:1,w:180,h:90,color:'#24374f',fontSize:20,text:''},
  {type:'text',x:1,y:1,w:180,h:90,color:'#24374f',fontSize:20,text:'X'.repeat(501)},
  {type:'table',x:0,y:0,w:300,h:100,color:'#24374f',rows:9,cols:3,cells:Array(27).fill('')},
  {type:'table',x:0,y:0,w:300,h:100,color:'#24374f',rows:3,cols:3,cells:['only one']},
  {type:'table',x:0,y:0,w:300,h:100,color:'#24374f',rows:3,cols:3,cells:['<img src=x onerror=alert(1)>'.repeat(4),...Array(8).fill('')]}
 ];
 for(const element of invalid){
  const res=await call(store,{action:'board',operation:'element',token:room.teacherToken,element});
  assert.equal(res.status,400,JSON.stringify(element).slice(0,130));
 }
 assert.equal((await call(store,{action:'board',operation:'element',token:room.teacherToken,element:shape})).status,200);
 const id=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.strokes[0].id;
 for(const payload of [
  {operation:'edit',changes:{text:'not a shape'}},
  {operation:'move',x:990,y:590},
  {operation:'move',x:-1,y:90},
  {operation:'edit',changes:{shape:'rectangle'}},
  {operation:'remove',id:'bad-id'}
 ]){
  const res=await call(store,{action:'board',token:room.teacherToken,id,...payload});
  assert.ok([400,409].includes(res.status));
 }
 assert.equal((await call(store,{action:'board',operation:'element',token:room.teacherToken,
   element:{type:'text',x:200,y:200,w:200,h:100,color:'#24374f',fontSize:20,text:'A'}})).status,200);
 const textId=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body.strokes[1].id;
 assert.equal((await call(store,{action:'board',operation:'edit',token:room.teacherToken,id:textId,
   changes:{text:'hello',fontSize:80}})).status,409);
});


test('finish activity returns student and teacher to classroom home without ending the room',async()=>{
 const store=new FakeStore();
 const room=(await created(store)).body;
 const student=(await join(store,room.code,'Student One')).body;
 for(const type of ['poll','answers','cloud']){
  const payload=type==='poll'?{options:['Yes','No'],prompt:'Which one?'}:{prompt:'What is your answer?'};
  const started=await start(store,room.teacherToken,type,payload);
  assert.equal(started.status,200);
  const id=started.body.active.id;
  const value=type==='poll'?0:type==='cloud'?'Flow':'My answer';
  assert.equal((await call(store,{action:'submit',token:student.token,roundId:id,value,revision:0})).status,200);
  assert.equal((await state(store,student.token)).body.active.id,id);
  assert.equal((await call(store,{action:'control',token:student.token,control:'finish',roundId:id})).status,403);
  assert.equal((await call(store,{action:'control',token:room.displayToken,control:'finish',roundId:id})).status,403);
  const finished=await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:id});
  assert.equal(finished.status,200);
  assert.equal(finished.body.active,null);
  const t=await state(store,room.teacherToken),s=await state(store,student.token);
  assert.equal(t.body.active,null);
  assert.equal(s.body.active,null);
  assert.equal(t.body.roomOpen,true);
  assert.equal(s.body.roomOpen,true);
  assert.equal((await state(store,room.displayToken)).body.active,null);
  assert.equal((await call(store,{action:'submit',token:student.token,roundId:id,value,revision:1})).status,409);
  assert.equal((await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:id})).status,409);
  // Finished answers remain stored in history, but they are not the active round.
  const old=await store.get('response/'+room.code+'/'+id+'/');
  const keys=[...store.values.keys()].filter(k=>k.startsWith('response/'+room.code+'/'+id+'/'));
  assert.equal(keys.length,1);
  const next=await start(store,room.teacherToken,type,payload);
  assert.equal(next.status,200);
  assert.notEqual(next.body.active.id,id);
  // New active round cannot be closed by a stale request targeting old id.
  assert.equal((await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:id})).status,409);
  assert.equal((await state(store,room.teacherToken)).body.active.id,next.body.active.id);
  await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:next.body.active.id});
 }
});
test('finish activity preserves unrelated screen-share and work access within classroom',async()=>{
 const store=new FakeStore(),room=(await created(store)).body,student=(await join(store,room.code,'Learner')).body;
 const round=(await start(store,room.teacherToken,'answers',{prompt:'Observation?'})).body.active.id;
 await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:round});
 const submitted=await call(store,{action:'work',operation:'submit',token:student.token,kind:'problem',note:'I need assistance'});
 assert.equal(submitted.status,201);
 const results=(await call(store,{action:'work',operation:'list',token:room.teacherToken})).body;
 assert.equal(results.items.length,1);
 assert.equal((await state(store,student.token)).body.roomOpen,true);
});


test('teacher picks a random whiteboard writer and a repeat excludes the current student',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const studentA=(await join(store,room.code,'Anna')).body,studentB=(await join(store,room.code,'Bashir')).body;
 const other=(await created(store)).body,outsider=(await join(store,other.code,'Outsider')).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const random=(token)=>call(store,{action:'board',operation:'random',token});
 assert.equal((await random(studentA.token)).status,403);
 assert.equal((await random(room.displayToken)).status,403);
 const first=await random(room.teacherToken);
 assert.equal(first.status,200);
 assert.ok(['Anna','Bashir'].includes(first.body.name));
 const id=first.body.writerId;
 const boardFirst=(await call(store,{action:'board',operation:'read',token:room.teacherToken})).body;
 assert.equal(boardFirst.writerId,id);
 assert.equal(boardFirst.students.filter(s=>s.selected).length,1);
 const second=await random(room.teacherToken);
 assert.equal(second.status,200);
 assert.notEqual(second.body.writerId,id,'Random picker should not immediately repeat while two students are joined');
 const clientA=(await call(store,{action:'board',operation:'read',token:studentA.token})).body;
 const clientB=(await call(store,{action:'board',operation:'read',token:studentB.token})).body;
 assert.equal(Number(clientA.canDraw)+Number(clientB.canDraw),1,'exactly one selected student has write rights');
 assert.equal((await call(store,{action:'board',operation:'read',token:outsider.token})).status,409);
 const chosen=second.body.writerId===boardFirst.students.find(s=>s.name==='Anna').id?studentA:studentB;
 const rejected=chosen===studentA?studentB:studentA;
 const stroke={points:[[5,5],[20,30]],color:'#1976bd',width:4};
 assert.equal((await call(store,{action:'board',operation:'stroke',token:chosen.token,...stroke})).status,200);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:rejected.token,...stroke})).status,409);
 assert.equal((await call(store,{action:'board',operation:'stroke',token:room.teacherToken,...stroke})).status,200);
});
test('random whiteboard selection handles empty and single-student rosters',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 await call(store,{action:'board',operation:'activate',token:room.teacherToken});
 const empty=await call(store,{action:'board',operation:'random',token:room.teacherToken});
 assert.equal(empty.status,409);
 const student=(await join(store,room.code,'Only Student')).body;
 const first=await call(store,{action:'board',operation:'random',token:room.teacherToken});
 const second=await call(store,{action:'board',operation:'random',token:room.teacherToken});
 assert.equal(first.status,200);
 assert.equal(second.status,200);
 assert.equal(first.body.writerId,second.body.writerId);
 assert.equal((await call(store,{action:'board',operation:'read',token:student.token})).body.canDraw,true);
});


test('saved website URLs persist across classrooms with lecturer-only access',async()=>{
 const store=new FakeStore(),first=(await created(store)).body;
 const learner=(await join(store,first.code,'Student')).body;
 const nextRoom=(await created(store)).body;
 const request=(token,operation,other={})=>call(store,{action:'web-links',token,operation,...other});
 assert.equal((await request(learner.token,'list')).status,403);
 assert.equal((await request(first.displayToken,'save',{item:{title:'Example',url:'https://example.com/'}})).status,403);
 assert.deepEqual((await request(first.teacherToken,'list')).body.items,[]);
 const saved=await request(first.teacherToken,'save',{item:{title:'Example Reference',url:'https://example.com/guide?topic=web'}});
 assert.equal(saved.status,201);
 assert.equal(saved.body.item.revision,1);
 assert.equal(saved.body.item.url,'https://example.com/guide?topic=web');
 assert.equal((await request(learner.token,'delete',{id:saved.body.item.id})).status,403);
 const otherClass=await request(nextRoom.teacherToken,'list');
 assert.equal(otherClass.body.items.length,1);
 assert.equal(otherClass.body.items[0].title,'Example Reference');
 const updated=await request(nextRoom.teacherToken,'save',{id:saved.body.item.id,revision:1,item:{
  title:'Updated reference',url:'https://developer.mozilla.org/en-US/docs/Web'
 }});
 assert.equal(updated.status,200);
 assert.equal(updated.body.item.revision,2);
 assert.equal((await request(first.teacherToken,'save',{id:saved.body.item.id,revision:1,item:{title:'Old title',url:'https://example.com'}})).status,409);
 assert.equal((await request(first.teacherToken,'delete',{id:saved.body.item.id})).status,200);
 assert.deepEqual((await request(nextRoom.teacherToken,'list')).body.items,[]);
 assert.equal((await request(nextRoom.teacherToken,'delete',{id:saved.body.item.id})).status,409);
});
test('saved website URL validation rejects dangerous schemes, credentials, local hosts and oversized text',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const bad=['javascript:alert(1)','data:text/html,test','http://example.com',
  'https://user:pass@example.com','https://localhost:8443/admin','https://127.0.0.1',
  'https://192.168.1.15','https://[::1]/','file:///etc/passwd','https://'+'x'.repeat(1600)];
 for(const url of bad){
  const response=await call(store,{action:'web-links',operation:'save',token:room.teacherToken,item:{title:'Bad URL',url}});
  assert.equal(response.status,400,url.slice(0,80));
 }
 for(const title of ['', 'X'.repeat(101)]){
  const response=await call(store,{action:'web-links',operation:'save',token:room.teacherToken,item:{title,url:'https://example.com'}});
  assert.equal(response.status,400);
 }
 assert.equal((await call(store,{action:'web-links',operation:'delete',token:room.teacherToken,id:'not-uuid'})).status,400);
 assert.equal((await call(store,{action:'web-links',operation:'save',token:room.teacherToken,id:'no-id',item:{title:'Title',url:'https://example.com'}})).status,400);
});


test('teacher-only participation roster reflects individual responses and moderation',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const alice=(await join(store,room.code,'Alice')).body;
 const bob=(await join(store,room.code,'Bob')).body;
 let before=await state(store,room.teacherToken);
 assert.equal(before.body.students.length,2);
 assert.ok(before.body.students.every(s=>s.participated===null));
 assert.equal((await state(store,alice.token)).body.students,undefined);
 assert.equal((await state(store,room.displayToken)).body.students,undefined);
 for(const type of ['poll','answers','cloud']){
  const started=await start(store,room.teacherToken,type,{prompt:'Class question',
    ...(type==='poll'?{options:['A','B']}:{})});
  const id=started.body.active.id;
  const snap=await state(store,room.teacherToken);
  assert.ok(snap.body.students.every(s=>s.participated===false));
  const submission=await call(store,{action:'submit',token:alice.token,roundId:id,
    value:type==='poll'?0:type==='cloud'?'Flow':'An answer',revision:0});
  assert.equal(submission.status,200);
  const after=(await state(store,room.teacherToken)).body;
  assert.equal(after.students.find(s=>s.name==='Alice').participated,true);
  assert.equal(after.students.find(s=>s.name==='Bob').participated,false);
  assert.equal((await state(store,bob.token)).body.students,undefined);
  const answer=after.answers.find(a=>a.name==='Alice');
  assert.equal((await call(store,{action:'moderate',token:room.teacherToken,roundId:id,
    subject:answer.subject,hidden:true})).status,200);
  const hidden=(await state(store,room.teacherToken)).body;
  assert.equal(hidden.students.find(s=>s.name==='Alice').participated,true,
    'A hidden answer is still a submitted answer');
  await call(store,{action:'control',token:room.teacherToken,control:'finish',roundId:id});
  assert.ok((await state(store,room.teacherToken)).body.students.every(s=>s.participated===null));
 }
});
test('pair answer marks both students in same pair but not classmates in other pair',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const a=(await join(store,room.code,'A','Team A')).body;
 await join(store,room.code,'B','Team A');
 await join(store,room.code,'C','Team B');
 const started=await start(store,room.teacherToken,'poll',{unit:'pair',prompt:'Vote',
   options:['Option A','Option B']});
 const id=started.body.active.id;
 assert.equal((await call(store,{action:'submit',token:a.token,roundId:id,value:1,revision:0})).status,200);
 const snapshot=(await state(store,room.teacherToken)).body;
 assert.deepEqual(snapshot.students.map(s=>[s.name,s.participated]),
  [['A',true],['B',true],['C',false]]);
 assert.equal(snapshot.participants,3);
});
test('student roster reflects joined classmates without leaking names to projector',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 await join(store,room.code,'Zara');
 await join(store,room.code,'Ahmed');
 const teacher=(await state(store,room.teacherToken)).body;
 assert.deepEqual(teacher.students.map(s=>s.name),['Ahmed','Zara']);
 assert.equal(teacher.participants,2);
 const projector=(await state(store,room.displayToken)).body;
 assert.equal(projector.students,undefined);
});


test('evaluation banks persist and only lecturers can prepare, update and launch questions',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const kid=(await join(store,room.code,'Nora')).body;
 const mcq={title:'Security question',prompt:'Which principle limits access?',
   options:['Least privilege','Maximum access','No authentication'],correct:0};
 const q=await call(store,{action:'evaluation-bank',operation:'save',token:room.teacherToken,
   kind:'mcq',item:mcq});
 assert.equal(q.status,201);
 assert.equal((await call(store,{action:'evaluation-bank',operation:'list',token:kid.token,kind:'mcq'})).status,403);
 const other=(await created(store)).body;
 const saved=await call(store,{action:'evaluation-bank',operation:'list',token:other.teacherToken,kind:'mcq'});
 assert.equal(saved.body.items.length,1);
 assert.equal(saved.body.items[0].correct,0);
 const launch=await call(store,{action:'evaluation-start',token:room.teacherToken,kind:'mcq',
   id:q.body.item.id,duration:30});
 assert.equal(launch.status,200);
 assert.equal(launch.body.active.type,'evaluation');
 assert.equal(launch.body.active.correctAnswer,undefined,'Correct choice must not leak before reveal');
 assert.equal((await state(store,kid.token)).body.active.correctAnswer,undefined);
 assert.equal((await state(store,room.displayToken)).body.active.correctAnswer,undefined);
 assert.equal((await call(store,{action:'control',token:room.teacherToken,
   roundId:launch.body.active.id,control:'evaluation-reveal'})).status,409);
 const wrong=await call(store,{action:'submit',token:kid.token,roundId:launch.body.active.id,
   value:2,revision:0});
 assert.equal(wrong.status,200);
 assert.deepEqual((await state(store,kid.token)).body.engagement,
   {score:100,participated:1,opportunities:1},'Incorrect answer still counts as engagement');
 const roundKey='round/'+room.code+'/'+launch.body.active.id;
 const old=store.values.get(roundKey);
 old.data.endsAt=Date.now()-1000;
 assert.equal((await call(store,{action:'submit',token:kid.token,roundId:launch.body.active.id,value:0,revision:1})).status,409);
 const ended=await state(store,kid.token);
 assert.equal(ended.body.active.status,'closed');
 assert.equal(ended.body.active.correctAnswer,undefined);
 const reveal=await call(store,{action:'control',token:room.teacherToken,
   roundId:launch.body.active.id,control:'evaluation-reveal'});
 assert.equal(reveal.status,200);
 assert.equal((await state(store,kid.token)).body.active.correctAnswer,0);
 assert.equal((await state(store,room.teacherToken)).body.correctCount,0);
 assert.equal((await call(store,{action:'evaluation-start',token:kid.token,kind:'mcq',id:q.body.item.id,duration:30})).status,403);
 assert.equal((await call(store,{action:'evaluation-start',token:room.teacherToken,kind:'mcq',
   id:q.body.item.id,duration:5})).status,400);
});
test('jumbled questions enforce unique tile ordering and only reveal secret order after timer',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const learner=(await join(store,room.code,'Sara')).body;
 const steps=['Engage','Explore','Explain','Extend','Evaluate'];
 const saved=await call(store,{action:'evaluation-bank',operation:'save',token:room.teacherToken,
   kind:'jumbled',item:{title:'5E learning',prompt:'Put the phases in order',steps}});
 assert.equal(saved.status,201);
 const launched=await call(store,{action:'evaluation-start',token:room.teacherToken,
   kind:'jumbled',id:saved.body.item.id,duration:25});
 assert.equal(launched.status,200);
 const id=launched.body.active.id,visible=(await state(store,learner.token)).body.active;
 assert.equal(visible.tiles.length,5);
 assert.equal(visible.correctAnswer,undefined);
 assert.equal(visible.correctIds,undefined,'Tile order IDs must remain private');
 assert.ok(visible.tiles.every(tile=>/^[0-9a-f-]{36}$/.test(tile.id)),'Do not encode correct position in tile ID');
 assert.notDeepEqual(visible.tiles.map(tile=>tile.text),steps,'Tiles should be jumbled');
 const correctOrder=steps.map(text=>visible.tiles.find(t=>t.text===text).id);
 assert.equal((await call(store,{action:'submit',token:learner.token,roundId:id,
   value:[visible.tiles[0].id,visible.tiles[0].id,...visible.tiles.slice(2).map(x=>x.id)],revision:0})).status,400);
 const submitted=await call(store,{action:'submit',token:learner.token,roundId:id,value:correctOrder,revision:0});
 assert.equal(submitted.status,200);
 assert.equal((await state(store,learner.token)).body.engagement.score,100);
 store.values.get('round/'+room.code+'/'+id).data.endsAt=Date.now()-1;
 assert.equal((await state(store,learner.token)).body.active.correctIds,undefined);
 assert.equal((await call(store,{action:'control',token:room.teacherToken,roundId:id,control:'evaluation-reveal'})).status,200);
 const shown=(await state(store,learner.token)).body.active;
 assert.deepEqual(shown.correctAnswer,steps);
 assert.deepEqual(shown.correctIds,correctOrder);
 assert.equal((await state(store,room.teacherToken)).body.correctCount,1);
});
test('session engagement tracks participation not correctness across rounds; late joiner excludes old questions',async()=>{
 const store=new FakeStore(),room=(await created(store)).body;
 const a=(await join(store,room.code,'A')).body;
 let poll=(await start(store,room.teacherToken,'poll',{options:['X','Y']})).body.active.id;
 assert.deepEqual((await state(store,a.token)).body.engagement,{score:0,participated:0,opportunities:1});
 assert.equal((await call(store,{action:'submit',token:a.token,roundId:poll,value:1,revision:0})).status,200);
 assert.equal((await state(store,a.token)).body.engagement.score,100);
 await call(store,{action:'control',token:room.teacherToken,roundId:poll,control:'finish'});
 const b=(await join(store,room.code,'B')).body;
 const answers=(await start(store,room.teacherToken,'answers',{prompt:'Explain'})).body.active.id;
 assert.deepEqual((await state(store,a.token)).body.engagement,{score:50,participated:1,opportunities:2});
 assert.deepEqual((await state(store,b.token)).body.engagement,{score:0,participated:0,opportunities:1});
 assert.equal((await call(store,{action:'submit',token:b.token,roundId:answers,value:'My idea',revision:0})).status,200);
 assert.deepEqual((await state(store,b.token)).body.engagement,{score:100,participated:1,opportunities:1});
 assert.equal((await state(store,a.token)).body.engagement.score,50);
 const saved=await call(store,{action:'evaluation-bank',operation:'save',token:room.teacherToken,
   kind:'mcq',item:{title:'Test',prompt:'Choose',options:['Yes','No'],correct:0}});
 const evalRound=(await call(store,{action:'evaluation-start',token:room.teacherToken,kind:'mcq',
  id:saved.body.item.id,duration:30})).body.active.id;
 const late=(await join(store,room.code,'Late')).body;
 assert.equal((await state(store,late.token)).body.engagement.opportunities,1,
  'Student joining while evaluation is live may still participate');
 assert.equal((await call(store,{action:'submit',token:late.token,roundId:evalRound,value:1,revision:0})).status,200);
 assert.deepEqual((await state(store,late.token)).body.engagement,{score:100,participated:1,opportunities:1});
});


test('text documents are reusable across sessions, teacher-owned and private to each student',async()=>{
 const store=new FakeStore(),first=(await created(store)).body;
 const a=(await join(store,first.code,'Alice')).body,b=(await join(store,first.code,'Bob')).body;
 const template={title:'Week 09 reflection',questions:['Describe your implementation','What was challenging?']};
 const save=await call(store,{action:'document-bank',operation:'save',token:first.teacherToken,item:template});
 assert.equal(save.status,201);
 assert.equal((await call(store,{action:'document-bank',operation:'list',token:a.token})).status,403);
 assert.equal((await call(store,{action:'document-bank',operation:'save',token:b.token,item:template})).status,403);
 const other=(await created(store)).body;
 const bank=(await call(store,{action:'document-bank',operation:'list',token:other.teacherToken})).body.items;
 assert.equal(bank.length,1);
 assert.deepEqual(bank[0].questions,template.questions);
 const started=await call(store,{action:'document-start',token:first.teacherToken,id:save.body.item.id});
 assert.equal(started.status,200);
 const id=started.body.active.id;
 const start=(await state(store,a.token)).body;
 assert.equal(start.active.type,'text-document');
 assert.deepEqual(start.active.questions,template.questions);
 assert.equal(start.answers,undefined);
 assert.equal(start.engagement.opportunities,1);
 assert.equal((await call(store,{action:'document-start',token:a.token,id:save.body.item.id})).status,403);
 assert.equal((await call(store,{action:'submit',token:a.token,roundId:id,
   value:['Implemented CREATE endpoint','Validation was hardest'],revision:0})).status,200);
 const teacher=(await state(store,first.teacherToken)).body;
 const alice=teacher.answers.find(x=>x.name==='Alice');
 assert.deepEqual(alice.value,['Implemented CREATE endpoint','Validation was hardest']);
 assert.equal(teacher.students.find(x=>x.name==='Alice').participated,true);
 assert.equal(teacher.students.find(x=>x.name==='Bob').participated,false);
 assert.equal((await state(store,a.token)).body.engagement.score,100);
 assert.equal((await state(store,b.token)).body.mine,null);
 assert.equal((await state(store,first.displayToken)).body.answers,undefined,
  'Document responses must never reach projector without explicit release');
 assert.equal((await call(store,{action:'control',token:first.teacherToken,
   control:'finish',roundId:id})).status,200);
 assert.equal((await state(store,a.token)).body.active,null);
 assert.equal((await call(store,{action:'submit',token:a.token,roundId:id,
   value:['too late',''],revision:1})).status,409);
 assert.equal((await state(store,a.token)).body.engagement.score,100,
  'Engagement credit remains after document closure');
});
test('text documents reject malformed templates and answers, preserve revision conflicts',async()=>{
 const store=new FakeStore(),r=(await created(store)).body,student=(await join(store,r.code,'Student')).body;
 for(const item of [{title:'Missing',questions:[]},{title:'X',questions:Array(9).fill('Question?')},
   {title:'Test',questions:['']},{title:'Title',questions:['X'.repeat(261)]}]){
  assert.equal((await call(store,{action:'document-bank',operation:'save',token:r.teacherToken,item})).status,400);
 }
 const doc=await call(store,{action:'document-bank',operation:'save',token:r.teacherToken,
  item:{title:'Valid',questions:['Q1','Q2']}});
 assert.equal(doc.status,201);
 const id=doc.body.item.id;
 const conflict=await call(store,{action:'document-bank',operation:'save',token:r.teacherToken,
  id,revision:0,item:{title:'Changed',questions:['Q1']}});
 assert.equal(conflict.status,409);
 const launch=await call(store,{action:'document-start',token:r.teacherToken,id});
 const rid=launch.body.active.id;
 for(const value of [['',''],['X'.repeat(1201),'ok'],['one'],['x','y','z'],[true,'test']]){
  assert.equal((await call(store,{action:'submit',token:student.token,roundId:rid,value,revision:0})).status,400);
 }
 const first=await call(store,{action:'submit',token:student.token,roundId:rid,value:['Answer',''],revision:0});
 assert.equal(first.status,200);
 assert.equal((await call(store,{action:'submit',token:student.token,roundId:rid,
  value:['Late edit',''],revision:0})).status,409);
 assert.equal((await call(store,{action:'submit',token:student.token,roundId:rid,
  value:['Edited answer','Second answer'],revision:1})).status,200);
 assert.equal((await state(store,r.teacherToken)).body.answers[0].revision,2);
 assert.equal((await call(store,{action:'document-bank',operation:'delete',token:r.teacherToken,id})).status,200);
 assert.deepEqual((await call(store,{action:'document-bank',operation:'list',token:r.teacherToken})).body.items,[]);
});
test('finish control ends the currently active whiteboard and cannot close a newer document',async()=>{
 const store=new FakeStore(),r=(await created(store)).body,student=(await join(store,r.code,'A')).body;
 const board=(await call(store,{action:'board',operation:'activate',token:r.teacherToken})).body.active;
 const doc=(await call(store,{action:'document-bank',operation:'save',token:r.teacherToken,
  item:{title:'Doc',questions:['Q']}})).body.item;
 const active=(await call(store,{action:'document-start',token:r.teacherToken,id:doc.id})).body.active;
 assert.equal((await call(store,{action:'control',token:r.teacherToken,
  roundId:board.id,control:'finish'})).status,409);
 assert.equal((await state(store,student.token)).body.active.id,active.id);
 assert.equal((await call(store,{action:'control',token:r.teacherToken,
  roundId:active.id,control:'finish'})).status,200);
 assert.equal((await state(store,student.token)).body.active,null);
});
