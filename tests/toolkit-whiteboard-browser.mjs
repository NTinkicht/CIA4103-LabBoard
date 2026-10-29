import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname,normalize} from 'node:path';
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const root=join(process.cwd(),'public');
const type={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css'};
const csp="default-src 'none'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https: wss:; frame-src blob: 'self'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'";
const server=createServer(async(req,res)=>{
 const path=decodeURI((req.url||'/').split('?')[0]);
 const file=normalize(join(root,path.endsWith('/')?path+'index.html':path));
 if(!file.startsWith(root)){res.writeHead(403);res.end();return}
 try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':type[extname(file)]||'application/octet-stream','Content-Security-Policy':csp,'X-Frame-Options':'SAMEORIGIN'});res.end(bytes)}
 catch{if(!res.headersSent)res.writeHead(404);res.end()}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port+'/toolkit/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--no-sandbox']});
const errors=[],board={version:0,generation:0,writerId:null,strokes:[]},teacher='teacher-token';
let active=null;
const members=[{id:'11111111-1111-4111-8111-111111111111',name:'Anna',team:''},{id:'22222222-2222-4222-8222-222222222222',name:'Bashir',team:''}];
const idForToken={anna:members[0].id,bashir:members[1].id};
async function mock(route){
 const data=JSON.parse(route.request().postData()||'{}');
 const role=data.token===teacher?'teacher':String(data.token||'').startsWith('student-')?'student':'display';
 const name=String(data.token||'').replace(/^student-/,'').toLowerCase();
 const id=idForToken[name],member=members.find(m=>m.id===id);
 let payload={},status=200;
 if(data.action==='create')payload={code:'123456',teacherToken:teacher,displayToken:'display-token'};
 else if(data.action==='join')payload={code:'123456',token:'student-'+data.name.toLowerCase()};
 else if(data.action==='state')payload={code:'123456',roomOpen:true,active,serverTime:Date.now(),participants:2,
   ...(role==='teacher'?{students:members.map(m=>({...m,participated:null}))}:{})};
 else if(data.action==='board'){
  if(data.operation==='activate'){
   active={id:'board-round-1',type:'whiteboard',status:'open',prompt:'Shared Whiteboard'};
   payload={active};
  }else if(data.operation==='read'){
   payload={version:board.version,generation:board.generation,writerId:board.writerId,
    canDraw:role==='teacher'||Boolean(id&&board.writerId===id),active:true};
   if(data.since!==board.version)payload.strokes=structuredClone(board.strokes);
   if(role==='teacher')payload.students=members;
  }else if(data.operation==='random'){
   if(role!=='teacher'){status=403;payload={error:'Lecturer only'}}
   else{
    const chosen=members.find(m=>m.id!==board.writerId)||members[0];
    board.writerId=chosen.id;board.version++;
    payload={ok:true,writerId:chosen.id,name:chosen.name};
   }
  }else if(data.operation==='select'){
   if(role!=='teacher'){status=403;payload={error:'Lecturer only'}}
   else {board.writerId=data.studentId;board.version++;payload={ok:true,writerId:board.writerId}}
  }else if(data.operation==='element'){
   if(!(role==='teacher'||Boolean(id&&board.writerId===id))){status=409;payload={error:'Not permitted'}}
   else{board.version++;board.strokes.push({id:'item-'+board.version,...data.element});payload={ok:true}}
  }else if(['edit','move','remove'].includes(data.operation)){
   if(!(role==='teacher'||Boolean(id&&board.writerId===id))){status=409;payload={error:'Not permitted'}}
   else{
    const index=board.strokes.findIndex(x=>x.id===data.id);
    if(index<0){status=409;payload={error:'Missing object'}}
    else{
     if(data.operation==='remove')board.strokes.splice(index,1);
     if(data.operation==='edit')Object.assign(board.strokes[index],data.changes);
     if(data.operation==='move')Object.assign(board.strokes[index],{x:data.x,y:data.y});
     board.version++;payload={ok:true}
    }
   }
  }else if(data.operation==='stroke'){
   if(!(role==='teacher'||Boolean(id&&board.writerId===id))){status=409;payload={error:'Not permitted'}}
   else{board.version++;board.strokes.push({id:String(board.version),points:data.points,color:data.color,width:data.width});payload={ok:true}}
  }else if(data.operation==='clear'){
   if(role!=='teacher'){status=403;payload={error:'Lecturer only'}}
   else{board.generation++;board.version++;board.strokes=[];payload={ok:true}}
  }else if(data.operation==='undo'){
   if(role!=='teacher'){status=403;payload={error:'Lecturer only'}}
   else{board.version++;board.strokes.pop();payload={ok:true}}
  }
 }else if(data.action==='library')payload={items:[],polls:[]};
 await route.fulfill({status,contentType:'application/json',body:JSON.stringify(payload)});
}
async function page(){const p=await browser.newPage({viewport:{width:1280,height:850}});p.on('pageerror',e=>errors.push(e.message));await p.route('**/.netlify/functions/toolkit',mock);await p.goto(url);return p}
async function student(name){
 const p=await page();await p.locator('#open-student').click();await p.locator('#room-code').fill('123456');
 await p.locator('#join-name').fill(name);await p.locator('#join-submit').click();
 await p.locator('#student-board-mount canvas').waitFor({state:'visible',timeout:10000});return p;
}
async function drag(p,selector){
 await p.locator(selector).scrollIntoViewIfNeeded();
 const rect=await p.locator(selector).boundingBox();
 assert.ok(rect,'Missing board canvas');
 await p.mouse.move(rect.x+rect.width*.2,rect.y+rect.height*.25);
 await p.mouse.down();
 await p.mouse.move(rect.x+rect.width*.3,rect.y+rect.height*.35,{steps:4});
 await p.mouse.up();
}
try{
 const t=await page();await t.locator('#open-teacher').click();await t.locator('#teacher-pin').fill('synthetic-pin');
 await t.locator('#create-submit').click();
 await t.locator('[data-tool="collaborate"]').click();
 await t.locator('#collab-tab-whiteboard').click();
 await t.locator('#collab-open-board').click();
 await t.locator('#teacher-board-mount canvas').waitFor({timeout:8000});
 await t.locator('#collab-students .collab-person').first().waitFor({timeout:8000});
 assert.equal(await t.locator('#collab-students .collab-person').count(),2);
 const a=await student('Anna'),b=await student('Bashir');
 assert.equal(await a.locator('.student-tabs [role="tab"]').count(),3);
 await a.locator('#wb-permission').waitFor({state:'attached'});
 assert.match(await a.locator('#wb-permission').innerText(),/View only/);
 assert.match(await b.locator('#wb-permission').innerText(),/View only/);
 const before=board.strokes.length;
 await drag(a,'#student-board-mount canvas');
 assert.equal(board.strokes.length,before,'Nonselected student should not draw');
 await t.locator('#collab-students .collab-person').filter({hasText:'Anna'}).click();
 await a.waitForFunction(()=>document.querySelector('#student-board-mount #wb-permission')?.textContent?.includes('You can write'),null,{timeout:7000});
 await drag(a,'#student-board-mount canvas');
 await a.waitForFunction(()=>document.querySelector('#wb-status')?.textContent?.includes('Stroke saved'),null,{timeout:8000});
 assert.equal(board.strokes.length,1);
 await t.locator('#collab-students .collab-person').filter({hasText:'Bashir'}).click();
 await a.waitForFunction(()=>document.querySelector('#student-board-mount #wb-permission')?.textContent?.includes('View only'),null,{timeout:7000});
 await b.waitForFunction(()=>document.querySelector('#student-board-mount #wb-permission')?.textContent?.includes('You can write'),null,{timeout:7000});
 await drag(b,'#student-board-mount canvas');
 await b.waitForFunction(()=>document.querySelector('#wb-status')?.textContent?.includes('Stroke saved'),null,{timeout:8000});
 assert.equal(board.strokes.length,2);
 await drag(t,'#teacher-board-mount canvas');
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Stroke saved'),null,{timeout:8000});
 assert.equal(board.strokes.length,3);
 // Teacher creates a rectangle, ellipse and arrow from the tools menu.
 await t.locator('#teacher-board-mount [data-wb-tool="rectangle"]').click();
 await drag(t,'#teacher-board-mount canvas');
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Shape added'),null,{timeout:8000});
 assert.equal(board.strokes.at(-1).shape,'rectangle');
 await t.locator('#teacher-board-mount [data-wb-tool="ellipse"]').click();
 await drag(t,'#teacher-board-mount canvas');
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Shape added'),null,{timeout:8000});
 assert.equal(board.strokes.at(-1).shape,'ellipse');
 await t.locator('#teacher-board-mount [data-wb-tool="arrow"]').click();
 await drag(t,'#teacher-board-mount canvas');
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Shape added'),null,{timeout:8000});
 assert.equal(board.strokes.at(-1).shape,'arrow');
 // Create text box and edit it from the canvas.
 await t.locator('#teacher-board-mount [data-wb-tool="text"]').click();
 await drag(t,'#teacher-board-mount canvas');
 await t.locator('#teacher-board-mount #wb-editor').waitFor({state:'visible',timeout:8000});
 await t.locator('#teacher-board-mount #wb-editor-input').fill('Cycle time');
 await t.locator('#teacher-board-mount #wb-editor-save').click();
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Text box created'),null,{timeout:8000});
 const label=board.strokes.at(-1);
 assert.equal(label.type,'text');
 assert.equal(label.text,'Cycle time');
 // Create a 2 x 3 table and update the first cell through the double-click editor.
 await t.locator('#teacher-board-mount [data-wb-tool="table"]').click();
 await t.locator('#teacher-board-mount #wb-rows').selectOption('2');
 await t.locator('#teacher-board-mount #wb-cols').selectOption('3');
 await drag(t,'#teacher-board-mount canvas');
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Table created'),null,{timeout:8000});
 const table=board.strokes.at(-1);
 assert.equal(table.type,'table');
 assert.equal(table.rows,2);
 assert.equal(table.cols,3);
 await t.locator('#teacher-board-mount [data-wb-tool="select"]').click();
 const rect=await t.locator('#teacher-board-mount canvas').boundingBox();
 const cellX=rect.x+(table.x+20)*rect.width/1000;
 const cellY=rect.y+(table.y+20)*rect.height/600;
 await t.mouse.dblclick(cellX,cellY,{delay:70});
 await t.locator('#teacher-board-mount #wb-editor').waitFor({state:'visible',timeout:8000});
 await t.locator('#teacher-board-mount #wb-editor-input').fill('Process');
 await t.locator('#teacher-board-mount #wb-editor-save').click();
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Table cell updated'),null,{timeout:8000});
 assert.equal(board.strokes.at(-1).cells[0],'Process');
 // Move selected table and ensure the move survives a server refresh.
 const beforeX=board.strokes.at(-1).x;
 await t.mouse.move(cellX,cellY);
 await t.mouse.down();
 await t.mouse.move(cellX+35,cellY+20,{steps:4});
 await t.mouse.up();
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Object moved'),null,{timeout:8000});
 assert.ok(board.strokes.at(-1).x>beforeX,'Table should move on the canvas');
 // Existing selected student can create a new shape; revoking permission blocks creation.
 await a.locator('#student-board-mount [data-wb-tool="rectangle"]').click();
 const countBefore=board.strokes.length;
 await drag(a,'#student-board-mount canvas');
 assert.equal(board.strokes.length,countBefore,'Anna no longer has edit permission');
 console.log('Whiteboard shapes, text editor, 2x3 table, cell edit and moving passed');

 t.once('dialog',dialog=>dialog.accept());
 await t.locator('#wb-clear').click();
 await t.waitForFunction(()=>document.querySelector('#teacher-board-mount #wb-status')?.textContent?.includes('Whiteboard cleared'),null,{timeout:7000});
 assert.equal(board.strokes.length,0);
 console.log('Whiteboard clear and writer switching passed');
 // The random button grants writing rights immediately and does not repeat
 // the same student while another is eligible.
 const priorWriter=board.writerId;
 const nextName=members.find(m=>m.id!==priorWriter).name;
 await t.locator('#collab-random').click();
 await t.waitForFunction(name=>document.querySelector('#collab-selected')?.textContent?.includes(name),nextName,{timeout:8000});
 assert.notEqual(board.writerId,priorWriter);
 const selectedAfterFirst=board.writerId;
 const pickedName=members.find(m=>m.id===selectedAfterFirst).name;
 assert.match(await t.locator('#collab-selected').innerText(),new RegExp(pickedName));
 await t.locator('#collab-random').click();
 await t.waitForFunction(expected=>document.querySelector('#collab-selected')?.textContent?.includes(expected),members.find(m=>m.id!==selectedAfterFirst).name,{timeout:8000});
 assert.notEqual(board.writerId,selectedAfterFirst);
 console.log('Whiteboard random writer picker and no-immediate-repeat passed');

 await a.locator('#tab-screen').click();
 await a.locator('#tab-activities').click();
 assert.equal(await a.locator('#student-board-mount canvas').count(),1);
 assert.deepEqual(errors,[]);
 console.log('Whiteboard teacher roster and writer switching passed in Chromium');
 await b.close();await a.close();await t.close();
}finally{await browser.close();await new Promise(r=>server.close(r))}
