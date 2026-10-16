// kaminos-test: node
// Browser UV route: vendored xatlas 0.0.11 Wasm is deterministic on the cleaned
// fixture surface, its post-UV normals follow the source finisher's trimesh law
// within measured tolerance, and finishTrellisMesh accepts the result.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanupAndSimplifyPreservingSurface,createBrowserMeshPostprocess} from '../mesh-cleanup.js';
import {unwrapWithXatlas,unwrapWithXatlasModule,trimeshVertexNormals,createWasmXatlasUnwrapper,WASM_XATLAS_ROUTE} from '../wasm-xatlas.js';
import xatlasFactory from '../vendor/xatlas/xatlas-0.0.11.mjs';
import {finishTrellisMesh} from '../trellis-material.js';
import {MESH_FINISHING_CASES} from './mesh-finishing-fixture.js';

const fixture=JSON.parse(await fs.readFile(new URL('./fixtures/wasm-xatlas-source-normals.json',import.meta.url)));
const sha=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const spec=MESH_FINISHING_CASES['simplify-route'],{vertices,triangles}=spec.build();
const clean=cleanupAndSimplifyPreservingSurface(vertices,triangles,{targetFaces:spec.targetFaces});
assert.equal(sha(clean.vertices),fixture.cleaned.verticesSha256,'fixture input is the cleaned simplify-route surface');
assert.equal(sha(clean.faces),fixture.cleaned.trianglesSha256);

// Determinism pin: same Wasm build, same input, same atlas.
const atlas=await unwrapWithXatlas(clean.vertices,clean.faces);
assert.deepEqual([atlas.xref.length,atlas.charts,atlas.width,atlas.height],
  [fixture.atlasPin.indexedVertices,fixture.atlasPin.charts,fixture.atlasPin.width,fixture.atlasPin.height]);
assert.equal(sha(atlas.uvs),fixture.atlasPin.uvsSha256,'Wasm xatlas UVs are deterministic');
assert.equal(sha(atlas.faces),fixture.atlasPin.facesSha256);
assert.equal(sha(atlas.xref),fixture.atlasPin.xrefSha256);
// Wasm addresses are unsigned: with buffers above 2 GiB (a large surface's
// atlas reaches them) the same atlas must come back.
{const M=await xatlasFactory(),pad=M._malloc(2**31);assert.ok(pad>0,'reserve 2 GiB so later buffers sit above the signed range');
  const high=await unwrapWithXatlasModule(M,clean.vertices,clean.faces);
  assert.equal(sha(high.uvs),fixture.atlasPin.uvsSha256,'UVs read back correctly from above 2 GiB');
  assert.equal(sha(high.faces),fixture.atlasPin.facesSha256);assert.equal(sha(high.xref),fixture.atlasPin.xrefSha256);}

// Source normal law on this atlas, compared with trimesh's own result.
const n=atlas.xref.length,exported=new Float64Array(n*3);
for(let i=0;i<n;i++){const s=atlas.xref[i]*3;exported[i*3]=clean.vertices[s];exported[i*3+1]=clean.vertices[s+2];exported[i*3+2]=-clean.vertices[s+1];}
const world=trimeshVertexNormals(exported,atlas.faces),source=new Float64Array(Buffer.from(fixture.sourceNormals.f64Base64,'base64').buffer.slice(0));
assert.equal(source.length,n*3);
let worst=0,f32Same=0,f64Same=0,degenerate=0;
for(let i=0;i<n;i++){
  const a=[world[i*3],-world[i*3+2],world[i*3+1]],b=[source[i*3],source[i*3+1],source[i*3+2]];
  if(a.every((x,k)=>Math.fround(x)===Math.fround(b[k])))f32Same++;
  if(a.every((x,k)=>Object.is(x,b[k])))f64Same++;
  const la=Math.hypot(...a),lb=Math.hypot(...b);
  if(la<1e-12||lb<1e-12){degenerate++;assert.ok(la<1e-6&&lb<1e-6,'a degenerate normal on one side must be degenerate on the other');continue;}
  worst=Math.max(worst,Math.acos(Math.min(1,(a[0]*b[0]+a[1]*b[1]+a[2]*b[2])/(la*lb)))*180/Math.PI);
}
assert.ok(worst<1e-3,`post-UV normals must follow the source law (worst ${worst} degrees)`);
// Calibrated arithmetic (row-norm order, fused per-vertex sums) gives 64% F64
// identity here; the rest is acos last-bit libm difference. Unfused sums drop
// to 40%, the other norm order to 49%.
assert.ok(f64Same/n>.6,`normal arithmetic must follow trimesh/scipy order (${f64Same}/${n} F64-identical)`);
assert.ok(f32Same/n>.99,`at least 99% of normals F32-identical to trimesh (${f32Same}/${n})`);

// The whole browser finishing chain, cleanup then UV, is admitted by finishTrellisMesh.
const unwrapMesh=createWasmXatlasUnwrapper();
let seen;
const finished=await finishTrellisMesh({vertices,triangles,metadata:{}},{textureSize:16,
  postprocessMesh:createBrowserMeshPostprocess({targetFaces:spec.targetFaces}),
  unwrapMesh:async mesh=>(seen=await unwrapMesh(mesh)),
  materialFields:{features:new Float32Array(6),coordinates:new Int32Array(3),resolution:1}});
assert.equal(seen.uvMetadata.route,WASM_XATLAS_ROUTE);
assert.equal(seen.triangles.length,clean.faces.length,'every cleaned face keeps its own UV triangle');
assert.ok(seen.uvs.every(v=>v>=0&&v<=1));
assert.ok(finished.glb.byteLength>0&&finished.mesh.uvMetadata.route===WASM_XATLAS_ROUTE);
