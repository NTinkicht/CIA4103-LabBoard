// Real-browser PPTX presentation smoke test, run on GitHub Actions against local static build.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,normalize} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const type={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 const pathname=decodeURI((req.url||'/').split('?')[0]);
 const file=normalize(join(root,pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{
  const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':type[extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Frame-Options':'SAMEORIGIN'});
  res.end(bytes);
 }catch{res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},acceptDownloads:true});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+port+'/toolkit/presenter/',{waitUntil:'domcontentloaded'});
 assert.match(await page.title(),/Files & Slides/);
 const raw=await fetch('https://raw.githubusercontent.com/unStone/web-ppt/master/fixtures/sample.pptx');
 assert.equal(raw.ok,true,'Fixture PPTX must download');
 const bytes=Buffer.from(await raw.arrayBuffer());
 await page.locator('#upload').setInputFiles({name:'sample.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:bytes});
 await page.waitForFunction(()=>document.querySelector('#counter')?.textContent?.startsWith('Slide 1 of '),{timeout:60000});
 assert.equal(await page.locator('#viewer img').count(),1,'PPTX should render as a slide image');
 const before=await page.locator('#counter').innerText();
 await page.locator('#next').click();
 await page.waitForFunction(before=>document.querySelector('#counter')?.textContent!==before,before,{timeout:8000});
 console.log('PPTX FIRST SLIDE:',before,'NEXT:',await page.locator('#counter').innerText());
 await page.locator('#fullscreen').click();
 await page.waitForFunction(()=>document.fullscreenElement!==null,{timeout:8000});
 console.log('PPTX fullscreen enabled');
 await page.keyboard.press('Escape');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#counter')?.textContent?.startsWith('Slide 1 of '),{timeout:60000});
 console.log('IndexedDB PPTX restoration validated');
 assert.deepEqual(errors,[],'Browser must not throw unhandled exceptions');
 // Simulated lecturer API exercises actual Toolkit UI navigation without requiring real credentials.
 const lecturer=await browser.newPage({viewport:{width:1300,height:850}});
 await lecturer.route('**/.netlify/functions/toolkit',async route=>{
  const req=route.request(),body=JSON.parse(req.postData()||'{}');
  const payload=body.action==='create'?{code:'123456',teacherToken:'test-teacher',displayToken:'test-display'}:
    body.action==='library'?{items:[],polls:[]}:
    body.action==='work'?{items:[]}:
    body.action==='state'?{code:'123456',roomOpen:true,active:null,serverTime:Date.now(),participants:0}:
    {ok:true};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
 await lecturer.goto('http://127.0.0.1:'+port+'/toolkit/',{waitUntil:'domcontentloaded'});
 await lecturer.locator('#open-teacher').click();
 await lecturer.locator('#teacher-pin').fill('synthetic-test-pin-only');
 await lecturer.locator('#create-submit').click();
 await lecturer.locator('[data-tool="cloud"]').click();
 assert.equal(await lecturer.locator('#save-question').count(),1,'Word Cloud must offer Save');
 await lecturer.locator('[data-tool="answers"]').click();
 assert.equal(await lecturer.locator('#save-question').count(),1,'Live Answers must offer Save');
 await lecturer.locator('[data-tool="poll"]').click();
 assert.equal(await lecturer.locator('#save-question').count(),1,'Poll must offer Save');
 await lecturer.locator('[data-tool="documents"]').click();
 const frame=lecturer.frameLocator('#document-frame');
 await frame.locator('#upload').waitFor({state:'attached',timeout:10000});
 assert.match(await frame.locator('h1').first().innerText(),/Present your slides/);
 assert.equal(await frame.locator('.library-bar').count(),0,'No second stacked file toolbar');
 const toolbarBox=await frame.locator('.toolbar').boundingBox();
 assert.ok(toolbarBox.height<=85,'Presentation file controls should use one compact row');
 await frame.locator('#upload').setInputFiles({name:'class-sample.pptx',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation',buffer:bytes});
 await frame.locator('#counter').waitFor({timeout:60000});
 await lecturer.waitForFunction(()=>document.querySelector('#document-frame')?.contentDocument?.querySelector('#counter')?.textContent?.startsWith('Slide 1 of '),null,{timeout:60000});
 const slideBox=await frame.locator('#viewer').boundingBox();
 assert.ok(slideBox.height>420,'Slide should occupy most of the vertical viewport');
 const initialFile=await frame.locator('#documents').inputValue();
 assert.ok(initialFile,'Presentation should be loaded in the embedded viewer');

 const docsFrameBounds=await lecturer.locator('#document-frame').boundingBox();
 const railBounds=await lecturer.locator('.rail').boundingBox();
 assert.ok(docsFrameBounds.width>620,'PDF/PowerPoint viewer should remain readable alongside student roster');
 assert.equal(await lecturer.locator('#participation-panel').isVisible(),true,'Files & Slides shows student roster');
 assert.match(await lecturer.locator('#participation-summary').innerText(),/not tracked|no students have joined/i);
 assert.ok(railBounds.x<35&&railBounds.width<=230,'Compact sidebar should start at left viewport edge');
 assert.equal(await lecturer.locator('#live-results-panel').isVisible(),false,'No unrelated activity results beneath files');
 console.log('Wide Files & Slides frame:',Math.round(docsFrameBounds.width),'Sidebar width:',Math.round(railBounds.width));
 await lecturer.locator('#rail-toggle').click();
 assert.equal(await lecturer.locator('#rail-toggle').getAttribute('aria-expanded'),'false');
 assert.equal(await lecturer.locator('.tool-link').first().getAttribute('aria-label'),'Live Poll');
 const collapsedRail=await lecturer.locator('.rail').boundingBox();
 const expandedSlides=await lecturer.locator('#document-frame').boundingBox();
 assert.ok(collapsedRail.width<=80,'Collapsed rail should be icon-only and narrow');
 assert.ok(expandedSlides.width>docsFrameBounds.width+110,'Sidebar collapse should materially expand slide width');
 assert.equal(await frame.locator('#documents').inputValue(),initialFile,'Collapsing must not reload the loaded presentation');
 assert.equal(await lecturer.evaluate(()=>localStorage.getItem('classroom-toolkit-rail-collapsed')),'true');
 await lecturer.locator('#rail-toggle').click();
 assert.equal(await lecturer.locator('#rail-toggle').getAttribute('aria-expanded'),'true');
 assert.equal(await lecturer.evaluate(()=>localStorage.getItem('classroom-toolkit-rail-collapsed')),'false');
 console.log('Compact slides toolbar and collapsible icon-only tool rail passed');
 let autoLiveLogin=null;
 await lecturer.route('**/api/live-token',async route=>{
  autoLiveLogin=JSON.parse(route.request().postData()||'{}');
  await route.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'Synthetic LiveKit intentionally offline for UI test'})});
 });
 await lecturer.locator('[data-tool="collaborate"]').click();
 const screenFrame=lecturer.frameLocator('#teacher-screen-frame');
 await screenFrame.locator('#stream-teacher-root').waitFor({state:'visible',timeout:15000});
 await screenFrame.locator('#stream-pin').waitFor({state:'attached',timeout:10000});
 assert.equal(await screenFrame.locator('.stream-login').isVisible(),false,'No second lecturer PIN prompt in Toolkit');
 await lecturer.waitForFunction(()=>document.querySelector('#teacher-screen-frame')?.contentDocument?.querySelector('#stream-status')?.textContent?.includes('Synthetic LiveKit'),null,{timeout:15000});
 assert.equal(autoLiveLogin?.toolkitToken,'test-teacher','Embedded screen sharing must authenticate with existing room token');
 assert.equal(autoLiveLogin?.pin,undefined,'The PIN must not be requested or leaked');
 assert.equal(await screenFrame.locator('#stream-video-stage').count(),0,'No incorrect screen stage ID');
 assert.equal(await screenFrame.locator('.stream-video-stage').count(),1,'Live screen viewer should be shown directly');
 assert.equal(await screenFrame.locator('.stream-sidebar').count(),1,'Student approval queue should be shown directly');
 assert.equal(await lecturer.locator('#participation-panel').isVisible(),false,'Screen Sharing keeps its dedicated queue, not the participation panel');
 assert.equal(await screenFrame.locator('.lab-tabs, #board-view, #labs-view, #tab-labs, #tab-board').count(),0,'No legacy lab/dashboard sections inside Screen Sharing');
 assert.equal(await screenFrame.locator('h1').count(),0,'No duplicated Live classroom code board heading');
 assert.equal(await lecturer.locator('#live-results-panel').isVisible(),false,'Whiteboard should not reappear below Screen Sharing');
 const screenBounds=await lecturer.locator('#teacher-screen-frame').boundingBox();
 assert.ok(screenBounds.width>820,'Embedded screen-sharing panel should be wide');
 const area=await screenFrame.locator('.stream-video-stage').boundingBox();
 const statusBounds=await screenFrame.locator('#stream-status').boundingBox();
 assert.ok(area.height>=400,'Shared screen area should be tall and prioritized');
 assert.ok(statusBounds.height<=45,'Connection status should be compact');
 // The teacher's ongoing LiveKit iframe is never recreated while changing tools.
 await screenFrame.locator('body').evaluate(()=>{window.__persistentToolkitScreenSession=1});
 await lecturer.locator('[data-tool="documents"]').click();
 assert.equal(await lecturer.locator('#teacher-screen-host').isVisible(),false);
 assert.equal(await lecturer.locator('#teacher-slides-host').isVisible(),true);
 assert.equal(await lecturer.locator('#live-results-panel').isVisible(),false);
 await lecturer.locator('[data-tool="collaborate"]').click();
 assert.equal(await screenFrame.locator('body').evaluate(()=>window.__persistentToolkitScreenSession),1);
 assert.equal(await lecturer.locator('#live-results-panel').isVisible(),false);
 console.log('Focused embedded screen sharing, sidebar and persistent screens tested at desktop width');
 console.log('Toolkit lecturer tabs and same-origin Files & Slides iframe validated');

 await lecturer.locator('[data-tool="work"]').click();
 await lecturer.locator('#teacher-work-list').waitFor({timeout:7000});
 await lecturer.waitForFunction(()=>document.querySelector('#teacher-work-list')?.textContent?.includes('Nothing here yet'),{timeout:8000});
 console.log('Lecturer private Work & Problems tab present');
 // The student always has exactly three tabs on one URL after joining the classroom.
 const student=await browser.newPage({viewport:{width:390,height:844}});
 student.on('pageerror',e=>errors.push('student: '+e.message));
 let workCalls=0;
 await student.route('**/.netlify/functions/toolkit',async route=>{
  const data=JSON.parse(route.request().postData()||'{}');
  const payload=data.action==='join'?{code:'123456',token:'synthetic-student'}:
    data.action==='state'?{code:'123456',roomOpen:true,active:{id:'round-1',type:'poll',unit:'individual',status:'open',revealed:false,prompt:'Which option?',options:['Option 1','Option 2']},serverTime:Date.now(),mine:null}:
    data.action==='work'&&data.operation==='submit'?(workCalls++,{ok:true,id:'synthetic-work'}):
    {ok:true};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)});
 });
 await student.goto('http://127.0.0.1:'+port+'/toolkit/',{waitUntil:'domcontentloaded'});
 await student.locator('#open-student').click();
 await student.locator('#room-code').fill('123456');
 await student.locator('#join-name').fill('Student One');
 await student.locator('#join-submit').click();
 await student.locator('.student-tabs [role="tab"]').first().waitFor({timeout:8000});
 assert.equal(await student.locator('.student-tabs [role="tab"]').count(),3);
 assert.equal(await student.locator('#student-activities-panel').isVisible(),true);
 await student.locator('input[name="student-vote"]').first().waitFor({timeout:8000});
 await student.locator('#tab-screen').click();
 await student.locator('#embedded-screen-share').waitFor({state:'visible',timeout:8000});
 const share=student.frameLocator('#embedded-screen-share');
 await share.locator('#name').waitFor({state:'visible',timeout:8000});
 await student.waitForFunction(()=>document.querySelector('#embedded-screen-share')?.contentDocument?.querySelector('#name')?.value==='Student One',null,{timeout:10000});
 assert.equal(await share.locator('#name').inputValue(),'Student One');
 await share.locator('body').evaluate(()=>{window.__preserveIframeOnTabSwitch=true});
 await student.locator('#tab-work').click();
 assert.equal(await student.locator('#student-work-panel').isVisible(),true);
 await student.locator('#work-topic').fill('My exercise');
 await student.locator('#work-note').fill('This operation fails');
 await student.locator('#send-work').click();
 await student.waitForFunction(()=>document.querySelector('#work-status')?.textContent?.includes('Shared successfully'),{timeout:8000});
 assert.equal(workCalls,1);
 await student.locator('#tab-screen').click();
 assert.equal(await share.locator('body').evaluate(()=>window.__preserveIframeOnTabSwitch),true,'Screen-sharing iframe must remain mounted');
 await student.locator('#tab-activities').click();
 assert.equal(await student.locator('input[name="student-vote"]').count(),2);
 assert.equal(student.url(),'http://127.0.0.1:'+port+'/toolkit/','Switching tabs must not navigate');
 const overflow=await student.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 assert.ok(overflow<=3,'Mobile student page must have no horizontal overflow');
 console.log('Student 3 tabs, embedded screen sharing, same-iframe persistence, work submission and poll restoration passed');
 await student.close();

 await lecturer.close();

}finally{await browser.close();await new Promise(r=>server.close(r))}
