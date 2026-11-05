// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {createSceneSolidGeometryCache} from '../volume-scene-solid.mjs';
let gpuUpdates=0;
const result={backend:'gpu',revision:'pose-1'};
const cache=createSceneSolidGeometryCache({
  voxelize(){throw Error('Moving-mesh GPU route still reaches CPU triangle voxelization');},
  gpuProducer:{update(){gpuUpdates++;return result;}}
});
assert.equal(cache.update([{id:'mesh',object:new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5))}],{translate:[0,0,0],scale:1},{grid:32,gridHeight:32}),result);
assert.equal(gpuUpdates,1);

const {createResidentSolidMeshes}=await import('../scene-solid-gpu.mjs');
let uploads=0,releases=0;
const resident=createResidentSolidMeshes({upload(data){uploads++;assert.ok(data.every(Number.isFinite));return {data};},release(){releases++;}});
const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));
const objects=[{id:'log',object:mesh}],domain={translate:[0,0,0],scale:1};
const a=resident.update(objects,domain);assert.equal(uploads,1);
mesh.position.x=.2;const b=resident.update(objects,domain);
assert.notEqual(a[0].revision,b[0].revision);assert.equal(uploads,1,'drag must retain local triangles');
assert.equal(b[0].draws[0].matrix[12],.2);
resident.update(objects,{translate:[.1,0,0],scale:2});assert.equal(uploads,1,'moving domain must not reupload geometry');
mesh.geometry.attributes.position.needsUpdate=true;resident.update(objects,domain);assert.equal(uploads,2);assert.equal(releases,1);
resident.update([],domain);assert.equal(releases,2,'removed collider releases its mesh buffer');
assert.throws(()=>resident.update([{id:'a',object:mesh},{id:'a',object:mesh}],domain),/identity/);
resident.destroy();

// ASHLOD-F1 contract: createGpuSceneSolidProducer keeps materialMasks and boundaryCap in disjoint uniform regions
// and re-runs init/connect/fill when boundaryCap changes or is cleared on an unchanged mesh revision.
{
  globalThis.GPUBufferUsage ??= {STORAGE: 1, COPY_DST: 2, COPY_SRC: 4, UNIFORM: 8};
  globalThis.GPUTextureUsage ??= {TEXTURE_BINDING: 1, STORAGE_BINDING: 2, COPY_SRC: 4, COPY_DST: 8};
  globalThis.GPUShaderStage ??= {COMPUTE: 1};
  const {createGpuSceneSolidProducer} = await import('../scene-solid-gpu.mjs');
  const writes = [];
  const dispatches = [];
  const fakeDevice = {
    createBuffer({label, size}) {
      return {label, size, destroyed: false, destroy() { this.destroyed = true; }};
    },
    createTexture({label, size}) {
      return {label, size, createView() { return {label}; }, destroy() {}};
    },
    createShaderModule({code}) { return {code}; },
    createBindGroupLayout() { return {}; },
    createPipelineLayout() { return {}; },
    createComputePipeline({label}) { return {label}; },
    createBindGroup() { return {}; },
    queue: {
      writeBuffer(buf, offset, data) {
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
        writes.push({label: buf.label, size: buf.size, offset, bytes});
      },
    },
  };
  const fakeEncoder = {
    clearBuffer() {},
    copyBufferToBuffer() {},
    beginComputePass({label}) {
      return {
        setPipeline() {},
        setBindGroup() {},
        dispatchWorkgroups(n) { dispatches.push({label, n}); },
        end() {},
      };
    },
  };
  const producer = createGpuSceneSolidProducer(fakeDevice, {grid: 16, gridHeight: 16});
  const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5));
  const matTex = fakeDevice.createTexture({label: 'matTex', size: [4, 4, 4]});
  const capTex = fakeDevice.createTexture({label: 'capTex', size: [8, 8, 8]});
  const matMatrix = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 1, 2, 3, 1];
  const cap1 = {texture: capTex, origin: [-1, -1, -1], step: 0.25, boundsMin: [-0.8, -0.8, -0.8], boundsMax: [0.8, 0.8, 0.8]};

  // 1. Both materialMasks and boundaryCap active simultaneously must not clobber each other
  const u1 = producer.update(
    [{id: 'kiln', object: boxMesh}],
    {translate: [0, 0, 0], scale: 1},
    {grid: 16, gridHeight: 16},
    {materialMasks: [{objectId: 'kiln', device: fakeDevice, texture: matTex, matrix: matMatrix, revision: 1}], boundaryCap: cap1}
  );
  const matWrites = writes.filter(w => w.label === 'scene solid remaining material');
  assert.ok(matWrites.length >= 1, 'must write materialUniform');
  const lastMatWrite = matWrites.at(-1);
  assert.equal(lastMatWrite.size, 128, 'materialUniform must be 128 bytes so worldToMaterial and boundaryCap do not alias');
  const f32 = new Float32Array(lastMatWrite.bytes.buffer, lastMatWrite.bytes.byteOffset, 32);
  const u32 = new Uint32Array(lastMatWrite.bytes.buffer, lastMatWrite.bytes.byteOffset, 32);
  assert.deepEqual(Array.from(f32.slice(0, 16)), matMatrix, 'worldToMaterial preserved in floats 0..15');
  assert.deepEqual(Array.from(f32.slice(16, 20)), [-1, -1, -1, 0.25], 'capOriginStep preserved in floats 16..19');
  assert.equal(u32[28], 1, 'material.enabled.x === 1');
  assert.equal(u32[29], 1, 'material.enabled.y === 1');

  dispatches.length = 0;
  assert.equal(producer.encode(fakeEncoder), true);
  assert.ok(dispatches.some(d => d.label === 'scene solid init'), 'initial encode runs init');

  // 2. Updating boundaryCap parameters with the same mesh revision must invalidate m.dirty and re-run init/connect/fill
  const cap2 = {texture: capTex, origin: [-2, -2, -2], step: 0.5, boundsMin: [-1.5, -1.5, -1.5], boundsMax: [1.5, 1.5, 1.5]};
  const u2 = producer.update(
    [{id: 'kiln', object: boxMesh}],
    {translate: [0, 0, 0], scale: 1},
    {grid: 16, gridHeight: 16},
    {boundaryCap: cap2}
  );
  assert.notEqual(u1.key, u2.key, 'changing boundaryCap must update producer revision key');
  dispatches.length = 0;
  assert.equal(producer.encode(fakeEncoder), true);
  assert.ok(dispatches.some(d => d.label === 'scene solid init'), 'changing boundaryCap on same mesh revision must re-run init/connect/fill');

  // 3. Clearing boundaryCap to null must zero materialUniform and re-run init/connect/fill
  const u3 = producer.update(
    [{id: 'kiln', object: boxMesh}],
    {translate: [0, 0, 0], scale: 1},
    {grid: 16, gridHeight: 16},
    {boundaryCap: null}
  );
  assert.notEqual(u2.key, u3.key, 'clearing boundaryCap must update producer revision key');
  const clearedWrite = writes.filter(w => w.label === 'scene solid remaining material').at(-1);
  const clearedU32 = new Uint32Array(clearedWrite.bytes.buffer, clearedWrite.bytes.byteOffset, 32);
  assert.equal(clearedU32[28], 0, 'cleared material.enabled.x === 0');
  assert.equal(clearedU32[29], 0, 'cleared material.enabled.y === 0');
  dispatches.length = 0;
  assert.equal(producer.encode(fakeEncoder), true);
  assert.ok(dispatches.some(d => d.label === 'scene solid init'), 'clearing boundaryCap must re-run init/connect/fill');
  // The live thermal producer changes worldToMaterial with pose while its
  // generation:steps revision stays fixed (live-log-heat-gpu.mjs).
  const material={objectId:'kiln',device:fakeDevice,texture:matTex,matrix:new THREE.Matrix4().elements.slice(),revision:'0:10'};
  const beforeMove=producer.update([{id:'kiln',object:boxMesh}],domain,{grid:16,gridHeight:16},{materialMasks:[material]});
  producer.encode(fakeEncoder);
  boxMesh.position.x=1;material.matrix[12]=-1;
  producer.update([{id:'kiln',object:boxMesh}],domain,{grid:16,gridHeight:16},{materialMasks:[material]});
  let moved=writes.filter(w=>w.label==='scene solid remaining material').at(-1);
  assert.equal(new Float32Array(moved.bytes.buffer,moved.bytes.byteOffset,32)[12],-1,'moved pose uploads material transform at unchanged thermal revision');
  producer.encode(fakeEncoder);
  material.matrix[12]=-2;
  const matrixOnly=producer.update([{id:'kiln',object:boxMesh}],domain,{grid:16,gridHeight:16},{materialMasks:[material]});
  assert.notEqual(matrixOnly.key,beforeMove.key,'mask matrix participates in producer identity');
  assert.equal(producer.encode(fakeEncoder),true,'mask-only transform change recomposes collision');
  moved=writes.filter(w=>w.label==='scene solid remaining material').at(-1);
  assert.equal(new Float32Array(moved.bytes.buffer,moved.bytes.byteOffset,32)[12],-2,'mutable input array is compared against retained snapshot');
  producer.destroy();
}
