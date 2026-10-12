import assert from 'node:assert/strict';
import { flamePoseToDomain, flamePoseInDomain, flamePoseFromImmersedControls,
  immersedControlsForFlamePose, defaultFlameEmitterPose } from '../scene-flame-emitter.mjs';
import { buildSceneDocument, planSceneRestore } from '../scene-persistence-core.js';
const source={...defaultFlameEmitterPose(),position:[3,2,0],scale:[1.5,1.5,1.5]};
const translation=[1,0,0],scale=2;
const local=flamePoseToDomain(source,translation,scale);
assert.deepEqual(local.position,[1,1,0],'world placement must be expressed in scaled domain coordinates');
assert.deepEqual(local.scale,[.75,.75,.75],'aperture must retain its world size');
assert.equal(flamePoseInDomain(source,translation,scale),true);
const controls=immersedControlsForFlamePose({immersedRadius:.2},local);
assert.equal(controls.immersedRadius*scale,.2*1.5);
assert.deepEqual(flamePoseFromImmersedControls(controls,translation,source,scale),source);
assert.throws(()=>flamePoseToDomain(source,translation,0),/positive/);
const composition={schema:'kaminos.stationary-flame-composition.v1',flame:{presetId:`vsp-${'a'.repeat(64)}`,stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
const objects=[{id:'flame-emitter',type:'flame-emitter',source:'kaminos:analytic-flame',transform:source}];
const document=buildSceneDocument({objects,composition,flameDomainTranslation:translation,flameDomainScale:scale,flameDomainFollowSource:false});
const restored=planSceneRestore(document);
assert.equal(restored.flameDomainScale,2);
assert.equal(restored.flameDomainFollowSource,false);
// An intentionally positioned domain can leave its source outside (injection paused).
const outside=buildSceneDocument({objects,composition,flameDomainTranslation:[30,0,0],flameDomainScale:2,flameDomainFollowSource:false});
assert.deepEqual(planSceneRestore(outside).objects[0].transform,source);
assert.throws(()=>planSceneRestore({...document,flameDomainScale:0}),/positive/);
const legacy=buildSceneDocument({objects:[{...objects[0],transform:defaultFlameEmitterPose()}],composition});
assert.equal(planSceneRestore(legacy).flameDomainScale,1);
assert.equal(planSceneRestore(legacy).flameDomainFollowSource,true);
console.log('World domain mapping, aperture, persistence and legacy defaults pass');

const withoutSource=buildSceneDocument({composition,flameDomainTranslation:[1,0,0],flameDomainScale:2,flameDomainFollowSource:false});
assert.equal(planSceneRestore(withoutSource).flameDomainScale,2,'the field retains its box after removing the emitter');
assert.deepEqual(planSceneRestore(withoutSource).flameDomainTranslation,[1,0,0]);
