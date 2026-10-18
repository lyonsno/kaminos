// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readGLBWorldMesh} from '../mesh-lod-ladder.mjs';

// Build a GLB: one triangle, a parent node with a matrix (-90 deg about X) and a child with
// translation, rotation (90 deg about Z) and scale. Optionally quantized positions.
function glb({quantized = false, indices = true} = {}) {
  const pos = quantized ? new Int16Array([0,0,0, 32767,0,0, 0,32767,0, 0]) : new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  const idx = new Uint16Array([0,1,2, 0]);
  const bin = new Uint8Array(pos.byteLength + (indices ? idx.byteLength : 0));
  bin.set(new Uint8Array(pos.buffer)); if (indices) bin.set(new Uint8Array(idx.buffer), pos.byteLength);
  const s = Math.SQRT1_2;
  const json = {asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
    nodes: [{matrix: [1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1], children: [1]}, {mesh: 0, translation: [1,2,3], rotation: [0,0,s,s], scale: [2,2,2]}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, ...(indices ? {indices: 1} : {})}]}],
    buffers: [{byteLength: bin.length}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: pos.byteLength}, ...(indices ? [{buffer: 0, byteOffset: pos.byteLength, byteLength: 6}] : [])],
    accessors: [{bufferView: 0, componentType: quantized ? 5122 : 5126, count: 3, type: 'VEC3', ...(quantized ? {normalized: true} : {})},
      ...(indices ? [{bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR'}] : [])]};
  const text = new TextEncoder().encode(JSON.stringify(json)), tl = Math.ceil(text.length / 4) * 4, bl = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(28 + tl + bl), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true); dv.setUint32(12, tl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + tl); out.set(text, 20); dv.setUint32(20 + tl, bl, true); dv.setUint32(24 + tl, 0x004e4942, true); out.set(bin, 28 + tl);
  return out.buffer;
}

test('world positions apply the node hierarchy: parent matrix then child TRS', () => {
  const {vertices, faces} = readGLBWorldMesh(glb());
  assert.deepEqual([...faces], [0, 1, 2]);
  // child: scale 2, rotate 90 deg about Z, translate (1,2,3); parent (column-major): (x,y,z) -> (x,z,-y)
  const expect = [[1,2,3], [1,4,3], [-1,2,3]].map(([x,y,z]) => [x, z, -y]);
  for (let i = 0; i < 3; i++) for (let a = 0; a < 3; a++) assert.ok(Math.abs(vertices[i*3+a] - expect[i][a]) < 1e-6, `v${i}[${a}] ${vertices[i*3+a]} vs ${expect[i][a]}`);
});

test('non-indexed primitives get sequential indices', () => {
  assert.deepEqual([...readGLBWorldMesh(glb({indices: false})).faces], [0, 1, 2]);
});

test('quantized positions are refused rather than misread', () => {
  assert.throws(() => readGLBWorldMesh(glb({quantized: true})), /float positions/);
});
