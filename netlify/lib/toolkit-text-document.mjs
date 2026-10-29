// Template questions and per-student answers are intentionally plain text.
// Never treat submitted content as trusted HTML.
const good=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&
 !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
export function validateDocumentTemplate(v){
 if(!v||!good(v.title,100)||!Array.isArray(v.questions)||v.questions.length<1||v.questions.length>8||
 v.questions.some(q=>!good(q,260)))return null;
 return {title:v.title.trim(),questions:v.questions.map(q=>q.trim())};
}
export function validateDocumentAnswers(questions,value){
 if(!Array.isArray(questions)||!Array.isArray(value)||value.length!==questions.length||
 value.some(a=>typeof a!=='string'||a.length>1200||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(a))||
 !value.some(a=>a.trim().length))return null;
 return value.map(a=>a.trim());
}
