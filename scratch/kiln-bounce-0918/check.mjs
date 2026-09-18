import assert from 'node:assert/strict';
import {geometryBudget} from './geometry.mjs';
// Exact two-sided unit right triangle: count both physical input faces, expose opposed bins.
const positions=new Float32Array([0,0,0,1,0,0,0,1,0,0,1,0,1,0,0,0,0,0]);
const result=geometryBudget(positions,[2]);
assert.equal(result.area,1);assert.equal(result.triangles,2);
assert.equal(result.rows[0].occupiedCentroidCells,1);
assert.equal(result.rows[0].orientedCentroidCells,2);
assert.equal(result.rows[0].cellsWithOpposingNormals,1);
assert.equal(result.rows[0].probeCandidates,4);
assert.throws(()=>geometryBudget(new Float32Array(),[1]),/invalid triangle/);
assert.throws(()=>geometryBudget(new Float32Array([NaN,...Array(8).fill(0)]),[1]),/invalid triangle/);
assert.throws(()=>geometryBudget(positions,[0]),/invalid pitches/);
console.log('geometry accounting checks passed; no transport/quality claim');
