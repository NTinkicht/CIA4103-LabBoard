import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePost,makeRecord,makeCSV} from '../netlify/functions/board-core.mjs';
import {configured,teacherAuthorized,publicName,allowedPart} from '../netlify/functions/live-auth.mjs';
const post=(name='')=>({part:'09a-1',type:'display',lang:'razor',note:'Showing my form',code:'<form method="get"></form>',name});
test('name is optional and an anonymous submission remains anonymous',()=>{
 const p=makeRecord(validatePost(post()));
 assert.equal(p.name,'');
});
test('name is preserved on the post and in teacher CSV export',()=>{
 const p=makeRecord(validatePost(post('  Amina  ')));
 assert.equal(p.name,'Amina');
 assert.match(makeCSV([p]),/Amina/);
});
test('oversized names and control characters are rejected',()=>{
 assert.throws(()=>validatePost(post('a'.repeat(61))),/Name/);
 assert.throws(()=>validatePost(post('Any\nName')),/Name/);
});
test('CSV neutralizes spreadsheet formula injection in the name',()=>{
 const p=makeRecord(validatePost(post('=HYPERLINK("x")')));
 assert.match(makeCSV([p]),/"'=HYPERLINK/);
});
test('live auth is disabled unless all server secrets are present',()=>{
 assert.equal(configured({LIVEKIT_URL:'wss://example.livekit.cloud'}),false);
});
test('teacher PIN check uses the correct secret and rejects incorrect PIN',()=>{
 const env={LIVEKIT_URL:'wss://test.livekit.cloud',LIVEKIT_API_KEY:'key',LIVEKIT_API_SECRET:'secret',CIA4103_TEACHER_PIN:'a-long-teacher-passphrase'};
 assert.equal(configured(env),true);
 assert.equal(teacherAuthorized('a-long-teacher-passphrase',env),true);
 assert.equal(teacherAuthorized('incorrect-pin',env),false);
});
test('public screen-share names and lab tasks are constrained',()=>{
 assert.equal(publicName(' First Name '),'First Name');
 assert.equal(allowedPart('09a-5'),true);
 assert.equal(allowedPart('09b-3'),true);
 assert.equal(allowedPart('../../admin'),false);
});
test('lab viewer supports exactly two uploaded PDF labels without a server upload',()=>{
 const src=readFileSync(new URL('../public/assets/lab-pdfs.mjs',import.meta.url),'utf8');
 assert.match(src,/indexedDB\.open/);
 assert.match(src,/\['09a','09b'\]/);
 assert.doesNotMatch(src,/fetch\(.*pdf-file/);
});
test('screen capture is directly initiated from a student click',()=>{
 const src=readFileSync(new URL('../public/assets/live-student.mjs',import.meta.url),'utf8');
 const click=src.indexOf("$('start').addEventListener('click'");
 const capture=src.indexOf('navigator.mediaDevices.getDisplayMedia({video:true,audio:false})',click);
 const token=src.indexOf("fetch('/api/live-token'",click);
 assert.ok(click>=0&&capture>click&&token>capture);
});
