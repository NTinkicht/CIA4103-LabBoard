const $=id=>document.getElementById(id),root=$('stream-teacher-root');
// Classroom room stays connected when the lecturer changes tabs.
root.innerHTML=\`
<div class="stream-login">
 <label for="stream-pin">Private lecturer PIN</label>
 <div class="stream-login-controls"><input id="stream-pin" type="password" autocomplete="off" placeholder="Enter lecturer PIN">
 <button type="button" class="secondary" id="stream-connect">Connect to classroom</button>
 <button type="button" class="secondary" id="stream-leave" disabled>Disconnect</button></div>
</div>
<p id="stream-status" role="status" aria-live="polite" class="hint">Connect to see waiting students. You authorize who can publish.</p>
<div class="stream-workspace">
 <div class="stream-main">
  <div class="stream-main-header"><div><strong id="presenter-name">No application window is being shared</strong><span id="presenter-note">Approve a student from the queue. They then select an application window.</span></div>
  <button type="button" class="secondary" id="stream-stop-all" disabled>Stop current share</button></div>
  <div class="stream-video-stage"><video id="primary-stream-video" autoplay playsinline muted></video><p id="stream-empty">Waiting for an approved student to share an application window.</p></div>
 </div>
 <aside class="stream-sidebar" aria-label="Student waiting queue">
  <div class="stream-sidebar-head"><h3>Connected students</h3><span id="stream-count">0</span></div>
  <p class="hint">Approve one student at a time. Switching stops the previous stream.</p>
  <div id="stream-list" class="stream-cards">Connect to see the queue.</div>
 </aside>
</div>\`;
let room=null,pin='',busy=false,changing=false,activeId=null;
const status=(msg,error=false)=>{$('stream-status').textContent=msg;$('stream-status').style.color=error?'#b74b36':'#087f78'};
function updateViewer(){
 const presenter=room?.remoteParticipants?.get(activeId);
 const pub=[...(presenter?.videoTrackPublications?.values()||[])].find(p=>p.source===LivekitClient.Track.Source.ScreenShare&&p.track);
 const video=$('primary-stream-video'),empty=$('stream-empty');
 if(pub?.track){
  pub.track.attach(video);video.style.display='block';empty.style.display='none';
 }else{
  video.srcObject=null;video.style.display='none';empty.style.display='grid';
  empty.textContent=activeId?'Student approved — waiting for them to click “Share application window”.':'Waiting for an approved student to share an application window.';
 }
}
function renderPeople(items){
 const panel=$('stream-list');panel.replaceChildren();
 $('stream-count').textContent=String(items.length);
 if(!items.length)panel.textContent='No student requests yet.';
 for(const student of items){
  const card=document.createElement('div');card.className='stream-student'+(student.approved?' presenting':'');
  const name=document.createElement('strong');name.textContent=student.name||'Student';
  const state=document.createElement('small');state.textContent=student.approved?(student.sharing?'● LIVE':'✓ Approved · Awaiting window'):'Waiting for approval';
  const button=document.createElement('button');button.type='button';button.className=student.approved?'secondary':'primary';
  button.disabled=changing;button.textContent=student.approved?'Stop this share':'Approve & show';
  button.addEventListener('click',()=>switchTo(student.approved?null:student.identity));
  card.append(name,state,button);panel.append(card);
 }
}
async function refresh(){
 if(!room||busy||changing)return;busy=true;
 try{
  const response=await fetch('/api/live-participants',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({pin}),cache:'no-store'
  });
  const result=await response.json();if(!response.ok)throw Error(result.error||'Unable to read student list');
  const items=Array.isArray(result.streams)?result.streams:[];
  activeId=result.active||null;
  const approved=items.find(s=>s.identity===activeId);
  $('presenter-name').textContent=approved?(approved.name+' · '+(approved.sharing?'LIVE':'Approved')):'No application window is being shared';
  $('presenter-note').textContent=approved?(approved.sharing?'Live application-window feed':'Waiting for the student to click Share application window'):'Approve a student from the queue to start presenting.';
  $('stream-stop-all').disabled=!activeId;
  renderPeople(items);updateViewer();
  status('● CONNECTED · '+items.length+' student(s) · '+(activeId?'1 approved presenter':'No approved presenter')+'. Checks every five seconds.');
 }catch(err){status('Could not update the waiting list: '+err.message,true);}
 finally{busy=false;}
}
async function switchTo(identity){
 if(!room||changing)return;changing=true;$('stream-stop-all').disabled=true;
 status(identity?'Approving student and stopping the previous share…':'Stopping current presentation…');
 try{
  const response=await fetch('/api/live-control',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({pin,action:identity?'approve':'stop',identity:identity||undefined})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not switch presenters');
  status(identity?'Student approved. They must click Share application window.':'Current student presentation stopped.');
 }catch(err){status('Presenter switch failed: '+err.message,true);}
 finally{changing=false;await refresh();}
}
$('stream-stop-all').addEventListener('click',()=>switchTo(null));
function onSubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare||track.kind!=='video')return;
 if(!activeId||p.identity===activeId)updateViewer();
}
function onUnsubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare)return;
 track.detach();updateViewer();
}
$('stream-connect').addEventListener('click',async()=>{
 if(room)return;
 if(!window.LivekitClient){status('LiveKit library is unavailable. Check your network.',true);return;}
 const value=$('stream-pin').value;
 if(!value){status('Enter your private lecturer PIN.',true);return;}
 $('stream-connect').disabled=true;status('Connecting to the classroom…');
 try{
  const response=await fetch('/api/live-token',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({role:'teacher',pin:value})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to authorize lecturer');
  pin=value;room=new LivekitClient.Room({adaptiveStream:true});
  room.on(LivekitClient.RoomEvent.TrackSubscribed,onSubscribed);
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed,onUnsubscribed);
  room.on(LivekitClient.RoomEvent.TrackPublished,()=>{if(room)refresh();});
  room.on(LivekitClient.RoomEvent.TrackUnpublished,()=>{if(room)refresh();});
  room.on(LivekitClient.RoomEvent.ParticipantConnected,()=>refresh());
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected,()=>refresh());
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{
   activeId=null;room=null;pin='';$('stream-leave').disabled=true;$('stream-connect').disabled=false;
   $('stream-list').replaceChildren();updateViewer();status('Classroom connection closed.');
  });
  await room.connect(data.url,data.token,{autoSubscribe:true});
  $('stream-pin').value='';$('stream-leave').disabled=false;await refresh();
 }catch(err){
  status('Could not connect: '+err.message,true);
  if(room)await room.disconnect().catch(()=>{});
  room=null;pin='';$('stream-connect').disabled=false;
 }
});
$('stream-leave').addEventListener('click',async()=>{
 if(room)await room.disconnect();room=null;pin='';activeId=null;
 $('stream-connect').disabled=false;$('stream-leave').disabled=true;$('stream-list').replaceChildren();updateViewer();
 status('Disconnected from the classroom.');
});
setInterval(()=>{if(room&&!document.hidden)refresh();},5000);
window.addEventListener('focus',()=>{if(room)refresh();});
window.addEventListener('cia4103:streams-tab',()=>{if(room){refresh();updateViewer();}});
window.addEventListener('pagehide',()=>room?.disconnect());
