import {createHmac,createHash,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';

const STORE='classroom-toolkit-v1';
const HEAD={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:HEAD});
const fail=(status,error)=>reply({error},status);
const key=(kind,...parts)=>[kind,...parts].join('/');
const secret=()=>process.env.TOOLKIT_SESSION_SECRET||process.env.LIVEKIT_API_SECRET||'';
const pinOk=(value)=>{
  const expected=process.env.CIA4103_TEACHER_PIN||'';
  if(typeof value!=='string'||expected.length<12)return false;
  const a=createHash('sha256').update(value).digest(),b=createHash('sha256').update(expected).digest();
  return timingSafeEqual(a,b);
};
const signed=(claims)=>{
  const value=Buffer.from(JSON.stringify(claims)).toString('base64url');
  return value+'.'+createHmac('sha256',secret()).update(value).digest('base64url');
};
const verify=(value)=>{
  if(typeof value!=='string'||value.length>2200)return null;
  const parts=value.split('.');
  if(parts.length!==2)return null;
  const sig=createHmac('sha256',secret()).update(parts[0]).digest();
  let given;
  try{given=Buffer.from(parts[1],'base64url');}catch{return null}
  if(sig.length!==given.length||!timingSafeEqual(sig,given))return null;
  try{
    const data=JSON.parse(Buffer.from(parts[0],'base64url').toString());
    if(data.exp<Date.now()||!['teacher','student','display'].includes(data.role)||!/^[0-9]{6}$/.test(data.code))return null;
    return data;
  }catch{return null}
};
export const validText=(v,max)=>typeof v==='string'&&v.trim().length<=max&& !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v);
const get=async(store,k)=>store.get(k,{type:'json',consistency:'strong'});
async function change(store,k,mutate){
  for(let i=0;i<4;i++){
    const old=await store.getWithMetadata(k,{type:'json',consistency:'strong'});
    if(!old?.data)return null;
    const updated=mutate(old.data);
    if(updated?.error)return updated;
    const result=await store.setJSON(k,updated,{onlyIfMatch:old.etag});
    if(result.modified)return updated;
  }
  return {error:'Concurrent update. Please retry.'};
}
async function entries(store,prefix,cap=150){
  const list=await store.list({prefix});
  const blobs=list.blobs.slice(0,cap);
  return (await Promise.all(blobs.map(b=>get(store,b.key).catch(()=>null)))).filter(Boolean);
}
const publicRound=r=>r&&({id:r.id,type:r.type,prompt:r.prompt||'',options:r.options||[],unit:r.unit,status:r.status,endsAt:r.endsAt||null,revealed:!!r.revealed});
export function aggregate(round,answers){
  const shown=answers.filter(a=>!a.hidden);
  const count=shown.length;
  if(round.type==='poll'){
    const votes=round.options.map(()=>0);
    for(const a of shown)if(Number.isInteger(a.value)&&a.value>=0&&a.value<votes.length)votes[a.value]++;
    return {total:count,votes};
  }
  if(round.type==='cloud'){
    const words=new Map();
    for(const a of shown){
      const word=String(a.value).trim().replace(/\s+/g,' ');
      const token=word.toLocaleLowerCase();
      if(token)words.set(token,{word:words.get(token)?.word||word,count:(words.get(token)?.count||0)+1});
    }
    return {total:count,words:[...words.values()].sort((a,b)=>b.count-a.count).slice(0,75)};
  }
  return {total:count};
}
async function snapshot(store,room,claims){
  const round=room.active?await get(store,key('round',claims.code,room.active)):null;
  const result={code:claims.code,roomOpen:!room.ended,active:publicRound(round),serverTime:Date.now()};
  if(claims.role==='teacher')result.participants=(await entries(store,key('member',claims.code)+'/',250)).length;
  if(!round)return result;
  const answerPrefix=key('response',claims.code,round.id)+'/';
  if(claims.role==='teacher'){
    const items=await entries(store,answerPrefix,250);
    result.answers=items.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));
    result.results=aggregate(round,items);
  }else if(claims.role==='display'){
    if(round.revealed){
      const items=await entries(store,answerPrefix,250);
      result.results=aggregate(round,items);
      if(round.type==='answers')result.answers=items.filter(a=>!a.hidden).map(a=>({value:a.value,id:a.subject}));
    }
  }else{
    const subject=round.unit==='pair'?(claims.team||''):claims.id;
    if(subject)result.mine=await get(store,key('response',claims.code,round.id,subject));
  }
  return result;
}
const bodyMax=12000;
export async function handleToolkit(request,storeProvider=getStore){
  if(request.method!=='POST')return fail(405,'POST only');
  if(Number(request.headers.get('content-length')||0)>bodyMax)return fail(413,'Payload too large');
  if(!request.headers.get('content-type')?.startsWith('application/json'))return fail(415,'JSON required');
  if(secret().length<24)return fail(503,'Classroom Toolkit signing secret is not configured');
  let data;
  try{const raw=await request.text();if(raw.length>bodyMax)return fail(413,'Payload too large');data=JSON.parse(raw)}catch{return fail(400,'Invalid JSON')}
  if(!data||typeof data!=='object'||Array.isArray(data))return fail(400,'Invalid request');
  try{
    const store=storeProvider({name:STORE,consistency:'strong'});
    if(data.action==='create'){
      if(!pinOk(data.pin))return fail(403,'Lecturer authentication failed');
      for(let i=0;i<12;i++){
        const code=String(randomInt(100000,1000000));
        const now=Date.now(),room={code,createdAt:now,expiresAt:now+4*3600000,active:null,ended:false};
        const saved=await store.setJSON(key('room',code),room,{onlyIfNew:true});
        if(!saved.modified)continue;
        return reply({code,teacherToken:signed({role:'teacher',code,exp:room.expiresAt}),displayToken:signed({role:'display',code,exp:room.expiresAt})},201);
      }
      return fail(503,'Could not allocate a classroom code');
    }
    if(data.action==='join'){
      const code=String(data.code||'');
      if(!/^[0-9]{6}$/.test(code))return fail(400,'Enter a valid 6-digit code');
      const room=await get(store,key('room',code));
      if(!room||room.ended||room.expiresAt<Date.now())return fail(404,'Classroom unavailable');
      const name=typeof data.name==='string'?data.name.trim():'';
      const team=typeof data.team==='string'?data.team.trim():'';
      if(!validText(name,60)||!validText(team,32))return fail(400,'Invalid name or team');
      if(!name)return fail(400,'Enter a display name');
      const id=randomUUID(),subject=team?'team-'+createHash('sha256').update(team.toLocaleLowerCase()).digest('hex').slice(0,24):'student-'+id;
      await store.setJSON(key('member',code,id),{id,name,team,joinedAt:Date.now()});
      return reply({code,token:signed({role:'student',code,id,name,team:team?subject:null,teamLabel:team,exp:room.expiresAt})},201);
    }
    const claims=verify(data.token);
    if(!claims)return fail(401,'Session token invalid or expired');
    const room=await get(store,key('room',claims.code));
    if(!room||room.ended||room.expiresAt<Date.now())return fail(410,'Classroom has ended');
    if(data.action==='state')return reply(await snapshot(store,room,claims));

    if(data.action==='library'){
      if(claims.role!=='teacher')return fail(403,'Only lecturers may manage saved polls');
      const operation=data.operation||'list',prefix='saved-poll/';
      const validPoll=(p)=>p&&typeof p==='object'&&!Array.isArray(p)&&
        validText(p.title,100)&&p.title.trim().length>=1&&validText(p.prompt,240)&&
        Array.isArray(p.options)&&p.options.length>=2&&p.options.length<=8&&
        p.options.every(o=>validText(o,60)&&o.trim().length>0);
      if(operation==='list'){
        const saved=(await entries(store,prefix,100)).filter(p=>!p.archived);
        return reply({polls:saved.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))});
      }
      if(operation==='save'){
        if(!validPoll(data.poll))return fail(400,'Enter a title and 2–8 valid choices');
        const payload={title:data.poll.title.trim(),prompt:data.poll.prompt.trim(),
          options:data.poll.options.map(o=>o.trim()),unit:data.poll.unit==='pair'?'pair':'individual'};
        const id=data.id||randomUUID();
        if(!/^[a-f0-9-]{36}$/.test(id))return fail(400,'Invalid saved poll ID');
        const path=key('saved-poll',id),old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
        const expected=Number(data.revision||0);
        if((old?.data?.revision||0)!==expected||old?.data?.archived)return fail(409,'Saved poll was changed in another tab. Reload your library');
        if(!old){
          const count=(await store.list({prefix})).blobs.length;
          if(count>=100)return fail(409,'Saved poll library is full (100 maximum)');
        }
        const result={id,...payload,revision:expected+1,createdAt:old?.data?.createdAt||new Date().toISOString(),
          updatedAt:new Date().toISOString(),archived:false};
        const saved=await store.setJSON(path,result,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        if(!saved.modified)return fail(409,'Concurrent update. Reload your saved polls');
        return reply({poll:result},old?200:201);
      }
      if(operation==='delete'){
        if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))return fail(400,'Invalid saved poll ID');
        const changed=await change(store,key('saved-poll',data.id),p=>({...p,archived:true,revision:p.revision+1,updatedAt:new Date().toISOString()}));
        return changed?.error?fail(409,changed.error):changed?reply({ok:true}):fail(404,'Saved poll not found');
      }
      return fail(400,'Unknown library operation');
    }

    if(data.action==='start'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(!['poll','answers','cloud','timer'].includes(data.type))return fail(400,'Invalid tool');
      const prompt=typeof data.prompt==='string'?data.prompt.trim():'';
      if(!validText(prompt,240))return fail(400,'Prompt too long');
      const unit=data.unit==='pair'?'pair':'individual';
      const options=data.type==='poll'?(Array.isArray(data.options)?data.options:[]):[];
      if(data.type==='poll'&&(options.length<2||options.length>8||options.some(o=>!validText(o,60)||!o.trim())))return fail(400,'Poll needs 2–8 short options');
      const duration=data.type==='timer'?Number(data.duration):0;
      if(data.type==='timer'&&(!Number.isInteger(duration)||duration<10||duration>7200))return fail(400,'Timer must be 10–7200 seconds');
      const id=randomUUID(),now=Date.now();
      const round={id,type:data.type,prompt,unit,options:options.map(s=>s.trim()),status:'open',createdAt:now,revealed:false,endsAt:duration?now+duration*1000:null};
      await store.setJSON(key('round',claims.code,id),round,{onlyIfNew:true});
      const updated=await change(store,key('room',claims.code),prev=>({...prev,active:id}));
      if(updated?.error)return fail(409,updated.error);
      return reply({active:publicRound(round)});
    }
    if(data.action==='control'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(data.control==='end'){
        const updated=await change(store,key('room',claims.code),prev=>({...prev,ended:true}));
        return updated?.error?fail(409,updated.error):reply({ok:true});
      }
      if(!['close','reveal','hide'].includes(data.control))return fail(400,'Invalid control');
      if(!room.active||data.roundId!==room.active)return fail(409,'Activity changed. Refresh the classroom before updating controls');
      const updated=await change(store,key('round',claims.code,room.active),r=>({...r,status:data.control==='close'?'closed':r.status,revealed:data.control==='reveal'?true:data.control==='hide'?false:r.revealed}));
      return updated?.error?fail(409,updated.error):reply({active:publicRound(updated)});
    }
    if(data.action==='submit'){
      if(claims.role!=='student')return fail(403,'Student only');
      if(!room.active)return fail(409,'No active activity');
      const round=await get(store,key('round',claims.code,room.active));
      if(!round||round.status!=='open'||round.type==='timer'||data.roundId!==round.id)return fail(409,'Activity changed or is no longer accepting answers');
      let value=data.value;
      if(round.type==='poll'){
        if(!Number.isInteger(value)||value<0||value>=round.options.length)return fail(400,'Invalid option');
      }else if(round.type==='cloud'){
        if(!validText(value,40)||!value.trim())return fail(400,'Enter one word or short phrase');
        value=value.trim().replace(/\s+/g,' ');
      }else{
        if(!validText(value,500)||!value.trim())return fail(400,'Enter a short answer');
        value=value.trim();
      }
      const subject=round.unit==='pair'?claims.team:claims.id;
      if(!subject)return fail(409,'This activity requires a pair. Rejoin with a team name');
      const path=key('response',claims.code,round.id,subject);
      const old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
      const expected=Number(data.revision||0);
      if((old?.data?.revision||0)!==expected)return fail(409,'Answer changed on another device. Refresh before resubmitting');
      const answer={subject,value,revision:expected+1,submittedAt:new Date().toISOString(),name:round.unit==='pair'?'Pair '+claims.teamLabel:claims.name,hidden:old?.data?.hidden??(round.type==='answers')};
      const saved=await store.setJSON(path,answer,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
      if(!saved.modified)return fail(409,'Simultaneous edit. Refresh and retry');
      return reply({ok:true,revision:answer.revision});
    }
    if(data.action==='moderate'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(typeof data.subject!=='string'||!/^[a-z0-9-]{10,100}$/i.test(data.subject)||!room.active||data.roundId!==room.active)return fail(409,'Activity changed. Refresh before moderating');
      const changed=await change(store,key('response',claims.code,room.active,data.subject),r=>({...r,hidden:!!data.hidden}));
      return changed?.error?fail(409,changed.error):changed?reply({ok:true}):fail(404,'Answer missing');
    }
    return fail(400,'Unknown action');
  }catch(error){
    console.error('Classroom Toolkit request failed',error?.name);
    return fail(503,'Classroom service unavailable. Retry.');
  }
}

export default function handler(request){return handleToolkit(request)}
