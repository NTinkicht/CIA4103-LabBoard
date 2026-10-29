import {createHmac,createHash,randomInt,randomUUID,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {cloudProjection,cloudAccept} from './cloud-ledger.mjs';
import {validateElement,validateUpdate,validateMoved} from './whiteboard-elements.mjs';
import {pickStudent} from '../lib/random-student.mjs';
import {studentParticipation} from '../lib/toolkit-participation.mjs';
import {validEvaluation,shuffledSteps,validateEvaluationSubmission,evaluationCorrect,studentEngagement} from '../lib/toolkit-evaluation.mjs';
import {validateDocumentTemplate,validateDocumentAnswers} from '../lib/toolkit-text-document.mjs';

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
async function updateCloudLedger(store,roomCode,roundId,entry){
 const path=key('cloud-fast',roomCode,roundId);
 for(let attempt=0;attempt<12;attempt++){
  const previous=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
  let baseline=previous?.data;
  if(!baseline){
    // Upgrade active rooms created by the older Word Cloud without dropping
    // students' already-saved words when the first new response arrives.
    const answers=await entries(store,key('response',roomCode,roundId)+'/',250);
    const subjects={};
    for(const answer of answers)if(answer.subject!==entry.subject)
      subjects[answer.subject]={value:answer.value,revision:answer.revision,hidden:answer.hidden};
    baseline={version:0,subjects,events:[]};
  }
  const next=cloudAccept(baseline,entry);
  if(previous?.data===next)return true;
  const result=await store.setJSON(path,next,previous?{onlyIfMatch:previous.etag}:{onlyIfNew:true});
  if(result.modified)return true;
 }
 return false;
}
async function recordEngagementCredit(store,roomCode,subject,roundId){
 // A single compact CAS record per individual/pair avoids re-reading the
 // entire answer history on every ~2.5 second student refresh.
 const path=key('engagement-credit',roomCode,subject);
 for(let i=0;i<15;i++){
  const old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
  const ids=old?.data?.roundIds||[];
  if(ids.includes(roundId))return true;
  const next={roundIds:[...ids,roundId].slice(-120)};
  const saved=await store.setJSON(path,next,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
  if(saved.modified)return true;
 }
 return false;
}
async function entries(store,prefix,cap=150){
  const list=await store.list({prefix});
  const blobs=list.blobs.slice(0,cap);
  return (await Promise.all(blobs.map(b=>get(store,b.key).catch(()=>null)))).filter(Boolean);
}
const publicRound=r=>{
 if(!r)return null;
 const ended=r.type==='evaluation'&&(r.status!=='open'||Date.now()>=r.endsAt);
 const result={id:r.id,type:r.type,prompt:r.prompt||'',options:r.options||[],unit:r.unit,
  status:ended?'closed':r.status,endsAt:r.endsAt||null,revealed:!!r.revealed};
 if(r.type==='text-document')result.questions=r.questions||[];
 if(r.type==='evaluation'){
  result.evalKind=r.evalKind;result.title=r.title;result.tiles=r.tiles||[];
  result.duration=r.duration;
  // Neither the correct option nor ordered sequence is released until the
  // lecturer explicitly reveals AND the timer is over (or round is closed).
  if(ended&&r.revealed){
   result.correctAnswer=r.evalKind==='mcq'?r.correct:r.steps;
   if(r.evalKind==='jumbled')result.correctIds=r.correctOrder;
  }
 }
 return result;
};
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
  let members=null;
  if(claims.role==='teacher'){
    members=await entries(store,key('member',claims.code)+'/',250);
    result.participants=members.length;
    // Student names and response status are lecturer-private. Never send
    // this list to student or projector snapshots.
    result.students=studentParticipation(members,round,[]);
  }
  if(claims.role==='student'){
    const joined=await get(store,key('member',claims.code,claims.id));
    const rounds=(room.engagementRounds||[]).filter(r=>r.startedAt>=Number(joined?.joinedAt||Infinity)||r.id===room.active);
    const [individual,pair]=await Promise.all([
      get(store,key('engagement-credit',claims.code,claims.id)),
      claims.team?get(store,key('engagement-credit',claims.code,claims.team)):Promise.resolve(null)
    ]);
    const personalIds=new Set(individual?.roundIds||[]),pairIds=new Set(pair?.roundIds||[]);
    const participated=new Set(rounds.filter(r=>
      r.unit==='pair'?pairIds.has(r.id):personalIds.has(r.id)).map(r=>r.id));
    result.engagement=studentEngagement(rounds,0,participated);
  }
  if(!round||round.type==='whiteboard')return result;
  const answerPrefix=key('response',claims.code,round.id)+'/';
  if(claims.role==='teacher'){
    const items=await entries(store,answerPrefix,250);
    result.students=studentParticipation(members,round,items);
    result.answers=items.sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt));
    result.results=aggregate(round,items);
    if(round.type==='evaluation'&&round.revealed&&publicRound(round).status==='closed')
      result.correctCount=items.filter(a=>evaluationCorrect(round,a.value)).length;
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
const bodyMax=700000; // Work screenshots are intentionally capped at 450 KB encoded; other routes remain validated.
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
    // Lightweight viewer-only update avoids roster/response listings on every frame.
    // This stays separate from the slower general classroom snapshot.
    if(data.action==='cloud-live'){
      if(!['teacher','display'].includes(claims.role))return fail(403,'Lecturer or projector only');
      if(!room.active||data.roundId!==room.active)return fail(409,'Activity changed');
      const round=await get(store,key('round',claims.code,room.active));
      if(!round||round.type!=='cloud')return fail(409,'Word cloud is not active');
      if(claims.role==='display'&&!round.revealed)
        return reply({roundId:round.id,visible:false,version:-1,total:0,words:[],events:[]});
      const ledger=await get(store,key('cloud-fast',claims.code,round.id));
      if(!ledger){
        // Migration path for word-cloud rounds started before this release.
        const answers=await entries(store,key('response',claims.code,round.id)+'/',250);
        return reply({roundId:round.id,visible:true,version:0,...aggregate(round,answers),events:[]});
      }
      if(Number.isInteger(data.since)&&data.since===ledger.version)
        return reply({roundId:round.id,visible:true,version:ledger.version,unchanged:true});
      return reply({roundId:round.id,visible:true,version:ledger.version,
        ...cloudProjection(ledger),events:ledger.events||[]});
    }


    if(data.action==='board'){
      const op=data.operation||'read',path=key('whiteboard',claims.code);
      const board=await get(store,path);
      const activeRound=room.active?await get(store,key('round',claims.code,room.active)):null;
      const isActive=activeRound?.type==='whiteboard';
      if(op==='activate'){
        if(claims.role!=='teacher')return fail(403,'Only lecturers may open the whiteboard');
        if(!board){
          await store.setJSON(path,{version:0,generation:0,writerId:null,strokes:[]},{onlyIfNew:true});
        }
        if(isActive)return reply({active:publicRound(activeRound)});
        const round={id:randomUUID(),type:'whiteboard',prompt:'Shared Whiteboard',status:'open',
          options:[],unit:'individual',createdAt:Date.now(),revealed:true,endsAt:null};
        await store.setJSON(key('round',claims.code,round.id),round,{onlyIfNew:true});
        const updated=await change(store,key('room',claims.code),r=>({...r,active:round.id}));
        return updated?.error?fail(409,updated.error):reply({active:publicRound(round)});
      }
      if(!board)return fail(409,'The lecturer has not opened a whiteboard yet');
      if(!isActive&&claims.role!=='teacher')return fail(409,'The whiteboard is not the active activity');
      if(op==='read'){
        const result={version:board.version,generation:board.generation,writerId:board.writerId,
          canDraw:claims.role==='teacher'||(claims.role==='student'&&board.writerId===claims.id),
          active:isActive};
        if(!Number.isInteger(data.since)||data.since!==board.version)result.strokes=board.strokes;
        if(claims.role==='teacher'){
          result.students=(await entries(store,key('member',claims.code)+'/',250))
            .map(m=>({id:m.id,name:m.name,team:m.team||'',selected:board.writerId===m.id}))
            .sort((a,b)=>a.name.localeCompare(b.name));
        }
        return reply(result);
      }
      if(!isActive)return fail(409,'Start the whiteboard before editing it');
      if(op==='random'){
        if(claims.role!=='teacher')return fail(403,'Lecturer only');
        const members=(await entries(store,key('member',claims.code)+'/',250))
          .filter(m=>typeof m.id==='string'&&typeof m.name==='string');
        if(!members.length)return fail(409,'No students have joined this classroom yet');
        // Select from the active classroom only; teacher remains able to write.
        const winner=pickStudent(members,board.writerId);
        const changed=await change(store,path,b=>({...b,writerId:winner.id,version:b.version+1}));
        return changed?.error?fail(409,changed.error):
          reply({ok:true,writerId:changed.writerId,name:winner.name});
      }
      if(op==='select'){
        if(claims.role!=='teacher')return fail(403,'Lecturer only');
        const id=data.studentId??null;
        if(id!==null){
          if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return fail(400,'Invalid student');
          const member=await get(store,key('member',claims.code,id));
          if(!member)return fail(404,'Student is not in this classroom');
        }
        const changed=await change(store,path,b=>({...b,writerId:id,version:b.version+1}));
        return changed?.error?fail(409,changed.error):reply({ok:true,writerId:changed.writerId});
      }
      if(op==='clear'||op==='undo'){
        if(claims.role!=='teacher')return fail(403,'Lecturer only');
        const updated=await change(store,path,b=>({...b,
          generation:op==='clear'?b.generation+1:b.generation,
          strokes:op==='clear'?[]:b.strokes.slice(0,-1),version:b.version+1}));
        return updated?.error?fail(409,updated.error):reply({ok:true,version:updated.version});
      }
      if(['element','edit','move','remove'].includes(op)){
        if(claims.role==='display')return fail(403,'Projector cannot change the whiteboard');
        const item=op==='element'?validateElement(data.element):null;
        if(op==='element'&&!item)return fail(400,'Invalid shape, table or text box');
        if(op!=='element'&&(typeof data.id!=='string'||!/^[0-9a-f-]{36}$/i.test(data.id)))
          return fail(400,'Invalid element ID');
        const changed=await change(store,path,board=>{
          if(claims.role==='student'&&board.writerId!==claims.id)
            return {error:'Drawing permission has been revoked. Ask your lecturer'};
          const objects=board.strokes||[];
          if(op==='element'){
            if(objects.length>=350)return {error:'Board is full. Clear it before adding more'};
            return {...board,version:board.version+1,strokes:[...objects,{
              id:randomUUID(),by:claims.role==='teacher'?'Lecturer':claims.name,
              ...item,createdAt:Date.now()
            }]};
          }
          const index=objects.findIndex(e=>e.id===data.id);
          if(index<0)return {error:'Selected element no longer exists'};
          const current=objects[index];
          if(!['shape','text','table'].includes(current.type))
            return {error:'Only objects can be edited or moved'};
          if(op==='remove')return {...board,version:board.version+1,
            strokes:objects.filter((_,i)=>i!==index)};
          const revised=op==='edit'?validateUpdate(current,data.changes):
            validateMoved(current,data.x,data.y);
          if(!revised)return {error:'Invalid object edit'};
          const next=[...objects];next[index]={...current,...revised};
          return {...board,version:board.version+1,strokes:next};
        });
        return changed?.error?fail(409,changed.error):reply({ok:true,version:changed.version});
      }
      if(op==='stroke'){
        if(claims.role==='display')return fail(403,'Projector cannot draw');
        const points=data.points,color=data.color,width=data.width;
        const colors=['#24374f','#1976bd','#169b83','#dc8743','#c54b58','#ffffff'];
        if(!Array.isArray(points)||points.length<2||points.length>120||
          !points.every(p=>Array.isArray(p)&&p.length===2&&Number.isInteger(p[0])&&Number.isInteger(p[1])&&
            p[0]>=0&&p[0]<=1000&&p[1]>=0&&p[1]<=600)||
          !colors.includes(color)||!Number.isInteger(width)||width<2||width>14)return fail(400,'Invalid whiteboard stroke');
        const stroke={id:randomUUID(),by:claims.role==='teacher'?'Lecturer':claims.name,
          points,color,width,createdAt:Date.now()};
        const updated=await change(store,path,b=>{
          if(claims.role==='student'&&b.writerId!==claims.id)
            return {error:'Drawing permission has been revoked. Ask your lecturer'};
          if(b.strokes.length>=350)
            return {error:'Board is full. Ask your lecturer to clear it before continuing'};
          return {...b,strokes:[...b.strokes,stroke],version:b.version+1};
        });
        return updated?.error?fail(409,updated.error):reply({ok:true,strokeId:stroke.id,version:updated.version});
      }
      return fail(400,'Unknown whiteboard action');
    }

    if(data.action==='work'){
      const operation=data.operation||'list';
      const prefix=key('student-work',claims.code)+'/';
      if(operation==='list'){
        if(claims.role!=='teacher')return fail(403,'Lecturer only');
        const docs=await entries(store,prefix,200);
        return reply({items:docs.map(({image,...item})=>({...item,hasImage:Boolean(image)}))
          .sort((a,b)=>b.submittedAt.localeCompare(a.submittedAt))});
      }
      if(operation==='image'){
        if(claims.role!=='teacher')return fail(403,'Lecturer only');
        if(typeof data.id!=='string'||!/^[0-9a-f-]{36}$/i.test(data.id))return fail(400,'Invalid work ID');
        const doc=await get(store,key('student-work',claims.code,data.id));
        return doc?.image?reply({image:doc.image}):fail(404,'Screenshot unavailable');
      }
      if(operation==='submit'){
        if(claims.role!=='student')return fail(403,'Students only');
        const kind=data.kind;
        if(!['solution','problem'].includes(kind))return fail(400,'Choose Solution or Problem');
        const topic=typeof data.topic==='string'?data.topic.trim():'';
        const note=typeof data.note==='string'?data.note.trim():'';
        const code=typeof data.code==='string'?data.code.trim():'';
        if(!validText(topic,120)||!validText(note,1500)||!validText(code,5000))return fail(400,'Submission contains invalid or too much text');
        const image=data.image??null;
        if(image!==null&&(typeof image!=='string'||image.length>450000||
          !/^data:image\/webp;base64,[a-zA-Z0-9+/]+={0,2}$/.test(image)))return fail(400,'Invalid screenshot. Please use a smaller image');
        if(!note&&!code&&!image)return fail(400,'Add a description, text/code or screenshot before sending');
        const memberPrefix=prefix;
        const records=await store.list({prefix:memberPrefix});
        if(records.blobs.length>=200)return fail(409,'This classroom has reached its work-submission limit');
        const id=randomUUID(),doc={id,kind,topic,note,code,image,
          name:claims.name,studentId:claims.id,submittedAt:new Date().toISOString()};
        const saved=await store.setJSON(key('student-work',claims.code,id),doc,{onlyIfNew:true});
        if(!saved.modified)return fail(409,'Could not save submission. Try again');
        return reply({ok:true,id},201);
      }
      return fail(400,'Unknown work operation');
    }

    if(data.action==='web-links'){
      // Lecturer-only shared bookmark library. Saved across classroom sessions
      // without exposing the lecturer's session token to external websites.
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      const operation=data.operation||'list',prefix='saved-web-link/';
      const cleanUrl=value=>{
        if(typeof value!=='string'||value.length>1500||!/^https:\/\//i.test(value.trim()))return null;
        try{
          const parsed=new URL(value.trim());
          const host=parsed.hostname.toLowerCase();
          if(parsed.protocol!=='https:'||!host||parsed.username||parsed.password||
             host==='localhost'||host.endsWith('.localhost')||
             host==='127.0.0.1'||host==='0.0.0.0'||host==='[::1]'||
             /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host))return null;
          return parsed.href;
        }catch{return null}
      };
      if(operation==='list'){
        const items=(await entries(store,prefix,120)).filter(item=>!item.archived)
          .sort((a,b)=>a.title.localeCompare(b.title));
        return reply({items});
      }
      if(operation==='save'){
        const input=data.item;
        const title=typeof input?.title==='string'?input.title.trim():'';
        const url=cleanUrl(input?.url);
        if(!title||!validText(title,100)||!url)return fail(400,'Enter a title and a valid public HTTPS URL');
        const id=data.id||randomUUID();
        if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return fail(400,'Invalid bookmark ID');
        const path=key('saved-web-link',id);
        const old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
        const revision=Number(data.revision||0);
        if((old?.data?.revision||0)!==revision||old?.data?.archived)
          return fail(409,'Saved link changed. Refresh the library and retry');
        if(!old&&(await store.list({prefix})).blobs.length>=100)
          return fail(409,'Saved link library is full (100 entries)');
        const item={id,title,url,revision:revision+1,archived:false,
          createdAt:old?.data?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
        const saved=await store.setJSON(path,item,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        if(!saved.modified)return fail(409,'Saved link changed. Refresh the library');
        return reply({item},old?200:201);
      }
      if(operation==='delete'){
        if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return fail(400,'Invalid saved link ID');
        const updated=await change(store,key('saved-web-link',data.id),item=>
          item.archived?{error:'Saved link was already removed'}:{
            ...item,archived:true,revision:item.revision+1,updatedAt:new Date().toISOString()
          });
        return updated?.error?fail(409,updated.error):updated?reply({ok:true}):fail(404,'Saved link not found');
      }
      return fail(400,'Unknown bookmark operation');
    }

    if(data.action==='document-bank'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      const operation=data.operation||'list',prefix='saved-text-document/';
      if(operation==='list'){
        const items=(await entries(store,prefix,100)).filter(x=>!x.archived)
          .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        return reply({items});
      }
      if(operation==='save'){
        const item=validateDocumentTemplate(data.item);
        if(!item)return fail(400,'A document needs a title and 1–8 valid questions');
        const id=data.id||randomUUID();
        if(!/^[a-f0-9-]{36}$/i.test(id))return fail(400,'Invalid document ID');
        const path=key('saved-text-document',id);
        const old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
        const revision=Number(data.revision||0);
        if(old?.data?.archived||(old?.data?.revision||0)!==revision)
          return fail(409,'Document changed. Reload before saving');
        if(!old&&(await store.list({prefix})).blobs.length>=100)
          return fail(409,'Document library full (100 templates)');
        const value={id,...item,revision:revision+1,archived:false,
          createdAt:old?.data?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
        const saved=await store.setJSON(path,value,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        return saved.modified?reply({item:value},old?200:201):fail(409,'Document was edited concurrently');
      }
      if(operation==='delete'){
        if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return fail(400,'Invalid document ID');
        const changed=await change(store,key('saved-text-document',data.id),v=>
          v.archived?{error:'Document was deleted'}:{...v,archived:true,revision:v.revision+1,updatedAt:new Date().toISOString()});
        return changed?.error?fail(409,changed.error):changed?reply({ok:true}):fail(404,'Document not found');
      }
      return fail(400,'Unknown document operation');
    }
    if(data.action==='document-start'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return fail(400,'Choose a saved document');
      const template=await get(store,key('saved-text-document',data.id));
      if(!template||template.archived)return fail(404,'Saved document unavailable');
      const now=Date.now(),id=randomUUID();
      const round={id,type:'text-document',prompt:template.title,questions:[...template.questions],
        unit:'individual',options:[],status:'open',createdAt:now,revealed:false,endsAt:null};
      await store.setJSON(key('round',claims.code,id),round,{onlyIfNew:true});
      const changed=await change(store,key('room',claims.code),r=>({
        ...r,active:id,engagementRounds:[...(r.engagementRounds||[]),
          {id,type:'text-document',unit:'individual',startedAt:now}].slice(-120)
      }));
      return changed?.error?fail(409,changed.error):reply({active:publicRound(round)});
    }
    if(data.action==='evaluation-bank'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      const kind=data.kind;
      if(!['mcq','jumbled'].includes(kind))return fail(400,'Invalid evaluation type');
      const prefix='saved-evaluation-'+kind+'/',operation=data.operation||'list';
      if(operation==='list'){
        const items=(await entries(store,prefix,100)).filter(q=>!q.archived)
          .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        return reply({items});
      }
      if(operation==='save'){
        const item=validEvaluation({...data.item,kind});
        if(!item)return fail(400,'Enter a question with a valid correct answer');
        const id=data.id||randomUUID();
        if(!/^[a-f0-9-]{36}$/i.test(id))return fail(400,'Invalid question ID');
        const path=key('saved-evaluation-'+kind,id);
        const old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
        const revision=Number(data.revision||0);
        if((old?.data?.revision||0)!==revision||old?.data?.archived)
          return fail(409,'Question changed. Refresh the bank and retry');
        if(!old&&(await store.list({prefix})).blobs.length>=100)
          return fail(409,'Question bank full (100 questions per type)');
        const stored={id,...item,revision:revision+1,archived:false,
          createdAt:old?.data?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
        const saved=await store.setJSON(path,stored,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        return saved.modified?reply({item:stored},old?200:201):fail(409,'Question was edited elsewhere');
      }
      if(operation==='delete'){
        if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return fail(400,'Invalid question ID');
        const updated=await change(store,key('saved-evaluation-'+kind,data.id),item=>
          item.archived?{error:'Already deleted'}:{...item,archived:true,revision:item.revision+1,updatedAt:new Date().toISOString()});
        return updated?.error?fail(409,updated.error):updated?reply({ok:true}):fail(404,'Question unavailable');
      }
      return fail(400,'Unknown evaluation bank operation');
    }
    if(data.action==='evaluation-start'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      // Start only from an existing saved question; an unapproved client cannot
      // swap out correct answers at launch time.
      const kind=data.kind,id=data.id;
      if(!['mcq','jumbled'].includes(kind)||typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))
        return fail(400,'Choose a saved question');
      const saved=await get(store,key('saved-evaluation-'+kind,id));
      if(!saved||saved.archived)return fail(404,'Saved question unavailable');
      const duration=Number(data.duration);
      if(!Number.isInteger(duration)||duration<10||duration>3600)
        return fail(400,'Duration must be 10–3600 seconds');
      const now=Date.now(),roundId=randomUUID();
      const sequence=kind==='jumbled'?shuffledSteps(saved.steps):null;
      const round={id:roundId,type:'evaluation',evalKind:kind,title:saved.title,
        prompt:saved.prompt,options:kind==='mcq'?saved.options:[],
        steps:kind==='jumbled'?saved.steps:[],tiles:sequence?.tiles||[],correctOrder:sequence?.correctOrder||[],
        correct:kind==='mcq'?saved.correct:null,unit:'individual',
        status:'open',createdAt:now,duration,endsAt:now+duration*1000,revealed:false};
      await store.setJSON(key('round',claims.code,roundId),round,{onlyIfNew:true});
      const updated=await change(store,key('room',claims.code),r=>({
        ...r,active:roundId,engagementRounds:[...(r.engagementRounds||[]),
          {id:roundId,type:'evaluation',unit:'individual',startedAt:now}].slice(-120)
      }));
      return updated?.error?fail(409,updated.error):reply({active:publicRound(round)});
    }
    if(data.action==='library'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      const operation=data.operation||'list',kind=data.kind||'poll';
      if(!['poll','cloud','answers'].includes(kind))return fail(400,'Unknown question type');
      // Keep the existing saved-poll prefix so previously created polls remain available.
      const prefix=kind==='poll'?'saved-poll/':'saved-'+kind+'/';
      const storeKind=kind==='poll'?'saved-poll':'saved-'+kind;
      const validQuestion=p=>p&&typeof p==='object'&&!Array.isArray(p)&&
        validText(p.title,100)&&p.title.trim().length>0&&validText(p.prompt,240)&&
        (kind==='poll'?(Array.isArray(p.options)&&p.options.length>=2&&p.options.length<=8&&
          p.options.every(o=>validText(o,60)&&o.trim().length>0)):
          (typeof p.prompt==='string'&&p.prompt.trim().length>0));
      if(operation==='list'){
        const saved=(await entries(store,prefix,100)).filter(p=>!p.archived);
        const sorted=saved.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
        return reply({items:sorted,polls:kind==='poll'?sorted:undefined});
      }
      if(operation==='save'){
        const input=data.item||data.poll;
        if(!validQuestion(input))return fail(400,kind==='poll'?'Title and 2–8 options required':'Enter a title and your question');
        const payload={kind,title:input.title.trim(),prompt:input.prompt.trim(),
          options:kind==='poll'?input.options.map(o=>o.trim()):[],
          unit:input.unit==='pair'?'pair':'individual'};
        const id=data.id||randomUUID();
        if(!/^[a-f0-9-]{36}$/i.test(id))return fail(400,'Invalid saved question ID');
        const path=key(storeKind,id),old=await store.getWithMetadata(path,{type:'json',consistency:'strong'});
        const revision=Number(data.revision||0);
        if((old?.data?.revision||0)!==revision||old?.data?.archived)return fail(409,'Saved question changed. Refresh your library and retry');
        if(!old&&(await store.list({prefix})).blobs.length>=100)return fail(409,'Question library full (100 entries for this type)');
        const result={id,...payload,revision:revision+1,createdAt:old?.data?.createdAt||new Date().toISOString(),
          updatedAt:new Date().toISOString(),archived:false};
        const saved=await store.setJSON(path,result,old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        if(!saved.modified)return fail(409,'Saved question changed concurrently. Reload the library');
        return reply({item:result,poll:kind==='poll'?result:undefined},old?200:201);
      }
      if(operation==='delete'){
        if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/i.test(data.id))return fail(400,'Invalid saved question ID');
        const changed=await change(store,key(storeKind,data.id),p=>({...p,archived:true,revision:(p.revision||0)+1,updatedAt:new Date().toISOString()}));
        return changed?.error?fail(409,changed.error):changed?reply({ok:true}):fail(404,'Question not found');
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
      if(data.type==='cloud')
        await store.setJSON(key('cloud-fast',claims.code,id),{version:0,subjects:{},events:[]},{onlyIfNew:true});
      const updated=await change(store,key('room',claims.code),prev=>({
        ...prev,active:id,engagementRounds:['poll','answers','cloud'].includes(data.type)?
          [...(prev.engagementRounds||[]),{id,type:data.type,unit,startedAt:now}].slice(-120):
          (prev.engagementRounds||[])
      }));
      if(updated?.error)return fail(409,updated.error);
      return reply({active:publicRound(round)});
    }
    if(data.action==='control'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(data.control==='end'){
        const updated=await change(store,key('room',claims.code),prev=>({...prev,ended:true}));
        return updated?.error?fail(409,updated.error):reply({ok:true});
      }
      if(data.control==='finish'){
        // Finishing an activity is different from ending the classroom.
        // Stop accepting answers then clear only the matching active round.
        if(!room.active||data.roundId!==room.active)
          return fail(409,'Activity changed. Refresh before closing it');
        const roundPath=key('round',claims.code,room.active);
        const stopped=await change(store,roundPath,r=>({...r,status:'closed'}));
        if(stopped?.error||!stopped)return fail(409,'Could not stop the current activity');
        const updated=await change(store,key('room',claims.code),r=>
          r.active===data.roundId?{...r,active:null}:{error:'Activity changed; newer activity preserved'});
        return updated?.error?fail(409,updated.error):reply({ok:true,active:null});
      }
      if(data.control==='evaluation-reveal'){
        if(!room.active||data.roundId!==room.active)return fail(409,'Activity changed');
        const round=await get(store,key('round',claims.code,room.active));
        if(round?.type!=='evaluation')return fail(400,'Not an evaluation');
        if(round.status==='open'&&Date.now()<round.endsAt)
          return fail(409,'Wait until the timer ends before revealing correct answers');
        const result=await change(store,key('round',claims.code,round.id),r=>({...r,revealed:true}));
        return result?.error?fail(409,result.error):reply({active:publicRound(result)});
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
      if(!round||round.status!=='open'||round.type==='timer'||data.roundId!==round.id||
        (round.type==='evaluation'&&Date.now()>=round.endsAt))
        return fail(409,'Activity changed, or the submission timer has ended');
      let value=data.value;
      if(round.type==='text-document'){
        value=validateDocumentAnswers(round.questions,value);
        if(value===null)return fail(400,'Answer at least one question. Maximum 1200 characters per answer');
      }else if(round.type==='evaluation'){
        value=validateEvaluationSubmission(round,value);
        if(value===null)return fail(400,'Complete the evaluation answer before submitting');
      }else if(round.type==='poll'){
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
      if(['poll','answers','cloud','evaluation','text-document'].includes(round.type)){
        const recorded=await recordEngagementCredit(store,claims.code,subject,round.id);
        if(!recorded)console.warn('Engagement credit projection busy',claims.code,round.id);
      }
      if(round.type==='cloud'){
        const indexed=await updateCloudLedger(store,claims.code,round.id,{
          subject,value:answer.value,revision:answer.revision,hidden:answer.hidden,
          eventId:randomUUID(),at:Date.now()
        });
        // The authoritative answer remains saved even if the projection is
        // temporarily busy. The normal classroom snapshot still reads it.
        if(!indexed)console.warn('Cloud fast projection busy',claims.code,round.id);
      }
      return reply({ok:true,revision:answer.revision});
    }
    if(data.action==='moderate'){
      if(claims.role!=='teacher')return fail(403,'Lecturer only');
      if(typeof data.subject!=='string'||!/^[a-z0-9-]{10,100}$/i.test(data.subject)||!room.active||data.roundId!==room.active)return fail(409,'Activity changed. Refresh before moderating');
      const activeRound=await get(store,key('round',claims.code,room.active));
      const changed=await change(store,key('response',claims.code,room.active,data.subject),r=>({...r,hidden:!!data.hidden}));
      if(changed?.error)return fail(409,changed.error);
      if(!changed)return fail(404,'Answer missing');
      if(activeRound?.type==='cloud'){
        const indexed=await updateCloudLedger(store,claims.code,activeRound.id,{
          subject:data.subject,value:changed.value,revision:changed.revision,hidden:changed.hidden
        });
        if(!indexed)console.warn('Cloud moderation projection busy',claims.code,activeRound.id);
      }
      return reply({ok:true});
    }
    return fail(400,'Unknown action');
  }catch(error){
    console.error('Classroom Toolkit request failed',error?.name);
    return fail(503,'Classroom service unavailable. Retry.');
  }
}

export default function handler(request){return handleToolkit(request)}
