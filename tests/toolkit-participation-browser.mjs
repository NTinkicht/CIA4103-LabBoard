// Real Chrome acceptance: participation markers stay to the left of lecturer
// activities, change as students submit, and never appear in excluded tools.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const path=decodeURI((req.url||'/').split('?')[0]);
 const file=normalize(join(root,path.endsWith('/')?path+'index.html':path));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{
  const data=await readFile(file);
  res.writeHead(200,{'Content-Type':{'.html':'text/html','.css':'text/css','.mjs':'text/javascript'}[extname(file)]||'application/octet-stream',
    'Content-Security-Policy':csp,'X-Frame-Options':'SAMEORIGIN'});
  res.end(data);
 }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const errors=[],members=[{id:'id-alice',name:'Alice',team:''},{id:'id-bob',name:'Bob',team:''}];
let active=null,roundNo=0;
const answers=new Map();
let workItems=[];
async function mock(route){
 const data=JSON.parse(route.request().postData()||'{}');
 const teacher=data.token==='teacher-token',student=data.token?.startsWith('student-');
 let out={ok:true},status=200;
 if(data.action==='create')out={code:'333333',teacherToken:'teacher-token',displayToken:'display-token'};
 else if(data.action==='join'){
  const member=members.find(m=>m.name===data.name);
  out={code:'333333',token:'student-'+member.id};
 }else if(data.action==='library')out={items:[],polls:[]};
 else if(data.action==='state'){
  const rows=[...answers.values()];
  const kids=members.map(m=>({...m,participated:active?rows.some(r=>r.subject===m.id):null}));
  out={code:'333333',roomOpen:true,serverTime:Date.now(),participants:2,active};
  if(teacher){
   out.students=kids;out.answers=rows;
   out.results=active?.type==='poll'?{votes:[rows.length,0,0,0],total:rows.length}:
     active?.type==='cloud'?{words:rows.map(a=>({word:a.value,count:1})),total:rows.length}:{total:rows.length};
  }else if(student)out.mine=answers.get(data.token.slice(8))||null;
 }else if(data.action==='start'){
  active={id:'round-'+(++roundNo),type:data.type,prompt:data.prompt||'',status:'open',
    options:data.options||[],unit:data.unit||'individual',revealed:false,endsAt:null};
  answers.clear();out={active};
 }else if(data.action==='submit'){
  const id=data.token.slice(8);
  const member=members.find(m=>m.id===id);
  answers.set(id,{subject:id,name:member.name,value:data.value,hidden:false,
    revision:(answers.get(id)?.revision||0)+1,submittedAt:new Date().toISOString()});
  out={ok:true,revision:answers.get(id).revision};
 }else if(data.action==='control'&&data.control==='finish'){
  active=null;answers.clear();out={ok:true,active:null};
 }else if(data.action==='work'&&data.operation==='list')out={items:workItems};
 else if(data.action==='cloud-live')out={roundId:active?.id,visible:true,version:0,
   words:[],events:[],total:answers.size};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(out)});
}
async function page(width=1300){
 const p=await browser.newPage({viewport:{width,height:850}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/.netlify/functions/toolkit',mock);
 await p.goto(base);return p;
}
async function statusOf(p,name){
 return p.locator('.participation-student').filter({hasText:name}).getAttribute('class');
}
try{
 const teacher=await page(),alice=await page();
 await teacher.locator('#open-teacher').click();
 await teacher.locator('#teacher-pin').fill('synthetic PIN');
 await teacher.locator('#create-submit').click();
 await teacher.locator('#participation-panel').waitFor({state:'visible',timeout:9000});
 await teacher.waitForFunction(()=>document.querySelectorAll('.participation-student').length===2,null,{timeout:9000});
 assert.match(await teacher.locator('#participation-summary').innerText(),/not tracked/i);
 assert.ok((await statusOf(teacher,'Alice')).includes('untracked'));
 await alice.locator('#open-student').click();
 await alice.locator('#room-code').fill('333333');
 await alice.locator('#join-name').fill('Alice');
 await alice.locator('#join-submit').click();
 for(const type of ['poll','answers','cloud']){
  await teacher.locator('[data-tool="'+type+'"]').click();
  await teacher.locator('#question').fill('Submit your '+type+' response');
  await teacher.locator('#launch').click();
  await teacher.waitForFunction(()=>document.querySelector('#participation-summary')?.textContent?.includes('0 of 2'),null,{timeout:10000});
  assert.ok((await statusOf(teacher,'Alice')).includes('not-participated'));
  assert.ok((await statusOf(teacher,'Bob')).includes('not-participated'));
  if(type!=='poll')await alice.locator('#student-answer').waitFor({state:'visible',timeout:9000});
  if(type==='poll'){
   await alice.locator('input[name="student-vote"]').first().check();
   await alice.locator('#submit-answer').click();
  }else{
   await alice.locator('#student-answer').fill('Cycle time');
   if(type==='cloud')await alice.locator('#student-answer').press('Enter');
   else await alice.locator('#submit-answer').click();
  }
  await teacher.waitForFunction(()=>document.querySelector('#participation-summary')?.textContent?.includes('1 of 2'),null,{timeout:9000});
  assert.ok((await statusOf(teacher,'Alice')).includes('participated'));
  assert.ok((await statusOf(teacher,'Bob')).includes('not-participated'));
  assert.equal(await teacher.locator('#live-results-panel').isVisible(),true);
  await teacher.locator('#finish-activity').click();
  await teacher.waitForFunction(()=>document.querySelector('#participation-summary')?.textContent?.includes('not tracked'),null,{timeout:9000});
  console.log(type,'roster changed from pending to participated then reset');
 }
 // Students who submit work are counted, without confusing the answer roster.
 workItems=[{id:'work-1',studentId:'id-alice',name:'Alice',kind:'solution',
   submittedAt:new Date().toISOString(),note:'Done',code:'',topic:'Exercise',hasImage:false}];
 await teacher.locator('[data-tool="work"]').click();
 await teacher.waitForFunction(()=>document.querySelector('#participation-summary')?.textContent?.includes('1 of 2'),null,{timeout:10000});
 assert.ok((await statusOf(teacher,'Alice')).includes('participated'));
 assert.ok((await statusOf(teacher,'Bob')).includes('not-participated'));
 for(const type of ['timer','documents']){
  await teacher.locator('[data-tool="'+type+'"]').click();
  assert.equal(await teacher.locator('#participation-panel').isVisible(),true);
  assert.match(await teacher.locator('#participation-summary').innerText(),/not tracked/i);
  assert.ok((await statusOf(teacher,'Alice')).includes('untracked'));
 }
 // Collapsing the tool rail must not remove the participation panel.
 await teacher.locator('#rail-toggle').click();
 assert.equal(await teacher.locator('#participation-panel').isVisible(),true);
 await teacher.locator('#rail-toggle').click();
 for(const type of ['web','whiteboard','screen']){
  await teacher.locator('[data-tool="'+type+'"]').click();
  assert.equal(await teacher.locator('#participation-panel').isVisible(),false,
    type+' must retain its own specialized interface');
 }
 assert.deepEqual(errors,[]);
 console.log('Student roster participation UI and tool exclusions passed in Chrome');
 await alice.close();await teacher.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
