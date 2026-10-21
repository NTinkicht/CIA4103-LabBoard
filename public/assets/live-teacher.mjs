const $=id=>document.getElementById(id),root=$('stream-teacher-root');
// Classroom room stays connected when the lecturer changes tabs.
root.innerHTML=`
<div class="stream-login">
 <label for="stream-pin">Private lecturer PIN</label>
 <div class="stream-login-controls"><input id="stream-pin" type="password" autocomplete="off" placeholder="Enter lecturer PIN">
 <button type="button" class="secondary" id="stream-connect">Connect to classroom</button>
 <button type="button" class="secondary" id="stream-leave" disabled>Disconnect</button></div>
</div>
<p id="stream-status" role="status" aria-live="polite" class="hint">Connect to view student requests and switch which stream is displayed.</p>
<div class="stream-workspace">
 <div class="stream-main">
  <div class="stream-main-header"><div><strong id="presenter-name">No application window is being shared</strong><span id="presenter-note">Approve a student from the queue. They then select an application window.</span></div>
  <button type="button" class="secondary" id="stream-stop-all" disabled>Put on standby</button></div>
  <div class="stream-video-stage"><video id="primary-stream-video" autoplay playsinline muted></video><p id="stream-empty">Waiting for an approved student to share an application window.</p></div>
 </div>
 <aside class="stream-sidebar" aria-label="Student waiting queue">
  <div class="stream-sidebar-head"><h3>Connected students</h3><span id="stream-count">0</span></div>
  <p class="hint">Switch screens anytime. Standby students keep their window selected, but stop uploading video.</p>
  <div id="stream-list" class="stream-cards">Connect to see the queue.</div>
 </aside>
</div>`;
let room=null,pin='',busy=false,changing=false,activeId=null;
const status=(msg,error=false)=>{$('stream-status').textContent=msg;$('stream-status').style.color=error?'#b74b36':'#087f78'};
function syncSubscriptions(){
 if(!room)return;
 const selected=[];
 // Unsubscribe all standby publications BEFORE subscribing the chosen screen.
 for(const participant of room.remoteParticipants.values()){
  for(const publication of participant.videoTrackPublications.values()){
   if(publication.source!==LivekitClient.Track.Source.ScreenShare)continue;
   if(participant.identity===activeId){selected.push(publication);continue;}
   if(publication.isSubscribed||publication.isDesired)publication.setSubscribed(false);
  }
 }
 for(const publication of selected){
  if(!publication.isSubscribed&&!publication.isDesired)publication.setSubscribed(true);
 }
}
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
  const card=document.createElement('div');card.className='stream-student'+(student.presenting?' presenting':'');
  const name=document.createElement('strong');name.textContent=student.name||'Student';
  const state=document.createElement('small');state.textContent=student.presenting?(student.sharing?'● ON SCREEN':student.hasScreenTrack?'● Selected · Resuming video':'● Selected · Awaiting window'):(student.approved?(student.hasScreenTrack?'◌ STANDBY · Upload paused':'◌ STANDBY · No window yet'):'Waiting for approval');
  const button=document.createElement('button');button.type='button';button.className=student.presenting?'secondary':'primary';
  button.disabled=changing;button.textContent=student.presenting?'Put on standby':student.approved?'Show screen':'Approve & show';
  button.addEventListener('click',()=>switchTo(student.presenting?null:student.identity));
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
  const nextId=result.active||null;
  if(activeId!==nextId)$('primary-stream-video').srcObject=null;
  activeId=nextId;
  syncSubscriptions();
  const approved=items.find(s=>s.identity===activeId);
  $('presenter-name').textContent=approved?(approved.name+' · '+(approved.sharing?'LIVE':'Approved')):'No application window is being shared';
  $('presenter-note').textContent=approved?(approved.sharing?'Live application-window feed':'Waiting for the student to click Share application window'):'Approve a student from the queue to start presenting.';
  $('stream-stop-all').disabled=!activeId;
  renderPeople(items);updateViewer();
  status('● CONNECTED · '+items.length+' student(s) · '+(activeId?'1 stream on screen':'No stream selected')+'. Checks every five seconds.');
 }catch(err){status('Could not update the waiting list: '+err.message,true);}
 finally{busy=false;}
}
async function switchTo(identity){
 if(!room||changing)return;changing=true;$('stream-stop-all').disabled=true;
 status(identity?'Switching displayed student; others pause their video uploads…':'Pausing the displayed student’s video upload…');
 try{
  const response=await fetch('/api/live-control',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({pin,action:identity?'approve':'stop',identity:identity||undefined})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not switch presenters');
  status(identity?'Selected stream resumes automatically if the student is already sharing.':'Stream hidden; student capture stays in standby.');
 }catch(err){status('Presenter switch failed: '+err.message,true);}
 finally{changing=false;await refresh();}
}
$('stream-stop-all').addEventListener('click',()=>switchTo(null));
function onSubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare||track.kind!=='video')return;
 if(p.identity!==activeId){pub.setSubscribed(false);return;}
 updateViewer();
}
function onUnsubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare)return;
 track.detach();if(p.identity===activeId)updateViewer();
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
  room.on(LivekitClient.RoomEvent.TrackPublished,()=>{if(room){syncSubscriptions();refresh();}});
  room.on(LivekitClient.RoomEvent.TrackUnpublished,()=>{if(room)refresh();});
  room.on(LivekitClient.RoomEvent.ParticipantConnected,()=>{syncSubscriptions();refresh();});
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected,()=>refresh());
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{
   activeId=null;room=null;pin='';$('stream-leave').disabled=true;$('stream-connect').disabled=false;
   $('stream-list').replaceChildren();updateViewer();status('Classroom connection closed.');
  });
  await room.connect(data.url,data.token,{autoSubscribe:false});
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
