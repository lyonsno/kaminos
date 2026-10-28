// kaminos-test: node
import assert from 'node:assert/strict';
import {integrateVolumeRay} from '../scene-volume-gather.mjs';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';
for(const phase of [1/512,.17,.5,.93,511/512]){
 const result=integrateVolumeRay(()=>[2,1,.5,3],2,.17,phase);
 assert(Math.abs(result[0]-2*(1-Math.exp(-6))/3)<1e-12,'jitter preserves a constant emitting/extinguishing segment');
}
const left=integrateVolumeRay(t=>[t,0,0,0],1,.25,.1)[0],right=integrateVolumeRay(t=>[t,0,0,0],1,.25,.9)[0];
assert(right>left,'phase must change the actual integration sample, not only metadata');
assert(Math.abs((left+right)/2-.5)<1e-12,'complementary strata cover the full interval without dropping its ends');
const noise=await import('../scene-light-noise.mjs');
assert.equal(typeof noise.smokeNoiseAddress,'function');
const samples=[];
for(let frame=0;frame<32;frame++)samples.push(noise.smokeNoiseAddress([3,5,7],frame,4));
assert.equal(new Set(samples.map(p=>p.join(','))).size,32,'use the existing 32 temporal tiles');
for(const p of samples)assert(p[0]>=0&&p[0]<1024&&p[1]>=0&&p[1]<512);
assert.deepEqual(noise.smokeNoiseAddress([3,5,7],0,4),noise.smokeNoiseAddress([3,5,7],32,4));
assert.notDeepEqual(noise.smokeNoiseAddress([3,5,7],0,4),noise.smokeNoiseAddress([3,5,8],0,4),'depth slices must not collapse to one plane');
assert.equal(readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute({angularPattern:'blue',pointCount:4,pointSampling:'all',shadowResolution:128,blockerSamples:2,filterSamples:2,shadowSampling:'complementary',shadowSoftness:1,shadowImplementation:'shared',shadowGrain:'ordered',shadowWorldCellSize:.02}))).angularPattern,'blue');
console.log('PASS blue-noise atlas addressing, full-segment quadrature and saved mode');
