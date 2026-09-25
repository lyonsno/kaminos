import assert from 'node:assert/strict';
import {renderFireShadowCube} from '../fire-light-field-shadow.mjs';

for(const throws of [false,true]) {
  const objects=[{isMesh:true,castShadow:true,frustumCulled:true},{isMesh:true,castShadow:true,frustumCulled:false}];
  const originalOverride={name:'original'},originalHook=()=>{};
  const scene={overrideMaterial:originalOverride,traverseVisible:fn=>objects.forEach(fn)};
  const material={side:0};let hook=originalHook,restored=false,draws=0;
  const renderer={setClearColor(){},setRenderObjectFunction(fn){hook=fn;},renderObject(){draws++;assert.equal(material.side,2);if(throws) throw new Error('face-draw-failed');}};
  const RendererUtils={
    resetRendererAndSceneState(){return {override:scene.overrideMaterial,hook};},
    restoreRendererAndSceneState(r,s,state){s.overrideMaterial=state.override;hook=state.hook;restored=true;},
  };
  const cubeCamera={update(){assert.deepEqual(objects.map(o=>o.frustumCulled),[false,false]);hook(objects[0],null,null,null,{side:2});hook({isMesh:true,castShadow:false},null,null,null,{side:2,transparent:true});}};
  const run=()=>renderFireShadowCube({renderer,scene,cubeCamera,material,far:10,RendererUtils});
  if(throws) assert.throws(run,/face-draw-failed/);else run();
  assert.equal(restored,true);assert.equal(scene.overrideMaterial,originalOverride);
  assert.equal(hook,originalHook);assert.equal(material.side,0);
  assert.deepEqual(objects.map(o=>o.frustumCulled),[true,false]);
  assert.equal(draws,1,'editor helpers not marked castShadow must not enter the shadow map');
}
console.log('fire shadow sidedness and failure restoration passed');
