import{LABS}from'/assets/checker.mjs';
const $=x=>document.getElementById(x);
let room=null,sharing=false,capture=null;
for(const l of LABS)$('part').add(new Option(l.label+' · '+l.title,l.id));
function status(s,error=false){$('status').textContent=s;$('status').style.color=error?'#a94330':'#087f78';}
async function stop(){
 $('start').disabled=true;sharing=false;
 // Stop the OS screen-capture indicator immediately, even if network teardown fails.
 const stream=capture;capture=null;stream?.getTracks().forEach(t=>t.stop());
 try{if(room)await room.disconnect();}catch{}
 room=null;sharing=false;
 $('preview').srcObject=null;$('preview').style.display='none';$('start').disabled=false;$('stop').disabled=true;
 status('Sharing stopped. Your screen is no longer transmitted.');
}
$('stop').addEventListener('click',stop);
async function readiness(){
 $('start').disabled=true;
 try{
  const r=await fetch('/api/live-status',{cache:'no-store'});
  const d=await r.json();
  if(!d.enabled){status('Live streaming is not yet configured by your lecturer. Screenshots and code sharing remain available.',true);return;}
  $('start').disabled=false;status('Screen sharing is available. Click Share when ready.');
 }catch{status('Could not check screen-sharing readiness. Retry when connected.',true);}
}
$('start').addEventListener('click',async()=>{
 if(sharing)return;
 if(!window.LivekitClient){status('Streaming library did not load. Check your internet connection.',true);return;}
 if(!navigator.mediaDevices?.getDisplayMedia){status('Your browser or school policy does not allow screen sharing.',true);return;}
 // Crucially, invoke getDisplayMedia immediately from the click (transient user activation).
 // Do not await network token creation or LiveKit room connection before the picker.
 let selected;
 try{selected=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});}
 catch(e){status('Screen selection was cancelled or blocked: '+e.message,true);return;}
 capture=selected;
 $('start').disabled=true;status('Connecting securely to the lecturer…');
 try{
  const response=await fetch('/api/live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'student',part:$('part').value,name:$('name').value.trim()})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Could not create session');
  room=new LivekitClient.Room({adaptiveStream:true});
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{if(sharing)stop();});
  await room.connect(data.url,data.token,{autoSubscribe:false});
  const track=selected.getVideoTracks()[0];if(!track||track.readyState==='ended')throw Error('Screen capture ended before it could be published.');
  await room.localParticipant.publishTrack(track,{source:LivekitClient.Track.Source.ScreenShare});
  sharing=true;$('stop').disabled=false;
  $('preview').srcObject=selected;$('preview').style.display='block';
  track.addEventListener('ended',()=>{if(sharing)stop();},{once:true});
  status('● LIVE · Only the lecturer can subscribe. Click Stop sharing when finished.');
 }catch(err){
  selected.getTracks().forEach(t=>t.stop());capture=null;
  if(room){await room.disconnect().catch(()=>{});room=null;}
  sharing=false;$('stop').disabled=true;$('start').disabled=false;status(err.message||'Unable to share this screen.',true);
 }
});
window.addEventListener('pagehide',()=>{capture?.getTracks().forEach(t=>t.stop());room?.disconnect();});
readiness();
