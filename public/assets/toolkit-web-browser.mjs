// Embedded web viewer (not an installed Chrome instance). A same-origin
// lecturer token is accepted only from the parent Toolkit and used only for
// server-side bookmark operations, never passed to third-party websites.
const $=id=>document.getElementById(id);
let token=null,bookmarks=[],history=[],historyIndex=-1,editing=null,busy=false;
const embedded=window.parent!==window;
const status=(message,error=false)=>{const el=$('web-status');el.textContent=message;el.classList.toggle('error',error)};
function parseUrl(value){
 if(typeof value!=='string'||value.length>1500)return null;
 const typed=value.trim();
 if(!/^https:\/\//i.test(typed))return null;
 try{
  const parsed=new URL(typed),host=parsed.hostname.toLowerCase();
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||!host||
    host==='localhost'||host.endsWith('.localhost')||
    host==='127.0.0.1'||host==='0.0.0.0'||host==='[::1]'||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
  return parsed.href;
 }catch{return null}
}
async function api(operation,params={}){
 if(!token)throw Error('Sign in as lecturer through Classroom Toolkit');
 const response=await fetch('/.netlify/functions/toolkit',{
  method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',
  body:JSON.stringify({action:'web-links',operation,token,...params})
 });
 let data;
 try{data=await response.json()}catch{throw Error('Bookmark service is temporarily unavailable')}
 if(!response.ok)throw Error(data.error||'Could not update saved URLs');
 return data;
}
function current(){return historyIndex>=0?history[historyIndex]:null}
function syncNavigation(){
 const url=current();
 $('web-back').disabled=historyIndex<=0;
 $('web-forward').disabled=historyIndex<0||historyIndex>=history.length-1;
 $('web-reload').disabled=!url;
 $('web-new-tab').disabled=!url;
 if(url)$('web-address').value=url;
}
function showUrl(url,{remember=true}={}){
 const parsed=parseUrl(url);
 if(!parsed){status('Please enter a complete HTTPS address, e.g. https://example.com',true);return false}
 if(remember){
  history=history.slice(0,historyIndex+1);
  if(history[history.length-1]!==parsed)history.push(parsed);
  historyIndex=history.length-1;
 }
 $('web-empty').hidden=true;
 const frame=$('web-frame');
 frame.hidden=false;
 frame.src=parsed;
 syncNavigation();
 status('Website requested. If it does not appear, use Open in Chrome.');
 return true;
}
function redrawBookmarks(){
 const select=$('web-bookmarks'),existing=select.value;
 select.replaceChildren(new Option('Choose saved URL…',''));
 for(const item of bookmarks)select.add(new Option(item.title,item.id));
 if(bookmarks.some(b=>b.id===existing))select.value=existing;
 $('web-bookmarks').disabled=!token||!bookmarks.length;
 const list=$('web-library-list');list.replaceChildren();
 if(!bookmarks.length){
  const empty=document.createElement('p');
  empty.className='web-library-empty';empty.textContent='No saved websites yet. Enter a URL and select Save URL.';
  list.append(empty);
  return;
 }
 for(const entry of bookmarks){
  const row=document.createElement('article');
  row.className='web-library-row';
  const details=document.createElement('div');details.className='web-library-detail';
  const name=document.createElement('strong');name.textContent=entry.title;
  const url=document.createElement('small');url.textContent=entry.url;url.title=entry.url;
  details.append(name,url);
  const controls=document.createElement('div');controls.className='web-library-actions';
  for(const [label,action] of [['Open',()=>{showUrl(entry.url);$('web-library').close()}],
    ['Edit',()=>{openEditor(entry);$('web-library').close()}],
    ['Delete',()=>remove(entry)]]){
   const button=document.createElement('button');button.type='button';button.textContent=label;
   button.className=label==='Delete'?'web-danger':'web-secondary';
   button.addEventListener('click',action);controls.append(button);
  }
  row.append(details,controls);list.append(row);
 }
}
async function reloadBookmarks(){
 const result=await api('list');
 bookmarks=Array.isArray(result.items)?result.items:[];redrawBookmarks();
 status(bookmarks.length+' saved website'+(bookmarks.length===1?'':'s')+' available.');
}
function openEditor(entry=null){
 if(!token){status('Lecturer sign-in required to save URLs',true);return}
 editing=entry;
 $('web-dialog-title').textContent=entry?'Edit saved website':'Save a website';
 $('web-title').value=entry?.title||(parseUrl($('web-address').value)?new URL($('web-address').value).hostname:'');
 $('web-link').value=entry?.url||current()||$('web-address').value;
 $('web-editor').showModal();$('web-title').focus();
}
async function submitEditor(event){
 event.preventDefault();
 if(busy)return;
 const title=$('web-title').value.trim(),url=parseUrl($('web-link').value);
 if(!title||title.length>100||!url){status('Enter a name and a valid HTTPS URL',true);return}
 busy=true;$('web-save').disabled=true;
 try{
  await api('save',{id:editing?.id,revision:editing?.revision||0,item:{title,url}});
  $('web-editor').close();editing=null;
  await reloadBookmarks();
  status('Website saved for your future classrooms.');
 }catch(err){status(err.message,true)}
 finally{busy=false;$('web-save').disabled=false}
}
async function remove(entry){
 if(!confirm('Remove saved website "'+entry.title+'"?'))return;
 try{
  await api('delete',{id:entry.id});
  await reloadBookmarks();
  status('Saved website removed.');
 }catch(err){status(err.message,true)}
}
$('web-address-form').addEventListener('submit',event=>{event.preventDefault();showUrl($('web-address').value)});
$('web-bookmarks').addEventListener('change',event=>{
 const item=bookmarks.find(b=>b.id===event.target.value);
 if(item)showUrl(item.url);
});
$('web-back').addEventListener('click',()=>{if(historyIndex>0){historyIndex--;showUrl(current(),{remember:false})}});
$('web-forward').addEventListener('click',()=>{if(historyIndex<history.length-1){historyIndex++;showUrl(current(),{remember:false})}});
$('web-reload').addEventListener('click',()=>{
 const url=current();if(url){const frame=$('web-frame');frame.src='about:blank';frame.src=url}
});
$('web-new-tab').addEventListener('click',()=>{
 const url=current();if(url)window.open(url,'_blank','noopener,noreferrer');
});
$('web-fullscreen').addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else await $('web-browser').requestFullscreen();
 }catch{status('Fullscreen is unavailable in this browser.',true)}
});
$('web-add').addEventListener('click',()=>openEditor());
$('web-manage').addEventListener('click',()=>$('web-library').showModal());
$('web-library-close').addEventListener('click',()=>$('web-library').close());
$('web-cancel').addEventListener('click',()=>$('web-editor').close());
$('web-editor-form').addEventListener('submit',submitEditor);
$('web-editor').addEventListener('close',()=>{editing=null});
if(embedded){
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  if(event.data?.type!=='toolkit:web-session')return;
  if(typeof event.data.token!=='string'||event.data.token.length>2200)return;
  if(token===event.data.token)return;
  token=event.data.token;
  $('web-add').disabled=false;$('web-manage').disabled=false;
  void reloadBookmarks().catch(error=>status(error.message,true));
 });
 window.parent.postMessage({type:'toolkit:web-ready'},location.origin);
}else status('Open the Web Browser from a lecturer classroom to load saved websites.',true);
