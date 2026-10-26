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
  <div class="stream-header-actions"><button type="button" class="secondary" id="stream-toggle-queue" aria-pressed="false">Hide students</button><button type="button" class="secondary" id="stream-stop-all" disabled>Put on standby</button></div></div>
  <div class="stream-video-stage"><video id="primary-stream-video" autoplay playsinline muted></video><p id="stream-empty">Waiting for an approved student to share an application window.</p></div>
 </div>
 <aside class="stream-sidebar" aria-label="Student waiting queue">
  <div class="stream-sidebar-head"><h3>Connected students</h3><span id="stream-count">0</span></div>
  <p class="hint">Use ▶ to approve or resume a screen; ⏸ to put the current screen on standby.</p>
  <label for="stream-filter" class="stream-filter-label">Find student
    <input id="stream-filter" type="search" placeholder="Search names…" autocomplete="off">
  </label>
  <div id="stream-list" class="stream-cards">Connect to see the queue.</div>
 </aside>
</div>`;
let room=null,pin='',toolkitToken=null,busy=false,changing=false,activeId=null,lastStudents=[];
const embedded=window.parent!==window&&location.pathname.startsWith('/toolkit/screen-sharing/');
if(embedded)document.documentElement.classList.add('toolkit-screen-embedded');
const credentials=()=>toolkitToken?{toolkitToken}:{pin};
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
 lastStudents=items;
 const panel=$('stream-list'),scroll=panel.scrollTop;
 panel.replaceChildren();
 $('stream-count').textContent=String(items.length);
 const term=$('stream-filter').value.trim().toLocaleLowerCase();
 const visible=items.filter(p=>(p.name||'Student').toLocaleLowerCase().includes(term));
 if(!visible.length){
  const empty=document.createElement('p');empty.className='stream-empty-queue';
  empty.textContent=items.length?'No matching students.':'No student requests yet.';panel.append(empty);
 }
 for(const student of visible){
  const showing=Boolean(student.presenting);
  const card=document.createElement('div');card.className='stream-student'+(showing?' presenting':student.approved?' standby':'');
  card.setAttribute('role','listitem');
  const dot=document.createElement('span');dot.className='stream-status-dot '+(showing?'on-screen':student.approved?'standby':'waiting');dot.setAttribute('aria-hidden','true');
  const info=document.createElement('div');info.className='stream-student-info';
  const name=document.createElement('strong');name.textContent=student.name||'Student';
  const label=document.createElement('small');
  label.textContent=showing?(student.sharing?'On screen':student.hasScreenTrack?'Resuming…':'Waiting for window'):
   student.approved?(student.hasScreenTrack?'Standby · Upload paused':'Approved · No window'):'Waiting for approval';
  info.append(name,label);
  const button=document.createElement('button');button.type='button';
  button.className='stream-icon-action '+(showing?'pause':'play');
  button.disabled=changing;
  const action=showing?'Put '+(student.name||'Student')+' on standby':
    student.approved?'Resume '+(student.name||'Student')+' without another screen selection':
    'Approve and show '+(student.name||'Student');
  button.title=action;button.setAttribute('aria-label',action);
  button.innerHTML=showing
   ?'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><rect x="7" y="5" width="3.5" height="14" rx="1.15"/><rect x="13.5" y="5" width="3.5" height="14" rx="1.15"/></svg>'
   :'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 5.3a.65.65 0 0 1 .99-.56l10.07 6.7a.68.68 0 0 1 0 1.12L8.99 19.26A.65.65 0 0 1 8 18.7V5.3Z"/></svg>';
  button.addEventListener('click',()=>switchTo(showing?null:student.identity));
  card.append(dot,info,button);panel.append(card);
 }
 panel.scrollTop=scroll;
}
$('stream-filter').addEventListener('input',()=>renderPeople(lastStudents));
async function refresh(){
 if(!room||busy||changing)return;busy=true;
 try{
  const response=await fetch('/api/live-participants',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(credentials()),cache:'no-store'
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
   body:JSON.stringify({...credentials(),action:identity?'approve':'stop',identity:identity||undefined})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not switch presenters');
  status(identity?'Selected stream resumes automatically if the student is already sharing.':'Stream hidden; student capture stays in standby.');
 }catch(err){status('Presenter switch failed: '+err.message,true);}
 finally{changing=false;await refresh();}
}
$('stream-stop-all').addEventListener('click',()=>switchTo(null));
$('stream-toggle-queue').addEventListener('click',()=>{
 const collapsed=root.classList.toggle('queue-collapsed');
 $('stream-toggle-queue').textContent=collapsed?'Show students':'Hide students';
 $('stream-toggle-queue').setAttribute('aria-pressed',String(collapsed));
});
function onSubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare||track.kind!=='video')return;
 if(p.identity!==activeId){pub.setSubscribed(false);return;}
 updateViewer();
}
function onUnsubscribed(track,pub,p){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare)return;
 track.detach();if(p.identity===activeId)updateViewer();
}
async function connectLecturer(auth){
 if(room)return;
 if(!window.LivekitClient){status('LiveKit library is unavailable. Check your network.',true);return;}
 if(!auth?.toolkitToken&&!auth?.pin){status('Enter your private lecturer PIN.',true);return;}
 $('stream-connect').disabled=true;status('Connecting to the classroom…');
 try{
  const response=await fetch('/api/live-token',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({role:'teacher',...auth})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to authorize lecturer');
  pin=auth.pin||'';toolkitToken=auth.toolkitToken||null;room=new LivekitClient.Room({adaptiveStream:true});
  room.on(LivekitClient.RoomEvent.TrackSubscribed,onSubscribed);
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed,onUnsubscribed);
  room.on(LivekitClient.RoomEvent.TrackPublished,()=>{if(room){syncSubscriptions();refresh();}});
  room.on(LivekitClient.RoomEvent.TrackUnpublished,()=>{if(room)refresh();});
  room.on(LivekitClient.RoomEvent.ParticipantConnected,()=>{syncSubscriptions();refresh();});
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected,()=>refresh());
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{
   activeId=null;room=null;pin='';toolkitToken=null;$('stream-leave').disabled=true;$('stream-connect').disabled=false;
   $('stream-list').replaceChildren();updateViewer();status('Classroom connection closed.');
  });
  await room.connect(data.url,data.token,{autoSubscribe:false});
  $('stream-pin').value='';$('stream-leave').disabled=false;await refresh();
 }catch(err){
  status('Could not connect: '+err.message,true);
  if(room)await room.disconnect().catch(()=>{});
  room=null;pin='';toolkitToken=null;$('stream-connect').disabled=false;
 }
}

$('stream-connect').addEventListener('click',()=>connectLecturer({pin:$('stream-pin').value}));
if(embedded){
  // The parent Toolkit is already authenticated. Never transmit its teacher token
  // through the iframe URL, a query string, the DOM or a third-party host.
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.parent)return;
    if(event.data?.type!=='toolkit:lecturer-session')return;
    if(typeof event.data.token!=='string'||event.data.token.length>2200)return;
    if(room||$('stream-connect').disabled)return;
    void connectLecturer({toolkitToken:event.data.token});
  });
  window.parent.postMessage({type:'toolkit:screen-ready'},location.origin);
}

$('stream-leave').addEventListener('click',async()=>{
 if(room)await room.disconnect();room=null;pin='';toolkitToken=null;activeId=null;
 $('stream-connect').disabled=false;$('stream-leave').disabled=true;$('stream-list').replaceChildren();updateViewer();
 status('Disconnected from the classroom.');
});
setInterval(()=>{if(room&&!document.hidden)refresh();},5000);
window.addEventListener('focus',()=>{if(room)refresh();});
window.addEventListener('cia4103:streams-tab',()=>{if(room){refresh();updateViewer();}});
window.addEventListener('pagehide',()=>room?.disconnect());
