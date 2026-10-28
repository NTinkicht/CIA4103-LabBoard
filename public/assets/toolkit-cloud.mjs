// Low-latency Word Cloud display. Keeps word nodes stable between snapshots,
// polls an inexpensive projection instead of rebuilding the full classroom UI.
const COLORS=['#176fbb','#0f907d','#7257a8','#c47d37','#3c5d80','#ac5274'];
const NORMAL=640, HIDDEN=8000;
const hash=word=>[...word].reduce((v,c)=>((v*33+c.codePointAt(0))>>>0),5381);
const label=word=>word.trim().replace(/\s+/g,' ');
const keyOf=word=>label(word).toLocaleLowerCase();
export function createLiveCloud(root,{request,token,roundId,role}){
 const projector=role==='display';
 let destroyed=false,loading=false,version=-1,first=true,visible=false,seen=new Set(),timer=null,failures=0;
 const words=new Map();
 root.innerHTML='<section class="live-word-cloud" aria-label="Live Word Cloud">'+
  '<header class="cloud-bar"><div><p class="eyebrow">LIVE WORD CLOUD</p><h3>Ideas from your classroom</h3></div>'+
  '<div class="cloud-metrics"><span class="cloud-live-dot" aria-hidden="true"></span>'+
  '<strong id="cloud-count">0</strong><span id="cloud-count-label">responses</span></div></header>'+
  '<div id="cloud-stage" class="cloud-stage">'+
  '<div id="cloud-empty" class="cloud-empty"><span class="cloud-empty-icon" aria-hidden="true">☁</span>'+
  '<strong>Words will appear here live</strong><p>Ask students for one word or short phrase.</p></div>'+
  '<div id="cloud-words" class="cloud-words" aria-live="off"></div>'+
  '<div id="cloud-rain" class="cloud-rain" aria-hidden="true"></div></div>'+
  '<footer class="cloud-foot"><span id="cloud-sync">Connecting…</span><span id="cloud-last-word" aria-live="polite"></span></footer>'+
  '</section>';
 const el=id=>root.querySelector('#'+id);
 const stage=el('cloud-stage'),list=el('cloud-words'),rain=el('cloud-rain');
 const showEmpty=(msg,desc)=>{
  const empty=el('cloud-empty');empty.hidden=false;
  empty.querySelector('strong').textContent=msg;
  empty.querySelector('p').textContent=desc||'';
 };
 const font=count=>Math.min(62,Math.round(20+13*Math.sqrt(Math.max(1,count))));
 function drop(value){
  if(destroyed||document.hidden||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(rain.childElementCount>=8)rain.firstChild?.remove();
  const node=document.createElement('span');
  node.className='cloud-droplet';node.textContent=value;
  node.style.setProperty('--cloud-x',(10+hash(value)%78)+'%');
  node.style.color=COLORS[hash(value)%COLORS.length];
  rain.append(node);
  node.addEventListener('animationend',()=>node.remove(),{once:true});
 }
 function redraw(items,total,events){
  el('cloud-count').textContent=String(total);
  el('cloud-count-label').textContent=total===1?'response':'responses';
  const incoming=new Set(items.map(w=>keyOf(w.word)));
  for(const [id,node] of words){
   if(!incoming.has(id)){node.remove();words.delete(id)}
  }
  for(const word of items){
   const id=keyOf(word.word);
   if(!id)continue;
   let node=words.get(id),created=false;
   if(!node){
    node=document.createElement('span');
    node.className='cloud-word-live cloud-new';
    node.style.color=COLORS[hash(id)%COLORS.length];
    node.dataset.cloudKey=id;
    node.addEventListener('animationend',()=>node.classList.remove('cloud-new','cloud-grow'));
    list.append(node);words.set(id,node);created=true;
   }
   const count=Number(word.count)||1;
   const old=Number(node.dataset.count||0);
   node.textContent=word.word;
   node.title=count+' '+(count===1?'response':'responses');
   node.dataset.count=String(count);
   node.style.fontSize=font(count)+'px';
   if(!created&&old!==count&&!first){
    node.classList.remove('cloud-grow');
    void node.offsetWidth; // restart gentle size pulse without replacing the node
    node.classList.add('cloud-grow');
   }
  }
  el('cloud-empty').hidden=items.length>0;
  const eventsList=Array.isArray(events)?events:[];
  if(first){
   // An existing classroom should not replay the entire history as new rain.
   for(const event of eventsList)seen.add(event.id);
   first=false;
  }else{
   for(const event of eventsList){
    if(!event?.id||seen.has(event.id))continue;
    seen.add(event.id);
    if(seen.size>200)seen=new Set([...seen].slice(-120));
    const value=label(String(event.value||''));
    if(value){drop(value);el('cloud-last-word').textContent='Just added: '+value}
   }
  }
 }
 async function sync(){
  if(destroyed||loading||!document.contains(root))return;
  loading=true;
  try{
   const data=await request('cloud-live',{token,roundId,since:version});
   if(destroyed)return;
   failures=0;
   el('cloud-sync').textContent='● Live updates';
   if(!data.visible){
    visible=false;version=-1;first=true;seen.clear();words.clear();
    list.replaceChildren();rain.replaceChildren();
    el('cloud-count').textContent='0';el('cloud-count-label').textContent='responses';
    showEmpty('Results are hidden','The lecturer will reveal the word cloud when ready.');
    return;
   }
   visible=true;
   if(data.unchanged)return;
   version=data.version;
   redraw(data.words||[],Number(data.total)||0,data.events||[]);
  }catch(error){
   if(destroyed)return;
   failures++;
   el('cloud-sync').textContent='Reconnecting to live words…';
   if(failures===1)el('cloud-last-word').textContent='Live feed briefly delayed';
  }finally{loading=false}
 }
 function schedule(){
  if(destroyed)return;
  const delay=document.hidden?HIDDEN:Math.min(3000,NORMAL*Math.max(1,failures));
  timer=setTimeout(async()=>{await sync();schedule()},delay);
 }
 void sync().finally(schedule);
 return {
  refresh:sync,
  destroy(){
   destroyed=true;if(timer!==null)clearTimeout(timer);
   root.replaceChildren();words.clear();seen.clear();
  }
 };
}
