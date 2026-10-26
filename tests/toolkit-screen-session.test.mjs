import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {lecturerAuthorized} from '../netlify/lib/live-auth.mjs';
const env={LIVEKIT_URL:'wss://livekit.example.test',LIVEKIT_API_KEY:'synthetic-key',
LIVEKIT_API_SECRET:'test-livekit-api-secret-that-is-long-enough',CIA4103_TEACHER_PIN:'long-private-pin-for-tests',
TOOLKIT_SESSION_SECRET:'test-private-toolkit-secret-32chars-long'};
const now=Date.now(),code='234567';
function token(claims,secret=env.TOOLKIT_SESSION_SECRET){
 const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
 return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}
function fake(room){
 return ()=>({get:async key=>key==='room/'+code?room:null});
}
test('existing lecturer PIN still grants standalone LiveKit access',async()=>{
 assert.equal(await lecturerAuthorized({pin:env.CIA4103_TEACHER_PIN},fake(null),env,now),true);
 assert.equal(await lecturerAuthorized({pin:'wrong'},fake(null),env,now),false);
});
test('valid active lecturer classroom session grants LiveKit access without PIN',async()=>{
 const claims={role:'teacher',code,exp:now+3600000};
 const room={code,expiresAt:now+3600000,ended:false};
 assert.equal(await lecturerAuthorized({toolkitToken:token(claims)},fake(room),env,now),true);
});
test('unauthorized or expired classroom sessions never grant LiveKit access',async()=>{
 const room={code,expiresAt:now+3600000,ended:false},base={role:'teacher',code,exp:now+3600000};
 for(const input of [
   {toolkitToken:token({...base,role:'student'})},
   {toolkitToken:token({...base,role:'display'})},
   {toolkitToken:token({...base,exp:now-1})},
   {toolkitToken:token({...base,code:'000000'})},
   {toolkitToken:token(base,'forged-secret-for-tests-only-and-long')},
   {toolkitToken:'not-a-token'},
   {toolkitToken:token(base).slice(0,-2)}
 ])assert.equal(await lecturerAuthorized(input,fake(room),env,now),false);
 assert.equal(await lecturerAuthorized({toolkitToken:token(base)},fake({...room,ended:true}),env,now),false);
 assert.equal(await lecturerAuthorized({toolkitToken:token(base)},fake({...room,expiresAt:now-10}),env,now),false);
 assert.equal(await lecturerAuthorized({toolkitToken:token(base)},fake(null),env,now),false);
});
