import {randomInt} from 'node:crypto';

// Uniformly choose among eligible students, excluding the currently selected
// identity when alternatives exist. Pure dependency injection supports tests.
export function pickStudent(items,currentId=null,idOf=item=>item.id,choose=randomInt){
 if(!Array.isArray(items)||!items.length)return null;
 const eligible=items.length>1?items.filter(item=>idOf(item)!==currentId):items;
 if(!eligible.length)return null;
 return eligible[choose(eligible.length)];
}
