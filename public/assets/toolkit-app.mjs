import {mountWhiteboard} from './toolkit-whiteboard.mjs';
import {createLiveCloud} from './toolkit-cloud.mjs';
import {mountEvaluationLecturer,mountEvaluationStudent} from './toolkit-evaluation.mjs';
const API='/.netlify/functions/toolkit';
const app=document.getElementById('app'),roomChip=document.getElementById('top-room'),conn=document.getElementById('connection');
const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NAMES={poll:'Live Poll',answers:'Live Answers',cloud:'Word Cloud',timer:'Timer',screen:'Screen Sharing',documents:'Files & Slides',web:'Web Browser',work:'Work & Problems',whiteboard:'Whiteboard',evaluation:'Evaluation'};
let teacherWhiteboard=null,studentWhiteboard=null,displayWhiteboard=null,lastDisplayBoardId=null;
let teacherCloud=null,displayCloud=null,teacherCloudRound=null,displayCloudRound=null,cloudReviewSignature=null;
let evaluationTeacher=null,evaluationStudent=null,evaluationStudentRound=null;
const ICONS={poll:'▥',answers:'▤',cloud:'☁',timer:'◷',screen:'▣',documents:'▧'};
const state={role:null,token:null,displayToken:null,room:null,studentTab:'activities',studentName:'',workImage:null,workItems:[],workKind:'problem',shareLoaded:false,workLastFetch:0,workFetchBusy:false,workSignature:null,tool:'poll',activityView:'questions',snapshot:null,lastStudentKey:null,pollTimer:null,busy:false,epoch:0,clockOffset:0,errors:0,savedPolls:[],savedQuestionSets:{poll:[],cloud:[],answers:[]},editingPollId:null,editingRevision:0,participationSignature:null,evalKind:'jumbled'};
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
 stopPolling();state.role=null;state.token=null;state.room=null;state.displayToken=null;state.snapshot=null;state.lastStudentKey=null;state.errors=0;state.studentTab='activities';state.studentName='';state.workImage=null;state.shareLoaded=false;state.workItems=[];state.workLastFetch=0;state.workSignature=null;state.savedPolls=[];state.savedQuestionSets={poll:[],cloud:[],answers:[]};state.editingPollId=null;state.editingRevision=0;state.activityView='questions';state.participationSignature=null;setRoom(null);connected(null);
 app.className='container';
 app.innerHTML='<div class="join-shell"><section class="join-card"><p class="eyebrow">Welcome to your teaching companion</p><h1>Make every voice part of the room.</h1><p style="max-width:515px;margin-top:15px">Live polls, open answers, word clouds and screen sharing. No course setup. No new link for every question.</p><div class="entry-grid"><div class="entry-card"><span class="entry-icon">↗</span><h3>Join as student</h3><p>Enter your room code once, then respond to activities on any device.</p>'+btn('Join classroom →','primary','open-student')+'</div><div class="entry-card"><span class="entry-icon">▦</span><h3>Start as lecturer</h3><p>Create a classroom and choose your teaching tools as you go.</p>'+btn('Start classroom →','secondary','open-teacher')+'</div></div>'+notices()+'</section></div>';
 $('open-student').onclick=joinForm;$('open-teacher').onclick=teacherForm;
}
function joinForm(){
 app.innerHTML='<div class="join-shell"><section class="join-card narrow"><p class="eyebrow">Student entrance</p><h1>Join your classroom</h1><p>Use the code shown by your lecturer. No course registration required.</p><form id="join-form"><label for="room-code">Classroom code</label><input id="room-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" required value="'+esc(new URLSearchParams(location.search).get('code')||'')+'"><label for="join-name">Your name or nickname</label><input id="join-name" placeholder="e.g. Student 07" maxlength="60" autocomplete="nickname" required><label for="pair">Pair name <span class="small">(optional)</span></label><input id="pair" placeholder="e.g. Pair 03" maxlength="32"><p class="small">If your lecturer requests one response per pair, both partners should use exactly the same pair name.</p><div class="buttons">'+btn('Join classroom →','primary','join-submit','type="submit"')+btn('Back','ghost','back','type="button"')+'</div></form>'+notices()+'</section></div>';
 $('back').onclick=welcome;
 $('join-form').onsubmit=async e=>{e.preventDefault();const button=$('join-submit');button.disabled=true;
  try{const data=await request('join',{code:$('room-code').value.trim(),name:$('join-name').value.trim(),team:$('pair').value.trim()});
   state.role='student';state.room=data.code;state.token=data.token;state.studentName=$('join-name').value.trim();state.lastStudentKey=null;data.name=state.studentName;sessionStorage.setItem('classroom-student',JSON.stringify(data));
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
 app.classList.add('lecturer-layout');
 const railPref=(()=>{try{return localStorage.getItem('classroom-toolkit-rail-collapsed')==='true'}catch{return false}})();
 app.classList.toggle('rail-collapsed',railPref);
 const tabs=[['poll','▥','Live Poll'],['answers','▤','Live Answers'],['cloud','☁','Word Cloud'],['timer','◷','Timer'],['screen','▣','Screen Sharing'],['work','▤','Work & Problems'],['whiteboard','✎','Whiteboard'],['documents','▧','Files & Slides'],['web','◎','Web Browser'],['evaluation','◈','Evaluation']];
 app.innerHTML='<div class="workspace"><aside class="rail"><div class="rail-top"><p class="rail-title">Interactive tools</p><button type="button" class="rail-toggle" id="rail-toggle" aria-label="Collapse sidebar" aria-expanded="true" aria-controls="tool-nav" title="Collapse sidebar">☰</button></div><nav aria-label="Teaching tools" id="tool-nav">'+tabs.map(([id,icon,text])=>'<button class="tool-link" type="button" data-tool="'+id+'" title="'+text+'" aria-label="'+text+'"><span class="tool-icon" aria-hidden="true">'+icon+'</span><span class="tool-text">'+text+'</span></button>').join('')+'</nav><div class="rail-divider"></div><div class="rail-code"><p class="eyebrow">Classroom code</p><strong>'+esc(state.room)+'</strong><p class="small">One link for every tool</p></div><div class="rail-actions">'+btn('↗ Copy student link','secondary','copy-link')+btn('▣ Copy projector link','secondary','copy-projector')+btn('End room','danger','end-room')+'</div></aside><aside id="participation-panel" class="participation-panel" aria-label="Student participation" hidden>'+
  '<div class="participation-head"><div><p class="eyebrow">Classroom roster</p><h2>Students</h2></div><strong id="participation-total" class="participation-total">0</strong></div>'+
  '<p id="participation-context" class="participation-context">Joined students</p>'+
  '<div id="participation-summary" class="participation-summary" role="status" aria-live="polite">Waiting for students…</div>'+
  '<div id="participation-list" class="participation-list" role="list"></div>'+
  '<p id="participation-footnote" class="participation-footnote">Students who joined this classroom</p>'+
 '</aside><div class="mainstack"><section class="surface"><div class="headrow"><div><p class="eyebrow">Teaching workspace</p><h1 id="tool-title">Live Poll</h1><p id="tool-description"></p></div><span class="pill blue">All courses</span></div><div class="activity-view-tabs" id="activity-view-tabs" role="tablist" aria-label="Activity views" hidden>'+
  '<button type="button" id="activity-questions" role="tab" aria-controls="tool-config" aria-selected="true">Questions</button>'+
  '<button type="button" id="activity-results" role="tab" aria-controls="live-results-panel" aria-selected="false" disabled>Live Results</button>'+
 '</div><div id="tool-config" role="tabpanel" aria-labelledby="activity-questions"></div><div id="teacher-screen-host" class="lecturer-embed" hidden><iframe id="teacher-screen-frame" title="Lecturer screen sharing and student approval queue" loading="eager" allowfullscreen src="about:blank"></iframe></div><div id="teacher-slides-host" class="lecturer-embed" hidden><iframe id="document-frame" title="PowerPoint and PDF viewer" loading="eager" allowfullscreen src="about:blank"></iframe></div><div id="teacher-web-host" class="lecturer-embed" hidden><iframe id="teacher-web-frame" title="Saved website browser" loading="eager" allowfullscreen src="about:blank"></iframe></div><div id="live-results-panel" class="activity-results-view" role="tabpanel" aria-labelledby="activity-results" hidden><div class="results-head"><div><p class="eyebrow" id="results-kind">Live activity</p><h2 id="current-label">Responses</h2></div><div class="metric-pair"><div><div class="metric" id="participants-count">—</div><div class="metric-label">Students joined</div></div><span class="pill grey" id="round-status">No activity</span></div></div><div id="live-results" class="live-area">'+noResults('Start an activity to see live results.')+'</div><div id="round-actions" class="buttons"></div></div></section>'+notices()+'</div></div>';
 const updateRail=collapsed=>{
  app.classList.toggle('rail-collapsed',collapsed);
  const toggle=$('rail-toggle');
  if(toggle){
   toggle.textContent=collapsed?'☰':'‹';
   toggle.setAttribute('aria-expanded',String(!collapsed));
   toggle.setAttribute('aria-label',collapsed?'Expand sidebar':'Collapse sidebar');
   toggle.title=collapsed?'Expand sidebar':'Collapse sidebar';
  }
  try{localStorage.setItem('classroom-toolkit-rail-collapsed',String(collapsed))}catch{}
 };
 updateRail(railPref);
 $('rail-toggle').addEventListener('click',()=>updateRail(!app.classList.contains('rail-collapsed')));
 $('activity-questions').onclick=()=>setActivityView('questions');
 $('activity-results').onclick=()=>setActivityView('results');
 document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{
  state.tool=b.dataset.tool;
  state.activityView=state.snapshot?.active?.type===state.tool&&
    ['poll','answers','cloud'].includes(state.tool)?'results':'questions';
  configTool();
  if(state.snapshot)renderTeacher(state.snapshot);
 });
 const webFrame=$('teacher-web-frame');
 webFrame?.addEventListener('load',()=>{
  if(state.role==='teacher'&&state.token&&webFrame.contentWindow)
   webFrame.contentWindow.postMessage({type:'toolkit:web-session',token:state.token},location.origin);
 });
 const liveFrame=$('teacher-screen-frame');
 liveFrame?.addEventListener('load',()=>{
  if(state.role==='teacher'&&state.token&&liveFrame.contentWindow)
   liveFrame.contentWindow.postMessage({type:'toolkit:lecturer-session',token:state.token},location.origin);
 });
 $('copy-link').onclick=()=>copyLink(location.origin+'/toolkit/?code='+encodeURIComponent(state.room));
 $('copy-projector').onclick=()=>copyLink(location.origin+'/toolkit/?view=display&token='+encodeURIComponent(state.displayToken));
 $('end-room').onclick=async()=>{
  if(!confirm('End this classroom for everyone?'))return;
  try{await request('control',{token:state.token,control:'end'});sessionStorage.removeItem('classroom-teacher');welcome();}catch(e){announce(e.message,true)}
 };
 configTool();
 void loadSavedQuestions('poll');
 void loadSavedQuestions('answers');
 void loadSavedQuestions('cloud');
}
const RESPONSE_TOOLS=['poll','answers','cloud'];
function setActivityView(view){
 if(!RESPONSE_TOOLS.includes(state.tool))return;
 const ready=state.snapshot?.active?.type===state.tool;
 state.activityView=view==='results'&&ready?'results':'questions';
 syncActivityTabs();
 window.scrollTo({top:0,behavior:'instant'});
}
function syncActivityTabs(){
 const isResponse=RESPONSE_TOOLS.includes(state.tool);
 const matching=Boolean(isResponse&&state.snapshot?.active?.type===state.tool);
 if(!matching&&state.activityView==='results')state.activityView='questions';
 const results=isResponse&&matching&&state.activityView==='results';
 const timerResults=state.tool==='timer'&&state.snapshot?.active?.type==='timer';
 const showingResults=results||timerResults;
 const tabs=$('activity-view-tabs');
 if(tabs)tabs.hidden=!isResponse;
 const q=$('activity-questions'),r=$('activity-results');
 if(r){
  r.disabled=!matching;
  r.setAttribute('aria-selected',String(results));
  r.tabIndex=results?0:-1;
 }
 if(q){
  q.setAttribute('aria-selected',String(!results));
  q.tabIndex=results?-1:0;
 }
 if(tabs){
  q.classList.toggle('active',!results);
  r.classList.toggle('active',results);
 }
 const form=$('tool-config');
 if(form)form.hidden=showingResults;
 const panel=$('live-results-panel');
 if(panel)panel.hidden=!showingResults;
 app.classList.toggle('activity-results-focus',showingResults);
}

const PARTICIPATION_TOOLS=['poll','answers','cloud','timer','work','documents','evaluation'];
const RESPONSE_PARTICIPATION=['poll','answers','cloud'];
function updateParticipationVisibility(){
 const enabled=PARTICIPATION_TOOLS.includes(state.tool);
 app.classList.toggle('has-participation',enabled);
 const panel=$('participation-panel');
 if(panel)panel.hidden=!enabled;
 state.participationSignature=null;
}
function renderParticipationRoster(snapshot){
 const panel=$('participation-panel');
 if(!panel||panel.hidden||!snapshot)return;
 const students=Array.isArray(snapshot.students)?snapshot.students:[];
 const active=RESPONSE_PARTICIPATION.includes(state.tool)&&snapshot.active?.type===state.tool ||
    state.tool==='evaluation'&&snapshot.active?.type==='evaluation'&&snapshot.active.evalKind===state.evalKind;
 const workMode=state.tool==='work';
 const tracked=active||workMode;
 const uploaded=new Set(workMode?state.workItems.map(item=>item.studentId):[]);
 const statusFor=student=>active?Boolean(student.participated):
   workMode?uploaded.has(student.id):null;
 const submitted=tracked?students.filter(student=>statusFor(student)).length:0;
 const mode=active?(snapshot.active.unit==='pair'?'Pair submissions':
     state.tool==='evaluation'?'Evaluation submissions':'Individual submissions'):
   workMode?'Work submitted':RESPONSE_PARTICIPATION.includes(state.tool)?'Waiting for this activity':
   state.tool==='timer'?'Timer has no answer submission':'Slides have no answer submission';
 const signature=[state.tool,mode,students.map(student=>[student.id,student.name,student.team,
   statusFor(student)].join('|')).join(';')].join('::');
 if(signature===state.participationSignature)return;
 state.participationSignature=signature;
 $('participation-total').textContent=String(students.length);
 $('participation-context').textContent=mode;
 $('participation-summary').textContent=!students.length?'No students have joined yet':
   tracked?submitted+' of '+students.length+' participated':'Participation not tracked for this tool';
 $('participation-summary').classList.toggle('is-tracked',tracked);
 $('participation-footnote').textContent=active?'Based on answers to the current activity':
   workMode?'Based on work submitted in this classroom':
   RESPONSE_PARTICIPATION.includes(state.tool)?'Statuses activate when this tool starts':
   'Joined students shown; there is no submission to measure here';
 const list=$('participation-list');
 list.innerHTML=students.map(student=>{
  const result=statusFor(student);
  const text=result===true?'Participated':result===false?'Not participated':'Not tracked';
  const css=result===true?'participated':result===false?'not-participated':'untracked';
  return '<div class="participation-student '+css+'" role="listitem" aria-label="'+esc(student.name)+': '+text+'">'+
   '<span class="participation-avatar" aria-hidden="true">'+esc(student.name.trim().charAt(0).toUpperCase()||'?')+'</span>'+
   '<span class="participation-identity"><strong>'+esc(student.name)+'</strong>'+
   (student.team?'<small>'+esc(student.team)+'</small>':'')+'</span>'+
   '<span class="participation-state" title="'+text+'" aria-label="'+text+'">'+
    '<span class="participation-symbol" aria-hidden="true">'+(result===true?'✓':result===false?'○':'—')+'</span>'+
    '<span class="participation-status-text">'+text+'</span></span></div>';
 }).join('')||'<p class="participation-empty">Students will appear here after joining the classroom.</p>';
}

function configTool(){
 if(state.tool!=='evaluation'&&evaluationTeacher){
  evaluationTeacher.destroy();evaluationTeacher=null;
 }
 if(state.tool!=='cloud'&&teacherCloud){
  teacherCloud.destroy();teacherCloud=null;teacherCloudRound=null;cloudReviewSignature=null;
 }
 app.classList.toggle('screen-focus',state.tool==='screen');
 app.classList.toggle('slides-focus',state.tool==='documents');
 app.classList.toggle('web-focus',state.tool==='web');
 updateParticipationVisibility();
 if(teacherWhiteboard){teacherWhiteboard.destroy();teacherWhiteboard=null}
 const screenHost=$('teacher-screen-host'),slidesHost=$('teacher-slides-host'),webHost=$('teacher-web-host');
 if(screenHost)screenHost.hidden=state.tool!=='screen';
 if(slidesHost)slidesHost.hidden=state.tool!=='documents';
 if(webHost)webHost.hidden=state.tool!=='web';
 syncActivityTabs();
 document.querySelectorAll('[data-tool]').forEach(b=>{const on=b.dataset.tool===state.tool;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
 $('tool-title').textContent=NAMES[state.tool];
 const description={poll:'Instant voting with a beautiful real-time results chart.',answers:'Collect short written answers without leaving your presentation.',cloud:'Turn classroom keywords into a live, frequency-weighted word cloud.',timer:'A focused countdown that stays in sync across devices.',screen:'Let a student show their work, with your existing approval and standby controls.',documents:'Open your PowerPoint or PDF locally, navigate slides, and present fullscreen.',work:'Review submitted student solutions, problems and screenshots inside this classroom.',whiteboard:'Draw together with the class and choose a student from the roster to write.',web:'Browse lesson websites and save frequently used URLs for future classes.',evaluation:'Prepare timed Jumbled Questions and MCQs, then reveal answers after the timer ends.'};
 $('tool-description').textContent=description[state.tool];
 if(state.tool==='screen'){
  $('tool-config').innerHTML='';
  const frame=$('teacher-screen-frame');
  if(frame?.getAttribute('src')==='about:blank')frame.src='/toolkit/screen-sharing/';
  return;
 }
 if(state.tool==='documents'){
  $('tool-config').innerHTML='';
  const frame=$('document-frame');
  if(frame?.getAttribute('src')==='about:blank')frame.src='/toolkit/presenter/';
  return;
 }
 if(state.tool==='web'){
  $('tool-config').innerHTML='';
  const frame=$('teacher-web-frame');
  if(frame?.getAttribute('src')==='about:blank')frame.src='/toolkit/browser/';
  return;
 }
 if(state.tool==='evaluation'){
  $('tool-config').innerHTML='<div id="teacher-evaluation"></div>';
  evaluationTeacher=mountEvaluationLecturer($('teacher-evaluation'),{
   request,token:state.token,onFinish:finishActivity,getOffset:()=>state.clockOffset,
   onChange:(kind,needsRefresh)=>{
    state.evalKind=kind;state.participationSignature=null;
    if(state.snapshot)renderParticipationRoster(state.snapshot);
    if(needsRefresh)void refresh();
   }
  });
  if(state.snapshot)evaluationTeacher.update(state.snapshot);
  return;
 }
 if(state.tool==='whiteboard'){
  $('tool-config').innerHTML='<div class="tool-feature"><div><strong>Shared classroom whiteboard</strong><p>Write freely, then select one student from the list beside the canvas to let them draw from their own Activities tab. Everyone else can watch.</p></div><span style="font-size:35px" aria-hidden="true">✎</span></div>'+
  '<div class="buttons">'+btn('✎ Open whiteboard for students','primary','wb-open')+'</div><div id="teacher-board-mount"></div>';
  $('wb-open').onclick=openTeacherWhiteboard;
  if(state.snapshot?.active?.type==='whiteboard')mountTeacherWhiteboard();
  return;
 }
 if(state.tool==='work'){
  $('tool-config').innerHTML='<div class="tool-feature"><div><strong>Student solutions & problems</strong><p>Students share code, notes or screenshots without leaving their classroom. Their submissions are private to your room.</p></div><span aria-hidden="true" style="font-size:34px">▤</span></div><div class="buttons">'+btn('↻ Refresh student work','secondary','work-reload')+'</div><div id="teacher-work-list" class="teacher-work-list">'+loading('Loading student submissions…')+'</div>';
  $('work-reload').onclick=()=>loadStudentWork(true);
  void loadStudentWork();
  return;
 }
 const common='<label for="response-unit">Response mode</label><select id="response-unit"><option value="individual">Individual response</option><option value="pair">One answer per pair</option></select>';
 const prompt='<label for="question">Your question <span class="small">(optional — ask it verbally or show on your slides)</span></label><input id="question" maxlength="240" placeholder="No need to type a question">';
 let controls='';
 if(state.tool==='poll'){
 controls='<label for="poll-title">Saved poll title <span class="small">(for your preparation library)</span></label><input id="poll-title" maxlength="100" placeholder="e.g. Week 8 — Process vs Cycle Time">'+prompt+'<div class="subhead" style="margin-top:22px"><h3>Voting choices</h3><span class="pill grey">2–8 options</span></div><div class="option-grid" id="poll-options"></div><div class="buttons">'+btn('+ Add option','secondary','add-option')+btn('− Remove last','ghost','remove-option')+'</div>'+common;
 }else if(state.tool==='answers'||state.tool==='cloud')controls='<label for="poll-title">Saved question title</label><input id="poll-title" maxlength="100" placeholder="e.g. Engage — opening question">'+prompt+common;
 else controls='<label for="duration">Countdown</label><select id="duration"><option value="60">1 minute</option><option value="120">2 minutes</option><option selected value="300">5 minutes</option><option value="600">10 minutes</option><option value="900">15 minutes</option><option value="1800">30 minutes</option></select>';
 $('tool-config').innerHTML=controls+'<div class="buttons">'+btn('▶ Start '+NAMES[state.tool],'primary','launch')+(['poll','answers','cloud'].includes(state.tool)?btn('▤ Save for later','secondary','save-question'):'')+'</div>'+(['poll','answers','cloud'].includes(state.tool)?'<section class="poll-library"><div class="subhead"><h3>Saved '+esc(NAMES[state.tool])+' questions</h3><span class="pill grey" id="poll-library-count">0 saved</span></div><p class="small">Prepare before class; load or edit any question in a later room.</p><div id="poll-library-list"></div></section>':'');
 if(state.tool==='poll'){
   state.editingPollId=null;state.editingRevision=0;
   for(let i=0;i<4;i++)addOption();
   $('add-option').onclick=addOption;
   $('remove-option').onclick=()=>{const els=[...document.querySelectorAll('.poll-option')];if(els.length>2)els.at(-1).parentElement.remove()};
 }
 $('launch').onclick=startRound;
 if(['poll','answers','cloud'].includes(state.tool)){
  state.editingPollId=null;state.editingRevision=0;
  $('save-question').onclick=saveQuestion;
  renderSavedQuestions();
  void loadSavedQuestions(state.tool);
 }
 if(state.tool==='poll'){
  renderSavedQuestions();
 }
}
function addOption(){
 const parent=$('poll-options');if(!parent)return;
 const n=parent.querySelectorAll('.poll-option').length;if(n>=8)return;
 const div=document.createElement('div');div.innerHTML='<label for="option-'+n+'">Option '+(n+1)+'</label><input class="poll-option" id="option-'+n+'" maxlength="60" value="Option '+(n+1)+'">';
 parent.append(div);
}


function questionFields(){
 return {title:$('poll-title')?.value.trim()||'',prompt:$('question')?.value.trim()||'',
  unit:$('response-unit')?.value||'individual',
  options:state.tool==='poll'?[...document.querySelectorAll('.poll-option')].map(e=>e.value.trim()).filter(Boolean):[]};
}
async function loadSavedQuestions(kind){
 if(state.role!=='teacher'||!state.token||!['poll','answers','cloud'].includes(kind))return;
 try{
  const result=await request('library',{token:state.token,operation:'list',kind});
  state.savedQuestionSets[kind]=result.items||result.polls||[];
  renderSavedQuestions();
 }catch(e){if(state.tool===kind)announce('Could not load saved questions: '+e.message,true)}
}
function renderSavedQuestions(){
 const box=$('poll-library-list');if(!box||!['poll','answers','cloud'].includes(state.tool))return;
 const data=state.savedQuestionSets[state.tool]||[];
 $('poll-library-count').textContent=data.length+' saved';
 if(!data.length){box.innerHTML=noResults('Save your first question, then load it during your lesson.');return}
 box.innerHTML=data.map(q=>'<div class="saved-poll-row"><div class="saved-poll-info"><strong>'+esc(q.title)+'</strong><span>'+esc(q.prompt||'Question on your slides')+(state.tool==='poll'?' · '+q.options.length+' choices':'')+'</span></div><div class="buttons"><button type="button" class="secondary" data-use-question="'+q.id+'">Load</button><button type="button" class="ghost" data-delete-question="'+q.id+'">Delete</button></div></div>').join('');
 box.querySelectorAll('[data-use-question]').forEach(b=>b.onclick=()=>useSavedQuestion(b.dataset.useQuestion));
 box.querySelectorAll('[data-delete-question]').forEach(b=>b.onclick=()=>deleteSavedQuestion(b.dataset.deleteQuestion));
}
function useSavedQuestion(id){
 const q=(state.savedQuestionSets[state.tool]||[]).find(q=>q.id===id);
 if(!q)return announce('Saved question not found. Reload your library.',true);
 const kind=state.tool;configTool();
 $('poll-title').value=q.title;$('question').value=q.prompt;$('response-unit').value=q.unit||'individual';
 if(kind==='poll'){
  $('poll-options').innerHTML='';
  for(let i=0;i<q.options.length;i++){addOption();$('option-'+i).value=q.options[i]}
 }
 state.editingPollId=q.id;state.editingRevision=q.revision;
 $('save-question').textContent='▤ Update saved question';
 announce('Question loaded. You can launch or edit it.');
}
async function saveQuestion(){
 const kind=state.tool,form=questionFields();
 if(!form.title)return announce('Enter a title for your saved question.',true);
 if(kind==='poll'&&(form.options.length<2||form.options.length>8))return announce('Enter 2–8 voting choices.',true);
 if(kind!=='poll'&&!form.prompt)return announce('Enter the question you want to save.',true);
 const button=$('save-question');button.disabled=true;
 try{
  const result=await request('library',{token:state.token,operation:'save',kind,item:form,id:state.editingPollId,revision:state.editingRevision});
  state.editingPollId=result.item.id;state.editingRevision=result.item.revision;
  button.textContent='▤ Update saved question';
  announce('Question saved. It is available for future classrooms.');
  await loadSavedQuestions(kind);
 }catch(e){announce(e.message,true)}finally{if($('save-question'))$('save-question').disabled=false}
}
async function deleteSavedQuestion(id){
 const kind=state.tool,q=(state.savedQuestionSets[kind]||[]).find(q=>q.id===id);
 if(!q||!confirm('Delete "'+q.title+'"?'))return;
 try{
  await request('library',{token:state.token,operation:'delete',kind,id});
  if(state.editingPollId===id){state.editingPollId=null;state.editingRevision=0;$('save-question').textContent='▤ Save for later'}
  await loadSavedQuestions(kind);announce('Question deleted.');
 }catch(e){announce(e.message,true)}
}

async function startRound(){
 const button=$('launch');button.disabled=true;const type=state.tool;
 const payload={token:state.token,type,prompt:$('question')?.value||'',unit:$('response-unit')?.value||'individual'};
 if(type==='poll')payload.options=[...document.querySelectorAll('.poll-option')].map(e=>e.value.trim()).filter(Boolean);
 if(type==='timer')payload.duration=Number($('duration').value);
 try{
  const started=await request('start',payload);
  state.snapshot={...(state.snapshot||{}),active:started.active,results:null,answers:[]};
  if(RESPONSE_TOOLS.includes(type)){
   state.activityView='results';
   syncActivityTabs();
   window.scrollTo({top:0,behavior:'instant'});
  }
  await refresh();
  if(state.snapshot?.active?.id===started.active.id){
   if(RESPONSE_TOOLS.includes(type))setActivityView('results');
   renderTeacher(state.snapshot);
  }
  announce('Activity started. Live results are ready.');
 }catch(e){announce(e.message,true)}finally{if($('launch'))$('launch').disabled=false}
}
async function copyLink(s){
 try{await navigator.clipboard.writeText(s);announce('Link copied — ready to share.');}catch{announce('Copy unavailable in this browser. You can copy the URL from your address bar.',true)}
}

function mountTeacherWhiteboard(){
 const area=$('teacher-board-mount');
 if(!area||teacherWhiteboard)return;
 teacherWhiteboard=mountWhiteboard(area,{request,token:state.token,role:'teacher'});
 const b=$('wb-open');if(b)b.textContent='↻ Keep whiteboard open';
}
async function openTeacherWhiteboard(){
 const b=$('wb-open');if(b)b.disabled=true;
 try{
  await request('board',{token:state.token,operation:'activate'});
  mountTeacherWhiteboard();await refresh();
  announce('Whiteboard opened for this classroom. Select a student on the right to let them write.');
 }catch(e){announce(e.message,true)}
 finally{if(b)b.disabled=false}
}

function resultsHtml(snapshot,projector=false){
 const r=snapshot.active;if(!r)return noResults('Start a poll, open question, word cloud or timer.');
 if(r.type==='whiteboard')return '<div class="empty"><span class="empty-icon">✎</span><strong>Shared whiteboard is live</strong><p>The lecturer and a selected student can write. Open the Whiteboard tool to view or grant access.</p></div>';
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
async function finishActivity(){
 const active=state.snapshot?.active;
 if(!active)return announce('There is no active activity.',true);
 const button=$('finish-activity');
 if(button)button.disabled=true;
 try{
  await request('control',{token:state.token,control:'finish',roundId:active.id});
  // Update the local view immediately. The student/other screens follow
  // from the authoritative room state on their next classroom refresh.
  state.snapshot={...state.snapshot,active:null,answers:[],results:null};
  state.activityView='questions';
  window.scrollTo({top:0,behavior:'instant'});
  if(teacherCloud){teacherCloud.destroy();teacherCloud=null;teacherCloudRound=null;cloudReviewSignature=null}
  configTool();
  announce('Activity closed. Students are returning to the classroom home.');
  await refresh();
 }catch(err){announce(err.message,true);if(button)button.disabled=false}
}
async function controlRound(command){
 try{await request('control',{token:state.token,control:command,roundId:state.snapshot?.active?.id});await refresh();}
 catch(e){announce(e.message,true)}
}
function reviewCloudAnswers(answers,roundId){
 const target=$('cloud-review');if(!target)return;
 const rows=answers||[];
 const sig=roundId+'|'+rows.map(a=>[a.subject,a.revision,a.hidden,a.value].join(':')).join('|');
 if(sig===cloudReviewSignature)return;
 cloudReviewSignature=sig;
 target.innerHTML='<div class="cloud-review-heading"><h3>Review incoming words</h3><span class="pill grey">'+rows.length+' submissions</span></div>'+
 (rows.length?rows.map(a=>'<article class="answer-card"><div class="answer-meta" style="margin:0">'+
 '<span><strong>'+esc(a.value)+'</strong> · '+esc(a.name||'Student')+'</span>'+
 '<button class="secondary" type="button" data-cloud-subject="'+esc(a.subject)+'" data-hidden="'+a.hidden+'">'+
 (a.hidden?'Restore word':'Hide word')+'</button></div></article>').join(''):
 '<p class="small">Words will arrive as students submit them.</p>');
 target.querySelectorAll('[data-cloud-subject]').forEach(button=>button.onclick=async()=>{
  button.disabled=true;
  try{
   await request('moderate',{token:state.token,roundId,subject:button.dataset.cloudSubject,
     hidden:button.dataset.hidden!=='true'});
   cloudReviewSignature=null;
   await refresh();await teacherCloud?.refresh();
  }catch(err){announce(err.message,true);button.disabled=false}
 });
}
function renderTeacherCloud(snapshot){
 const round=snapshot.active;
 if(teacherCloudRound!==round.id||!teacherCloud||!$('cloud-live-mount')){
  teacherCloud?.destroy();teacherCloudRound=round.id;cloudReviewSignature=null;
  $('live-results').innerHTML='<div id="cloud-live-mount"></div><div id="cloud-review" class="cloud-review"></div>';
  teacherCloud=createLiveCloud($('cloud-live-mount'),{request,token:state.token,roundId:round.id,role:'teacher'});
 }
 reviewCloudAnswers(snapshot.answers,round.id);
}

function renderTeacher(snapshot){
 renderParticipationRoster(snapshot);
 if(state.tool==='evaluation'){
  evaluationTeacher?.update(snapshot);
  return;
 }
 $('participants-count').textContent=String(snapshot.participants??0);
 const round=snapshot.active;
 const matches=Boolean(round&&round.type===state.tool&&['poll','answers','cloud','timer'].includes(round.type));
 syncActivityTabs();
 if(state.tool==='whiteboard'){
  if(round?.type==='whiteboard')mountTeacherWhiteboard();
  return;
 }
 if(!matches){
  if(teacherCloud){teacherCloud.destroy();teacherCloud=null;teacherCloudRound=null;cloudReviewSignature=null}
  return;
 }
 $('results-kind').textContent=NAMES[round.type]+' · '+(round.status==='open'?'Live':'Closed');
 $('current-label').textContent=round.prompt||NAMES[round.type];
 $('round-status').textContent=round.status==='closed'?'Closed':'Receiving';
 $('round-status').className='pill '+(round.status==='open'?'':'grey');
 if(round.type==='cloud')renderTeacherCloud(snapshot);
 else{
  if(teacherCloud){teacherCloud.destroy();teacherCloud=null;teacherCloudRound=null;cloudReviewSignature=null}
  $('live-results').innerHTML=resultsHtml(snapshot);
 }
 $('round-actions').innerHTML=
   btn(round.revealed?'◉ Hide projected results':'◉ Reveal projected results','secondary','toggle-reveal')+
   btn('■ Close activity','danger','finish-activity');
 $('toggle-reveal').onclick=()=>controlRound(round.revealed?'hide':'reveal');
 $('finish-activity').onclick=finishActivity;
 document.querySelectorAll('[data-answer]').forEach(el=>el.onclick=async()=>{
   el.disabled=true;
   try{await request('moderate',{token:state.token,roundId:round.id,subject:el.dataset.answer,hidden:el.dataset.hidden!=='true'});await refresh();}
   catch(e){announce(e.message,true);el.disabled=false}
 });
 syncClock();
}

function studentShell(){
 state.studentTab='activities';state.shareLoaded=false;state.workImage=null;
 app.innerHTML='<section class="surface student-main unified-student">'+
  '<div class="headrow"><div><p class="eyebrow">Student classroom</p><h1>You are in Room '+esc(state.room)+'</h1><p>Everything you need is here. Switch tools without leaving your classroom.</p></div><span class="pill">● Connected</span></div>'+
  '<div class="student-engagement" id="student-engagement" aria-label="Your engagement score">'+
   '<div class="engagement-label"><strong>Engagement score</strong><span id="engagement-context">Participation, not grades</span></div>'+
   '<div class="engagement-value" id="engagement-score" aria-live="polite">0%</div>'+
   '<div class="engagement-track"><div id="engagement-meter" class="engagement-fill" style="width:0%;background:hsl(0 74% 44%)"></div></div>'+
   '<small id="engagement-details">0 of 0 question opportunities participated</small></div>'+
  '<nav class="student-tabs" role="tablist" aria-label="Student classroom tools">'+
  '<button type="button" role="tab" aria-selected="true" aria-controls="student-activities-panel" id="tab-activities" class="student-tab active" data-student-tab="activities"><span aria-hidden="true">▦</span><strong>Activities</strong></button>'+
  '<button type="button" role="tab" aria-selected="false" aria-controls="student-screen-panel" id="tab-screen" class="student-tab" data-student-tab="screen"><span aria-hidden="true">▣</span><strong>Screen Share</strong></button>'+
  '<button type="button" role="tab" aria-selected="false" aria-controls="student-work-panel" id="tab-work" class="student-tab" data-student-tab="work"><span aria-hidden="true">✎</span><strong>Share Work / Problem</strong></button>'+
  '</nav>'+
  '<div class="student-panel" role="tabpanel" id="student-activities-panel" aria-labelledby="tab-activities"><div id="student-work" class="student-activity">'+loading('Waiting for a question…')+'</div></div>'+
  '<div class="student-panel" role="tabpanel" id="student-screen-panel" aria-labelledby="tab-screen" hidden>'+
   '<div class="student-panel-intro"><h2>Share your application window</h2><p>Join the teacher’s sharing queue, then choose a window when you are approved. Switching tabs will not stop your capture. Use <strong>Stop sharing</strong> to end it.</p></div>'+
   '<iframe id="embedded-screen-share" title="Student screen-sharing controls" src="about:blank" loading="eager" allow="display-capture; fullscreen" referrerpolicy="no-referrer"></iframe>'+
  '</div>'+
  '<div class="student-panel" role="tabpanel" id="student-work-panel" aria-labelledby="tab-work" hidden>'+
   '<div class="student-panel-intro"><h2>Share your work or ask for help</h2><p>Send your solution, describe a problem or attach a screenshot. Your lecturer receives it in the same room.</p></div>'+
   '<form id="work-form" class="work-form">'+
    '<div class="work-type-group" role="group" aria-label="What are you sharing?">'+
    '<button type="button" class="work-type" id="work-problem" aria-pressed="true" data-work-kind="problem">I need help</button>'+
    '<button type="button" class="work-type" id="work-solution" aria-pressed="false" data-work-kind="solution">I have a solution</button>'+
    '</div>'+
    '<label for="work-topic">Topic or task <span class="small">(optional)</span></label><input id="work-topic" maxlength="120" placeholder="e.g. Task 3 · Analysis · My project">'+
    '<label for="work-note">Your explanation <span class="small">(optional if you add text or a screenshot)</span></label><textarea id="work-note" maxlength="1500" rows="3" placeholder="Describe your problem or explain what you achieved…"></textarea>'+
    '<label for="work-code">Code, calculation or supporting text <span class="small">(optional)</span></label><textarea id="work-code" maxlength="5000" rows="5" class="work-code" placeholder="Paste code, an error message, or your working…"></textarea>'+
    '<label for="work-file">Screenshot <span class="small">(optional · PNG, JPG or WebP)</span></label><input type="file" id="work-file" accept="image/png,image/jpeg,image/webp">'+
    '<div class="work-preview" id="work-preview" hidden><img id="work-thumbnail" alt="Your screenshot preview"><button id="work-remove-image" type="button" class="ghost">Remove screenshot</button></div>'+
    '<div class="buttons">'+btn('Send to lecturer →','primary','send-work','type="submit"')+'</div>'+
    '<p id="work-status" class="work-status" role="status" aria-live="polite">Your submission is visible only to the lecturer.</p>'+
   '</form>'+
  '</div>'+
  notices()+'</section>';
 document.querySelectorAll('[data-student-tab]').forEach(button=>button.addEventListener('click',()=>switchStudentTab(button.dataset.studentTab)));
 document.querySelectorAll('[data-work-kind]').forEach(button=>button.addEventListener('click',()=>{
  state.workKind=button.dataset.workKind;
  document.querySelectorAll('[data-work-kind]').forEach(x=>{const active=x.dataset.workKind===state.workKind;x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active))});
 }));
 $('embedded-screen-share').addEventListener('load',()=>{
  try{const field=$('embedded-screen-share').contentDocument?.getElementById('name');
   if(field&&!field.value)field.value=state.studentName||'';
  }catch{/* Keep sharing usable if embedding policy changes */}
 });
 $('work-file').onchange=onWorkFile;
 $('work-remove-image').onclick=()=>{state.workImage=null;$('work-file').value='';$('work-preview').hidden=true};
 $('work-form').onsubmit=submitStudentWork;
}
function switchStudentTab(tab){
 if(!['activities','screen','work'].includes(tab))return;
 state.studentTab=tab;
 for(const button of document.querySelectorAll('[data-student-tab]')){
  const active=button.dataset.studentTab===tab;button.classList.toggle('active',active);
  button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
 }
 for(const panel of ['activities','screen','work'])$('student-'+panel+'-panel').hidden=panel!==tab;
 if(tab==='screen'&&!state.shareLoaded){
  state.shareLoaded=true;
  try{sessionStorage.setItem('cia4103-share-profile',JSON.stringify({name:state.studentName||'Student'}))}catch{}
  $('embedded-screen-share').src='/live/?embed=1';
 }
}
async function onWorkFile(){
 const file=$('work-file').files?.[0];state.workImage=null;$('work-preview').hidden=true;
 if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){
  $('work-status').textContent='Choose a PNG, JPG or WebP image under 8 MB.';return;
 }
 try{
  const bmp=await createImageBitmap(file);
  if(bmp.width*bmp.height>20000000){bmp.close?.();throw Error('Screenshot is too large (20 megapixels maximum)')}
  let scale=Math.min(1,1250/bmp.width,1000/bmp.height),url=null;
  for(let i=0;i<4;i++){
   const c=document.createElement('canvas');c.width=Math.max(1,Math.round(bmp.width*scale));c.height=Math.max(1,Math.round(bmp.height*scale));
   c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
   const blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',0.76-i*.11));
   if(!blob)throw Error('Could not compress screenshot');
   url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Could not read screenshot'));reader.readAsDataURL(blob)});
   if(url.length<=440000)break;scale*=.75;url=null;
  }
  bmp.close?.();
  if(!url)throw Error('Screenshot remains too large. Crop it and retry');
  state.workImage=url;$('work-thumbnail').src=url;$('work-preview').hidden=false;
  $('work-status').textContent='Screenshot attached and compressed for your lecturer.';
 }catch(e){$('work-status').textContent=e.message}
}
async function submitStudentWork(e){
 e.preventDefault();
 const button=$('send-work');button.disabled=true;
 const payload={token:state.token,operation:'submit',kind:state.workKind,topic:$('work-topic').value.trim(),
   note:$('work-note').value.trim(),code:$('work-code').value.trim(),image:state.workImage};
 try{
  await request('work',payload);
  $('work-form').reset();state.workImage=null;$('work-preview').hidden=true;
  state.workKind='problem';
  document.querySelectorAll('[data-work-kind]').forEach(x=>{const active=x.dataset.workKind==='problem';x.classList.toggle('active',active);x.setAttribute('aria-pressed',String(active))});
  $('work-status').textContent='✓ Shared successfully! Your lecturer can now see it.';
  announce('Your work was sent to the lecturer.');
 }catch(err){$('work-status').textContent=err.message;announce(err.message,true)}
 finally{button.disabled=false}
}
async function loadStudentWork(force=false){
 if(state.role!=='teacher'||state.workFetchBusy)return;
 state.workFetchBusy=true;state.workLastFetch=Date.now();
 const container=$('teacher-work-list');if(!container)return;
 try{
  const result=await request('work',{token:state.token,operation:'list'});
  const next=result.items||[];
  const signature=next.map(x=>x.id+':'+x.submittedAt).join('|');
  if(!force&&signature===state.workSignature)return;
  state.workSignature=signature;state.workItems=next;
  if(state.snapshot&&state.tool==='work')renderParticipationRoster(state.snapshot);
  if(!state.workItems.length){container.innerHTML=noResults('Student solutions and problems will appear here.');return}
  container.innerHTML=state.workItems.map(item=>'<article class="answer-card work-card">'+
   '<div class="work-meta"><span class="pill '+(item.kind==='problem'?'warn':'')+'">'+(item.kind==='problem'?'Needs help':'Solution')+'</span> <span>'+esc(item.name)+' · '+esc(new Date(item.submittedAt).toLocaleTimeString())+'</span></div>'+
   (item.topic?'<h3>'+esc(item.topic)+'</h3>':'')+
   (item.note?'<div class="answer-text">'+esc(item.note)+'</div>':'')+
   (item.code?'<pre class="work-snippet">'+esc(item.code)+'</pre>':'')+
   (item.hasImage?'<div class="buttons">'+btn('View screenshot','secondary','', 'data-work-image="'+esc(item.id)+'"')+'</div><div id="work-image-'+esc(item.id)+'" class="work-image-view"></div>':'')+
   '</article>').join('');
  container.querySelectorAll('[data-work-image]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{
    const response=await request('work',{token:state.token,operation:'image',id:button.dataset.workImage});
    const target=$('work-image-'+button.dataset.workImage);target.replaceChildren();
    const img=document.createElement('img');img.src=response.image;img.alt='Student submitted screenshot';
    target.append(img);button.textContent='Screenshot loaded';
   }catch(e){announce(e.message,true);button.disabled=false}
  });
 }catch(e){container.innerHTML=noResults('Unable to load student work.');announce(e.message,true)}
 finally{state.workFetchBusy=false}
}

function updateEngagement(value){
 const node=$('engagement-score');if(!node)return;
 const percent=Math.max(0,Math.min(100,Number(value?.score)||0));
 const completed=Number(value?.participated)||0,total=Number(value?.opportunities)||0;
 node.textContent=percent+'%';
 const shade='hsl('+Math.round(percent*1.2)+' 72% 39%)';
 node.style.color=shade;
 const fill=$('engagement-meter');
 fill.style.width=percent+'%';fill.style.background=shade;
 $('engagement-details').textContent=completed+' of '+total+' question opportunities participated';
 $('engagement-context').textContent=total?'Participation, not answer accuracy':'Your score starts with the first question';
 $('student-engagement').setAttribute('aria-label','Your session engagement score '+percent+' percent');
}

function renderStudent(snapshot){
 updateEngagement(snapshot.engagement);
 const r=snapshot.active,area=$('student-work');
 if(r?.type==='evaluation'){
  if(state.lastStudentKey!=='evaluation:'+r.id||!evaluationStudent){
   evaluationStudent?.destroy();evaluationStudent=null;
   state.lastStudentKey='evaluation:'+r.id;
   if(state.studentTab!=='activities')switchStudentTab('activities');
   evaluationStudent=mountEvaluationStudent(area,{request,token:state.token,round:r,
    getOffset:()=>state.clockOffset});
  }
  evaluationStudent.update(snapshot);
  return;
 }
 if(evaluationStudent){evaluationStudent.destroy();evaluationStudent=null}

 if(r?.type==='whiteboard'){
  const key=r.id+':'+r.status;
  if(key!==state.lastStudentKey||!studentWhiteboard){
   if(studentWhiteboard){studentWhiteboard.destroy();studentWhiteboard=null}
   state.lastStudentKey=key;
   area.innerHTML='<div id="student-board-mount"></div>';
   studentWhiteboard=mountWhiteboard($('student-board-mount'),{request,token:state.token,role:'student'});
  }
  return;
 }
 if(studentWhiteboard){studentWhiteboard.destroy();studentWhiteboard=null}

 if(!r){
  const changed=state.lastStudentKey!==null;
  if(changed&&state.studentTab!=='activities')switchStudentTab('activities');
  state.lastStudentKey=null;
  if(changed||!area.querySelector('.student-activities-home')){
   area.innerHTML='<section class="student-activities-home">'+
    '<span class="student-home-icon" aria-hidden="true">▦</span>'+
    '<p class="eyebrow">Classroom home</p><h2>Ready for the next activity</h2>'+
    '<p>Your lecturer will start a question here. You can also use Screen Share or Share Work / Problem above.</p>'+
    '<span class="pill grey">Waiting for lecturer</span></section>';
  }
  return;
 }
 const key=r.id+':'+r.status;
 if(key!==state.lastStudentKey){
  state.lastStudentKey=key;
  let content='<p class="eyebrow">'+esc(r.type==='poll'?'Make your choice':r.type==='answers'?'Share your thoughts':r.type==='cloud'?'One word, one idea':'Time to focus')+'</p><h2>'+esc(NAMES[r.type])+'</h2>';
  if(r.prompt)content+='<p style="font-size:17px;margin:15px 0 23px">'+esc(r.prompt)+'</p>';
  if(r.type==='timer')content+=timerHtml(r.endsAt);
  else if(r.status==='closed')content+='<div class="notice show good">This activity is closed. Your responses are saved.</div>';
  else{
   if(r.type==='poll')content+=r.options.map((o,i)=>'<label class="choice"><input type="radio" name="student-vote" value="'+i+'"><span>'+esc(o)+'</span></label>').join('');
   else if(r.type==='cloud')content+='<label for="student-answer">Your word or short phrase</label><input type="text" id="student-answer" maxlength="40" enterkeyhint="send" autocomplete="off" placeholder="Type a word and press Enter…"><p class="small">Press Enter to send your word instantly.</p>';
   else content+='<label for="student-answer">Write a short answer</label><textarea id="student-answer" maxlength="500" placeholder="Your answer…"></textarea>';
   content+='<div class="buttons student-submit">'+btn('Submit '+(r.unit==='pair'?'pair answer':'answer')+' →','primary','submit-answer')+'</div>';
   if(r.unit==='pair')content+='<p class="small">Pair mode: the response is shared between members of your named pair.</p>';
  }
  content+='<div id="submitted-status"></div>';
  area.innerHTML=content;
  if(r.status==='open'&&r.type!=='timer'){
   $('submit-answer').onclick=submitAnswer;
   if(r.type==='cloud')$('student-answer').onkeydown=e=>{
    if(e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!$('submit-answer').disabled)void submitAnswer()}
   };
  }
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
 const button=$('submit-answer');if(!button||button.disabled)return;button.disabled=true;
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
 if(r?.type==='cloud'){
  if(displayCloudRound!==r.id||!displayCloud||!$('cloud-display-mount')){
   displayCloud?.destroy();displayCloudRound=r.id;
   $('display-work').innerHTML='<div id="cloud-display-mount"></div>';
   displayCloud=createLiveCloud($('cloud-display-mount'),{request,token:state.token,roundId:r.id,role:'display'});
  }
  return;
 }
 if(displayCloud){displayCloud.destroy();displayCloud=null;displayCloudRound=null}
 if(r?.type==='whiteboard'){
  if(r.id!==lastDisplayBoardId||!displayWhiteboard){
   if(displayWhiteboard){displayWhiteboard.destroy();displayWhiteboard=null}
   lastDisplayBoardId=r.id;
   $('display-work').innerHTML='<div id="display-board-mount"></div>';
   displayWhiteboard=mountWhiteboard($('display-board-mount'),{request,token:state.token,role:'display'});
  }
  return;
 }
 if(displayWhiteboard){displayWhiteboard.destroy();displayWhiteboard=null;lastDisplayBoardId=null}
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
  if(state.role==='teacher'){renderTeacher(snap);if(state.tool==='work'&&Date.now()-state.workLastFetch>5000)void loadStudentWork();}
  else if(state.role==='student')renderStudent(snap);
  else if(state.role==='display')renderDisplay(snap);
 }catch(e){
  if(epoch!==state.epoch)return;
  state.errors++;connected(false,'Reconnecting');
  if(state.errors===1||state.errors%4===0)announce(e.message,true);
  if(/expired|invalid|ended/i.test(e.message)){
    const oldRole=state.role;
    stopPolling();connected(false,'Session ended');
    if(oldRole==='teacher'){sessionStorage.removeItem('classroom-teacher');state.token=null;state.role=null;teacherForm();announce('Your classroom has ended. Start a new room to access your saved polls.',true);}
    else if(oldRole==='student'){sessionStorage.removeItem('classroom-student');state.token=null;state.role=null;joinForm();announce('This classroom has ended. Ask your lecturer for a new code.',true);}
   }
 }finally{state.busy=false}
}
function stopPolling(){
 evaluationTeacher?.destroy();evaluationTeacher=null;
 evaluationStudent?.destroy();evaluationStudent=null;evaluationStudentRound=null;
 teacherCloud?.destroy();teacherCloud=null;teacherCloudRound=null;
 displayCloud?.destroy();displayCloud=null;displayCloudRound=null;cloudReviewSignature=null;
 state.epoch++;if(state.pollTimer)clearTimeout(state.pollTimer);state.pollTimer=null}
function startPolling(){
 const epoch=state.epoch;
 const schedule=()=>{if(epoch!==state.epoch||!state.token)return;
   const rate=document.hidden?12000:state.role==='teacher'?1750:state.role==='display'?2000:2500;
   state.pollTimer=setTimeout(async()=>{await refresh();schedule()},Math.min(18000,rate*Math.max(1,state.errors)));
 };schedule();
}

window.addEventListener('message',event=>{
 if(event.origin!==location.origin||state.role!=='teacher'||!state.token)return;
 if(event.data?.type==='toolkit:web-ready'){
  const frame=$('teacher-web-frame');
  if(frame?.contentWindow===event.source)
   frame.contentWindow.postMessage({type:'toolkit:web-session',token:state.token},location.origin);
  return;
 }
 if(event.data?.type!=='toolkit:screen-ready')return;
 const frame=$('teacher-screen-frame');
 if(frame?.contentWindow!==event.source)return;
 frame.contentWindow.postMessage({type:'toolkit:lecturer-session',token:state.token},location.origin);
});

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
    state.role=role;state.room=saved.code;state.token=saved[key];state.displayToken=saved.displayToken||null;state.studentName=saved.name||'';
    shell();refresh();return true;
   }
  }catch{/* Invalid stored session */}
 }
 return false;
}
if(!restore()){if(new URLSearchParams(location.search).has('code'))joinForm();else welcome()}
