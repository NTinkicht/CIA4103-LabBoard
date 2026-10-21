import {randomUUID} from 'node:crypto';
import {inspect,detectLanguage,taskFromText,LANGS} from '../../public/assets/checker.mjs';
const validTypes=new Set(['help','display']);
export const validTask=x=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=100&&!/[\x00-\x1f\x7f]/.test(x);
export function validatePost(p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid submission.');
 if(!validTask(p.part))throw Error('Enter a lab or activity (maximum 100 characters).');
 if(!validTypes.has(p.type))throw Error('Choose Need help or I display.');
 // Language is inferred from source code; do not trust a user-provided field.
 if(typeof p.code!=='string'||p.code.length>8000)throw Error('Code must be under 8,000 characters.');
 if(typeof p.note!=='string'||p.note.length>800)throw Error('Description must be under 800 characters.');
 const code=p.code.replaceAll('\r\n','\n').trim(),note=p.note.trim();
 if(typeof p.name!=='string')throw Error('Enter your name before posting.');
 const name=(p.name||'').trim();
 if(!name||name.length>60||/[\x00-\x1f\x7f]/.test(name))throw Error('Enter a name of 1–60 characters, without control characters.');
 if(!code&&!note&&!p.image)throw Error('Add code, a description or a screenshot.');
 let image=null;
 if(p.image!=null){
  if(typeof p.image!=='object'||!['image/png','image/jpeg','image/webp'].includes(p.image.mime)||typeof p.image.base64!=='string'||p.image.base64.length>2750000||!/^[A-Za-z0-9+/]+={0,2}$/.test(p.image.base64))throw Error('Screenshot must be a PNG, JPG or WebP under 2 MB.');
  image={mime:p.image.mime,base64:p.image.base64};
 }
 return {part:p.part.trim(),type:p.type,lang:detectLanguage(code),code,note,image,name};
}
export function makeRecord(p,imageId=null){
 const diagnostics=p.code?inspect(p.code,p.lang,taskFromText(p.part)):{status:'no-code',issues:[],note:'Screenshot or description only.'};
 return {id:randomUUID(),submittedAt:new Date().toISOString(),part:p.part,type:p.type,lang:p.lang,code:p.code,note:p.note,name:p.name||'',imageId,diagnostics};
}
export async function listPosts(store,{part='all',range='4h'}={}){
 if(part!=='all'&&!validTask(part))throw Error('Invalid lab activity filter.');
 if(!['1h','4h','24h','all'].includes(range))throw Error('Unknown time range.');
 const cutoff=range==='all'?-Infinity:Date.now()-({'1h':1,'4h':4,'24h':24}[range])*3600000;
 const result=await store.list({prefix:'post/'});
 const keys=result.blobs.map(b=>b.key).sort().reverse().slice(0,450);
 const records=await Promise.all(keys.map(k=>store.get(k,{type:'json',consistency:'strong'}).catch(()=>null)));
 return records.filter(p=>p&&validTask(p.part)&&validTypes.has(p.type)&&typeof p.code==='string'&&typeof p.note==='string'&&Number.isFinite(Date.parse(p.submittedAt))&&Date.parse(p.submittedAt)>=cutoff&&(part==='all'||p.part===part)).sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt)).slice(0,200);
}
export function makeCSV(posts){
 const cell=v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 const rows=[['Time','Lab task','Category','Name','Language','Description','Code','Checks','Screenshot URL'],...posts.map(p=>[p.submittedAt,p.part,p.type,p.name||'',p.lang,p.note,p.code,(p.diagnostics?.issues||[]).map(x=>'L'+x.line+': '+x.message).join(' | '),p.imageId?'/api/posts?image='+p.imageId:''])];
 return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n');
}
