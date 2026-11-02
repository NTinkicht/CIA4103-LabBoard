import test from 'node:test';
import assert from 'node:assert/strict';
import {PHASES,LESSON_TOOLS,normalizeLesson} from '../public/assets/toolkit-lesson-flow.mjs';

test('5Es preserves fixed pedagogical order and valid tool routes',()=>{
 assert.deepEqual(PHASES,['Engage','Explore','Explain','Extend','Evaluate']);
 assert.equal(normalizeLesson().phases.length,5);
 assert.ok(LESSON_TOOLS.includes('mcq'));
 assert.ok(LESSON_TOOLS.includes('whiteboard'));
});
test('lesson data is normalized, bounded, and does not trust arbitrary tool names',()=>{
 const result=normalizeLesson({title:'A'.repeat(200),phases:[{name:'Spoofed',duration:999,tool:'malicious',notes:'B'.repeat(2200)},{duration:-10,tool:'answers'}]});
 assert.equal(result.title.length,120);
 assert.equal(result.phases[0].name,'Engage');
 assert.equal(result.phases[0].duration,120);
 assert.equal(result.phases[0].tool,'poll');
 assert.equal(result.phases[0].notes.length,2000);
 assert.equal(result.phases[1].duration,1);
 assert.equal(result.phases[1].tool,'answers');
});
