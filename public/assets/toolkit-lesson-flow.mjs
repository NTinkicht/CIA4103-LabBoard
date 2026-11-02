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
