import{LABS}from'/assets/checker.mjs';
const $=x=>document.getElementById(x);
let room=null,sharing=false;
for(const l of LABS)$('part').add(new Option(l.label+' · '+l.title,l.id));
function status(s,error=false){$('status').textContent=s;$('status').style.color=error?'#a94330':'#087f78';}
async function stop(){
 $('start').disabled=true;
 try{if(room){await room.localParticipant.setScreenShareEnabled(false).catch(()=>{});await room.disconnect();}}catch{}
 room=null;sharing=false;
 $('preview').srcObject=null;$('preview').style.display='none';$('start').disabled=false;$('stop').disabled=true;
 status('Sharing stopped. Your screen is no longer being transmitted.');
}
$('stop').addEventListener('click',stop);
$('start').addEventListener('click',async()=>{
 if(sharing)return;
 if(!window.LivekitClient){status('Streaming library did not load. Check your internet connection.',true);return;}
 if(!navigator.mediaDevices?.getDisplayMedia){status('Your browser or school policy does not allow screen sharing.',true);return;}
 $('start').disabled=true;status('Preparing a secure sharing session…');
 try{
  const response=await fetch('/api/live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'student',part:$('part').value,name:$('name').value.trim()})});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Cannot create a session');
  room=new LivekitClient.Room({adaptiveStream:true,dynacast:true});
  room.on(LivekitClient.RoomEvent.Disconnected,()=>{sharing=false;$('stop').disabled=true;$('start').disabled=false;status('Screen share disconnected.');});
  await room.connect(data.url,data.token,{autoSubscribe:false});
  // This user gesture triggers the browser's own window/screen selection prompt.
  await room.localParticipant.setScreenShareEnabled(true);
  sharing=true;$('stop').disabled=false;$('start').disabled=true;
  const pub=[...room.localParticipant.videoTrackPublications.values()].find(p=>p.source===LivekitClient.Track.Source.ScreenShare);
  if(pub?.videoTrack?.mediaStreamTrack){
   $('preview').srcObject=new MediaStream([pub.videoTrack.mediaStreamTrack]);$('preview').style.display='block';
   pub.videoTrack.mediaStreamTrack.addEventListener('ended',()=>stop(),{once:true});
  }
  status('● LIVE · Your screen is visible to the lecturer. Click Stop sharing when finished.');
 }catch(err){
  if(room){await room.disconnect().catch(()=>{});room=null;}
  sharing=false;$('stop').disabled=true;$('start').disabled=false;status(err.message||'Screen sharing could not start.',true);
 }
});
window.addEventListener('pagehide',()=>{room?.disconnect();});
