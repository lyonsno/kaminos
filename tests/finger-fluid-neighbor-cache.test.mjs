// kaminos-test: node
import assert from 'node:assert/strict';
import {createFingerFluidDiagnosticShaderFixture} from '../finger-fluid-webgpu-core.js';
import {applyWorldSpaceNeighbors} from '../finger-fluid-world-neighbors.mjs';
const source=createFingerFluidDiagnosticShaderFixture();
const options={cellWidth:.1274,uniformSupportRadius:.1274,nominalCellWidth:.185,uniformVolumeScale:.3268};
const cached=applyWorldSpaceNeighbors(source,{...options,cacheSlots:512});
assert.match(cached,/fn build_fine_neighbor_cache\(/,'Cache must be constructed on GPU from current grid');
assert.match(cached,/fn build_nominal_neighbor_cache\(/,'Nominal cohesion support has separate neighbors');
assert.match(cached,/world_cache_count\(index\) >= 0/,'Overflow must select the full uncapped linked traversal');
assert.match(cached,/world_cache_store_count\(index, -1\)/);
assert.match(cached,/fn estimate_interface_curvature[^]*?world_cache_count\(index\)/);
const plain=applyWorldSpaceNeighbors(source,options);
assert.doesNotMatch(plain,/world_cache_count/);
for(const cacheSlots of [-1,1.5,NaN])assert.throws(()=>applyWorldSpaceNeighbors(source,{...options,cacheSlots}),/cache/i);
console.log('GPU cache transforms all radius consumers and retains complete overflow traversal');
