// Shared whiteboard — one room, one lecturer and one selected student writer.
// Drawings use canonical 1000x600 coordinates. Only completed strokes are sent;
// every append is checked against current server permissions and CAS version.
const COLORS=['#24374f','#1976bd','#169b83','#dc8743','#c54b58','#ffffff'];
const WIDTHS=[2,4,7,11];
const escapeHtml=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountWhiteboard(root,{request,token,role}){
  let destroyed=false,loaded=false,inflight=false,lastVersion=-1,strokes=[],students=[],selectedId=null;
  let canDraw=role==='teacher',draft=null,localColor=COLORS[0],localWidth=4,refreshTimer=null,rosterSignature='';
  const teacher=role==='teacher';
  root.innerHTML='<section class="wb-root"><div class="wb-topbar">'+
    '<div><p class="eyebrow">Collaborative canvas</p><h3>Shared whiteboard</h3><p class="small">Everyone sees the same board. The lecturer chooses who may write.</p></div>'+
    '<span class="pill grey" id="wb-permission">Connecting…</span></div>'+
    '<div class="wb-tools">'+
    '<div class="wb-swatches" role="group" aria-label="Pen color">'+COLORS.map((c,i)=>'<button type="button" class="wb-swatch'+(i===0?' selected':'')+'" aria-label="'+(i===5?'Eraser':'Color '+(i+1))+'" title="'+(i===5?'White eraser':'Pen color')+'" data-color="'+c+'" style="--swatch:'+c+'">'+(i===5?'⌫':'')+'</button>').join('')+'</div>'+
    '<label for="wb-size">Pen size</label><select id="wb-size"><option value="2">Fine</option><option value="4" selected>Normal</option><option value="7">Bold</option><option value="11">Very bold</option></select>'+
    (teacher?'<button type="button" class="ghost" id="wb-undo">↶ Undo</button><button type="button" class="ghost" id="wb-clear">Clear board</button>':'')+
    '<button type="button" class="secondary" id="wb-download">↓ Save image</button>'+
    '<button type="button" class="secondary" id="wb-fullscreen">⛶ Fullscreen</button>'+
    '</div>'+
    '<div class="wb-body'+(teacher?' teacher':'')+'"><div class="wb-main"><div class="wb-canvas-wrap" id="wb-stage">'+
    '<canvas id="wb-canvas" width="1000" height="600" aria-label="Shared whiteboard drawing area"></canvas></div>'+
    '<p class="wb-status" id="wb-status" role="status" aria-live="polite">Loading the classroom whiteboard…</p></div>'+
    (teacher?'<aside class="wb-sidebar" aria-label="Students in classroom"><div class="wb-side-title"><h3>Students</h3><span class="pill grey" id="wb-count">0</span></div>'+
      '<p class="small">Select one student to write alongside you. Select again to return everyone to view-only.</p><div id="wb-roster" class="wb-roster"></div></aside>':'')+
    '</div></section>';
  const canvas=root.querySelector('#wb-canvas'),ctx=canvas.getContext('2d'),status=root.querySelector('#wb-status');
  const permission=root.querySelector('#wb-permission');
  const say=(s,bad=false)=>{status.textContent=s;status.classList.toggle('error',bad)};
  const putPermission=()=>{
    const text=teacher?'Lecturer · Can write':canDraw?'✓ You can write':'View only · Teacher selects writer';
    permission.textContent=text;permission.className='pill '+(canDraw?'blue':'grey');
    canvas.style.cursor=canDraw?'crosshair':'not-allowed';
    canvas.setAttribute('aria-disabled',String(!canDraw));
  };
  function drawStroke(stroke){
    if(!stroke?.points?.length)return;
    ctx.beginPath();
    ctx.strokeStyle=stroke.color;ctx.lineWidth=stroke.width;ctx.lineJoin='round';ctx.lineCap='round';
    for(let i=0;i<stroke.points.length;i++){
      const [x,y]=stroke.points[i];if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  function redraw(){
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,1000,600);
    for(const stroke of strokes)drawStroke(stroke);
    if(draft)drawStroke(draft);
  }
  function at(event){
    const rect=canvas.getBoundingClientRect();
    return [Math.max(0,Math.min(1000,Math.round((event.clientX-rect.left)*1000/rect.width))),
      Math.max(0,Math.min(600,Math.round((event.clientY-rect.top)*600/rect.height)))];
  }
  function pointerDown(event){
    if(!canDraw||event.button!==0||!loaded)return;
    event.preventDefault();
    const p=at(event);
    draft={points:[p,p],color:localColor,width:localWidth};
    try{canvas.setPointerCapture(event.pointerId)}catch{}
    redraw();
  }
  function pointerMove(event){
    if(!draft)return;
    event.preventDefault();
    const p=at(event),previous=draft.points.at(-1);
    if(draft.points.length>=119)return;
    if(Math.hypot(p[0]-previous[0],p[1]-previous[1])<2)return;
    draft.points.push(p);drawStroke(draft); // incremental visual response
  }
  async function pointerUp(event){
    if(!draft)return;
    event.preventDefault();
    const completed=draft;draft=null;
    const p=at(event);
    if(completed.points.length<120)completed.points.push(p);
    // Keep an optimistic stroke while waiting; authoritative refresh replaces it.
    strokes.push(completed);
    redraw();
    try{
      await request('board',{token,operation:'stroke',points:completed.points,
        color:completed.color,width:completed.width});
      // A remote refresh will reconcile; use an immediate fetch for correctness.
      lastVersion=-1;await refresh();
      say('Stroke saved on the classroom board.');
    }catch(e){
      strokes=strokes.filter(s=>s!==completed);
      redraw();say('Drawing was not saved: '+e.message,true);
      lastVersion=-1;await refresh();
    }
  }
  function renderRoster(){
    if(!teacher)return;
    const sig=students.map(s=>s.id+':'+s.name+':'+s.team).join('|')+'|'+selectedId;
    if(sig===rosterSignature)return;
    rosterSignature=sig;
    root.querySelector('#wb-count').textContent=String(students.length);
    const el=root.querySelector('#wb-roster');
    el.innerHTML=students.length?students.map(student=>{
      const chosen=student.id===selectedId;
      return '<button type="button" class="wb-person'+(chosen?' chosen':'')+'" data-student-id="'+student.id+'" aria-pressed="'+chosen+'">'+
        '<span class="wb-avatar" aria-hidden="true">'+escapeHtml(student.name.trim().charAt(0).toUpperCase()||'?')+'</span>'+
        '<span class="wb-person-info"><strong>'+escapeHtml(student.name)+'</strong><small>'+escapeHtml(student.team||'Student')+' · '+student.id.slice(0,5)+'</small></span>'+
        '<span class="wb-person-right">'+(chosen?'✎ Writing':'Select')+'</span></button>';
    }).join(''):'<div class="empty"><strong>No students yet</strong><p>Names appear here as students join this classroom.</p></div>';
    el.querySelectorAll('[data-student-id]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.studentId)));
  }
  async function select(id){
    if(!teacher)return;
    const target=selectedId===id?null:id;
    try{
      await request('board',{token,operation:'select',studentId:target});
      selectedId=target;rosterSignature='';renderRoster();
      say(target?'The selected student can now write on the board.':'Students are now view-only.');
      lastVersion=-1;await refresh();
    }catch(e){say('Unable to change drawing permission: '+e.message,true)}
  }
  async function refresh(){
    if(destroyed||inflight||!document.contains(root))return;
    inflight=true;
    try{
      const data=await request('board',{token,operation:'read',since:lastVersion});
      if(destroyed)return;
      loaded=true;
      const previousCanDraw=canDraw;
      canDraw=teacher||Boolean(data.canDraw);
      selectedId=data.writerId??null;
      if(Array.isArray(data.strokes)){
        strokes=data.strokes;
        lastVersion=data.version;
        redraw();
      }else lastVersion=data.version;
      if(teacher){students=data.students||[];renderRoster()}
      if(previousCanDraw!==canDraw||!loaded){
        say(canDraw?'You can draw using the pen or mouse. Changes appear across the classroom.':
          'You are watching the whiteboard. Your lecturer will select you when it is your turn to write.');
      }
      putPermission();
    }catch(e){if(!destroyed)say('Whiteboard connection issue: '+e.message,true)}
    finally{inflight=false}
  }
  async function control(op){
    try{
      if(op==='clear'&&!confirm('Erase all content on this classroom whiteboard?'))return;
      await request('board',{token,operation:op});lastVersion=-1;await refresh();
      say(op==='clear'?'Whiteboard cleared.':'Last stroke removed.');
    }catch(e){say(e.message,true)}
  }
  function download(){
    canvas.toBlob(blob=>{
      if(!blob){say('Could not export image',true);return}
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='classroom-whiteboard.png';document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2500);
    },'image/png');
  }
  for(const swatch of root.querySelectorAll('[data-color]')){
    swatch.addEventListener('click',()=>{
      localColor=swatch.dataset.color;
      root.querySelectorAll('[data-color]').forEach(b=>b.classList.toggle('selected',b===swatch));
    });
  }
  root.querySelector('#wb-size').onchange=e=>{localWidth=Number(e.target.value)||4};
  if(teacher){
    root.querySelector('#wb-clear').onclick=()=>control('clear');
    root.querySelector('#wb-undo').onclick=()=>control('undo');
  }
  root.querySelector('#wb-download').onclick=download;
  root.querySelector('#wb-fullscreen').onclick=async()=>{
    const stage=root.querySelector('#wb-stage');
    try{if(document.fullscreenElement===stage)await document.exitFullscreen();else await stage.requestFullscreen()}
    catch(e){say('Fullscreen unavailable on this device.',true)}
  };
  canvas.addEventListener('pointerdown',pointerDown);
  canvas.addEventListener('pointermove',pointerMove);
  canvas.addEventListener('pointerup',pointerUp);
  canvas.addEventListener('pointercancel',()=>{draft=null;redraw()});
  putPermission();redraw();void refresh();
  refreshTimer=setInterval(()=>{if(document.visibilityState==='visible')void refresh()},1700);
  return {destroy(){destroyed=true;if(refreshTimer)clearInterval(refreshTimer);root.replaceChildren()},
    refresh(){return refresh()}};
}
