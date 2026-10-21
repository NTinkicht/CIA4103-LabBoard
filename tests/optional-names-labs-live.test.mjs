import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePost,makeRecord,makeCSV,validTask} from '../netlify/functions/board-core.mjs';
import {detectLanguage,taskFromText} from '../public/assets/checker.mjs';
import {configured,teacherAuthorized,allowedPart} from '../netlify/lib/live-auth.mjs';
const post=(name='Amina',part='Lab 10 · Exercise 2',code='<form method="get"><input name="title"/></form>')=>({part,type:'display',note:'Working form',code,name});
test('student name and activity are required by backend',()=>{
 assert.throws(()=>validatePost(post('')),/name/i);
 assert.throws(()=>validatePost(post('Amina','  ')),/lab or activity/i);
 assert.throws(()=>validatePost(post('Amina','Task\n1')),/lab or activity/i);
});
test('any nonempty activity is accepted, without Lab 09 restriction',()=>{
 const p=makeRecord(validatePost(post('  Amina  ','Chapter 12 / Task A')));
 assert.equal(p.name,'Amina');
 assert.equal(p.part,'Chapter 12 / Task A');
 assert.ok(validTask('Capstone project - Demo 4'));
 assert.ok(allowedPart('Capstone project - Demo 4'));
});
test('language is inferred without student language dropdown',()=>{
 assert.equal(detectLanguage('public IActionResult Test() { return View(); }'),'csharp');
 assert.equal(detectLanguage('<form asp-action="BookByTitle"></form>'),'razor');
 assert.equal(detectLanguage('<h2>Hello</h2>'),'html');
 assert.equal(detectLanguage('body { color: red; padding: 12px; }'),'css');
 assert.equal(detectLanguage('SELECT * FROM Books WHERE Price > 10;'),'sql');
 const p=makeRecord(validatePost({...post(),lang:'sql'}));
 assert.equal(p.lang,'html','user input cannot override language detection');
});
test('known natural Lab 09 references retain targeted hints',()=>{
 assert.equal(taskFromText('Lab 09a – Task 3'),'09a-3');
 assert.equal(taskFromText('Lab 09b - Task 1'),'09b-1');
 assert.equal(taskFromText('Chapter 12'),'');
});
test('CSV contains names and escapes spreadsheet formulas',()=>{
 const p=makeRecord(validatePost(post('=HYPERLINK("x")')));
 assert.match(makeCSV([p]),/"'=HYPERLINK/);
});
test('LiveKit is not enabled with incomplete credentials',()=>{
 assert.equal(configured({LIVEKIT_URL:'wss://example.livekit.cloud'}),false);
});
test('lecturer PIN required and cannot be forged',()=>{
 const env={LIVEKIT_URL:'wss://example.livekit.cloud',LIVEKIT_API_KEY:'key',LIVEKIT_API_SECRET:'secret',CIA4103_TEACHER_PIN:'long-private-passphrase'};
 assert.equal(configured(env),true);
 assert.equal(teacherAuthorized('long-private-passphrase',env),true);
 assert.equal(teacherAuthorized('incorrect',env),false);
});
test('dynamic PDF viewer persists arbitrary documents locally',()=>{
 const js=readFileSync(new URL('../public/assets/lab-pdfs.mjs',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/dashboard/index.html',import.meta.url),'utf8');
 assert.match(js,/indexedDB\.open/);
 assert.match(js,/getAll\(\)/);
 assert.match(js,/addDocument\(file\)/);
 assert.match(html,/id="pdf-add"/);
 assert.match(html,/id="pdf-tabs"/);
 assert.doesNotMatch(html,/id="pdf-09a"/);
});
test('student live screen sharing requires a name but no activity field',()=>{
 const studentPage=readFileSync(new URL('../public/live/index.html',import.meta.url),'utf8');
 const studentModule=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 const liveToken=readFileSync(new URL('../netlify/functions/live-token.mjs',import.meta.url),'utf8');
 assert.match(studentPage,/id="name"[^>]*required/);
 assert.doesNotMatch(studentPage,/id="part"/);
 assert.doesNotMatch(studentModule,/\$\('part'\)/);
 assert.match(studentModule,/role:'student',name:/);
 assert.match(liveToken,/part:isTeacher\?'':'Screen share'/);
 assert.doesNotMatch(liveToken,/allowedPart\(data\.part\)/);
});
test('lecturer token preflight validates LiveKit project credentials',()=>{
 const tokenSource=readFileSync(new URL('../netlify/functions/live-token.mjs',import.meta.url),'utf8');
 assert.match(tokenSource,/RoomServiceClient/);
 assert.match(tokenSource,/await api\.listRooms\(\)/);
 assert.match(tokenSource,/LiveKit rejected the API key or secret/);
});
test('live screen selection begins directly from a student click',()=>{
 const s=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 const click=s.indexOf("$('start').addEventListener('click'");
 const capture=s.indexOf('navigator.mediaDevices.getDisplayMedia({video:true,audio:false})',click);
 const token=s.indexOf("fetch('/api/live-token'",click);
 assert.ok(click>=0&&capture>click&&token>capture);
});
