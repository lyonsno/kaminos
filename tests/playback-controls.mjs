// kaminos-test: node
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
assert.ok(fs.existsSync(new URL('../playback-controls.mjs',import.meta.url)),'Shared playback controls are absent; creature and fluid still construct separate button panels');
const {mountPlaybackControls}=await import('../playback-controls.mjs');
class Element extends EventTarget {
 constructor(tag){super();this.tagName=tag;this.children=[];this.attributes={};this.value='';this.hidden=false;this.disabled=false;}
 append(...nodes){for(const n of nodes){n.remove?.();this.children.push(n);n.parent=this;}}
 remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}
 setAttribute(k,v){this.attributes[k]=String(v);}getAttribute(k){return this.attributes[k];}
 setPointerCapture(){}releasePointerCapture(){}
}
const document={createElement:t=>new Element(t)},root=new Element('div'),calls=[];
let state={playing:false,time:0,duration:2,stepSeconds:1/30,rate:1},reject=false;
const controls=mountPlaybackControls({document,root,read:()=>({...state}),invoke:async(name,input)=>{
 calls.push([name,input]);if(reject)throw Error('Owner refused operation');
 if(name==='replay')state={...state,playing:true,time:0};if(name==='pause')state.playing=false;if(name==='play')state.playing=true;
 if(name==='seek')state.time=input.seconds;if(name==='rate')state.rate=input.rate;
}});
assert.equal(controls.elements.replay.textContent,'↻ Replay');
await controls.elements.replay.onclick();assert.deepEqual(calls.at(-1),['replay',undefined]);assert.equal(state.playing,true);
await controls.elements.play.onclick();assert.equal(state.playing,false,'one control toggles actual owner play state');
controls.elements.timeline.value='1.25';await controls.elements.timeline.oninput();assert.equal(state.time,1.25);
assert.equal(state.playing,false,'scrubbing remains held');
const children=[...controls.node.children];state.time=1.999;controls.update();assert.deepEqual(controls.node.children,children,'time updates do not rebuild the strip or focused controls');
controls.elements.rate.value='0.5';await controls.elements.rate.onchange();assert.equal(state.rate,.5);
state.canRate=false;controls.update();assert.equal(controls.elements.rate.disabled,true,'An owner without a rate operation must not offer an ineffective speed control');state.canRate=true;controls.update();assert.equal(controls.elements.rate.disabled,false);
reject=true;await controls.elements.replay.onclick();assert.match(controls.elements.error.textContent,/Owner refused/);reject=false;
state.duration=null;controls.update();assert.equal(controls.elements.timeline.hidden,true,'unbounded simulation must not invent a finite scrub range');
state.duration=2;controls.update();assert.equal(controls.elements.timeline.hidden,false);
state.time=NaN;controls.update();assert.match(controls.elements.error.textContent,/clock/i);assert.equal(controls.elements.replay.disabled,true,'invalid effective clocks cannot look usable');
controls.dispose();const n=calls.length;await controls.elements.replay.onclick();assert.equal(calls.length,n,'disposed controls cannot operate a former owner');assert.equal(root.children.length,0);
console.log('Shared playback delegates real operations, holds scrubbing, preserves nodes and reports invalid/failed/disposed owners');
