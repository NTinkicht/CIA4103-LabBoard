import {randomInt} from 'node:crypto';
export const KINDS=['jumbled','mcq'];
export function validEvaluation(value){
 if(!value||!KINDS.includes(value.kind)||typeof value.title!=='string'||!value.title.trim()||value.title.length>100||
 typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>240)return null;
 if(value.kind==='mcq'){
  const options=value.options;
  if(!Array.isArray(options)||options.length<2||options.length>6||
    options.some(v=>typeof v!=='string'||!v.trim()||v.length>120)||
    !Number.isInteger(value.correct)||value.correct<0||value.correct>=options.length)return null;
  return {kind:'mcq',title:value.title.trim(),prompt:value.prompt.trim(),options:options.map(x=>x.trim()),correct:value.correct};
 }
 const steps=value.steps;
 if(!Array.isArray(steps)||steps.length<2||steps.length>10||
   steps.some(v=>typeof v!=='string'||!v.trim()||v.length>90))return null;
 return {kind:'jumbled',title:value.title.trim(),prompt:value.prompt.trim(),steps:steps.map(x=>x.trim())};
}
export function shuffledSteps(steps,choose=randomInt){
 const tiles=steps.map((text,i)=>({id:String(i),text}));
 for(let i=tiles.length-1;i>0;i--){const j=choose(i+1);[tiles[i],tiles[j]]=[tiles[j],tiles[i]]}
 if(tiles.length>1&&tiles.every((tile,i)=>tile.id===String(i))){
  const last=tiles.length-1;[tiles[0],tiles[last]]=[tiles[last],tiles[0]];
 }
 return tiles;
}
export function validateEvaluationSubmission(round,value){
 if(round.evalKind==='mcq')return Number.isInteger(value)&&value>=0&&value<round.options.length?value:null;
 const ids=round.tiles.map(t=>t.id);
 if(!Array.isArray(value)||value.length!==ids.length||
  value.some(x=>typeof x!=='string'||!ids.includes(x))||new Set(value).size!==ids.length)return null;
 return [...value];
}
export function evaluationCorrect(round,value){
 return round.evalKind==='mcq'?value===round.correct:
  Array.isArray(value)&&value.every((id,i)=>id===String(i));
}
export function studentEngagement(rounds,joinedAt,answers){
 const opportunities=rounds.filter(r=>r.startedAt>=joinedAt);
 const participated=opportunities.filter(r=>answers.has(r.id)).length;
 return {score:opportunities.length?Math.round(100*participated/opportunities.length):0,
  participated,opportunities:opportunities.length};
}
