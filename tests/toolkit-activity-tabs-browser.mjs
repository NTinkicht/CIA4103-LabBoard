// Browser regression for teaching flow: Questions -> Live Results -> Close activity.
// Run with Chromium using the normal classroom frontend and a synthetic in-memory API.
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
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream','Content-Security-Policy':csp});res.end(bytes)}
 catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const address='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
let active=null,seq=0;const archives=new Map(),errors=[];
const record={participants:1};
async function mock(route){
 const body=JSON.parse(route.request().postData()||'{}');
 const isTeacher=body.token==='teacher-token',isStudent=body.token==='student-token';
 let result={ok:true},status=200;
 if(body.action==='create')result={code:'123456',teacherToken:'teacher-token',displayToken:'display-token'};
 else if(body.action==='join')result={code:'123456',token:'student-token'};
 else if(body.action==='state')result={code:'123456',roomOpen:true,active,participants:record.participants,serverTime:Date.now(),
   ...(isTeacher?{results:{votes:active?.options?.map(()=>0)||[],total:0,words:[]},answers:[]}:{mine:null})};
 else if(body.action==='start'){
  if(!isTeacher){status=403;result={error:'Lecturer only'}}
  else{active={id:'round-'+(++seq),type:body.type,status:'open',unit:body.unit||'individual',
    prompt:body.prompt,options:body.options||[],revealed:false,endsAt:null};result={active};}
 }else if(body.action==='control'){
  if(!isTeacher){status=403;result={error:'Lecturer only'}}
  else if(body.control==='finish'){
   if(!active||active.id!==body.roundId){status=409;result={error:'Stale round'}}
   else {archives.set(active.id,{...active,status:'closed'});active=null;result={ok:true,active:null};}
  }else if(active){active={...active,revealed:body.control==='reveal'};result={active}}
 }else if(body.action==='library')result={items:[],polls:[]};
 else if(body.action==='cloud-live')result={roundId:active?.id,visible:true,version:0,words:[],total:0,events:[]};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
}
async function page(){
 const p=await browser.newPage({viewport:{width:1240,height:850}});
 p.on('pageerror',err=>errors.push(err.message));
 await p.route('**/.netlify/functions/toolkit',mock);await p.goto(address);return p;
}
async function waitFor(p,fn,timeout=12000){await p.waitForFunction(fn,null,{timeout})}
try{
 const lecturer=await page(),student=await page();
 await lecturer.locator('#open-teacher').click();
 await lecturer.locator('#teacher-pin').fill('synthetic lecturer password');
 await lecturer.locator('#create-submit').click();
 await lecturer.locator('#activity-view-tabs').waitFor({state:'visible',timeout:10000});
 assert.equal(await lecturer.locator('#activity-results').isDisabled(),true);
 assert.equal(await lecturer.locator('#tool-config').isVisible(),true);
 await student.locator('#open-student').click();
 await student.locator('#room-code').fill('123456');await student.locator('#join-name').fill('Student');
 await student.locator('#join-submit').click();
 await student.locator('.student-activities-home').waitFor({state:'visible',timeout:8000});
 assert.equal(await student.locator('.student-tabs [role="tab"]').count(),3);
 for(const kind of ['poll','answers','cloud']){
  await lecturer.locator('[data-tool="'+kind+'"]').click();
  await lecturer.locator('#activity-questions').waitFor({state:'visible'});
  assert.equal(await lecturer.locator('#activity-questions').getAttribute('aria-selected'),'true');
  await lecturer.locator('#question').fill('What is your '+kind+' response?');
  // A classroom prepared poll needs choices; unchanged option defaults are valid.
  await lecturer.locator('#launch').click();
  await lecturer.locator('#activity-results').waitFor({state:'visible',timeout:9000});
  await waitFor(lecturer,()=>document.querySelector('#activity-results')?.getAttribute('aria-selected')==='true');
  assert.equal(await lecturer.locator('#tool-config').isVisible(),false,'Question library hidden in Results');
  assert.equal(await lecturer.locator('#live-results-panel').isVisible(),true);
  assert.equal(await lecturer.locator('#poll-library-list').isVisible(),false);
  assert.match(await lecturer.locator('#current-label').innerText(),new RegExp(kind+' response'));
  assert.equal(await lecturer.locator('#live-results-panel').evaluate(el=>el.closest('.surface')===el.parentElement.closest('.surface')),true);
  assert.ok(await lecturer.locator('#finish-activity').isVisible());
  await waitFor(student,()=>document.querySelector('#student-work h2')?.textContent!=='Ready for the next activity');
  await student.locator('#tab-work').click();
  assert.equal(await student.locator('#student-work-panel').isVisible(),true);
  // Teacher can return to Questions (for another prepared item) without closing.
  await lecturer.locator('#activity-questions').click();
  assert.equal(await lecturer.locator('#tool-config').isVisible(),true);
  assert.equal(await lecturer.locator('#live-results-panel').isVisible(),false);
  await lecturer.locator('#activity-results').click();
  assert.equal(await lecturer.locator('#poll-library-list').isVisible(),false);
  await lecturer.locator('#finish-activity').click();
  await waitFor(lecturer,()=>document.querySelector('#activity-questions')?.getAttribute('aria-selected')==='true');
  assert.equal(await lecturer.locator('#tool-config').isVisible(),true,'Teacher returned to question preparation');
  assert.equal(await lecturer.locator('#activity-results').isDisabled(),true);
  await waitFor(student,()=>document.querySelector('#student-activities-home')!==null||
    (document.querySelector('#student-activities-panel .student-activities-home')&&
    document.querySelector('#tab-activities')?.getAttribute('aria-selected')==='true'),12000);
  assert.equal(await student.locator('#student-activities-panel').isVisible(),true);
  assert.equal(await student.locator('.student-activities-home').isVisible(),true);
  assert.equal(await student.locator('.student-tabs [role="tab"]').count(),3);
  console.log(kind.toUpperCase(),'Questions/Results/Close/student-home passed');
 }
 assert.equal(archives.size,3);
 assert.equal(active,null);
 assert.deepEqual(errors,[]);
 await lecturer.close();await student.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
