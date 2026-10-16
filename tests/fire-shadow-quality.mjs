// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';
import * as filter from '../fire-shadow-filter.mjs';
import {complementaryDiskSample} from '../fire-shadow-sampling.mjs';
import {shadowStrata} from '../fire-shadow-quality.mjs';
const options={renderer:{},scene:{},sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0,0,4),normalNode:THREE.TSL.vec3(0,0,-1),sourceSizeNode:THREE.TSL.float(.4),shadowSoftness:1};
const shadow=createFireLightFieldShadow({...options,resolution:128,blockerSamples:3,filterSamples:8});
assert.equal(shadow.debugState().blockerSamples,3,'requested blocker count must reach the shadow consumer');
assert.equal(shadow.debugState().filterSamples,8,'requested filter count must reach the shadow consumer');
assert.equal(shadow.resource().resolution,128);
shadow.dispose();
for(const field of ['blockerSamples','filterSamples'])for(const value of [0,-1,1.5,NaN,Infinity])
  assert.throws(()=>createFireLightFieldShadow({...options,[field]:value}),/positive integer/);
assert.deepEqual(filter.shadowDisk(9,true),filter.BLOCKER_DISK,'baseline blocker pattern unchanged');
assert.deepEqual(filter.shadowDisk(16),filter.FILTER_DISK,'baseline fixed filter unchanged');
for(const count of [1,2,3,4,8,12,16,24,32]){
  const disk=filter.shadowDisk(count);assert.equal(disk.length,count);
  for(let i=0;i<count;i++)assert(Math.abs(disk[i][0]**2+disk[i][1]**2-(i+.5)/count)<1e-12,'reduced budgets span full disk instead of taking a central prefix');
  const blockers=filter.shadowDisk(count,true);assert.equal(blockers.length,count);assert.deepEqual(blockers[0],[0,0]);
  const {bands,sectors}=shadowStrata(count),distinct=new Set();
  for(let x=0;x<4;x++)for(let y=0;y<4;y++){
    const cells=new Set();
    for(let i=0;i<count;i++){
      const p=complementaryDiskSample(i,x,y,count),r2=p[0]**2+p[1]**2;
      const a=((Math.atan2(p[1],p[0])+2*Math.PI)%(2*Math.PI))/(2*Math.PI);
      assert(r2>0&&r2<1);cells.add(`${Math.floor(r2*bands)},${Math.floor(a*sectors)}`);
      distinct.add(p.map(v=>v.toFixed(8)).join(','));
    }
    assert.equal(cells.size,count);
  }
  assert.equal(distinct.size,count*16,'neighbors retain complementary samples for every budget');
}
console.log('PASS shadow quality counts, full support, validation and baseline patterns');
