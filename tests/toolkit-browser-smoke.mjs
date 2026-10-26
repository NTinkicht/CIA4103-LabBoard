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
 console.log('Toolkit lecturer tabs and same-origin Files & Slides iframe validated');
 await lecturer.close();

}finally{await browser.close();await new Promise(r=>server.close(r))}
