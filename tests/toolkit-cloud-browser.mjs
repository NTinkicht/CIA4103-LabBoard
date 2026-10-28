import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const pathname=decodeURI((req.url||'/').split('?')[0]);
 const path=normalize(join(root,pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!path.startsWith(root)){res.writeHead(403);res.end();return}
 try{const data=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream','Content-Security-Policy':csp});res.end(data)}
 catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const address='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const errors=[];
let active=null,version=0,shown=false;
const answers=new Map(),events=[];
function projection(){
 const tally=new Map();
 for(const row of answers.values()){
  if(row.hidden)continue;
  const key=row.value.toLocaleLowerCase();
  const old=tally.get(key);if(old)old.count++;else tally.set(key,{word:row.value,count:1});
 }
 return {total:[...answers.values()].filter(a=>!a.hidden).length,words:[...tally.values()]};
}
async function mock(route){
 const data=JSON.parse(route.request().postData()||'{}');
 const role=data.token==='teacher'?'teacher':data.token==='display'?'display':'student';
 let result={},status=200;
 if(data.action==='create')result={code:'222222',teacherToken:'teacher',displayToken:'display'};
 else if(data.action==='join')result={code:'222222',token:data.name.toLowerCase()};
 else if(data.action==='library')result={items:[],polls:[]};
 else if(data.action==='start'){active={id:'cloud-round',type:'cloud',prompt:data.prompt||'',status:'open',unit:'individual',revealed:false};result={active}}
 else if(data.action==='state'){
  result={code:'222222',roomOpen:true,active,serverTime:Date.now(),participants:2};
  if(role==='teacher')result.answers=[...answers].map(([subject,a])=>({...a,subject}));
  if(role==='student')result.mine=answers.get(data.token)||null;
 }else if(data.action==='cloud-live'){
  if(role==='student'){status=403;result={error:'No permission'}}
  else if(role==='display'&&!shown){result={roundId:'cloud-round',visible:false,version:-1,words:[],events:[]}}
  else if(data.since===version){result={roundId:'cloud-round',version,visible:true,unchanged:true}}
  else result={roundId:'cloud-round',version,visible:true,...projection(),events:[...events]};
 }else if(data.action==='submit'){
  const subject=data.token,previous=answers.get(subject);
  answers.set(subject,{value:String(data.value),revision:(previous?.revision||0)+1,hidden:false,name:subject});
  events.push({id:'event-'+(++version),value:String(data.value),at:Date.now()});
  result={ok:true,revision:answers.get(subject).revision};
 }else if(data.action==='control'){shown=data.control==='reveal';result={ok:true,active:{...active,revealed:shown}}}
 else if(data.action==='moderate'){const row=answers.get(data.subject);if(row){row.hidden=data.hidden;version++}result={ok:true}}
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
}
async function page(){
 const p=await browser.newPage({viewport:{width:1280,height:800}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/.netlify/functions/toolkit',mock);await p.goto(address);return p;
}
async function student(name){
 const p=await page();await p.locator('#open-student').click();await p.locator('#room-code').fill('222222');
 await p.locator('#join-name').fill(name);await p.locator('#join-submit').click();
 await p.locator('#student-answer').waitFor({timeout:8000});return p;
}
try{
 const teacher=await page();await teacher.locator('#open-teacher').click();
 await teacher.locator('#teacher-pin').fill('synthetic-pin');await teacher.locator('#create-submit').click();
 await teacher.locator('[data-tool="cloud"]').click();
 await teacher.locator('#question').fill('Which word describes this process?');
 await teacher.locator('#launch').click();
 await teacher.locator('#cloud-stage').waitFor({state:'visible',timeout:8000});
 await teacher.evaluate(()=>{
  window.__cloudArrivals=[];
  new MutationObserver(records=>{for(const r of records)for(const node of r.addedNodes){
   if(node.nodeType===1&&node.classList.contains('cloud-droplet'))window.__cloudArrivals.push(node.textContent)
  }}).observe(document.querySelector('#cloud-rain'),{childList:true});
 });
 const a=await student('Alpha');
 const b=await student('Beta');
 await a.locator('#student-answer').fill('Flow');const before=Date.now();
 await a.locator('#student-answer').press('Enter');
 await teacher.waitForFunction(()=>document.querySelector('#cloud-words')?.textContent.includes('Flow'),null,{timeout:6000});
 const delay=Date.now()-before;
 assert.ok(delay<5000,'Cloud should update promptly; observed '+delay+'ms');
 assert.equal(await teacher.locator('#cloud-words .cloud-word-live').count(),1);
 await teacher.locator('.cloud-word-live').evaluate(el=>{el.__sameNode=1});
 await b.locator('#student-answer').fill('flow');
 await b.locator('#submit-answer').click();
 await teacher.waitForFunction(()=>document.querySelector('#cloud-count')?.textContent==='2',null,{timeout:6000});
 assert.equal(await teacher.locator('.cloud-word-live').count(),1,'Duplicates must aggregate');
 assert.equal(await teacher.locator('.cloud-word-live').evaluate(el=>el.__sameNode),1,'Word node must not be rebuilt');
 const fontsize=await teacher.locator('.cloud-word-live').evaluate(el=>parseFloat(el.style.fontSize));
 assert.ok(fontsize>=36,'Repeated word should grow');
 await teacher.waitForFunction(()=>window.__cloudArrivals.includes('flow'),null,{timeout:4500});
 assert.equal(await teacher.locator('.student-tabs').count(),0,'Lecturer tool structure must remain intact');
 console.log('Cloud appears promptly and word falls in with stable DOM. Student-to-cloud:',delay,'ms');
 assert.deepEqual(errors,[]);
 await b.close();await a.close();await teacher.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
