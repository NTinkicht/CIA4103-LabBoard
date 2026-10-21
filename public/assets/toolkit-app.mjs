'use strict';
const api='/.netlify/functions/toolkit',app=document.getElementById('app');
const $=(id)=>document.getElementById(id);
const state={role:null,token:null,code:null,displayToken:null,tool:'poll',snapshot:null,round:null,busy:false,tick:null,lastRoundId:null};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=(msg,bad=false)=>{const el=$('notice');if(el){el.textContent=msg;el.className='notice '+(bad?'error':'ok');}};
async function call(action,extra={}){
 const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...extra}),cache:'no-store'});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Network error');
 return data;
}
function roomTop(){ $('top-room').textContent=state.code?'Room '+state.code:'Join once · Interact live';}
function welcome(){
 state.role=null;roomTop();
 app.innerHTML='<section class="panel" style="max-width:650px;margin:auto"><h1>Start or join a classroom</h1><p>Use any tool, any time. No course setup or lesson content required.</p><div class="split"><div class="card"><h3>Student</h3><p>Join using your lecturer\'s six-digit code.</p><button id="student-open">Join classroom</button></div><div class="card"><h3>Lecturer</h3><p>Create a private live classroom using your lecturer PIN.</p><button id="teacher-open" class="alt">Start a classroom</button></div></div><div id="notice" role="status" aria-live="polite"></div></section>';
 $('student-open').onclick=joinView;$('teacher-open').onclick=teacherView;
}
function joinView(){
 app.innerHTML='<section class="panel" style="max-width:560px;margin:auto"><h1>Join a classroom</h1><p>Enter your classroom code. Pair name is optional unless the teacher requests pair responses.</p><label for="code">Six-digit code</label><input id="code" inputmode="numeric" maxlength="6" value="'+esc(new URLSearchParams(location.search).get('code')||'')+'"><label for="name">Display name or nickname</label><input id="name" maxlength="60" autocomplete="nickname" placeholder="e.g. Student 07"><label for="team">Pair name (optional)</label><input id="team" maxlength="32" placeholder="e.g. Pair 07"><div class="actions"><button id="join">Join room</button><button id="back" class="alt">Back</button></div><div id="notice" role="status" aria-live="polite"></div></section>';
 $('back').onclick=welcome;$('join').onclick=async()=>{
  $('join').disabled=true;
  try{
   const result=await call('join',{code:$('code').value.trim(),name:$('name').value.trim(),team:$('team').value.trim()});
   state.role='student';state.code=result.code;state.token=result.token;sessionStorage.setItem('ct-student',JSON.stringify(result));shell();await refresh();
  }catch(e){notify(e.message,true);$('join').disabled=false;}
 };
}
function teacherView(){
 app.innerHTML='<section class="panel" style="max-width:550px;margin:auto"><h1>Lecturer access</h1><p>Create a new classroom without selecting a course or adding a question.</p><label for="pin">Private lecturer PIN</label><input id="pin" type="password" autocomplete="off"><div class="actions"><button id="create">Start room</button><button id="back" class="alt">Back</button></div><div id="notice" role="status" aria-live="polite"></div></section>';
 $('back').onclick=welcome;$('create').onclick=async()=>{
  $('create').disabled=true;
  try{
   const r=await call('create',{pin:$('pin').value});
   state.role='teacher';state.code=r.code;state.token=r.teacherToken;state.displayToken=r.displayToken;
   sessionStorage.setItem('ct-teacher',JSON.stringify(r));shell();await refresh();
  }catch(e){notify(e.message,true);$('create').disabled=false;}
 };
}
const tools=[['poll','▥ Live Poll'],['answers','▤ Live Answers'],['cloud','☁ Word Cloud'],['timer','◷ Timer'],['screen','▣ Screen Sharing']];
function shell(){
 roomTop();
 if(state.role==='teacher'){
 app.innerHTML='<div class="layout"><section class="panel"><h3>Tools</h3><nav id="tools"></nav><hr><p class="hint">Room code</p><div class="big">'+esc(state.code)+'</div><p class="hint">Students join using this code once.</p><div class="actions"><button class="alt" id="copy-join">Copy student link</button><button class="alt" id="copy-display">Copy projector link</button><button class="danger" id="end">End room</button></div></section><section><div class="panel"><h2 id="tool-name">Live Poll</h2><div id="setup"></div></div><div class="panel" style="margin-top:16px"><h3>Live room <span class="count" id="part-count">0 participants</span></h3><div id="results">Waiting for a tool…</div><div id="teacher-controls" class="actions"></div></div><div id="notice" role="status" aria-live="polite" style="margin-top:12px"></div></section></div>';
 $('tools').innerHTML=tools.map(([k,name])=>'<button data-tool="'+k+'">'+name+'</button>').join('');
 document.querySelectorAll('[data-tool]').forEach(btn=>btn.onclick=()=>{state.tool=btn.dataset.tool;setupTool();});
 $('copy-join').onclick=()=>copy(location.origin+'/toolkit/?code='+state.code);
 $('copy-display').onclick=()=>copy(location.origin+'/toolkit/?view=display&token='+encodeURIComponent(state.displayToken));
 $('end').onclick=async()=>{if(!confirm('End this room for all participants?'))return;try{await call('control',{token:state.token,control:'end'});sessionStorage.removeItem('ct-teacher');state.token=null;welcome();}catch(e){notify(e.message,true)}};
 setupTool();
 }else if(state.role==='student'){
 app.innerHTML='<section class="panel" style="max-width:780px;margin:auto"><h1>Classroom '+esc(state.code)+'</h1><p>Connected. Your lecturer will start an activity when ready.</p><div id="student-work"></div><div id="notice" role="status" aria-live="polite"></div><p><a href="/live/" target="_blank" rel="noopener">Request to share an application window (existing screen-share service)</a></p></section>';
 }else{
 app.className='displaymode';app.innerHTML='<section class="panel"><h1>Classroom '+esc(state.code)+'</h1><div id="display-work"><p>Waiting for the lecturer…</p></div><div id="notice" role="status" aria-live="polite"></div></section>';
 }
 startPolling();
}
async function copy(value){try{await navigator.clipboard.writeText(value);notify('Link copied.');}catch{notify('Copy failed. Use browser share tools.',true)}}
function setupTool(){
 if(state.role!=='teacher')return;
 document.querySelectorAll('[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===state.tool));
 const names={poll:'Live Poll',answers:'Live Answers',cloud:'Word Cloud',timer:'Classroom Timer',screen:'Screen Sharing'};
 $('tool-name').textContent=names[state.tool];
 if(state.tool==='screen'){
 $('setup').innerHTML='<p>Your existing screen-sharing workflow is preserved unchanged for now. The new multi-room integration will follow in the next development stage.</p><div class="actions"><a href="/dashboard/" target="_blank" rel="noopener">Open lecturer screen-sharing dashboard ↗</a> <a href="/live/" target="_blank" rel="noopener">Student screen-sharing page ↗</a></div>';return;
 }
 const units='<label for="unit">Responses from</label><select id="unit"><option value="individual">Individuals</option><option value="pair">Pairs (one answer per pair)</option></select>';
 let content='<p class="muted">Open this tool at any point in your lesson. Questions are optional.</p>';
 if(state.tool==='poll')content+='<label for="prompt">Question (optional)</label><input id="prompt" maxlength="240" placeholder="You can ask verbally or show on PowerPoint"><div id="options" class="grid2">'+[0,1,2,3].map(i=>'<div><label for="o'+i+'">Option '+(i+1)+'</label><input class="poll-option" id="o'+i+'" value="Option '+(i+1)+'" maxlength="60"></div>').join('')+'</div><div class="actions"><button id="add-option" class="alt" type="button">+ Add option</button><button id="remove-option" class="alt" type="button">− Remove last</button></div>'+units;
 if(state.tool==='answers')content+='<label for="prompt">Question (optional)</label><input id="prompt" maxlength="240" placeholder="Ask verbally or display in PowerPoint">'+units;
 if(state.tool==='cloud')content+='<label for="prompt">Prompt (optional)</label><input id="prompt" maxlength="240" placeholder="e.g. One word that describes…">'+units;
 if(state.tool==='timer')content+='<label for="duration">Countdown duration (seconds)</label><input id="duration" inputmode="numeric" type="number" min="10" max="7200" value="300">';
 $('setup').innerHTML=content+'<div class="actions"><button id="start-tool">Start '+esc(names[state.tool])+'</button></div>';
 if(state.tool==='poll'){
  $('add-option').onclick=()=>{const n=document.querySelectorAll('.poll-option').length;if(n>=8)return;const el=document.createElement('div');el.innerHTML='<label for="o'+n+'">Option '+(n+1)+'</label><input class="poll-option" id="o'+n+'" value="Option '+(n+1)+'" maxlength="60">';$('options').append(el);};
  $('remove-option').onclick=()=>{const a=document.querySelectorAll('.poll-option');if(a.length>2)a[a.length-1].parentElement.remove();};
 }
 $('start-tool').onclick=async()=>{
  const type=state.tool,params={token:state.token,type,prompt:$('prompt')?.value||'',unit:$('unit')?.value||'individual'};
  if(type==='poll')params.options=[...document.querySelectorAll('.poll-option')].map(e=>e.value.trim()).filter(Boolean);
  if(type==='timer')params.duration=Number($('duration').value);
  $('start-tool').disabled=true;
  try{await call('start',params);notify('Tool started. Student screens update automatically.');await refresh();}catch(e){notify(e.message,true)}finally{$('start-tool').disabled=false}
 };
}
function bars(round,votes){
 const n=votes.reduce((a,b)=>a+b,0);
 return '<p><strong>'+n+'</strong> submitted votes</p>'+round.options.map((o,i)=>'<div><strong>'+esc(o)+'</strong> · '+votes[i]+' ('+(n?Math.round(100*votes[i]/n):0)+'%)<div class="barouter"><div class="bar" style="width:'+(n?100*votes[i]/n:0)+'%"></div></div></div>').join('');
}
function viewResults(snapshot,isProjector=false){
 const r=snapshot.active;
 if(!r)return '<p>Waiting for the first activity.</p>';
 if(r.type==='timer')return '<p class="muted">Countdown</p><div class="big" data-timer="'+r.endsAt+'">--:--</div>';
 if(isProjector&&!r.revealed)return '<div class="notice">Results are hidden until the lecturer reveals them.</div>';
 if(r.type==='poll')return bars(r,snapshot.results?.votes||r.options.map(()=>0));
 if(r.type==='cloud'){
 const words=snapshot.results?.words||[];
 return '<p class="muted">'+(snapshot.results?.total||0)+' responses</p><div class="cloud">'+(words.length?words.map(w=>'<span style="font-size:'+Math.min(66,15+Math.sqrt(w.count)*13)+'px">'+esc(w.word)+'</span>').join(''):'<p>Waiting for words…</p>')+'</div>';
 }
 const answers=snapshot.answers||[];
 if(!answers.length)return '<p>Waiting for answers…</p>';
 return '<p>'+answers.length+' answers received</p>'+answers.map(a=>'<div class="answer '+(a.hidden?'hidden':'')+'">'+esc(a.value)+(isProjector?'':'<p class="hint">'+esc(a.name||'Student')+'</p><button class="alt" data-hide="'+esc(a.subject)+'" data-hidden="'+(a.hidden?'true':'false')+'">'+(a.hidden?'Show':'Hide')+'</button>')+'</div>').join('');
}
function updateClock(){
 document.querySelectorAll('[data-timer]').forEach(e=>{const remain=Math.max(0,Math.ceil((Number(e.dataset.timer)-Date.now())/1000));e.textContent=String(Math.floor(remain/60)).padStart(2,'0')+':'+String(remain%60).padStart(2,'0');});
}
function renderTeacher(snap){
 $('part-count').textContent=(snap.participants||0)+' participants';
 $('results').innerHTML='<p class="hint">Current: '+(snap.active?esc(snap.active.type)+' · '+esc(snap.active.status):'None')+'</p>'+viewResults(snap);
 document.querySelectorAll('[data-hide]').forEach(b=>b.onclick=async()=>{
  try{await call('moderate',{token:state.token,subject:b.dataset.hide,hidden:b.dataset.hidden!=='true'});await refresh();}catch(e){notify(e.message,true)}
 });
 const r=snap.active;
 $('teacher-controls').innerHTML=r?'<button class="alt" id="reveal">'+(r.revealed?'Hide results':'Reveal results')+'</button><button class="alt" id="close-round" '+(r.status==='closed'?'disabled':'')+'>Close answers</button>':'';
 if(r){
 $('reveal').onclick=()=>control(r.revealed?'hide':'reveal');
 $('close-round').onclick=()=>control('close');
 }
 updateClock();
}
async function control(action){try{await call('control',{token:state.token,control:action});await refresh();}catch(e){notify(e.message,true)}}
function renderStudent(snap){
 const r=snap.active,container=$('student-work');
 if(!r){container.innerHTML='<div class="card">Waiting for an activity…</div>';state.lastRoundId=null;return;}
 if(r.id+':'+r.status!==state.lastRoundId){
  state.lastRoundId=r.id+':'+r.status;
  let inner='<h2>'+({poll:'Live Poll',answers:'Live Answers',cloud:'Word Cloud',timer:'Timer'}[r.type])+'</h2>'+(r.prompt?'<p>'+esc(r.prompt)+'</p>':'');
  if(r.type==='timer')inner+='<div class="big" data-timer="'+r.endsAt+'">--:--</div>';
  else if(r.status==='closed')inner+='<div class="notice">This activity is closed.</div>';
  else{
   if(r.type==='poll')inner+=r.options.map((o,i)=>'<label class="choice"><input name="vote" type="radio" value="'+i+'"><span>'+esc(o)+'</span></label>').join('');
   else inner+='<label for="answer">'+(r.type==='cloud'?'Your word or short phrase':'Your short answer')+'</label><textarea id="answer" rows="3" maxlength="'+(r.type==='cloud'?40:500)+'"></textarea>';
   inner+='<div class="actions"><button id="send-answer">Submit '+(r.unit==='pair'?'pair':'my')+' answer</button></div>';
  }
  container.innerHTML=inner;
  if($('send-answer'))$('send-answer').onclick=async()=>{
   const value=r.type==='poll'?Number(document.querySelector('input[name="vote"]:checked')?.value):$('answer').value;
   if(r.type==='poll'&&!document.querySelector('input[name="vote"]:checked'))return notify('Choose an option.',true);
   $('send-answer').disabled=true;
   try{const result=await call('submit',{token:state.token,value,roundId:r.id,revision:state.snapshot?.mine?.revision||0});notify('Answer submitted successfully.');await refresh();}catch(e){notify(e.message,true)}finally{if($('send-answer'))$('send-answer').disabled=false}
  };
 }
 if(snap.mine && r.type!=='timer'){
  let label=$('mine-status');
  if(!label){label=document.createElement('p');label.id='mine-status';label.className='notice ok';container.append(label)}
  label.textContent='Submitted · revision '+snap.mine.revision+'. You may edit while the activity remains open.';
 }
 updateClock();
}
function renderDisplay(snap){
 $('display-work').innerHTML=(snap.active&&snap.active.prompt?'<p style="font-size:clamp(19px,3vw,36px)">'+esc(snap.active.prompt)+'</p>':'')+viewResults(snap,true);
 updateClock();
}
async function refresh(){
 if(!state.token||state.busy)return;
 state.busy=true;
 try{
 const snap=await call('state',{token:state.token});
 state.snapshot=snap;
 if(state.role==='teacher')renderTeacher(snap);
 if(state.role==='student')renderStudent(snap);
 if(state.role==='display')renderDisplay(snap);
 }catch(e){notify(e.message,true);if(/ended|expired|invalid/i.test(e.message)){clearInterval(state.tick);state.tick=null;}}
 finally{state.busy=false}
}
function startPolling(){if(state.tick)clearInterval(state.tick);state.tick=setInterval(refresh,5000);if(!window.clockTick)window.clockTick=setInterval(updateClock,500);}
(async()=>{
 try{
  const params=new URLSearchParams(location.search);
  if(params.get('view')==='display'&&params.get('token')){
    state.role='display';state.token=params.get('token');
    const payload=JSON.parse(atob(state.token.split('.')[0].replace(/-/g,'+').replace(/_/g,'/')));
    state.code=payload.code;history.replaceState(null,'',location.pathname+'?view=display');shell();await refresh();return;
  }
  const lecturer=JSON.parse(sessionStorage.getItem('ct-teacher')||'null');
  const student=JSON.parse(sessionStorage.getItem('ct-student')||'null');
  if(lecturer?.teacherToken){state.role='teacher';state.code=lecturer.code;state.token=lecturer.teacherToken;state.displayToken=lecturer.displayToken;shell();await refresh();return}
  if(student?.token){state.role='student';state.code=student.code;state.token=student.token;shell();await refresh();return}
 }catch(e){console.warn('Previous classroom session unavailable');}
 if(new URLSearchParams(location.search).has('code'))joinView();else welcome();
})();
