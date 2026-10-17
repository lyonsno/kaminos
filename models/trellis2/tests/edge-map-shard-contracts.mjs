// kaminos-test: node
// Edge-keyed maps in the cleanup are sharded so surfaces with more than 2**24
// edges (V8's Map limit) still clean; forcing tiny shards on every recorded
// fixture must reproduce the source finisher's bytes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface,cleanupMesh,setEdgeMapShardForTests,edgeMapShardsUsedForTests,edgeMapLargestShardForTests} from '../mesh-cleanup.js';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/mesh-finishing-source.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
// Full cleanup of each raw fixture (every step, including hole filling), unsharded.
const plain={};
for(const [name,spec] of Object.entries(MESH_FINISHING_CASES)){const {vertices,triangles}=spec.build();plain[name]=cleanupMesh(vertices,triangles);}
setEdgeMapShardForTests(97);
try{
  for(const [name,spec] of Object.entries(MESH_FINISHING_CASES)){
    const expected=fixture.cases[name],{vertices,triangles}=spec.build();
    const r=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:expected.targetFaces});
    assert.equal(sha(r.vertices),expected.output.verticesSha256,name+': sharded finisher positions equal the source finisher');
    assert.equal(sha(r.faces),expected.output.trianglesSha256,name+': sharded finisher triangles equal the source finisher');
    const c=cleanupMesh(vertices,triangles);
    assert.equal(sha(c.faces),sha(plain[name].faces),name+': sharded raw cleanup equals unsharded');
    assert.equal(sha(c.vertices),sha(plain[name].vertices),name+': sharded raw cleanup positions equal unsharded');
  }
  assert.ok(edgeMapShardsUsedForTests()>10,'the fixtures actually ran across many shards');
  assert.ok(edgeMapLargestShardForTests()<=97,`no single map exceeds the shard size, whatever the key pattern (largest ${edgeMapLargestShardForTests()})`);
}finally{setEdgeMapShardForTests(1<<23);}
