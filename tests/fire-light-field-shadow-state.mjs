import assert from 'node:assert/strict';
import {renderFireShadowCube} from '../fire-light-field-shadow.mjs';

for(const throws of [false,true]) for(const sharedPreparation of [false,true]) {
  const objects=[{isMesh:true,castShadow:true,frustumCulled:true},{isMesh:true,castShadow:true,frustumCulled:false}];
  const originalOverride={name:'original'},originalHook=()=>{};
  const scene={matrixWorldAutoUpdate:true,overrideMaterial:originalOverride,traverseVisible:fn=>objects.forEach(fn)};
  const material={side:0};let hook=originalHook,restored=false,draws=0;
  const renderer={lighting:{enabled:true},setClearColor(){},setRenderObjectFunction(fn){hook=fn;},renderObject(){draws++;assert.equal(material.side,2);if(throws) throw new Error('face-draw-failed');}};
  const RendererUtils={
    resetRendererAndSceneState(){return {override:scene.overrideMaterial,hook};},
    restoreRendererAndSceneState(r,s,state){s.overrideMaterial=state.override;hook=state.hook;restored=true;},
  };
  const cubeCamera={update(){assert.equal(renderer.lighting.enabled,false,'radial distance capture must ignore unrelated scene illumination');assert.equal(scene.matrixWorldAutoUpdate,!sharedPreparation,'legacy comparison restores per-face scene updates');assert.deepEqual(objects.map(o=>o.frustumCulled),[false,false]);hook(objects[0],null,null,null,{side:2});hook({isMesh:true,castShadow:false},null,null,null,{side:2,transparent:true});}};
  const run=()=>renderFireShadowCube({renderer,scene,cubeCamera,material,far:10,sharedPreparation,RendererUtils});
  if(throws) assert.throws(run,/face-draw-failed/);else run();
  assert.equal(renderer.lighting.enabled,true,'restore lighting even after failed capture');assert.equal(restored,true);assert.equal(scene.overrideMaterial,originalOverride);
  assert.equal(hook,originalHook);assert.equal(material.side,0);
  assert.equal(scene.matrixWorldAutoUpdate,true,'restore scene auto-update even on a failed face');
  assert.deepEqual(objects.map(o=>o.frustumCulled),[true,false]);
  assert.equal(draws,1,'editor helpers not marked castShadow must not enter the shadow map');
}
console.log('fire shadow sidedness and failure restoration passed');
