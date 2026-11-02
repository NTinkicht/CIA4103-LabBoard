// Optional 5Es lesson plan model. The existing Free Mode remains the default.
export const PHASES=Object.freeze(['Engage','Explore','Explain','Extend','Evaluate']);
export const LESSON_TOOLS=Object.freeze(['poll','answers','cloud','screen','whiteboard','document','work','mcq','jumbled','documents','web']);

export function normalizeLesson(input={}){
 const phases=Array.isArray(input.phases)?input.phases:[];
 return {title:String(input.title||'Untitled lesson').slice(0,120),phases:PHASES.map((name,index)=>{
  const source=phases[index]||{};
  return {name,duration:Math.max(1,Math.min(120,Number.isFinite(+source.duration)?Math.round(+source.duration):15)),notes:String(source.notes||'').slice(0,2000),tool:LESSON_TOOLS.includes(source.tool)?source.tool:'poll'};
 })};
}

export function validLesson(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.title!=='string'||
    !input.title.trim()||input.title.length>120||!Array.isArray(input.phases)||input.phases.length!==5)return null;
 for(let i=0;i<5;i++){
  const p=input.phases[i];
  if(!p||p.name!==PHASES[i]||!LESSON_TOOLS.includes(p.tool)||
     !Number.isInteger(p.duration)||p.duration<1||p.duration>120||
     typeof p.notes!=='string'||p.notes.length>2000||
     /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p.notes))return null;
 }
 return normalizeLesson(input);
}
