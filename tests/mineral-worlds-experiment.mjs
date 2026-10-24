// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera,Vector3} from '../lib/three.webgpu.js';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';
import experiment from '../experiments/mineral-worlds.experiment.mjs';

async function fixture(inputs={}){
 const scene=new Scene(),camera=new PerspectiveCamera(50,1,.01,200);camera.position.set(1,3,5);
 const controls={target:new Vector3(),enableDamping:true,update(){}},frames=new Set();
 const backgroundNode={existing:true};scene.backgroundNode=backgroundNode;
 const sceneHost=createWorkbenchSceneHost({scene,camera,controls,loadAsset:()=>{throw Error('unused');},registerObject:()=>({id:'mineral-fixture'}),findObject:()=>null,removeObject:receipt=>receipt.root.removeFromParent(),redraw(){},onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);}});
 const document={defaultView:{setTimeout},getElementById:()=>null};
 const instance=await experiment.create({host:{scene:sceneHost,controls:{document}},inputs:{size:8,surface:{samples:12},...inputs},record(){}});
 return {instance,scene,frames,backgroundNode};
}
test('invalid world presentation leaves evolved material and camera untouched',async()=>{
 const f=await fixture();try{
  await f.instance.operations.advance(4);const before=f.instance.operations.checkpoint();
  const malformed=structuredClone(before);malformed.state.tick=90;malformed.lightMode='bad';
  assert.throws(()=>f.instance.operations.restore(malformed),/light/i);
  assert.deepEqual(f.instance.operations.checkpoint(),before);
  malformed.lightMode='cool';malformed.view.position=[NaN,0,0];
  assert.throws(()=>f.instance.operations.restore(malformed),/view/i);
  assert.deepEqual(f.instance.operations.checkpoint(),before);
 }finally{await f.instance.dispose();}
});
test('experiment distance clears and restores the host background node',async()=>{
 const f=await fixture();assert.equal(f.scene.backgroundNode,null);await f.instance.dispose();assert.equal(f.scene.backgroundNode,f.backgroundNode);assert.equal(f.frames.size,0);
});
test('closed mineral operations cannot mutate a detached world',async()=>{
 const f=await fixture();await f.instance.dispose();assert.throws(()=>f.instance.operations.play(true),/closed|disposed/i);
});
