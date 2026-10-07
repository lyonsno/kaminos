import assert from 'node:assert/strict';
import * as stages from '../sparse-decoder.js';
import { WEBGPU_BUFFER_USAGE as U } from '../../../webgpu-inference-kit/src/core.js';
assert.equal(typeof stages.createTrellisSLatDecoderAdapter, 'function');
assert.equal(typeof stages.extractTrellisDualGridMesh, 'function',
  'Actual learned geometry channels must become a mesh, not displayed occupancy cubes or another tensor-only return.');
const { extractTrellisDualGridMesh, createTrellisMeshAdapter, encodeTrellisGeometryGLB } = stages;
assert.equal(typeof stages.compareTrellisMeshes,'function','Matched-input source vertices and exact triangle topology need separate falsifiable predicates.');
const coordinates = new Int32Array([0,0,0, 0,0,1, 0,1,1, 0,1,0]);
const features = new Float32Array(28);features[3] = 1;
const mesh = extractTrellisDualGridMesh({ features, coordinates, resolution: 2 });
assert.equal(stages.compareTrellisMeshes(mesh,mesh).passed,true);
assert.equal(stages.compareTrellisMeshes({...mesh,triangles:new Uint32Array([0,1,2,0,2,3])},mesh).passed,false);
assert.equal(stages.compareTrellisMeshes({...mesh,vertices:new Float32Array([NaN,...mesh.vertices.slice(1)])},mesh).passed,false);
assert.equal(stages.compareTrellisMeshes({...mesh,vertices:mesh.vertices.slice(1)},mesh).passed,false);
const wrongVertex=mesh.vertices.slice();wrongVertex[0]+=.001;
assert.equal(stages.compareTrellisMeshes({...mesh,vertices:wrongVertex},mesh).passed,false);
assert.deepEqual([...mesh.vertices], [-.25,-.25,-.25, -.25,-.25,.25, -.25,.25,.25, -.25,.25,-.25]);
assert.deepEqual([...mesh.triangles], [0,1,3, 3,1,2], 'Equal split products take the source strict-greater false branch.');
assert.equal(mesh.status, 'surface');assert.equal(mesh.quadCount, 1);
const firstSplit = features.slice();firstSplit[6] = 4;firstSplit[20] = 4;
assert.deepEqual([...extractTrellisDualGridMesh({ features: firstSplit, coordinates, resolution: 2 }).triangles], [0,1,2, 0,2,3]);
for (const [f,c] of [[new Float32Array(28),coordinates], [features.slice(0,21),coordinates.slice(0,9)]]) {
  const empty = extractTrellisDualGridMesh({ features:f,coordinates:c,resolution:2 });
  assert.equal(empty.status,'no-surface');assert.equal(empty.vertices.length,0);assert.equal(empty.triangles.length,0);
  assert.throws(() => encodeTrellisGeometryGLB(empty), /empty|surface/);
}
assert.throws(() => extractTrellisDualGridMesh({ features,coordinates:new Int32Array([0,0,0,0,0,0,0,1,1,0,1,0]),resolution:2 }), /duplicate/);
assert.throws(() => extractTrellisDualGridMesh({ features,coordinates:new Int32Array([-1,0,0,0,0,1,0,1,1,0,1,0]),resolution:2 }), /coordinate/);
assert.throws(() => extractTrellisDualGridMesh({ features:new Float32Array([NaN,...features.slice(1)]),coordinates,resolution:2 }), /finite/);
assert.throws(() => extractTrellisDualGridMesh({ features:features.slice(1),coordinates,resolution:2 }), /complete/);
const reads = [], featureTensor = { shape:[4,7],dtype:'f32',byteLength:112,usage:U.storage,buffer:{} },
  coordinateTensor = { shape:[4,3],dtype:'i32',byteLength:48,usage:U.storage,buffer:{} };
const runtime = { device:{queue:{async onSubmittedWorkDone(){}}}, async readTensor(t) {
  reads.push(t);return (t === featureTensor ? features : coordinates).buffer.slice(0);
} };
const consumer = createTrellisMeshAdapter({ runtime, decoded:{features:featureTensor,coordinates:coordinateTensor,resolution:2} });
const consumed = await consumer.run();assert.deepEqual(consumed.vertices,mesh.vertices);
assert.equal(consumed.handoff.featureBytesToCPU,112);assert.equal(consumed.handoff.coordinateBytesToCPU,48);
assert.equal(consumed.handoff.phase,'post-decoder-geometry-consumer');assert.deepEqual(reads,[featureTensor,coordinateTensor]);
consumer.dispose();assert.equal(featureTensor.buffer.destroy,undefined);
const bytes = encodeTrellisGeometryGLB(mesh,{provenance:{inputHandoff:'saved latent; native decoder; browser mesh'}}), view = new DataView(bytes);
assert.equal(view.getUint32(0,true),0x46546c67);assert.equal(view.getUint32(4,true),2);assert.equal(view.getUint32(8,true),bytes.byteLength);
assert.equal(view.getUint32(16,true),0x4e4f534a);
const jsonLength=view.getUint32(12,true),gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));
assert.equal(gltf.accessors[0].count,4);assert.equal(gltf.accessors[1].count,6);
assert.equal(gltf.accessors[0].componentType,5126);assert.equal(gltf.accessors[1].componentType,5125);
assert.equal(gltf.meshes[0].primitives[0].mode,4);assert.equal(gltf.materials[0].pbrMetallicRoughness.metallicFactor,0);
assert.equal(gltf.materials[0].doubleSided,true,'Neutral diagnostic must preserve source TRELLIS back-face visibility.');
assert.equal(gltf.extras.trellis.provenance.inputHandoff,'saved latent; native decoder; browser mesh');
const binStart=20+jsonLength+8;assert.deepEqual(new Float32Array(bytes,binStart,12),mesh.vertices);
assert.deepEqual(new Uint32Array(bytes,binStart+48,6),mesh.triangles);
for (const surface of [
  {...mesh, vertices: new Float32Array([...mesh.vertices, 0, 0, 0])},
  {...mesh, triangles: new Uint32Array([0,0,0])},
]) {
  const glb = encodeTrellisGeometryGLB(surface), header = new DataView(glb), length = header.getUint32(12,true),
    doc = JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,length))), accessor = doc.accessors[2],
    normalView = doc.bufferViews[accessor.bufferView], normals = new Float32Array(glb,28+length+normalView.byteOffset,accessor.count*3);
  for (let i=0;i<normals.length;i+=3) assert.ok(Math.abs(Math.hypot(...normals.subarray(i,i+3))-1)<2e-7,
    'GLTF NORMAL vectors must remain finite and normalized for unused or degenerate vertices.');
}
console.log('Learned dual-grid channels yield source-ordered weighted quads, truthful no-surface/refusal, explicit GPU-to-mesh handoff and GLB2 geometry; local fixtures are not full checkpoint parity.');
