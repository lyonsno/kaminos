import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as meshOps from '../trellis-mesh.js';
assert.equal(typeof meshOps.orientTrellisMeshFaces,'function',
  'The post-decoder consumer must unify source face winding before normals/UV/material encoding, not render raw inconsistent faces as a perforated model.');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/trellis-winding-source.json',import.meta.url)));
for(const row of fixture.cases){
 const vertices=new Float32Array(row.vertexCount*3),triangles=new Uint32Array(row.input.flat()),before=triangles.slice(),
   input={vertices,triangles,metadata:{marker:row.name}},output=meshOps.orientTrellisMeshFaces(input);
 assert.deepEqual([...output.triangles],row.expected.flat(),row.name+' observed source result');
 assert.deepEqual(triangles,before,'borrowed raw topology is not modified');
 assert.equal(output.vertices,vertices,'no vertex movement, pruning or copy');
 assert.equal(output.triangles.length,triangles.length,'every face is preserved');
 assert.equal(output.metadata.marker,row.name);
 assert.equal(output.metadata.faceOrientation.faceCount,row.input.length);
 assert.equal(output.metadata.faceOrientation.remainingManifoldDirectionConflicts,0);
 assert.deepEqual(meshOps.orientTrellisMeshFaces(output).triangles,output.triangles,'idempotent on unchanged oriented topology');
 for(let f=0;f<triangles.length;f+=3){
   assert.equal(output.triangles[f],triangles[f],'first index retained');
   assert.deepEqual([...output.triangles.subarray(f,f+3)].sort(),[...triangles.subarray(f,f+3)].sort(),'only within-face winding may change');
 }
 if(row.name==='nonmanifold-edge-not-paired')assert.equal(output.metadata.faceOrientation.nonmanifoldEdges,1,'three-way edge is reported, not silently paired');
}
assert.throws(()=>meshOps.orientTrellisMeshFaces({vertices:new Float32Array(9),triangles:new Uint32Array([0,1,3])}),/index|indices/);
assert.throws(()=>meshOps.orientTrellisMeshFaces({vertices:new Float32Array([NaN,0,0]),triangles:new Uint32Array([0,0,0])}),/finite/);
assert.throws(()=>meshOps.orientTrellisMeshFaces({vertices:new Float32Array(9),triangles:new Uint32Array([0,1])}),/complete|triangle/);
console.log('Observed source adjacency winding, preserved components/topology/borrowed inputs, nonmanifold disclosure and exact idempotence pass. No source-native cleanup/QEM or decoder fidelity claim.');
