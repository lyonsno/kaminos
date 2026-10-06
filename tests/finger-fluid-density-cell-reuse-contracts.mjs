import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createDensityCellReuseShader as transform} from '../finger-fluid-density-cell-reuse.mjs';
const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');const variant=transform(source);
const lambda=variant.slice(variant.indexOf('fn compute_density_lambda('),variant.indexOf('fn solve_position_delta('));const delta=variant.slice(variant.indexOf('fn solve_position_delta('),variant.indexOf('fn apply_position_delta('));
assert.match(lambda,/density_neighbor_cell_might_contribute/);assert.doesNotMatch(delta,/density_neighbor_cell_might_contribute/);assert.match(delta,/u32\(particles\[index\]\.delta\.x\)/);assert.match(lambda,/f32\(densityCellAdmissionMask & 65535u\)/);assert.match(delta,/particles\[index\]\.delta = vec4<f32>/);
for(const mask of [0,2**27-1,...Array.from({length:27},(_,i)=>2**i)]){const lo=Math.fround(mask&65535),hi=Math.fround(mask>>>16);assert.equal((lo>>>0)|((hi>>>0)<<16),mask);}
for(const bad of ['',source.replaceAll('var z = -1; z <= 1','var z = -2; z <= 2'),source.replaceAll('var gradientSquared = 0.0;','var gradientSquared = 1.0;')])assert.throws(()=>transform(bad));
assert.equal((variant.match(/var densityCellAdmissionMask =/g)||[]).length,1);
console.log('cell admission reuse source and exact27bit encoding contracts passed');
