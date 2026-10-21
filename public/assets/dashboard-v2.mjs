import{LABS}from'./checker.mjs';
import{renderCode}from'./highlight.mjs';
const $=id=>document.getElementById(id);const titles=Object.fromEntries(LABS.map(l=>[l.id,`${l.label} · ${l.title}`]));
let posts=[],allPosts=[],busy=false,revealed=false,current=null,lastSuccess=0;
// Dismissal is browser-only: with no authentication, server-side dismissal would be public.
const DISMISSED_KEY='cia4103-lab09-lecturer-dismissed-v1';
function loadDismissed(){
 try{const saved=JSON.parse(localStorage.getItem(DISMISSED_KEY)||'[]');return new Set(Array.isArray(saved)?saved.filter(id=>typeof id==='string'&&id.length<100).slice(-2000):[]);}
 catch{return new Set();}
}
const dismissed=loadDismissed();
let showDismissed=false,canPersistDismissals=true;
function saveDismissed(){
 try{localStorage.setItem(DISMISSED_KEY,JSON.stringify([...dismissed].slice(-2000)));canPersistDismissals=true;}
 catch{canPersistDismissals=false;}
}
function setDismissed(id,hidden){
 if(hidden)dismissed.add(id);else dismissed.delete(id);
 saveDismissed();
 if(current?.id===id)close();
 update();
}
// Build the filter from actual student submissions; no hard-coded lab list.
function populateActivities(){
 const select=$('part'),choice=select.value;
 const values=[...new Set(allPosts.map(x=>x.part).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
 select.replaceChildren(new Option('All activities','all'));
 values.forEach(v=>select.add(new Option(titles[v]||v,v)));
 select.value=values.includes(choice)?choice:'all';
}
function filterActivities(){
 const selection=$('part').value;
 posts=allPosts.filter(p=>selection==='all'||p.part===selection);
 update();
}
function update(){
 const visible=posts.filter(p=>dismissed.has(p.id)===showDismissed);
 const archived=posts.filter(p=>dismissed.has(p.id)).length;
 $('total').textContent=visible.length;$('help-count').textContent=visible.filter(p=>p.type==='help').length;$('display-count').textContent=visible.filter(p=>p.type==='display').length;
 $('dismissed-count').textContent=archived;
 $('view-label').textContent=showDismissed?'Dismissed submissions':'Active submissions';
 $('show-dismissed').textContent=showDismissed?'← Back to active':'Show dismissed ('+archived+')';
 $('show-dismissed').setAttribute('aria-pressed',String(showDismissed));
 $('dismiss-note').textContent=canPersistDismissals?'Dismissals are saved only in this browser. The original posts remain available in CSV export.':'Browser storage is blocked; dismissed posts may reappear after reload.';
 for(const type of ['help','display']){
  const group=visible.filter(p=>p.type===type),target=$(type+'-posts');$(type+'-badge').textContent=group.length;target.replaceChildren();
  if(!group.length){const div=document.createElement('div');div.className='empty';div.textContent=showDismissed?'No dismissed submissions for this filter.':(type==='help'?'No active help requests for this filter.':'No active shared results for this filter.');target.append(div);continue;}
  group.forEach(p=>{
   const card=document.createElement('button');card.type='button';card.className='cardpost';
   const top=document.createElement('div');top.className='row';const t=document.createElement('strong');t.textContent=titles[p.part]||p.part;const time=document.createElement('time');time.className='meta';time.dateTime=p.submittedAt;time.textContent=new Date(p.submittedAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});top.append(t,time);card.append(top);
   if(p.name){const who=document.createElement('div');who.className='meta';who.style.fontWeight='800';who.textContent='Shared by '+p.name;card.append(who);}
   const badges=document.createElement('div');badges.className='pills';badges.style.marginTop='9px';for(const x of [p.lang?.toUpperCase(),p.imageId?'Screenshot':null].filter(Boolean)){const b=document.createElement('span');b.className='pill';b.textContent=x;badges.append(b);}card.append(badges);
   const excerpt=document.createElement('div');excerpt.className='preview';excerpt.textContent=revealed?((p.note||p.code||'Screenshot attached').slice(0,380)):'Preview hidden — click to inspect';card.append(excerpt);
   if(revealed&&p.imageId){const img=document.createElement('img');img.src='/api/posts?image='+encodeURIComponent(p.imageId);img.alt='Submitted screenshot thumbnail';img.loading='lazy';card.append(img);}
   if(p.diagnostics?.issues?.length){const issue=document.createElement('div');issue.className='issues';issue.textContent='✦ '+p.diagnostics.issues.length+' potential issue(s) · verify in Visual Studio';card.append(issue);}
   card.addEventListener('click',()=>openPost(p));
   const wrap=document.createElement('div');wrap.className='post-shell'+(showDismissed?' is-dismissed':'');
   const action=document.createElement('button');action.type='button';action.className='resolve-button';
   action.textContent=showDismissed?'↶ Restore to active':'✓ Dismiss — answered';
   action.setAttribute('aria-label',(showDismissed?'Restore':'Dismiss')+' submission from '+(titles[p.part]||p.part));
   action.addEventListener('click',()=>setDismissed(p.id,!showDismissed));
   wrap.append(card,action);target.append(wrap);
  });
 }
}
function showChecks(issues){const place=$('detail-analysis');place.replaceChildren();if(!issues?.length){place.textContent='No obvious issues reported. This does not verify compilation.';return;}
 issues.forEach(i=>{const d=document.createElement('div');d.className='check '+(i.severity==='hint'?'hint':'');d.textContent=`Line ${i.line} · ${i.message}`;place.append(d);});
}
function openPost(p){current=p;$('detail-title').textContent=(p.name?p.name+' · ':'Anonymous · ')+(p.type==='help'?'I need help with':'I display');$('detail-task').textContent=titles[p.part]||p.part;$('detail-note').textContent=p.note||'';$('detail-lang').textContent=p.lang?.toUpperCase()||'Code';$('detail-code-box').classList.toggle('hidden',!p.code);if(p.code)renderCode($('detail-code'),p.code,p.lang,p.diagnostics?.issues?.map(i=>i.line)||[]);
 $('image-frame').classList.toggle('hidden',!p.imageId);if(p.imageId)$('detail-img').src='/api/posts?image='+encodeURIComponent(p.imageId);else $('detail-img').removeAttribute('src');
 showChecks(p.diagnostics?.issues);$('detail-time').textContent=(p.name||'Student')+' · '+new Date(p.submittedAt).toLocaleString();$('dismiss-current').textContent=dismissed.has(p.id)?'↶ Restore to active':'✓ Dismiss — answered';$('overlay').classList.add('open');$('close').focus();
}
function close(){$('overlay').classList.remove('open');current=null;}
$('dismiss-current').addEventListener('click',()=>{if(current)setDismissed(current.id,!dismissed.has(current.id));});
$('show-dismissed').addEventListener('click',()=>{showDismissed=!showDismissed;update();});
$('close').addEventListener('click',close);$('overlay').addEventListener('click',e=>{if(e.target===$('overlay'))close();});document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
$('copy').addEventListener('click',async()=>{if(!current?.code)return;try{await navigator.clipboard.writeText(current.code);$('copy').textContent='Copied ✓';setTimeout(()=>$('copy').textContent='Copy code',1400);}catch{$('copy').textContent='Could not copy';}});
// Poll while a code/screenshot dialog is open; show whether live updates succeed.
async function load(source='auto'){
 if(busy)return;
 if(source==='auto'&&document.hidden)return; // Refresh again when background tab returns.
 busy=true;
 const status=$('updated');
 const range=$('range').value;
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),10000);
 status.textContent='● Checking for new submissions…';
 try{
  const query=new URLSearchParams({part:'all',range,_:String(Date.now())});
  const res=await fetch('/api/posts?'+query,{cache:'no-store',signal:controller.signal,headers:{'Accept':'application/json','Cache-Control':'no-cache'}});
  const data=await res.json();
  if(!res.ok)throw Error('Server returned '+res.status+': '+(data.error||res.statusText));
  if(!Array.isArray(data.posts))throw Error('Unexpected server response: posts list is missing');
  if(range!==$('range').value)return;
  const incoming=data.posts;
  const oldIds=new Set(allPosts.map(p=>p.id));
  const added=lastSuccess?incoming.filter(p=>!oldIds.has(p.id)).length:0;
  allPosts=incoming;
  populateActivities();
  filterActivities();
  lastSuccess=Date.now();
  $('error').className='notice problem';
  status.textContent='● LIVE · Checked '+new Date(lastSuccess).toLocaleTimeString()+' · '+posts.length+' visible post(s)'+(added?' · +'+added+' new':'')+' · Every 5s';
  status.setAttribute('data-status','online');
 }catch(e){
  $('error').className='notice show problem';
  $('error').textContent='Live refresh failed: '+(e.name==='AbortError'?'Request timed out after 10 seconds':e.message)+'. Press Refresh or check Netlify Functions logs.';
  status.textContent='● OFFLINE · Last successful check: '+(lastSuccess?new Date(lastSuccess).toLocaleTimeString():'none')+' · Retrying every 5s';
  status.setAttribute('data-status','offline');
 }finally{clearTimeout(timeout);busy=false;}
}
$('part').addEventListener('change',filterActivities);$('range').addEventListener('change',()=>load('filter'));$('refresh').addEventListener('click',()=>load('manual'));
$('export').addEventListener('click',()=>{location.href='/api/posts?'+new URLSearchParams({part:$('part').value,range:$('range').value,format:'csv'});});
$('reveal').addEventListener('click',()=>{revealed=!revealed;$('reveal').textContent='Reveal previews: '+(revealed?'On':'Off');$('reveal').setAttribute('aria-pressed',String(revealed));update();});
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{}});
load('initial');setInterval(()=>load('auto'),5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)load('visible');});
window.addEventListener('focus',()=>load('focus'));