import { randomUUID } from "node:crypto";

export const PARTS = [
  {id:"design",name:"1 · Design the data"},
  {id:"models",name:"2 · C# entity models"},
  {id:"connect",name:"3 · EF Core configuration"},
  {id:"migration",name:"4 · Migration and verification"}
];
const validParts = new Set(PARTS.map(x => x.id));
const validTypes = new Set(["help","display"]);
const safeText = value => typeof value === "string" ? value.replace(/\r\n/g,"\n").replace(/\u0000/g,"").trim() : "";

export function validateSubmission(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid submission.");
  if (!validParts.has(input.part)) throw new Error("Choose a lab part.");
  if (!validTypes.has(input.type)) throw new Error("Choose I need help with or I display.");
  const value = safeText(input.text);
  if (!value) throw new Error("Please paste an error or code example.");
  if (value.length > (input.type === "help" ? 1500 : 4000)) throw new Error("Your submission is too long.");
  if (/[\u0001-\u0008\u000b\u000e-\u001f]/.test(value)) throw new Error("Remove control characters.");
  return {part:input.part,type:input.type,text:value};
}

export async function savePost(store, input) {
  const clean = validateSubmission(input);
  const post = {id:randomUUID(),...clean,submittedAt:new Date().toISOString()};
  await store.setJSON("post/"+post.submittedAt+"/"+post.id,post);
  return {id:post.id,submittedAt:post.submittedAt};
}

export async function getPosts(store,opts={}) {
  const part = opts.part || "all", since = opts.since || "fourhours";
  if (part !== "all" && !validParts.has(part)) throw new Error("Unknown lab part.");
  if (!["hour","fourhours","day","all"].includes(since)) throw new Error("Unknown time range.");
  const after = opts.after || "";
  if (after && (typeof after !== "string" || !Number.isFinite(Date.parse(after)))) throw new Error("Invalid cursor timestamp.");
  const hours = {hour:1,fourhours:4,day:24};
  const cutoff = hours[since] ? Date.now()-hours[since]*3600000 : -Infinity;
  const found = await store.list({prefix:"post/"});
  const keys = found.blobs.map(b=>b.key).filter(k=>!after || k.slice(5,29)>after).sort().reverse().slice(0,300);
  const records = await Promise.all(keys.map(k=>store.get(k,{type:"json",consistency:"strong"}).catch(()=>null)));
  return records.filter(p=>p && validParts.has(p.part) && validTypes.has(p.type) && typeof p.text==="string" && Number.isFinite(Date.parse(p.submittedAt)) && Date.parse(p.submittedAt)>=cutoff && (part==="all" || part===p.part))
    .sort((a,b)=>Date.parse(b.submittedAt)-Date.parse(a.submittedAt))
    .map(p=>({id:p.id,part:p.part,type:p.type,text:p.text,submittedAt:p.submittedAt}));
}

function escapeCell(raw){
  let v=String(raw ?? "");
  if (/^\s*[=+@-]/.test(v)) v="'"+v;
  return '"'+v.replaceAll('"','""')+'"';
}
export function toCSV(posts) {
  const names=Object.fromEntries(PARTS.map(p=>[p.id,p.name]));
  const rows=[["Time","Lab part","Category","Anonymous submission"],...posts.map(p=>[p.submittedAt,names[p.part]||p.part,p.type==="help"?"I need help with":"I display",p.text])];
  return "\uFEFF"+rows.map(row=>row.map(escapeCell).join(",")).join("\r\n");
}
