// Teacher-only browser-local lab PDF viewer. Files never leave this browser.
// IndexedDB stores Lab09a/Lab09b documents for subsequent classroom sessions.
const $=id=>document.getElementById(id);
const DB='cia4103-local-lab-pdfs-v1', TABLE='docs';
let dbPromise,activeUrl=null,activeLab='09a';
function openDB(){
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  if(!('indexedDB' in window))return reject(Error('Local PDF storage is unavailable in this browser.'));
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>req.result.createObjectStore(TABLE,{keyPath:'id'});
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Could not open local PDF storage.'));
 });
 return dbPromise;
}
async function stored(op,id,blob){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tr=db.transaction(TABLE,op==='put'?'readwrite':'readonly');
  const req=op==='put'?tr.objectStore(TABLE).put({id,blob}):tr.objectStore(TABLE).get(id);
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error||Error('Could not access saved lab PDF.'));
 });
}
function status(message,error=false){
 const e=$('pdf-status');e.textContent=message;e.style.color=error?'#ad4c32':'#087f78';
}
async function loadLab(id){
 activeLab=id;
 for(const lab of ['09a','09b'])$('pdf-'+lab).setAttribute('aria-pressed',String(lab===id));
 const frame=$('lab-frame');frame.removeAttribute('src');
 if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl=null;}
 try{
  const saved=await stored('get',id);
  if(!saved?.blob){status('Choose your Lab '+id+' PDF once using the file selector. It will remain available in this browser.');return;}
  activeUrl=URL.createObjectURL(saved.blob);
  frame.src=activeUrl;
  status('Lab '+id+' is ready. Use the PDF toolbar to navigate pages or zoom.');
 }catch(err){status(err.message,true);}
}
function view(which){
 for(const tab of ['board','labs','screens']) {
  const button=$('tab-'+tab),section=$(tab+'-view');
  if(button)button.setAttribute('aria-selected',String(tab===which));
  if(section)section.hidden=(which!==tab);
 }
 if(which==='labs')loadLab(activeLab);
 if(which==='screens')window.dispatchEvent(new Event('cia4103:streams-tab'));
}
for(const which of ['board','labs','screens']){
 $('tab-'+which)?.addEventListener('click',()=>view(which));
}
for(const lab of ['09a','09b']){
 $('pdf-'+lab).addEventListener('click',()=>loadLab(lab));
 $('pdf-file-'+lab).addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  if(file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){status('Please choose a PDF file.',true);return;}
  if(file.size>20*1024*1024){status('Please choose a PDF under 20 MB.',true);return;}
  const data=await file.slice(0,5).arrayBuffer();
  if(new TextDecoder().decode(data)!=='%PDF-'){status('This file does not appear to be a valid PDF.',true);return;}
  try{await stored('put',lab,new Blob([file],{type:'application/pdf'}));status('Lab '+lab+' saved locally.');if(activeLab===lab)await loadLab(lab);}
  catch(err){status('Could not save PDF: '+err.message,true);}
  e.target.value='';
 });
}
window.addEventListener('beforeunload',()=>{if(activeUrl)URL.revokeObjectURL(activeUrl);});
view('board');