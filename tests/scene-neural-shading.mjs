// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {Scene,PerspectiveCamera,TSL} from '../lib/three.webgpu.js';
import {checkedViewportDisplay} from '../viewport-display-settings.mjs';
registerHooks({resolve(specifier,context,next){
 const path={'three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];
 return path?{url:new URL(path,import.meta.url).href,shortCircuit:true}:next(specifier,context);
}});
const {createSceneGI}=await import('../scene-gi.mjs');
test('combined lighting owns neural shading density without lowering source or receiving geometry resolution',()=>{
 const gi=createSceneGI(new Scene(),new PerspectiveCamera(),TSL.uniform(0));
 try{
  assert.equal(typeof gi.neuralShading?.setScale,'function','GI must expose the neural shading control');
  for(const scale of [1,.75,.5,.25]){
   gi.neuralShading.setScale(scale);
   const state=gi.neuralShading.state();
   assert.equal(state.requestedScale,scale);
   assert.equal(state.nominalNeuralPixelFraction,scale*scale);
   assert.equal(gi.source.getResolutionScale(),1);
   assert.equal(gi.beauty.getResolutionScale(),1);
  }
  for(const invalid of [0,-1,NaN,1.01])assert.throws(()=>gi.neuralShading.setScale(invalid),/resolution/);
  assert.equal(gi.neuralShading.state().requestedScale,.25,'invalid edits preserve the prior setting');
  assert.deepEqual(Object.keys(gi.source.getMRT().outputNodes).sort(),['normal','output','transport'],'neural reuse needs no additional full-size attachment');
 }finally{gi.dispose();}
});
test('neural resolution is a validated saved viewport setting',()=>{
 assert.equal(checkedViewportDisplay().neuralResolution,1);
 for(const scale of [1,.75,.5,.25])assert.equal(checkedViewportDisplay({neuralResolution:scale}).neuralResolution,scale);
 for(const invalid of [0,-1,NaN,Infinity,1.01,'0.5'])assert.throws(()=>checkedViewportDisplay({neuralResolution:invalid}),/resolution/);
});
test('positive subpixel rates still allocate one real shading pixel',()=>{
 const gi=createSceneGI(new Scene(),new PerspectiveCamera(),TSL.uniform(0));
 try{
  gi.neuralShading.setScale(.01);gi.neuralShading.capture.setSize(20,10);
  assert.deepEqual(gi.neuralShading.state().resolution,[1,1]);
 }finally{gi.dispose();}
});
