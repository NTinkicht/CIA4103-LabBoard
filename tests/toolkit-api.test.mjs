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
