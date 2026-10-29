// Lecturer Collaborate tabs. Shared selection roster; independent screen,
// whiteboard, and per-student text-document controls.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'' :'&#39;'}[c]));
const TABS=[['screen','Screen Sharing'],['whiteboard','Whiteboard'],['document','Text Document']];
function randomOther(items,current){
 const candidates=items.length>1?items.filter(x=>x.id!==current):items;
 if(!candidates.length)return null;
 const values=new Uint32Array(1);crypto.getRandomValues(values);
 return candidates[values[0]%candidates.length];
}
export function mountCollaborate(root,{request,token,screenHost,getSnapshot,openBoard,mountBoard,unmountBoard,stopRound,onRefresh,onTabChange,initialTab='screen',notify}){
 let tab='screen',students=[],selectedId=null,connected=[],screenActive=null,templates=[],editing=null;
 let lastRosterKey='',lastDocKey='',savedKind='',loading=false;
 root.innerHTML='<section class="collab-root">'+
 '<nav class="collab-tabs" role="tablist" aria-label="Collaborate activities">'+
 TABS.map(([id,name])=>'<button type="button" role="tab" id="collab-tab-'+id+
 '" data-collab-tab="'+id+'" aria-selected="'+(id==='screen')+'">'+name+'</button>').join('')+'</nav>'+
 '<div class="collab-layout"><aside class="collab-roster" aria-label="Students in this classroom">'+
 '<div class="collab-side-title"><h3>Students</h3><span class="pill grey" id="collab-total">0</span></div>'+
 '<p id="collab-roster-note" class="small">Select a student or choose one randomly.</p>'+
 '<button type="button" class="collab-random" id="collab-random">🎲 Pick random student</button>'+
 '<div class="collab-list" id="collab-students" role="list"></div>'+
 '<div class="collab-selection" id="collab-selected" role="status" aria-live="polite">No student selected</div></aside>'+
 '<div class="collab-main">'+
 '<section id="collab-screen" class="collab-tab-panel" role="tabpanel" aria-labelledby="collab-tab-screen">'+
 '<div class="collab-stage-head"><div><strong>Student screen sharing</strong><p>Choose a connected student from the left. They approve window sharing on their device.</p></div>'+
 '<button type="button" class="danger" id="collab-stop-screen">■ Stop presenting</button></div>'+
 '<div id="collab-screen-slot"></div></section>'+
 '<section id="collab-whiteboard" class="collab-tab-panel" role="tabpanel" aria-labelledby="collab-tab-whiteboard" hidden>'+
 '<div class="collab-stage-head"><div><strong>Collaborative whiteboard</strong><p>You can always draw. The selected student can edit alongside you.</p></div>'+
 '<div class="collab-stage-actions"><button type="button" class="primary" id="collab-open-board">▶ Start whiteboard</button>'+
 '<button type="button" class="danger" id="collab-stop-board">■ Stop activity</button></div></div>'+
 '<div id="teacher-board-mount"></div></section>'+
 '<section id="collab-document" class="collab-tab-panel" role="tabpanel" aria-labelledby="collab-tab-document" hidden>'+
 '<div class="collab-stage-head"><div><strong>Text Document</strong><p>Prepare questions, then inspect the selected student’s answer blocks.</p></div>'+
 '<button type="button" class="danger" id="collab-stop-document" hidden>■ Stop activity</button></div>'+
 '<div id="collab-doc-prepare">'+
 '<form id="collab-doc-form" class="collab-doc-form">'+
 '<label for="collab-doc-title">Document title</label><input id="collab-doc-title" maxlength="100" required placeholder="e.g. Week 10 lab reflection">'+
 '<label for="collab-doc-questions">Prefilled questions (one per line, up to eight)</label>'+
 '<textarea id="collab-doc-questions" rows="5" maxlength="2200" required placeholder="Explain the solution you implemented.&#10;What did you find challenging?"></textarea>'+
 '<div class="collab-buttons"><button type="submit" class="primary" id="collab-doc-save">Save question document</button>'+
 '<button type="button" class="ghost" id="collab-doc-clear">New document</button></div></form>'+
 '<div class="collab-doc-bank-head"><h3>Saved documents</h3><button type="button" id="collab-doc-reload" class="secondary">↻ Refresh</button></div>'+
 '<div id="collab-doc-bank" class="collab-doc-bank"></div></div>'+
 '<section id="collab-doc-live" hidden><div id="collab-doc-status" class="collab-doc-status"></div>'+
 '<div id="collab-doc-answer-blocks" class="collab-doc-answer-blocks"></div></section>'+
 '</section></div></div></section>';
 const $=id=>root.querySelector('#'+id);
 const say=(msg,bad=false)=>{notify(msg,bad);$('collab-selected').textContent=msg;};
 function screenMessage(type,extra={}){
  const frame=screenHost?.querySelector('iframe');
  if(!frame?.contentWindow)return say('Screen Sharing is not connected yet.',true);
  frame.contentWindow.postMessage({type,...extra},location.origin);
 }
 function selected(){return students.find(s=>s.id===selectedId)||null}
 function updateRoster(force=false){
  const active=getSnapshot()?.active;
  const key=[tab,selectedId,active?.id,active?.type,
   students.map(s=>s.id+':'+s.name+':'+s.participated).join('|'),
   connected.map(s=>s.identity+':'+s.name+':'+s.presenting+':'+s.sharing).join('|')].join(':');
  if(!force&&lastRosterKey===key)return;lastRosterKey=key;
  $('collab-total').textContent=String(students.length);
  $('collab-random').disabled=!students.length;
  $('collab-roster-note').textContent=tab==='screen'?
   'Only students who joined the sharing queue can present. Others must open Screen Share first.':
   tab==='whiteboard'?'Select one writer alongside the lecturer.':'Select a student to inspect their submitted text answers.';
  const list=$('collab-students');
  list.innerHTML=students.length?students.map(s=>{
   const match=connected.filter(item=>item.name.trim().toLowerCase()===s.name.trim().toLowerCase());
   const online=tab==='screen'?match.length===1:tab==='whiteboard'?
     active?.type==='whiteboard'&&selectedId===s.id:
     active?.type==='text-document'&&Boolean(s.participated);
   const label=tab==='screen'?(match.length===1?(match[0].presenting?'Presenting':'In sharing queue'):'Not in sharing queue'):
     tab==='whiteboard'?(selectedId===s.id&&active?.type==='whiteboard'?'Can write':'View only'):
     (active?.type==='text-document'?(s.participated?'Submitted':'Not submitted'):'No document live');
   return '<button type="button" class="collab-person'+(selectedId===s.id?' chosen':'')+
    '" data-collab-id="'+esc(s.id)+'" aria-pressed="'+String(selectedId===s.id)+'">'+
    '<span class="collab-avatar" aria-hidden="true">'+esc(s.name.charAt(0).toUpperCase())+'</span>'+
    '<span class="collab-person-name"><strong>'+esc(s.name)+'</strong>'+
    '<small>'+esc(label)+'</small></span><span class="collab-person-state'+(online?' on':'')+
    '" aria-hidden="true">'+(online?'●':'○')+'</span></button>';
  }).join(''):'<p class="small">No students have joined this classroom.</p>';
  list.querySelectorAll('[data-collab-id]').forEach(b=>b.onclick=()=>choose(b.dataset.collabId));
 }
 async function choose(id){
  selectedId=id;updateRoster(true);
  const student=selected();
  if(!student)return;
  if(tab==='document'){say('Showing '+student.name+'’s answers.');updateDocument(true);return}
  if(tab==='whiteboard'){
   if(getSnapshot()?.active?.type!=='whiteboard')
     return say('Selected '+student.name+'. Start Whiteboard to grant writing permission.');
   try{
    await request('board',{token,operation:'select',studentId:id});
    say(student.name+' can now write on the Whiteboard.');
    await onRefresh();
   }catch(e){say(e.message,true)}
   return;
  }
  const matches=connected.filter(p=>p.name.trim().toLowerCase()===student.name.trim().toLowerCase());
  if(matches.length!==1)return say(matches.length?'Duplicate names in queue. Use the internal queue to disambiguate.':
    student.name+' must join Screen Share before presenting.',true);
  screenMessage('toolkit:collab-present',{identity:matches[0].identity});
  say('Selecting '+student.name+' as presenter…');
 }
 async function random(){
  const pool=tab==='screen'?students.filter(s=>connected.some(p=>p.name.trim().toLowerCase()===s.name.trim().toLowerCase())):students;
  if(!pool.length)return say(tab==='screen'?'No students are connected to Screen Share yet.':'No students have joined yet.',true);
  if(tab==='screen'){
   // The server chooses fairly among the connected LiveKit participants,
   // avoiding identity/name ambiguity and enforcing the approval lock.
   screenMessage('toolkit:collab-random');
   say('Selecting a random connected presenter…');return;
  }
  const winner=randomOther(pool,selectedId);
  if(!winner)return;
  await choose(winner.id);
 }
 function tabTo(id){
  if(!TABS.some(x=>x[0]===id))return;
  tab=id;
  for(const [name] of TABS){
   $('collab-'+name).hidden=name!==id;
   $('collab-tab-'+name).setAttribute('aria-selected',String(name===id));
  }
  screenHost.hidden=id!=='screen';
  updateRoster(true);
  if(id==='document')void loadDocuments();
  if(id==='whiteboard'&&getSnapshot()?.active?.type==='whiteboard')mountBoard();
  onTabChange(id);
 }
 async function loadDocuments(){
  try{const data=await request('document-bank',{token,operation:'list'});
   templates=data.items||[];drawBank();
  }catch(e){say(e.message,true)}
 }
 function drawBank(){
  const list=$('collab-doc-bank');
  list.innerHTML=templates.length?templates.map(doc=>
   '<article class="collab-saved-document"><div><strong>'+esc(doc.title)+'</strong><small>'+
   doc.questions.length+' questions</small></div><div class="collab-buttons">'+
   '<button type="button" class="primary" data-doc-launch="'+doc.id+'">Launch</button>'+
   '<button type="button" class="secondary" data-doc-edit="'+doc.id+'">Edit</button>'+
   '<button type="button" class="ghost" data-doc-delete="'+doc.id+'">Delete</button></div></article>').join(''):
   '<p class="small">No saved documents yet. Create one above and use Launch during class.</p>';
  list.querySelectorAll('[data-doc-launch]').forEach(b=>b.onclick=()=>launchDocument(b.dataset.docLaunch));
  list.querySelectorAll('[data-doc-edit]').forEach(b=>b.onclick=()=>{
   const doc=templates.find(x=>x.id===b.dataset.docEdit);if(!doc)return;
   editing=doc;$('collab-doc-title').value=doc.title;
   $('collab-doc-questions').value=doc.questions.join('\n');
   $('collab-doc-save').textContent='Update document';
  });
  list.querySelectorAll('[data-doc-delete]').forEach(b=>b.onclick=async()=>{
   const doc=templates.find(x=>x.id===b.dataset.docDelete);
   if(!doc||!confirm('Delete '+doc.title+'?'))return;
   try{await request('document-bank',{token,operation:'delete',id:doc.id});
    if(editing?.id===doc.id)clearForm();await loadDocuments();say('Document deleted.');
   }catch(e){say(e.message,true)}
  });
 }
 function clearForm(){editing=null;$('collab-doc-form').reset();$('collab-doc-save').textContent='Save question document'}
 async function save(event){
  event.preventDefault();
  if(loading)return;
  const questions=$('collab-doc-questions').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(questions.length<1||questions.length>8)return say('Enter 1–8 questions, one per line.',true);
  loading=true;$('collab-doc-save').disabled=true;
  try{await request('document-bank',{token,operation:'save',item:{
    title:$('collab-doc-title').value.trim(),questions},
    ...(editing?{id:editing.id,revision:editing.revision}:{})});
   clearForm();await loadDocuments();say('Document saved for future classes.');
  }catch(e){say(e.message,true)}finally{loading=false;$('collab-doc-save').disabled=false}
 }
 async function launchDocument(id){
  try{
   const result=await request('document-start',{token,id});
   selectedId=null;lastDocKey='';say('Text Document is live for students.');
   await onRefresh();
   update({...(getSnapshot()||{}),active:result.active,answers:[]});
  }catch(e){say(e.message,true)}
 }
 function updateDocument(force=false){
  const snapshot=getSnapshot(),round=snapshot?.active;
  const active=round?.type==='text-document';
  $('collab-doc-prepare').hidden=active;
  $('collab-doc-live').hidden=!active;
  $('collab-stop-document').hidden=!active;
  if(!active){lastDocKey='';return}
  const records=snapshot.answers||[],chosen=selected();
  const item=records.find(a=>a.subject===selectedId);
  const key=[round.id,selectedId,item?.revision||0,records.length].join(':');
  if(!force&&key===lastDocKey)return;
  lastDocKey=key;
  $('collab-doc-status').textContent=round.prompt+' · '+records.length+' submission(s) · '+
   (chosen? 'Showing '+chosen.name:'Select a student on the left to inspect their answers');
  $('collab-doc-answer-blocks').innerHTML=round.questions.map((q,i)=>
   '<article class="collab-doc-answer"><h3>Question '+(i+1)+'</h3><p>'+esc(q)+'</p>'+
   '<div class="collab-answer-text">'+(item?esc(item.value?.[i]||'(No answer)'):
     'Select a student to view their submitted response')+'</div></article>').join('');
 }
 function update(snapshot){
  students=Array.isArray(snapshot?.students)?snapshot.students:[];
  if(selectedId&&!students.some(s=>s.id===selectedId))selectedId=null;
  const active=snapshot?.active;
  $('collab-open-board').disabled=active?.type==='whiteboard';
  $('collab-stop-board').disabled=active?.type!=='whiteboard';
  $('collab-stop-board').hidden=active?.type!=='whiteboard';
  if(active?.type!=='whiteboard'){unmountBoard();$('teacher-board-mount').replaceChildren()}
  else if(tab==='whiteboard')mountBoard();
  updateRoster();if(tab==='document')updateDocument();
 }
 function screenQueue(data){
  connected=Array.isArray(data?.items)?data.items.filter(x=>typeof x.identity==='string'&&typeof x.name==='string'):[];
  screenActive=data?.active||null;
  if(data?.selectedName){
   const chosen=students.filter(s=>s.name.trim().toLowerCase()===data.selectedName.trim().toLowerCase());
   if(chosen.length===1)selectedId=chosen[0].id;
  }
  updateRoster(true);
 }
 $('collab-random').onclick=random;
 $('collab-open-board').onclick=async()=>{try{await openBoard();await onRefresh();update(getSnapshot());}
   catch(e){say(e.message,true)}};
 $('collab-stop-board').onclick=stopRound;
 $('collab-stop-document').onclick=stopRound;
 $('collab-stop-screen').onclick=()=>screenMessage('toolkit:collab-stop');
 $('collab-doc-form').onsubmit=save;
 $('collab-doc-clear').onclick=clearForm;
 $('collab-doc-reload').onclick=loadDocuments;
 root.querySelectorAll('[data-collab-tab]').forEach(b=>b.onclick=()=>tabTo(b.dataset.collabTab));
 $('collab-screen-slot').appendChild(screenHost);
 tabTo(initialTab);
 return {update,screenQueue,tab:()=>tab,destroy(){
  const parent=root.closest('.surface');
  // Never destroy the connected LiveKit iframe while switching teaching tools.
  if(parent&&screenHost){parent.appendChild(screenHost);screenHost.hidden=true}
  root.replaceChildren();
 }};
}
export function mountTextDocumentStudent(root,{request,token,round,notify}){
 let current=round,revision=0,dirty=false,submitting=false;
 const questions=round.questions||[];
 root.innerHTML='<section class="doc-student">'+
 '<p class="eyebrow">COLLABORATE · TEXT DOCUMENT</p><h2>'+esc(round.prompt)+'</h2>'+
 '<p>Answer the questions below, then submit your document. You can revise while the activity is open.</p>'+
 '<form id="student-document-form">'+questions.map((q,i)=>
  '<div class="doc-student-question"><label for="doc-answer-'+i+'"><strong>Question '+(i+1)+'</strong> · '+esc(q)+'</label>'+
  '<textarea id="doc-answer-'+i+'" data-doc-answer="'+i+'" maxlength="1200" rows="4" placeholder="Type your answer here…"></textarea></div>').join('')+
  '<button type="submit" class="primary" id="student-document-submit">Submit my document →</button></form>'+
  '<p id="student-document-status" role="status" aria-live="polite"></p></section>';
 const $=id=>root.querySelector('#'+id);
 const inputs=()=>[...root.querySelectorAll('[data-doc-answer]')];
 inputs().forEach(el=>el.addEventListener('input',()=>{dirty=true}));
 $('student-document-form').onsubmit=async e=>{
  e.preventDefault();if(submitting||current.status!=='open')return;
  const value=inputs().map(el=>el.value.trim());
  if(!value.some(Boolean)){notify('Answer at least one question before submitting.',true);return}
  submitting=true;$('student-document-submit').disabled=true;
  try{
   const result=await request('submit',{token,roundId:current.id,value,revision});
   revision=result.revision;dirty=false;
   $('student-document-status').textContent='✓ Your answers have been submitted. You may update them before the lecturer closes the activity.';
   notify('Document submitted to your lecturer.');
  }catch(error){notify(error.message,true)}
  finally{submitting=false;$('student-document-submit').disabled=current.status!=='open'}
 };
 function update(snapshot){
  if(snapshot.active?.id!==current.id)return;
  current=snapshot.active;
  if(snapshot.mine&&snapshot.mine.revision>revision){
   revision=snapshot.mine.revision;
   if(!dirty)inputs().forEach((el,i)=>{el.value=snapshot.mine.value[i]||''});
   $('student-document-status').textContent='✓ Submitted successfully · Revision '+revision;
  }
  const disabled=current.status!=='open';
  inputs().forEach(x=>{x.disabled=disabled});
  $('student-document-submit').disabled=disabled||submitting;
  if(disabled)$('student-document-status').textContent='The lecturer has closed this document.';
 }
 return {update,destroy(){root.replaceChildren()}};
}
