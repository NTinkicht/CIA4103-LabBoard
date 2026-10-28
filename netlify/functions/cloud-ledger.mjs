// A compact CAS-backed room/round word-cloud projection.
// Each student contributes one current word; repeated submissions update,
// rather than duplicate, their response. Revision checks make concurrent
// updates safe even if two requests complete out of order.
export function cloudProjection(ledger){
 const words=new Map(),subjects=Object.values(ledger.subjects||{});
 let total=0;
 for(const entry of subjects){
  if(entry.hidden||typeof entry.value!=='string'||!entry.value.trim())continue;
  const display=entry.value.trim().replace(/\s+/g,' '),key=display.toLocaleLowerCase();
  const previous=words.get(key);
  if(previous)previous.count++;
  else words.set(key,{word:display,count:1});
  total++;
 }
 return {total,words:[...words.values()].sort((a,b)=>b.count-a.count||a.word.localeCompare(b.word)).slice(0,75)};
}
export function cloudAccept(ledger,{subject,value,revision,hidden,eventId=null,at=Date.now()}){
 const current=ledger||{version:0,subjects:{},events:[]};
 const old=current.subjects?.[subject];
 if(old&&old.revision>revision)return current; // newer answer already won
 if(old&&old.revision===revision&&old.value===value&&old.hidden===hidden)return current;
 const subjects={...current.subjects,[subject]:{value,revision,hidden}};
 // A new submission event produces a single animation on connected screens.
 const events=eventId&&!hidden?[...(current.events||[]),{id:eventId,value,at}].slice(-48):(current.events||[]);
 return {version:(current.version||0)+1,subjects,events};
}
