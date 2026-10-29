import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const path=decodeURI((req.url||'/').split('?')[0]),file=normalize(join(root,path.endsWith('/')?path+'index.html':path));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Frame-Options':'SAMEORIGIN'});res.end(bytes)}
 catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const origin='http://127.0.0.1:'+server.address().port+'/toolkit/';
const errors=[],members=[
 {id:'11111111-1111-4111-8111-111111111111',name:'Alice',team:''},
 {id:'22222222-2222-4222-8222-222222222222',name:'Bob',team:''}
];
const templates=[],submissions=new Map(),board={version:0,writerId:null,strokes:[]};
let active=null,counter=0,queue=[];
async function mock(route){
 const d=JSON.parse(route.request().postData()||'{}');
 const role=d.token==='teacher-token'?'teacher':String(d.token||'').startsWith('student-')?'student':'display';
 const member=members.find(m=>m.name.toLowerCase()===(d.token||'').replace('student-',''));
 let status=200,out={ok:true};
 if(d.action==='create')out={code:'123456',teacherToken:'teacher-token',displayToken:'display-token'};
 else if(d.action==='join')out={code:'123456',token:'student-'+d.name.toLowerCase()};
 else if(d.action==='state'){
  out={code:'123456',roomOpen:true,active,serverTime:Date.now(),participants:members.length};
  if(role==='teacher'){
   out.students=members.map(m=>({...m,participated:
    active?.type==='text-document'?submissions.has(active.id+':'+m.id):null}));
   out.answers=active?.type==='text-document'?[...submissions.values()].filter(s=>s.roundId===active.id):[];
   out.results={total:out.answers.length};
  }else if(role==='student'){
   out.mine=active?submissions.get(active.id+':'+member.id)||null:null;
   out.engagement={score:submissions.size?100:0,participated:submissions.size?1:0,opportunities:active?1:0};
  }
 }else if(d.action==='document-bank'){
  if(role!=='teacher'){status=403;out={error:'Lecturer only'}}
  else if(d.operation==='list')out={items:templates};
  else if(d.operation==='save'){
   const saved={...d.item,id:'11111111-2222-4333-8444-'+String(++counter).padStart(12,'0'),revision:1};
   templates.push(saved);out={item:saved};
  }else if(d.operation==='delete')out={ok:true};
 }else if(d.action==='document-start'){
  const q=templates.find(t=>t.id===d.id);
  active={id:'round-'+(++counter),type:'text-document',prompt:q.title,
   questions:q.questions,unit:'individual',status:'open',revealed:false};
  out={active};
 }else if(d.action==='submit'){
  if(role!=='student'){status=403;out={error:'Student only'}}
  else{
   const id=active.id+':'+member.id;
   const result={roundId:active.id,subject:member.id,name:member.name,value:d.value,revision:(submissions.get(id)?.revision||0)+1,hidden:false};
   submissions.set(id,result);out={ok:true,revision:result.revision};
  }
 }else if(d.action==='control'){
  if(d.control==='finish'){active=null;out={ok:true,active:null}}
 }else if(d.action==='board'){
  if(d.operation==='activate'){
   active={id:'board-1',type:'whiteboard',status:'open',prompt:'Shared Whiteboard'};
   out={active};
  }else if(d.operation==='read'){
   out={version:board.version,writerId:board.writerId,canDraw:role==='teacher'||board.writerId===member?.id,active:active?.type==='whiteboard'};
   if(d.since!==board.version)out.strokes=board.strokes;
   if(role==='teacher')out.students=members;
  }else if(d.operation==='select'){
   board.writerId=d.studentId;board.version++;out={ok:true};
  }else if(d.operation==='random'){
   board.writerId=members.find(m=>m.id!==board.writerId).id;board.version++;
   out={ok:true,writerId:board.writerId,name:members.find(m=>m.id===board.writerId).name};
  }
 }else if(d.action==='library')out={items:[],polls:[]};
 else if(d.action==='work')out={items:[]};
 else if(d.action==='cloud-live')out={version:0,words:[],events:[],total:0,visible:true};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(out)});
}
async function page(){
 const p=await browser.newPage({viewport:{width:1390,height:850}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/.netlify/functions/toolkit',mock);
 await p.route('**/api/live-token',route=>route.fulfill({status:502,contentType:'application/json',body:'{"error":"Offline synthetic LiveKit"}'}));
 await p.goto(origin);return p;
}
async function wait(p,fn,timeout=12000){await p.waitForFunction(fn,null,{timeout})}
try{
 const teacher=await page(),student=await page();
 await teacher.locator('#open-teacher').click();
 await teacher.locator('#teacher-pin').fill('synthetic-pin');
 await teacher.locator('#create-submit').click();
 await teacher.locator('[data-tool="collaborate"]').click();
 await teacher.locator('#collab-tab-screen').waitFor({state:'visible'});
 assert.equal(await teacher.locator('[data-tool="whiteboard"],[data-tool="screen"]').count(),0);
 assert.equal(await teacher.locator('#collab-students .collab-person').count(),2);
 assert.equal(await teacher.locator('#collab-tab-screen').getAttribute('aria-selected'),'true');
 const iframe=teacher.frameLocator('#teacher-screen-frame');
 await iframe.locator('#stream-teacher-root').waitFor({state:'visible',timeout:13000});
 await iframe.locator('body').evaluate(()=>{window.__persistedScreen=42});
 await teacher.locator('#collab-tab-whiteboard').click();
 await teacher.locator('#collab-open-board').click();
 await teacher.locator('#teacher-board-mount canvas').waitFor({state:'visible',timeout:10000});
 await teacher.locator('#collab-students .collab-person').filter({hasText:'Alice'}).click();
 await wait(teacher,()=>document.querySelector('#collab-selected')?.textContent?.includes('can now write'));
 assert.equal(board.writerId,members[0].id);
 await teacher.locator('#collab-random').click();
 await wait(teacher,()=>document.querySelector('#collab-selected')?.textContent?.includes('can now write'));
 assert.equal(board.writerId,members[1].id);
 await teacher.locator('#collab-tab-screen').click();
 assert.equal(await iframe.locator('body').evaluate(()=>window.__persistedScreen),42);
 await teacher.locator('#collab-stop-screen').click(); // stop can be invoked even with no stream
 await teacher.locator('#stop-current-activity').click();
 await wait(teacher,()=>document.querySelector('#stop-current-activity')?.hidden===true);
 assert.equal(active,null);
 await teacher.locator('#collab-tab-document').click();
 await teacher.locator('#collab-doc-title').fill('Reflect on BookStore');
 await teacher.locator('#collab-doc-questions').fill('What did you implement?\nWhat failed first?');
 await teacher.locator('#collab-doc-save').click();
 await teacher.locator('[data-doc-launch]').waitFor({state:'visible',timeout:10000});
 await teacher.locator('[data-doc-launch]').click();
 await wait(teacher,()=>document.querySelector('#collab-doc-live')?.hidden===false);
 await student.locator('#open-student').click();
 await student.locator('#room-code').fill('123456');await student.locator('#join-name').fill('Alice');
 await student.locator('#join-submit').click();
 await student.locator('[data-doc-answer="0"]').waitFor({state:'visible',timeout:12000});
 await student.locator('[data-doc-answer="0"]').fill('I implemented the Create endpoint');
 await student.locator('[data-doc-answer="1"]').fill('Validation failed initially');
 await student.locator('#student-document-submit').click();
 await wait(student,()=>document.querySelector('#student-document-status')?.textContent?.includes('submitted'));
 await wait(teacher,()=>document.querySelector('#collab-students .collab-person')?.textContent?.includes('Submitted'));
 await teacher.locator('#collab-students .collab-person').filter({hasText:'Alice'}).click();
 await wait(teacher,()=>document.querySelector('#collab-doc-answer-blocks')?.textContent?.includes('I implemented the Create endpoint'));
 assert.equal(await teacher.locator('.collab-doc-answer').count(),2);
 await teacher.locator('#collab-random').click();
 await wait(teacher,()=>document.querySelector('#collab-doc-status')?.textContent?.includes('Bob'));
 assert.match(await teacher.locator('#collab-doc-answer-blocks').innerText(),/Select a student|No answer/);
 await teacher.locator('#collab-stop-document').click();
 await wait(student,()=>document.querySelector('.student-activities-home')!==null);
 await wait(teacher,()=>document.querySelector('#collab-doc-prepare')?.hidden===false);
 await teacher.locator('[data-tool="documents"]').click();
 await teacher.locator('[data-tool="collaborate"]').click();
 assert.equal(await iframe.locator('body').evaluate(()=>window.__persistedScreen),42,
  'Connected screen iframe must persist across global menu changes');
 assert.equal(await teacher.locator('.collab-roster').isVisible(),true);
 assert.deepEqual(errors,[]);
 console.log('Collaborate screen/whiteboard/document tabs, one roster, stop, private answers and persistent screen passed');
 await student.close();await teacher.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
