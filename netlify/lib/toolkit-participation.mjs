import {createHash} from 'node:crypto';
// Lecturer-only participation roster. Pair submissions count for every student
// in that pair; moderated/hidden responses still count as submissions.
export function studentParticipation(members,round,answers=[]){
 const isResponse=['poll','answers','cloud'].includes(round?.type);
 const subjects=new Set(isResponse?answers.map(a=>a.subject):[]);
 return members.filter(m=>typeof m.id==='string'&&typeof m.name==='string')
 .map(m=>{
   const team=typeof m.team==='string'?m.team:'';
   const subject=round?.unit==='pair'&&team?
     'team-'+createHash('sha256').update(team.toLocaleLowerCase()).digest('hex').slice(0,24):m.id;
   return {id:m.id,name:m.name,team,participated:isResponse?subjects.has(subject):null};
 }).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
