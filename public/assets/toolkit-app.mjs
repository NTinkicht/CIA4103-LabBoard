const API='/.netlify/functions/toolkit';
const app=document.getElementById('app'),roomChip=document.getElementById('top-room'),conn=document.getElementById('connection');
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAMES={poll:'Live Poll',answers:'Live Answers',cloud:'Word Cloud',timer:'Timer',screen:'Screen Sharing'};
const ICONS={poll:'▥',answers:'▤',cloud:'☁',timer:'◷',screen:'▣'};
const state={role:null,token:null,displayToken:null,room:null,tool:'poll',snapshot:null,lastStudentKey:null,pollTimer:null,busy:false,epoch:0,clockOffset:0,errors:0,savedPolls:[],editingPollId:null,editingRevision:0};
let toastTimer=null;
function connected(healthy,label){
  conn.className='connection '+(healthy===true?'good':healthy===false?'bad':'');
  conn.textContent=label||(healthy===true?'Connected':healthy===false?'Connection issue':'Not connected');
}
function announce(text,error=false){
 const box=$('notice');
 if(box){box.textContent=text;box.className='notice show '+(error?'error':'good')}
 $('announcement').textContent=text;
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>{const b=$('notice');if(b&&!error)b.classList.remove('show')},5500);
}
function setRoom(code){roomChip.textContent=code?'ROOM  '+code:'Live classroom'}
const loading=(txt='Connecting…')=>'<div class="empty"><span class="empty-icon">◉</span><strong>'+esc(txt)+'</strong></div>';
const noResults=(txt='Waiting for responses…')=>'<div class="empty"><span class="empty-icon">◇</span><strong>Nothing here yet</strong><p>'+esc(txt)+'</p></div>';
function notices(){return '<div id="notice" class="notice" role="status" aria-live="polite"></div>'}
function btn(text,cls='primary',id='',extra=''){return '<button class="'+cls+'" '+(id?'id="'+id+'"':'')+' '+extra+'>'+text+'</button>'}
function welcome(){
 stopPolling();state.role=null;state.token=null;state.room=null;state.displayToken=null;state.snapshot=null;state.lastStudentKey=null;state.errors=0;state.savedPolls=[];state.editingPollId=null;state.editingRevision=0;setRoom(null);connected(null);
 app.className='container';
 app.innerHTML='<div class="join-shell"><section class="join-card"><p class="eyebrow">Welcome to your teaching companion</p><h1>Make every voice part of the room.</h1><p style="max-width:515px;margin-top:15px">Live polls, open answers, word clouds and screen sharing. No course setup. No new link for every question.</p><div class="entry-grid"><div class="entry-card"><span class="entry-icon">↗</span><h3>Join as student</h3><p>Enter your room code once, then respond to activities on any device.</p>'+btn('Join classroom →','primary','open-student')+'</div><div class="entry-card"><span class="entry-icon">▦</span><h3>Start as lecturer</h3><p>Create a classroom and choose your teaching tools as you go.</p>'+btn('Start classroom →','secondary','open-teacher')+'</div></div>'+notices()+'</section></div>';
 $('open-student').onclick=joinForm;$('open-teacher').onclick=teacherForm;
}
function joinForm(){
 app.innerHTML='<div class="join-shell"><section class="join-card narrow"><p class="eyebrow">Student entrance</p><h1>Join your classroom</h1><p>Use the code shown by your lecturer. No course registration required.</p><form id="join-form"><label for="room-code">Classroom code</label><input id="room-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" required value="'+esc(new URLSearchParams(location.search).get('code')||'')+'"><label for="join-name">Your name or nickname</label><input id="join-name" placeholder="e.g. Student 07" maxlength="60" autocomplete="nickname" required><label for="pair">Pair name <span class="small">(optional)</span></label><input id="pair" placeholder="e.g. Pair 03" maxlength="32"><p class="small">If your lecturer requests one response per pair, both partners should use exactly the same pair name.</p><div class="buttons">'+btn('Join classroom →','primary','join-submit','type="submit"')+btn('Back','ghost','back','type="button"')+'</div></form>'+notices()+'</section></div>';
 $('back').onclick=welcome;
 $('join-form').onsubmit=async e=>{e.preventDefault();const button=$('join-submit');button.disabled=true;
  try{const data=await request('join',{code:$('room-code').value.trim(),name:$('join-name').value.trim(),team:$('pair').value.trim()});
   state.role='student';state.room=data.code;state.token=data.token;state.lastStudentKey=null;sessionStorage.setItem('classroom-student',JSON.stringify(data));
   shell();await refresh();}catch(err){announce(err.message,true);button.disabled=false}
 };
}
function teacherForm(){
 app.innerHTML='<div class="join-shell"><section class="join-card narrow"><p class="eyebrow">Lecturer entrance</p><h1>Start a live classroom</h1><p>Use your existing lecturer PIN. Create a room without choosing a course or preparing an activity.</p><form id="teacher-form"><label for="teacher-pin">Private lecturer PIN</label><input id="teacher-pin" type="password" autocomplete="off" placeholder="Lecturer PIN" required><div class="buttons">'+btn('Create classroom →','primary','create-submit','type="submit"')+btn('Back','ghost','back','type="button"')+'</div></form>'+notices()+'</section></div>';
 $('back').onclick=welcome;
 $('teacher-form').onsubmit=async e=>{e.preventDefault();const button=$('create-submit');button.disabled=true;
  try{const data=await request('create',{pin:$('teacher-pin').value});
   state.role='teacher';state.room=data.code;state.token=data.teacherToken;state.displayToken=data.displayToken;sessionStorage.setItem('classroom-teacher',JSON.stringify(data));
   shell();await refresh();}catch(err){announce(err.message,true);button.disabled=false}
 };
}
async function request(action,params={}){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),11000);
 try{
  const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...params}),cache:'no-store',signal:controller.signal});
  let data;
  try{data=await response.json()}catch{throw Error('Server response was invalid. Check the Netlify preview configuration.')}
  if(!response.ok)throw Error(data.error||'Request failed');
  return data;
 }catch(e){
  if(e.name==='AbortError')throw Error('The connection timed out. Please retry.');
  throw e;
 }finally{clearTimeout(timeout)}
}
function shell(){
 stopPolling();setRoom(state.room);connected(null,'Connecting');
 app.className=state.role==='display'?'container display-shell':'container';
 if(state.role==='teacher')teacherShell();
 if(state.role==='student')studentShell();
 if(state.role==='display')displayShell();
 startPolling();
}
function teacherShell(){
 const tabs=[['poll','▥','Live Poll'],['answers','▤','Live Answers'],['cloud','☁','Word Cloud'],['timer','◷','Timer'],['screen','▣','Screen Sharing']];
 app.innerHTML='<div class="workspace"><aside class="rail"><p class="rail-title">Interactive tools</p><nav aria-label="Teaching tools" id="tool-nav">'+tabs.map(([id,icon,text])=>'<button class="tool-link" type="button" data-tool="'+id+'"><span class="tool-icon" aria-hidden="true">'+icon+'</span>'+text+'</button>').join('')+'</nav><div class="rail-divider"></div><div class="rail-code"><p class="eyebrow">Classroom code</p><strong>'+esc(state.room)+'</strong><p class="small">One link for every tool</p></div><div class="rail-actions">'+btn('↗ Copy student link','secondary','copy-link')+btn('▣ Copy projector link','secondary','copy-projector')+btn('End room','danger','end-room')+'</div></aside><div class="mainstack"><section class="surface"><div class="headrow"><div><p class="eyebrow">Teaching workspace</p><h1 id="tool-title">Live Poll</h1><p id="tool-description"></p></div><span class="pill blue">All courses</span></div><div id="tool-config"></div></section><section class="surface"><div class="results-head"><div><p class="eyebrow">Live classroom</p><h2 id="current-label">Responses</h2></div><div class="metric-pair"><div><div class="metric" id="participants-count">—</div><div class="metric-label">Students joined</div></div><span class="pill grey" id="round-status">No activity</span></div></div><div id="live-results" class="live-area">'+noResults('Start an activity to see live results.')+'</div><div id="round-actions" class="buttons"></div></section>'+notices()+'</div></div>';
 document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;configTool()});
 $('copy-link').onclick=()=>copyLink(location.origin+'/toolkit/?code='+encodeURIComponent(state.room));
 $('copy-projector').onclick=()=>copyLink(location.origin+'/toolkit/?view=display&token='+encodeURIComponent(state.displayToken));
 $('end-room').onclick=async()=>{
  if(!confirm('End this classroom for everyone?'))return;
  try{await request('control',{token:state.token,control:'end'});sessionStorage.removeItem('classroom-teacher');welcome();}catch(e){announce(e.message,true)}
 };
 configTool();
 void loadSavedPolls();
}
function configTool(){
 document.querySelectorAll('[data-tool]').forEach(b=>{const on=b.dataset.tool===state.tool;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
 $('tool-title').textContent=NAMES[state.tool];
 const description={poll:'Instant voting with a beautiful real-time results chart.',answers:'Collect short written answers without leaving your presentation.',cloud:'Turn classroom keywords into a live, frequency-weighted word cloud.',timer:'A focused countdown that stays in sync across devices.',screen:'Let a student show their work, with your existing approval and standby controls.'};
 $('tool-description').textContent=description[state.tool];
 if(state.tool==='screen'){
 $('tool-config').innerHTML='<div class="tool-feature"><div><strong>Your existing screen sharing is preserved</strong><p>Opening the original dashboard does not disconnect this toolkit room. Multi-room screen sharing is under development and is not yet synchronized with the toolkit roster.</p></div><span style="font-size:35px" aria-hidden="true">▣</span></div><div class="buttons"><a href="/dashboard/" target="_blank" rel="noopener" class="tool-link active">Open lecturer screen sharing ↗</a><a href="/live/" target="_blank" rel="noopener" class="tool-link">Student share page ↗</a></div>';return;
 }
 const common='<label for="response-unit">Response mode</label><select id="response-unit"><option value="individual">Individual response</option><option value="pair">One answer per pair</option></select>';
 const prompt='<label for="question">Your question <span class="small">(optional — ask it verbally or show on your slides)</span></label><input id="question" maxlength="240" placeholder="No need to type a question">';
 let controls='';
 if(state.tool==='poll'){
 controls='<label for="poll-title">Saved poll title <span class="small">(for your preparation library)</span></label><input id="poll-title" maxlength="100" placeholder="e.g. Week 8 — Process vs Cycle Time">'+prompt+'<div class="subhead" style="margin-top:22px"><h3>Voting choices</h3><span class="pill grey">2–8 options</span></div><div class="option-grid" id="poll-options"></div><div class="buttons">'+btn('+ Add option','secondary','add-option')+btn('− Remove last','ghost','remove-option')+'</div>'+common;
 }else if(state.tool==='answers'||state.tool==='cloud')controls=prompt+common;
 else controls='<label for="duration">Countdown</label><select id="duration"><option value="60">1 minute</option><option value="120">2 minutes</option><option selected value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option></select>';
 $('tool-config').innerHTML=controls+'<div class="buttons">'+btn('▶ Start '+NAMES[state.tool],'primary','launch')+(state.tool==='poll'?btn('▤ Save for later','secondary','save-poll'):'')+'</div>'+(state.tool==='poll'?'<section class="poll-library"><div class="subhead"><h3>My saved polls</h3><span class="pill grey" id="poll-library-count">0 saved</span></div><p class="small">Create questions now. Your library is stored on the site and will be available in future classroom sessions.</p><div id="poll-library-list"></div></section>':'');
 if(state.tool==='poll'){
   state.editingPollId=null;state.editingRevision=0;
   for(let i=0;i<4;i++)addOption();
   $('add-option').onclick=addOption;
   $('remove-option').onclick=()=>{const els=[...document.querySelectorAll('.poll-option')];if(els.length>2)els.at(-1).parentElement.remove()};
 }
 $('launch').onclick=startRound;
 if(state.tool==='poll'){
  $('save-poll').onclick=savePoll;
  renderSavedPolls();
 }
}
function addOption(){
 const parent=$('poll-options');if(!parent)return;
 const n=parent.querySelectorAll('.poll-option').length;if(n>=8)return;
 const div=document.createElement('div');div.innerHTML='<label for="option-'+n+'">Option '+(n+1)+'</label><input class="poll-option" id="option-'+n+'" maxlength="60" value="Option '+(n+1)+'">';
 parent.append(div);
}

function pollFields(){
 const options=[...document.querySelectorAll('.poll-option')].map(e=>e.value.trim()).filter(Boolean);
 return {title:$('poll-title')?.value.trim()||'',prompt:$('question')?.value.trim()||'',unit:$('response-unit')?.value||'individual',options};
}
async function loadSavedPolls(){
 if(state.role!=='teacher'||!state.token)return;
 try{
  const result=await request('library',{token:state.token,operation:'list'});
  state.savedPolls=result.polls||[];
  renderSavedPolls();
 }catch(error){if(state.tool==='poll')announce('Saved polls could not be loaded: '+error.message,true)}
}
function renderSavedPolls(){
 const box=$('poll-library-list');
 if(!box)return;
 $('poll-library-count').textContent=state.savedPolls.length+' saved';
 if(!state.savedPolls.length){box.innerHTML=noResults('Save your first poll above. It will be available in a new classroom session.');return;}
 box.innerHTML=state.savedPolls.map(p=>'<div class="saved-poll-row"><div class="saved-poll-info"><strong>'+esc(p.title)+'</strong><span>'+esc(p.prompt||'Question shown on your slides')+' · '+p.options.length+' choices</span></div><div class="buttons"><button type="button" class="secondary" data-use-poll="'+p.id+'">Load</button><button type="button" class="ghost" data-delete-poll="'+p.id+'">Delete</button></div></div>').join('');
 box.querySelectorAll('[data-use-poll]').forEach(b=>b.onclick=()=>useSavedPoll(b.dataset.usePoll));
 box.querySelectorAll('[data-delete-poll]').forEach(b=>b.onclick=()=>deleteSavedPoll(b.dataset.deletePoll));
}
function useSavedPoll(id){
 const p=state.savedPolls.find(p=>p.id===id);
 if(!p)return announce('Saved poll not found. Reload the library.',true);
 state.tool='poll';configTool();
 $('poll-title').value=p.title;$('question').value=p.prompt;$('response-unit').value=p.unit;
 $('poll-options').innerHTML='';
 for(let i=0;i<p.options.length;i++){addOption();const field=$('option-'+i);if(field)field.value=p.options[i]}
 state.editingPollId=p.id;state.editingRevision=p.revision;
 $('save-poll').textContent='▤ Update saved poll';
 announce('Loaded "'+p.title+'". You can edit it, save updates, or launch it during the lesson.');
}
async function savePoll(){
 const poll=pollFields();
 if(!poll.title)return announce('Give this poll a title before saving.',true);
 if(poll.options.length<2||poll.options.length>8)return announce('Enter 2 to 8 voting choices.',true);
 const b=$('save-poll');b.disabled=true;
 try{
  const result=await request('library',{token:state.token,operation:'save',poll,id:state.editingPollId,revision:state.editingRevision});
  state.editingPollId=result.poll.id;state.editingRevision=result.poll.revision;
  b.textContent='▤ Update saved poll';
  announce('Poll saved to your library. It will be available in future sessions.');
  await loadSavedPolls();
 }catch(e){announce(e.message,true)}finally{if($('save-poll'))$('save-poll').disabled=false}
}
async function deleteSavedPoll(id){
 const p=state.savedPolls.find(p=>p.id===id);
 if(!p||!confirm('Delete saved poll "'+p.title+'"?'))return;
 try{
  await request('library',{token:state.token,operation:'delete',id});
  if(state.editingPollId===id){state.editingPollId=null;state.editingRevision=0;$('save-poll').textContent='▤ Save for later';}
  await loadSavedPolls();
  announce('Saved poll deleted.');
 }catch(e){announce(e.message,true)}
}

async function startRound(){
 const button=$('launch');button.disabled=true;const type=state.tool;
 const payload={token:state.token,type,prompt:$('question')?.value||'',unit:$('response-unit')?.value||'individual'};
 if(type==='poll')payload.options=[...document.querySelectorAll('.poll-option')].map(e=>e.value.trim()).filter(Boolean);
 if(type==='timer')payload.duration=Number($('duration').value);
 try{await request('start',payload);announce('New activity is live. Students can respond now.');await refresh();}catch(e){announce(e.message,true)}finally{if($('launch'))$('launch').disabled=false}
}
async function copyLink(s){
 try{await navigator.clipboard.writeText(s);announce('Link copied — ready to share.');}catch{announce('Copy unavailable in this browser. You can copy the URL from your address bar.',true)}
}
function resultsHtml(snapshot,projector=false){
 const r=snapshot.active;if(!r)return noResults('Start a poll, open question, word cloud or timer.');
 if(r.type==='timer')return timerHtml(r.endsAt);
 if(projector&&!r.revealed)return '<div class="empty"><span class="empty-icon">◉</span><strong>Results are hidden</strong><p>Your lecturer will reveal the results when ready.</p></div>';
 if(r.type==='poll'){
   const votes=snapshot.results?.votes||r.options.map(()=>0),total=votes.reduce((a,b)=>a+b,0);
   return '<p class="eyebrow">Votes received · '+total+'</p>'+r.options.map((option,i)=>{
    const pct=total?Math.round(100*votes[i]/total):0;
    return '<div class="bar-group"><div class="bar-label"><span>'+esc(option)+'</span><span>'+votes[i]+' vote'+(votes[i]===1?'':'s')+' · '+pct+'%</span></div><div class="bar-track"><div class="bar-fill" style="width:'+pct+'%"></div></div></div>';
   }).join('');
 }
 if(r.type==='cloud'){
  const words=snapshot.results?.words||[];
  if(!words.length)return noResults('Words will appear here as soon as students respond.');
  const palette=['#1667ae','#0e927d','#7056a4','#c07842','#34516c'];
  return '<p class="eyebrow">'+(snapshot.results?.total||0)+' responses</p><div class="cloud">'+words.map(w=>{
   const size=Math.min(63,18+Math.sqrt(w.count)*13),hash=[...w.word].reduce((a,ch)=>a+ch.codePointAt(0),0);
   return '<span class="cloud-word" style="font-size:'+size+'px;color:'+palette[hash%palette.length]+'" title="'+w.count+' response(s)">'+esc(w.word)+'</span>';
  }).join('')+'</div>'+(!projector&&snapshot.answers?.length?'<div style="border-top:1px solid #e4edf4;margin-top:15px;padding-top:17px"><p class="eyebrow">Review incoming words</p>'+snapshot.answers.map(a=>'<div class="answer-card"><div class="answer-meta" style="margin:0"><span><strong>'+esc(a.value)+'</strong> · '+esc(a.name||'Student')+'</span><button class="secondary" data-answer="'+esc(a.subject)+'" data-hidden="'+a.hidden+'">'+(a.hidden?'Restore word':'Hide word')+'</button></div></div>').join('')+'</div>':'');
 }
 const answers=snapshot.answers||[];
 if(!answers.length)return noResults('Short answers will appear here in a live list.');
 return '<p class="eyebrow">'+answers.length+' answers received</p>'+answers.map(a=>
  '<article class="answer-card '+(a.hidden?'inactive':'')+'"><div class="answer-text">'+esc(a.value)+'</div>'+(!projector?'<div class="answer-meta"><span>'+esc(a.name||'Student')+' · '+(a.hidden?'Projector hidden':'Approved for projector')+'</span><button class="secondary" type="button" data-answer="'+esc(a.subject)+'" data-hidden="'+a.hidden+'">'+(a.hidden?'Show on projector':'Hide from projector')+'</button></div>':'')+'</article>'
 ).join('');
}
function timerHtml(until){return '<div class="timer-hero"><p class="eyebrow">Countdown</p><strong data-end-time="'+Number(until)+'">--:--</strong></div>'}
async function controlRound(command){
 try{await request('control',{token:state.token,control:command,roundId:state.snapshot?.active?.id});await refresh();}
 catch(e){announce(e.message,true)}
}
function renderTeacher(snapshot){
 $('participants-count').textContent=String(snapshot.participants??0);
 const round=snapshot.active;
 $('current-label').textContent=round?NAMES[round.type]:'Waiting to begin';
 $('round-status').textContent=round?(round.status==='closed'?'Closed':'Receiving'):'No activity';
 $('round-status').className='pill '+(round?.status==='open'?'':'grey');
 $('live-results').innerHTML=resultsHtml(snapshot);
 $('round-actions').innerHTML=round?
   btn(round.revealed?'◉ Hide projected results':'◉ Reveal projected results','secondary','toggle-reveal')+
   btn('■ Close responses','ghost','close-responses',round.status==='closed'?'disabled':''):'';
 if(round){
 $('toggle-reveal').onclick=()=>controlRound(round.revealed?'hide':'reveal');
 $('close-responses').onclick=()=>controlRound('close');
 }
 document.querySelectorAll('[data-answer]').forEach(el=>el.onclick=async()=>{
   el.disabled=true;
   try{await request('moderate',{token:state.token,roundId:round.id,subject:el.dataset.answer,hidden:el.dataset.hidden!=='true'});await refresh();}
   catch(e){announce(e.message,true);el.disabled=false}
 });
 syncClock();
}
function studentShell(){
 app.innerHTML='<section class="surface student-main"><div class="headrow"><div><p class="eyebrow">Connected to the classroom</p><h1>Room '+esc(state.room)+'</h1><p>When your lecturer opens a tool, your activity will appear here automatically.</p></div><span class="pill">● Joined</span></div><div id="student-work" class="student-activity">'+loading('Waiting for a question…')+'</div>'+notices()+'<div class="student-note">Need to show your work? <a href="/live/" target="_blank" rel="noopener">Request to share your application window ↗</a> — a separate legacy screen-sharing queue for now.</div></section>';
}
function renderStudent(snapshot){
 const r=snapshot.active,area=$('student-work');
 if(!r){state.lastStudentKey=null;area.innerHTML=noResults('Your lecturer will launch an activity. Stay on this page.');return}
 const key=r.id+':'+r.status;
 if(key!==state.lastStudentKey){
  state.lastStudentKey=key;
  let content='<p class="eyebrow">'+esc(r.type==='poll'?'Make your choice':r.type==='answers'?'Share your thoughts':r.type==='cloud'?'One word, one idea':'Time to focus')+'</p><h2>'+esc(NAMES[r.type])+'</h2>';
  if(r.prompt)content+='<p style="font-size:17px;margin:15px 0 23px">'+esc(r.prompt)+'</p>';
  if(r.type==='timer')content+=timerHtml(r.endsAt);
  else if(r.status==='closed')content+='<div class="notice show good">This activity is closed. Your responses are saved.</div>';
  else{
   if(r.type==='poll')content+=r.options.map((o,i)=>'<label class="choice"><input type="radio" name="student-vote" value="'+i+'"><span>'+esc(o)+'</span></label>').join('');
   else content+='<label for="student-answer">'+(r.type==='cloud'?'Enter one word or short phrase':'Write a short answer')+'</label><textarea id="student-answer" maxlength="'+(r.type==='cloud'?40:500)+'" placeholder="'+(r.type==='cloud'?'Your word…':'Your answer…')+'"></textarea>';
   content+='<div class="buttons student-submit">'+btn('Submit '+(r.unit==='pair'?'pair answer':'answer')+' →','primary','submit-answer')+'</div>';
   if(r.unit==='pair')content+='<p class="small">Pair mode: the response is shared between members of your named pair.</p>';
  }
  content+='<div id="submitted-status"></div>';
  area.innerHTML=content;
  if(r.status==='open'&&r.type!=='timer')$('submit-answer').onclick=submitAnswer;
 }
 if(snapshot.mine){
  if(r.type==='poll'){
    const radio=area.querySelector('input[name="student-vote"][value="'+snapshot.mine.value+'"]');
    if(radio&&!area.querySelector('input[name="student-vote"]:checked'))radio.checked=true;
  }else if($('student-answer')&&!$('student-answer').dataset.dirty){
   $('student-answer').value=snapshot.mine.value;
  }
  const dest=$('submitted-status');
  if(dest)dest.innerHTML='<div class="notice show good">✓ Submitted successfully · Revision '+snapshot.mine.revision+'. '+(r.status==='open'?'You can update your answer.':'')+'</div>';
 }
 if($('student-answer')&&!$('student-answer').oninput)$('student-answer').oninput=()=>{$('student-answer').dataset.dirty='1'};
 syncClock();
}
async function submitAnswer(){
 const r=state.snapshot?.active;
 if(!r)return announce('No active activity.',true);
 const chosen=document.querySelector('input[name="student-vote"]:checked');
 if(r.type==='poll'&&!chosen)return announce('Choose an option before submitting.',true);
 const value=r.type==='poll'?Number(chosen.value):$('student-answer')?.value||'';
 if(r.type!=='poll'&&!String(value).trim())return announce('Enter an answer first.',true);
 const button=$('submit-answer');button.disabled=true;
 try{
  const result=await request('submit',{token:state.token,value,roundId:r.id,revision:state.snapshot?.mine?.revision||0});
  announce('Response saved for this activity.');if($('student-answer'))delete $('student-answer').dataset.dirty;
  await refresh();
 }catch(e){announce(e.message,true);button.disabled=false}
 finally{if($('submit-answer'))$('submit-answer').disabled=false}
}
function displayShell(){
 app.innerHTML='<section class="surface"><div class="headrow"><div><p class="eyebrow">Projection display</p><h1 id="display-title">Live classroom</h1></div><span class="pill blue">Room '+esc(state.room)+'</span></div><div id="display-work" class="live-area">'+loading('Waiting for lecturer…')+'</div>'+notices()+'</section>';
}
function renderDisplay(snapshot){
 const r=snapshot.active;$('display-title').textContent=r?.prompt||NAMES[r?.type]||'Live classroom';
 $('display-work').innerHTML=resultsHtml(snapshot,true);
 syncClock();
}
function syncClock(){
 for(const el of document.querySelectorAll('[data-end-time]')){
  const remaining=Math.max(0,Math.ceil((Number(el.dataset.endTime)-Date.now()-state.clockOffset)/1000));
  el.textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
 }
}
async function refresh(){
 if(!state.token||state.busy)return;
 const epoch=state.epoch;state.busy=true;
 try{
  const snap=await request('state',{token:state.token});
  if(epoch!==state.epoch)return;
  state.clockOffset=snap.serverTime-Date.now();state.errors=0;state.snapshot=snap;
  connected(true,'Synced live');
  if(state.role==='teacher')renderTeacher(snap);
  else if(state.role==='student')renderStudent(snap);
  else if(state.role==='display')renderDisplay(snap);
 }catch(e){
  if(epoch!==state.epoch)return;
  state.errors++;connected(false,'Reconnecting');
  if(state.errors===1||state.errors%4===0)announce(e.message,true);
  if(/expired|invalid|ended/i.test(e.message)){stopPolling();connected(false,'Session ended')}
 }finally{state.busy=false}
}
function stopPolling(){state.epoch++;if(state.pollTimer)clearTimeout(state.pollTimer);state.pollTimer=null}
function startPolling(){
 const epoch=state.epoch;
 const schedule=()=>{if(epoch!==state.epoch||!state.token)return;
   const rate=document.hidden?12000:state.role==='teacher'?1750:state.role==='display'?2000:2500;
   state.pollTimer=setTimeout(async()=>{await refresh();schedule()},Math.min(18000,rate*Math.max(1,state.errors)));
 };schedule();
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.token)refresh()});
window.addEventListener('focus',()=>{if(state.token)refresh()});
setInterval(syncClock,400);
function restore(){
 const query=new URLSearchParams(location.search);
 if(query.get('view')==='display'){
  const token=query.get('token')||sessionStorage.getItem('classroom-display');
  if(!token)return false;
  try{
   const raw=token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/');
   const claims=JSON.parse(atob(raw));if(!/^[0-9]{6}$/.test(claims.code))return false;
   state.role='display';state.room=claims.code;state.token=token;
   sessionStorage.setItem('classroom-display',token);
   if(query.has('token'))history.replaceState(null,'',location.pathname+'?view=display');
   shell();refresh();return true;
  }catch{return false}
 }
 for(const [storageKey,role,key] of [['classroom-teacher','teacher','teacherToken'],['classroom-student','student','token']]){
  try{
   const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
   if(saved&&saved[key]&&/^[0-9]{6}$/.test(String(saved.code))){
    state.role=role;state.room=saved.code;state.token=saved[key];state.displayToken=saved.displayToken||null;
    shell();refresh();return true;
   }
  }catch{/* Invalid stored session */}
 }
 return false;
}
if(!restore()){if(new URLSearchParams(location.search).has('code'))joinForm();else welcome()}
