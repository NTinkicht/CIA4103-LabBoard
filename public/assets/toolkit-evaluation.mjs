// Lecturer question bank and timed evaluation runner.
// Both tabs use the existing lecturer-only student participation column.
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const kinds=['jumbled','mcq'];
const label={jumbled:'Jumbled Questions',mcq:'MCQs'};
const clock=(end,offset)=>{const left=Math.max(0,Math.ceil((end-Date.now()-offset)/1000));return Math.floor(left/60).toString().padStart(2,'0')+':'+String(left%60).padStart(2,'0')};
function row(title,text,buttons=''){return '<article class="eval-saved-row"><div class="eval-saved-info"><strong>'+escape(title)+'</strong><small>'+escape(text)+'</small></div><div class="eval-saved-actions">'+buttons+'</div></article>'}
export function mountEvaluationLecturer(root,{request,token,onChange,onFinish,getOffset}){
 let kind='jumbled',banks={jumbled:[],mcq:[]},editing=null,current=null,duration={jumbled:60,mcq:60},loading=false,signature='',timer=null;
 root.innerHTML='<section class="eval-teacher">'+
 '<nav class="eval-tabs" role="tablist" aria-label="Evaluation question types">'+
 '<button id="eval-jumbled-tab" role="tab" aria-selected="true" type="button">Jumbled Questions</button>'+
 '<button id="eval-mcq-tab" role="tab" aria-selected="false" type="button">MCQs</button></nav>'+
 '<div class="eval-question-screen" id="eval-prepare">'+
 '<div class="eval-intro"><h2>Prepare evaluation questions</h2><p>Save questions before class, then launch any saved question with your chosen duration.</p></div>'+
 '<div class="eval-forms"><form id="eval-form">'+
 '<label for="eval-title">Question name</label><input id="eval-title" maxlength="100" required placeholder="e.g. Order the 5E phases">'+
 '<label for="eval-prompt">Question shown to students</label><textarea id="eval-prompt" maxlength="240" rows="2" required placeholder="Arrange the following steps in the correct order"></textarea>'+
 '<label for="eval-items" id="eval-items-label">Correct order — one step per line</label><textarea id="eval-items" rows="6" required placeholder="Engage&#10;Explore&#10;Explain&#10;Extend&#10;Evaluate"></textarea>'+
 '<div id="eval-correct-wrap" hidden><label for="eval-correct">Correct MCQ option</label><select id="eval-correct">'+
 Array.from({length:6},(_,i)=>'<option value="'+i+'">Option '+(i+1)+'</option>').join('')+'</select></div>'+
 '<div class="eval-form-actions"><button type="submit" class="primary" id="eval-save">Save question</button>'+
 '<button type="button" class="ghost" id="eval-new">Clear form</button></div>'+
 '</form><aside class="eval-launch-settings"><h3>Launch settings</h3>'+
 '<label for="eval-duration">Duration in seconds</label><input id="eval-duration" type="number" min="10" max="3600" step="1" value="60">'+
 '<p>Students see a countdown. Submissions close automatically at zero.</p>'+
 '<div class="eval-launch-tip">Choose <strong>Launch</strong> beside a saved question to start it immediately.</div></aside></div>'+
 '<div class="eval-bank-head"><h3>Saved questions</h3><button type="button" class="secondary" id="eval-refresh">↻ Refresh bank</button></div>'+
 '<div id="eval-bank" class="eval-bank" aria-live="polite">Loading saved questions…</div></div>'+
 '<section id="eval-live" class="eval-live" hidden aria-label="Timed evaluation results">'+
 '<div class="eval-live-top"><div><p class="eyebrow">LIVE EVALUATION</p><h2 id="eval-live-title"></h2><p id="eval-live-prompt"></p></div>'+
 '<div class="eval-clock-wrap"><strong class="eval-clock" id="eval-clock">00:00</strong><small id="eval-clock-status">Accepting answers</small></div></div>'+
 '<div class="eval-summary" id="eval-summary">Waiting for student submissions…</div>'+
 '<div id="eval-answers" class="eval-answers"></div>'+
 '<div class="eval-live-actions"><button type="button" id="eval-reveal" class="primary" disabled>Reveal correct answers</button>'+
 '<button type="button" id="eval-close" class="danger">Close activity</button></div>'+
 '<div id="eval-correct-result" class="eval-correct-result" hidden></div></section>'+
 '</section>';
 const $=id=>root.querySelector('#'+id);
 const notice=(msg,bad=false)=>{const n=$('eval-message')||document.createElement('div');n.id='eval-message';n.className='eval-message'+(bad?' error':'');n.textContent=msg;if(!n.parentElement)root.prepend(n)};
 const durationValue=()=>Number($('eval-duration').value);
 function tab(next){
  if(!kinds.includes(next))return;
  duration[kind]=durationValue();kind=next;editing=null;signature='';
  $('eval-duration').value=String(duration[kind]);
  $('eval-items-label').textContent=next==='mcq'?'Answer options — one choice per line':'Correct order — one step per line';
  $('eval-items').placeholder=next==='mcq'?'Option A\nOption B\nOption C\nOption D':'First step\nSecond step\nThird step';
  $('eval-correct-wrap').hidden=next!=='mcq';
  $('eval-jumbled-tab').setAttribute('aria-selected',String(next==='jumbled'));
  $('eval-mcq-tab').setAttribute('aria-selected',String(next==='mcq'));
  $('eval-form').reset();$('eval-duration').value=String(duration[next]);
  update(current);renderBank();void loadBank();
  onChange(kind);
 }
 async function loadBank(){
  try{const data=await request('evaluation-bank',{token,operation:'list',kind});
   banks[kind]=data.items||[];renderBank();
  }catch(err){notice(err.message,true)}
 }
 function renderBank(){
  const list=$('eval-bank');
  const entries=banks[kind]||[];
  list.innerHTML=entries.length?entries.map(q=>row(q.title,q.prompt,
    '<button type="button" class="primary" data-eval-launch="'+q.id+'">Launch</button>'+
    '<button type="button" class="secondary" data-eval-edit="'+q.id+'">Edit</button>'+
    '<button type="button" class="ghost" data-eval-delete="'+q.id+'">Delete</button>')).join(''):
    '<p class="eval-empty">No saved questions in '+label[kind]+'. Prepare your first question above.</p>';
  list.querySelectorAll('[data-eval-launch]').forEach(b=>b.onclick=()=>launch(b.dataset.evalLaunch));
  list.querySelectorAll('[data-eval-edit]').forEach(b=>b.onclick=()=>{
   const q=entries.find(q=>q.id===b.dataset.evalEdit);if(!q)return;
   editing=q;$('eval-title').value=q.title;$('eval-prompt').value=q.prompt;
   $('eval-items').value=(kind==='mcq'?q.options:q.steps).join('\n');
   $('eval-correct').value=String(q.correct||0);
   $('eval-save').textContent='Update saved question';
   $('eval-title').focus();
  });
  list.querySelectorAll('[data-eval-delete]').forEach(b=>b.onclick=async()=>{
   const q=entries.find(q=>q.id===b.dataset.evalDelete);
   if(!q||!confirm('Delete saved question "'+q.title+'"?'))return;
   try{await request('evaluation-bank',{token,operation:'delete',kind,id:q.id});
    if(editing?.id===q.id)clearForm();await loadBank();notice('Question removed.');
   }catch(err){notice(err.message,true)}
  });
 }
 function clearForm(){
  editing=null;$('eval-form').reset();$('eval-save').textContent='Save question';
  $('eval-duration').value=String(duration[kind]);$('eval-title').focus();
 }
 async function save(event){
  event.preventDefault();
  if(loading)return;
  const items=$('eval-items').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const item={title:$('eval-title').value.trim(),prompt:$('eval-prompt').value.trim(),kind,
    ...(kind==='mcq'?{options:items,correct:Number($('eval-correct').value)}:{steps:items})};
  if(items.length<2||(kind==='mcq'&&items.length>6)||(kind==='jumbled'&&items.length>10)){
   notice(kind==='mcq'?'Provide 2–6 choices.':'Provide 2–10 steps in correct order.',true);return;
  }
  loading=true;$('eval-save').disabled=true;
  try{
   await request('evaluation-bank',{token,operation:'save',kind,item,
     ...(editing?{id:editing.id,revision:editing.revision}:{} )});
   clearForm();await loadBank();notice('Question saved. Ready to launch when you need it.');
  }catch(err){notice(err.message,true)}
  finally{loading=false;$('eval-save').disabled=false}
 }
 async function launch(id){
  const seconds=durationValue();
  if(!Number.isInteger(seconds)||seconds<10||seconds>3600){notice('Choose a duration between 10 and 3600 seconds.',true);return}
  if(current?.active?.type==='evaluation'&&current.active.status==='open'&&Date.now()<current.active.endsAt){
   if(!confirm('Replace the currently active question with this one?'))return;
  }
  try{
   const result=await request('evaluation-start',{token,kind,id,duration:seconds});
   current={...(current||{}),active:result.active,answers:[]};
   update(current);onChange(kind);
   window.scrollTo({top:0,behavior:'instant'});
   notice('Timed question is live on student screens.');
  }catch(err){notice(err.message,true)}
 }
 async function reveal(){
  const r=current?.active;
  if(!r||r.status==='open'&&Date.now()<r.endsAt)return;
  $('eval-reveal').disabled=true;
  try{await request('control',{token,roundId:r.id,control:'evaluation-reveal'});
   // Force a new snapshot from caller on its regular refresh; explicit
   // local refresh makes answers appear without waiting for the next poll.
   onChange(kind,true);
  }catch(err){notice(err.message,true);$('eval-reveal').disabled=false}
 }
 function update(snapshot){
  current=snapshot;
  const r=snapshot?.active,matching=r?.type==='evaluation'&&r.evalKind===kind;
  $('eval-live').hidden=!matching;$('eval-prepare').hidden=matching;
  if(!matching)return;
  $('eval-live-title').textContent=r.title||label[kind];
  $('eval-live-prompt').textContent=r.prompt;
  const records=snapshot.answers||[], students=snapshot.students||[];
  const submitted=students.filter(s=>s.participated).length;
  const remaining=Date.now()+getOffset()<r.endsAt&&r.status==='open';
  $('eval-summary').textContent=submitted+' of '+students.length+' students participated';
  const mark=r.correctAnswer!==undefined;
  const key=[r.id,r.revealed,records.map(a=>a.subject+':'+a.revision).join('|'),mark].join(':');
  if(key!==signature){
   signature=key;
   $('eval-answers').innerHTML=records.length?records.map(a=>{
    const value=r.evalKind==='mcq'?r.options[a.value]:(Array.isArray(a.value)?a.value.map(id=>r.tiles.find(t=>t.id===id)?.text||'').join(' → '):'');
    const correct=mark?(r.evalKind==='mcq'?a.value===r.correctAnswer:
      a.value?.every((id,i)=>id===r.correctIds[i])):null;
    return '<article class="eval-answer-row"><strong>'+escape(a.name||'Student')+'</strong><span>'+
      (mark?(correct?'✓ Correct':'✕ Incorrect'):'✓ Submitted')+'</span><small>'+escape(value)+'</small></article>';
   }).join(''):'<p class="eval-empty">Waiting for the first answer.</p>';
  }
  $('eval-correct-result').hidden=!mark;
  if(mark){
   $('eval-correct-result').textContent=r.evalKind==='mcq'?
    'Correct answer: '+r.options[r.correctAnswer]:
    'Correct order: '+r.correctAnswer.join(' → ');
  }
  tick();
 }
 function tick(){
  const r=current?.active;
  if(r?.type!=='evaluation'||r.evalKind!==kind)return;
  const remaining=r.status==='open'&&Date.now()+getOffset()<r.endsAt;
  $('eval-clock').textContent=clock(r.endsAt,getOffset());
  $('eval-clock-status').textContent=remaining?'Students can submit':'Time ended · submissions locked';
  $('eval-reveal').hidden=!!r.revealed;
  $('eval-reveal').disabled=remaining||!!r.revealed;
 }
 $('eval-jumbled-tab').onclick=()=>tab('jumbled');
 $('eval-mcq-tab').onclick=()=>tab('mcq');
 $('eval-form').onsubmit=save;
 $('eval-new').onclick=clearForm;
 $('eval-refresh').onclick=loadBank;
 $('eval-duration').onchange=()=>{duration[kind]=durationValue()};
 $('eval-reveal').onclick=reveal;
 $('eval-close').onclick=onFinish;
 void loadBank();
 timer=setInterval(tick,400);
 return {update,kind:()=>kind,destroy(){clearInterval(timer);root.replaceChildren()}};
}
export function mountEvaluationStudent(root,{request,token,round,getOffset}){
 let answer=[],submitted=false,loading=false,current=round,timer=null,revision=0;
 const isJumbled=round.evalKind==='jumbled';
 root.innerHTML='<section class="eval-student">'+
 '<p class="eyebrow">TIMED EVALUATION · '+(isJumbled?'JUMBLED QUESTIONS':'MCQ')+'</p>'+
 '<div class="eval-student-head"><h2>'+escape(round.prompt)+'</h2>'+
 '<div class="eval-clock-wrap"><strong class="eval-clock" id="student-eval-clock">00:00</strong>'+
 '<small id="student-eval-deadline">Time remaining</small></div></div>'+
 (isJumbled?'<p>Tap the tiles in the correct order. Use Undo or Reset to change your sequence.</p>'+
  '<div class="eval-ordered" id="eval-ordered" aria-label="Your chosen order"></div>'+
  '<div class="eval-tiles" id="eval-tiles" aria-label="Available shuffled tiles"></div>'+
  '<div class="eval-undo-actions"><button type="button" id="eval-undo" class="secondary">Undo last</button>'+
  '<button type="button" id="eval-reset" class="ghost">Reset</button></div>':
  '<fieldset class="eval-mcq-choices"><legend>Choose the best answer</legend>'+
   round.options.map((t,i)=>'<label class="choice"><input type="radio" name="eval-choice" value="'+i+'"><span>'+escape(t)+'</span></label>').join('')+'</fieldset>')+
 '<button type="button" class="primary" id="student-eval-submit">Submit answer →</button>'+
 '<div id="student-eval-status" class="eval-student-status" role="status" aria-live="polite"></div>'+
 '<div id="student-eval-correct" class="eval-correct-result" hidden></div>'+
 '</section>';
 const $=id=>root.querySelector('#'+id);
 const status=(msg,bad=false)=>{const n=$('student-eval-status');n.textContent=msg;n.classList.toggle('error',bad)};
 function drawTiles(){
  if(!isJumbled)return;
  const used=new Set(answer);
  $('eval-ordered').innerHTML=answer.map((id,i)=>{
   const tile=current.tiles.find(t=>t.id===id);
   return '<span class="eval-ordered-tile">'+(i+1)+'. '+escape(tile?.text||'')+'</span>';
  }).join('')||'<p>Select the first tile below…</p>';
  $('eval-tiles').innerHTML=current.tiles.filter(t=>!used.has(t.id)).map(t=>
   '<button type="button" class="eval-tile" data-tile="'+escape(t.id)+'">'+escape(t.text)+'</button>').join('')||
   '<p class="small">All tiles are selected.</p>';
  $('eval-tiles').querySelectorAll('[data-tile]').forEach(b=>b.onclick=()=>{
   if(locked())return;answer.push(b.dataset.tile);drawTiles();
  });
 }
 function locked(){return current.status!=='open'||Date.now()+getOffset()>=current.endsAt}
 function tick(){
  $('student-eval-clock').textContent=clock(current.endsAt,getOffset());
  const closed=locked(),reveal=current.correctAnswer!==undefined;
  $('student-eval-deadline').textContent=closed?'Time ended':'Time remaining';
  $('student-eval-submit').disabled=closed||loading;
  if(isJumbled){
   $('eval-undo').disabled=closed;$('eval-reset').disabled=closed;
   $('eval-tiles').querySelectorAll('button').forEach(b=>b.disabled=closed);
  }else root.querySelectorAll('input[name="eval-choice"]').forEach(b=>b.disabled=closed);
  const revealEl=$('student-eval-correct');revealEl.hidden=!reveal;
  if(reveal){
   revealEl.textContent=isJumbled?'Correct order: '+current.correctAnswer.join(' → '):
     'Correct answer: '+current.options[current.correctAnswer];
  }
  if(closed&&!submitted&&!reveal)status('Time ended. Your latest submitted answer, if any, is saved.');
 }
 async function submit(){
  if(locked()||loading)return;
  const value=isJumbled?[...answer]:Number(root.querySelector('input[name="eval-choice"]:checked')?.value);
  if(isJumbled&&value.length!==current.tiles.length)return status('Arrange every tile before submitting.',true);
  if(!isJumbled&&!Number.isInteger(value))return status('Choose an option.',true);
  loading=true;$('student-eval-submit').disabled=true;
  try{
   const result=await request('submit',{token,roundId:current.id,value,revision});
   revision=result.revision;submitted=true;
   status('✓ Answer submitted. Your participation counts toward your engagement score.');
  }catch(err){status(err.message,true)}
  finally{loading=false;tick()}
 }
 function update(snapshot){
  if(snapshot.active?.id!==current.id)return;
  current=snapshot.active;
  const mine=snapshot.mine;
  if(mine&&mine.revision>revision){
   revision=mine.revision;submitted=true;
   if(isJumbled){answer=Array.isArray(mine.value)?[...mine.value]:[];drawTiles()}
   else{
    const input=root.querySelector('input[name="eval-choice"][value="'+mine.value+'"]');
    if(input)input.checked=true;
   }
   status('✓ Your answer is submitted.');
  }
  tick();
 }
 if(isJumbled){
  $('eval-undo').onclick=()=>{if(!locked()){answer.pop();drawTiles()}};
  $('eval-reset').onclick=()=>{if(!locked()){answer=[];drawTiles()}};
  drawTiles();
 }
 $('student-eval-submit').onclick=submit;
 timer=setInterval(tick,400);tick();
 return {update,destroy(){clearInterval(timer);root.replaceChildren()}};
}
