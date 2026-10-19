// kaminos-test: node
import assert from 'node:assert/strict';
import {createFingerFluidDiagnosticShaderFixture} from '../finger-fluid-webgpu-core.js';
import {applyWorldSpaceNeighbors,worldNeighborFunctions} from '../finger-fluid-world-neighbors.mjs';
const original=createFingerFluidDiagnosticShaderFixture();
const transformed=applyWorldSpaceNeighbors(original,{cellWidth:.185});
assert.ok(original.includes('clamp((position - params.boundsMin.xyz) / span'),'The legacy route retains its original bounded grid');
assert.ok(!transformed.includes('neighborCell >= vec3<i32>(params.gridDims.xyz)'),'World cells cannot be rejected by former search dimensions');
const loops=[...transformed.matchAll(/while \(current >= 0\) \{([\s\S]*?)current = particleNext\[neighborIndex\]\.w;/g)];
assert.equal(loops.length,13,'Every production neighbor consumer must use the same collision-safe list');
for(const [,loop] of loops)assert.ok(loop.includes('particleNext[neighborIndex].xyz != neighborCell'),'Hash collisions must be filtered before any neighbor effect');
assert.throws(()=>applyWorldSpaceNeighbors(original.replace('let neighborIndex = u32(current);','let unexpectedNode = u32(current);'),{cellWidth:.185}),/every bucket/,'A new unadapted traversal must fail compilation visibly');
for(const cellWidth of [0,-1,NaN,Infinity,1e-50,1e50])assert.throws(()=>worldNeighborFunctions(cellWidth),/positive finite f32/);
console.log('All production neighbor loops retain exact build-time cell membership; legacy route unchanged');
