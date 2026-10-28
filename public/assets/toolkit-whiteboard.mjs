// Collaborative classroom whiteboard. Existing pen strokes remain compatible.
// All item geometry uses a shared 1000 x 600 canvas coordinate system.
// Authorized lecturer/student creates are server validated on each operation.
const COLORS=['#24374f','#1976bd','#169b83','#dc8743','#c54b58','#ffffff'];
const TOOLS=[
 ['select','↖','Select & move'],['pen','✎','Pen'],['rectangle','▢','Rectangle'],
 ['ellipse','◯','Ellipse'],['line','╱','Line'],['arrow','➜','Arrow'],
 ['text','T','Text box'],['table','▦','Table']
];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const bound=(a,b)=>({x:Math.min(a[0],b[0]),y:Math.min(a[1],b[1]),
 w:Math.abs(a[0]-b[0]),h:Math.abs(a[1]-b[1])});
const isObject=v=>['shape','text','table'].includes(v?.type);
function hit(item,x,y){
 if(!isObject(item))return false;
 const pad=item.type==='shape'?11:5;
 return x>=item.x-pad&&x<=item.x+item.w+pad&&
  y>=item.y-pad&&y<=item.y+item.h+pad;
}
function wrapText(ctx,text,width,maxLines){
 const output=[];
 for(const paragraph of String(text||'').split('\n')){
  if(!paragraph){output.push('');continue}
  let line='';
  for(const word of paragraph.split(/\s+/)){
   if(!word)continue;
   const candidate=line?line+' '+word:word;
   if(ctx.measureText(candidate).width>width&&line){output.push(line);line=word}
   else line=candidate;
  }
  output.push(line);
 }
 return output.slice(0,maxLines);
}
export function mountWhiteboard(root,{request,token,role}){
 let destroyed=false,loaded=false,inflight=false,lastVersion=-1,items=[],students=[],selectedId=null;
 let canDraw=role==='teacher',draft=null,tool='pen',localColor=COLORS[0],localWidth=4;
 let refreshTimer=null,rosterSignature='',selected=null,editing=null,pending=false;
 const teacher=role==='teacher',viewer=role==='display';
 root.innerHTML='<section class="wb-root">'+
  '<div class="wb-topbar"><div><p class="eyebrow">Collaborative workspace</p>'+
  '<h3>Shared whiteboard</h3><p class="small">Draw, build diagrams and tables. Your lecturer chooses who can edit.</p></div>'+
  '<span class="pill grey" id="wb-permission">Connecting…</span></div>'+
  '<div class="wb-tools">'+
   '<div class="wb-tool-modes" role="toolbar" aria-label="Whiteboard drawing and object tools">'+
    TOOLS.map(([id,symbol,name])=>'<button type="button" class="wb-tool-mode'+(id==='pen'?' active':'')+
     '" data-wb-tool="'+id+'" aria-label="'+name+'" title="'+name+'" aria-pressed="'+(id==='pen')+'">'+
     '<span aria-hidden="true">'+symbol+'</span><span class="wb-tool-name">'+name+'</span></button>').join('')+
   '</div>'+
   '<div class="wb-style-tools"><div class="wb-swatches" role="group" aria-label="Pen and shape color">'+
    COLORS.map((color,i)=>'<button type="button" class="wb-swatch'+(i===0?' selected':'')+
     '" aria-label="'+(i===5?'White eraser':'Color '+(i+1))+'" title="'+(i===5?'White eraser':'Color')+
     '" data-color="'+color+'" style="--swatch:'+color+'">'+(i===5?'⌫':'')+'</button>').join('')+
    '</div><label for="wb-size">Size</label><select id="wb-size" title="Pen width"><option value="2">Fine</option>'+
    '<option value="4" selected>Normal</option><option value="7">Bold</option><option value="11">Very bold</option></select>'+
    '<label for="wb-rows" class="wb-table-options" hidden>Rows</label>'+
    '<select id="wb-rows" class="wb-table-options" title="Table rows" hidden>'+
     Array.from({length:8},(_,i)=>'<option value="'+(i+1)+'"'+(i===2?' selected':'')+'>'+(i+1)+'</option>').join('')+'</select>'+
    '<label for="wb-cols" class="wb-table-options" hidden>Columns</label>'+
    '<select id="wb-cols" class="wb-table-options" title="Table columns" hidden>'+
     Array.from({length:8},(_,i)=>'<option value="'+(i+1)+'"'+(i===2?' selected':'')+'>'+(i+1)+'</option>').join('')+'</select>'+
   '</div>'+
   '<div class="wb-tool-actions">'+
    '<button type="button" class="ghost" id="wb-edit" disabled>Edit selection</button>'+
    '<button type="button" class="ghost" id="wb-delete" disabled>Delete selection</button>'+
    (teacher?'<button type="button" class="ghost" id="wb-undo">↶ Undo</button>'+
      '<button type="button" class="ghost" id="wb-clear">Clear board</button>':'')+
    '<button type="button" class="secondary" id="wb-download">↓ Save image</button>'+
    '<button type="button" class="secondary" id="wb-fullscreen">⛶ Fullscreen</button>'+
   '</div>'+
  '</div>'+
  '<div class="wb-body'+(teacher?' teacher':'')+'"><div class="wb-main">'+
   '<div class="wb-canvas-wrap" id="wb-stage">'+
    '<canvas id="wb-canvas" width="1000" height="600" tabindex="0" aria-label="Shared whiteboard drawing area"></canvas>'+
   '</div><p class="wb-status" id="wb-status" role="status" aria-live="polite">Loading classroom whiteboard…</p>'+
   '<p class="wb-help">Choose a tool, then drag on the board. Use Select to move an object. Double-click a text box or table cell to edit.</p></div>'+
   (teacher?'<aside class="wb-sidebar" aria-label="Students in classroom">'+
    '<div class="wb-side-title"><h3>Students</h3><span class="pill grey" id="wb-count">0</span></div>'+
    '<p class="small">Select one student to write alongside you. Select again to return everyone to view-only.</p>'+
    '<div id="wb-roster" class="wb-roster"></div></aside>':'')+
  '</div>'+
  '<dialog id="wb-editor" class="wb-editor" aria-labelledby="wb-editor-title">'+
   '<form method="dialog" id="wb-editor-form"><h3 id="wb-editor-title">Edit text box</h3>'+
    '<p id="wb-editor-hint" class="small"></p>'+
    '<label for="wb-editor-input">Content</label>'+
    '<textarea id="wb-editor-input" rows="4" maxlength="500"></textarea>'+
    '<div class="wb-editor-buttons"><button type="button" class="ghost" id="wb-editor-cancel">Cancel</button>'+
    '<button type="submit" class="primary" id="wb-editor-save">Save to board</button></div>'+
   '</form></dialog></section>';
 const $=id=>root.querySelector('#'+id),canvas=$('wb-canvas'),ctx=canvas.getContext('2d');
 const status=$('wb-status'),dialog=$('wb-editor'),input=$('wb-editor-input');
 const say=(message,bad=false)=>{status.textContent=message;status.classList.toggle('error',bad)};
 function putPermission(){
  const message=teacher?'Lecturer · Can edit':canDraw?'✓ You can edit':'View only · Teacher selects editor';
  $('wb-permission').textContent=message;
  $('wb-permission').className='pill '+(canDraw?'blue':'grey');
  canvas.style.cursor=canDraw?(tool==='select'?'grab':tool==='text'?'text':'crosshair'):'not-allowed';
  canvas.setAttribute('aria-disabled',String(!canDraw));
  $('wb-edit').disabled=!canDraw||!selected||!['text','table'].includes(items.find(o=>o.id===selected)?.type);
  $('wb-delete').disabled=!canDraw||!selected;
 }
 function chooseTool(mode){
  if(!TOOLS.some(t=>t[0]===mode))return;
  tool=mode;selected=null;draft=null;
  for(const button of root.querySelectorAll('[data-wb-tool]')){
   const active=button.dataset.wbTool===tool;
   button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  }
  for(const el of root.querySelectorAll('.wb-table-options'))el.hidden=tool!=='table';
  putPermission();redraw();
 }
 function drawPen(stroke){
  if(!stroke.points?.length)return;
  ctx.beginPath();ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;
  ctx.lineJoin='round';ctx.lineCap='round';
  stroke.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
 }
 function drawShape(item){
  const {x,y,w,h,color,width,shape}=item;
  ctx.save();ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;
  ctx.lineCap='round';ctx.lineJoin='round';
  if(shape==='rectangle')ctx.rect(x,y,w,h);
  else if(shape==='ellipse')ctx.ellipse(x+w/2,y+h/2,Math.max(1,w/2),Math.max(1,h/2),0,0,Math.PI*2);
  else{
   ctx.moveTo(x,y);ctx.lineTo(x+w,y+h);
  }
  ctx.stroke();
  if(shape==='arrow'){
   const angle=Math.atan2(h,w),head=clamp(width*3.3,12,25);
   ctx.beginPath();
   ctx.moveTo(x+w,y+h);
   ctx.lineTo(x+w-head*Math.cos(angle-Math.PI/6),y+h-head*Math.sin(angle-Math.PI/6));
   ctx.moveTo(x+w,y+h);
   ctx.lineTo(x+w-head*Math.cos(angle+Math.PI/6),y+h-head*Math.sin(angle+Math.PI/6));
   ctx.stroke();
  }
  ctx.restore();
 }
 function drawText(item){
  ctx.save();
  ctx.fillStyle='#ffffff';ctx.fillRect(item.x,item.y,item.w,item.h);
  ctx.strokeStyle='#b7cbdc';ctx.lineWidth=1;ctx.strokeRect(item.x,item.y,item.w,item.h);
  ctx.fillStyle=item.color;ctx.font='600 '+item.fontSize+'px system-ui, sans-serif';
  ctx.textBaseline='top';
  const lines=wrapText(ctx,item.text,item.w-16,Math.floor((item.h-14)/(item.fontSize*1.35)));
  lines.forEach((line,i)=>ctx.fillText(line,item.x+8,item.y+7+i*item.fontSize*1.35,item.w-16));
  ctx.restore();
 }
 function drawTable(item){
  const {x,y,w,h,rows,cols,color,cells}=item,cellW=w/cols,cellH=h/rows;
  ctx.save();
  ctx.fillStyle='#fff';ctx.fillRect(x,y,w,h);
  ctx.fillStyle='#ecf3fb';ctx.fillRect(x,y,w,cellH);
  ctx.strokeStyle=color;ctx.lineWidth=1.7;ctx.strokeRect(x,y,w,h);
  for(let r=1;r<rows;r++){ctx.beginPath();ctx.moveTo(x,y+r*cellH);ctx.lineTo(x+w,y+r*cellH);ctx.stroke()}
  for(let c=1;c<cols;c++){ctx.beginPath();ctx.moveTo(x+c*cellW,y);ctx.lineTo(x+c*cellW,y+h);ctx.stroke()}
  const fontSize=clamp(Math.floor(Math.min(cellH/2.3,cellW/6)),11,17);
  ctx.font='500 '+fontSize+'px system-ui, sans-serif';ctx.fillStyle='#23384c';ctx.textBaseline='middle';
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
   const value=String(cells[r*cols+c]||'');
   if(value)ctx.fillText(value,x+c*cellW+6,y+(r+.5)*cellH,Math.max(8,cellW-12));
  }
  ctx.restore();
 }
 function drawItem(item){
  if(item.type==='shape')drawShape(item);
  else if(item.type==='text')drawText(item);
  else if(item.type==='table')drawTable(item);
  else drawPen(item);
 }
 function redraw(){
  ctx.clearRect(0,0,1000,600);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,600);
  for(const item of items)drawItem(item);
  if(draft?.element)drawItem(draft.element);
  if(draft?.points)drawPen(draft);
  const current=items.find(o=>o.id===selected);
  if(current&&isObject(current)){
   ctx.save();ctx.strokeStyle='#2a8bd5';ctx.lineWidth=2;ctx.setLineDash([7,5]);
   ctx.strokeRect(current.x-5,current.y-5,current.w+10,current.h+10);ctx.restore();
  }
 }
 function at(event){
  const rect=canvas.getBoundingClientRect();
  return [clamp(Math.round((event.clientX-rect.left)*1000/rect.width),0,1000),
   clamp(Math.round((event.clientY-rect.top)*600/rect.height),0,600)];
 }
 function hitItem(x,y){return [...items].reverse().find(item=>hit(item,x,y))||null}
 function areaFor(start,finish,mode){
  let area=bound(start,finish);
  if(mode==='text'||mode==='table'){
   const minW=mode==='table'?Math.max(180,Number($('wb-cols').value)*48):180;
   const minH=mode==='table'?Math.max(110,Number($('wb-rows').value)*34):80;
   const width=clamp(Math.max(minW,area.w),minW,750),height=clamp(Math.max(minH,area.h),minH,400);
   return {x:clamp(area.x,0,1000-width),y:clamp(area.y,0,600-height),w:width,h:height};
  }
  return {x:area.x,y:area.y,w:area.w,h:area.h};
 }
 function pointerDown(event){
  if(!canDraw||event.button!==0||!loaded||pending||dialog.open)return;
  const p=at(event);event.preventDefault();
  if(tool==='select'){
   const current=hitItem(...p);selected=current?.id||null;
   if(current)draft={move:true,start:p,element:{...current},origin:[current.x,current.y]};
   putPermission();redraw();
  }else if(tool==='pen'){draft={points:[p,p],color:localColor,width:localWidth}}
  else{draft={start:p,element:null}}
  try{canvas.setPointerCapture(event.pointerId)}catch{}
 }
 function pointerMove(event){
  if(!draft||!canDraw)return;
  const p=at(event);event.preventDefault();
  if(draft.move){
   const current=draft.element;
   current.x=clamp(draft.origin[0]+p[0]-draft.start[0],0,1000-current.w);
   current.y=clamp(draft.origin[1]+p[1]-draft.start[1],0,600-current.h);
   // Draw dragged object as a preview by temporarily replacing it visually.
   const index=items.findIndex(e=>e.id===current.id);
   if(index>=0){items[index]={...current};redraw()}
  }else if(draft.points){
   const previous=draft.points.at(-1);
   if(draft.points.length>=119||Math.hypot(p[0]-previous[0],p[1]-previous[1])<2)return;
   draft.points.push(p);drawPen(draft);
  }else{
   const area=areaFor(draft.start,p,tool);
   draft.element=tool==='text'?{type:'text',...area,color:localColor,fontSize:20,text:'Text box'}:
     tool==='table'?{type:'table',...area,color:localColor,rows:Number($('wb-rows').value),
       cols:Number($('wb-cols').value),cells:Array(Number($('wb-rows').value)*Number($('wb-cols').value)).fill('')}:
     {type:'shape',shape:tool,...area,color:localColor,width:localWidth};
   redraw();
  }
 }
 async function apply(op,payload,message){
  pending=true;
  try{
   await request('board',{token,operation:op,...payload});
   lastVersion=-1;await refresh(true);
   say(message);
   return true;
  }catch(error){
   say(error.message,true);
   lastVersion=-1;await refresh(true);
   return false;
  }finally{pending=false}
 }
 async function pointerUp(event){
  if(!draft)return;
  const completed=draft;draft=null;
  if(!canDraw){redraw();return}
  const p=at(event);event.preventDefault();
  if(completed.move){
   const moved=completed.element,index=items.findIndex(e=>e.id===moved.id);
   const isMoved=moved.x!==completed.origin[0]||moved.y!==completed.origin[1];
   if(isMoved)await apply('move',{id:moved.id,x:moved.x,y:moved.y},'Object moved.');
   else redraw();
   return;
  }
  if(completed.points){
   if(completed.points.length<120)completed.points.push(p);
   items.push(completed);redraw();
   await apply('stroke',{points:completed.points,color:completed.color,width:completed.width},'Stroke saved on the classroom board.');
   return;
  }
  const area=areaFor(completed.start,p,tool);
  if(tool==='text'){
   openEditor({mode:'new-text',area,color:localColor});
  }else if(tool==='table'){
   const rows=Number($('wb-rows').value),cols=Number($('wb-cols').value);
   await apply('element',{element:{type:'table',...area,color:localColor,rows,cols,cells:Array(rows*cols).fill('')}},'Table created. Double-click a cell to enter text.');
  }else if(['rectangle','ellipse','line','arrow'].includes(tool)){
   const a={type:'shape',shape:tool,...area,color:localColor,width:localWidth};
   if((['line','arrow'].includes(tool)&&Math.hypot(a.w,a.h)<8)||
     (['rectangle','ellipse'].includes(tool)&&(a.w<8||a.h<8))){redraw();return}
   items.push(a);redraw();
   await apply('element',{element:a},'Shape added.');
  }
 }
 function openEditor(context){
  if(!canDraw||viewer)return;
  editing=context;
  const item=context.item;
  if(context.mode==='new-text'){
   $('wb-editor-title').textContent='Add text box';$('wb-editor-hint').textContent='Type up to 500 characters.';
   input.maxLength=500;input.value='';
  }else if(context.mode==='edit-text'){
   $('wb-editor-title').textContent='Edit text box';$('wb-editor-hint').textContent='Edit this shared text box.';
   input.maxLength=500;input.value=item.text;
  }else if(context.mode==='edit-cell'){
   const row=Math.floor(context.cell/item.cols)+1,col=(context.cell%item.cols)+1;
   $('wb-editor-title').textContent='Edit table cell';
   $('wb-editor-hint').textContent='Row '+row+', column '+col+' · 60 characters maximum';
   input.maxLength=60;input.value=item.cells[context.cell]||'';
  }
  dialog.showModal();input.focus();input.select();
 }
 function editSelected(){
  if(!canDraw)return;
  const item=items.find(i=>i.id===selected);
  if(item?.type==='text')openEditor({mode:'edit-text',item});
  else if(item?.type==='table')openEditor({mode:'edit-cell',item,cell:0});
 }
 function handleDoubleClick(event){
  if(!canDraw)return;
  const p=at(event),item=hitItem(...p);
  if(!item)return;
  selected=item.id;putPermission();redraw();
  if(item.type==='text')openEditor({mode:'edit-text',item});
  if(item.type==='table'){
   const col=clamp(Math.floor((p[0]-item.x)/(item.w/item.cols)),0,item.cols-1);
   const row=clamp(Math.floor((p[1]-item.y)/(item.h/item.rows)),0,item.rows-1);
   openEditor({mode:'edit-cell',item,cell:row*item.cols+col});
  }
 }
 async function saveEditor(event){
  event.preventDefault();
  if(!editing||!canDraw)return;
  const current=editing;const text=input.value;
  if(current.mode==='new-text'&&!text.trim()){say('Enter text before adding a text box.',true);return}
  dialog.close();editing=null;
  if(current.mode==='new-text'){
   const element={type:'text',...current.area,color:current.color,fontSize:20,text};
   await apply('element',{element},'Text box created. Double-click to edit.');
  }else if(current.mode==='edit-text'){
   await apply('edit',{id:current.item.id,changes:{text}},'Text box updated.');
  }else if(current.mode==='edit-cell'){
   const cells=[...current.item.cells];cells[current.cell]=text;
   await apply('edit',{id:current.item.id,changes:{cells}},'Table cell updated.');
  }
 }
 function cancelEditor(){editing=null;dialog.close();redraw()}
 async function removeSelected(){
  if(!canDraw||!selected)return;
  const id=selected;selected=null;putPermission();
  await apply('remove',{id},'Object deleted.');
 }
 function renderRoster(){
  if(!teacher)return;
  const sig=students.map(s=>s.id+':'+s.name+':'+s.team).join('|')+'|'+selectedId;
  if(sig===rosterSignature)return;rosterSignature=sig;
  $('wb-count').textContent=String(students.length);
  const roster=$('wb-roster');
  roster.innerHTML=students.length?students.map(student=>{
   const chosen=student.id===selectedId;
   return '<button type="button" class="wb-person'+(chosen?' chosen':'')+'" data-student-id="'+student.id+'" aria-pressed="'+chosen+'">'+
    '<span class="wb-avatar" aria-hidden="true">'+esc(student.name.trim().charAt(0).toUpperCase()||'?')+'</span>'+
    '<span class="wb-person-info"><strong>'+esc(student.name)+'</strong><small>'+esc(student.team||'Student')+' · '+student.id.slice(0,5)+'</small></span>'+
    '<span class="wb-person-right">'+(chosen?'✎ Writing':'Select')+'</span></button>';
  }).join(''):'<div class="empty"><strong>No students yet</strong><p>Names appear here as students join the classroom.</p></div>';
  roster.querySelectorAll('[data-student-id]').forEach(button=>button.onclick=()=>select(button.dataset.studentId));
 }
 async function select(id){
  if(!teacher)return;
  const target=selectedId===id?null:id;
  try{
   await request('board',{token,operation:'select',studentId:target});
   selectedId=target;rosterSignature='';renderRoster();
   say(target?'The selected student can now edit the board.':'All students are view-only.');
   lastVersion=-1;await refresh(true);
  }catch(error){say('Could not change drawing permission: '+error.message,true)}
 }
 async function refresh(force=false){
  if(destroyed||inflight||!document.contains(root))return;
  inflight=true;
  try{
   const data=await request('board',{token,operation:'read',since:force?-1:lastVersion});
   if(destroyed)return;
   loaded=true;const was=canDraw;canDraw=teacher||Boolean(data.canDraw);
   selectedId=data.writerId??null;
   if(Array.isArray(data.strokes)){
    items=data.strokes;lastVersion=data.version;
    if(selected&&!items.some(x=>x.id===selected))selected=null;
    redraw();
   }else lastVersion=data.version;
   if(teacher){students=data.students||[];renderRoster()}
   if(was!==canDraw) {
    if(!canDraw&&dialog.open)cancelEditor();
    say(canDraw?'You may edit the shared canvas.':'View only. Ask your lecturer for editing permission.');
   }
   putPermission();
  }catch(error){if(!destroyed)say('Whiteboard connection issue: '+error.message,true)}
  finally{inflight=false}
 }
 async function control(op){
  try{
   if(op==='clear'&&!confirm('Erase all content on this classroom whiteboard?'))return;
   await request('board',{token,operation:op});selected=null;lastVersion=-1;await refresh(true);
   say(op==='clear'?'Whiteboard cleared.':'Last item removed.');
  }catch(error){say(error.message,true)}
 }
 function download(){
  const original=selected;selected=null;redraw();
  canvas.toBlob(blob=>{
   selected=original;redraw();
   if(!blob){say('Could not export image.',true);return}
   const url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download='classroom-whiteboard.png';document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2500);
  },'image/png');
 }
 root.querySelectorAll('[data-wb-tool]').forEach(button=>button.onclick=()=>chooseTool(button.dataset.wbTool));
 root.querySelectorAll('[data-color]').forEach(button=>button.onclick=()=>{
  localColor=button.dataset.color;
  root.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('selected',b===button));
 });
 $('wb-size').onchange=e=>{localWidth=Number(e.target.value)||4};
 $('wb-editor-form').onsubmit=saveEditor;
 $('wb-editor-cancel').onclick=cancelEditor;
 $('wb-edit').onclick=editSelected;
 $('wb-delete').onclick=removeSelected;
 if(teacher){$('wb-clear').onclick=()=>control('clear');$('wb-undo').onclick=()=>control('undo')}
 $('wb-download').onclick=download;
 $('wb-fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement===$('wb-stage'))await document.exitFullscreen();
    else await $('wb-stage').requestFullscreen()}
  catch{say('Fullscreen unavailable on this device.',true)}
 };
 canvas.addEventListener('pointerdown',pointerDown);
 canvas.addEventListener('pointermove',pointerMove);
 canvas.addEventListener('pointerup',pointerUp);
 canvas.addEventListener('pointercancel',()=>{draft=null;lastVersion=-1;void refresh(true)});
 canvas.addEventListener('dblclick',handleDoubleClick);
 canvas.addEventListener('keydown',event=>{
  if(canDraw&&selected&&(event.key==='Delete'||event.key==='Backspace')){
   event.preventDefault();void removeSelected();
  }
 });
 putPermission();redraw();void refresh();
 refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},1700);
 return {destroy(){
  destroyed=true;if(refreshTimer)clearInterval(refreshTimer);
  if(dialog.open)dialog.close();root.replaceChildren()
 },refresh(){return refresh()}};
}
