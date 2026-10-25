// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene,PerspectiveCamera,Vector3} from '../lib/three.webgpu.js';
import {createWorkbenchSceneHost} from '../workbench-scene-host.mjs';
import experiment from '../experiments/mineral-worlds.experiment.mjs';

async function fixture(inputs={},scene=new Scene(),options={}){
 const camera=new PerspectiveCamera(50,1,.01,200);camera.position.set(1,3,5);
 const controls={target:new Vector3(),enableDamping:true,update(){}},frames=new Set();
 const backgroundNode={existing:true};scene.backgroundNode=backgroundNode;
 const sceneHost=createWorkbenchSceneHost({scene,camera,controls,loadAsset:()=>{throw Error('unused');},registerObject:()=>{if(options.rejectAttach)throw Error('fixture attachment rejection');return{id:'mineral-fixture'};},findObject:()=>null,removeObject:receipt=>receipt.root.removeFromParent(),redraw(){},onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);}});
 const document=options.document??{defaultView:{setTimeout},getElementById:()=>null};
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

test('invalid initial view leaves no registered world',async()=>{
 const scene=new Scene();await assert.rejects(()=>fixture({view:{position:[NaN,1,2]}},scene),/view/i);assert.equal(scene.children.length,0);
});

for(const mode of ['invalid-view','attach-rejection'])test(`${mode} preserves borrowed environment and ground`,async()=>{
 const env={value:'0.8',dispatchEvent(){}},ground={checked:true,dispatchEvent(){}},scene=new Scene();
 const document={defaultView:{setTimeout,Event:class{}},getElementById:id=>id==='env-intensity-slider'?env:id==='composition-ground-visible'?ground:null};
 await assert.rejects(()=>fixture(mode==='invalid-view'?{view:{position:[0,0,0],target:[0,0,0]}}:{},scene,{document,rejectAttach:mode==='attach-rejection'}));
 assert.equal(env.value,'0.8');assert.equal(ground.checked,true);assert.equal(scene.children.length,0);assert.equal(scene.fog,null);assert.deepEqual(scene.backgroundNode,{existing:true});
});
test('missing saved process identity rejects without changing the open world',async()=>{
 const f=await fixture();try{const before=f.instance.operations.checkpoint(),broken=structuredClone(before);delete broken.state.kind;assert.throws(()=>f.instance.operations.restore(broken),/identity/);assert.deepEqual(f.instance.operations.checkpoint(),before);}finally{await f.instance.dispose();}
});

test('distance uses an owned fog node and restores a prior node',async()=>{
 const scene=new Scene(),prior={priorFog:true};scene.fogNode=prior;const f=await fixture({},scene);
 assert.notEqual(scene.fogNode,prior);assert.equal(scene.fogNode.isNode,true);
 await f.instance.dispose();assert.equal(scene.fogNode,prior);
});
test('surface dimensions and height scales round trip with a world file',async()=>{
 const f=await fixture({surface:{samples:12,extent:20,bedScale:3,depositScale:.4}});
 try{const saved=f.instance.operations.checkpoint();assert.deepEqual(saved.surface,{samples:12,extent:20,bedScale:3,depositScale:.4});
 const changed=structuredClone(saved);changed.surface.depositScale=.9;f.instance.operations.restore(changed);
 assert.equal(f.instance.operations.read().surface.configuration.depositScale,.9);
 f.instance.operations.restore(saved);assert.deepEqual(f.instance.operations.checkpoint(),saved);
 const invalid=structuredClone(saved);invalid.surface.depositScale=NaN;assert.throws(()=>f.instance.operations.restore(invalid),/scale/);assert.deepEqual(f.instance.operations.checkpoint(),saved);
 }finally{await f.instance.dispose();}
});
