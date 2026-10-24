// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {blendSettings,blendChoices} from '../flame-blend.mjs';
const state=(heat,wind)=>({domControls:{'volume-physical-thermal':{type:'range',value:heat,rawValue:String(heat)},'volume-wind-angle':{type:'range',value:wind,rawValue:String(wind)},'volume-resolution':{value:32},'volume-reaction-law':{type:'select',value:'reactants'}},rendererControls:{'volume-steps':{value:8}},presentationControls:{},source:{presetId:'original'},sourcePose:{position:[1,2,3]}});

test('selected continuous controls blend from endpoints while all held live values survive',()=>{
 const a=state(2,170),b=state(10,-170),current=state(3,15);current.domControls['volume-resolution'].value=64;
 const next=blendSettings({a,b,current,fields:['volume-physical-thermal'],amount:.25});
 assert.equal(next.domControls['volume-physical-thermal'].value,4,'the authored endpoints determine the interpolation');
 assert.equal(next.domControls['volume-physical-thermal'].rawValue,'4');
 assert.equal(next.domControls['volume-wind-angle'].value,15);assert.equal(next.domControls['volume-resolution'].value,64);
 assert.deepEqual(next.sourcePose,current.sourcePose);assert.deepEqual(next.source,current.source);assert.equal(a.domControls['volume-physical-thermal'].value,2);
});
test('angles take the short arc and exact endpoints remain exact',()=>{
 const a=state(2,170),b=state(10,-170),current=state(3,0),fields=['volume-wind-angle'];
 assert.equal(Math.abs(blendSettings({a,b,current,fields,amount:.5}).domControls['volume-wind-angle'].value),180);
 for(const amount of [0,1])assert.equal(blendSettings({a,b,current,fields,amount}).domControls['volume-wind-angle'].value,amount?-170:170);
});
test('grids, unknown fields, discrete modes, missing values and nonfinite blends cannot enter a continuous edit',()=>{
 const a=state(2,0),b=state(10,0),current=state(3,0);
 for(const fields of [['volume-resolution'],['volume-reaction-law'],['missing']])assert.throws(()=>blendSettings({a,b,current,fields,amount:.5}),/continuous|Unknown/);
 for(const amount of [NaN,Infinity,-.1,1.1])assert.throws(()=>blendSettings({a,b,current,fields:['volume-physical-thermal'],amount}),/amount/);
 delete b.domControls['volume-physical-thermal'];assert.throws(()=>blendSettings({a,b,current,fields:['volume-physical-thermal'],amount:.5}),/continuous/);
 assert.equal(blendChoices(a,b,current).find(f=>f.id==='volume-physical-thermal').available,false);
});

import {createFlameBlend} from '../flame-blend.mjs';
import {createFlameAuthoring} from '../flame-authoring.mjs';
import {createSceneEdits} from '../scene-edit-session.mjs';
function cockpit(){
 let live=state(2,0),frame,unsubscribed=false;
 const edits=createSceneEdits({read:()=>null,write:()=>{}});
 const author=createFlameAuthoring({edits,read:()=>structuredClone(live),write:next=>live=structuredClone(next),check:next=>next});
 const flame={read:()=>({active:true,settings:author.read()}),settings:author.read,beginPreview:author.beginPreview,readBasin:async()=>state(10,0)};
 const controller=createFlameBlend({flame,onFrame:fn=>{frame=fn;return()=>{unsubscribed=true;};}});
 const op=controller.operations;
 op.capture('a');live=state(10,0);op.capture('b');op.setFields(['volume-physical-thermal']);live=state(2,0);
 return {controller,op,edits,author,tick:deltaSeconds=>frame({deltaSeconds}),stopped:()=>unsubscribed};
}
test('host-frame playback moves live coefficients, commits once, and undo restores the starting scene',()=>{
 const f=cockpit();f.op.setDuration(2);f.op.play();f.tick(1);
 assert.equal(f.author.read().domControls['volume-physical-thermal'].value,6);assert.equal(f.edits.state().undoCount,0);
 f.tick(1);assert.equal(f.author.read().domControls['volume-physical-thermal'].value,10);assert.equal(f.edits.state().undoCount,1);
 assert.equal(f.controller.read().playing,false);f.edits.undo();assert.equal(f.author.read().domControls['volume-physical-thermal'].value,2);f.controller.dispose();
});
test('cancel and disposal release the preview; future frames cannot mutate a later edit',()=>{
 const f=cockpit();f.op.play();f.tick(1);f.op.cancel();assert.equal(f.author.read().domControls['volume-physical-thermal'].value,2);
 f.op.play();f.tick(1);f.controller.dispose();assert.equal(f.stopped(),true);assert.equal(f.edits.state().active,null);assert.equal(f.edits.state().undoCount,0);
 const before=f.author.read();f.tick(1);assert.deepEqual(f.author.read(),before);
});
test('saved endpoints and field choices round-trip without applying a look or silently overriding new edits',()=>{
 const f=cockpit();f.op.setDuration(7);f.op.setAmount(.3);const recipe=f.op.export(),live=f.author.read();
 f.op.restore(JSON.parse(JSON.stringify(recipe)));assert.deepEqual(f.author.read(),live);assert.equal(f.controller.read().duration,7);assert.deepEqual(f.controller.read().fields,recipe.fields);
 const bad=structuredClone(recipe);bad.fields=['volume-resolution'];assert.throws(()=>f.op.restore(bad),/continuous/);assert.deepEqual(f.op.export().a,recipe.a);
 f.op.begin();assert.throws(()=>f.op.capture('b'),/Finish/);assert.throws(()=>f.op.setDuration(4),/Finish/);f.op.cancel();f.controller.dispose();
});
test('closing during an endpoint fetch cannot repopulate disposed work',async()=>{
 let complete;const f=cockpit();
 const flame={read:()=>({active:true,settings:f.author.read()}),settings:f.author.read,beginPreview:f.author.beginPreview,readBasin:()=>new Promise(resolve=>complete=resolve)};
 const c=createFlameBlend({flame,onFrame:()=>()=>{}});const pending=c.operations.choose({slot:'a',presetId:'pending'});c.dispose();complete(state(5,0));await assert.rejects(pending,/closed/);f.controller.dispose();
});
