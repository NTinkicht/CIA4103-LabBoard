// Teacher-only LiveKit viewer. Access to room tokens and participant lists
// requires a long PIN stored in Netlify Functions environment variables.
const $=x=>document.getElementById(x);
const root=$('stream-teacher-root');
root.innerHTML=`<div class="stream-login"><label for="stream-pin">Private lecturer PIN</label><div style="display:flex;gap:12px;flex-wrap:wrap;margin:9px 0"><input id="stream-pin" type="password" autocomplete="off" placeholder="Enter the lecturer PIN" style="flex:1;min-width:180px;padding:12px;border:1px solid #bbcbdc;border-radius:8px"><button type="button" class="secondary" id="stream-connect">Connect to classroom streams</button><button type="button" class="secondary" id="stream-leave" disabled>Disconnect</button></div></div><p class="hint" id="stream-status" role="status" aria-live="polite">Live screens are visible only with your lecturer PIN. No screen recordings are made by this app.</p><div id="stream-list" class="stream-cards"></div><div id="stream-videos"></div>`;
let room=null,pin='',busy=false,lastList=[];
const status=(s,bad=false)=>{$('stream-status').textContent=s;$('stream-status').style.color=bad?'#ac4936':'#087f78';};
function pane(id){
 let panel=document.getElementById('stream-'+CSS.escape(id));
 if(!panel){
  panel=document.createElement('div');panel.id='stream-'+id;panel.style.cssText='margin:15px 0;padding:14px;border:1px solid #d4e1ef;border-radius:12px;background:#f6f9fc';
  const label=document.createElement('strong');label.textContent='Live student screen';
  const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.muted=true;video.controls=false;video.style.cssText='display:block;width:100%;max-height:520px;background:#12243a;border-radius:8px;margin-top:10px';
  panel.append(label,video);$('stream-videos').append(panel);
 }
 return panel;
}
function showTrack(track,pub,participant){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare||track.kind!=='video')return;
 const p=pane(participant.identity);p.firstChild.textContent=(participant.name||'Anonymous student')+' · Sharing screen';
 track.attach(p.querySelector('video'));
}
function removeTrack(track,pub,participant){
 if(pub.source!==LivekitClient.Track.Source.ScreenShare)return;
 track.detach();document.getElementById('stream-'+CSS.escape(participant.identity))?.remove();
}
async function refresh(){
 if(!room||busy)return;busy=true;
 try{
  const r=await fetch('/api/live-participants',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin}),cache:'no-store'});
  const obj=await r.json();if(!r.ok)throw Error(obj.error||'Cannot list screen shares');
  lastList=obj.streams||[];$('stream-list').replaceChildren();
  if(!lastList.length){$('stream-list').textContent='No students are sharing at the moment.';}
  else for(const student of lastList){
   const item=document.createElement('div');item.style.cssText='background:#e8f7f0;padding:12px;border-radius:10px;margin:7px 0';
   item.textContent='● '+(student.name||'Anonymous student')+' · '+student.part;
   $('stream-list').append(item);
  }
  status('● CONNECTED · '+lastList.length+' student screen session(s). Updates every five seconds.');
 }catch(e){status('Could not refresh live list: '+e.message,true);}
 finally{busy=false;}
}
$('stream-connect').addEventListener('click',async()=>{
 if(!window.LivekitClient){status('The LiveKit client did not load. Check your internet connection.',true);return;}
 const attempted=$('stream-pin').value;if(!attempted){status('Enter your private lecturer PIN.',true);return;}
 $('stream-connect').disabled=true;status('Connecting to protected classroom screen streams…');
 try{
  const r=await fetch('/api/live-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:'teacher',pin:attempted})});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to connect');
  pin=attempted;$('stream-pin').value='';
  room=new LivekitClient.Room({adaptiveStream:true,dynacast:false});
  room.on(LivekitClient.RoomEvent.TrackSubscribed,showTrack);
  room.on(LivekitClient.RoomEvent.TrackUnsubscribed,removeTrack);
  room.on(LivekitClient.RoomEvent.ParticipantDisconnected,p=>{document.getElementById('stream-'+CSS.escape(p.identity))?.remove();});
  await room.connect(data.url,data.token,{autoSubscribe:true});
  $('stream-leave').disabled=false;await refresh();
 }catch(e){status(e.message||'Streaming setup failed.',true);$('stream-connect').disabled=false;room?.disconnect().catch(()=>{});room=null;pin='';}
});
$('stream-leave').addEventListener('click',async()=>{
 await room?.disconnect();room=null;pin='';$('stream-list').replaceChildren();$('stream-videos').replaceChildren();
 $('stream-leave').disabled=true;$('stream-connect').disabled=false;status('Lecturer disconnected from live screen sharing.');
});
setInterval(()=>{if(room&&!document.hidden)refresh();},5000);
window.addEventListener('cia4103:streams-tab',()=>{if(room)refresh();});
window.addEventListener('pagehide',()=>room?.disconnect());
