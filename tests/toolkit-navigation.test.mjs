import assert from 'node:assert/strict';
import test from 'node:test';
import {TOOL_GROUPS,groupForTool,tabsForGroup,defaultTabForGroup,preferredTabForGroup,routeForTab} from '../public/assets/toolkit-navigation.mjs';

test('four stable groups include every existing lecturer tool exactly once',()=>{
 assert.deepEqual(TOOL_GROUPS.map(group=>group.id),['interact','collaborate','assess','present']);
 assert.deepEqual(TOOL_GROUPS.map(group=>group.label),['Interact','Collaborate','Assess','Present']);
 const all=TOOL_GROUPS.flatMap(group=>group.tabs.map(tab=>tab.id));
 assert.deepEqual(all,['poll','answers','cloud','screen','whiteboard','document','work','mcq','jumbled','documents','web','library','report']);
 assert.equal(new Set(all).size,all.length);
 assert.equal(TOOL_GROUPS.every(group=>group.icon&&group.tabs.every(tab=>tab.label)),true);
 assert.equal(Object.isFrozen(TOOL_GROUPS),true);
 for(const group of TOOL_GROUPS){
  assert.equal(Object.isFrozen(group),true);
  assert.equal(Object.isFrozen(group.tabs),true);
  for(const tab of group.tabs)assert.equal(Object.isFrozen(tab),true);
 }
});

test('navigation resolves a group and its tabs, including unknown inputs',()=>{
 for(const group of TOOL_GROUPS){
  assert.equal(tabsForGroup(group.id),group.tabs);
  assert.equal(defaultTabForGroup(group.id),group.tabs[0].id);
  for(const tab of group.tabs)assert.equal(groupForTool(tab.id),group.id);
 }
 assert.deepEqual(tabsForGroup('missing'),[]);
 assert.deepEqual(tabsForGroup(undefined),[]);
 assert.equal(defaultTabForGroup('missing'),null);
 assert.equal(groupForTool('timer'),null);
 assert.equal(groupForTool(undefined),null);
});

test('each group restores a valid previous tab or uses its default',()=>{
 for(const group of TOOL_GROUPS){
  const last=group.tabs.at(-1).id;
  assert.equal(preferredTabForGroup(group.id,{[group.id]:last}),last);
  assert.equal(preferredTabForGroup(group.id,{}),group.tabs[0].id);
  assert.equal(preferredTabForGroup(group.id,{[group.id]:'unknown'}),group.tabs[0].id);
  assert.equal(preferredTabForGroup(group.id,null),group.tabs[0].id);
  assert.equal(preferredTabForGroup(group.id,undefined),group.tabs[0].id);
 }
 assert.equal(preferredTabForGroup('unknown',{}),null);
});

test('tabs route to the existing tool controllers rather than duplicate activities',()=>{
 for(const tool of ['poll','answers','cloud','documents','web','library','report']){
  assert.deepEqual(routeForTab(tool),{group:groupForTool(tool),tool});
 }
 for(const tool of ['screen','whiteboard','document']){
  assert.deepEqual(routeForTab(tool),{group:'collaborate',tool:'collaborate'});
 }
 assert.deepEqual(routeForTab('work'),{group:'collaborate',tool:'work'});
 assert.deepEqual(routeForTab('mcq'),{group:'assess',tool:'evaluation'});
 assert.deepEqual(routeForTab('jumbled'),{group:'assess',tool:'evaluation'});
 assert.equal(routeForTab('timer'),null);
 assert.equal(routeForTab('invalid'),null);
 assert.equal(routeForTab(null),null);
});
