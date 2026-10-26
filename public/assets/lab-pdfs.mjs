// Dynamic instructor-only PDF tabs, stored on this browser (IndexedDB).
// Previously saved PDFs under the old fixed tabs are preserved and displayed as documents.
const $=id=>document.getElementById(id);
const embedParams=new URLSearchParams(location.search);
if(embedParams.get('embed')==='1')document.documentElement.classList.add('toolkit-embedded');
const DB='cia4103-local-lab-pdfs-v1',STORE='docs',MAX=50*1024*1024;
let dbPromise=null,docs=[],selected=null,viewerUrl=null,requested=0;
const openDB=()=>dbPromise||(dbPromise=new Promise((resolve,reject)=>{
 if(!('indexedDB'in window)){reject(Error('Your browser does not support local PDF storage.'));return;}
 const req=indexedDB.open(DB,1);
 req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE,{keyPath:'id'});};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Cannot open local PDF storage.'));
}));
async function transaction(mode,operation){
 const db=await openDB();
 return await new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,mode),st=tx.objectStore(STORE);
  const rq=operation(st);
  rq.onsuccess=()=>resolve(rq.result);
  rq.onerror=()=>reject(rq.error||Error('Cannot access local PDFs.'));
 });
}
const status=(message,bad=false)=>{$('pdf-status').textContent=message;$('pdf-status').style.color=bad?'#b04832':'#087f78';};
const displayName=(file)=>String(file||'Document').replace(/\.pdf$/i,'').trim().slice(0,70)||'Document';
function release(){
 $('lab-frame').removeAttribute('src');
 if(viewerUrl){URL.revokeObjectURL(viewerUrl);viewerUrl=null;}
}
function renderTabs(){
 const tabs=$('pdf-tabs');tabs.replaceChildren();
 if(!docs.length){
  const empty=document.createElement('span');empty.className='pdf-empty-tab';empty.textContent='Document 1 · Add a PDF';
  tabs.append(empty);return;
 }
 for(const d of docs){
  const group=document.createElement('span');group.className='pdf-tab-item';
  const btn=document.createElement('button');btn.type='button';btn.className='pdf-doc-tab';
  btn.textContent=d.title||'Document';btn.setAttribute('aria-pressed',String(d.id===selected));
  btn.title=d.title||'Document';btn.addEventListener('click',()=>selectDoc(d.id));
  const remove=document.createElement('button');remove.type='button';remove.className='pdf-remove';remove.textContent='×';
  remove.title='Remove '+(d.title||'Document');remove.setAttribute('aria-label','Remove '+(d.title||'Document'));
  remove.addEventListener('click',()=>deleteDoc(d.id));
  group.append(btn,remove);tabs.append(group);
 }
}
async function selectDoc(id){
 selected=id;renderTabs();release();
 const doc=docs.find(d=>d.id===id);
 if(!doc){status('Select + Add PDF to open your first document.');return;}
 const tick=++requested;
 try{
  const entry=await transaction('readonly',st=>st.get(id));
  if(tick!==requested)return;
  if(!entry?.blob)throw Error('Document could not be found in local browser storage.');
  viewerUrl=URL.createObjectURL(entry.blob);$('lab-frame').src=viewerUrl;
  status((doc.title||'Document')+' is open. Use the browser PDF toolbar for pages and zoom.');
 }catch(e){status(e.message,true);}
}
async function deleteDoc(id){
 const doc=docs.find(d=>d.id===id);if(!doc)return;
 if(!confirm('Remove "'+(doc.title||'Document')+'" from this browser?'))return;
 try{
  await transaction('readwrite',st=>st.delete(id));
  const wasSelected=selected===id;
  docs=docs.filter(d=>d.id!==id);
  if(wasSelected){selected=null;release();}
  renderTabs();
  if(wasSelected&&docs.length)await selectDoc(docs[0].id);
  else if(!docs.length)status('No PDF selected. Click + Add PDF to upload your first document.');
 }catch(e){status(e.message,true);}
}
async function addDocument(file){
 if(!file)return;
 if(file.size>MAX){status('The PDF must be smaller than 50 MB.',true);return;}
 if(file.type&&file.type!=='application/pdf'&&!file.name.toLowerCase().endsWith('.pdf')){status('Choose a PDF document.',true);return;}
 let header;
 try{header=new TextDecoder().decode(await file.slice(0,5).arrayBuffer());}
 catch{status('Cannot read this PDF.',true);return;}
 if(header!=='%PDF-'){status('The selected file does not look like a PDF.',true);return;}
 const id='doc-'+crypto.randomUUID(),title=displayName(file.name);
 try{
  await transaction('readwrite',st=>st.put({id,title,blob:new Blob([file],{type:'application/pdf'}),savedAt:new Date().toISOString()}));
  docs.push({id,title});await selectDoc(id);
  status(title+' added as a new tab. Documents remain on this browser.');
 }catch(e){status('Cannot save PDF: '+e.message,true);}
}
async function initialize(){
 try{
  const all=await transaction('readonly',st=>st.getAll());
  docs=all.filter(x=>x&&x.blob instanceof Blob).map((x,i)=>({
   id:x.id,title:x.title||('Document '+(i+1)),savedAt:x.savedAt||''
  })).sort((a,b)=>a.savedAt.localeCompare(b.savedAt)||a.id.localeCompare(b.id));
  renderTabs();
  if(docs.length)await selectDoc(docs[0].id);
  else status('Click + Add PDF to open your first lab or any other document.');
 }catch(e){status('Local PDF storage is unavailable: '+e.message,true);}
}
$('pdf-add').addEventListener('click',()=>$('pdf-upload').click());
$('pdf-upload').addEventListener('change',async e=>{
 await addDocument(e.target.files?.[0]);e.target.value='';
});
function view(which){
 for(const tab of ['board','labs','screens']){
  const button=$('tab-'+tab),section=$(tab+'-view');
  button.setAttribute('aria-selected',String(tab===which));
  section.hidden=tab!==which;
 }
 if(which==='screens')window.dispatchEvent(new Event('cia4103:streams-tab'));
}
for(const tab of ['board','labs','screens'])$('tab-'+tab).addEventListener('click',()=>view(tab));
window.addEventListener('beforeunload',release);
view(embedParams.get('embed')==='1'&&embedParams.get('section')==='screens'?'screens':'board');
initialize();
