// kaminos-test: node
import assert from 'node:assert/strict';
import {assertCoarseWitnessSource} from '../tools/fracture-coarse-witness-contract.mjs';
const input={initial:{source:'/source-A.glb',prepared:{receipt:{sourceTriangles:100}},material:{backend:'webgpu-avbd'}},runtime:{config:{source:{commit:'test-commit'}}},commit:'test-commit',spec:{source:'/source-A.glb',triangles:100,sha256:'asset-A-digest'},digest:'asset-A-digest'};
assert.doesNotThrow(()=>assertCoarseWitnessSource(input));
assert.throws(()=>assertCoarseWitnessSource({...input,initial:{...input.initial,source:'/source-B.glb'}}),/source.*identity/i,'Different sources with equal triangle counts must be rejected');
assert.throws(()=>assertCoarseWitnessSource({...input,initial:{...input.initial,material:{backend:'cpu-fallback'}}}),/solver/);
assert.throws(()=>assertCoarseWitnessSource({...input,digest:'asset-B-digest'}),/bytes/);
assert.throws(()=>assertCoarseWitnessSource({...input,commit:'stale-commit'}),/revision/);
console.log('coarse witness binds effective source, digest, backend and revision');
