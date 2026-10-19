import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync(new URL('../public/assets/dashboard-v2.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'')+'\nreturn {load};';

function setup(){
 const nodes=new Map();let requests=0,interval;
 const klass=()=>({set:new Set(),add(x){this.set.add(x)},remove(x){this.set.delete(x)},contains(x){return this.set.has(x)},toggle(x,on){on?this.add(x):this.remove(x)}});
 const create=()=>({value:'',textContent:'',className:'',style:{},children:[],classList:klass(),add(x){this.children.push(x)},append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},setAttribute(){},addEventListener(){},focus(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,create());return nodes.get(id)};
 get('part').value='all';get('range').value='4h';
 const doc={hidden:false,createElement:create,getElementById:get,addEventListener(){}};
 const fetch=async()=>{requests++;return {ok:true,json:async()=>({posts:[{id:'test',part:'09a-1',type:'help',lang:'csharp',code:'return View();',note:'',submittedAt:new Date().toISOString(),diagnostics:{issues:[]}}]})}};
 const fn=new Function('LABS','renderCode','document','window','Option','fetch','setInterval','setTimeout','clearTimeout',script);
 const controls=fn([{id:'09a-1',label:'Lab 09a',title:'Title'}],()=>{},doc,{addEventListener(){}},class{constructor(){}},fetch,cb=>{interval=cb},()=>1,()=>{});
 return {doc,get,controls,tick:()=>interval(),count:()=>requests};
}

test('continues refreshing even with a code or screenshot dialog open',async()=>{
 const a=setup();await new Promise(resolve=>setImmediate(resolve));
 await a.controls.load('manual');a.get('overlay').classList.add('open');
 await a.tick();
 assert.equal(a.count(),3);
 assert.match(a.get('updated').textContent,/LIVE/);
 assert.equal(a.get('total').textContent,1);
});

test('does not perform expensive automatic polling while hidden',async()=>{
 const a=setup();await new Promise(resolve=>setImmediate(resolve));
 await a.controls.load('manual');const before=a.count();
 a.doc.hidden=true;await a.tick();assert.equal(a.count(),before);
});
