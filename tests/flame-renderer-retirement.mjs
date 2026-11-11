// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as volume from '../volume-core.js';

test('retired flame boundary-splat renderer has no executable public API',()=>{
 const retired=['resolveBoundarySplatExecutionPlan','boundarySplatCapacityLimitReceipt','boundarySplatAllocateInstanceTiers','auditBoundarySplatNestedResidency','classifyBoundarySplatUnionCell','composeBoundarySplatOpticalLayers'];
 assert.deepEqual(retired.filter(name=>typeof volume[name]==='function'),[], 'retired flame renderer remains executable');
 assert.equal(typeof volume.createKaminosVolumePrototype,'function');
});

test('retired renderer options are removed before they can influence current simulation and optical controls',()=>{
 const obsolete={boundarySplatMode:'kernel_moment_covariance',boundarySplatFeatureCapture:true,boundarySplatRadius:3,boundarySplatRadianceGain:10,boundarySplatOpacityGain:9,flowKernelDescriptorCapture:true,volumeResidualMode:'webgpu-direct-residual',volumeResidualModelUrl:'old-model.json',volumeResidualStrength:2,volumeResidualFeatureDebug:1};
 const active={resolution:8,boundarySidecarSource:'baked',reactionLaw:'reactant-v0',opticalParticleSettings:{enabled:true,exchangeStrength:1}};
 const input={...active,...obsolete},before=structuredClone(input);
 const result=volume.stripRetiredRaymarchControls(input);
 assert.deepEqual(result.controls,active,'retired options must leave the effective runtime control set');
 assert.deepEqual(input,before,'reading an old preset must not mutate its source');
 assert.deepEqual(new Map(result.retiredRaymarchControls.map(row=>[row.key,row.value])),new Map(Object.entries(obsolete)),'retirement remains visible in the existing compatibility receipt');
});
