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
reject=true;await controls.elements.replay.onclick();assert.match(controls.elements.error.textContent,/Owner refused/);reject=false;
state.duration=null;controls.update();assert.equal(controls.elements.timeline.hidden,true,'unbounded simulation must not invent a finite scrub range');
state.duration=2;controls.update();assert.equal(controls.elements.timeline.hidden,false);
state.time=NaN;controls.update();assert.match(controls.elements.error.textContent,/clock/i);assert.equal(controls.elements.replay.disabled,true,'invalid effective clocks cannot look usable');
controls.dispose();const n=calls.length;await controls.elements.replay.onclick();assert.equal(calls.length,n,'disposed controls cannot operate a former owner');assert.equal(root.children.length,0);
console.log('Shared playback delegates real operations, holds scrubbing, preserves nodes and reports invalid/failed/disposed owners');
{
 const calls=[];let busy=true;
 const c=mountPlaybackControls({document,root,read:()=>({playing:false,time:0,rate:1,duration:null,busy,canReset:true,canCancel:busy,canRate:false,replayLabel:'Restart'}),invoke:async name=>calls.push(name)});
 assert.equal(c.elements.reset?.hidden,false,'Owner reset must stay accessible in shared transport');
 assert.equal(c.elements.reset.disabled,false,'Reset must interrupt preparation');
 assert.equal(c.elements.cancel.hidden,false);await c.elements.cancel.onclick();assert.equal(calls.at(-1),'cancel');
 assert.equal(c.elements.replay.textContent,'Restart');assert.equal(c.elements.rate.hidden,true);
 c.dispose();
}
{
 let reject;let busy=false;const calls=[];
 const c=mountPlaybackControls({document,root,read:()=>({playing:false,time:0,rate:1,duration:null,busy,canReset:true,canCancel:busy}),invoke:async name=>{calls.push(name);if(name==='replay'){busy=true;return new Promise((_,r)=>reject=r);}if(name==='cancel')busy=false;}});
 const pending=c.elements.replay.onclick();c.update();await c.elements.cancel.onclick();
 assert.equal(c.elements.play.disabled,false,'Cancel must release controls before obsolete preparation finishes');
 reject(Error('Old preparation superseded'));await pending;assert.equal(c.elements.error.textContent,'','Obsolete completion must not replace cancellation');c.dispose();
}

{
 const {createAuthoredWaterFeature}=await import('../authored-water-feature.mjs');
 let complete;const current={paused:false,setPaused(v){this.paused=v;},setEmitters(){},setSetup(){},dispose(){},state:()=>({})};
 let candidate=current;
 const feature=createAuthoredWaterFeature({services:()=>({}),emitters:()=>[{id:'water'}],loadHost:async()=>({createAuthoredWaterHost:()=>candidate??new Promise(r=>complete=r)})});
 feature.setup={particleCount:64};await feature.release();candidate=null;
 const c=mountPlaybackControls({document,root,read:()=>({playing:!feature.paused,time:0,rate:1,duration:null,busy:feature.isLoading(),canCancel:feature.isLoading()}),invoke:name=>name==='replay'?feature.release():feature.setPaused(name==='pause')});
 const pending=c.elements.replay.onclick();await new Promise(r=>setImmediate(r));
 feature.setup={particleCount:125};feature.sync();await new Promise(r=>setImmediate(r));c.update();
 assert.equal(c.elements.play.disabled,false,'SWEP-2 Edited preparation must unlock playback before its factory completes');
 assert.equal(c.elements.error.textContent,'','Cancellation must not appear as a failed release');
 await c.elements.play.onclick();assert.equal(current.paused,true);assert.equal(feature.host,current);
 let disposed=false;complete({...current,dispose(){disposed=true;}});await pending;await new Promise(r=>setImmediate(r));
 assert.equal(disposed,true);assert.equal(feature.host,current);assert.equal(c.elements.error.textContent,'');c.dispose();feature.clear();
}
