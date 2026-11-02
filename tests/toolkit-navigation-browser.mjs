// End-to-end navigation contract: grouped menus, accessible tabs, persistent
// embedded workspaces, global Timer and unchanged three-tab student experience.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,normalize,extname} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';

const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const pathname=decodeURI((req.url||'/').split('?')[0]);
 const file=normalize(join(root,pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{const data=await readFile(file);res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(file)]||'application/octet-stream','Content-Security-Policy':csp});res.end(data)}
 catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
let active=null;let id=0;let savedLesson=null;const errors=[];const bankRequests=[];
async function handle(route){
 const body=JSON.parse(route.request().postData()||'{}');
 let response={ok:true};
 if(body.action==='create')response={code:'123456',teacherToken:'test-teacher',displayToken:'test-projector'};
 else if(body.action==='join')response={code:'123456',token:'test-student'};
 else if(body.action==='state')response={code:'123456',roomOpen:true,active,participants:0,students:[],answers:[],serverTime:Date.now(),results:{votes:[],total:0,words:[]}};
 else if(body.action==='session-report')response={code:'123456',students:[{id:'s',name:'Student',team:'',eligible:2,participated:1,rate:50}],activities:[{id:'a',type:'poll',participated:1,eligible:1}]};
 else if(body.action==='resource-index')response={groups:[{kind:'poll',count:1,items:[{id:'test',title:'Sample poll'}]},{kind:'lesson',count:0,items:[]}]};
 else if(body.action==='lesson-bank'){
  if(body.operation==='save'){savedLesson={...body.item,id:'11111111-1111-4111-8111-111111111111',revision:(savedLesson?.revision||0)+1};response={item:savedLesson};if(body.item.title==='Race plan')await new Promise(resolve=>setTimeout(resolve,150))}
  else response={items:savedLesson?[savedLesson]:[]};
 }
 else if(body.action==='evaluation-bank'&&body.operation==='list'){
  bankRequests.push(body.kind);
  if(body.kind==='jumbled')await new Promise(resolve=>setTimeout(resolve,200));
  response={items:[body.kind==='mcq'?
   {id:'mcq-only',title:'MCQ only',prompt:'Choose an answer',options:['A','B'],correct:0}:
   {id:'jumbled-only',title:'Jumbled only',prompt:'Order the steps',steps:['A','B']} ]};
 }
 else if(['library','evaluation-bank','document-bank','work','web-links'].includes(body.action))response={items:[],polls:[]};
 else if(body.action==='start'){
  active={id:'round-'+(++id),type:body.type,prompt:body.prompt||'',options:body.options||[],status:'open',revealed:false,
   unit:body.unit||'individual',endsAt:body.type==='timer'?Date.now()+body.duration*1000:null};
  response={active};
 }else if(body.action==='control'&&body.control==='finish'){active=null;response={active:null}}
 else if(body.action==='cloud-live')response={roundId:active?.id,visible:true,words:[],total:0,events:[]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(response)});
}
try{
 const teacher=await browser.newPage({viewport:{width:1330,height:860}});
 teacher.on('pageerror',error=>errors.push(error.message));
 await teacher.route('**/.netlify/functions/toolkit',handle);
 await teacher.goto(base);
 await teacher.locator('#open-teacher').click();
 await teacher.locator('#teacher-pin').fill('test-only-pin');
 await teacher.locator('#create-submit').click();
 await teacher.locator('#teacher-group-tabs [role="tab"]').first().waitFor({state:'visible'});
 assert.equal(await teacher.locator('#mode-free').getAttribute('aria-pressed'),'true','Free Mode must be the default');
 await teacher.locator('#mode-5es').click();
 assert.equal(await teacher.locator('#lesson-panel').isVisible(),true);
 assert.equal(await teacher.locator('.lesson-phases button').count(),5);
 await teacher.locator('#lesson-title').fill('CREATE Book lesson');
 assert.equal(await teacher.evaluate(()=>JSON.parse(localStorage.getItem('classroom-toolkit-lesson')).title),'CREATE Book lesson','Text edits save before blur');
 await teacher.locator('#lesson-tool').selectOption('answers');
 await teacher.locator('#lesson-open-tool').click();
 assert.equal(await teacher.locator('[data-tool="answers"]').getAttribute('aria-selected'),'true','Selected 5Es tool is open');
 await teacher.locator('#lesson-next').click();
 assert.match(await teacher.locator('.lesson-editor strong').innerText(),/Explore/);
 await teacher.locator('#mode-free').click();
 assert.equal(await teacher.locator('#lesson-panel').isVisible(),false);
 await teacher.locator('#mode-5es').click();
 await teacher.locator('#lesson-save-shared').click();
 await teacher.locator('#lesson-library option').last().waitFor({state:'attached'});
 assert.equal(savedLesson.title,'CREATE Book lesson');
 await teacher.locator('#lesson-title').fill('Race plan');
 await teacher.locator('#lesson-save-shared').click();
 await teacher.locator('#lesson-new').click();
 await teacher.waitForTimeout(250);
 assert.equal(await teacher.locator('#lesson-title').inputValue(),'Untitled lesson','Late save must not replace a new plan');
 assert.equal(await teacher.locator('#lesson-library').inputValue(),'','Late save must not attach the previous plan ID');
 await teacher.locator('#mode-free').click();
 assert.equal(await teacher.locator('#mode-free').getAttribute('aria-pressed'),'true');
 assert.equal(await teacher.locator('#lesson-title').count(),1,'Planner remains mounted but hidden in Free Mode');
 assert.deepEqual(await teacher.locator('#tool-nav [data-group]').evaluateAll(nodes=>nodes.map(el=>el.textContent.trim())),
  ['▥Interact','▣Collaborate','◈Assess','▧Present']);
 assert.equal(await teacher.locator('#teacher-group-tabs [role="tab"]').count(),3);
 assert.equal(await teacher.locator('#toolbar-timer').isVisible(),true);
 assert.equal(await teacher.locator('#activity-questions').isVisible(),true);
 const railWidth=(await teacher.locator('.rail').boundingBox()).width;
 await teacher.locator('#rail-toggle').click();
 assert.equal(await teacher.locator('#rail-toggle').getAttribute('aria-expanded'),'false');
 assert.ok((await teacher.locator('.rail').boundingBox()).width<railWidth,'Collapsing reduces sidebar width');
 assert.equal(await teacher.locator('[data-group="interact"]').getAttribute('aria-label'),'Interact');
 await teacher.locator('#rail-toggle').click();
 await teacher.locator('[data-tool="poll"]').press('ArrowRight');
 assert.equal(await teacher.locator('[data-tool="answers"]').getAttribute('aria-selected'),'true','Right arrow selects next tool');
 await teacher.locator('[data-tool="answers"]').press('Home');
 assert.equal(await teacher.locator('[data-tool="poll"]').getAttribute('aria-selected'),'true','Home returns to first tool');
 for(const tool of ['answers','cloud','poll']){
  await teacher.locator('[data-tool="'+tool+'"]').click();
  assert.equal(await teacher.locator('[data-tool="'+tool+'"]').getAttribute('aria-selected'),'true');
 }

 await teacher.locator('[data-group="collaborate"]').click();
 assert.equal(await teacher.locator('#teacher-group-tabs [role="tab"]').count(),4);
 assert.equal(await teacher.locator('.collab-tabs').isVisible(),false,'No duplicate inner tabs');
 const sharing=teacher.frameLocator('#teacher-screen-frame');
 await sharing.locator('body').waitFor({state:'attached'});
 await sharing.locator('body').evaluate(()=>{window.__keepSharing=42});
 await teacher.locator('[data-tool="whiteboard"]').click();
 assert.equal(await teacher.locator('#collab-whiteboard').isVisible(),true);
 await teacher.locator('[data-tool="document"]').click();
 assert.equal(await teacher.locator('#collab-document').isVisible(),true);
 await teacher.locator('[data-tool="work"]').click();
 await teacher.locator('#teacher-work-list').waitFor({state:'visible'});
 await teacher.locator('[data-group="interact"]').click();
 assert.equal(await teacher.locator('[data-tool="poll"]').getAttribute('aria-selected'),'true','Last Interact tab restored');
 await teacher.locator('[data-group="collaborate"]').click();
 assert.equal(await teacher.locator('[data-tool="work"]').getAttribute('aria-selected'),'true','Last Collaborate tab restored');
 await teacher.locator('[data-tool="screen"]').click();
 assert.equal(await sharing.locator('body').evaluate(()=>window.__keepSharing),42,'LiveKit frame must survive tab and group switches');

 await teacher.locator('[data-group="assess"]').click();
 assert.equal(await teacher.locator('#teacher-group-tabs [role="tab"]').count(),2);
 assert.equal(await teacher.locator('.eval-tabs').isVisible(),false);
 assert.equal(await teacher.locator('#eval-items-label').innerText(),'Answer options — one choice per line');
 await teacher.locator('#eval-bank').getByText('MCQ only').waitFor();
 assert.ok(bankRequests.length>0&&bankRequests.every(kind=>kind==='mcq'),
  'Initial Assess mount must never request the unselected Jumbled bank');
 await teacher.locator('[data-tool="jumbled"]').click();
 assert.equal(await teacher.locator('#eval-items-label').innerText(),'Correct order — one step per line');
 await teacher.locator('[data-tool="mcq"]').click();
 await teacher.waitForTimeout(300);
 assert.match(await teacher.locator('#eval-bank').innerText(),/MCQ only/,'Stale Jumbled response cannot replace the MCQ bank');
 assert.doesNotMatch(await teacher.locator('#eval-bank').innerText(),/Jumbled only/);
 assert.equal(await teacher.locator('#eval-mcq-tab').getAttribute('aria-selected'),'true');
 await teacher.locator('[data-group="present"]').click();
 assert.equal(await teacher.locator('#teacher-group-tabs [role="tab"]').count(),4);
 await teacher.locator('#document-frame').waitFor({state:'visible'});
 await teacher.locator('[data-tool="web"]').click();
 const web=teacher.frameLocator('#teacher-web-frame');
 await web.locator('body').waitFor({state:'attached'});
 await web.locator('body').evaluate(()=>{window.__keepWeb=17});
 await teacher.locator('[data-tool="documents"]').click();
 await teacher.locator('[data-tool="web"]').click();
 assert.equal(await web.locator('body').evaluate(()=>window.__keepWeb),17,'Saved browser remains mounted');

 await teacher.locator('[data-tool="library"]').click();
 await teacher.locator('#resource-index').getByText('Sample poll').waitFor();
 await teacher.locator('[data-resource-bank="poll"]').click();
 assert.equal(await teacher.locator('[data-tool="poll"]').getAttribute('aria-selected'),'true');
 await teacher.locator('[data-tool="report"]').click();
 await teacher.locator('#session-report').getByText('50%').first().waitFor();
 assert.equal(await teacher.locator('#report-export').isEnabled(),true);
 await teacher.locator('#toolbar-timer').click();
 assert.equal(await teacher.locator('#teacher-group-tabs').isVisible(),false);
 await teacher.locator('#duration').selectOption('60');
 await teacher.locator('#launch').click();
 await teacher.locator('#toolbar-timer-clock').waitFor({state:'visible'});
 assert.match(await teacher.locator('#toolbar-timer-clock').innerText(),/^\d{2}:\d{2}$/);
 await teacher.locator('[data-group="interact"]').click();
 assert.equal(await teacher.locator('#toolbar-timer-clock').isVisible(),true,'Countdown is visible while navigating');
 await teacher.locator('#stop-current-activity').click();
 await teacher.waitForFunction(()=>document.querySelector('#toolbar-timer-clock')?.hidden===true);
 assert.equal(await teacher.locator('#tool-nav [data-group]').count(),4);
 assert.equal(await teacher.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=3,true,'Desktop has no horizontal overflow');
 await teacher.setViewportSize({width:390,height:844});
 assert.ok((await teacher.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=3,'Lecturer mobile has no horizontal overflow');

 const mobile=await browser.newPage({viewport:{width:390,height:844}});
 mobile.on('pageerror',error=>errors.push('mobile: '+error.message));
 await mobile.route('**/.netlify/functions/toolkit',handle);
 await mobile.goto(base);
 await mobile.locator('#open-student').click();
 await mobile.locator('#room-code').fill('123456');
 await mobile.locator('#join-name').fill('Student');
 await mobile.locator('#join-submit').click();
 await mobile.locator('.student-tabs [role="tab"]').first().waitFor({state:'visible'});
 assert.equal(await mobile.locator('.student-tabs [role="tab"]').count(),3);
 assert.ok((await mobile.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=3,'Student mobile has no horizontal overflow');
 await mobile.close();

 assert.deepEqual(errors,[],'No unhandled browser errors');
 await teacher.close();
 console.log('Grouped lecturer navigation, embedded persistence, Timer utility and student tabs passed');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
