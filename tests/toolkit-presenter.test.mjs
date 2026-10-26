import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../public/assets/toolkit-presenter.mjs',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/toolkit/presenter/index.html',import.meta.url),'utf8');
const app=readFileSync(new URL('../public/assets/toolkit-app.mjs',import.meta.url),'utf8');
const headers=readFileSync(new URL('../netlify.toml',import.meta.url),'utf8');

test('PowerPoint and PDF present as client-only files with one fullscreen control',()=>{
 assert.match(src,/indexedDB\.open\(DB,1\)/);
 assert.match(src,/file\.arrayBuffer\(\)/);
 assert.match(src,/file\.size===0\|\|file\.size>LIMIT/);
 assert.match(src,/await engine\.parse\(/);
 assert.match(src,/engine\.renderSlideToSvg/);
 assert.match(src,/presentation'\)\.requestFullscreen/);
 assert.match(src,/ArrowRight/);
 assert.match(src,/ArrowLeft/);
 assert.match(src,/pagehide',cleanupMedia/);
 assert.doesNotMatch(src,/fetch\(\s*['"]\/api\//);
 assert.doesNotMatch(src,/\/api\/posts/);
 assert.match(html,/id="upload"/);
 assert.match(html,/id="fullscreen"/);
 assert.match(html,/id="counter"/);
 assert.match(html,/accept="\.pptx,\.ppt,\.pdf/);
});
test('the presenter can be framed only in same-origin toolkit pages',()=>{
 assert.match(headers,/for = "\/toolkit\/presenter\/\*"/);
 assert.match(headers,/X-Frame-Options = "SAMEORIGIN"/);
 assert.match(headers,/frame-ancestors 'self'/);
 assert.match(headers,/for = "\/\*"/);
 assert.match(headers,/X-Frame-Options = "DENY"/);
 assert.match(app,/id="document-frame"/);
 assert.match(app,/allowfullscreen/);
});

test('lecturer embeds the code board, keeps both viewers alive and hides irrelevant whiteboard results',()=>{
 const main=readFileSync(new URL('../public/assets/toolkit-app.mjs',import.meta.url),'utf8');
 assert.match(main,/id="teacher-screen-frame"/);
 assert.match(main,/id="live-results-panel" hidden/);
 assert.match(main,/id="teacher-slides-host"/);
 assert.match(main,/dashboard\/\?embed=1&section=screens/);
 assert.match(main,/round\.type===state\.tool/);
 assert.match(headers,/for = "\/dashboard\/\*"/);
 assert.match(headers,/X-Frame-Options = "SAMEORIGIN"/);
});
