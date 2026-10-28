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
