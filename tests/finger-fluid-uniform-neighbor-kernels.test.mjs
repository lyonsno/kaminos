// kaminos-test: node
import assert from 'node:assert/strict';
import {createFingerFluidDiagnosticShaderFixture} from '../finger-fluid-webgpu-core.js';
import {applyWorldSpaceNeighbors} from '../finger-fluid-world-neighbors.mjs';
const original=createFingerFluidDiagnosticShaderFixture();
const body=(source,name)=>source.match(new RegExp(`fn ${name}\\([^]*?\\{([^]*?)\\n}`))?.[1];
const volume=Math.fround(.3268);
const uniform=applyWorldSpaceNeighbors(original,{cellWidth:.1274,uniformSupportRadius:.1274,nominalCellWidth:.185,uniformVolumeScale:volume});
assert.doesNotMatch(body(uniform,'adaptive_radius_scale'),/pow\(/,'Uniform particles must not recompute cube roots in each neighbor interaction');
assert.doesNotMatch(body(uniform,'adaptive_volume_scale'),/neighborTopology\[/,'Uniform pair kernels must not load invariant particle volume per interaction');
assert.match(body(uniform,'adaptive_volume_scale'),/worldUniformParticleVolume/);
assert.match(body(uniform,'adaptive_radius_scale'),/worldUniformParticleRadius/);
assert.equal(body(uniform,'adaptive_pair_kernel_weight'),body(original,'adaptive_pair_kernel_weight'),'Pair weighting arithmetic and physical support remain the same');
assert.equal(body(uniform,'adaptive_pair_kernel_gradient'),body(original,'adaptive_pair_kernel_gradient'),'Gradient arithmetic and physical support remain the same');
const variable=applyWorldSpaceNeighbors(original,{cellWidth:.185});
assert.match(body(variable,'adaptive_radius_scale'),/pow\(/,'Variable populations retain their adaptive radii');
for(const v of [0,-1,NaN,Infinity,1e-50,1e50])assert.throws(()=>applyWorldSpaceNeighbors(original,{cellWidth:.1,uniformVolumeScale:v}),/positive finite f32/);
assert.throws(()=>applyWorldSpaceNeighbors(original.replace('fn adaptive_volume_scale(','fn unexpected_volume('),{cellWidth:.1,uniformVolumeScale:1}),/uniform.*contract/i);
console.log('Uniform pair kernels eliminate invariant topology reads and cube roots; variable kernels and pair laws are preserved');
