import test from 'node:test';
import assert from 'node:assert/strict';
import {TrackSource,TokenVerifier} from 'livekit-server-sdk';
import handler from '../netlify/functions/live-token.mjs';

test('student token uses the LiveKit protobuf screen-share source and cannot subscribe',async()=>{
  // Synthetic credentials; no external LiveKit request and no real secrets.
  const names=['LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','CIA4103_TEACHER_PIN'];
  const prior=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  try{
    process.env.LIVEKIT_URL='wss://synthetic-test.livekit.cloud';
    process.env.LIVEKIT_API_KEY='synthetic-test-key';
    process.env.LIVEKIT_API_SECRET='synthetic-secret-for-ci-tests-only-abcdefgh';
    process.env.CIA4103_TEACHER_PIN='synthetic-teacher-pin-very-long';
    assert.equal(TrackSource.SCREEN_SHARE,3);
    const request=new Request('http://localhost/api/live-token',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({role:'student',name:'Synthetic Student'})
    });
    const response=await handler(request);
    const body=await response.json();
    assert.equal(response.status,200,body.error||'Student token issuance should succeed');
    assert.equal(body.display,'Synthetic Student');
    assert.equal(body.url,process.env.LIVEKIT_URL);
    assert.ok(body.token,'must return a JWT');
    const grants=await new TokenVerifier(process.env.LIVEKIT_API_KEY,process.env.LIVEKIT_API_SECRET).verify(body.token);
    assert.equal(grants.video.roomJoin,true);
    assert.equal(grants.video.canPublish,true);
    assert.deepEqual(grants.video.canPublishSources,['screen_share']);
    assert.equal(grants.video.canSubscribe,false);
    assert.equal(grants.video.canPublishData,false);
  }finally{
    for(const key of names){
      if(prior[key]===undefined)delete process.env[key];
      else process.env[key]=prior[key];
    }
  }
});
