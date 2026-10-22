// kaminos-test: node
import assert from 'node:assert/strict';
import * as sampling from '../fire-shadow-sampling.mjs';
import {readFireShadowSceneSettings,fireShadowSceneRoute} from '../fire-shadow-scene-settings.mjs';

for(const grain of ['balanced-pairs','balanced-filter','balanced'])
  assert.equal(sampling.validateShadowComparison({grain}).grain,grain);
// Every aligned 8x4 neighborhood covers every phase once for EACH pair.
// This matters at paired2: unconditional phase coverage alone is insufficient.
for(const frame of [0,1,19,255])for(const tx of [-2,0,7])for(const ty of [-1,0,3]){
  const phases=[new Set(),new Set()];
  for(let y=0;y<4;y++)for(let x=0;x<8;x++){
    const cell=[tx*8+x,ty*4+y,0],p=sampling.balancedShadowPhase(cell,frame);
    assert.deepEqual(p,sampling.balancedShadowPhase(cell,frame));
    assert([0,1].includes(p.pair));assert(p.x>=0&&p.x<4&&p.y>=0&&p.y<4);
    phases[p.pair].add(p.y*4+p.x);
  }
  assert.deepEqual(phases.map(p=>p.size),[16,16]);
  for(let by=0;by<4;by+=2)for(let bx=0;bx<8;bx+=2){
    let sum=0;for(let y=0;y<2;y++)for(let x=0;x<2;x++)sum+=sampling.balancedShadowPhase([tx*8+bx+x,ty*4+by+y,0],frame).pair;
    assert.equal(sum,2,'each 2x2 covers both source pairs equally');
  }
}
assert.notDeepEqual(sampling.balancedShadowPhase([2,3,0],17),sampling.balancedShadowPhase([2,3,0],18));
for(const grain of ['balanced-pairs','balanced-filter','balanced']){
  const state={shadowSampling:'complementary',pointCount:4,pointSampling:'paired',shadowResolution:12,blockerSamples:1,filterSamples:1,shadowSoftness:1,shadowImplementation:'shared',shadowGrain:grain,shadowWorldCellSize:.02};
  const roundtrip=readFireShadowSceneSettings(new URLSearchParams(fireShadowSceneRoute(state)));
  assert.equal(roundtrip.shadowComparison.grain,grain);
  assert.equal(roundtrip.pointSampling,'paired');
}
console.log('PASS balanced pairs and conditional filter-phase coverage without extra samples');
