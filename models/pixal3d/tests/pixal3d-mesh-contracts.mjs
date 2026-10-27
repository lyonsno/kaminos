import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const source = new URL('../pixal3d-mesh.js', import.meta.url);
assert.ok(existsSync(source), 'Missing Pixal3D mesh extraction and GLB frame export module.');
const {
  PIXAL3D_GLB_NODE_MATRIX,
  toPixal3dGlbFrame,
  encodePixal3dGeometryGLB,
  extractPixal3dDualGridMesh,
  createPixal3dMeshAdapter,
  comparePixal3dMeshes,
} = await import(source);

// 1. Verify PIXAL3D_GLB_NODE_MATRIX is the column-major 4x4 matrix for (x, y, z) -> (-x, y, -z)
assert.deepEqual(
  PIXAL3D_GLB_NODE_MATRIX,
  [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
);

// 2. Verify toPixal3dGlbFrame matches upstream composite transform:
//    step 1 (grid2mesh): (x, y, z) -> (x, z, -y)
//    step 2 (to_glb Z-up->Y-up): (x', y', z') -> (x', z', -y') = (x, -y, -z)
//    step 3 (to_glb 180 deg Y-rot): (x'', y'', z'') -> (-x'', y'', -z'') = (-x, -y, z)?
//    Wait: in step 1: new_y = z, new_z = -y -> (x, z, -y).
//    In step 2: [[1,0,0],[0,0,-1],[0,1,0]] @ [x, z, -y]^T = [x, y, z]^T!
//    In step 3: [[-1,0,0],[0,1,0],[0,0,-1]] @ [x, y, z]^T = [-x, y, -z]^T!
const rawVertices = new Float32Array([
  1.25, -2.5, 3.75,
  -0.5, 0.0, -1.0,
]);
const transformed = toPixal3dGlbFrame(rawVertices);
assert.deepEqual(
  Array.from(transformed),
  [-1.25, -2.5, -3.75, 0.5, 0.0, 1.0],
);
assert.equal(transformed[1], -2.5);
assert.ok(Object.is(transformed[4], 0.0), 'zero sign normalized');
// Original array must not be mutated
assert.equal(rawVertices[0], 1.25);

assert.throws(() => toPixal3dGlbFrame(new Float32Array([1, 2])), /multiple of 3/);

// 3. Verify encodePixal3dGeometryGLB produces a valid GLB v2 binary with PIXAL3D_GLB_NODE_MATRIX
const mesh = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2]),
  metadata: { resolution: 16 },
};
const glbBuffer = encodePixal3dGeometryGLB(mesh, { provenance: { model: 'pixal3d' } });
const view = new DataView(glbBuffer);
assert.equal(view.getUint32(0, true), 0x46546c67, 'glTF magic');
assert.equal(view.getUint32(4, true), 2, 'glTF version 2');
assert.equal(view.getUint32(8, true), glbBuffer.byteLength);
const jsonLength = view.getUint32(12, true);
assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSON chunk magic');
const jsonText = new TextDecoder().decode(new Uint8Array(glbBuffer, 20, jsonLength)).trim();
const doc = JSON.parse(jsonText);
assert.deepEqual(doc.nodes[0].matrix, Array.from(PIXAL3D_GLB_NODE_MATRIX));
assert.equal(doc.extras.pixal3d.provenance.model, 'pixal3d');

// 4. Verify dual-grid extraction re-exports
assert.equal(typeof extractPixal3dDualGridMesh, 'function');
assert.equal(typeof createPixal3dMeshAdapter, 'function');
assert.equal(typeof comparePixal3dMeshes, 'function');

console.log('pixal3d-mesh-contracts.mjs: PASS');
