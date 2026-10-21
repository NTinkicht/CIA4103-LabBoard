const $=id=>document.getElementById(id);
let room=null,capture=null,published=null,leaving=false,approved=false,connecting=false,onAir=false;
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
 $('share-window').disabled=!connected||!approved||Boolean(capture);
 $('stop').disabled=!capture;
 $('name').disabled=connected||connecting;
}
function stopCapture(){
 const stream=capture;capture=null;
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
  status(onAir?'● ON SCREEN · The lecturer is showing your application window.':
   '◌ STANDBY · Your window capture continues, but it is not displayed. You can stop sharing at any time.');
 }else if(approved){
  status(onAir?'✓ Selected by the lecturer. Click Share application window.':
   '✓ You are approved and in standby. Select your application window when ready.');
 }else{
  status('● Waiting for lecturer approval. You are not sharing yet.');
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
  room.on(LivekitClient.RoomEvent.Reconnected,permissionCheck);
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{
   if(!leaving){stopCapture();room=null;approved=false;connecting=false;controls();status('Disconnected. Click Request to share to rejoin.',true);}
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
 if(!room||!approved||capture){status('Wait for lecturer approval before choosing an application window.',true);return;}
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
  if(!approved||!room||!room.localParticipant.permissions?.canPublish){
   selected.getTracks().forEach(t=>t.stop());status('Your presenter approval has expired. Please wait for approval.',true);return;
  }
  capture=selected;controls();status('Publishing the selected application window…');
  await room.localParticipant.publishTrack(track,{source:LivekitClient.Track.Source.ScreenShare});
  published=track;
  $('preview').srcObject=capture;$('preview').style.display='block';
  track.addEventListener('ended',()=>{
   if(capture){stopCapture();sharingStatus();}
  },{once:true});
  sharingStatus();
 }catch(error){
  if(selected)selected.getTracks().forEach(t=>t.stop());
  capture=null;published=null;controls();
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
