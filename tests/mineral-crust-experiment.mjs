// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,AmbientLight,Matrix4,Vector3} from '../lib/three.webgpu.js';
import {createCrust} from '../mineral-worlds/crust.mjs';
import {createCrustSurface} from '../mineral-worlds/crust-surface.mjs';
import experiment from '../experiments/mineral-crust.experiment.mjs';
async function mount(rate,{ground=null,failAttach=false}={}){const scene=new Scene(),light=new AmbientLight(0xffffff,1);scene.add(light);let idleId=0;const idleQueue=new Map();const flush=()=>{while(idleQueue.size){const [id,callback]=idleQueue.entries().next().value;idleQueue.delete(id);callback({timeRemaining:()=>50});}};let frame,view={position:[2,2,2],target:[0,0,0],fov:40},root;
 const session={readView:()=>structuredClone(view),setView(value){if(value.position?.some(x=>!Number.isFinite(x)))throw Error('Invalid view');view={...view,...value};return structuredClone(view);},async attach(value){if(failAttach)throw Error('Attachment rejected');root=value;scene.add(root);return {id:'owned-crust',root,owned:true};},redraw(){},onFrame(callback){frame=callback;return ()=>{frame=null;};},async dispose(){if(root)scene.remove(root);}};
 const document={getElementById:id=>id==='composition-ground-visible'?ground:null,defaultView:{Event,requestIdleCallback:callback=>{idleQueue.set(++idleId,callback);return idleId;},cancelIdleCallback:id=>idleQueue.delete(id)}};
 const feature=await experiment.create({host:{scene:{open:async()=>session},controls:{document}},inputs:{rows:1,rate},record(){}});return {feature,frame:delta=>{frame({deltaSeconds:delta});flush();},tick:delta=>frame({deltaSeconds:delta}),flush,scene,light};
}
test('live evolution keeps fixed physical steps across display cadences and stops at zero rate',async()=>{
 const a=await mount(8),b=await mount(8);a.feature.operations.play(true);b.feature.operations.play(true);for(let i=0;i<60;i++)a.frame(1/60);for(let i=0;i<120;i++)b.frame(1/120);
 assert.deepEqual(a.feature.operations.checkpoint().state,b.feature.operations.checkpoint().state);assert.equal(a.feature.read().tick,80);
 a.feature.operations.rate(0);const before=a.feature.operations.checkpoint().state;a.frame(1);assert.deepEqual(a.feature.operations.checkpoint().state,before);
 await a.feature.dispose();await b.feature.dispose();
});
test('invalid saved view leaves the running material intact and disposing restores borrowed lighting',async()=>{
 const x=await mount(1),before=x.feature.operations.checkpoint(),bad=structuredClone(before);bad.view.position=[NaN,1,1];assert.throws(()=>x.feature.operations.restore(bad),/view/i);assert.deepEqual(x.feature.operations.checkpoint().state,before.state);
 assert.equal(x.light.visible,false);await x.feature.dispose();assert.equal(x.light.visible,true);assert.equal(x.scene.children.length,1);
});
test('visible asymmetric rotated grain corners agree with retained solid geometry',()=>{
 const state=createCrust({rows:1}),g=state.grains[0];g.angle=Math.PI/4;g.faces=[.8,-.2,.1,-.4,.3,0];
 const surface=createCrustSurface(state),instances=surface.root.children.find(x=>x.isInstancedMesh),matrix=new Matrix4();instances.getMatrixAt(0,matrix);
 try{for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5]){
  const localX=x===.5?g.faces[0]:g.faces[1],localZ=z===.5?g.faces[2]:g.faces[3],expected=[g.x+Math.cos(g.angle)*localX-Math.sin(g.angle)*localZ,y===.5?g.faces[4]:g.faces[5],g.z+Math.sin(g.angle)*localX+Math.cos(g.angle)*localZ],actual=new Vector3(x,y,z).applyMatrix4(matrix).toArray();
  actual.forEach((value,i)=>assert.ok(Math.abs(value-expected[i])<1e-6,`Rendered corner ${actual} differs from retained ${expected}`));
 }}finally{surface.dispose();}
});
test('real host ground control is isolated and restored on close and failed activation',async()=>{
 for(const checked of [true,false]){const events=[],ground={checked,dispatchEvent(){events.push(this.checked);}},x=await mount(1,{ground});assert.equal(ground.checked,false);await x.feature.dispose();assert.equal(ground.checked,checked);assert.deepEqual(events,checked?[false,true]:[]);}
 const events=[],ground={checked:true,dispatchEvent(){events.push(this.checked);}};await assert.rejects(mount(1,{ground,failAttach:true}),/Attachment rejected/);assert.equal(ground.checked,true);assert.deepEqual(events,[false,true]);
});

test('actual experiment keeps requested model time through hold, checkpoint and yielded continuation',async()=>{
 const x=await mount(8);x.feature.operations.play(true);x.tick(1);assert.equal(x.feature.read().tick,0,'frame callback must leave physics to browser idle turns');assert.ok(Math.abs(x.feature.read().clock.pendingModelSeconds-8)<1e-10);
 const saved=x.feature.operations.checkpoint();x.feature.operations.play(false);x.flush();assert.equal(x.feature.read().tick,0);x.feature.operations.restore(saved);x.feature.operations.play(true);x.flush();assert.equal(x.feature.read().tick,80);assert.ok(x.feature.read().clock.pendingModelSeconds<.1);await x.feature.dispose();
});
