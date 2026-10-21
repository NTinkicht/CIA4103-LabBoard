import{inspect,detectLanguage,taskFromText}from'./checker.mjs';
import{renderCode}from'./highlight.mjs';
const $=id=>document.getElementById(id);
let type='help',image=null,diagnostics=null,checking=false;
function message(text,problem=false){const el=$('feedback');el.className='notice show'+(problem?' problem':'');el.textContent=text;}
function setup(){
 const qs=new URLSearchParams(location.search);
 const part=qs.get('task');if(part)$('part').value=part.slice(0,100);
 $('part').addEventListener('input',resetCheck);
 $('name').addEventListener('input',()=>{});
 $('share-screen').addEventListener('click',()=>{
  try{sessionStorage.setItem('cia4103-share-profile',JSON.stringify({name:$('name').value.trim()}));}catch{}
 });
 $('code').addEventListener('input',()=>{updatePreview();resetCheck();});
 $('type-help').addEventListener('click',()=>setType('help'));
 $('type-display').addEventListener('click',()=>setType('display'));
 $('check').addEventListener('click',runCheck);
 $('file').addEventListener('change',async()=>{if($('file').files?.[0])await processImage($('file').files[0]);});
 $('remove').addEventListener('click',clearImage);
 const zone=$('drop');
 zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag');});
 zone.addEventListener('dragleave',()=>zone.classList.remove('drag'));
 zone.addEventListener('drop',async e=>{e.preventDefault();zone.classList.remove('drag');const f=[...e.dataTransfer.files].find(f=>f.type.startsWith('image/'));if(f)await processImage(f);});
 window.addEventListener('paste',async e=>{
  const entry=[...(e.clipboardData?.items||[])].find(x=>x.type.startsWith('image/'));
  if(entry){e.preventDefault();await processImage(entry.getAsFile());}
 });
 $('post-form').addEventListener('submit',send);
 updatePreview();
}
function setType(next){type=next;for(const key of ['help','display']){$('type-'+key).classList.toggle('active',key===next);$('type-'+key).setAttribute('aria-pressed',String(key===next));}}
function updatePreview(){
 const code=$('code').value,lang=detectLanguage(code);
 $('counter').textContent=code.length.toLocaleString()+' / 8,000';
 $('code-title').textContent=lang==='csharp'?'C# (detected)':lang==='razor'?'ASP.NET Razor (detected)':lang.toUpperCase()+' (detected)';
 renderCode($('preview'),code||'// Paste code to preview',lang,diagnostics?.issues?.map(x=>x.line)||[]);
}
function resetCheck(){diagnostics=null;$('check-status').textContent='· not checked';$('analysis').textContent='Press “Check My Code” to examine this snippet.';updatePreview();}
function showChecks(info,where){where.replaceChildren();
 if(info.status==='no-code'){where.textContent='Paste C# or Razor code first. Screenshots cannot be checked automatically.';return;}
 if(!info.issues?.length){const p=document.createElement('p');p.className='hint';p.textContent='No obvious issues found in this snippet. This does NOT confirm it compiles or behaves correctly.';where.append(p);}
 for(const i of info.issues||[]){const div=document.createElement('div');div.className='check '+(i.severity==='hint'?'hint':'');const label=document.createElement('strong');label.textContent=`${i.severity==='error'?'Possible error':'Check this'} · Line ${i.line}`;div.append(label,document.createElement('br'),document.createTextNode(i.message));where.append(div);}
 const p=document.createElement('p');p.className='hint';p.textContent=info.note;where.append(p);
}
function runCheck(){diagnostics=inspect($('code').value,detectLanguage($('code').value),taskFromText($('part').value));showChecks(diagnostics,$('analysis'));$('check-status').textContent='· '+(diagnostics.issues.length?diagnostics.issues.length+' finding(s)':'no obvious issues');updatePreview();}
function clearImage(){image=null;$('file').value='';$('thumb').classList.remove('show');$('thumb-img').removeAttribute('src');}
async function processImage(file){
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)){message('Choose a PNG, JPG or WebP screenshot.',true);return;}
 if(file.size>2000000){message('Screenshot exceeds 2 MB. Crop it or capture a smaller image.',true);return;}
 try{
  const bitmap=await createImageBitmap(file);
  if(bitmap.width*bitmap.height>12000000)throw Error('Image exceeds 12 megapixels. Please crop it.');
  const ratio=Math.min(1,1600/bitmap.width,1200/bitmap.height);
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close?.();
  const blob=await new Promise(res=>canvas.toBlob(res,'image/webp',.76));if(!blob||blob.size>1600000)throw Error('Compressed screenshot is too large; crop the screenshot.');
  const data=await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result);reader.onerror=()=>rej(Error('Cannot read screenshot.'));reader.readAsDataURL(blob);});
  image={mime:blob.type,base64:data.split(',')[1]};$('thumb-img').src=data;$('thumb-size').textContent=Math.round(blob.size/1024)+' KB';$('thumb').classList.add('show');
 }catch(e){message(e.message||'Could not read screenshot.',true);}
}
async function send(e){
 e.preventDefault();const code=$('code').value,note=$('note').value.trim();
 if(!$('name').value.trim()){message('Please enter your name.',true);$('name').focus();return;}
 if(!$('part').value.trim()){message('Please enter the lab or activity.',true);$('part').focus();return;}
 if(!code.trim()&&!note&&!image){message('Add code, a screenshot, or a description before submitting.',true);return;}
 if(code.trim()&&!diagnostics)runCheck();
 $('send').disabled=true;$('send').textContent='Sending…';
 try{
  const payload={part:$('part').value,type,code,note,image,name:$('name').value.trim()};
  const response=await fetch('/api/posts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const obj=await response.json();if(!response.ok)throw Error(obj.error||'Failed to submit.');
  message('Shared! Your post will appear on the teacher dashboard shortly.');
  $('code').value='';$('note').value='';clearImage();resetCheck();
 }catch(e){message('Not sent: '+e.message,true);}finally{$('send').disabled=false;$('send').textContent='Share to board →';}
}
setup();