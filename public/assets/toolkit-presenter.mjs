// Local-only document presenter. PPT/PPTX parses in the lecturer's browser;
// no file bytes are sent to the Classroom Toolkit API or to external conversion services.
const ENGINE='https://cdn.jsdelivr.net/npm/@web-ppt/core@0.4.5/+esm';
const DB='classroom-toolkit-files-v1',STORE='documents',LIMIT=50*1024*1024;
const $=id=>document.getElementById(id);
let dbPromise,deck=null,currentIndex=0,renderSlideToSvg=null,presentationImageUrl=null,pdfUrl=null;
let activeId=null,renderEpoch=0,loading=false;
function notice(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
function openDb(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'})};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Browser storage is unavailable'));
 });
 return dbPromise;
}
async function transact(mode,operate){
 const db=await openDb();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),s=tx.objectStore(STORE),request=operate(s);
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||Error('Document storage failed'));
  tx.onerror=()=>reject(tx.error||Error('Document storage transaction failed'));
 });
}
const list=()=>transact('readonly',s=>s.getAll());
const read=id=>transact('readonly',s=>s.get(id));
const save=doc=>transact('readwrite',s=>s.put(doc));
const remove=id=>transact('readwrite',s=>s.delete(id));
function extension(name){return (name.split('.').at(-1)||'').toLowerCase()}
function supported(file){return ['pptx','ppt','pdf'].includes(extension(file.name))}
async function populate(preferred){
 const docs=(await list()).sort((a,b)=>b.createdAt-a.createdAt);
 const select=$('documents');
 select.replaceChildren();
 const placeholder=new Option(docs.length?'Choose a file…':'No files yet','');
 select.append(placeholder);
 for(const d of docs)select.append(new Option(d.name,d.id));
 if(preferred&&docs.some(d=>d.id===preferred))select.value=preferred;
 $('delete').disabled=!select.value;
 return docs;
}
function cleanupMedia(){
 if(presentationImageUrl){URL.revokeObjectURL(presentationImageUrl);presentationImageUrl=null}
 if(pdfUrl){URL.revokeObjectURL(pdfUrl);pdfUrl=null}
}
function empty(){
 $('viewer').innerHTML='<div id="placeholder"><span aria-hidden="true">▧</span><h1>Present your slides.</h1><p>Choose a PowerPoint or PDF to display it here.<br>Use the fullscreen button or press F to present.</p></div>';
 $('slide-controls').hidden=true;activeId=null;deck=null;currentIndex=0;cleanupMedia();
}
function showBusy(){ $('viewer').textContent='Opening presentation…'; $('slide-controls').hidden=true; }
async function openDocument(id){
 if(!id){empty();return}
 const myEpoch=++renderEpoch;
 cleanupMedia(); deck=null;currentIndex=0;loading=true;showBusy();
 try{
  const doc=await read(id);
  if(!doc){empty();await populate();notice('This file is no longer in your library.',true);return}
  activeId=id;$('delete').disabled=false;
  if(doc.format==='pdf'){
   pdfUrl=URL.createObjectURL(new Blob([doc.bytes],{type:'application/pdf'}));
   if(myEpoch!==renderEpoch)return;
   const iframe=document.createElement('iframe');
   iframe.src=pdfUrl;iframe.title=doc.name;
   iframe.setAttribute('allowfullscreen','');
   $('viewer').replaceChildren(iframe);
   $('slide-controls').hidden=true;
   notice(doc.name+' · PDF loaded. Click Fullscreen to present.');
  }else{
   notice('Loading local PowerPoint renderer…');
   const engine=await import(ENGINE);
   if(myEpoch!==renderEpoch)return;
   if(typeof engine.parse!=='function'||typeof engine.renderSlideToSvg!=='function')throw Error('PowerPoint viewer module did not load correctly');
   renderSlideToSvg=engine.renderSlideToSvg;
   // Doc data stays in this browser: parse runs locally after downloading the renderer code.
   deck=await engine.parse(new Blob([doc.bytes],{type:doc.mime}));
   if(myEpoch!==renderEpoch)return;
   if(!deck?.slides?.length)throw Error('The presentation did not contain readable slides');
   $('slide-controls').hidden=false;
   await showSlide(0,myEpoch);
   notice(doc.name+' · '+deck.slides.length+' slides. Use ← → or Fullscreen (F).');
  }
  try{localStorage.setItem('toolkit-presenter-last',id)}catch{}
 }catch(e){
  if(myEpoch!==renderEpoch)return;
  cleanupMedia();deck=null;
  $('viewer').innerHTML='<div id="placeholder"><h1>Could not open this presentation</h1><p>Try another PPTX, or export your slides to PDF if the original contains unsupported PowerPoint effects.</p></div>';
  $('slide-controls').hidden=true;
  notice('Unable to display file: '+e.message,true);
 }finally{if(myEpoch===renderEpoch)loading=false}
}
async function showSlide(index,expected=renderEpoch){
 if(!deck||!renderSlideToSvg)return;
 const i=Math.max(0,Math.min(deck.slides.length-1,index));
 try{
  const svg=await renderSlideToSvg(deck,deck.slides[i]);
  if(expected!==renderEpoch)return;
  if(typeof svg!=='string'||!svg.includes('<svg'))throw Error('PowerPoint renderer did not return an SVG slide');
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
  const img=document.createElement('img');
  img.alt='Slide '+(i+1)+' of '+deck.slides.length;
  img.src=url;
  img.onerror=()=>notice('A slide image could not be displayed. Try exporting the deck to PDF.',true);
  $('viewer').replaceChildren(img);
  if(presentationImageUrl)URL.revokeObjectURL(presentationImageUrl);
  presentationImageUrl=url;
  currentIndex=i;
  $('counter').textContent='Slide '+(i+1)+' of '+deck.slides.length;
  $('previous').disabled=i===0;$('next').disabled=i===deck.slides.length-1;
 }catch(e){notice('Slide could not be rendered: '+e.message,true)}
}
async function addFile(file){
 if(!file)return;
 if(!supported(file)){notice('Choose a PPTX, PPT or PDF file.',true);return}
 if(file.size===0||file.size>LIMIT){notice('File must be nonempty and no larger than 50 MB.',true);return}
 const id=crypto.randomUUID();
 try{
  notice('Saving file to this browser…');
  const buffer=await file.arrayBuffer();
  await save({id,name:file.name,format:extension(file.name),mime:file.type||'application/octet-stream',createdAt:Date.now(),bytes:buffer});
  await populate(id);
  await openDocument(id);
 }catch(e){notice('Could not save file: '+e.message+'. Browser storage may be full.',true)}
}
$('upload').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(file)await addFile(file);e.target.value='';
});
$('documents').addEventListener('change',e=>openDocument(e.target.value));
$('delete').addEventListener('click',async()=>{
 const id=$('documents').value;
 if(!id||!confirm('Remove this file from this browser?'))return;
 try{await remove(id);empty();await populate();localStorage.removeItem('toolkit-presenter-last');notice('File removed from this browser.')}catch(e){notice(e.message,true)}
});
$('previous').addEventListener('click',()=>showSlide(currentIndex-1));
$('next').addEventListener('click',()=>showSlide(currentIndex+1));
$('fullscreen').addEventListener('click',async()=>{
 try{
  if(document.fullscreenElement)await document.exitFullscreen();
  else await $('presentation').requestFullscreen();
 }catch(e){notice('Fullscreen is unavailable in this browser or embedded view. Use the Open viewer button in a new tab.',true)}
});
document.addEventListener('fullscreenchange',()=>{
 $('fullscreen').textContent=document.fullscreenElement?'⤡ Exit fullscreen':'⛶ Fullscreen';
});
document.addEventListener('keydown',event=>{
 const active=document.activeElement;
 if(active&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName))return;
 if(event.key==='f'||event.key==='F'){
  if(event.ctrlKey||event.altKey||event.metaKey)return;
  event.preventDefault();$('fullscreen').click();
 }
 if(!deck)return;
 if(['ArrowRight','PageDown',' '].includes(event.key)){event.preventDefault();showSlide(currentIndex+1)}
 if(['ArrowLeft','PageUp'].includes(event.key)){event.preventDefault();showSlide(currentIndex-1)}
 if(event.key==='Home'){event.preventDefault();showSlide(0)}
 if(event.key==='End'){event.preventDefault();showSlide(deck.slides.length-1)}
});
window.addEventListener('pagehide',cleanupMedia);
(async()=>{
 try{
  const docs=await populate();
  const last=localStorage.getItem('toolkit-presenter-last');
  if(last&&docs.some(d=>d.id===last)){$('documents').value=last;await openDocument(last)}
 }catch(e){notice('File library unavailable: '+e.message+'. Check browser private mode or storage settings.',true)}
})();
