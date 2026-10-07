import test from 'node:test';
import assert from 'node:assert/strict';
const packet=()=>({normalized:{sourceAuthority:'live_simulation_authority',inlets:[{id:'water'}]},data:new Float32Array(20)});
test('pose-only inlet edits preserve the release clock; supply, identity and activation edits do not',async()=>{
 const m=await import('../local-liquid-inlet-continuity.mjs').catch(()=>({}));
 assert.equal(typeof m.canPreserveLiquidReleaseEpoch,'function','pose edits need a distinct cadence decision');
 const before=packet(),pose=packet();for(const i of [0,1,2,4,5,6,8,9,10])pose.data[i]=i+.5;
 assert.equal(m.canPreserveLiquidReleaseEpoch(before,pose),true);
 for(const i of [3,7,11,12,13,14,15,16,17,18,19]){const next=packet();next.data[i]=1;assert.equal(m.canPreserveLiquidReleaseEpoch(before,next),false);}
 const renamed=packet();renamed.normalized.inlets[0].id='other';assert.equal(m.canPreserveLiquidReleaseEpoch(before,renamed),false);
 assert.equal(m.canPreserveLiquidReleaseEpoch(null,pose),false);
});
test('depth draw excludes both background forms and restores them after success or failure',async()=>{
 const m=await import('../local-liquid-depth-background.mjs').catch(()=>({}));
 assert.equal(typeof m.withLocalLiquidDepthBackground,'function','host depth must exclude the environment background node');
 const scene={background:{name:'sky'},backgroundNode:{name:'graded-sky'}};const saved={...scene};
 m.withLocalLiquidDepthBackground(scene,()=>{assert.equal(scene.background,null);assert.equal(scene.backgroundNode,null);});
 assert.deepEqual(scene,saved);
 assert.throws(()=>m.withLocalLiquidDepthBackground(scene,()=>{throw Error('draw failed');}),/draw failed/);assert.deepEqual(scene,saved);
});
