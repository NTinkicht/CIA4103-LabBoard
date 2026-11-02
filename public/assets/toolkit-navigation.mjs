// Shared lecturer navigation model. Grouped menus never change activity IDs or APIs.
export const TOOL_GROUPS = Object.freeze([
  Object.freeze({id:'interact',label:'Interact',icon:'▥',tabs:Object.freeze([
    Object.freeze({id:'poll',label:'Live Poll'}),
    Object.freeze({id:'answers',label:'Live Answers'}),
    Object.freeze({id:'cloud',label:'Word Cloud'})
  ])}),
  Object.freeze({id:'collaborate',label:'Collaborate',icon:'▣',tabs:Object.freeze([
    Object.freeze({id:'screen',label:'Screen Sharing'}),
    Object.freeze({id:'whiteboard',label:'Whiteboard'}),
    Object.freeze({id:'document',label:'Collaborative Worksheet'}),
    Object.freeze({id:'work',label:'Student Work'})
  ])}),
  Object.freeze({id:'assess',label:'Assess',icon:'◈',tabs:Object.freeze([
    Object.freeze({id:'mcq',label:'MCQs'}),
    Object.freeze({id:'jumbled',label:'Jumbled Questions'})
  ])}),
  Object.freeze({id:'present',label:'Present',icon:'▧',tabs:Object.freeze([
    Object.freeze({id:'documents',label:'Files & Slides'}),
    Object.freeze({id:'web',label:'Web Resources'})
  ])})
]);

const TOOL_MAP = new Map(TOOL_GROUPS.flatMap(group=>group.tabs.map(tab=>[tab.id,group.id])));
export function groupForTool(tool){return TOOL_MAP.get(tool)||null}
export function tabsForGroup(group){return TOOL_GROUPS.find(item=>item.id===group)?.tabs||[]}
export function defaultTabForGroup(group){return tabsForGroup(group)[0]?.id||null}
export function preferredTabForGroup(group,remembered={}){
  const candidate=remembered?.[group];
  return tabsForGroup(group).some(tab=>tab.id===candidate)?candidate:defaultTabForGroup(group);
}
export function routeForTab(tab){
  const group=groupForTool(tab);
  if(!group)return null;
  return {group,tool:group==='collaborate'&&tab!=='work'?'collaborate':group==='assess'?'evaluation':tab};
}
