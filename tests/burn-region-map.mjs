// kaminos-test: node
import assert from 'node:assert/strict';
import * as core from '../burn-structure-core.mjs';

assert.equal(typeof core.mapBurnRegions,'function','Live fracture needs stable ownership of the original material cells');
const material={bounds:{min:[0,0,0],max:[2,2,2]},dimensions:[2,2,2],initial:new Uint32Array(8).fill(1)};
const prepared={cells:[{index:0},{index:1}],pieces:[
 {index:0,bounds:{min:[0,0,0],max:[1,2,2]}},
 {index:1,bounds:{min:[1,0,0],max:[2,2,2]}},
]};
const mapped=core.mapBurnRegions(prepared,material);
assert.deepEqual([...mapped.owners],[0,1,0,1,0,1,0,1]);
assert.deepEqual([...mapped.counts],[4,4]);
assert.deepEqual([...mapped.cells],[0,2,4,6,1,3,5,7]);
assert.deepEqual([...mapped.spans],[0,4,4,4]);
const sparse=core.mapBurnRegions(prepared,{...material,initial:Uint32Array.of(1,0,0,0,0,0,0,1)});
assert.deepEqual([...sparse.counts],[1,1]);
assert.deepEqual([...sparse.cells],[0,7]);
assert.deepEqual([...sparse.owners],[0,1,0,1,0,1,0,1],'Empty cells have valid ownership but cannot add mass');
const subvoxel=core.mapBurnRegions(prepared,{...material,initial:Uint32Array.of(1,0,0,0,0,0,0,0)});
assert.deepEqual([...subvoxel.counts],[1,1],'Every piece must map to at least its nearest occupied voxel so no piece hovers forever with span.y==0');
assert.deepEqual([...subvoxel.cells],[0,0]);
for(const bad of [{...material,dimensions:[2,3,2]},{...material,initial:[]},{...material,bounds:{min:[0,0,0],max:[0,1,1]}}])assert.throws(()=>core.mapBurnRegions(prepared,bad));
assert.throws(()=>core.mapBurnRegions({...prepared,pieces:[]},material));
assert.throws(()=>core.mapBurnRegions({...prepared,pieces:[{...prepared.pieces[0],index:9}]},material));
