// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';
const options={renderer:{},scene:{},sourceNode:THREE.TSL.vec3(0),receiverNode:THREE.TSL.vec3(0,0,4),normalNode:THREE.TSL.vec3(0,0,-1),sourceSizeNode:THREE.TSL.float(.4),shadowSoftness:1};
assert.throws(()=>createFireLightFieldShadow({...options,shadowSampling:'blur'}),/sampling/,'unsupported sampling must not silently restore fixed mode');
const {complementaryDiskSample,validateShadowSampling}=await import('../fire-shadow-sampling.mjs');
const all=[],ids=new Set();
for(let py=0;py<4;py++)for(let px=0;px<4;px++){
  const cells=new Set();
  for(let i=0;i<16;i++){
    const p=complementaryDiskSample(i,px,py),r2=p[0]**2+p[1]**2;
    assert(r2>0&&r2<1,'same unit disk, no enlarged source footprint');
    const angle=((Math.atan2(p[1],p[0])+2*Math.PI)%(2*Math.PI))/(2*Math.PI);
    cells.add(`${Math.floor(r2*4)},${Math.floor(angle*4)}`);
    ids.add(p.map(x=>x.toFixed(8)).join(','));all.push(p);
  }
  assert.equal(cells.size,16,'one sample in every equal-area radial/angular stratum per pixel');
}
assert.equal(ids.size,256,'4x4 neighbors must cover complementary samples, not repeat sixteen offsets');
for(const edge of [-1,-.8,-.5,0,.5,.8,1]){
  const fraction=all.filter(p=>p[0]>edge).length/all.length;
  const exact=(Math.acos(edge)-edge*Math.sqrt(1-edge*edge))/Math.PI;
  assert(Math.abs(fraction-exact)<.025,`half-plane footprint coverage ${edge}`);
}
assert.deepEqual(complementaryDiskSample(5,2,3),complementaryDiskSample(5,2,3),'no frame/time input');
for(const args of [[16,0,0],[0,4,0],[0,0,-1],[.5,0,0]])assert.throws(()=>complementaryDiskSample(...args),/stratum|phase/);
for(const mode of ['fixed','complementary'])assert.equal(validateShadowSampling(mode),mode);
const shadow=createFireLightFieldShadow({...options,shadowSampling:'complementary'});
assert.equal(shadow.debugState().shadowSampling,'complementary');
shadow.setSampling('fixed');assert.equal(shadow.debugState().shadowSampling,'fixed');
assert.throws(()=>shadow.setSampling('blur'),/sampling/);assert.equal(shadow.debugState().shadowSampling,'fixed');
assert.equal(shadow.debugState().filterSamples,16);assert.equal(shadow.debugState().renderCount,0);shadow.dispose();
console.log('PASS complementary disk strata preserve footprint and cover distinct neighboring phases');
