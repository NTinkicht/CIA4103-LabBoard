// Real Chromium regression for lecturer web viewer + saved URL library.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,normalize} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const cspNormal="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const cspBrowser="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src https: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const pathname=decodeURI((req.url||'/').split('?')[0]);
 const path=normalize(join(root,pathname.endsWith('/')?pathname+'index.html':pathname));
 if(!path.startsWith(root)){res.writeHead(403);res.end();return}
 try{
  const bytes=await readFile(path);
  res.writeHead(200,{'Content-Type':{'.html':'text/html','.mjs':'text/javascript','.css':'text/css'}[extname(path)]||'application/octet-stream',
   'Content-Security-Policy':pathname.startsWith('/toolkit/browser/')?cspBrowser:cspNormal,
   'X-Frame-Options':pathname.startsWith('/toolkit/browser/')?'SAMEORIGIN':'DENY'});
  res.end(bytes);
 }catch{res.writeHead(404);res.end()}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const errors=[],items=new Map();
let seq=0;
async function mock(route){
 const body=JSON.parse(route.request().postData()||'{}');
 let response={},status=200;
 if(body.action==='create')response={code:'111111',teacherToken:'synthetic-teacher',displayToken:'synthetic-projector'};
 else if(body.action==='state')response={code:'111111',roomOpen:true,serverTime:Date.now(),participants:0,active:null};
 else if(body.action==='library')response={items:[]};
 else if(body.action==='web-links'){
  if(body.token!=='synthetic-teacher'){status=403;response={error:'Lecturer only'}}
  else if(body.operation==='list')response={items:[...items.values()].filter(i=>!i.archived)};
  else if(body.operation==='save'){
   const old=items.get(body.id);
   if(old&&old.revision!==body.revision){status=409;response={error:'Revision mismatch'}}
   else{
    const item={id:body.id||'link-'+(++seq),title:body.item.title,url:body.item.url,revision:(old?.revision||0)+1};
    items.set(item.id,item);response={item};status=old?200:201;
   }
  }else if(body.operation==='delete'){
   const old=items.get(body.id);
   if(!old){status=404;response={error:'Link not found'}}
   else{old.archived=true;response={ok:true}}
  }
 }else response={ok:true};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(response)});
}
try{
 const lecturer=await browser.newPage({viewport:{width:1440,height:900}});
 lecturer.on('pageerror',e=>errors.push('lecturer: '+e.message));
 await lecturer.route('**/.netlify/functions/toolkit',mock);
 await lecturer.route('https://example.com/**',route=>route.fulfill({status:200,
  contentType:'text/html',body:'<!doctype html><title>Example lesson</title><p>Example lesson site</p>'}));
 await lecturer.goto(url);
 await lecturer.locator('#open-teacher').click();
 await lecturer.locator('#teacher-pin').fill('synthetic-private-pin');
 await lecturer.locator('#create-submit').click();
 await lecturer.locator('[data-tool="web"]').click();
 const iframe=lecturer.frameLocator('#teacher-web-frame');
 await iframe.locator('#web-address').waitFor({state:'visible',timeout:12000});
 await lecturer.waitForFunction(()=>document.querySelector('#teacher-web-frame')?.contentDocument?.
   querySelector('#web-status')?.textContent?.includes('saved website'),null,{timeout:12000});
 assert.equal(await lecturer.locator('#teacher-web-host').isVisible(),true);
 assert.equal(await iframe.locator('#web-frame').isVisible(),false);
 assert.equal(await iframe.locator('#web-add').isDisabled(),false);
 // Navigate to a URL and bookmark it in server-backed storage.
 await iframe.locator('#web-address').fill('https://example.com/lesson');
 await iframe.locator('.web-go').click();
 await iframe.locator('#web-frame').waitFor({state:'visible',timeout:8000});
 assert.equal(await iframe.locator('#web-frame').getAttribute('src'),'https://example.com/lesson');
 await iframe.locator('#web-add').click();
 await iframe.locator('#web-editor').waitFor({state:'visible'});
 await iframe.locator('#web-title').fill('Course docs');
 await iframe.locator('#web-save').click();
 await iframe.locator('#web-editor').waitFor({state:'hidden',timeout:8000});
 assert.equal(items.size,1);
 await iframe.locator('#web-bookmarks option').nth(1).waitFor({state:'attached',timeout:8000});
 assert.equal(await iframe.locator('#web-bookmarks option').nth(1).innerText(),'Course docs');
 // Browser-like navigation history is within the Toolkit's viewer, no page navigation.
 await iframe.locator('#web-address').fill('https://example.com/second');
 await iframe.locator('.web-go').click();
 await iframe.locator('#web-back').click();
 assert.equal(await iframe.locator('#web-address').inputValue(),'https://example.com/lesson');
 await iframe.locator('#web-forward').click();
 assert.equal(await iframe.locator('#web-address').inputValue(),'https://example.com/second');
 const bookmarked=[...items.values()][0];
 await iframe.locator('#web-bookmarks').selectOption(bookmarked.id);
 assert.equal(await iframe.locator('#web-address').inputValue(),'https://example.com/lesson');
 const original=await iframe.locator('#web-address').evaluate(el=>{window.__keepBrowserState=77;return el.value});
 await lecturer.locator('[data-tool="documents"]').click();
 assert.equal(await lecturer.locator('#teacher-web-host').isVisible(),false);
 await lecturer.locator('[data-tool="web"]').click();
 assert.equal(await iframe.locator('#web-address').evaluate(el=>window.__keepBrowserState),77,
  'Web viewer must stay mounted when lecturer changes tools');
 assert.equal(await iframe.locator('#web-address').inputValue(),original);
 const bounds=await lecturer.locator('#teacher-web-frame').boundingBox();
 assert.ok(bounds.width>900&&bounds.height>550,'Browser should use available lecturer workspace');
 // Saved URL manager: edit and delete without destroying viewer.
 await iframe.locator('#web-manage').click();
 await iframe.locator('#web-library').waitFor({state:'visible'});
 await iframe.locator('.web-library-row button').filter({hasText:'Edit'}).click();
 await iframe.locator('#web-title').fill('Updated course docs');
 await iframe.locator('#web-save').click();
 await iframe.locator('#web-bookmarks option').nth(1).waitFor({state:'attached'});
 assert.equal([...items.values()][0].title,'Updated course docs');
 await iframe.locator('#web-manage').click();
 lecturer.once('dialog',dialog=>dialog.accept());
 await iframe.locator('.web-library-row button').filter({hasText:'Delete'}).click();
 await lecturer.waitForFunction(()=>document.querySelector('#teacher-web-frame')?.contentDocument?.
   querySelector('#web-bookmarks')?.options.length===1,null,{timeout:8000});
 assert.equal(await iframe.locator('#web-bookmarks').isDisabled(),true);
 assert.deepEqual(errors,[]);
 console.log('Web Browser URL navigation, saved links, edit/delete, viewer persistence and sandbox layout passed');
 await lecturer.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
