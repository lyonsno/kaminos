// kaminos-test: node
import assert from 'node:assert/strict';
let module;try{module=await import('../experiments/creature-motion/given-motion-source.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;module={};}
assert.equal(typeof module.validateGivenMotionSource,'function','continued motion lacks source/profile/preserved-prefix admission');
const prefix={status:'completed',route:'unimate.text-to-motion.webgpu-local.v0',controllerNorm:'valid-joints',cooperative:true,textEncoder:'browser T5',assetCondSha256:'a'.repeat(64),frames:2,joints:1,prompt:'trot',cfgScale:3,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},features:Array(24).fill(0),positions:Array(6).fill(0),localRotations:[1,0,0,0,1,0,0,0]};
assert.equal(module.validateGivenMotionSource({motion:prefix}).sampling,'dopri5-valid-joints');
const motion={...structuredClone(prefix),controllerNorm:null,sampling:'replacement-euler-50',frames:4,evaluations:50,
 features:Array(48).fill(0),positions:Array(12).fill(0),localRotations:[1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0],
 continuation:{schema:'kaminos.creature.continuation.v1',parentMotionSha256:'b'.repeat(64),prefixFrames:2,segmentFrames:3,overlap:1,addedSegments:1}};
const args={motion,prefix,prefixSha256:'b'.repeat(64)};
const effective=module.validateGivenMotionSource(args);assert.equal(effective.controllerNorm,null);assert.equal(effective.sampling,'replacement-euler-50');assert.equal(effective.prefixFrames,2);
for(const mutate of [m=>m.controllerNorm='valid-joints',m=>m.sampling='dopri5-valid-joints',m=>m.frames=5,m=>m.features[0]=.01,m=>m.positions[0]=.01,m=>m.localRotations[1]=.01,m=>m.assetCondSha256='c'.repeat(64),m=>m.continuation.parentMotionSha256='c'.repeat(64),m=>m.skeleton.parents=[0],m=>m.cooperative=false,m=>m.evaluations=49]){
 const bad=structuredClone(motion);mutate(bad);assert.throws(()=>module.validateGivenMotionSource({...args,motion:bad}));
}
assert.throws(()=>module.validateGivenMotionSource({motion}),/prefix/);
assert.equal(typeof module.prepareGivenContinuation,'function','continued native output lacks a truthful body-consumer export');
const source={rev:'c'.repeat(40),dirtyFiles:[]},raw={...structuredClone(motion),source};delete raw.route;delete raw.continuation;delete raw.controllerNorm;
raw.segmentFeatures=Array(36).fill(0);
const run={status:'completed',phase:'complete',source,segments:[{frames:4,evaluations:50}]};
const exported=module.prepareGivenContinuation({raw,run,prefix,prefixSha256:'b'.repeat(64)});
assert.equal(exported.controllerNorm,null);assert.equal(exported.continuation.segmentFrames,3);assert.equal(exported.generationSource.rev,source.rev);
assert.deepEqual(exported.positions,raw.positions,'export must not repair the generated trajectory');
assert.throws(()=>module.prepareGivenContinuation({raw,run:{...run,status:'failed'},prefix,prefixSha256:'b'.repeat(64)}),/generation/);
assert.throws(()=>module.prepareGivenContinuation({raw:{...raw,source:{...source,rev:'d'.repeat(40)}},run,prefix,prefixSha256:'b'.repeat(64)}),/source/);
assert.equal(typeof module.givenCanonicalGroundHeight,'function','given frame lacks a fixed canonical-y0 ground reference');
assert.equal(module.givenCanonicalGroundHeight({canonicalWorldToSourceNormalized:[[2,0,0,3],[0,2,0,-4],[0,0,2,1],[0,0,0,1]]}),-4);
assert.throws(()=>module.givenCanonicalGroundHeight({canonicalWorldToSourceNormalized:[[2,0,0,3],[.1,2,0,-4],[0,0,2,1],[0,0,0,1]]}),/horizontal/);
console.log('Continued source admits fixed sampler honestly and rejects changed prefix, route, topology and segment accounting');
