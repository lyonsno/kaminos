// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptAshFlameRaster} from '../tools/ash-cloud-contracts.mjs';
test('available sidecar timestamps with no flame draw cannot pass ordinary raster admission',()=>{
 const noDraw={ok:true,gpuStageTiming:{timestampStatus:'available',stages:{sidecar:{status:'sampled',ms:.1},matchedRaymarchRaster:{status:'not-requested-by-presentation',ms:0}}},selectiveHeadLivePassReceipt:{raymarchEncoded:false,raymarchApplied:false}};
 assert.equal(acceptAshFlameRaster(noDraw),false);
 const good={ok:true,scope:'camera-raymarch-raster-only-not-lighting-simulation-or-frame',ms:.7,timestamps:['1000000','1700000'],simStepCount:123,width:640,height:480,backend:'native-3d-compute-fluid-raymarch-v0',controls:{resolution:32,raySteps:8},raymarchShaderSpecialization:{mode:'ordinary'},opticalStepping:{mode:'numerical'}};
 assert.equal(acceptAshFlameRaster(good,good),true);
 for(const change of [{ok:false},{ms:NaN},{ms:0},{timestamps:['0','1']},{timestamps:['2','1']},{width:0},{scope:'sidecar-only'},{simStepCount:124},{controls:{resolution:32,raySteps:4}},{backend:'fallback'}])assert.equal(acceptAshFlameRaster({...good,...change},good),false,JSON.stringify(change));
});
