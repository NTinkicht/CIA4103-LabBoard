// Embed inside Classroom Toolkit without changing the legacy standalone screen-share behavior.
if(new URLSearchParams(location.search).get('embed')==='1')document.documentElement.classList.add('toolkit-embedded');
const $=id=>document.getElementById(id);
let room=null,capture=null,published=null,publication=null,leaving=false,approved=false,connecting=false,onAir=false;
let upstreamSyncing=false,upstreamPending=false;
try{
 const profile=JSON.parse(sessionStorage.getItem('cia4103-share-profile')||'null');
 if(profile){$('name').value=String(profile.name||'').slice(0,60);sessionStorage.removeItem('cia4103-share-profile');}
}catch{}
function status(message,error=false){
 $('status').textContent=message;$('status').style.color=error?'#ac4936':'#087f78';
}
function controls(){
 const connected=Boolean(room&&room.state==='connected');
 $('start').disabled=connected||connecting;
 $('leave').disabled=!connected&& !connecting;
 $('share-window').disabled=!connected||!approved||!onAir||Boolean(capture);
 $('stop').disabled=!capture;
 $('name').disabled=connected||connecting;
}
function stopCapture(){
 const stream=capture;capture=null;publication=null;
 if(stream)stream.getTracks().forEach(t=>t.stop());
 if(published&&room){const track=published;published=null;room.localParticipant.unpublishTrack(track).catch(()=>{});}
 else published=null;
 $('preview').srcObject=null;$('preview').style.display='none';
 controls();
}
async function leave(){
 leaving=true;stopCapture();
 const prev=room;room=null;approved=false;onAir=false;connecting=false;
 try{if(prev)await prev.disconnect();}catch{}
 $('name').disabled=false;leaving=false;controls();
 status('You have left the classroom sharing queue.');
}
function sharingStatus(){
 if(!room)return;
 if(capture){
  if(!onAir){
   status(publication?.isUpstreamPaused?
    '◌ STANDBY · Video upload paused. Your application stays captured locally, ready to resume. You can stop at any time.':
    '◌ STANDBY · Pausing video transmission to LiveKit…');
  }else{
   status(publication?.isUpstreamPaused?
    '● SELECTED · Resuming your application stream…':
    '● ON SCREEN · Only your selected application is transmitted to the lecturer.');
  }
 }else if(approved){
  status(onAir?'✓ Selected by your lecturer. Click Share application window.':
   '✓ Approved, in standby. Wait to be selected to choose an application window.');
 }else{
  status('● Waiting for lecturer approval. You are not sharing yet.');
 }
}
// Pause/resume the upstream publication without stopping the locally captured
// MediaStreamTrack: no new getDisplayMedia() or browser permission prompt.
// Run transitions serially to handle rapid A→B→A selection changes safely.
async function synchronizeUpstream(){
 if(upstreamSyncing){upstreamPending=true;return;}
 upstreamSyncing=true;
 try{
  let transitions=0;
  do{
   if(++transitions>8)throw Error('LiveKit upstream did not settle');
   upstreamPending=false;
   const pub=publication;
   if(!pub||!capture||!room)break;
   const shouldTransmit=approved&&onAir;
   if(shouldTransmit&&pub.isUpstreamPaused){
    await pub.resumeUpstream();
   }else if(!shouldTransmit&&!pub.isUpstreamPaused){
    await pub.pauseUpstream();
   }else{
    break;
   }
   // Recheck state: selection may have changed while awaiting LiveKit.
  }while(publication&&capture&&room);
  sharingStatus();
 }catch(error){
  // Stop may have been initiated intentionally while an async pause was in flight.
  if(!capture||!room)return;
  // On a pause failure, fail closed: stop local capture rather than accidentally
  // continuing to transmit a standby stream.
  console.error('Unable to synchronize student screen upstream',{name:error?.name});
  stopCapture();
  status('Could not safely pause or resume video. Capture stopped; please select the application window again when ready.',true);
 }finally{
  upstreamSyncing=false;
  if(upstreamPending){upstreamPending=false;void synchronizeUpstream();}
 }
}
function permissionCheck(){
 if(!room||leaving)return;
 const allowed=Boolean(room.localParticipant.permissions?.canPublish);
 let metadata={};try{metadata=JSON.parse(room.localParticipant.metadata||'{}');}catch{}
 const currentlyOnAir=allowed&&['active','approved'].includes(metadata.status);
 const changed=allowed!==approved||currentlyOnAir!==onAir;
 approved=allowed;onAir=currentlyOnAir;
 // Switches only change metadata: do NOT stop capture on standby transitions.
 if(!approved&&capture)stopCapture(); // true revocation, not normal standby
 controls();
 if(changed)sharingStatus();
 if(capture&&publication)void synchronizeUpstream();
}
$('start').addEventListener('click',async()=>{
 if(room||connecting)return;
 const name=$('name').value.trim();
 if(!name){status('Enter your name to join the waiting list.',true);$('name').focus();return;}
 if(!window.LivekitClient){status('LiveKit did not load. Check the network and reload.',true);return;}
 connecting=true;controls();status('Joining the classroom waiting list…');
 try{
  const response=await fetch('/api/live-token',{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({role:'student',name})
  });
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not join waiting room.');
  room=new LivekitClient.Room({adaptiveStream:true});
  room.on(LivekitClient.RoomEvent.ParticipantPermissionsChanged,permissionCheck);
  room.on(LivekitClient.RoomEvent.ParticipantMetadataChanged,(_previous,participant)=>{
   if(participant===room?.localParticipant)permissionCheck();
  });
  // Also listen directly on the local participant; metadata drives automatic
  // standby resume, so avoid waiting for the lecturer's periodic refresh.
  room.localParticipant.on(LivekitClient.ParticipantEvent.ParticipantMetadataChanged,permissionCheck);
  room.on(LivekitClient.RoomEvent.Reconnected,permissionCheck);
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{
   if(!leaving){stopCapture();room=null;approved=false;onAir=false;connecting=false;controls();status('Disconnected. Click Request to share to rejoin.',true);}
  });
  await room.connect(data.url,data.token,{autoSubscribe:false});
  connecting=false;approved=false;onAir=false;permissionCheck();
  status('● Connected to the waiting list. Your lecturer will approve the next presenter.');
 }catch(error){
  if(room)await room.disconnect().catch(()=>{});
  room=null;connecting=false;approved=false;onAir=false;controls();
  status('Could not join the sharing queue: '+error.message,true);
 }
});
$('share-window').addEventListener('click',async()=>{
 if(!room||!approved||!onAir||capture){status('Wait until the lecturer selects you before choosing an application window.',true);return;}
 if(!navigator.mediaDevices?.getDisplayMedia){status('This browser or institutional policy does not support window sharing.',true);return;}
 let selected=null;
 try{
  // Screen picker must be called immediately from the student's click.
  // "exclude" is a browser hint; we ALSO inspect the actual chosen track.
  selected=await navigator.mediaDevices.getDisplayMedia({
   video:{displaySurface:'window'},audio:false,
   monitorTypeSurfaces:'exclude',preferCurrentTab:false
  });
  const track=selected.getVideoTracks()[0];
  const surface=track?.getSettings?.().displaySurface;
  if(surface!=='window'){
   selected.getTracks().forEach(t=>t.stop());
   status('Only an application window is allowed. Select “Window” (not Entire Screen or browser tab). If your browser cannot identify window capture, use Chrome or Edge.',true);
   return;
  }
  if(!approved||!onAir||!room||!room.localParticipant.permissions?.canPublish){
   selected.getTracks().forEach(t=>t.stop());status('Your presenter approval has expired. Please wait for approval.',true);return;
  }
  capture=selected;controls();status('Publishing the selected application window…');
  publication=await room.localParticipant.publishTrack(track,{source:LivekitClient.Track.Source.ScreenShare});
  published=track;
  $('preview').srcObject=capture;$('preview').style.display='block';
  track.addEventListener('ended',()=>{
   if(capture){stopCapture();sharingStatus();}
  },{once:true});
  sharingStatus();
 }catch(error){
  if(selected)selected.getTracks().forEach(t=>t.stop());
  capture=null;published=null;publication=null;controls();
  status(error?.name==='NotAllowedError'?'Window selection was cancelled or blocked.':('Could not share this application window: '+error.message),true);
 }
});
$('stop').addEventListener('click',()=>{
 stopCapture();sharingStatus();
});
$('leave').addEventListener('click',leave);
setInterval(()=>{if(room)permissionCheck();},1500);
window.addEventListener('visibilitychange',()=>{if(room)permissionCheck();});
window.addEventListener('focus',()=>{if(room)permissionCheck();});
window.addEventListener('pagehide',()=>{capture?.getTracks().forEach(t=>t.stop());room?.disconnect();});
controls();
async function readiness(){
 try{
  const response=await fetch('/api/live-status',{cache:'no-store'});
  const data=await response.json();
  if(!data.enabled){status('Live sharing is not yet configured. Ask the lecturer to check Netlify LiveKit environment variables.',true);$('start').disabled=true;}
 }catch{status('Unable to check LiveKit readiness. Reload when connected.',true);$('start').disabled=true;}
}
readiness();
