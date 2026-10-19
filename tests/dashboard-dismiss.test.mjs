import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../public/assets/dashboard-v2.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'')+'\nreturn {load,setDismissed,dismissed};';
const posts=[
 {id:'h1',type:'help',part:'09a-1',lang:'csharp',code:'return View();',note:'Error',submittedAt:'2026-10-19T08:00:00Z',diagnostics:{issues:[]}},
 {id:'d2',type:'display',part:'09a-2',lang:'razor',code:'<form></form>',note:'Completed',submittedAt:'2026-10-19T08:00:01Z',imageId:'abcd',diagnostics:{issues:[]}}
];
function harness(storage=new Map()){
 const nodes=new Map();const cl=()=>({x:new Set(),add(v){this.x.add(v)},remove(v){this.x.delete(v)},contains(v){return this.x.has(v)},toggle(v,on){on?this.add(v):this.remove(v)}}); 
 const create=()=>({children:[],textContent:'',value:'',className:'',style:{},classList:cl(),attrs:{},handlers:{},append(...a){this.children.push(...a)},add(a){this.children.push(a)},replaceChildren(...a){this.children=a},setAttribute(k,v){this.attrs[k]=v},addEventListener(k,f){this.handlers[k]=f},focus(){},removeAttribute(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,create());return nodes.get(id);};
 get('part').value='all';get('range').value='4h';
 const doc={hidden:false,getElementById:get,createElement:create,addEventListener(){}};
 const ls={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 const func=new Function('LABS','renderCode','document','window','Option','fetch','setInterval','setTimeout','clearTimeout','localStorage',script);
 const f=async()=>({ok:true,json:async()=>({posts})});
 const state=func([{id:'09a-1',label:'09a',title:'Title'}],()=>{},doc,{addEventListener(){}},class{constructor(l,v){this.label=l;this.value=v}},f,()=>{},()=>1,()=>{},ls);
 return {get,state,storage};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('dismiss stays hidden during refresh',async()=>{
 const h=harness();await settle();assert.equal(h.get('total').textContent,2);
 const wrapper=h.get('help-posts').children[0];assert.equal(wrapper.children.length,2);
 wrapper.children[1].handlers.click();assert.equal(h.get('total').textContent,1);
 await h.state.load('manual');assert.equal(h.get('total').textContent,1);
 assert.equal(h.get('dismissed-count').textContent,1);
});
test('dismissed posts can be restored and retained in data',async()=>{
 const h=harness();await settle();h.state.setDismissed('d2',true);
 h.get('show-dismissed').handlers.click();assert.equal(h.get('total').textContent,1);
 h.get('display-posts').children[0].children[1].handlers.click();
 assert.equal(h.state.dismissed.size,0);h.get('show-dismissed').handlers.click();assert.equal(h.get('total').textContent,2);
});
test('browser-specific persistence, no shared public delete',async()=>{
 const saved=new Map(),a=harness(saved);await settle();a.state.setDismissed('h1',true);
 const b=harness(saved);await settle();assert.equal(b.get('total').textContent,1);
 const other=harness(new Map());await settle();assert.equal(other.get('total').textContent,2);
});
