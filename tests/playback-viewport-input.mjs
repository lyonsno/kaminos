// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8'),start=source.indexOf('function viewportEventHitsInteractiveOverlay(event) {'),end=source.indexOf('\n}',start)+2;
assert.ok(start>=0&&end>start);
const context={};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
for(const cls of ['playback-controls','scene-owner-playback']){
 const target={closest:selectors=>selectors.split(',').some(s=>s.trim()==='.'+cls)?target:null};
 assert.equal(context.viewportEventHitsInteractiveOverlay({target}),true,'Playback interaction leaks into canvas selection: '+cls);
}
const play=source.match(/<button\s+id="volume-viewer-play"[^>]*>/);
assert.ok(play,'exercise the actual floating fire playback button');
for(const tagName of ['BUTTON','svg','path']){
 const button={id:'volume-viewer-play'},target={tagName,closest:selectors=>selectors.split(',').some(s=>s.trim()==='#'+button.id)?button:null};
 assert.equal(context.viewportEventHitsInteractiveOverlay({target}),true,'Floating fire Play/Pause must not raycast selection: '+tagName);
}
assert.equal(context.viewportEventHitsInteractiveOverlay({target:{closest:()=>null}}),false);
console.log('Playback controls are viewport UI, not raycast/selection gestures');
