import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const name=decodeURI((req.url||'/').split('?')[0]),file=normalize(join(root,name.endsWith('/')?name+'index.html':name));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Frame-Options':'SAMEORIGIN'});res.end(data)}
 catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const origin='http://127.0.0.1:'+server.address().port+'/toolkit/';
const errors=[],banks={jumbled:[],mcq:[]},answers=new Map(),history=[];
const members=[{id:'alice',name:'Alice',team:''},{id:'bob',name:'Bob',team:''}];
let active=null,counter=0;
function publicRound(){
 if(!active)return null;
 const ended=active.status==='closed'||Date.now()>=active.endsAt;
 const r={id:active.id,type:'evaluation',evalKind:active.evalKind,title:active.title,prompt:active.prompt,
  options:active.options||[],tiles:active.tiles||[],duration:active.duration,unit:'individual',
  endsAt:active.endsAt,status:ended?'closed':'open',revealed:active.revealed};
 if(ended&&active.revealed){
  r.correctAnswer=active.evalKind==='mcq'?active.correct:active.steps;
  if(active.evalKind==='jumbled')r.correctIds=active.correctOrder;
 }
 return r;
}
async function mock(route){
 const d=JSON.parse(route.request().postData()||'{}'),teacher=d.token==='teacher-token',student=d.token==='student-alice';
 let out={ok:true},status=200;
 if(d.action==='create')out={code:'333333',teacherToken:'teacher-token',displayToken:'display-token'};
 else if(d.action==='join')out={code:'333333',token:'student-alice'};
 else if(d.action==='library')out={items:[],polls:[]};
 else if(d.action==='evaluation-bank'){
  if(d.operation==='list')out={items:banks[d.kind]};
  else if(d.operation==='save'){
   const q={...d.item,id:'bank-'+(++counter),revision:1,kind:d.kind,
    updatedAt:new Date().toISOString()};
   banks[d.kind].push(q);out={item:q};status=201;
  }else if(d.operation==='delete'){
   banks[d.kind]=banks[d.kind].filter(q=>q.id!==d.id);out={ok:true};
  }
 }else if(d.action==='evaluation-start'){
  const q=banks[d.kind].find(q=>q.id===d.id);
  const ids=q.steps?.map((_,i)=>'randomid-'+i)||[];
  active={id:'round-'+(++counter),type:'evaluation',evalKind:d.kind,title:q.title,prompt:q.prompt,
   options:q.options||[],steps:q.steps||[],tiles:ids.map((id,i)=>({id,text:q.steps[i]})).reverse(),
   correctOrder:ids,correct:q.correct,duration:d.duration,endsAt:Date.now()+d.duration*1000,
   status:'open',revealed:false,unit:'individual'};
  history.push(active.id);out={active:publicRound()};
 }else if(d.action==='state'){
  const current=publicRound(),rows=[...answers.values()].filter(a=>a.roundId===active?.id);
  out={code:'333333',roomOpen:true,active:current,serverTime:Date.now(),participants:2};
  if(teacher){out.students=members.map(m=>({...m,participated:rows.some(a=>a.subject===m.id)}));
   out.answers=rows;out.results={total:rows.length};}
  if(student){
   const user=rows.find(a=>a.subject==='alice');
   out.mine=user||null;
   const opportunities=history.length;
   const answered=history.filter(id=>[...answers.values()].some(a=>a.roundId===id&&a.subject==='alice')).length;
   out.engagement={score:opportunities?Math.round(answered*100/opportunities):0,participated:answered,opportunities};
  }
 }else if(d.action==='submit'){
  if(!student){status=403;out={error:'Students only'}}
  else{
   answers.set(active.id+':alice',{subject:'alice',name:'Alice',value:d.value,revision:1,
     submittedAt:new Date().toISOString(),hidden:false,roundId:active.id});
   out={ok:true,revision:1};
  }
 }else if(d.action==='control'){
  if(d.control==='evaluation-reveal'){
   if(Date.now()<active.endsAt){status=409;out={error:'Timer running'}}
   else{active.revealed=true;out={active:publicRound()}}
  }else if(d.control==='finish'){active=null;out={ok:true,active:null}}
 }else if(d.action==='work')out={items:[]};
 else if(d.action==='cloud-live')out={version:0,visible:true,total:0,words:[],events:[]};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(out)});
}
async function page(){
 const p=await browser.newPage({viewport:{width:1300,height:860}});
 p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/.netlify/functions/toolkit',mock);await p.goto(origin);return p;
}
async function until(p,expr,timeout=10000){await p.waitForFunction(expr,null,{timeout})}
try{
 const teacher=await page(),student=await page();
 await teacher.locator('#open-teacher').click();
 await teacher.locator('#teacher-pin').fill('synthetic-test-pin');
 await teacher.locator('#create-submit').click();
 await teacher.locator('[data-tool="evaluation"]').click();
 await teacher.locator('#eval-jumbled-tab').waitFor({state:'visible',timeout:10000});
 assert.equal(await teacher.locator('#participation-panel').isVisible(),true);
 await student.locator('#open-student').click();
 await student.locator('#room-code').fill('333333');
 await student.locator('#join-name').fill('Alice');
 await student.locator('#join-submit').click();
 await student.locator('#student-engagement').waitFor({state:'visible',timeout:9000});
 assert.equal(await student.locator('#engagement-score').innerText(),'0%');
 await teacher.locator('#eval-title').fill('Five E order');
 await teacher.locator('#eval-prompt').fill('Arrange learning phases');
 await teacher.locator('#eval-items').fill('Engage\nExplore\nExplain\nExtend\nEvaluate');
 await teacher.locator('#eval-save').click();
 await teacher.locator('[data-eval-launch]').waitFor({state:'visible'});
 await teacher.locator('#eval-duration').fill('10');
 await teacher.locator('[data-eval-launch]').first().click();
 await student.locator('#eval-tiles [data-tile]').first().waitFor({state:'visible',timeout:10000});
 assert.match(await student.locator('#student-eval-clock').innerText(),/^\d\d:\d\d$/);
 assert.equal(await student.locator('#student-eval-correct').isVisible(),false,'No answer leaked');
 for(let i=0;i<5;i++)await student.locator('#eval-tiles [data-tile]').first().click();
 await student.locator('#student-eval-submit').click();
 await until(student,()=>document.querySelector('#student-eval-status')?.textContent?.includes('submitted'));
 await until(teacher,()=>document.querySelector('#eval-summary')?.textContent?.includes('1 of 2'));
 await until(student,()=>document.querySelector('#engagement-score')?.textContent==='100%');
 await student.locator('#tab-work').click();
 assert.equal(await student.locator('#engagement-score').isVisible(),true,'Score remains across student tabs');
 await student.locator('#tab-activities').click();
 active.endsAt=Date.now()-1000;
 await teacher.locator('#eval-reveal').waitFor({state:'visible'});
 await until(teacher,()=>document.querySelector('#eval-reveal')?.disabled===false);
 await teacher.locator('#eval-reveal').click();
 await until(student,()=>document.querySelector('#student-eval-correct')?.hidden===false);
 assert.match(await student.locator('#student-eval-correct').innerText(),/Engage.*Explore.*Explain/);
 await teacher.locator('#eval-close').click();
 await until(student,()=>document.querySelector('.student-activities-home')!==null);
 await until(teacher,()=>document.querySelector('#eval-prepare')?.hidden===false);
 await teacher.locator('#eval-mcq-tab').click();
 assert.equal(await teacher.locator('#eval-mcq-tab').getAttribute('aria-selected'),'true');
 await teacher.locator('#eval-title').fill('Security MCQ');
 await teacher.locator('#eval-prompt').fill('Choose access policy');
 await teacher.locator('#eval-items').fill('Least privilege\nFull access\nAnonymous access');
 await teacher.locator('#eval-correct').selectOption('0');
 await teacher.locator('#eval-save').click();
 await teacher.locator('#eval-duration').fill('15');
 await teacher.locator('[data-eval-launch]').first().click();
 await student.locator('.eval-mcq-choices input').first().waitFor({state:'visible',timeout:10000});
 await until(student,()=>document.querySelector('#engagement-score')?.textContent==='50%');
 await student.locator('.eval-mcq-choices input[value="0"]').check();
 await student.locator('#student-eval-submit').click();
 await until(student,()=>document.querySelector('#engagement-score')?.textContent==='100%');
 active.endsAt=Date.now()-1000;
 await until(teacher,()=>document.querySelector('#eval-reveal')?.disabled===false);
 await teacher.locator('#eval-reveal').click();
 await until(student,()=>document.querySelector('#student-eval-correct')?.hidden===false);
 assert.match(await student.locator('#student-eval-correct').innerText(),/Least privilege/);
 assert.equal(await student.locator('.student-tabs [role="tab"]').count(),3);
 assert.deepEqual(errors,[]);
 console.log('Timed Jumbled and MCQ question banks, submissions, reveal, close and engagement score passed in Chrome');
 await teacher.close();await student.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
